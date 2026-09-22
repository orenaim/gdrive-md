import type { DriveAdapter } from '../drive/driveTypes';
import { DriveError } from '../drive/driveTypes';
import { countChangedLines, threeWayMerge } from '../merge/threeWayMerge';
import type { MergeAnalysis } from '../merge/mergeTypes';
import { AutosaveScheduler } from './autosave';
import { RemotePoller } from './remotePoller';
import { assertInvariants, canAutosave, documentReducer, initialSessionState } from './documentReducer';
import type { SessionAction, SessionState } from './sessionTypes';
import { draftIsWorthRecovering, draftKey, type Draft, type DraftStore } from '../storage/draftStore';

export interface DocumentSessionOptions {
  adapter: DriveAdapter;
  fileId: string;
  resourceKey?: string;
  /** Identifies the account, so drafts from different logins stay apart. */
  userId: string;
  draftStore: DraftStore;
  autosaveDebounceMs: number;
  autosaveMaxIntervalMs: number;
  pollActiveMs: number;
  pollHiddenMs: number;
  /** Injectable for tests. */
  now?: () => number;
  timers?: {
    setTimeout: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
    clearTimeout: (handle: ReturnType<typeof setTimeout>) => void;
  };
  isHidden?: () => boolean;
}

export type SessionListener = (state: SessionState) => void;

/**
 * Owns the document's relationship with Drive.
 *
 * The one place that decides when to read, when to write and what an external
 * change means. Deliberately framework-free — it has no React import — and it
 * never calls `fetch`: storage arrives as a `DriveAdapter`. That is what makes
 * the whole thing testable against an in-memory fake, and what will let V1
 * introduce a Yjs provider between the editor and this class without either
 * side being rewritten.
 */
export class DocumentSession {
  private state: SessionState = initialSessionState;
  private readonly listeners = new Set<SessionListener>();
  private readonly autosave: AutosaveScheduler;
  private readonly poller: RemotePoller;
  private readonly now: () => number;
  private readonly key: string;
  /**
   * A draft recovered at startup, held until the UI decides its fate.
   *
   * Applying it automatically would be exactly the "blindly overwrite"
   * behaviour the product must not have.
   */
  private pendingDraft: Draft | null = null;
  private disposed = false;

  constructor(private readonly options: DocumentSessionOptions) {
    this.now = options.now ?? (() => Date.now());
    this.key = draftKey(options.userId, options.fileId);

    this.autosave = new AutosaveScheduler({
      debounceMs: options.autosaveDebounceMs,
      maxIntervalMs: options.autosaveMaxIntervalMs,
      onDue: () => void this.attemptSave(),
      now: this.now,
      ...(options.timers ? { setTimeout: options.timers.setTimeout, clearTimeout: options.timers.clearTimeout } : {}),
    });

    this.poller = new RemotePoller({
      activeIntervalMs: options.pollActiveMs,
      hiddenIntervalMs: options.pollHiddenMs,
      check: () => this.checkRemote(),
      ...(options.isHidden ? { isHidden: options.isHidden } : {}),
      ...(options.timers ? { setTimeout: options.timers.setTimeout, clearTimeout: options.timers.clearTimeout } : {}),
    });
  }

  // --- Observation --------------------------------------------------------

  getState(): SessionState {
    return this.state;
  }

  /** The draft offered for recovery, if any. */
  getPendingDraft(): Draft | null {
    return this.pendingDraft;
  }

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  private dispatch(action: SessionAction): void {
    const next = documentReducer(this.state, action);
    if (next === this.state) return;
    this.state = next;
    if (import.meta.env?.DEV) assertInvariants(next);
    for (const listener of this.listeners) listener(next);
  }

  // --- Lifecycle ----------------------------------------------------------

  async load(): Promise<void> {
    try {
      const { metadata, text } = await this.options.adapter.openFile(
        this.options.fileId,
        this.options.resourceKey,
      );
      this.dispatch({ type: 'LOADED', metadata, text });

      // Offered, never applied: `RECOVERED_DRAFT` only fires if the user says
      // so. A draft edited on top of a different revision is still offered —
      // it is genuinely unsaved work — and merging it is handled by the normal
      // remote-change path once it is recovered.
      const draft = await this.options.draftStore.load(this.key);
      this.pendingDraft = draftIsWorthRecovering(draft, text) ? draft : null;
      if (this.pendingDraft) this.notify();
      else if (draft) void this.options.draftStore.clear(this.key);

      // Polling runs for read-only documents too: someone watching a file
      // they cannot edit still wants to see it change.
      this.poller.start();
    } catch (error) {
      this.dispatch({
        type: 'LOAD_FAILED',
        error: {
          message: error instanceof Error ? error.message : 'Could not open this file.',
          retryable: error instanceof DriveError ? error.retryable : false,
        },
      });
    }
  }

