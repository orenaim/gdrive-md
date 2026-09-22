import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentSession } from './DocumentSession';
import { MemoryDraftStore } from '../storage/draftStore';
import { MockDriveAdapter } from '../drive/mockDriveAdapter';
import { DriveError, type DriveAdapter } from '../drive/driveTypes';
import { assertInvariants } from './documentReducer';
import type { SessionState } from './sessionTypes';

const DEBOUNCE = 2_000;
const MAX_INTERVAL = 5_000;
const POLL = 3_000;

function makeSession(adapter: DriveAdapter, overrides: Partial<{ userId: string }> = {}) {
  const session = new DocumentSession({
    adapter,
    fileId: 'file-1',
    userId: overrides.userId ?? 'user-1',
    draftStore: new MemoryDraftStore(),
    autosaveDebounceMs: DEBOUNCE,
    autosaveMaxIntervalMs: MAX_INTERVAL,
    pollActiveMs: POLL,
    pollHiddenMs: 60_000,
    isHidden: () => false,
  });
  // Every state the session ever publishes must satisfy the documented
  // invariants — this is the real assertion behind most tests below.
  session.subscribe((state) => assertInvariants(state));
  return session;
}

/** Lets pending promise callbacks run without advancing the fake clock. */
async function settle(times = 6) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

/** Advances fake timers and lets the resulting async work complete. */
async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
  await settle();
}

