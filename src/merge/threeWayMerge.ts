import { diffIndices } from 'node-diff3';
import type { MergeAnalysis, MergeConflict, MergeHunk, RemoteRange, Resolution } from './mergeTypes';

/**
 * Line splitting that round-trips exactly.
 *
 * `split('\n')` / `join('\n')` is lossless for any string, including one with
 * a trailing newline (`"a\n"` becomes `["a", ""]` and back). That exactness
 * matters: a merge must not be able to add or remove a trailing newline, since
 * that is a real change to the file and would show up in git.
 */
export function splitLines(text: string): string[] {
  return text.split('\n');
}

export function joinLines(lines: string[]): string {
  return lines.join('\n');
}

/**
 * One side's edit to a region of BASE, in BASE's coordinates.
 *
 * `oStart`/`oLength` say which BASE lines the edit replaces (a length of zero
 * is a pure insertion at that boundary); `abStart`/`abLength` say what it
 * replaces them with, in that side's own buffer.
 */
interface Hunk {
  side: 'a' | 'b';
  oStart: number;
  oLength: number;
  abStart: number;
  abLength: number;
}

type Region =
  | { stable: true; lines: string[] }
  | { stable: false; a: string[]; o: string[]; b: string[] };

/**
 * Whether `next` genuinely collides with a region already spanning
 * [regionStart, regionEnd) of BASE.
 *
 * This is the one piece of diff3 this module implements itself rather than
 * taking from node-diff3, and the reason is worth recording. node-diff3's own
 * `diff3MergeRegions` groups a hunk into the current region when
 * `nextStart <= regionEnd` — that is, when the two merely *touch*. So a local
 * edit to line 2 and a remote edit to line 3 are reported as a single
 * conflict, even though they do not overlap at all. Adjacent-but-independent
 * edits are the single most common way two people change one document, so
 * that grouping would put a conflict dialog in front of the user on almost
 * every merge.
 *
 * Strict overlap (`<`) is the correct test, with one exception: two pure
 * insertions at the *same* boundary really do conflict, because there is no
 * way to tell whose lines should come first. That is the second clause.
 */
function collides(regionStart: number, regionEnd: number, next: Hunk): boolean {
  if (next.oStart < regionEnd) return true;
  return next.oStart === regionEnd && next.oLength === 0 && regionStart === regionEnd;
}

function computeRegions(a: string[], o: string[], b: string[]): Region[] {
  const hunks: Hunk[] = [];
  for (const item of diffIndices(o, a)) {
    hunks.push({
      side: 'a',
      oStart: item.buffer1[0],
      oLength: item.buffer1[1],
      abStart: item.buffer2[0],
      abLength: item.buffer2[1],
    });
  }
  for (const item of diffIndices(o, b)) {
    hunks.push({
      side: 'b',
      oStart: item.buffer1[0],
      oLength: item.buffer1[1],
      abStart: item.buffer2[0],
      abLength: item.buffer2[1],
    });
  }
  hunks.sort((x, y) => x.oStart - y.oStart || x.oLength - y.oLength);

  const regions: Region[] = [];
  let cursor = 0;

  const emitUnchanged = (until: number) => {
    if (until > cursor) regions.push({ stable: true, lines: o.slice(cursor, until) });
    cursor = until;
  };

  const queue = [...hunks];
  while (queue.length > 0) {
    const first = queue.shift()!;
    let regionStart = first.oStart;
    let regionEnd = first.oStart + first.oLength;
    const group = [first];

    emitUnchanged(regionStart);

    while (queue.length > 0 && collides(regionStart, regionEnd, queue[0])) {
      const next = queue.shift()!;
      regionEnd = Math.max(regionEnd, next.oStart + next.oLength);
      group.push(next);
    }

    const sides = new Set(group.map((h) => h.side));
    if (sides.size === 1) {
      // Only one side touched this region, so there is nothing to decide:
      // that side's text simply wins.
      const buffer = first.side === 'a' ? a : b;
      const start = Math.min(...group.map((h) => h.abStart));
      const end = Math.max(...group.map((h) => h.abStart + h.abLength));
      if (end > start) regions.push({ stable: true, lines: buffer.slice(start, end) });
      cursor = regionEnd;
      continue;
    }

    // Both sides changed this region. Widen each side's span to cover all of
    // its hunks, then correct for the skew between where the region begins in
    // BASE and where that side's first hunk begins.
    const bounds = {
      a: { abMin: a.length, abMax: -1, oMin: o.length, oMax: -1 },
      b: { abMin: b.length, abMax: -1, oMin: o.length, oMax: -1 },
    };
    for (const hunk of group) {
      const bound = bounds[hunk.side];
      bound.abMin = Math.min(bound.abMin, hunk.abStart);
      bound.abMax = Math.max(bound.abMax, hunk.abStart + hunk.abLength);
      bound.oMin = Math.min(bound.oMin, hunk.oStart);
      bound.oMax = Math.max(bound.oMax, hunk.oStart + hunk.oLength);
    }
    const aStart = bounds.a.abMin + (regionStart - bounds.a.oMin);
    const aEnd = bounds.a.abMax + (regionEnd - bounds.a.oMax);
    const bStart = bounds.b.abMin + (regionStart - bounds.b.oMin);
    const bEnd = bounds.b.abMax + (regionEnd - bounds.b.oMax);

    regions.push({
      stable: false,
      a: a.slice(aStart, aEnd),
      o: o.slice(regionStart, regionEnd),
      b: b.slice(bStart, bEnd),
    });
    cursor = regionEnd;
  }

  emitUnchanged(o.length);
  return regions;
}

