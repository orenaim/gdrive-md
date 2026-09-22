import { StateEffect, StateField, type EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

export const setEditorFocused = StateEffect.define<boolean>();

/**
 * Whether the editor currently has focus.
 *
 * Kept in state rather than read from the view because the block-level table
 * decorations live in a StateField, which has no view to ask — and if the two
 * decoration sources disagreed about focus, a table would be rendered by one
 * and revealed by the other.
 */
export const editorFocusField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setEditorFocused)) return effect.value;
    return value;
  },
});

/** Dispatches focus changes into `editorFocusField`. */
export const focusTracker = EditorView.updateListener.of((update) => {
  if (!update.focusChanged) return;
  update.view.dispatch({ effects: setEditorFocused.of(update.view.hasFocus) });
});

/**
 * Whether the Markdown source of the construct spanning [from, to] should be
 * revealed instead of rendered.
 *
 * This single predicate is what makes the editor feel like Obsidian, so it is
 * worth being precise about. Two things reveal a construct:
 *
 *  - An empty selection (a plain caret) sitting on any *line* the construct
 *    spans. Line granularity, not character granularity, is deliberate: it is
 *    what lets you arrow onto a heading and see its `##`, and it means a caret
 *    anywhere in `**bold**` reveals the whole emphasis rather than only the
 *    marker you happen to be touching.
 *
 *  - A non-empty selection that genuinely *overlaps* the range. Overlap, not
 *    adjacency: a selection ending exactly at `from` is a sweep that stopped
 *    at the construct's edge, and unrendering on it would reflow text out from
 *    under a drag in progress. Overlap matters because dragging across a
 *    link's `](url)` is how that URL gets selected, so the source has to be
 *    there to select.
 *
 * Nothing here consults the document's *content* — only the selection — which
 * is what keeps it cheap enough to run for every node on every keystroke.
 */
export function cursorTouchesRange(state: EditorState, from: number, to: number): boolean {
  // An unfocused document reveals nothing. Without this, a freshly opened
  // file shows the '#' on its first heading — the caret defaults to position
  // 0, which is legitimately "on" that line, but the user has not touched
  // anything yet and the marker reads as a rendering bug. A document nobody
  // is editing should look like prose.
  //
  // `field(..., false)` returns undefined when the field is not installed, in
  // which case revealing is left enabled: that is the case in unit tests that
  // build a bare state, and in any embedding that skips the tracker.
  if (state.field(editorFocusField, false) === false) return false;

  const len = state.doc.length;
  const startLine = state.doc.lineAt(Math.min(from, len)).number;
  const endLine = state.doc.lineAt(Math.min(to, len)).number;

  for (const range of state.selection.ranges) {
    if (range.empty) {
      const headLine = state.doc.lineAt(Math.min(range.head, len)).number;
      if (headLine >= startLine && headLine <= endLine) return true;
      continue;
    }
    if (range.from < to && range.to > from) return true;
  }
  return false;
}

/**
 * Tracks whether a mouse button is currently held down anywhere on the page.
 *
 * A *block* widget (a table) must not give way to its source in the middle of
 * a drag. Sweeping a selection across a table is a copy gesture, not a request
 * to edit it, and swapping rows out for pipe text mid-gesture both looks wrong
 * and destroys the selection being made.
 *
 * This lives at module scope because the decoration builders are pure
 * state-derived code with no access to the originating DOM event. Listeners
 * attach in the capture phase so nothing can stop them, and only when a DOM is
 * present (unit tests run under plain Node).
 */
let pointerDown = false;
const releaseListeners = new Set<() => void>();

if (typeof document !== 'undefined') {
  document.addEventListener('mousedown', () => { pointerDown = true; }, true);
  const release = () => {
    if (!pointerDown) return;
    pointerDown = false;
    // Releasing changes what `blockCursorTouchesRange` answers, but no editor
    // *state* changed, so CodeMirror would schedule no rebuild and a block the
    // caret was dragged into would stay rendered. Ask for one explicitly.
    for (const listener of releaseListeners) listener();
  };
  document.addEventListener('mouseup', release, true);
  document.addEventListener('dragend', release, true);
  window.addEventListener('blur', release, true);
}

/** Runs `listener` when a drag ends, so a view can re-evaluate its blocks. */
export function onPointerRelease(listener: () => void): () => void {
  releaseListeners.add(listener);
  return () => void releaseListeners.delete(listener);
}

/**
 * `cursorTouchesRange` plus the guards that only whole-block widgets want.
 *
 * The guards are deliberately *not* part of `cursorTouchesRange`. That
 * predicate also decides whether a heading shows its `#` and whether `**bold**`
 * shows its asterisks; suppressing those after a mouse gesture would mean
 * clicking a heading moves the caret there but leaves the markup hidden, so the
 * line could not be edited by mouse at all. Only a construct that replaces its
 * entire source with a rendered widget has the problem these guards solve.
 */
export function blockCursorTouchesRange(state: EditorState, from: number, to: number): boolean {
  if (!cursorTouchesRange(state, from, to)) return false;
  // A sweep across a block is a copy, not a request to edit it.
  if (state.selection.ranges.some((r) => !r.empty)) return false;
  // A gesture still in progress has not resolved into anything yet.
  if (pointerDown) return false;
  return true;
}

/** Test seam: drives the drag state without a real pointer. */
export function setPointerDownForTesting(value: boolean): void {
  pointerDown = value;
}
