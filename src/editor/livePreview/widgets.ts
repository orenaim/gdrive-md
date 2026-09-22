import { Decoration, EditorView, WidgetType } from '@codemirror/view';

/**
 * Backs every hidden marker with a zero-size element.
 *
 * CodeMirror calibrates its "typical line height" (used to decide how far
 * ArrowUp/ArrowDown should move, among other things) by measuring the first
 * short, plain-text line whose only DOM content is a single text node. A
 * marker hidden with a bare `Decoration.replace({})` leaves the rest of the
 * line as exactly that. On a heading line — much taller than body text — that
 * makes it eligible as the sample and poisons the estimate for the whole
 * document, so vertical cursor motion overshoots by a line at a time once it
 * walks past one. An extra non-text child disqualifies the line from the scan.
 */
class HiddenMarkerWidget extends WidgetType {
  eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    return document.createElement('span');
  }
  get estimatedHeight(): number {
    return 0;
  }
}

export const hiddenMarker = Decoration.replace({ widget: new HiddenMarkerWidget() });
export const zeroWidthWidget = Decoration.widget({ widget: new HiddenMarkerWidget(), side: 1 });

/** Replaces a `-`/`*`/`+` list marker with a typographic bullet. */
export class BulletWidget extends WidgetType {
  eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'hw-bullet';
    span.textContent = '•';
    return span;
  }
}

/**
 * A clickable checkbox standing in for `[ ]` / `[x]`.
 *
 * Toggling writes a single character back into the document, which is the
 * whole point: the checkbox is a view over the Markdown, and ticking it
 * produces exactly the edit a person typing `x` by hand would make.
 */
export class CheckboxWidget extends WidgetType {
  constructor(
    private readonly checked: boolean,
    private readonly markerFrom: number,
  ) {
    super();
  }
  eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked && other.markerFrom === this.markerFrom;
  }
  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('span');
    box.className = 'hw-checkbox' + (this.checked ? ' hw-checkbox-checked' : '');
    box.setAttribute('role', 'checkbox');
    box.setAttribute('aria-checked', String(this.checked));
    box.addEventListener('mousedown', (event) => {
      event.preventDefault();
      if (view.state.readOnly) return;
      // The marker is "[ ]" or "[x]"; the state character sits one past its start.
      const stateChar = view.state.sliceDoc(this.markerFrom + 1, this.markerFrom + 2);
      const insert = stateChar.toLowerCase() === 'x' ? ' ' : 'x';
      view.dispatch({ changes: { from: this.markerFrom + 1, to: this.markerFrom + 2, insert } });
    });
    return box;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

const ABSOLUTE_SRC = /^[a-z][a-z0-9+.-]*:/i;

/** Renders `![alt](src)` as the image itself. */
export class ImageWidget extends WidgetType {
  constructor(
    private readonly src: string,
    private readonly alt: string,
  ) {
    super();
  }
  eq(other: ImageWidget): boolean {
    return other.src === this.src && other.alt === this.alt;
  }
  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'hw-image-wrap';
    // A relative path has no meaning here: the document lives in Drive, not on
    // a web server rooted at this app's origin, so only absolute URLs can
    // actually load. A relative one keeps showing its source rather than
    // rendering a broken-image box over text the user cannot get back to.
    if (!ABSOLUTE_SRC.test(this.src)) {
      wrap.className = 'hw-image-unresolved';
      wrap.textContent = `![${this.alt}](${this.src})`;
      return wrap;
    }
    const img = document.createElement('img');
    img.src = this.src;
    img.alt = this.alt;
    img.className = 'hw-image';
    // An <img> is zero-height until its bytes arrive, so the line CodeMirror
    // measures at mount time is nothing like the one the user ends up seeing.
    const remeasure = () => view.requestMeasure();
    img.addEventListener('load', remeasure);
    img.addEventListener('error', remeasure);
    wrap.appendChild(img);
    return wrap;
  }
  /** Let clicks through, so the caret can land here and reveal the source. */
  ignoreEvent(): boolean {
    return false;
  }
}

/** Draws a `---` thematic break as an actual rule. */
export class HorizontalRuleWidget extends WidgetType {
  eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const hr = document.createElement('span');
    hr.className = 'hw-hr';
    return hr;
  }
  ignoreEvent(): boolean {
    return false;
  }
}