/**
 * A three-way merge of BASE, LOCAL and REMOTE.
 *
 * The point of doing this three-way rather than diffing LOCAL against REMOTE
 * is that BASE is what distinguishes "I changed this" from "they changed this"
 * from "we both changed this". A two-way diff cannot tell those apart, so it
 * must either ask about every difference or silently pick a side — and
 * silently picking a side is how edits get lost.
 */
export function threeWayMerge(base: string, local: string, remote: string): MergeAnalysis {
  const a = splitLines(local);
  const o = splitLines(base);
  const b = splitLines(remote);

  const hunks: MergeHunk[] = [];
  const conflicts: MergeConflict[] = [];

  for (const region of computeRegions(a, o, b)) {
    if (region.stable) {
      if (region.lines.length > 0) hunks.push({ kind: 'stable', lines: region.lines });
      continue;
    }
    // Both sides making the *same* edit is agreement, not a conflict — someone
    // applied the identical fix in two places.
    if (sameLines(region.a, region.b)) {
      hunks.push({ kind: 'stable', lines: region.a });
      continue;
    }
    // One side turning out not to have changed after all (the widened span
    // happens to equal BASE) means the other side simply wins.
    if (sameLines(region.a, region.o)) {
      hunks.push({ kind: 'stable', lines: region.b });
      continue;
    }
    if (sameLines(region.b, region.o)) {
      hunks.push({ kind: 'stable', lines: region.a });
      continue;
    }
    const conflict: MergeConflict = {
      id: conflicts.length,
      local: region.a,
      base: region.o,
      remote: region.b,
    };
    conflicts.push(conflict);
    hunks.push({ kind: 'conflict', conflict });
  }

  const clean = conflicts.length === 0;
  // Conflicts default to the local side in the proposal, so `proposedText` is
  // always a document the user could keep working in. It is only ever *shown*
  // in the clean case; the conflicted case goes to the review UI first.
  const proposedText = renderHunks(hunks, () => ({ kind: 'local' }));

  return { hunks, conflicts, clean, proposedText };
}

function sameLines(x: string[], y: string[]): boolean {
  return x.length === y.length && x.every((line, i) => line === y[i]);
}

/** Builds the merged text, settling each conflict with `resolve`. */
export function renderHunks(
  hunks: MergeHunk[],
  resolve: (conflict: MergeConflict) => Resolution,
): string {
  const lines: string[] = [];
  for (const hunk of hunks) {
    if (hunk.kind === 'stable') {
      lines.push(...hunk.lines);
      continue;
    }
    lines.push(...resolveLines(hunk.conflict, resolve(hunk.conflict)));
  }
  return joinLines(lines);
}

export function resolveLines(conflict: MergeConflict, resolution: Resolution): string[] {
  switch (resolution.kind) {
    case 'local':
      return conflict.local;
    case 'remote':
      return conflict.remote;
    case 'both':
      return [...conflict.local, ...conflict.remote];
    case 'custom':
      return splitLines(resolution.text);
  }
}

/**
 * Applies a full set of decisions, one per conflict, by conflict id.
 *
 * Missing decisions fall back to the local side rather than throwing: the
 * caller (the review UI) guarantees completeness, and defaulting to "keep the
 * user's own text" is the safe failure mode if it ever does not.
 */
export function applyResolutions(
  analysis: MergeAnalysis,
  resolutions: ReadonlyMap<number, Resolution>,
): string {
  return renderHunks(analysis.hunks, (c) => resolutions.get(c.id) ?? { kind: 'local' });
}

/**
 * The ranges of `merged` that are not present in `local` — i.e. the text the
 * user is seeing for the first time because it arrived from Drive.
 *
 * Returned as character offsets into `merged`, ready to hand to the editor's
 * highlight decorations. Computed by diffing rather than tracked through the
 * merge because the merge works in lines while the editor works in characters,
 * and re-deriving is both simpler and robust to how conflicts were resolved.
 */
export function remoteRanges(local: string, merged: string): RemoteRange[] {
  const localLines = splitLines(local);
  const mergedLines = splitLines(merged);

  // Character offset of the start of each line in `merged`.
  const lineStarts: number[] = [];
  let offset = 0;
  for (const line of mergedLines) {
    lineStarts.push(offset);
    offset += line.length + 1; // +1 for the '\n' that follows
  }

  const ranges: RemoteRange[] = [];
  for (const chunk of diffIndices(localLines, mergedLines)) {
    const [start, length] = chunk.buffer2;
    if (length <= 0) continue;
    const from = lineStarts[start] ?? merged.length;
    const lastLine = Math.min(start + length - 1, mergedLines.length - 1);
    const to = Math.min((lineStarts[lastLine] ?? 0) + mergedLines[lastLine].length, merged.length);
    if (to > from) ranges.push({ from, to });
  }
  return ranges;
}

/**
 * A human-readable count of what changed remotely, for the banner.
 *
 * Counts *lines touched* rather than hunks, because "12 lines changed" is the
 * unit people think in when deciding whether to look at an update now.
 */
export function countChangedLines(base: string, remote: string): number {
  const baseLines = splitLines(base);
  const remoteLines = splitLines(remote);
  let changed = 0;
  for (const chunk of diffIndices(baseLines, remoteLines)) {
    changed += Math.max(chunk.buffer1[1], chunk.buffer2[1]);
  }
  return changed;
}
