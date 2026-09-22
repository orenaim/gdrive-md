import { describe, expect, it } from 'vitest';
import { parseDriveOpenState, readOpenStateFromUrl } from './openState';

const FILE_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';

function state(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ ids: [FILE_ID], action: 'open', userId: '1234567890', ...overrides });
}

describe('parseDriveOpenState', () => {
  it('accepts the shape Drive actually sends', () => {
    const result = parseDriveOpenState(state());
    expect(result).toEqual({ ok: true, state: { fileId: FILE_ID, userId: '1234567890' } });
  });

  it('picks up a resource key for the file being opened', () => {
    const result = parseDriveOpenState(
      state({ resourceKeys: { [FILE_ID]: 'abcDEF123', 'other-file': 'ignored' } }),
    );
    expect(result.ok && result.state.resourceKey).toBe('abcDEF123');
  });

  it('ignores a resource key that belongs to a different file', () => {
    const result = parseDriveOpenState(state({ resourceKeys: { 'some-other-id': 'xyz' } }));
    expect(result.ok && result.state.resourceKey).toBeUndefined();
  });

  it('refuses a Google Workspace document rather than exporting a copy', () => {
    const result = parseDriveOpenState(
      JSON.stringify({ exportIds: ['doc-id'], action: 'open', userId: '1' }),
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain('converted copy');
  });

  it('refuses the "create" action — creating files is Drive\'s job', () => {
    const result = parseDriveOpenState(state({ action: 'create' }));
    expect(result.ok).toBe(false);
  });

  // The state parameter is attacker-influenceable: it arrives in a URL that
  // anyone can construct and send to a signed-in user. Every one of these
  // must produce an error screen, never a Drive request.
  it.each([
    ['null', null],
    ['empty string', ''],
    ['not JSON', 'not json at all'],
    ['a JSON array', '[]'],
    ['a JSON string', '"hello"'],
    ['JSON null', 'null'],
    ['no ids', JSON.stringify({ action: 'open' })],
    ['empty ids', JSON.stringify({ ids: [], action: 'open' })],
    ['a non-string id', JSON.stringify({ ids: [42], action: 'open' })],
    ['a path-traversal id', JSON.stringify({ ids: ['../../etc/passwd'], action: 'open' })],
    ['an id with a slash', JSON.stringify({ ids: ['abc/def/ghi/jkl'], action: 'open' })],
    ['an id that is a URL', JSON.stringify({ ids: ['https://evil.example/x'], action: 'open' })],
    ['a too-short id', JSON.stringify({ ids: ['abc'], action: 'open' })],
    ['no action', JSON.stringify({ ids: [FILE_ID] })],
  ])('rejects %s', (_label, raw) => {
    const result = parseDriveOpenState(raw as string | null);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason.length).toBeGreaterThan(0);
  });

  it('drops a malformed userId rather than passing it to Google', () => {
    const result = parseDriveOpenState(state({ userId: 'not-a-number' }));
    expect(result.ok && result.state.userId).toBeUndefined();
  });

  it('drops a resource key containing unexpected characters', () => {
    // The key is interpolated into the X-Goog-Drive-Resource-Keys header, so
    // anything that could break out of `fileId/key` is refused.
    const result = parseDriveOpenState(state({ resourceKeys: { [FILE_ID]: 'bad/key,inject' } }));
    expect(result.ok && result.state.resourceKey).toBeUndefined();
  });
});

describe('readOpenStateFromUrl', () => {
  it('reads and decodes the state query parameter', () => {
    const url = `https://orenaim.github.io/gdrive-md/?state=${encodeURIComponent(state())}`;
    const result = readOpenStateFromUrl(url);
    expect(result.ok && result.state.fileId).toBe(FILE_ID);
  });

  it('fails cleanly when launched without a state parameter', () => {
    const result = readOpenStateFromUrl('https://orenaim.github.io/gdrive-md/');
    expect(result.ok).toBe(false);
  });
});
