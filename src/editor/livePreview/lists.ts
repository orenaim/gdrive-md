import { Decoration } from '@codemirror/view';
import { BulletWidget, CheckboxWidget, hiddenMarker } from './widgets';
import type { DecoContext, RuleSet } from './types';
import type { SyntaxNodeRef } from '@lezer/common';

/** Whether this list item's marker is followed by a `[ ]` / `[x]` task box. */
function isTaskItem(node: SyntaxNodeRef): boolean {
  const item = node.node.parent;
  if (!item || item.name !== 'ListItem') return false;
  for (let child = item.firstChild; child; child = child.nextSibling) {
    if (child.name === 'Task') return true;
    // The TaskMarker may sit one level down, inside the item's Paragraph.
    if (child.name === 'Paragraph') {
      for (let inner = child.firstChild; inner; inner = inner.nextSibling) {
        if (inner.name === 'TaskMarker') return true;
      }
    }
    if (child.name === 'TaskMarker') return true;
  }
  return false;
}

function listItemRule(node: SyntaxNodeRef, ctx: DecoContext): void {
  // `-first` / `-last` must describe this item's place in the *enclosing list*,
  // not within its own (usually single-line) range. `lineRange`'s own
  // first/last only sees the lines this item spans, so every item in the list
  // would come out as both first and last, and a rule meant to apply once
  // after the whole list would apply after every item — spacing a tight list
  // out like a loose one.
  const parent = node.node.parent;
  const isFirstItem = !parent || parent.firstChild?.from === node.from;
  const isLastItem = !parent || parent.lastChild?.to === node.to;
  ctx.lineRange(node.from, node.to, (_n, first, last) => {
    let cls = 'hw-line-list';
    if (first && isFirstItem) cls += ' hw-line-list-first';
    if (last && isLastItem) cls += ' hw-line-list-last';
    return cls;
  });
}

export const listRules: RuleSet = {
  ListItem: listItemRule,

  ListMark: (node, ctx) => {
    const markText = ctx.state.sliceDoc(node.from, node.to);

    if (isTaskItem(node)) {
      // A task item draws a checkbox from its TaskMarker; the bullet would be
      // redundant alongside it.
      if (!ctx.revealed(node.from, node.to)) {
        const next = ctx.state.sliceDoc(node.to, node.to + 1);
        ctx.replace(node.from, next === ' ' ? node.to + 1 : node.to, hiddenMarker);
      }
      return;
    }

    if (/^[-*+]$/.test(markText)) {
      if (!ctx.revealed(node.from, node.to)) {
        ctx.replace(node.from, node.to, Decoration.replace({ widget: new BulletWidget() }));
      } else {
        ctx.add(Decoration.mark({ class: 'hw-list-mark' }).range(node.from, node.to));
      }
      return;
    }
    // Ordered marker ("1.", "2)"): the number carries meaning, so keep it and
    // only tint it.
    ctx.add(Decoration.mark({ class: 'hw-list-mark' }).range(node.from, node.to));
  },

  TaskMarker: (node, ctx) => {
    if (ctx.revealed(node.from, node.to)) return;
    const checked = /[xX]/.test(ctx.state.sliceDoc(node.from, node.to));
    ctx.replace(node.from, node.to, Decoration.replace({ widget: new CheckboxWidget(checked, node.from) }));
  },
};
