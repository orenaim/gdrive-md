import { Decoration } from '@codemirror/view';
import { hiddenMarker } from './widgets';
import type { RuleSet } from './types';

/**
 * Inline code and fenced code blocks.
 *
 * A fenced block is never replaced by a widget: its content is already plain
 * text that wants to stay editable. Only the ``` fence lines are hidden, and
 * the block's lines get a background so it reads as a unit. That also keeps
 * the language tag reachable — put the caret on the fence line and it appears.
 */
export const codeRules: RuleSet = {
  InlineCode: (node, ctx) => {
    ctx.add(Decoration.mark({ tagName: 'code', class: 'hw-inline-code' }).range(node.from, node.to));
  },

  CodeMark: (node, ctx) => {
    if (ctx.revealed(node.from, node.to)) return;
    const next = ctx.state.sliceDoc(node.to, node.to + 1);
    const to = next === ' ' ? node.to + 1 : node.to;
    ctx.replace(node.from, to, hiddenMarker);
  },

  CodeInfo: (node, ctx) => {
    if (ctx.revealed(node.from, node.to)) return;
    ctx.replace(node.from, node.to, hiddenMarker);
  },

  FencedCode: (node, ctx) => {
    const doc = ctx.state.doc;
    const firstLine = doc.lineAt(node.from).number;
    const lastLine = doc.lineAt(node.to).number;
    const hasBody = lastLine > firstLine + 1;

    // With its ``` hidden, a fence line has no visible text at all. Styling it
    // as part of the code box would double the visible padding above and below
    // the block, so the rounded-corner treatment moves onto the first and last
    // lines that still have content. The fence line keeps its normal height so
    // it stays clickable for editing the language tag.
    const firstFenceHidden = hasBody && !ctx.revealed(doc.line(firstLine).from, doc.line(firstLine).to);
    const lastFenceHidden = hasBody && !ctx.revealed(doc.line(lastLine).from, doc.line(lastLine).to);
    const firstContent = firstFenceHidden ? firstLine + 1 : firstLine;
    const lastContent = lastFenceHidden ? lastLine - 1 : lastLine;

    ctx.lineRange(node.from, node.to, (n) => {
      if (n === firstLine && firstFenceHidden) return '';
      if (n === lastLine && lastFenceHidden) return '';
      let cls = 'hw-line-code';
      if (n === firstContent) cls += ' hw-line-code-first';
      if (n === lastContent) cls += ' hw-line-code-last';
      return cls;
    });
    // Descend, so CodeMark and CodeInfo hide themselves.
  },

  // An indented (four-space) code block. Nothing to hide — the indentation is
  // the syntax and removing it visually would be a lie about the source.
  CodeBlock: (node, ctx) => {
    ctx.lineRange(node.from, node.to, (_n, first, last) => {
      let cls = 'hw-line-code';
      if (first) cls += ' hw-line-code-first';
      if (last) cls += ' hw-line-code-last';
      return cls;
    });
  },
};
