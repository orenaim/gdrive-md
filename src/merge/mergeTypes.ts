/** One region where LOCAL and REMOTE made incompatible edits to the same BASE text. */
export interface MergeConflict {
  /** Stable index into `MergeAnalysis.conflicts`, used by the review UI. */
  id: number;
  /** The user's version of this region. */
  local: string[];
  /** What both sides started from. */
  base: string[];
  /** Drive's version of this region. */
  remote: string[];
}

export type MergeHunk =
  | { kind: 'stable'; lines: string[] }
  | { kind: 'conflict'; conflict: MergeConflict };

/**
 * How a conflict is settled.
 *
 * `both` keeps the user's text followed by Drive's, which is the right answer
 * surprisingly often — two people appended different bullets to the same list.
 * `custom` is whatever the user typed in the review editor.
 */
export type Resolution =
  | { kind: 'local' }
  | { kind: 'remote' }
  | { kind: 'both' }
  | { kind: 'custom'; text: string };

export interface MergeAnalysis {
  hunks: MergeHunk[];
  conflicts: MergeConflict[];
  /** True when the three-way merge succeeded with no human decision needed. */
  clean: boolean;
  /**
   * The merge with every non-conflicting change already applied.
   *
   * Conflicted regions are filled with the *local* text, so this is always a
   * sane document that could be shown in the editor — never one containing
   * `<<<<<<<` markers. Those are never produced anywhere in this module.
   */
  proposedText: string;
}

/** A range of the merged document that came from Drive, for highlighting. */
export interface RemoteRange {
  from: number;
  to: number;
}
