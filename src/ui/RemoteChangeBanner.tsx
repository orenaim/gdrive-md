import type { SessionState } from '../document/sessionTypes';

interface Props {
  state: SessionState;
  onMerge: () => void;
}

/**
 * Announces that Drive has moved on.
 *
 * Non-modal on purpose: the user may well be mid-sentence, and a dialog that
 * interrupts typing to report someone else's edit would be worse than the
 * staleness it warns about. Editing continues; only saving is paused.
 */
export function RemoteChangeBanner({ state, onMerge }: Props) {
  if (state.remoteText === null || state.status === 'MERGING') return null;

  const conflicts = state.mergeAnalysis?.conflicts.length ?? 0;
  const lines = state.remoteChangedLines;
  const who = state.remoteLastModifiedBy;

  return (
    <div className={`hw-banner${conflicts > 0 ? ' hw-banner-error' : ''}`} role="alert">
      <span className="hw-banner-icon" aria-hidden="true">
        {conflicts > 0 ? '⚠' : '⚡'}
      </span>
      <span className="hw-banner-text">
        This file was updated elsewhere{who ? ` by ${who}` : ''}.
        <span className="hw-banner-detail">
          {lines === 1 ? '1 line changed' : `${lines} lines changed`}
          {conflicts > 0
            ? ` · ${conflicts === 1 ? '1 conflict needs' : `${conflicts} conflicts need`} your decision`
            : ''}
        </span>
      </span>
      <button className="hw-btn hw-btn-primary" onClick={onMerge}>
        {conflicts > 0 ? 'Review conflicts' : 'Merge update'}
      </button>
    </div>
  );
}

/** Confirms a completed merge, then gets out of the way. */
export function MergedBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="hw-banner hw-banner-success" role="status">
      <span className="hw-banner-icon" aria-hidden="true">
        ✓
      </span>
      <span className="hw-banner-text">External changes merged</span>
      <button className="hw-btn hw-btn-quiet" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}

interface DraftProps {
  savedAt: number;
  onRecover: () => void;
  onDiscard: () => void;
}

export function DraftRecoveryBanner({ savedAt, onRecover, onDiscard }: DraftProps) {
  const when = new Date(savedAt).toLocaleString();
  return (
    <div className="hw-banner hw-banner-info" role="alert">
      <span className="hw-banner-icon" aria-hidden="true">
        ↩
      </span>
      <span className="hw-banner-text">
        Unsaved edits from your previous session were found.
        <span className="hw-banner-detail">Last edited {when}</span>
      </span>
      <button className="hw-btn hw-btn-primary" onClick={onRecover}>
        Recover edits
      </button>
      <button className="hw-btn" onClick={onDiscard}>
        Discard
      </button>
    </div>
  );
}
