import type { GoogleAuth } from '../auth/googleAuth';
import {
  DriveError,
  type DriveAdapter,
  type DriveDocument,
  type DriveFileMetadata,
  type FileRevision,
  type SaveOptions,
} from './driveTypes';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

/** Only what the app uses. Asking for less keeps responses small and fast. */
const METADATA_FIELDS =
  'id,name,mimeType,modifiedTime,headRevisionId,version,capabilities(canEdit),lastModifyingUser(displayName,emailAddress,photoLink),webViewLink';

/** The poll is on a 3-second timer, so it asks for as little as possible. */
const REVISION_FIELDS =
  'headRevisionId,modifiedTime,version,capabilities(canEdit),lastModifyingUser(displayName,emailAddress)';

/**
 * MIME types this app will open.
 *
 * `text/plain` is included because Drive frequently stores `.md` files that
 * way, but only when the *name* confirms it is Markdown — opening an arbitrary
 * text file as Markdown and saving it back would be a surprise at best.
 */
const MARKDOWN_MIME = new Set(['text/markdown', 'text/x-markdown', 'text/md']);
const MARKDOWN_EXT = /\.(md|markdown|mdown|mkd)$/i;

export function isSupportedMarkdownFile(name: string, mimeType: string): boolean {
  if (MARKDOWN_MIME.has(mimeType)) return true;
  if (mimeType === 'text/plain' || mimeType === 'application/octet-stream') {
    return MARKDOWN_EXT.test(name);
  }
  return false;
}

/**
 * Drive API access over `fetch`.
 *
 * Every call carries `supportsAllDrives=true`. Without it, Drive rejects or
 * silently misbehaves on files that live in a Shared Drive, which is where the
 * documents this app is built for actually are.
 */
export class GoogleDriveAdapter implements DriveAdapter {
  constructor(private readonly auth: GoogleAuth) {}

  async openFile(fileId: string, resourceKey?: string): Promise<DriveDocument> {
    const metadata = await this.getMetadata(fileId, resourceKey);
    if (!isSupportedMarkdownFile(metadata.name, metadata.mimeType)) {
      throw new DriveError(
        'unsupported',
        `"${metadata.name}" is a ${metadata.mimeType} file. Headwall MD only opens Markdown (.md, .markdown).`,
      );
    }
    const text = await this.downloadContent(fileId, resourceKey);
    return { metadata, text };
  }

  async readFile(fileId: string, resourceKey?: string): Promise<DriveDocument> {
    // Metadata first, then content. In that order a revision id can never
    // describe bytes *newer* than the ones fetched — the worst case is a
    // revision id describing slightly older bytes, which resolves itself on
    // the next poll. The reverse order could mark newer content as already
    // reconciled and lose an edit.
    const metadata = await this.getMetadata(fileId, resourceKey);
    const text = await this.downloadContent(fileId, resourceKey);
    return { metadata, text };
  }

  async getRevision(fileId: string, resourceKey?: string): Promise<FileRevision> {
    const response = await this.request(
      `${API}/files/${encodeURIComponent(fileId)}?${new URLSearchParams({
        fields: REVISION_FIELDS,
        supportsAllDrives: 'true',
      })}`,
      { method: 'GET' },
      resourceKey ? { fileId, resourceKey } : undefined,
    );
    const body = (await response.json()) as RawFile;
    return toRevision(body);
  }

  async saveFile(fileId: string, markdown: string, options: SaveOptions): Promise<FileRevision> {
    // A media upload PATCH replaces the file's bytes in place. It is `files.update`,
    // not `files.create`: there is no code path in this app that can produce a
    // second file.
    const response = await this.request(
      `${UPLOAD}/files/${encodeURIComponent(fileId)}?${new URLSearchParams({
        uploadType: 'media',
        supportsAllDrives: 'true',
        fields: REVISION_FIELDS,
      })}`,
      {
        method: 'PATCH',
        headers: {
          // The file's *existing* type, so saving never rewrites metadata.
          'Content-Type': options.mimeType || 'text/markdown',
        },
        // A string body is encoded as UTF-8 by fetch, which is what Markdown
        // wants. A Blob would work identically; a string keeps it obvious.
        body: markdown,
      },
      options.resourceKey ? { fileId, resourceKey: options.resourceKey } : undefined,
    );
    const body = (await response.json()) as RawFile;
    return toRevision(body);
  }

