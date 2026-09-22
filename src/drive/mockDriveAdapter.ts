import {
  DriveError,
  type DriveAdapter,
  type DriveDocument,
  type FileRevision,
  type SaveOptions,
} from './driveTypes';

/**
 * An in-memory stand-in for Drive.
 *
 * Its purpose is testability, not demoing: the end-to-end suite needs to make
 * a *remote* edit appear — the thing a second editor, an agent or Drive sync
 * would do — and there is no way to do that against real Drive from a test.
 * Activated with `?mock=1`, and it exposes `window.__mockDrive` so a Playwright
 * test can drive the remote side directly.
 *
 * The behaviours that matter for correctness are modelled faithfully:
 * `headRevisionId` advances on every content change, saving returns the new
 * revision, and `canEdit` can be turned off.
 */
export interface MockDriveControl {
  /** Simulates an external edit: new content, new revision. */
  setRemoteContent(text: string): void;
  /** The content Drive currently holds. */
  getRemoteContent(): string;
  getRevisionId(): string;
  setCanEdit(canEdit: boolean): void;
  /** Makes the next N Drive writes fail, to exercise the error path. */
  failNextSaves(count: number, kind?: 'network' | 'permission'): void;
  /** Adds latency to every call, to exercise save-in-flight behaviour. */
  setLatency(ms: number): void;
  /** How many times the file has been written. */
  getSaveCount(): number;
}

declare global {
  interface Window {
    __mockDrive?: MockDriveControl;
  }
}

const DEFAULT_DOCUMENT = `# Company

Headwall provides end-to-end **account security** for the AI era.

## Why now

AI is fundamentally changing who — and what — signs in.

## Roadmap

- Identity graph
- Session brokering

|  |  |  |
|---|---|---|
| **data** | [data.md](https://example.com/data.md) | Account Security Lakehouse & Live Graph — the foundation |
| **identity** | [identity.md](https://example.com/identity.md) | Adaptive Identity & Enforcement, and trust tiers |
|  | [stepup.md](https://example.com/stepup.md) | Which action needs which tier — part of identity |
| **models** | [models.md](https://example.com/models.md) | Account Security Foundation Model |
`;

export class MockDriveAdapter implements DriveAdapter {
  private content = DEFAULT_DOCUMENT;
  private revision = 1;
  private version = 1;
  private canEdit = true;
  private modifiedTime = new Date().toISOString();
  private latencyMs = 0;
  private failSaves = 0;
  private failKind: 'network' | 'permission' = 'network';
  private saveCount = 0;

  readonly fileId = 'mock-file-id-0000000001';
  readonly fileName = 'company.md';
  readonly mimeType = 'text/markdown';

  constructor() {
    if (typeof window !== 'undefined') {
      // `?readonly=1` makes the file arrive without edit capability. It has to
      // be settable from the URL because a page reload builds a fresh adapter,
      // so anything set through the control surface beforehand is gone.
      if (new URL(window.location.href).searchParams.get('readonly') === '1') {
        this.canEdit = false;
      }
      window.__mockDrive = {
        setRemoteContent: (text) => {
          this.content = text;
          this.revision += 1;
          this.version += 1;
          this.modifiedTime = new Date().toISOString();
        },
        getRemoteContent: () => this.content,
        getRevisionId: () => this.revisionId(),
        setCanEdit: (value) => {
          this.canEdit = value;
        },
        failNextSaves: (count, kind = 'network') => {
          this.failSaves = count;
          this.failKind = kind;
        },
        setLatency: (ms) => {
          this.latencyMs = ms;
        },
        getSaveCount: () => this.saveCount,
      };
    }
  }

  private revisionId(): string {
    return `rev-${this.revision}`;
  }

  private async delay(): Promise<void> {
    if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs));
  }

  private metadata() {
    return {
      id: this.fileId,
      name: this.fileName,
      mimeType: this.mimeType,
      modifiedTime: this.modifiedTime,
      headRevisionId: this.revisionId(),
      version: String(this.version),
      canEdit: this.canEdit,
      lastModifyingUser: { displayName: 'Mock Editor', emailAddress: 'mock@example.com' },
      webViewLink: 'https://drive.google.com/file/d/mock/view',
    };
  }

  async openFile(): Promise<DriveDocument> {
    await this.delay();
    return { metadata: this.metadata(), text: this.content };
  }

  async readFile(): Promise<DriveDocument> {
    await this.delay();
    return { metadata: this.metadata(), text: this.content };
  }

  async getRevision(): Promise<FileRevision> {
    await this.delay();
    const { headRevisionId, modifiedTime, version, canEdit, lastModifyingUser } = this.metadata();
    return { headRevisionId, modifiedTime, version, canEdit, lastModifyingUser };
  }

  async saveFile(_fileId: string, markdown: string, _options: SaveOptions): Promise<FileRevision> {
    await this.delay();
    if (this.failSaves > 0) {
      this.failSaves -= 1;
      throw new DriveError(this.failKind, 'Simulated Drive failure.');
    }
    if (!this.canEdit) {
      throw new DriveError('permission', 'You do not have permission to edit this file.');
    }
    this.saveCount += 1;
    // Drive does not create a revision when the bytes are unchanged, and
    // neither does this: modelling that faithfully is what makes the
    // "revision changed but content is identical" path testable.
    if (markdown !== this.content) {
      this.content = markdown;
      this.revision += 1;
      this.version += 1;
      this.modifiedTime = new Date().toISOString();
    }
    const { headRevisionId, modifiedTime, version, canEdit } = this.metadata();
    return { headRevisionId, modifiedTime, version, canEdit };
  }
}

/**
 * The single mock instance.
 *
 * A singleton because `window.__mockDrive` must refer to the *same* object the
 * session is talking to. React's StrictMode runs effects twice in development,
 * so constructing one per effect would leave the control surface pointing at a
 * different instance than the document — and an end-to-end test would set
 * remote content on a Drive nobody was reading.
 */
let instance: MockDriveAdapter | null = null;

export function getMockDriveAdapter(): MockDriveAdapter {
  if (!instance) instance = new MockDriveAdapter();
  return instance;
}
