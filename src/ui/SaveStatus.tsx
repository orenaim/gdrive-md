import type { SessionState } from '../document/sessionTypes';

interface Props {
  state: SessionState;
  onRetry: () => void;
}

type Tone = 'muted' | 'ok' | 'warn' | 'error';

/**
 * The one piece of status the user is expected to read.
 *
 * Deliberately a single short phrase rather than a panel of indicators: the
 * question being answered is "is my work safe?", and every state here is a
 * direct answer to it.
 */
function describe(state: SessionState): { label: string; tone: Tone; spinner?: boolean } {
  if (state.status === 'LOADING') return { label: 'Loading…', tone: 'muted', spinner: true };
  if (state.status === 'ERROR') return { label: 'Could not open', tone: 'error' };
  if (state.readOnly) return { label: 'View only', tone: 'muted' };

  if (state.error) return { label: 'Save failed', tone: 'error' };

  if (state.remoteText !== null) {
    const conflicts = state.mergeAnalysis?.conflicts.length ?? 0;
    if (conflicts > 0) {
      return {
        label: conflicts === 1 ? '1 conflict' : `${conflicts} conflicts`,
        tone: 'error',
      };
    }
    if (state.status === 'MERGING') return { label: 'Merge required', tone: 'warn' };
    return { label: 'Updated elsewhere', tone: 'warn' };
  }

  switch (state.status) {
    case 'SAVING':
      return { label: 'Saving…', tone: 'muted', spinner: true };
    case 'DIRTY':
      return { label: 'Editing…', tone: 'muted' };
    default:
      return { label: 'Saved to Drive', tone: 'ok' };
  }
}

export function SaveStatus({ state, onRetry }: Props) {
  const { label, tone, spinner } = describe(state);
  const toneClass =
    tone === 'ok'
      ? 'hw-status-ok'
      : tone === 'warn'
        ? 'hw-status-warn'
        : tone === 'error'
          ? 'hw-status-error'
          : '';

  return (
    <span className={`hw-status ${toneClass}`} role="status" aria-live="polite">
      {spinner ? <span className="hw-spinner" aria-hidden="true" /> : null}
      {label}
      {tone === 'ok' ? <span aria-hidden="true">✓</span> : null}
      {state.error?.retryable ? (
        <button className="hw-btn hw-btn-quiet" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </span>
  );
}
