import { Decoration } from '@codemirror/view';
import { hiddenMarker } from './widgets';
import type { RuleSet } from './types';

/**
 * Bold, italic and strikethrough.
 *
 * The pattern each construct follows, and which the rest of the live preview
 * repeats: style the *whole* construct with a `mark` decoration unconditionally
 * (so the text reads as bold whether or not its markers show), and hide the
 * markers only while the caret is elsewhere. The document is untouched either
 * way — `**bold**` is always literally `**bold**` in the Markdown.
 */
export const emphasisRules: RuleSet = {
  StrongEmphasis: (node, ctx) => {
    ctx.add(Decoration.mark({ tagName: 'strong', class: 'hw-strong' }).range(node.from, node.to));
  },
  Emphasis: (node, ctx) => {
    ctx.add(Decoration.mark({ tagName: 'em', class: 'hw-em' }).range(node.from, node.to));
  },
  Strikethrough: (node, ctx) => {
    ctx.add(Decoration.mark({ tagName: 'del', class: 'hw-del' }).range(node.from, node.to));
  },

  EmphasisMark: (node, ctx) => {
    if (!ctx.revealed(node.from, node.to)) ctx.replace(node.from, node.to, hiddenMarker);
  },
  StrikethroughMark: (node, ctx) => {
    if (!ctx.revealed(node.from, node.to)) ctx.replace(node.from, node.to, hiddenMarker);
  },
};
