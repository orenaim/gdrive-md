import type { SessionAction, SessionState, SessionStatus } from './sessionTypes';

export const initialSessionState: SessionState = {
  status: 'LOADING',
  fileId: '',
  fileName: '',
  mimeType: 'text/markdown',
  baseText: '',
  baseRevisionId: '',
  localText: '',
  remoteText: null,
  remoteRevisionId: null,
  dirty: false,
  saveInFlight: false,
  lastSuccessfulSaveAt: null,
  error: null,
  mergeAnalysis: null,
  remoteChangedLines: 0,
  remoteLastModifiedBy: null,
  mergedAt: null,
  readOnly: false,
};

/**
 * Recomputes `status` and `dirty` from the underlying facts.
 *
 * Every reducer branch ends here rather than assigning a status directly, so
 * the enum can never drift out of step with the data it summarises. The order
 * of the checks *is* the precedence: read-only beats everything, an
 * unresolved remote change beats a pending save, and so on.
 */
function derive(state: SessionState): SessionState {
  const dirty = state.localText !== state.baseText;
  let status: SessionStatus;

  if (state.status === 'LOADING' || state.status === 'ERROR') {
    // Terminal-ish states are set explicitly and are not re-derived; an error
    // that the user has not dismissed should not vanish because the text
    // happens to match.
    status = state.status;
  } else if (state.readOnly) {
    status = 'READ_ONLY';
  } else if (state.remoteText !== null) {
    // I3: a pending remote change outranks anything to do with saving.
    if (state.status === 'MERGING') status = 'MERGING';
    else if (state.mergeAnalysis && !state.mergeAnalysis.clean) status = 'CONFLICTED';
    else status = 'REMOTE_CHANGED';
  } else if (state.saveInFlight) {
    status = 'SAVING';
  } else if (dirty) {
    status = 'DIRTY';
  } else {
    status = 'CLEAN';
  }

  return { ...state, dirty, status };
}

