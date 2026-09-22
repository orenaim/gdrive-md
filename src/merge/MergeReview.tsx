import { useMemo, useState } from 'react';
import type { MergeAnalysis, MergeConflict, Resolution } from './mergeTypes';
import { applyResolutions, joinLines } from './threeWayMerge';

interface Props {
  analysis: MergeAnalysis;
  onCancel: () => void;
  onResolve: (mergedText: string) => void;
}

type Choice = 'local' | 'remote' | 'both' | 'custom';

function toResolution(choice: Choice, custom: string): Resolution {
  switch (choice) {
    case 'local':
      return { kind: 'local' };
    case 'remote':
      return { kind: 'remote' };
    case 'both':
      return { kind: 'both' };
    case 'custom':
      return { kind: 'custom', text: custom };
  }
}

function Side({
  label,
  lines,
  variant,
}: {
  label: string;
  lines: string[];
  variant: 'local' | 'remote';
}) {
  const empty = lines.length === 0 || lines.every((line) => line === '');
  return (
    <div className={`hw-side hw-side-${variant}`}>
      <div className="hw-side-label">{label}</div>
      <pre className={empty ? 'hw-side-empty' : undefined}>
        {empty ? '(removed)' : joinLines(lines)}
      </pre>
    </div>
  );
}

function ConflictCard({
  conflict,
  index,
  total,
  choice,
  custom,
  onChoice,
  onCustom,
}: {
  conflict: MergeConflict;
  index: number;
  total: number;
  choice: Choice | undefined;
  custom: string;
  onChoice: (choice: Choice) => void;
  onCustom: (text: string) => void;
}) {
  return (
    <div className="hw-conflict">
      <div className="hw-conflict-title">
        Conflict {index + 1} of {total}
      </div>
      <Side label="Your version" lines={conflict.local} variant="local" />
      <Side label="Drive version" lines={conflict.remote} variant="remote" />

      <div className="hw-conflict-actions">
        <button
          className={`hw-choice${choice === 'local' ? ' hw-choice-active' : ''}`}
          onClick={() => onChoice('local')}
        >
          Keep mine
        </button>
        <button
          className={`hw-choice${choice === 'remote' ? ' hw-choice-active' : ''}`}
          onClick={() => onChoice('remote')}
        >
          Use Drive
        </button>
        <button
          className={`hw-choice${choice === 'both' ? ' hw-choice-active' : ''}`}
          onClick={() => onChoice('both')}
        >
          Keep both
        </button>
        <button
          className={`hw-choice${choice === 'custom' ? ' hw-choice-active' : ''}`}
          onClick={() => onChoice('custom')}
        >
          Edit manually
        </button>
      </div>

      {choice === 'custom' ? (
        <textarea
          className="hw-conflict-editor"
          value={custom}
          aria-label={`Manual resolution for conflict ${index + 1}`}
          onChange={(event) => onCustom(event.target.value)}
          rows={Math.max(3, custom.split('\n').length)}
        />
      ) : null}
    </div>
  );
}

/**
 * The conflict review.
 *
 * Every conflict must be decided explicitly before anything is written — there
 * is no "resolve all" and no default that quietly discards one side. The
 * non-conflicting parts of the merge are already applied in the result this
 * produces, so the user is only ever asked about the parts that genuinely
 * needed a human.
 */
export function MergeReview({ analysis, onCancel, onResolve }: Props) {
  const [choices, setChoices] = useState<Map<number, Choice>>(new Map());
  const [customs, setCustoms] = useState<Map<number, string>>(new Map());

  const resolutions = useMemo(() => {
    const map = new Map<number, Resolution>();
    for (const [id, choice] of choices) {
      map.set(id, toResolution(choice, customs.get(id) ?? ''));
    }
    return map;
  }, [choices, customs]);

  const remaining = analysis.conflicts.length - choices.size;
  const complete = remaining === 0;

  const setChoice = (conflict: MergeConflict, choice: Choice) => {
    setChoices((prev) => new Map(prev).set(conflict.id, choice));
    if (choice === 'custom' && !customs.has(conflict.id)) {
      // Seed the editor with the user's own text: the common manual
      // resolution starts from what they wrote and folds the other side in.
      setCustoms((prev) => new Map(prev).set(conflict.id, joinLines(conflict.local)));
    }
  };

  return (
    <div className="hw-merge-backdrop" role="dialog" aria-modal="true" aria-label="Resolve conflicts">
      <div className="hw-merge-panel">
        <div className="hw-merge-head">
          <h2>Resolve conflicts</h2>
          <p>
            Everything else has already been merged. Nothing is saved to Drive until every
            conflict is decided.
          </p>
        </div>

        <div className="hw-merge-body">
          {analysis.conflicts.map((conflict, index) => (
            <ConflictCard
              key={conflict.id}
              conflict={conflict}
              index={index}
              total={analysis.conflicts.length}
              choice={choices.get(conflict.id)}
              custom={customs.get(conflict.id) ?? ''}
              onChoice={(choice) => setChoice(conflict, choice)}
              onCustom={(text) =>
                setCustoms((prev) => new Map(prev).set(conflict.id, text))
              }
            />
          ))}
        </div>

        <div className="hw-merge-foot">
          <button className="hw-btn" onClick={onCancel}>
            Cancel
          </button>
          <div className="hw-merge-foot-spacer" />
          {!complete ? (
            <span className="hw-merge-remaining">
              {remaining === 1 ? '1 conflict left' : `${remaining} conflicts left`}
            </span>
          ) : null}
          <button
            className="hw-btn hw-btn-primary"
            disabled={!complete}
            onClick={() => onResolve(applyResolutions(analysis, resolutions))}
          >
            Apply merge
          </button>
        </div>
      </div>
    </div>
  );
}
