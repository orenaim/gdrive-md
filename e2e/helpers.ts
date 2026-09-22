import type { Page } from '@playwright/test';

/** Mirrors the control surface the mock Drive adapter puts on `window`. */
export interface MockDrive {
  setRemoteContent(text: string): void;
  getRemoteContent(): string;
  getRevisionId(): string;
  setCanEdit(canEdit: boolean): void;
  failNextSaves(count: number, kind?: 'network' | 'permission'): void;
  setLatency(ms: number): void;
  getSaveCount(): number;
}

declare global {
  interface Window {
    __mockDrive?: MockDrive;
  }
}

/**
 * The URL Drive would send a user to.
 *
 * Built exactly as Drive builds it — a URL-encoded JSON `state` — so the test
 * exercises the real launch parsing rather than a back door into the app.
 */
export function driveOpenUrl(
  overrides: Partial<{ ids: string[]; action: string; userId: string; resourceKeys: Record<string, string> }> = {},
): string {
  const state = {
    ids: ['1AbCdEfGhIjKlMnOpQrStUvWxYz012345'],
    action: 'open',
    userId: '1234567890',
    ...overrides,
  };
  return `/?mock=1&state=${encodeURIComponent(JSON.stringify(state))}`;
}

export async function openDocument(page: Page, url = driveOpenUrl()): Promise<void> {
  await page.goto(url);
  await page.waitForSelector('.cm-content');
  // The mock resolves immediately, but the first paint can precede the load.
  await page.waitForFunction(() => window.__mockDrive !== undefined);
}

/** Types at the very end of the document. */
export async function typeAtEnd(page: Page, text: string): Promise<void> {
  const content = page.locator('.cm-content');
  await content.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(text, { delay: 12 });
}

export function driveContent(page: Page): Promise<string> {
  return page.evaluate(() => window.__mockDrive!.getRemoteContent());
}

export function saveCount(page: Page): Promise<number> {
  return page.evaluate(() => window.__mockDrive!.getSaveCount());
}

export function setRemote(page: Page, text: string): Promise<void> {
  return page.evaluate((value) => window.__mockDrive!.setRemoteContent(value), text);
}

/** The Markdown currently in the editor — the canonical document. */
export function editorText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const lines = Array.from(document.querySelectorAll('.cm-line'));
    return lines.map((line) => (line.textContent === '​' ? '' : line.textContent)).join('\n');
  });
}