describe('DocumentSession', () => {
  let adapter: MockDriveAdapter;
  let session: DocumentSession;

  beforeEach(() => {
    vi.useFakeTimers();
    adapter = new MockDriveAdapter();
    session = makeSession(adapter);
  });

  afterEach(() => {
    session.dispose();
    vi.useRealTimers();
  });

  async function loaded(): Promise<SessionState> {
    await session.load();
    await settle();
    return session.getState();
  }

  it('loads a file into CLEAN with base and local in agreement', async () => {
    const state = await loaded();
    expect(state.status).toBe('CLEAN');
    expect(state.fileName).toBe('company.md');
    expect(state.localText).toBe(state.baseText);
    expect(state.baseRevisionId).toBe('rev-1');
    expect(state.dirty).toBe(false);
  });

  it('marks DIRTY immediately on edit, then autosaves after the debounce', async () => {
    await loaded();
    session.edit('changed content');
    expect(session.getState().status).toBe('DIRTY');

    // Nothing should have gone to Drive yet.
    await advance(DEBOUNCE - 100);
    expect(window.__mockDrive!.getSaveCount()).toBe(0);

    await advance(200);
    expect(window.__mockDrive!.getSaveCount()).toBe(1);
    expect(session.getState().status).toBe('CLEAN');
    expect(window.__mockDrive!.getRemoteContent()).toBe('changed content');
  });

  it('persists during continuous typing via the max-save interval', async () => {
    await loaded();
    // Type every second — the debounce alone would never fire.
    for (let i = 0; i < 6; i++) {
      session.edit(`continuous ${i}`);
      await advance(1_000);
    }
    expect(window.__mockDrive!.getSaveCount()).toBeGreaterThanOrEqual(1);
  });

  it('8. stays DIRTY when the user types while a save is in flight', async () => {
    await loaded();
    window.__mockDrive!.setLatency(500);

    session.edit('version A');
    await advance(DEBOUNCE);
    // The upload is now in flight.
    expect(session.getState().status).toBe('SAVING');

    session.edit('version B');
    // Still saving A, but B is newer, so the document is not clean.
    await advance(1_000);

    const state = session.getState();
    expect(state.baseText).not.toBe('version B');
    expect(state.localText).toBe('version B');
    expect(state.dirty).toBe(true);
    expect(['DIRTY', 'SAVING']).toContain(state.status);

    // And B is eventually persisted on its own.
    await advance(DEBOUNCE + 1_000);
    expect(window.__mockDrive!.getRemoteContent()).toBe('version B');
    expect(session.getState().status).toBe('CLEAN');
  });

  it('9. aborts a save when the preflight finds a newer revision', async () => {
    const base = (await loaded()).baseText;
    const local = base + '\nA line I added locally.\n';
    const remote = base.replace('- Identity graph', '- Identity graph\n- Key rotation');
    session.edit(local);

    // A remote write lands in the gap between polls, so only the preflight
    // standing immediately before the upload can catch it.
    window.__mockDrive!.setRemoteContent(remote);
    const savesBefore = window.__mockDrive!.getSaveCount();

    await advance(DEBOUNCE);

    // Nothing was uploaded, and Drive still holds the other person's text.
    expect(window.__mockDrive!.getSaveCount()).toBe(savesBefore);
    expect(window.__mockDrive!.getRemoteContent()).toBe(remote);
    const state = session.getState();
    expect(state.status).toBe('REMOTE_CHANGED');
    expect(state.localText).toBe(local);
    // An aborted preflight is not a failure — there is nothing to show the
    // user but the merge offer.
    expect(state.error).toBeNull();
  });

  it('reports CONFLICTED up front when the two versions genuinely clash', async () => {
    const base = (await loaded()).baseText;
    session.edit(base.replace('Headwall provides', 'Headwall delivers'));
    window.__mockDrive!.setRemoteContent(base.replace('Headwall provides', 'Headwall offers'));

    await advance(POLL + 100);

    const state = session.getState();
    expect(state.status).toBe('CONFLICTED');
    expect(state.mergeAnalysis?.conflicts).toHaveLength(1);
  });

  it('10. detects a remote revision while the document is dirty and stops autosaving', async () => {
    await loaded();
    const base = session.getState().baseText;
    const local = base + '\nLocal work in progress.\n';
    session.edit(local);
    window.__mockDrive!.setRemoteContent(
      base.replace('## Roadmap', '## Roadmap\n\nRewritten remotely.'),
    );

    await advance(POLL + 100);

    const state = session.getState();
    expect(state.status).toBe('REMOTE_CHANGED');
    expect(state.remoteText).toContain('Rewritten remotely');
    // Local work is untouched.
    expect(state.localText).toBe(local);

    // And autosave really is suspended: further typing writes nothing.
    const saves = window.__mockDrive!.getSaveCount();
    session.edit(local + 'still typing');
    await advance(MAX_INTERVAL * 3);
    expect(window.__mockDrive!.getSaveCount()).toBe(saves);
    expect(session.getState().status).toBe('REMOTE_CHANGED');
  });

  it('detects a remote revision before any local edit and merges it in cleanly', async () => {
    await loaded();
    const remote = '# Company\n\nEntirely new remote content.\n';
    window.__mockDrive!.setRemoteContent(remote);

    await advance(POLL + 100);
    expect(session.getState().status).toBe('REMOTE_CHANGED');

    const result = session.mergeUpdate();
    expect(result.conflicts).toBe(false);
    const state = session.getState();
    // Case A: no local changes, so the merge is simply REMOTE.
    expect(state.localText).toBe(remote);
    expect(state.baseText).toBe(remote);
    expect(state.baseRevisionId).toBe('rev-2');
  });

  it('11. a resolved merge becomes the new base and is then saved', async () => {
    await loaded();
    const base = session.getState().baseText;

    // Non-overlapping edits: local changes the first paragraph, remote the list.
    const local = base.replace('end-to-end', 'end to end');
    const remote = base.replace('- Session brokering', '- Session brokering\n- Token vaulting');
    session.edit(local);
    window.__mockDrive!.setRemoteContent(remote);

    await advance(POLL + 100);
    expect(session.getState().status).toBe('REMOTE_CHANGED');

    const result = session.mergeUpdate();
    expect(result.conflicts).toBe(false);

    const merged = session.getState().localText;
    expect(merged).toContain('end to end'); // local edit survived
    expect(merged).toContain('Token vaulting'); // remote edit survived

    const state = session.getState();
    expect(state.baseText).toBe(remote); // the remote revision is the new base
    expect(state.baseRevisionId).toBe('rev-2');
    expect(state.dirty).toBe(true);

    // Autosave resumes and pushes the merged document.
    await advance(DEBOUNCE + 500);
    expect(window.__mockDrive!.getRemoteContent()).toBe(merged);
    expect(session.getState().status).toBe('CLEAN');
  });

  it('holds a conflicted merge for review and saves nothing until resolved', async () => {
    await loaded();
    const base = session.getState().baseText;
    session.edit(base.replace('Headwall provides', 'Headwall delivers'));
    window.__mockDrive!.setRemoteContent(base.replace('Headwall provides', 'Headwall offers'));

    await advance(POLL + 100);
    const state = session.getState();
    expect(state.status).toBe('CONFLICTED');
    expect(state.mergeAnalysis?.clean).toBe(false);

    const saves = window.__mockDrive!.getSaveCount();
    const result = session.mergeUpdate();
    expect(result.conflicts).toBe(true);
    expect(session.getState().status).toBe('MERGING');

    // Still nothing written while the review is open.
    await advance(MAX_INTERVAL * 3);
    expect(window.__mockDrive!.getSaveCount()).toBe(saves);

    // Resolving commits and resumes autosave.
    const resolved = base.replace('Headwall provides', 'Headwall delivers');
    session.applyMerge(resolved);
    expect(session.getState().status).toBe('DIRTY');
    await advance(DEBOUNCE + 500);
    expect(window.__mockDrive!.getRemoteContent()).toBe(resolved);
  });

  it('12. a failed Drive write leaves the document dirty and reports the error', async () => {
    await loaded();
    window.__mockDrive!.failNextSaves(1, 'network');
    session.edit('work that must not be lost');

    await advance(DEBOUNCE + 100);

    const state = session.getState();
    expect(state.dirty).toBe(true);
    expect(state.localText).toBe('work that must not be lost');
    expect(state.error?.message).toContain('Simulated');
    expect(state.error?.retryable).toBe(true);

    // Retrying succeeds and clears the error.
    await session.saveNow();
    await settle();
    expect(session.getState().status).toBe('CLEAN');
    expect(window.__mockDrive!.getRemoteContent()).toBe('work that must not be lost');
  });

  it('13. a read-only file never saves and never accepts edits', async () => {
    window.__mockDrive!.setCanEdit(false);
    const state = await loaded();
    expect(state.status).toBe('READ_ONLY');
    expect(state.readOnly).toBe(true);

    session.edit('an edit that should be refused');
    expect(session.getState().localText).toBe(state.baseText);
    expect(session.getState().status).toBe('READ_ONLY');

    await advance(MAX_INTERVAL * 3);
    expect(window.__mockDrive!.getSaveCount()).toBe(0);
  });

  it('adopts a new revision silently when the content is unchanged', async () => {
    const state = await loaded();
    // Drive advances the revision without the bytes changing — something it
    // genuinely does. This must not look like an external edit.
    window.__mockDrive!.setRemoteContent(state.baseText);

    await advance(POLL + 100);

    const after = session.getState();
    expect(after.status).toBe('CLEAN');
    expect(after.remoteText).toBeNull();
    expect(after.baseRevisionId).toBe('rev-2');
  });

  it('surfaces a load failure without pretending the document is editable', async () => {
    const failing: DriveAdapter = {
      openFile: async () => {
        throw new DriveError('permission', 'You do not have access to this file.');
      },
      getRevision: async () => {
        throw new Error('unused');
      },
      readFile: async () => {
        throw new Error('unused');
      },
      saveFile: async () => {
        throw new Error('unused');
      },
    };
    const failingSession = makeSession(failing);
    await failingSession.load();
    const state = failingSession.getState();
    expect(state.status).toBe('ERROR');
    expect(state.error?.message).toContain('do not have access');
    failingSession.dispose();
  });
});

