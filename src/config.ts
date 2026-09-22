/**
 * Public configuration, supplied at build time through Vite env vars.
 *
 * Everything here is public by construction: an OAuth *client ID* is not a
 * secret, and this app has no client secret because it uses the browser
 * implicit/PKCE token flow. There is deliberately no mechanism for a secret to
 * reach this bundle — see docs/google-workspace-setup.md.
 */
export const config = {
  googleClientId: import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '',

  /**
   * Restricts sign-in to one Workspace domain.
   *
   * Passed to Google as the `hd` parameter and re-checked against the signed-in
   * account after the fact — `hd` alone is a UI hint that a determined user can
   * work around, so it is not a security boundary on its own. Drive's own
   * per-file permissions are the real control; this is about not accidentally
   * opening a file as the wrong identity.
   */
  workspaceDomain: import.meta.env.VITE_WORKSPACE_DOMAIN ?? '',

  /** Milliseconds of quiet typing before a save is attempted. */
  autosaveDebounceMs: numberEnv(import.meta.env.VITE_AUTOSAVE_DEBOUNCE_MS, 2_000),

  /** Longest a continuous typing run may go without being persisted. */
  autosaveMaxIntervalMs: numberEnv(import.meta.env.VITE_AUTOSAVE_MAX_INTERVAL_MS, 5_000),

  /** Revision poll interval while the tab is visible. */
  pollActiveMs: numberEnv(import.meta.env.VITE_POLL_ACTIVE_MS, 3_000),

  /** Revision poll interval while the tab is hidden. */
  pollHiddenMs: numberEnv(import.meta.env.VITE_POLL_HIDDEN_MS, 60_000),
} as const;

function numberEnv(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const GOOGLE_SCOPES = [
  // Per-file access: covers exactly the files the user opens with this app
  // through Drive's "Open with" menu or the Picker, and nothing else. This is
  // a non-sensitive scope, so an internal Workspace app needs no review.
  'https://www.googleapis.com/auth/drive.file',
  // Lets the app be listed in Drive's "Open with" menu at all. Also
  // non-sensitive.
  'https://www.googleapis.com/auth/drive.install',
].join(' ');
