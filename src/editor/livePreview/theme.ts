import { EditorView } from '@codemirror/view';
import { HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

/**
 * The document's visual design.
 *
 * Deliberately closer to Google Docs than to a code editor: a centred canvas,
 * a serif-free reading face at a comfortable measure, and no gutters, line
 * numbers or active-line highlight. The only monospace text is code, where it
 * is meaningful.
 */
export const documentTheme = EditorView.theme({
  '&': {
    fontSize: '16px',
    color: 'var(--hw-text)',
    backgroundColor: 'var(--hw-canvas)',
    height: '100%',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--hw-font-body)',
    // 1.75 was too airy for a document that also renders its blank lines.
    lineHeight: '1.6',
    overflowY: 'auto',
    justifyContent: 'center',
  },
  '.cm-content': {
    // The centred document canvas. `max-width` on the content rather than the
    // scroller so the scrollbar stays at the window edge, as in Docs.
    maxWidth: '860px',
    width: '100%',
    padding: '56px 40px 45vh 40px',
    caretColor: 'var(--hw-accent)',
  },
  // A generous tail of empty space below the last line, so the end of a
  // document can still be scrolled to a comfortable reading position rather
  // than sticking to the bottom edge of the window.
  '.cm-line': { padding: '0' },

  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--hw-accent)', borderLeftWidth: '2px' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--hw-selection)',
  },

  // --- Headings -----------------------------------------------------------
  //
  // ## On block spacing generally
  //
  // A Markdown document separates blocks with *blank lines*, and this editor
  // renders those blank lines — they are real lines the caret can sit on, each
  // occupying a full line height. So any margin or padding added to a block
  // lands on top of a gap that already exists, and the two compound: a
  // paragraph followed by a blank line followed by another paragraph was
  // getting a blank line *plus* 0.85em of padding, which is why everything
  // read about half again too loose.
  //
  // The rule throughout this file is therefore to let the blank lines do the
  // separating, and to add space only where a construct needs to be set apart
  // from its own background box (code) or rule (blockquote).
  //
  // Padding here is in the heading's own em, so 0.2em on an h1 at 2em is
  // 0.4em of body text.
  '.hw-line-h1': { fontSize: '1.9em', fontWeight: '700', lineHeight: '1.3', padding: '0.25em 0 0' },
  '.hw-line-h2': { fontSize: '1.45em', fontWeight: '700', lineHeight: '1.3', padding: '0.3em 0 0' },
  '.hw-line-h3': { fontSize: '1.2em', fontWeight: '600', lineHeight: '1.35', padding: '0.3em 0 0' },
  '.hw-line-h4': { fontSize: '1.05em', fontWeight: '600', padding: '0.25em 0 0' },
  '.hw-line-h5': { fontSize: '1em', fontWeight: '600', padding: '0.25em 0 0' },
  '.hw-line-h6': { fontSize: '0.95em', fontWeight: '600', color: 'var(--hw-text-muted)', padding: '0.25em 0 0' },
  '.hw-line-setext-rule': { color: 'var(--hw-text-faint)' },

  // --- Inline -------------------------------------------------------------
  '.hw-strong': { fontWeight: '700' },
  '.hw-em': { fontStyle: 'italic' },
  '.hw-del': { textDecoration: 'line-through', color: 'var(--hw-text-muted)' },
  '.hw-link': { color: 'var(--hw-accent)', textDecoration: 'underline', textUnderlineOffset: '2px', cursor: 'pointer' },
  '.hw-inline-code': {
    fontFamily: 'var(--hw-font-mono)',
    fontSize: '0.875em',
    backgroundColor: 'var(--hw-code-bg)',
    borderRadius: '4px',
    padding: '0.15em 0.35em',
  },

  // --- Paragraphs ---------------------------------------------------------
  // Deliberately no trailing padding: see the note above the headings.

  // --- Lists --------------------------------------------------------------
  '.hw-line-list': { paddingLeft: '1.4em', textIndent: '-1.4em' },
  '.hw-bullet': { color: 'var(--hw-text-muted)', fontSize: '1.25em', lineHeight: '1', paddingRight: '0.45em' },
  '.hw-list-mark': { color: 'var(--hw-text-muted)', fontStyle: 'normal' },
  '.hw-checkbox': {
    display: 'inline-block',
    width: '1em',
    height: '1em',
    marginRight: '0.5em',
    verticalAlign: '-0.12em',
    border: '1.5px solid var(--hw-border-strong)',
    borderRadius: '3px',
    cursor: 'pointer',
  },
  '.hw-checkbox-checked': {
    backgroundColor: 'var(--hw-accent)',
    borderColor: 'var(--hw-accent)',
    // A tick drawn with a rotated rectangle border, so no image is needed.
    position: 'relative',
  },
  '.hw-checkbox-checked::after': {
    content: '""',
    position: 'absolute',
    left: '0.28em',
    top: '0.06em',
    width: '0.25em',
    height: '0.55em',
    border: 'solid #fff',
    borderWidth: '0 2px 2px 0',
    transform: 'rotate(42deg)',
  },

  // --- Blockquote ---------------------------------------------------------
  '.hw-line-quote': {
    borderLeft: '3px solid var(--hw-border-strong)',
    paddingLeft: '1em',
    color: 'var(--hw-text-muted)',
  },
  '.hw-line-quote-first': { paddingTop: '0.15em' },
  '.hw-line-quote-last': { paddingBottom: '0.15em' },

  // --- Code blocks --------------------------------------------------------
  '.hw-line-code': {
    fontFamily: 'var(--hw-font-mono)',
    fontSize: '0.875em',
    backgroundColor: 'var(--hw-code-bg)',
    paddingLeft: '1em',
    paddingRight: '1em',
  },
  // Code keeps a little breathing room, because its background box needs to
  // sit clear of the text above and below rather than touching it.
  '.hw-line-code-first': { paddingTop: '0.6em', borderRadius: '6px 6px 0 0', marginTop: '0.2em' },
  '.hw-line-code-last': { paddingBottom: '0.6em', borderRadius: '0 0 6px 6px', marginBottom: '0.2em' },

  // --- Horizontal rule ----------------------------------------------------
  '.hw-hr': {
    display: 'inline-block',
    width: '100%',
    verticalAlign: 'middle',
    borderTop: '1px solid var(--hw-border)',
  },
  '.hw-hr-source': { color: 'var(--hw-text-faint)' },

  // --- Tables -------------------------------------------------------------
  // A table too wide even after wrapping scrolls rather than spilling over
  // the canvas — rare, but a table with many columns can manage it.
  '.hw-table-wrap': { padding: '0.2em 0 0.3em', overflowX: 'auto' },
  '.hw-table': { borderCollapse: 'collapse', width: '100%', fontSize: '0.95em' },
  '.hw-table-cell': {
    border: '1px solid var(--hw-border)',
    padding: '0.45em 0.7em',
    textAlign: 'left',
    lineHeight: '1.5',
    // `height` on a table cell behaves as a *minimum*: every row gets at
    // least this, so an empty header row is the same height as a filled one
    // instead of collapsing to a thin strip, while a cell whose text wraps is
    // free to grow.
    //
    // Set comfortably above the natural height of one line so the minimum
    // actually governs. Inline content — a link, a `strong` — makes the line
    // box a fraction taller than bare text, which at 2.4em left the empty
    // header row a pixel shorter than its neighbours.
    height: '2.6em',
    verticalAlign: 'middle',
  },
  // Header cells are distinguished by weight alone — no fill, no heavier
  // rule. Both read as chrome rather than as structure, and on the common
  // layout where the header cells are empty they are the only thing visible,
  // which makes an empty row look like a rendering fault.
  '.hw-table th.hw-table-cell': { fontWeight: '600' },
  '.hw-image-inline': { maxHeight: '1.4em', verticalAlign: '-0.2em', borderRadius: '2px' },
  '.hw-table-source': { fontFamily: 'var(--hw-font-mono)', fontSize: '0.875em', color: 'var(--hw-text-muted)' },

  // --- Images -------------------------------------------------------------
  '.hw-image': { maxWidth: '100%', borderRadius: '6px', display: 'block' },
  '.hw-image-unresolved': { fontFamily: 'var(--hw-font-mono)', fontSize: '0.875em', color: 'var(--hw-text-muted)' },

  // --- Merge highlighting -------------------------------------------------
  '.hw-merge-remote': {
    backgroundColor: 'var(--hw-merge-remote)',
    borderRadius: '2px',
    transition: 'background-color 600ms ease-out',
  },
  '.hw-merge-remote-line': { backgroundColor: 'var(--hw-merge-remote)' },

  // --- Search panel -------------------------------------------------------
  '.cm-panels': { backgroundColor: 'var(--hw-chrome)', color: 'var(--hw-text)', borderColor: 'var(--hw-border)' },
  '.cm-searchMatch': { backgroundColor: 'var(--hw-search-match)' },
  '.cm-searchMatch-selected': { backgroundColor: 'var(--hw-search-match-active)' },
});

