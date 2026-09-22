/**
 * Drive's "Open with" hand-off.
 *
 * Drive invokes the configured Open URL with a single URL-encoded `state`
 * query parameter holding JSON. Everything in it comes from outside this app,
 * so it is validated rather than trusted: a malformed or hostile `state` must
 * produce a clear error screen, not a request for some arbitrary file ID.
 */

export interface DriveOpenState {
  fileId: string;
  /** Present only for link-shared files that need one. */
  resourceKey?: string;
  /** Drive's profile ID for the account that launched the app. */
  userId?: string;
}

export type OpenStateResult =
  | { ok: true; state: DriveOpenState }
  | { ok: false; reason: string };

/** Drive file IDs are URL-safe base64-ish tokens; anything else is not one. */
const FILE_ID = /^[A-Za-z0-9_-]{10,200}$/;
const RESOURCE_KEY = /^[A-Za-z0-9_-]{1,200}$/;
const USER_ID = /^[0-9]{1,40}$/;

export function parseDriveOpenState(rawState: string | null): OpenStateResult {
  if (!rawState) return { ok: false, reason: 'No Drive state parameter was supplied.' };

  let parsed: unknown;
  try {
    // The browser has already percent-decoded the query value by the time it
    // reaches us through URLSearchParams, so this is plain JSON.
    parsed = JSON.parse(rawState);
  } catch {
    return { ok: false, reason: 'The Drive state parameter was not valid JSON.' };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, reason: 'The Drive state parameter was not an object.' };
  }
  const state = parsed as Record<string, unknown>;

  if (state.action !== 'open') {
    // "create" (the New menu) and "open" are the two Drive actions. This app
    // only ever opens an existing file — creating one is Drive's job.
    return { ok: false, reason: `Unsupported Drive action: ${String(state.action)}.` };
  }

  // `exportIds` means Drive is offering to export a Google Workspace document
  // (a Doc, Sheet, Slide). Exporting one would produce a *copy* in some other
  // format, which is exactly the duplicate-document outcome this app must
  // never cause.
  if (Array.isArray(state.exportIds) && state.exportIds.length > 0) {
    return {
      ok: false,
      reason:
        'This is a Google Workspace document, not a Markdown file. Headwall MD edits .md files in place and will not create a converted copy.',
    };
  }

  const ids = state.ids;
  if (!Array.isArray(ids) || ids.length === 0 || typeof ids[0] !== 'string') {
    return { ok: false, reason: 'The Drive state parameter contained no file ID.' };
  }
  const fileId = ids[0];
  if (!FILE_ID.test(fileId)) {
    return { ok: false, reason: 'The Drive state parameter contained a malformed file ID.' };
  }

  const result: DriveOpenState = { fileId };

  const resourceKeys = state.resourceKeys;
  if (resourceKeys && typeof resourceKeys === 'object') {
    const key = (resourceKeys as Record<string, unknown>)[fileId];
    if (typeof key === 'string' && RESOURCE_KEY.test(key)) result.resourceKey = key;
  }

  if (typeof state.userId === 'string' && USER_ID.test(state.userId)) {
    result.userId = state.userId;
  }

  return { ok: true, state: result };
}

/** Reads the Drive hand-off out of a full URL (or `window.location`). */
export function readOpenStateFromUrl(url: string): OpenStateResult {
  const params = new URL(url).searchParams;
  return parseDriveOpenState(params.get('state'));
}
