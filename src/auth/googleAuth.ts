import { GOOGLE_SCOPES, config } from '../config';

/**
 * Google Identity Services, wrapped.
 *
 * This app uses the *token* flow rather than the code flow: there is no
 * backend, so there is nowhere to keep a client secret or a refresh token, and
 * asking for one would mean building a server this V0 does not need. The
 * consequence is that access tokens are short-lived (about an hour) and
 * renewing one means a silent round-trip through Google. `getAccessToken`
 * below hides that: callers ask for a token and get a valid one.
 */

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string; hint?: string }): void;
  callback: (response: TokenResponse) => void;
  error_callback?: (error: { type?: string; message?: string }) => void;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(options: {
            client_id: string;
            scope: string;
            hint?: string;
            hd?: string;
            prompt?: string;
            callback: (response: TokenResponse) => void;
            error_callback?: (error: { type?: string; message?: string }) => void;
          }): TokenClient;
          revoke(token: string, done?: () => void): void;
        };
      };
    };
  }
}

const GIS_SRC = 'https://accounts.google.com/gsi/client';

/**
 * Renew this many milliseconds before the token actually expires.
 *
 * A save that starts with four seconds of validity left and takes five to
 * upload fails with a 401 for no good reason, so the margin is generous
 * relative to a realistic request.
 */
const RENEW_MARGIN_MS = 5 * 60 * 1000;

export class AuthError extends Error {
  constructor(
    message: string,
    /** True when the user dismissed the consent popup rather than failing. */
    readonly userCancelled = false,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

let gisPromise: Promise<void> | null = null;

function loadGis(): Promise<void> {
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new AuthError('Could not load Google sign-in.'));
    document.head.appendChild(script);
  });
  return gisPromise;
}

export interface GoogleUser {
  /** Drive's own identifier for the account — comparable with `state.userId`. */
  permissionId: string;
  emailAddress: string;
  displayName: string;
}

export class GoogleAuth {
  private accessToken: string | null = null;
  private expiresAt = 0;
  private client: TokenClient | null = null;
  private pending: Promise<string> | null = null;

  /**
   * The account Drive says launched us, passed to Google as a login hint.
   *
   * The hint is the reliable half of the multi-account story: it tells Google
   * which of several signed-in accounts to use, so a user with a personal and
   * a work account lands on the right one without being asked.
   */
  constructor(private readonly hint?: string) {}

  /** A valid access token, renewing silently when the current one is stale. */
  async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.expiresAt - RENEW_MARGIN_MS) {
      return this.accessToken;
    }
    // Collapse concurrent callers onto one request: a poll and a save landing
    // together must not open two consent popups.
    if (this.pending) return this.pending;
    // Attempt the non-interactive path first: `prompt: ''` asks Google to skip
    // the consent screen when this client already holds a grant.
    //
    // Be clear about what this does and does not avoid. GIS's token client
    // always opens a *popup window* — there is no hidden-iframe mode for the
    // OAuth token flow, unlike the older gapi client. `prompt: ''` removes the
    // consent screen, not the popup. And Drive launches this app into a fresh
    // tab whose document has no user activation of its own (the click happened
    // on the Drive page, and transient activation does not cross documents), so
    // the popup is blocked essentially every time on first load.
    //
    // That is why this path is still worth taking: when it is blocked, GIS
    // reports `popup_failed_to_open`, the caller shows the sign-in screen, and
    // the button press supplies the activation the popup needs. Once a token is
    // held, later refreshes happen while the user is actively editing, where a
    // popup opens and closes without them noticing.
    //
    // Making the *first* open seamless would need the redirect flow instead of
    // the popup flow — see docs/google-workspace-setup.md.
    this.pending = this.requestToken({ silent: true }).finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  /**
   * Sign-in driven by a real button press.
   *
   * The only thing this changes versus `getAccessToken` is that it is invoked
   * from a user gesture, which is what lets the popup open at all. It still
   * asks Google to complete without UI where it can, so an account that has
   * already granted access sees a window flash rather than a consent screen.
   */
  async signIn(options: { forceAccountChooser?: boolean } = {}): Promise<string> {
    this.accessToken = null;
    this.expiresAt = 0;
    return this.requestToken({
      silent: false,
      ...(options.forceAccountChooser ? { prompt: 'select_account' } : {}),
    });
  }

  /** Discards the cached token so the next call re-authenticates. */
  invalidate(): void {
    this.accessToken = null;
    this.expiresAt = 0;
  }

  private async requestToken(options: { silent: boolean; prompt?: string }): Promise<string> {
    if (!config.googleClientId) {
      throw new AuthError(
        'No Google client ID is configured. Set VITE_GOOGLE_CLIENT_ID (see docs/google-workspace-setup.md).',
      );
    }
    await loadGis();
    const oauth2 = window.google?.accounts.oauth2;
    if (!oauth2) throw new AuthError('Google sign-in did not initialise.');

    return new Promise<string>((resolve, reject) => {
      const client =
        this.client ??
        oauth2.initTokenClient({
          client_id: config.googleClientId,
          scope: GOOGLE_SCOPES,
          ...(this.hint ? { hint: this.hint } : {}),
          ...(config.workspaceDomain ? { hd: config.workspaceDomain } : {}),
          callback: () => {},
        });
      this.client = client;

      client.callback = (response) => {
        if (response.error || !response.access_token) {
          reject(
            new AuthError(
              response.error_description ?? response.error ?? 'Google sign-in failed.',
              response.error === 'access_denied',
            ),
          );
          return;
        }
        this.accessToken = response.access_token;
        // `expires_in` is seconds. Default conservatively if Google omits it.
        this.expiresAt = Date.now() + (response.expires_in ?? 3600) * 1000;
        resolve(response.access_token);
      };
      client.error_callback = (error) => {
        reject(
          new AuthError(
            error.message ?? 'Google sign-in was dismissed.',
            error.type === 'popup_closed' || error.type === 'popup_failed_to_open',
          ),
        );
      };

      client.requestAccessToken({
        // An empty prompt lets Google complete without showing anything when
        // the account already holds a grant — which, after the first
        // authorisation, is every single launch.
        //
        // This must not default to 'consent'. That value does not mean "ask
        // if needed"; it means "re-ask unconditionally", so it put the full
        // consent screen in front of the user on every open even though
        // nothing about the grant had changed. Only an explicit request for
        // the account chooser overrides it.
        prompt: options.prompt ?? '',
        ...(this.hint ? { hint: this.hint } : {}),
      });
    });
  }
}

/**
 * Who Drive thinks we are.
 *
 * `about.get` is available under the `drive.file` scope and needs no extra
 * identity scope, so this costs nothing beyond one request. `permissionId` is
 * the value comparable with the `userId` Drive puts in the Open URL.
 */
export async function fetchDriveUser(accessToken: string): Promise<GoogleUser> {
  const response = await fetch(
    'https://www.googleapis.com/drive/v3/about?fields=user(permissionId,emailAddress,displayName)',
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) {
    throw new AuthError(`Could not identify the signed-in account (HTTP ${response.status}).`);
  }
  const body = (await response.json()) as {
    user?: { permissionId?: string; emailAddress?: string; displayName?: string };
  };
  return {
    permissionId: body.user?.permissionId ?? '',
    emailAddress: body.user?.emailAddress ?? '',
    displayName: body.user?.displayName ?? '',
  };
}
