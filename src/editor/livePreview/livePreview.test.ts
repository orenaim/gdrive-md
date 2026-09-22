import { describe, expect, it } from 'vitest';
import { EditorState, EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { buildLivePreviewDecorations, tableField } from './index';
import { cursorTouchesRange, editorFocusField, setEditorFocused } from './cursorReveal';

/**
 * Builds a real EditorView so decorations can be exercised the way the app
 * runs them. jsdom gives no layout, so `visibleRanges` would otherwise be
 * empty and nothing would be decorated; the view is given an explicit height
 * and the document is short enough to fall inside the default viewport.
 */
function makeView(doc: string, selection?: number): EditorView {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  return new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: selection === undefined ? undefined : EditorSelection.cursor(selection),
      extensions: [markdown({ base: markdownLanguage }), tableField],
    }),
  });
}

/** Every range the live preview would hide or replace, as [from, to] pairs. */
function replacedRanges(view: EditorView): Array<[number, number]> {
  const set = buildLivePreviewDecorations(view);
  const out: Array<[number, number]> = [];
  const iter = set.iter();
  while (iter.value) {
    // A point decoration with a non-empty range is a replacement.
    if (iter.to > iter.from && iter.value.spec.widget !== undefined) out.push([iter.from, iter.to]);
    else if (iter.to > iter.from && iter.value.spec.tagName === undefined && iter.value.spec.class === undefined) {
      out.push([iter.from, iter.to]);
    }
    iter.next();
  }
  return out;
}

function hides(view: EditorView, text: string): boolean {
  const doc = view.state.doc.toString();
  return replacedRanges(view).some(([from, to]) => doc.slice(from, to) === text);
}

describe('the Markdown document is canonical', () => {
  // The single most important property in the product: rendering is a view
  // over the text, never a transformation of it. If this ever fails, the
  // editor has started rewriting people's files.
  const EXOTIC = [
    '# Heading\n',
    'Plain **bold** and *italic* and ~~struck~~.\n',
    '<div align="center">raw HTML block</div>\n',
    'Footnote reference[^1]\n\n[^1]: the footnote body\n',
    '| a | b |\n|---|---|\n| 1 | 2 |\n',
    '```python\nprint("hi")\n```\n',
    ':::warning\nA container directive nobody parses\n:::\n',
    '$$\n\\int_0^1 x^2 dx\n$$\n',
    'Term\n: definition list item\n',
    '- [ ] task\n- [x] done\n',
    '> quote\n>> nested quote\n',
    '[ref link][1]\n\n[1]: https://example.com\n',
    '---\ntitle: frontmatter-looking thing\n---\n',
    'Trailing whitespace preserved:   \nnext line\n',
    'A line with a literal \\* escaped asterisk\n',
    '{{ mustache }} and [[wikilink]] and #hashtag\n',
    ' non-breaking space and emoji 🎉\n',
  ].join('\n');

  it('never alters the document when rendering it', () => {
    const view = makeView(EXOTIC);
    // Build decorations at every caret position in the document; none of them
    // may dispatch a change.
    for (let pos = 0; pos <= view.state.doc.length; pos += 7) {
      view.dispatch({ selection: EditorSelection.cursor(pos) });
      buildLivePreviewDecorations(view);
    }
    expect(view.state.doc.toString()).toBe(EXOTIC);
    view.destroy();
  });

  it('leaves syntax it does not model showing as raw source', () => {
    const view = makeView(':::warning\nunknown directive\n:::\n', 0);
    // Nothing in the unknown construct is hidden, so the user can still see
    // and edit exactly what is in the file.
    const hidden = replacedRanges(view).map(([f, t]) => view.state.doc.toString().slice(f, t));
    expect(hidden.join('')).not.toContain(':::');
    view.destroy();
  });
});

describe('cursorTouchesRange', () => {
  it('reveals when a caret sits on any line the construct spans', () => {
    const state = EditorState.create({ doc: 'one\ntwo\nthree', selection: EditorSelection.cursor(5) });
    expect(cursorTouchesRange(state, 4, 7)).toBe(true); // "two"
    expect(cursorTouchesRange(state, 0, 3)).toBe(false); // "one"
  });

  it('reveals on overlap but not on mere adjacency', () => {
    const doc = 'abcdefgh';
    const overlapping = EditorState.create({ doc, selection: EditorSelection.range(2, 5) });
    expect(cursorTouchesRange(overlapping, 4, 8)).toBe(true);
    const adjacent = EditorState.create({ doc, selection: EditorSelection.range(0, 4) });
    expect(adjacent.selection.main.empty).toBe(false);
    expect(cursorTouchesRange(adjacent, 4, 8)).toBe(false);
  });
});

describe('inline rendering', () => {
  it('hides emphasis markers when the caret is elsewhere', () => {
    const view = makeView('**bold** here\n\nsecond paragraph', 20);
    expect(hides(view, '**')).toBe(true);
    view.destroy();
  });

  it('shows emphasis markers when the caret is on the line', () => {
    const view = makeView('**bold** here\n\nsecond paragraph', 3);
    expect(hides(view, '**')).toBe(false);
    view.destroy();
  });

  it('collapses a link to its label, and restores the whole source on entry', () => {
    const away = makeView('[Google](https://google.com)\n\nother', 31);
    expect(hides(away, '[')).toBe(true);
    expect(hides(away, '](https://google.com)')).toBe(true);
    away.destroy();

    const inside = makeView('[Google](https://google.com)\n\nother', 3);
    // Both the label brackets and the URL come back together: editing a link
    // means editing both halves.
    expect(hides(inside, '[')).toBe(false);
    expect(hides(inside, '](https://google.com)')).toBe(false);
    inside.destroy();
  });

  it('leaves a reference-style link showing its brackets', () => {
    // `[[wikilink]]` parses as a Link node with no URL. Collapsing it to its
    // label would render it as `[wikilink]` — syntax we do not support,
    // silently misrepresented.
    const view = makeView('[[wikilink]] here\n\nother line', 20);
    expect(hides(view, '[')).toBe(false);
    view.destroy();
  });

  it('hides the "## " of a heading, including its trailing space', () => {
    const view = makeView('## Product\n\nbody text here', 14);
    expect(hides(view, '## ')).toBe(true);
    view.destroy();
  });
});

describe('focus gating', () => {
  /** A view configured the way the app configures it, including focus state. */
  function focusAwareView(doc: string, focused: boolean): EditorView {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        selection: EditorSelection.cursor(0),
        extensions: [markdown({ base: markdownLanguage }), editorFocusField, tableField],
      }),
    });
    view.dispatch({ effects: setEditorFocused.of(focused) });
    return view;
  }

  it('reveals nothing while the editor is unfocused', () => {
    // The caret defaults to position 0, which is on the heading line — so
    // without the focus gate a freshly opened document would show its '#'.
    const view = focusAwareView('# Company\n\nBody text.', false);
    expect(hides(view, '# ')).toBe(true);
    view.destroy();
  });

  it('reveals normally once the editor is focused', () => {
    const view = focusAwareView('# Company\n\nBody text.', true);
    expect(hides(view, '# ')).toBe(false);
    view.destroy();
  });
});
