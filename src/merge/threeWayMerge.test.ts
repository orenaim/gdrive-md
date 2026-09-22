import { describe, expect, it } from 'vitest';
import {
  applyResolutions,
  countChangedLines,
  remoteRanges,
  splitLines,
  threeWayMerge,
} from './threeWayMerge';
import type { Resolution } from './mergeTypes';

const BASE = ['A', 'B', 'C'].join('\n');

describe('three-way merge', () => {
  it('1. local edit only — remote is unchanged, so local wins outright', () => {
    const local = ['A', 'B edited locally', 'C'].join('\n');
    const result = threeWayMerge(BASE, local, BASE);
    expect(result.clean).toBe(true);
    expect(result.proposedText).toBe(local);
  });

  it('2. remote edit only — local is unchanged, so remote is adopted', () => {
    const remote = ['A', 'B edited remotely', 'C'].join('\n');
    const result = threeWayMerge(BASE, BASE, remote);
    expect(result.clean).toBe(true);
    expect(result.proposedText).toBe(remote);
  });

  it('3. non-overlapping local and remote edits — both survive', () => {
    const local = ['A', 'B edited locally', 'C'].join('\n');
    const remote = ['A', 'B', 'C edited remotely'].join('\n');
    const result = threeWayMerge(BASE, local, remote);
    expect(result.clean).toBe(true);
    expect(result.proposedText).toBe(['A', 'B edited locally', 'C edited remotely'].join('\n'));
  });

  it('4. same-line conflict — reported, never silently resolved', () => {
    const local = ['A', 'B mine', 'C'].join('\n');
    const remote = ['A', 'B theirs', 'C'].join('\n');
    const result = threeWayMerge(BASE, local, remote);
    expect(result.clean).toBe(false);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].local).toEqual(['B mine']);
    expect(result.conflicts[0].remote).toEqual(['B theirs']);
    expect(result.conflicts[0].base).toEqual(['B']);
  });

  it('5. insertion versus insertion at the same point conflicts', () => {
    const local = ['A', 'mine', 'B', 'C'].join('\n');
    const remote = ['A', 'theirs', 'B', 'C'].join('\n');
    const result = threeWayMerge(BASE, local, remote);
    expect(result.clean).toBe(false);
    expect(result.conflicts).toHaveLength(1);
    // "Keep both" is the natural resolution here and must preserve order.
    const merged = applyResolutions(result, new Map([[0, { kind: 'both' } as Resolution]]));
    expect(merged).toBe(['A', 'mine', 'theirs', 'B', 'C'].join('\n'));
  });

  it('6. deletion versus edit of the same line conflicts', () => {
    const local = ['A', 'C'].join('\n'); // B deleted
    const remote = ['A', 'B revised', 'C'].join('\n');
    const result = threeWayMerge(BASE, local, remote);
    expect(result.clean).toBe(false);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].local).toEqual([]);
    expect(result.conflicts[0].remote).toEqual(['B revised']);
  });

  it('7. multiple independent conflict blocks are reported separately', () => {
    const base = ['one', 'two', 'three', 'four', 'five'].join('\n');
    const local = ['one MINE', 'two', 'three', 'four', 'five MINE'].join('\n');
    const remote = ['one THEIRS', 'two', 'three', 'four', 'five THEIRS'].join('\n');
    const result = threeWayMerge(base, local, remote);
    expect(result.conflicts).toHaveLength(2);

    const merged = applyResolutions(
      result,
      new Map<number, Resolution>([
        [0, { kind: 'local' }],
        [1, { kind: 'remote' }],
      ]),
    );
    expect(merged).toBe(['one MINE', 'two', 'three', 'four', 'five THEIRS'].join('\n'));
  });

  it('treats an identical edit on both sides as agreement, not conflict', () => {
    const same = ['A', 'B fixed', 'C'].join('\n');
    const result = threeWayMerge(BASE, same, same);
    expect(result.clean).toBe(true);
    expect(result.proposedText).toBe(same);
  });

  it('never emits git conflict markers', () => {
    const local = ['A', 'B mine', 'C'].join('\n');
    const remote = ['A', 'B theirs', 'C'].join('\n');
    const result = threeWayMerge(BASE, local, remote);
    const all = [result.proposedText, applyResolutions(result, new Map())].join('\n');
    expect(all).not.toContain('<<<<<<<');
    expect(all).not.toContain('=======');
    expect(all).not.toContain('>>>>>>>');
  });

  it('a custom resolution is used verbatim', () => {
    const local = ['A', 'B mine', 'C'].join('\n');
    const remote = ['A', 'B theirs', 'C'].join('\n');
    const result = threeWayMerge(BASE, local, remote);
    const merged = applyResolutions(
      result,
      new Map<number, Resolution>([[0, { kind: 'custom', text: 'B reconciled\nwith two lines' }]]),
    );
    expect(merged).toBe(['A', 'B reconciled', 'with two lines', 'C'].join('\n'));
  });
});

