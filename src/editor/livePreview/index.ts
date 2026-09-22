import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import type { Range } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import {
  blockCursorTouchesRange,
  cursorTouchesRange,
  editorFocusField,
  focusTracker,
  onPointerRelease,
} from './cursorReveal';
import { headingRules } from './headings';
import { emphasisRules } from './emphasis';
import { linkRules } from './links';
import { listRules } from './lists';
import { codeRules } from './code';
import { blockRules } from './blocks';
import { refreshBlockDecorations, tableField, tableRules } from './tables';
import type { DecoContext, RuleSet } from './types';

export { cursorTouchesRange, blockCursorTouchesRange } from './cursorReveal';
export { tableField } from './tables';

/**
 * Every rule, keyed by Lezer node name.
 *
 * A node type with no rule here is simply left alone — which is exactly the
 * desired behaviour for Markdown this editor does not model. It keeps showing
 * its raw source, and, crucially, the document is unchanged.
 */
const RULES: RuleSet = {
  ...headingRules,
  ...emphasisRules,
  ...linkRules,
  ...listRules,
  ...codeRules,
  ...blockRules,
  ...tableRules,
};

export function buildLivePreviewDecorations(view: EditorView): DecorationSet {
  const { state } = view;
  const { doc } = state;
  const decorations: Range<Decoration>[] = [];
  const seenReplace = new Set<string>();
  const lineClasses = new Map<number, string>();

  const ctx: DecoContext = {
    state,
    revealed: (from, to) => cursorTouchesRange(state, from, to),
    blockRevealed: (from, to) => blockCursorTouchesRange(state, from, to),
    add: (deco) => void decorations.push(deco),
    replace: (from, to, deco) => {
      const key = `${from}:${to}`;
      if (seenReplace.has(key)) return;
      seenReplace.add(key);
      decorations.push(deco.range(from, to));
    },
    lineClass: (lineFrom, cls) => {
      const existing = lineClasses.get(lineFrom);
      lineClasses.set(lineFrom, existing ? `${existing} ${cls}` : cls);
    },
    lineRange: (from, to, cls) => {
      const firstLine = doc.lineAt(from).number;
      const lastLine = doc.lineAt(Math.min(to, doc.length)).number;
      for (let n = firstLine; n <= lastLine; n++) {
        const value = cls(n, n === firstLine, n === lastLine);
        if (value) ctx.lineClass(doc.line(n).from, value);
      }
    },
  };

  const tree = syntaxTree(state);
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        const rule = RULES[node.name];
        if (!rule) return;
        return rule(node, ctx);
      },
    });
  }

  // A line may carry only one line decoration, so the accumulated classes are
  // emitted here, once per line.
  for (const [lineFrom, cls] of lineClasses) {
    decorations.push(Decoration.line({ class: cls }).range(lineFrom));
  }

  // `true` sorts the ranges: they are produced in tree order, which is not the
  // position order CodeMirror requires.
  return Decoration.set(decorations, true);
}

const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    private readonly detach: () => void;

    constructor(view: EditorView) {
      this.decorations = buildLivePreviewDecorations(view);
      this.detach = onPointerRelease(() => {
        this.decorations = buildLivePreviewDecorations(view);
        // The block field cannot observe the pointer either, so nudge it.
        view.dispatch({ effects: refreshBlockDecorations.of(null) });
      });
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        update.focusChanged
      ) {
        this.decorations = buildLivePreviewDecorations(update.view);
      }
    }

    destroy() {
      this.detach();
    }
  },
  { decorations: (v) => v.decorations },
);

/**
 * Opens a rendered link on click.
 *
 * Handled on mousedown, before CodeMirror's own handler can move the caret
 * into the link and unrender it. Editing a link's text is still possible by
 * clicking just outside it or arrowing in — the same trade every rendered
 * construct makes.
 */
function linkClickHandler() {
  return EditorView.domEventHandlers({
    mousedown: (event) => {
      if (event.button !== 0) return false;
      const el = (event.target as HTMLElement | null)?.closest('.hw-link') as HTMLElement | null;
      const href = el?.getAttribute('data-href');
      if (!href) return false;
      // Only navigable schemes. A `javascript:` href in a document someone
      // else can edit is a script-injection vector, and this document came
      // from a shared Drive file.
      if (!/^(https?|mailto):/i.test(href)) return false;
      event.preventDefault();
      window.open(href, '_blank', 'noopener,noreferrer');
      return true;
    },
    click: (event) => {
      if (!(event.target as HTMLElement | null)?.closest('.hw-link')) return false;
      event.preventDefault();
      return true;
    },
  });
}

/**
 * The complete Live Preview extension.
 *
 * Contains no document transformation of any kind: it is decorations and
 * event handlers only. Removing it (Source mode) therefore cannot alter the
 * document, which is what makes switching modes free of round-trip risk.
 */
export const livePreview = [
  editorFocusField,
  focusTracker,
  tableField,
  livePreviewPlugin,
  linkClickHandler(),
];
