import { Decoration } from '@codemirror/view';
import { zeroWidthWidget } from './widgets';
import type { RuleSet } from './types';

const HEADING_LINE_CLASS: Record<string, string> = {
  ATXHeading1: 'hw-line-h1',
  ATXHeading2: 'hw-line-h2',
  ATXHeading3: 'hw-line-h3',
  ATXHeading4: 'hw-line-h4',
  ATXHeading5: 'hw-line-h5',
  ATXHeading6: 'hw-line-h6',
};

export const headingRules: RuleSet = {
  ...Object.fromEntries(
    Object.entries(HEADING_LINE_CLASS).map(([name, cls]) => [
      name,
      ((node, ctx) => {
        ctx.lineClass(ctx.state.doc.lineAt(node.from).from, cls);
        // Planted unconditionally, even while the caret is on the line and the
        // `#` is fully visible. At the instant a heading line first mounts with
        // the caret already on it (the document's very first line, typically),
        // its content is one short plain text node — exactly what CodeMirror's
        // height-oracle sampler looks for — and the estimate is poisoned before
        // the user ever moves away to trigger the marker-hiding path below.
        // Anchored at the line end so it never competes with the HeaderMark's
        // own decoration for a boundary position.
        ctx.add(zeroWidthWidget.range(node.to));
        // Descend, so HeaderMark gets a chance to hide itself.
      }) as RuleSet[string],
    ]),
  ),

  HeaderMark: (node, ctx) => {
    if (ctx.revealed(node.from, node.to)) return;
    // Swallow the single space after the marker too, so hiding `## ` does not
    // leave the heading text indented by one space.
    const next = ctx.state.sliceDoc(node.to, node.to + 1);
    const to = next === ' ' ? node.to + 1 : node.to;
    // A plain replace, no backing widget: the heading line already carries an
    // unconditional zero-width widget from the rule above.
    ctx.replace(node.from, to, Decoration.replace({}));
  },

  // `Title\n=====` — the underline is the marker, and the line above is text.
  SetextHeading1: (node, ctx) => {
    ctx.lineRange(node.from, node.to, (_n, first) => (first ? 'hw-line-h1' : 'hw-line-setext-rule'));
  },
  SetextHeading2: (node, ctx) => {
    ctx.lineRange(node.from, node.to, (_n, first) => (first ? 'hw-line-h2' : 'hw-line-setext-rule'));
  },
};
