import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import { StateEffect, StateField, type Range } from '@codemirror/state';

export interface HighlightRange {
  from: number;
  to: number;
}

export const setMergeHighlights = StateEffect.define<HighlightRange[]>();
export const clearMergeHighlights = StateEffect.define<null>();

const remoteMark = Decoration.mark({ class: 'hw-merge-remote' });
const remoteLine = Decoration.line({ class: 'hw-merge-remote-line' });

/**
 * Temporary highlighting of text that arrived from the Drive copy during a
 * merge.
 *
 * Purely decorative and strictly transient: nothing here is written into the
 * Markdown, so a highlighted merge saved to Drive is byte-identical to the
 * same merge without highlighting. The ranges map through subsequent edits, so
 * they keep pointing at the right text while the user carries on typing.
 */
export const mergeHighlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(clearMergeHighlights)) return Decoration.none;
      if (effect.is(setMergeHighlights)) {
        const decorations: Range<Decoration>[] = [];
        for (const { from, to } of effect.value) {
          const clampedFrom = Math.max(0, Math.min(from, tr.state.doc.length));
          const clampedTo = Math.max(clampedFrom, Math.min(to, tr.state.doc.length));
          // Whole-line backgrounds for multi-line regions, so an inserted
          // paragraph reads as a block rather than as ragged text runs.
          const firstLine = tr.state.doc.lineAt(clampedFrom).number;
          const lastLine = tr.state.doc.lineAt(clampedTo).number;
          for (let n = firstLine; n <= lastLine; n++) {
            decorations.push(remoteLine.range(tr.state.doc.line(n).from));
          }
          if (clampedTo > clampedFrom) {
            decorations.push(remoteMark.range(clampedFrom, clampedTo));
          }
        }
        return Decoration.set(decorations, true);
      }
    }
    return value.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});
