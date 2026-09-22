import { GOOGLE_SCOPES, config } from '../config';

/**
 * Google OAuth via a top-level redirect.
 *
 * ## Why not Google Identity Services
 *
 * GIS implements the token flow with a **popup window**, and has no
 * hidden-iframe variant (unlike the `gapi` client it replaced). Drive launches
 * this app into a fresh tab whose document carries no user activation of its
 * own — the click happened on the Drive page, and transient activation does
 * not cross documents — so the popup is blocked on every single launch. The
 * user then has to click a button purely to supply activation, which for an
 * app whose entire job is "open this file" is most of the interaction.
 *
 * Navigating the top-level window has no such requirement. When the account
 * already holds a grant, Google bounces straight back with a token and the
 * user sees a flicker rather than a dialog.
 *
 * ## The trade
 *
 * A redirect cannot be used to *refresh* a token mid-edit — navigating away
 * from a half-written sentence is worse than any dialog. Renewal therefore
 * goes through a hidden iframe (`renewSilently`), and when that fails the
 * caller is told interaction is required so it can offer a reconnect action
 * rather than hijacking the page.
 */

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';

/** Renew this long before actual expiry, so an in-flight save cannot straddle it. */
const RENEW_MARGIN_MS = 5 * 60 * 1000;

/** A silent iframe renewal that has not resolved by now is not going to. */
const IFRAME_TIMEOUT_MS = 8_000;

const SS_NONCE = 'hw.auth.nonce';
const SS_DRIVE_STATE = 'hw.drive.state';
const SS_ATTEMPTED = 'hw.auth.attempted';

export class AuthError extends Error {
  constructor(
    message: string,
    /** True when only a user gesture can make progress. */
    readonly needsInteraction = false,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface GoogleUser {
  permissionId: string;
  emailAddress: string;
  displayName: string;
}

/** What `consumeRedirectResult` found in the URL when the app started. */
export type RedirectResult =
  | { kind: 'none' }
  | { kind: 'token'; accessToken: string; expiresAt: number; driveState: string | null }
  | { kind: 'error'; error: string; needsInteraction: boolean; driveState: string | null };

function session(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    // Storage can throw outright under strict privacy settings.
    return null;
  }
}

function randomNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The exact string registered as an Authorised redirect URI.
 *
 * Google requires a byte-for-byte match, and notably the redirect URI may not
 * carry a query string — which is why Drive's `state` parameter is stashed in
 * sessionStorage across the round trip rather than simply riding along.
 */
export function redirectUri(): string {
  const { origin, pathname } = window.location;
  // Drop any filename, keep the directory, guarantee one trailing slash.
  const dir = pathname.endsWith('/') ? pathname : pathname.replace(/[^/]*$/, '');
  return `${origin}${dir}`;
}

function parseFragment(hash: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(hash.replace(/^#/, ''))) out[key] = value;
  return out;
}

/**
 * Google's answer to a `prompt=none` request when it cannot proceed silently.
 * Any of these means "ask the user"; anything else is a real failure.
 */
const INTERACTION_ERRORS = new Set([
  'interaction_required',
  'login_required',
  'consent_required',
  'account_selection_required',
]);

function buildAuthUrl(options: {
  prompt: 'none' | 'select_account' | '';
  nonce: string;
  loginHint?: string;
}): string {
  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: redirectUri(),
    response_type: 'token',
    scope: GOOGLE_SCOPES,
    include_granted_scopes: 'true',
    state: options.nonce,
  });
  if (options.prompt) params.set('prompt', options.prompt);
  if (options.loginHint) params.set('login_hint', options.loginHint);
  if (config.workspaceDomain) params.set('hd', config.workspaceDomain);
  return `${AUTH_ENDPOINT}?${params}`;
}

/**
 * Reads an OAuth response out of the URL fragment, if this load is a return
 * from Google. Call once, before anything else looks at the URL.
 *
 * Always strips the fragment, so an access token never lingers in the address
 * bar, in `history`, or in a URL the user might copy.
 */
export function consumeRedirectResult(): RedirectResult {
  const store = session();
  const hash = window.location.hash;
  if (!hash || (!hash.includes('access_token') && !hash.includes('error'))) {
    return { kind: 'none' };
  }

  const fragment = parseFragment(hash);
  const driveState = store?.getItem(SS_DRIVE_STATE) ?? null;

  // Put the URL back the way Drive sent it: the Drive state as a query
  // parameter, no fragment. That keeps the address bar honest and makes a
  // plain reload work, while getting the token out of it immediately.
  const restored = driveState
    ? `${window.location.pathname}?state=${encodeURIComponent(driveState)}`
    : window.location.pathname;
  window.history.replaceState(null, '', restored);

  const expectedNonce = store?.getItem(SS_NONCE);
  store?.removeItem(SS_NONCE);
  if (!expectedNonce || fragment.state !== expectedNonce) {
    // The response does not correspond to a request this tab made. Treat it
    // as hostile and demand a deliberate, user-initiated sign-in.
    return {
      kind: 'error',
      error: 'The sign-in response did not match this session.',
      needsInteraction: true,
      driveState,
    };
  }

  if (fragment.error) {
    return {
      kind: 'error',
      error: fragment.error,
      needsInteraction: INTERACTION_ERRORS.has(fragment.error),
      driveState,
    };
  }

  if (!fragment.access_token) {
    return { kind: 'error', error: 'No access token was returned.', needsInteraction: true, driveState };
  }

  store?.removeItem(SS_ATTEMPTED);
  return {
    kind: 'token',
    accessToken: fragment.access_token,
    expiresAt: Date.now() + Number(fragment.expires_in ?? 3600) * 1000,
    driveState,
  };
}

/** Whether a silent redirect has already been tried in this tab. */
export function silentAttemptMade(): boolean {
  return session()?.getItem(SS_ATTEMPTED) === '1';
}

export class GoogleAuth {
  private accessToken: string | null = null;
  private expiresAt = 0;
  private renewal: Promise<string> | null = null;