export function documentReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'LOADED': {
      const { metadata, text } = action;
      return derive({
        ...state,
        status: 'CLEAN',
        fileId: metadata.id,
        fileName: metadata.name,
        mimeType: metadata.mimeType,
        webViewLink: metadata.webViewLink,
        // I2: the pair is assigned together, from the same response.
        baseText: text,
        baseRevisionId: metadata.headRevisionId,
        localText: text,
        readOnly: !metadata.canEdit,
        error: null,
      });
    }

    case 'LOAD_FAILED':
      return { ...state, status: 'ERROR', error: action.error };

    case 'RECOVERED_DRAFT':
      // The draft becomes the local text but *not* the base: it was never
      // saved, which is the whole reason it is being recovered. That makes the
      // document dirty, and autosave will push it to Drive.
      return derive({ ...state, localText: action.text });

    case 'EDITED': {
      if (state.readOnly) return state; // I4
      if (action.text === state.localText) return state;
      return derive({ ...state, localText: action.text });
    }

    case 'SAVE_STARTED':
      // The caller is responsible for not starting a save that I3 forbids;
      // this guard makes the invariant hold even if it slips.
      if (state.readOnly || state.remoteText !== null) return state;
      return derive({ ...state, saveInFlight: true, error: null });

    case 'SAVE_SUCCEEDED': {
      // I1 in action: `baseText` becomes the text that was actually uploaded,
      // not `localText`. If the user typed while the request was in flight,
      // `localText` has moved on, `derive` recomputes `dirty` as true, and the
      // document correctly stays DIRTY rather than claiming to be saved.
      const next = derive({
        ...state,
        saveInFlight: false,
        baseText: action.savedText,
        baseRevisionId: action.revisionId,
        lastSuccessfulSaveAt: action.at,
        error: null,
      });
      return next;
    }

    case 'SAVE_ABORTED':
      // No error recorded: the caller is about to move the session into
      // REMOTE_CHANGED, which is the useful thing to tell the user.
      return derive({ ...state, saveInFlight: false });

    case 'SAVE_FAILED':
      // Emphatically does *not* touch baseText, localText or dirty: a failed
      // write must leave the document exactly as dirty as it was, so the next
      // attempt still has everything to save.
      return derive({ ...state, saveInFlight: false, error: action.error });

    case 'REMOTE_DETECTED':
      return derive({
        ...state,
        remoteText: action.remoteText,
        remoteRevisionId: action.remoteRevisionId,
        mergeAnalysis: action.analysis,
        remoteChangedLines: action.changedLines,
        remoteLastModifiedBy: action.lastModifiedBy,
      });

    case 'REMOTE_NOOP':
      // Content is identical to BASE, so only the revision pointer moves.
      // I2 still holds: the pair still describes the same bytes.
      return derive({ ...state, baseRevisionId: action.revisionId });

    case 'MERGE_REVIEW_OPENED':
      if (state.remoteText === null) return state;
      return derive({ ...state, status: 'MERGING' });

    case 'MERGE_REVIEW_CLOSED':
      if (state.remoteText === null) return state;
      // Back to REMOTE_CHANGED/CONFLICTED: cancelling the review abandons the
      // decisions, not the fact that Drive has moved on.
      return derive({ ...state, status: 'REMOTE_CHANGED' });

    case 'MERGE_APPLIED': {
      if (state.remoteText === null || state.remoteRevisionId === null) return state;
      // The remote revision becomes the new agreed-upon base, because the
      // merged text is built *from* it. The merged text itself is not yet in
      // Drive, so the document is dirty and autosave takes it from here.
      return derive({
        ...state,
        status: 'DIRTY',
        baseText: state.remoteText,
        baseRevisionId: state.remoteRevisionId,
        localText: action.mergedText,
        remoteText: null,
        remoteRevisionId: null,
        mergeAnalysis: null,
        remoteChangedLines: 0,
        remoteLastModifiedBy: null,
        mergedAt: action.at,
      });
    }

    case 'CAPABILITY_CHANGED':
      if (state.readOnly === !action.canEdit) return state;
      return derive({ ...state, readOnly: !action.canEdit });

    case 'DISMISS_ERROR':
      // Leaving ERROR requires re-deriving from scratch, since `derive`
      // deliberately preserves it.
      return derive({ ...state, status: 'CLEAN', error: null });

    case 'CLEAR_MERGED_FLAG':
      return { ...state, mergedAt: null };
  }
}

/**
 * Checks the documented invariants.
 *
 * Called from the session in development and asserted directly in tests. A
 * violation here means a merge could be computed against the wrong base, or a
 * save could overwrite a newer revision, so it is worth being loud about.
 */
export function assertInvariants(state: SessionState): void {
  const problems: string[] = [];

  if (state.status !== 'LOADING' && state.dirty !== (state.localText !== state.baseText)) {
    problems.push('I1: `dirty` does not match localText !== baseText');
  }
  if ((state.remoteText === null) !== (state.remoteRevisionId === null)) {
    problems.push('I5: remoteText and remoteRevisionId must be set together');
  }
  if (state.remoteText !== null && state.status === 'SAVING') {
    problems.push('I3: saving while a remote change is unresolved');
  }
  if (state.readOnly && state.status === 'SAVING') {
    problems.push('I4: saving a read-only file');
  }
  if (problems.length > 0) {
    throw new Error(`Session invariant violated:\n  ${problems.join('\n  ')}`);
  }
}

/** Whether the autosave scheduler is permitted to write right now. */
export function canAutosave(state: SessionState): boolean {
  return (
    state.dirty &&
    !state.readOnly &&
    !state.saveInFlight &&
    state.remoteText === null && // covers REMOTE_CHANGED, MERGING and CONFLICTED
    state.status !== 'LOADING' &&
    state.status !== 'ERROR'
  );
}
