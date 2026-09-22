import { Decoration } from '@codemirror/view';
import { hiddenMarker, HorizontalRuleWidget } from './widgets';
import type { RuleSet } from './types';

/** Blockquotes, horizontal rules and plain paragraphs. */
export const blockRules: RuleSet = {
  Blockquote: (node, ctx) => {
    ctx.lineRange(node.from, node.to, (_n, first, last) => {
      let cls = 'hw-line-quote';
      if (first) cls += ' hw-line-quote-first';
      if (last) cls += ' hw-line-quote-last';
      return cls;
    });
    // Descend, to hide the ">" marks.
  },

  QuoteMark: (node, ctx) => {
    if (ctx.revealed(node.from, node.to)) return;
    const next = ctx.state.sliceDoc(node.to, node.to + 1);
    const to = next === ' ' ? node.to + 1 : node.to;
    ctx.replace(node.from, to, hiddenMarker);
  },

  HorizontalRule: (node, ctx) => {
    if (ctx.revealed(node.from, node.to)) {
      ctx.add(Decoration.mark({ class: 'hw-hr-source' }).range(node.from, node.to));
      return;
    }
    ctx.replace(node.from, node.to, Decoration.replace({ widget: new HorizontalRuleWidget() }));
  },

  Paragraph: (node, ctx) => {
    // A list item's or blockquote's text is *also* wrapped in a Paragraph node
    // (CommonMark always has one there; "tight" list rendering only means the
    // HTML omits the <p>). Skipping those avoids stacking a second block's
    // vertical padding onto a line that already has its own.
    const parentName = node.node.parent?.name;
    if (parentName === 'ListItem' || parentName === 'Blockquote') return;
    ctx.lineRange(node.from, node.to, (_n, first, last) => {
      let cls = 'hw-line-paragraph';
      if (first) cls += ' hw-line-paragraph-first';
      if (last) cls += ' hw-line-paragraph-last';
      return cls;
    });
  },
};
