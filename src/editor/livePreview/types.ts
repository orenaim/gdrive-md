import type { Decoration } from '@codemirror/view';
import type { EditorState, Range } from '@codemirror/state';
import type { SyntaxNodeRef } from '@lezer/common';

/**
 * What a decoration rule is allowed to do.
 *
 * Note what is absent: there is no way to change the document. Every rule can
 * only *describe* how a range should look. That is the mechanical guarantee
 * behind the product's core principle — the Markdown in the editor is never
 * rewritten by the renderer, so a construct this code does not understand is
 * simply left showing its raw source rather than being normalised or dropped.
 */
export interface DecoContext {
  readonly state: EditorState;

  /** True when this range should show its raw Markdown (see cursorReveal). */
  revealed(from: number, to: number): boolean;

  /** As `revealed`, with the extra drag/selection guards block widgets need. */
  blockRevealed(from: number, to: number): boolean;

  /** Adds a mark/widget decoration. */
  add(deco: Range<Decoration>): void;

  /**
   * Adds a replacing decoration, ignoring a second attempt at the same range.
   *
   * Two rules can legitimately want to hide the same span (a link's closing
   * `)` and an enclosing construct's trailing marker, say). CodeMirror throws
   * on overlapping replacements at identical positions, so the first wins.
   */
  replace(from: number, to: number, deco: Decoration): void;

  /**
   * Merges a CSS class onto the line starting at `lineFrom`.
   *
   * A line may carry only one line decoration, so classes are accumulated here
   * and emitted once per line after the whole tree walk.
   */
  lineClass(lineFrom: number, cls: string): void;

  /** Applies `cls` to every line in [from, to]; an empty string skips a line. */
  lineRange(
    from: number,
    to: number,
    cls: (lineNumber: number, first: boolean, last: boolean) => string,
  ): void;
}

/**
 * Handles one Lezer node type.
 *
 * Returning `false` stops the walk descending into the node's children — used
 * where a rule has already accounted for the whole subtree (a link, whose
 * label and URL it positions itself).
 */
export type NodeRule = (node: SyntaxNodeRef, ctx: DecoContext) => boolean | void;

/** A live-preview module contributes rules keyed by Lezer node name. */
export type RuleSet = Record<string, NodeRule>;
