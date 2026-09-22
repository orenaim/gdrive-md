import type { MergeAnalysis } from '../merge/mergeTypes';
import type { DriveFileMetadata } from '../drive/driveTypes';

/**
 * Where the document stands with respect to Drive.
 *
 * Modelled as one explicit value rather than a handful of booleans, because
 * the interesting states are combinations that must *not* occur — saving while
 * a remote change is outstanding, say — and a single enum makes those
 * unrepresentable rather than merely unlikely.
 */
export type SessionStatus =
  | 'LOADING'
  | 'CLEAN'
  | 'DIRTY'
  | 'SAVING'
  | 'REMOTE_CHANGED'
  | 'MERGING'
  | 'CONFLICTED'
  | 'READ_ONLY'
  | 'ERROR';

export interface SessionError {
  message: string;
  /** Whether trying the same operation again could plausibly work. */
  retryable: boolean;
}

/**
 * The complete synchronisation state.
 *
 * ## Invariants
 *
 * These hold after every reducer step, and `assertInvariants` checks them in
 * development. They are the contract the autosave and polling logic relies on.
 *
 * **I1 — `dirty` means exactly "unsaved edits exist".**
 *   `dirty === (localText !== baseText)`, always. Nothing sets `dirty`
 *   directly; it is derived. This is what makes the save-in-flight race
 *   correct for free: if the user typed while a save was uploading, then when
 *   that save lands `baseText` becomes the text that was *sent*, which is no
 *   longer `localText`, so the document stays dirty.
 *
 * **I2 — `baseText` and `baseRevisionId` always describe the same Drive
 * revision.** They are only ever assigned together. `baseText` is the last
 * content the editor and Drive are known to have agreed on; `baseRevisionId`
 * is the Drive revision that content came from. Every three-way merge uses
 * this pair as BASE, so letting them drift apart would silently corrupt merges.
 *
 * **I3 — a remote change is never outstanding while saving.**
 *   `remoteText !== null` implies the status is REMOTE_CHANGED, MERGING or
 *   CONFLICTED — never SAVING. Uploading over a revision known to be newer is
 *   precisely the data loss this whole mechanism exists to prevent.
 *
 * **I4 — read-only is absorbing.** Once READ_ONLY, no path leads to SAVING.
 *
 * **I5 — `remoteRevisionId` is set if and only if `remoteText` is.**
 */
export interface SessionState {
  status: SessionStatus;

  // --- Identity -----------------------------------------------------------
  fileId: string;
  fileName: string;
  mimeType: string;
  resourceKey?: string;
  webViewLink?: string;

  // --- The synchronisation triple ----------------------------------------
  /** Last content the editor and Drive agreed upon. BASE for every merge. */
  baseText: string;
  /** Drive's headRevisionId for `baseText`. See I2. */
  baseRevisionId: string;
  /** What is in the editor right now. */
  localText: string;
  /** Drive's newer content, once an external change has been fetched. */
  remoteText: string | null;
  /** Drive's headRevisionId for `remoteText`. See I5. */
  remoteRevisionId: string | null;

  // --- Derived / presentational ------------------------------------------
  dirty: boolean;
  saveInFlight: boolean;
  lastSuccessfulSaveAt: number | null;
  error: SessionError | null;
  /** Populated when a fetched remote change has been analysed. */
  mergeAnalysis: MergeAnalysis | null;
  /** Lines the remote edit touched, for the banner. */
  remoteChangedLines: number;
  remoteLastModifiedBy: string | null;
  /** Timestamp of the last completed merge, for the transient confirmation. */
  mergedAt: number | null;
  readOnly: boolean;
}

export type SessionAction =
  | { type: 'LOADED'; metadata: DriveFileMetadata; text: string }
  | { type: 'LOAD_FAILED'; error: SessionError }
  | { type: 'RECOVERED_DRAFT'; text: string }
  | { type: 'EDITED'; text: string }
  | { type: 'SAVE_STARTED' }
  | { type: 'SAVE_SUCCEEDED'; savedText: string; revisionId: string; at: number }
  | { type: 'SAVE_FAILED'; error: SessionError }
  /**
   * The preflight found a newer Drive revision, so the write was abandoned
   * before anything was uploaded. Distinct from SAVE_FAILED because nothing
   * went wrong — there is no error to show the user, only a merge to offer.
   */
  | { type: 'SAVE_ABORTED' }
  /** A newer Drive revision whose content genuinely differs from BASE. */
  | {
      type: 'REMOTE_DETECTED';
      remoteText: string;
      remoteRevisionId: string;
      analysis: MergeAnalysis;
      changedLines: number;
      lastModifiedBy: string | null;
    }
  /**
   * A newer Drive revision whose content is byte-identical to BASE.
   *
   * Drive can advance `headRevisionId` without the bytes changing — someone
   * saved the same content, or Drive reorganised revisions. Treating that as
   * an external edit would put a merge banner in front of the user for no
   * reason, so the new revision is simply adopted.
   */
  | { type: 'REMOTE_NOOP'; revisionId: string }
  | { type: 'MERGE_REVIEW_OPENED' }
  | { type: 'MERGE_REVIEW_CLOSED' }
  | { type: 'MERGE_APPLIED'; mergedText: string; at: number }
  | { type: 'CAPABILITY_CHANGED'; canEdit: boolean }
  | { type: 'DISMISS_ERROR' }
  | { type: 'CLEAR_MERGED_FLAG' };
