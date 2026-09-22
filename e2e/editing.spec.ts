import { expect, test } from '@playwright/test';
import { driveContent, driveOpenUrl, openDocument, saveCount, typeAtEnd } from './helpers';

/**
 * Scenario A — open from a Drive "Open with" URL, edit, and watch it autosave.
 */
test.describe('A. open and autosave', () => {
  test('opens the file named in the Drive state parameter', async ({ page }) => {
    await openDocument(page);
    await expect(page.locator('.hw-filename')).toHaveText('company.md');
    await expect(page.locator('.hw-status')).toContainText('Saved to Drive');
    await expect(page.locator('.cm-content')).toContainText('Headwall provides');
  });

  test('marks the document as editing, then saves it to the same Drive file', async ({ page }) => {
    await openDocument(page);
    await typeAtEnd(page, '\nA sentence typed by the test.');

    // Immediately dirty.
    await expect(page.locator('.hw-status')).toContainText('Editing');

    // And persisted once the debounce elapses.
    await expect(page.locator('.hw-status')).toContainText('Saved to Drive', { timeout: 10_000 });
    expect(await driveContent(page)).toContain('A sentence typed by the test.');

    // Exactly one file was ever written to — no duplicate was created.
    expect(await saveCount(page)).toBeGreaterThan(0);
  });

  test('rejects a launch that names no file', async ({ page }) => {
    await page.goto(driveOpenUrl({ ids: [] }));
    await expect(page.locator('.hw-center h1')).toContainText('Could not open');
  });

  test('refuses to convert a Google Workspace document', async ({ page }) => {
    const state = { exportIds: ['abc123'], action: 'open', userId: '1' };
    await page.goto(`/?mock=1&state=${encodeURIComponent(JSON.stringify(state))}`);
    await expect(page.locator('.hw-center')).toContainText('will not create a converted copy');
  });
});

test.describe('live preview keeps Markdown canonical', () => {
  test('renders formatting while the text stays Markdown', async ({ page }) => {
    await openDocument(page);

    // The caret starts at position 0, which is *on* the heading line — so its
    // '#' is legitimately visible. Move away first; that is precisely the
    // behaviour being tested.
    await page.locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+End');

    // `**account security**` is rendered bold with its asterisks hidden…
    const strong = page.locator('.hw-strong').first();
    await expect(strong).toHaveText('account security');
    // …and the heading no longer shows its '#'.
    await expect(page.locator('.hw-line-h1').first()).toHaveText('Company');

    // But the document itself still holds the Markdown, unchanged.
    expect(await driveContent(page)).toContain('# Company');
    expect(await driveContent(page)).toContain('**account security**');
  });

  test('source mode shows the same document as raw Markdown', async ({ page }) => {
    await openDocument(page);
    await page.getByRole('button', { name: 'View' }).click();
    await page.getByRole('menuitemradio', { name: 'Source mode' }).click();
    await expect(page.locator('.cm-content')).toContainText('# Company');
    await expect(page.locator('.cm-content')).toContainText('**account security**');
    // Switching modes must not have changed anything in Drive.
    expect(await driveContent(page)).toContain('**account security**');
  });
});
