import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { StateEffect, StateField, type EditorState, type Range } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import { blockCursorTouchesRange } from './cursorReveal';
import type { RuleSet } from './types';

export type ColumnAlign = 'left' | 'center' | 'right' | null;

export interface TableModel {
  rows: string[][];
  headerRowCount: number;
  align: ColumnAlign[];
}

/**
 * Splits one table row into cell texts.
 *
 * Done by hand rather than through `getChildren('TableCell')` because
 * @lezer/markdown emits no node at all for an empty cell — the middle column
 * of `| a | | c |` simply is not in the tree — so reading cells through the
 * parser silently drops them and shifts every later column left.
 */
export function splitRow(text: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let escaped = false;
  for (const ch of text) {
    if (ch === '|' && !escaped) {
      cells.push(cell);
      cell = '';
      escaped = false;
      continue;
    }
    cell += ch;
    escaped = !escaped && ch === '\\';
  }
  cells.push(cell);
  // A leading or trailing pipe produces a bounding empty segment, not a column.
  if (cells.length > 1 && cells[0].trim() === '') cells.shift();
  if (cells.length > 1 && cells[cells.length - 1].trim() === '') cells.pop();
  return cells.map((c) => c.trim());
}

function parseAlign(spec: string): ColumnAlign {
  const s = spec.trim();
  const left = s.startsWith(':');
  const right = s.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return null;
}

export function readTableModel(state: EditorState, node: SyntaxNode): TableModel {
  const rows: string[][] = [];
  let align: ColumnAlign[] = [];
  let headerRowCount = 0;

  for (let child = node.firstChild; child; child = child.nextSibling) {
    const text = state.sliceDoc(child.from, child.to);
    if (child.name === 'TableHeader') {
      rows.push(splitRow(text));
      headerRowCount = 1;
    } else if (child.name === 'TableRow') {
      rows.push(splitRow(text));
    } else if (child.name === 'TableDelimiter' && text.trim().length > 1) {
      // The delimiter *row* sits directly under Table as the one multi-character
      // TableDelimiter child; the single "|" separators inside header and data
      // rows are nested under those rows instead.
      align = splitRow(text).map(parseAlign);
    }
  }
  return { rows, headerRowCount, align };
}

/**
 * Renders a table model as real table markup.
 *
 * Cell text is inserted as plain text, deliberately: a cell containing
 * `**bold**` shows its asterisks here rather than being re-parsed. Rendering
 * inline Markdown inside cells would mean the cell's displayed text no longer
 * matches its source, and clicking into it to edit would be jarring. V0 keeps
 * the table structural and leaves inline formatting to the revealed source.
 */
export function renderTableElement(model: TableModel): HTMLElement {
  const table = document.createElement('table');
  table.className = 'hw-table';
  model.rows.forEach((cells, rowIndex) => {
    const tr = document.createElement('tr');
    cells.forEach((text, colIndex) => {
      const cell = document.createElement(rowIndex < model.headerRowCount ? 'th' : 'td');
      const align = model.align[colIndex];
      if (align) cell.style.textAlign = align;
      cell.className = 'hw-table-cell';
      cell.textContent = text;
      tr.appendChild(cell);
    });
    table.appendChild(tr);
  });
  return table;
}

class TableWidget extends WidgetType {
  constructor(private readonly markdown: string, private readonly model: TableModel) {
    super();
  }
  eq(other: TableWidget): boolean {
    return other.markdown === this.markdown;
  }
  toDOM(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'hw-table-wrap';
    wrap.appendChild(renderTableElement(this.model));
    return wrap;
  }
  /**
   * Let clicks through so the caret can land on the table's line, which is
   * what reveals the pipe source for editing. V0 edits tables as Markdown;
   * clicking a cell is how you get to it.
   */
  ignoreEvent(): boolean {
    return false;
  }
}

/**
 * Forces the block-decoration field to recompute.
 *
 * Needed because a mouse release changes what `blockCursorTouchesRange`
 * answers without changing any editor state, so no transaction would otherwise
 * be dispatched and a table the caret was dragged into would stay rendered.
 */
export const refreshBlockDecorations = StateEffect.define<null>();

function isLineAligned(state: EditorState, from: number, to: number): boolean {
  return from === state.doc.lineAt(from).from && to === state.doc.lineAt(to).to;
}

function buildTableDecorations(state: EditorState): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'Table') return;
      if (blockCursorTouchesRange(state, node.from, node.to)) return false;
      // A block decoration must cover whole lines exactly. A table indented
      // under a list item does not, and forcing it would swallow the list
      // marker, so such a table simply keeps showing its source.
      if (!isLineAligned(state, node.from, node.to)) return false;
      const markdown = state.sliceDoc(node.from, node.to);
      const model = readTableModel(state, node.node);
      decorations.push(
        Decoration.replace({
          widget: new TableWidget(markdown, model),
          block: true,
        }).range(node.from, node.to),
      );
      return false;
    },
  });
  return Decoration.set(decorations, true);
}

/**
 * Block-level table rendering.
 *
 * This has to be a StateField rather than part of the main view plugin:
 * CodeMirror refuses decorations that replace line breaks when they come from
 * a plugin, because a plugin cannot participate in the height measurement that
 * such a decoration invalidates.
 */
export const tableField = StateField.define<DecorationSet>({
  create: buildTableDecorations,
  update(value, tr) {
    const forced = tr.effects.some((e) => e.is(refreshBlockDecorations));
    if (!tr.docChanged && !tr.selection && !forced) return value;
    return buildTableDecorations(tr.state);
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * The view-plugin half: when the table is *not* being rendered as a widget,
 * tint its raw pipe source so it still reads as a table.
 *
 * The condition must match `buildTableDecorations` exactly. If the two
 * disagree, either the widget is dropped or the source is styled underneath it.
 */
export const tableRules: RuleSet = {
  Table: (node, ctx) => {
    const rendered =
      !ctx.blockRevealed(node.from, node.to) && isLineAligned(ctx.state, node.from, node.to);
    if (rendered) return false;
    ctx.add(Decoration.mark({ class: 'hw-table-source' }).range(node.from, node.to));
    return false;
  },
};