  private async getMetadata(fileId: string, resourceKey?: string): Promise<DriveFileMetadata> {
    const response = await this.request(
      `${API}/files/${encodeURIComponent(fileId)}?${new URLSearchParams({
        fields: METADATA_FIELDS,
        supportsAllDrives: 'true',
      })}`,
      { method: 'GET' },
      resourceKey ? { fileId, resourceKey } : undefined,
    );
    const body = (await response.json()) as RawFile;
    return {
      id: body.id ?? fileId,
      name: body.name ?? 'Untitled',
      mimeType: body.mimeType ?? 'application/octet-stream',
      modifiedTime: body.modifiedTime ?? '',
      headRevisionId: body.headRevisionId ?? '',
      version: body.version ?? '',
      canEdit: body.capabilities?.canEdit ?? false,
      lastModifyingUser: body.lastModifyingUser,
      webViewLink: body.webViewLink,
    };
  }

  private async downloadContent(fileId: string, resourceKey?: string): Promise<string> {
    const response = await this.request(
      `${API}/files/${encodeURIComponent(fileId)}?${new URLSearchParams({
        alt: 'media',
        supportsAllDrives: 'true',
      })}`,
      { method: 'GET' },
      resourceKey ? { fileId, resourceKey } : undefined,
    );
    // `response.text()` decodes as UTF-8, which is what Drive serves for text
    // types and the only encoding this app claims to support.
    return response.text();
  }

  /**
   * One authenticated Drive request, with a single retry after re-auth.
   *
   * A 401 mid-session is routine — the access token simply expired — so it is
   * handled here rather than surfacing to the user as a save failure.
   */
  private async request(
    url: string,
    init: RequestInit,
    resourceKey?: { fileId: string; resourceKey: string },
  ): Promise<Response> {
    let response = await this.send(url, init, resourceKey);
    if (response.status === 401) {
      this.auth.invalidate();
      response = await this.send(url, init, resourceKey);
    }
    if (!response.ok) throw await toDriveError(response);
    return response;
  }

  private async send(
    url: string,
    init: RequestInit,
    resourceKey?: { fileId: string; resourceKey: string },
  ): Promise<Response> {
    let token: string;
    try {
      token = await this.auth.getAccessToken();
    } catch (error) {
      throw new DriveError('auth', error instanceof Error ? error.message : 'Sign-in failed.');
    }
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    if (resourceKey) {
      // Required for link-shared files. The header takes a comma-separated
      // list of `fileId/resourceKey` pairs.
      headers.set('X-Goog-Drive-Resource-Keys', `${resourceKey.fileId}/${resourceKey.resourceKey}`);
    }
    try {
      return await fetch(url, { ...init, headers });
    } catch (error) {
      // A rejected `fetch` is a transport failure — offline, DNS, CORS. It is
      // explicitly retryable, and must never be allowed to look like a
      // successful save.
      throw new DriveError(
        'network',
        error instanceof Error ? error.message : 'Network request failed.',
      );
    }
  }
}

interface RawFile {
  id?: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
  headRevisionId?: string;
  version?: string;
  capabilities?: { canEdit?: boolean };
  lastModifyingUser?: { displayName?: string; emailAddress?: string; photoLink?: string };
  webViewLink?: string;
}

function toRevision(body: RawFile): FileRevision {
  return {
    headRevisionId: body.headRevisionId ?? '',
    modifiedTime: body.modifiedTime ?? '',
    version: body.version ?? '',
    canEdit: body.capabilities?.canEdit ?? false,
    lastModifyingUser: body.lastModifyingUser,
  };
}

async function toDriveError(response: Response): Promise<DriveError> {
  let detail = '';
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    detail = body.error?.message ?? '';
  } catch {
    // A non-JSON error body is not worth reporting verbatim.
  }
  const message = detail || `Drive returned HTTP ${response.status}.`;

  switch (response.status) {
    case 401:
      return new DriveError('auth', message, 401);
    case 403:
      // Drive uses 403 for both "you may not" and "slow down"; the message is
      // the only thing that distinguishes them.
      if (/rate limit|quota|userRateLimitExceeded/i.test(detail)) {
        return new DriveError('rateLimit', message, 403);
      }
      return new DriveError('permission', message, 403);
    case 404:
      // Drive answers 404 rather than 403 for a file the caller may not see,
      // so as not to confirm it exists. Under the `drive.file` scope that is
      // the *expected* response for any file the user has not opened with
      // this app — the grant is created by Drive's "Open with" flow, not by
      // owning the file — so the raw "File not found" is actively misleading
      // here. The most common cause by far is a hand-constructed URL.
      return new DriveError(
        'notFound',
        'This file could not be opened. Headwall MD can only open files launched from Drive through "Open with" — it has no access to the rest of your Drive. If you reached this page by pasting a URL, open the file from Drive instead.',
        404,
      );
    case 429:
      return new DriveError('rateLimit', message, 429);
    default:
      if (response.status >= 500) return new DriveError('network', message, response.status);
      return new DriveError('unknown', message, response.status);
  }
}