  constructor(private readonly loginHint?: string) {}

  setToken(accessToken: string, expiresAt: number): void {
    this.accessToken = accessToken;
    this.expiresAt = expiresAt;
  }

  invalidate(): void {
    this.accessToken = null;
    this.expiresAt = 0;
  }

  get hasToken(): boolean {
    return this.accessToken !== null && Date.now() < this.expiresAt;
  }

  /**
   * Navigates away to Google. Does not return.
   *
   * `driveState` is stashed first, because the redirect URI cannot carry a
   * query string and Drive's launch parameter would otherwise be lost.
   */
  redirectToGoogle(options: { interactive: boolean; driveState: string | null }): void {
    if (!config.googleClientId) {
      throw new AuthError(
        'No Google client ID is configured. Set VITE_GOOGLE_CLIENT_ID (see docs/google-workspace-setup.md).',
      );
    }
    const store = session();
    const nonce = randomNonce();
    store?.setItem(SS_NONCE, nonce);
    if (options.driveState) store?.setItem(SS_DRIVE_STATE, options.driveState);
    if (!options.interactive) store?.setItem(SS_ATTEMPTED, '1');

    window.location.assign(
      buildAuthUrl({
        // Silent first. Interactive only once silent has been refused, so a
        // user who is already signed in never sees anything.
        prompt: options.interactive ? '' : 'none',
        nonce,
        ...(this.loginHint ? { loginHint: this.loginHint } : {}),
      }),
    );
  }

  /**
   * A valid token, renewing through a hidden iframe if the current one is
   * close to expiry.
   *
   * Throws an `AuthError` with `needsInteraction` when renewal cannot be done
   * silently, so the caller can offer a reconnect affordance instead of
   * navigating away from an edit in progress.
   */
  async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.expiresAt - RENEW_MARGIN_MS) {
      return this.accessToken;
    }
    // Collapse concurrent callers: a poll and a save landing together must not
    // start two renewals.
    if (this.renewal) return this.renewal;
    this.renewal = this.renewSilently().finally(() => {
      this.renewal = null;
    });
    return this.renewal;
  }

  /**
   * Silent renewal in a hidden iframe.
   *
   * The iframe navigates to Google and then back to our own redirect URI, at
   * which point it is same-origin and its fragment can be read directly. This
   * is the long-standing OIDC "silent renew" technique.
   *
   * It depends on Google's cookies being available in a third-party frame, so
   * it fails under strict cookie policies. That is expected and handled: the
   * failure surfaces as `needsInteraction`, and the UI offers to reconnect.
   */
  private renewSilently(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const store = session();
      const nonce = randomNonce();
      store?.setItem(SS_NONCE, nonce);

      const iframe = document.createElement('iframe');
      iframe.setAttribute('aria-hidden', 'true');
      iframe.style.display = 'none';

      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        iframe.remove();
        store?.removeItem(SS_NONCE);
        fn();
      };

      const timer = setTimeout(
        () => finish(() => reject(new AuthError('Silent sign-in timed out.', true))),
        IFRAME_TIMEOUT_MS,
      );

      iframe.addEventListener('load', () => {
        let href: string | undefined;
        try {
          // Throws while the frame is still on accounts.google.com. Once it
          // has come back to our origin this succeeds.
          href = iframe.contentWindow?.location.href;
        } catch {
          return; // still cross-origin; wait for the next navigation
        }
        if (!href || !href.startsWith(redirectUri())) return;

        const fragment = parseFragment(new URL(href).hash);
        if (fragment.state !== nonce) {
          finish(() => reject(new AuthError('Sign-in response did not match this session.', true)));
          return;
        }
        if (fragment.error || !fragment.access_token) {
          finish(() =>
            reject(
              new AuthError(
                fragment.error ?? 'Silent sign-in failed.',
                fragment.error ? INTERACTION_ERRORS.has(fragment.error) : true,
              ),
            ),
          );
          return;
        }
        const token = fragment.access_token;
        this.setToken(token, Date.now() + Number(fragment.expires_in ?? 3600) * 1000);
        finish(() => resolve(token));
      });

      iframe.src = buildAuthUrl({
        prompt: 'none',
        nonce,
        ...(this.loginHint ? { loginHint: this.loginHint } : {}),
      });
      document.body.appendChild(iframe);
    });
  }
}

/**
 * Who Drive thinks we are.
 *
 * `about.get` works under the `drive.file` scope, so this needs no extra
 * identity scope.
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
