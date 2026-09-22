# Third-party notices

## Reference implementations

The Live Preview behaviour in `src/editor/livePreview/` was developed with
reference to two MIT-licensed open-source projects. No files were copied
verbatim; what was taken is the *approach* — chiefly the decoration-based
rendering model, the cursor-proximity reveal rule, and several specific
CodeMirror workarounds that are non-obvious and hard-won. Where a particular
technique came from one of them, the reason is recorded in a comment at the
site that uses it.

### md-live-preview-editor

- Source: https://github.com/t-shoot/md-live-preview-editor
- Copyright (c) 2026 t-shoot
- Licence: MIT

Techniques referenced:

- Hiding Markdown markers with replacing decorations while styling the
  construct with mark decorations, so the document text is never modified.
- Backing every hidden marker with a zero-size widget, to keep CodeMirror's
  height-estimation sampler from measuring a heading line as if it were body
  text (see `src/editor/livePreview/widgets.ts`).
- Line-granularity cursor proximity as the reveal rule, and the distinction
  between selection *overlap* and mere adjacency
  (see `src/editor/livePreview/cursorReveal.ts`).
- Suppressing block-widget reveal while a mouse gesture is in progress, so a
  drag across a table does not swap its rows out mid-selection.
- Moving a fenced code block's rounded-corner treatment onto the first and
  last lines with visible content once the ``` fences are hidden
  (see `src/editor/livePreview/code.ts`).
- Splitting table rows by hand rather than through `getChildren('TableCell')`,
  because @lezer/markdown emits no node for an empty cell
  (see `src/editor/livePreview/tables.ts`).

### codemirror-rich-obsidian

- Source: https://github.com/Type-32/codemirror-rich-obsidian
- Copyright (c) 2026 Wilson Su ("Type-32")
- Licence: MIT

Consulted for its overall approach to reproducing Obsidian's Live Preview on
CodeMirror 6. Its Nuxt/Vue architecture was deliberately not adopted.

---

MIT License (applies to both projects above)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Runtime dependencies

Direct runtime dependencies and their licences:

| Package | Licence |
|---|---|
| react, react-dom | MIT |
| @codemirror/* , codemirror | MIT |
| @lezer/* | MIT |
| node-diff3 | MIT |

Google Identity Services is loaded at runtime from `accounts.google.com` and
is governed by Google's terms, not by this repository's licence.