describe('local draft recovery', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('offers an unsaved draft from a previous session without applying it', async () => {
    const adapter = new MockDriveAdapter();
    const store = new MemoryDraftStore();
    await store.save({
      key: 'user-1:file-1',
      fileId: 'file-1',
      userId: 'user-1',
      localText: 'unsaved work from the previous session',
      baseRevisionId: 'rev-1',
      savedAt: Date.now(),
    });

    const session = new DocumentSession({
      adapter,
      fileId: 'file-1',
      userId: 'user-1',
      draftStore: store,
      autosaveDebounceMs: DEBOUNCE,
      autosaveMaxIntervalMs: MAX_INTERVAL,
      pollActiveMs: POLL,
      pollHiddenMs: 60_000,
      isHidden: () => false,
    });

    await session.load();
    await settle();

    // Offered, not applied: the Drive content is what is showing.
    expect(session.getPendingDraft()?.localText).toBe('unsaved work from the previous session');
    expect(session.getState().localText).toContain('Headwall provides');
    expect(session.getState().status).toBe('CLEAN');

    session.recoverDraft();
    expect(session.getState().localText).toBe('unsaved work from the previous session');
    expect(session.getState().dirty).toBe(true);
    session.dispose();
  });

  it('does not offer a draft that matches what Drive already holds', async () => {
    const adapter = new MockDriveAdapter();
    const store = new MemoryDraftStore();
    const { text } = await adapter.openFile();
    await store.save({
      key: 'user-1:file-1',
      fileId: 'file-1',
      userId: 'user-1',
      localText: text,
      baseRevisionId: 'rev-1',
      savedAt: Date.now(),
    });

    const session = new DocumentSession({
      adapter,
      fileId: 'file-1',
      userId: 'user-1',
      draftStore: store,
      autosaveDebounceMs: DEBOUNCE,
      autosaveMaxIntervalMs: MAX_INTERVAL,
      pollActiveMs: POLL,
      pollHiddenMs: 60_000,
      isHidden: () => false,
    });
    await session.load();
    await settle();
    expect(session.getPendingDraft()).toBeNull();
    session.dispose();
  });
});
