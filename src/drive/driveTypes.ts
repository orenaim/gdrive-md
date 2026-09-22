/** Metadata this app actually uses. Nothing else is requested from Drive. */
export interface DriveFileMetadata {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  /**
   * Identifies the file's current content revision.
   *
   * This is the value the whole synchronisation model turns on: it changes
   * when the bytes change, and comparing it against the revision our
   * `baseText` came from is how an external edit is detected.
   */
  headRevisionId: string;
  /** Monotonic counter that also bumps on metadata-only changes. */
  version: string;
  canEdit: boolean;
  lastModifyingUser?: { displayName?: string; emailAddress?: string; photoLink?: string };
  webViewLink?: string;
}

/** The subset of metadata a cheap polling request returns. */
export interface FileRevision {
  headRevisionId: string;
  modifiedTime: string;
  version: string;
  canEdit: boolean;
  lastModifyingUser?: { displayName?: string; emailAddress?: string };
}

export interface DriveDocument {
  metadata: DriveFileMetadata;
  /** The file's bytes decoded as UTF-8 Markdown. */
  text: string;
}

export interface SaveOptions {
  /**
   * The MIME type to send with the upload.
   *
   * Callers pass the file's *existing* type. A `uploadType=media` request sets
   * the stored mimeType from its Content-Type header, so sending anything else
   * would silently rewrite metadata the user did not ask to change — turning a
   * `text/plain` file into `text/markdown` behind their back.
   */
  mimeType: string;
  resourceKey?: string;
}

export type DriveErrorKind =
  | 'auth' // token missing, expired or rejected
  | 'permission' // authenticated, but not allowed
  | 'notFound'
  | 'unsupported' // not a Markdown file we will touch
  | 'network'
  | 'rateLimit'
  | 'unknown';

export class DriveError extends Error {
  constructor(
    readonly kind: DriveErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'DriveError';
  }

  /** Whether retrying the same request unchanged could plausibly succeed. */
  get retryable(): boolean {
    return this.kind === 'network' || this.kind === 'rateLimit';
  }
}

/**
 * The storage layer, as the rest of the app sees it.
 *
 * `DocumentSession` talks only to this interface — it never calls `fetch`, and
 * it contains no Google-specific concepts (no access tokens, no
 * `supportsAllDrives`, no upload endpoints). That boundary is what will let V1
 * slot a Yjs-backed provider alongside Drive without rewriting the sync logic,
 * and what lets the whole session be unit-tested against an in-memory fake.
 */
export interface DriveAdapter {
  /** Metadata + content, for the initial load. */
  openFile(fileId: string, resourceKey?: string): Promise<DriveDocument>;

  /** Metadata only — the cheap call used for polling and save preflight. */
  getRevision(fileId: string, resourceKey?: string): Promise<FileRevision>;

  /** Content + metadata, for fetching a newer remote version. */
  readFile(fileId: string, resourceKey?: string): Promise<DriveDocument>;

  /** Overwrites the existing file's content. Never creates a file. */
  saveFile(fileId: string, markdown: string, options: SaveOptions): Promise<FileRevision>;
}
