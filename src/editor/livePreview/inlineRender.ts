import { GFM, parser } from '@lezer/markdown';
import type { SyntaxNode } from '@lezer/common';

/**
 * Renders a fragment of inline Markdown as DOM.
 *
 * Used where Markdown has to be *displayed* outside the editor's own
 * decoration machinery — table cells, principally, whose contents are
 * replaced wholesale by a widget and so never get decorated in place.
 *
 * It parses the fragment on its own rather than reading the document's
 * syntax tree. That makes it self-contained: no `EditorState`, no offsets to
 * keep in step with a document that may have moved on since the widget was
 * built, and it can be unit-tested with a plain string. Tables are small, so
 * the extra parse is not worth avoiding.
 *
 * The parser is the same one the editor uses, so what renders here and what
 * the live preview does in body text cannot drift apart.
 */
const inlineParser = parser.configure(GFM);

const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:/i;
/** Schemes safe to put in an href. A shared document can contain anything. */
const SAFE_LINK = /^(https?:|mailto:)/i;

export function renderInlineMarkdown(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  if (!text) return fragment;

  const tree = inlineParser.parse(text);
  let container: SyntaxNode = tree.topNode;
  // A bare inline fragment parses as Document > Paragraph > inline nodes.
  // Anything else (a heading, a list marker) is left to the default branch in
  // `renderNode`, which emits it as literal text.
  const first = container.firstChild;
  if (first && first.name === 'Paragraph') container = first;

  renderChildren(fragment, text, container);
  return fragment;
}

/**
 * Renders `node`'s children, emitting the source text in the gaps between
 * them.
 *
 * The gap-filling is what makes the marker nodes disappear for free: a
 * `StrongEmphasis` has two `EmphasisMark` children and nothing else, so
 * skipping the marks and emitting what lies between them yields exactly the
 * emphasised text.
 */
function renderChildren(parent: Node, text: string, node: SyntaxNode): void {
  let pos = node.from;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.from > pos) parent.appendChild(document.createTextNode(text.slice(pos, child.from)));
    renderNode(parent, text, child);
    pos = child.to;
  }
  if (pos < node.to) parent.appendChild(document.createTextNode(text.slice(pos, node.to)));
}

function wrap(parent: Node, text: string, node: SyntaxNode, tag: string, cls: string): void {
  const el = document.createElement(tag);
  el.className = cls;
  renderChildren(el, text, node);
  parent.appendChild(el);
}

function renderNode(parent: Node, text: string, node: SyntaxNode): void {
  switch (node.name) {
    case 'StrongEmphasis':
      return wrap(parent, text, node, 'strong', 'hw-strong');
    case 'Emphasis':
      return wrap(parent, text, node, 'em', 'hw-em');
    case 'Strikethrough':
      return wrap(parent, text, node, 'del', 'hw-del');
    case 'InlineCode':
      return wrap(parent, text, node, 'code', 'hw-inline-code');

    case 'Link': {
      const marks = node.getChildren('LinkMark');
      const urlNode = node.getChild('URL');
      // A Link with no URL is a *reference* link — `[text]` or `[[x]]` —
      // whose target lives in a definition elsewhere in the document. This
      // renderer sees one cell at a time and cannot resolve those, so the
      // brackets stay. Hiding them would turn `[[wikilink]]` into
      // `[wikilink]`, silently altering syntax we do not support.
      if (!urlNode) {
        parent.appendChild(document.createTextNode(text.slice(node.from, node.to)));
        return;
      }
      const href = text.slice(urlNode.from, urlNode.to);
      const el = document.createElement('a');
      el.className = 'hw-link';
      // Read by the editor's own link handler, which is registered on the
      // whole view and so fires for clicks inside a widget too.
      if (SAFE_LINK.test(href)) el.setAttribute('data-href', href);
      if (marks.length >= 2) {
        // Just the label: the brackets, URL and any title are all marker
        // children, which `renderChildren` skips.
        renderRange(el, text, node, marks[0].to, marks[1].from);
      } else {
        el.appendChild(document.createTextNode(text.slice(node.from, node.to)));
      }
      parent.appendChild(el);
      return;
    }

    case 'Image': {
      const urlNode = node.getChild('URL');
      const src = urlNode ? text.slice(urlNode.from, urlNode.to) : '';
      const marks = node.getChildren('LinkMark');
      const alt = marks.length >= 2 ? text.slice(marks[0].to, marks[1].from) : '';
      // A relative path has no meaning here — the document lives in Drive,
      // not on this origin — so it keeps showing its source rather than
      // rendering a broken image.
      if (!ABSOLUTE_URL.test(src)) {
        parent.appendChild(document.createTextNode(text.slice(node.from, node.to)));
        return;
      }
      const img = document.createElement('img');
      img.src = src;
      img.alt = alt;
      img.className = 'hw-image-inline';
      parent.appendChild(img);
      return;
    }

    // `\*` and friends: show the escaped character, not the backslash.
    case 'Escape':
      parent.appendChild(document.createTextNode(text.slice(node.from + 1, node.to)));
      return;

    // Pure syntax. Skipping these is what hides the markers.
    case 'EmphasisMark':
    case 'StrikethroughMark':
    case 'CodeMark':
    case 'LinkMark':
    case 'URL':
    case 'LinkTitle':
      return;

    default:
      // Anything this renderer does not model is emitted verbatim rather than
      // dropped — the same rule the live preview follows in body text.
      parent.appendChild(document.createTextNode(text.slice(node.from, node.to)));
  }
}

/** `renderChildren` restricted to [from, to] within `node`. */
function renderRange(parent: Node, text: string, node: SyntaxNode, from: number, to: number): void {
  let pos = from;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.to <= from) continue;
    if (child.from >= to) break;
    if (child.from > pos) parent.appendChild(document.createTextNode(text.slice(pos, child.from)));
    renderNode(parent, text, child);
    pos = child.to;
  }
  if (pos < to) parent.appendChild(document.createTextNode(text.slice(pos, to)));
}
