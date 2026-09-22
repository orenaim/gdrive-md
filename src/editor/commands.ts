import type { EditorView } from '@codemirror/view';
import type { ChangeSpec, EditorState, SelectionRange } from '@codemirror/state';
import { EditorSelection } from '@codemirror/state';

/**
 * Whether [from, to] is already wrapped in `marker` on both sides.
 *
 * Checked against the document rather than the syntax tree so that toggling
 * off works even where the parse is ambiguous (`***both***`, say).
 */
function isWrapped(state: EditorState, from: number, to: number, marker: string): boolean {
  const n = marker.length;
  if (from - n < 0 || to + n > state.doc.length) return false;
  return (
    state.sliceDoc(from - n, from) === marker && state.sliceDoc(to, to + n) === marker
  );
}

/**
 * Toggles a symmetric inline marker (`**`, `*`, `~~`) around each selection.
 *
 * With an empty selection it inserts the pair and puts the caret between them,
 * so Cmd+B then typing produces bold text — the behaviour every editor has.
 */
export function toggleWrap(marker: string) {
  return (view: EditorView): boolean => {
    if (view.state.readOnly) return false;
    const changes: ChangeSpec[] = [];
    const ranges: SelectionRange[] = [];
    const n = marker.length;

    for (const range of view.state.selection.ranges) {
      const { from, to } = range;

      if (isWrapped(view.state, from, to, marker)) {
        changes.push({ from: from - n, to: from }, { from: to, to: to + n });
        ranges.push(EditorSelection.range(from - n, to - n));
        continue;
      }
      // The selection may itself include the markers (`**bold**` selected
      // whole), which is what a user who selected by double-clicking a
      // rendered word after revealing it will have.
      const inner = view.state.sliceDoc(from, to);
      if (inner.length >= 2 * n && inner.startsWith(marker) && inner.endsWith(marker)) {
        changes.push({ from, to, insert: inner.slice(n, inner.length - n) });
        ranges.push(EditorSelection.range(from, to - 2 * n));
        continue;
      }
      changes.push({ from, insert: marker }, { from: to, insert: marker });
      ranges.push(
        range.empty
          ? EditorSelection.cursor(from + n)
          : EditorSelection.range(from + n, to + n),
      );
    }

    view.dispatch(
      view.state.update({
        changes,
        selection: EditorSelection.create(ranges, view.state.selection.mainIndex),
        scrollIntoView: true,
        userEvent: 'input.format',
      }),
    );
    return true;
  };
}

/**
 * Wraps the selection as a Markdown link.
 *
 * The selected text becomes the label and the caret lands inside the empty
 * `()` ready for a URL — the common case is "I typed the words, now make them
 * a link". With nothing selected, an empty `[]()` is inserted with the caret
 * in the label.
 */
export function insertLink(view: EditorView): boolean {
  if (view.state.readOnly) return false;
  const changes: ChangeSpec[] = [];
  const ranges: SelectionRange[] = [];

  for (const range of view.state.selection.ranges) {
    const label = view.state.sliceDoc(range.from, range.to);
    const insert = `[${label}]()`;
    changes.push({ from: range.from, to: range.to, insert });
    // Caret inside `()` when there is a label, inside `[]` when there is not.
    const caret = range.from + (label ? insert.length - 1 : 1);
    ranges.push(EditorSelection.cursor(caret));
  }

  view.dispatch(
    view.state.update({
      changes,
      selection: EditorSelection.create(ranges, view.state.selection.mainIndex),
      scrollIntoView: true,
      userEvent: 'input.format',
    }),
  );
  return true;
}

export const toggleBold = toggleWrap('**');
export const toggleItalic = toggleWrap('*');
export const toggleStrikethrough = toggleWrap('~~');
