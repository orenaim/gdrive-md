import { Decoration } from '@codemirror/view';
import { hiddenMarker, ImageWidget } from './widgets';
import type { RuleSet } from './types';

/**
 * Links and images.
 *
 * A link collapses to just its label, styled as a link and carrying the target
 * on a data attribute so the click handler can open it. When the caret enters
 * the link, the *entire* `[label](url)` comes back rather than only the half
 * the caret is in — editing a link means editing both its text and its target,
 * and revealing them piecemeal makes the URL unreachable by keyboard.
 */
export const linkRules: RuleSet = {
  Link: (node, ctx) => {
    const marks = node.node.getChildren('LinkMark');
    if (marks.length < 2) return;
    const urlNode = node.node.getChild('URL');
    // A Link with no URL child is a *reference* link — `[label][ref]`,
    // `[label]`, or something like `[[wikilink]]` that merely looks like one.
    // Its target lives in a definition this rule does not resolve, so the
    // source stays visible. Hiding the brackets anyway would render
    // `[[wikilink]]` as `[wikilink]`: a silent misrepresentation of syntax we
    // do not support, which is exactly what must not happen.
    if (!urlNode) return;
    const labelFrom = marks[0].to;
    const labelTo = marks[1].from;
    const href = ctx.state.sliceDoc(urlNode.from, urlNode.to);

    ctx.add(
      Decoration.mark({
        tagName: 'a',
        class: 'hw-link',
        attributes: { 'data-href': href },
      }).range(labelFrom, labelTo),
    );

    if (!ctx.revealed(node.from, node.to)) {
      if (labelFrom > node.from) ctx.replace(node.from, labelFrom, hiddenMarker);
      if (node.to > labelTo) ctx.replace(labelTo, node.to, hiddenMarker);
    }
    return false;
  },

  // `<https://example.com>` and bare autolinks: style, but nothing to hide.
  URL: (node, ctx) => {
    if (node.node.parent?.name === 'Link' || node.node.parent?.name === 'Image') return;
    const href = ctx.state.sliceDoc(node.from, node.to);
    ctx.add(
      Decoration.mark({
        tagName: 'a',
        class: 'hw-link',
        attributes: { 'data-href': href },
      }).range(node.from, node.to),
    );
  },

  Image: (node, ctx) => {
    const marks = node.node.getChildren('LinkMark');
    if (marks.length < 2) return;
    const altFrom = marks[0].to;
    const altTo = marks[1].from;
    const urlNode = node.node.getChild('URL');
    const src = urlNode ? ctx.state.sliceDoc(urlNode.from, urlNode.to) : '';
    const alt = ctx.state.sliceDoc(altFrom, altTo);
    if (!ctx.revealed(node.from, node.to)) {
      ctx.replace(node.from, node.to, Decoration.replace({ widget: new ImageWidget(src, alt) }));
    }
    return false;
  },
};