describe('line round-tripping', () => {
  it.each([
    'no trailing newline',
    'trailing newline\n',
    'two trailing newlines\n\n',
    '',
    '\n',
    'windows\r\nstyle\r\n',
  ])('splits and rejoins %j exactly', (text) => {
    expect(splitLines(text).join('\n')).toBe(text);
  });

  it('a clean merge preserves a trailing newline', () => {
    const base = 'A\nB\n';
    const local = 'A edited\nB\n';
    const remote = 'A\nB edited\n';
    const result = threeWayMerge(base, local, remote);
    expect(result.clean).toBe(true);
    expect(result.proposedText).toBe('A edited\nB edited\n');
    expect(result.proposedText.endsWith('\n')).toBe(true);
  });
});

describe('remoteRanges', () => {
  it('marks only the text the user has not seen before', () => {
    const local = ['A', 'B mine', 'C'].join('\n');
    const merged = ['A', 'B mine', 'C', 'D from drive'].join('\n');
    const ranges = remoteRanges(local, merged);
    expect(ranges).toHaveLength(1);
    expect(merged.slice(ranges[0].from, ranges[0].to)).toBe('D from drive');
  });

  it('returns nothing when the merge introduced no remote text', () => {
    const text = 'A\nB\nC';
    expect(remoteRanges(text, text)).toEqual([]);
  });
});

describe('countChangedLines', () => {
  it('counts lines touched by the remote edit', () => {
    expect(countChangedLines('A\nB\nC', 'A\nB\nC')).toBe(0);
    expect(countChangedLines('A\nB\nC', 'A\nB2\nC')).toBe(1);
    expect(countChangedLines('A\nB\nC', 'A\nB2\nC2\nD')).toBe(3);
  });
});

/**
 * Randomised checks on the hand-written region grouping.
 *
 * The grouping in `computeRegions` is this module's own code rather than
 * node-diff3's, so it gets exercised against properties that must hold for
 * every input, not just the hand-picked cases above.
 */
describe('merge properties (randomised)', () => {
  // A small deterministic PRNG, so a failure is reproducible from the seed.
  function rng(seed: number) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0x100000000;
    };
  }

  function mutate(lines: string[], random: () => number, tag: string): string[] {
    const out: string[] = [];
    for (const line of lines) {
      const roll = random();
      if (roll < 0.15) continue; // delete
      if (roll < 0.3) out.push(`${line} ${tag}`); // edit
      else if (roll < 0.4) {
        out.push(line);
        out.push(`inserted-${tag}`); // insert after
      } else out.push(line);
    }
    return out;
  }

  it('returns REMOTE verbatim when LOCAL made no change', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const random = rng(seed);
      const base = Array.from({ length: 12 }, (_, i) => `line ${i}`);
      const remote = mutate(base, random, 'R');
      const result = threeWayMerge(base.join('\n'), base.join('\n'), remote.join('\n'));
      expect(result.clean, `seed ${seed}`).toBe(true);
      expect(result.proposedText, `seed ${seed}`).toBe(remote.join('\n'));
    }
  });

  it('returns LOCAL verbatim when REMOTE made no change', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const random = rng(seed);
      const base = Array.from({ length: 12 }, (_, i) => `line ${i}`);
      const local = mutate(base, random, 'L');
      const result = threeWayMerge(base.join('\n'), local.join('\n'), base.join('\n'));
      expect(result.clean, `seed ${seed}`).toBe(true);
      expect(result.proposedText, `seed ${seed}`).toBe(local.join('\n'));
    }
  });

  it('never loses a line that both sides agree on and never invents one', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const random = rng(seed);
      const base = Array.from({ length: 14 }, (_, i) => `line ${i}`);
      const local = mutate(base, random, 'L');
      const remote = mutate(base, random, 'R');
      const result = threeWayMerge(base.join('\n'), local.join('\n'), remote.join('\n'));

      // Every line in the output must have come from one of the three inputs.
      const known = new Set([...base, ...local, ...remote]);
      for (const line of splitLines(result.proposedText)) {
        expect(known.has(line), `seed ${seed}: invented line ${JSON.stringify(line)}`).toBe(true);
      }
      // And the merge must never produce conflict markers, whatever happened.
      expect(result.proposedText).not.toContain('<<<<<<<');
    }
  });

  it('merges non-overlapping edits on adjacent lines without a conflict', () => {
    // The specific defect that made node-diff3 unusable here unmodified: it
    // groups *touching* hunks, so edits one line apart became one conflict.
    for (let gap = 1; gap <= 4; gap++) {
      const base = Array.from({ length: 10 }, (_, i) => `line ${i}`);
      const local = [...base];
      const remote = [...base];
      local[2] = 'line 2 MINE';
      remote[2 + gap] = `line ${2 + gap} THEIRS`;
      const result = threeWayMerge(base.join('\n'), local.join('\n'), remote.join('\n'));
      expect(result.clean, `gap ${gap}`).toBe(true);
      expect(result.proposedText).toContain('line 2 MINE');
      expect(result.proposedText).toContain('THEIRS');
    }
  });
});