/**
 * Source mode: the same document, shown as plain Markdown.
 *
 * All this does is switch the typeface to monospace and drop the reading
 * measure a little. There is no serialization step, because there is nothing
 * to serialize — Live Preview never changed the text.
 */
export const sourceTheme = EditorView.theme({
  '.cm-content': { fontFamily: 'var(--hw-font-mono)', fontSize: '14px' },
  '.cm-scroller': { lineHeight: '1.6' },
});

/**
 * Syntax colours for text *inside* fenced code blocks.
 *
 * Deliberately not `defaultHighlightStyle`: that style also targets the
 * Markdown tags themselves — it underlines headings, bolds `strong`, colours
 * links — which fights the live preview for control of the same spans and
 * produces underlined H1s. Everything structural about Markdown is styled by
 * the decorations in this module; this style handles only the embedded
 * programming languages, where highlighting is genuinely useful.
 */
export const codeHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: '#a626a4' },
  { tag: [t.name, t.deleted, t.character, t.propertyName, t.macroName], color: '#1f2328' },
  { tag: [t.function(t.variableName), t.labelName], color: '#4078f2' },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: '#986801' },
  { tag: [t.definition(t.name), t.separator], color: '#1f2328' },
  { tag: [t.typeName, t.className, t.number, t.changed, t.annotation, t.modifier, t.self, t.namespace], color: '#c18401' },
  { tag: [t.operator, t.operatorKeyword, t.escape, t.regexp, t.special(t.string)], color: '#0184bc' },
  { tag: t.meta, color: '#a0a1a7' },
  { tag: t.comment, color: '#a0a1a7', fontStyle: 'italic' },
  { tag: t.string, color: '#50a14f' },
  { tag: t.invalid, color: '#e45649' },
]);