  dispose(): void {
    this.disposed = true;
    this.autosave.dispose();
    this.poller.stop();
    this.listeners.clear();
  }

  // --- Editing ------------------------------------------------------------

  /** Called on every editor change. */
  edit(text: string): void {
    if (this.state.readOnly) return;
    const before = this.state;
    this.dispatch({ type: 'EDITED', text });
    if (this.state === before) return;

    // Cheap, frequent, and the only thing standing between an unsaved edit and
    // a crashed tab. Fire-and-forget: the store swallows its own failures.
    void this.options.draftStore.save({
      key: this.key,
      fileId: this.options.fileId,
      userId: this.options.userId,
      localText: text,
      baseRevisionId: this.state.baseRevisionId,
      savedAt: this.now(),
    });

    if (this.state.remoteText !== null) {
      // Autosave stays suspended while an external change is unresolved — the
      // user may keep typing, but nothing goes to Drive until they merge.
      this.autosave.suspend();
      return;
    }
    this.autosave.noteEdit();
  }

  recoverDraft(): void {
    const draft = this.pendingDraft;
    if (!draft) return;
    this.pendingDraft = null;
    this.dispatch({ type: 'RECOVERED_DRAFT', text: draft.localText });
    this.autosave.noteEdit();
  }

  discardDraft(): void {
    this.pendingDraft = null;
    void this.options.draftStore.clear(this.key);
    this.notify();
  }

  // --- Saving -------------------------------------------------------------

  /** Forces an immediate save attempt, e.g. from a Retry button. */
  async saveNow(): Promise<void> {
    await this.attemptSave();
  }

  /**
   * One save attempt, with a revision preflight.
   *
   * ## On the remaining race
   *
   * The preflight reads Drive's current `headRevisionId` and aborts if it does
   * not match the revision our `baseText` came from. That closes the window
   * between polls — without it, an edit made two seconds after the last poll
   * would be overwritten. It does *not* close the window between the preflight
   * response and the upload: Drive offers no conditional write (no
   * if-match/ETag on `files.update`), so a change landing in those few hundred
   * milliseconds is still overwritten. Narrowing it is the best a client-side
   * V0 can do; eliminating it needs either Drive-side compare-and-swap or the
   * V1 collaboration service holding the write lock.
   */
  private async attemptSave(): Promise<void> {
    if (this.disposed) return;
    if (!canAutosave(this.state)) return;

    const textToSave = this.state.localText;
    const expectedRevision = this.state.baseRevisionId;

    this.dispatch({ type: 'SAVE_STARTED' });
    // The guard inside the reducer may have refused; do not proceed if so.
    if (!this.state.saveInFlight) return;

    try {
      const preflight = await this.options.adapter.getRevision(
        this.options.fileId,
        this.options.resourceKey,
      );

      if (preflight.canEdit === false) {
        this.dispatch({ type: 'SAVE_FAILED', error: { message: 'You no longer have edit access to this file.', retryable: false } });
        this.dispatch({ type: 'CAPABILITY_CHANGED', canEdit: false });
        return;
      }

      if (preflight.headRevisionId !== expectedRevision) {
        // Someone else got there first. Abandon the write entirely and switch
        // to the remote-change path — nothing is uploaded.
        this.dispatch({ type: 'SAVE_ABORTED' });
        await this.adoptRemote(
          preflight.headRevisionId,
          preflight.lastModifyingUser?.displayName ?? null,
        );
        return;
      }

      const revision = await this.options.adapter.saveFile(this.options.fileId, textToSave, {
        mimeType: this.state.mimeType,
        ...(this.options.resourceKey ? { resourceKey: this.options.resourceKey } : {}),
      });

      this.dispatch({
        type: 'SAVE_SUCCEEDED',
        savedText: textToSave,
        revisionId: revision.headRevisionId,
        at: this.now(),
      });

      if (this.state.dirty) {
        // The user typed while the upload was in flight. The document is
        // correctly still dirty (invariant I1), so schedule the follow-up.
        this.autosave.noteEdit();
      } else {
        this.autosave.noteSaved();
        // Drive now holds exactly what the editor holds, so the local
        // checkpoint has nothing left to protect.
        void this.options.draftStore.clear(this.key);
      }
    } catch (error) {
      const driveError = error instanceof DriveError ? error : null;
      this.dispatch({
        type: 'SAVE_FAILED',
        error: {
          message: driveError?.message ?? (error instanceof Error ? error.message : 'Save failed.'),
          retryable: driveError?.retryable ?? true,
        },
      });
      if (driveError?.kind === 'permission') {
        this.dispatch({ type: 'CAPABILITY_CHANGED', canEdit: false });
      }
      // The document stays dirty, so the draft checkpoint stays too.
    }
  }

  // --- Remote changes -----------------------------------------------------

  /** One poll: compare Drive's head revision with our base. */
  private async checkRemote(): Promise<void> {
    if (this.disposed) return;
    // Nothing to compare against yet, and never interleave with a save — the
    // save's own preflight covers that window.
    if (this.state.status === 'LOADING' || this.state.status === 'ERROR') return;
    if (this.state.saveInFlight) return;
    // Already holding an unresolved remote change: re-fetching would churn.
    if (this.state.remoteText !== null) return;

    const revision = await this.options.adapter.getRevision(
      this.options.fileId,
      this.options.resourceKey,
    );

    if (revision.canEdit === false && !this.state.readOnly) {
      this.dispatch({ type: 'CAPABILITY_CHANGED', canEdit: false });
    } else if (revision.canEdit === true && this.state.readOnly) {
      this.dispatch({ type: 'CAPABILITY_CHANGED', canEdit: true });
    }

    if (revision.headRevisionId === this.state.baseRevisionId) return;

    await this.adoptRemote(
      revision.headRevisionId,
      revision.lastModifyingUser?.displayName ?? null,
    );
  }

  /**
   * Fetches the newer Drive content and decides what it means.
   *
   * Stops autosave first, unconditionally: from the moment we know Drive has
   * moved on, writing would risk clobbering it.
   */
  private async adoptRemote(revisionId: string, lastModifiedBy: string | null): Promise<void> {
    this.autosave.suspend();

    const { metadata, text } = await this.options.adapter.readFile(
      this.options.fileId,
      this.options.resourceKey,
    );

    // Drive can advance a revision without the bytes changing. Adopting the
    // new revision silently avoids putting a merge banner in front of someone
    // for a change that is not one.
    if (text === this.state.baseText) {
      this.dispatch({ type: 'REMOTE_NOOP', revisionId: metadata.headRevisionId || revisionId });
      if (this.state.dirty) this.autosave.noteEdit();
      return;
    }

    const analysis: MergeAnalysis = threeWayMerge(this.state.baseText, this.state.localText, text);

    this.dispatch({
      type: 'REMOTE_DETECTED',
      remoteText: text,
      remoteRevisionId: metadata.headRevisionId || revisionId,
      analysis,
      changedLines: countChangedLines(this.state.baseText, text),
      lastModifiedBy,
    });
  }

  // --- Merging ------------------------------------------------------------

  /**
   * Handles "Merge update".
   *
   * Returns the merged text when it could be applied without asking anything,
   * or `null` when the conflict review must be shown. Cases A and B of the
   * spec both land in the first branch: a clean three-way merge covers "no
   * local changes" (where the merge is just REMOTE) and "both changed, no
   * overlap" identically, which is the point of doing it three-way.
   */
  mergeUpdate(): { merged: string; conflicts: false } | { conflicts: true } {
    const { mergeAnalysis } = this.state;
    if (!mergeAnalysis || this.state.remoteText === null) return { conflicts: true };

    if (mergeAnalysis.clean) {
      this.applyMerge(mergeAnalysis.proposedText);
      return { merged: mergeAnalysis.proposedText, conflicts: false };
    }
    this.dispatch({ type: 'MERGE_REVIEW_OPENED' });
    return { conflicts: true };
  }

  cancelMergeReview(): void {
    this.dispatch({ type: 'MERGE_REVIEW_CLOSED' });
  }

  /**
   * Commits a merged document — from a clean merge or a resolved review.
   *
   * The remote revision becomes the new base, the merged text becomes the
   * local text, the document is dirty, and autosave resumes. The next save
   * runs its normal preflight, so a *further* remote change arriving during
   * the review is still caught.
   */
  applyMerge(mergedText: string): void {
    this.dispatch({ type: 'MERGE_APPLIED', mergedText, at: this.now() });
    void this.options.draftStore.save({
      key: this.key,
      fileId: this.options.fileId,
      userId: this.options.userId,
      localText: mergedText,
      baseRevisionId: this.state.baseRevisionId,
      savedAt: this.now(),
    });
    if (this.state.dirty) this.autosave.noteEdit();
  }

  clearMergedFlag(): void {
    this.dispatch({ type: 'CLEAR_MERGED_FLAG' });
  }

  dismissError(): void {
    this.dispatch({ type: 'DISMISS_ERROR' });
  }

  /** Test/UI seam: forces an immediate remote check. */
  async pollNow(): Promise<void> {
    await this.poller.pollNow();
  }

  private notify(): void {
    for (const listener of this.listeners) listener(this.state);
  }
}
