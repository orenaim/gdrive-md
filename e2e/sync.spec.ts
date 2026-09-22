import { expect, test } from '@playwright/test';
import {
  driveContent,
  editorText,
  openDocument,
  saveCount,
  setRemote,
  typeAtEnd,
} from './helpers';

/**
 * The document as Drive currently holds it.
 *
 * Read at runtime rather than duplicated as a literal here: the mock's
 * content is a fixture that changes as the editor grows features to
 * demonstrate, and a copy in this file silently goes stale, producing
 * "remote" edits that are really wholesale rewrites.
 */
async function currentBase(page: import('@playwright/test').Page): Promise<string> {
  return driveContent(page);
}

/**
 * Scenario B — a remote revision appears while the document is dirty.
 */
test.describe('B. external change while dirty', () => {
  test('stops autosaving, shows the banner, and leaves local text intact', async ({ page }) => {
    await openDocument(page);
    const base = await currentBase(page);
    await typeAtEnd(page, '\nLocal work in progress.');

    // A second editor changes a different part of the file.
    await setRemote(page, base.replace('- Identity graph', '- Identity graph\n- Key rotation'));

    const banner = page.locator('.hw-banner');
    await expect(banner).toContainText('updated elsewhere', { timeout: 10_000 });
    await expect(page.locator('.hw-status')).toContainText('Updated elsewhere');

    // The remote file was fetched (the banner reports what changed).
    await expect(banner).toContainText('line');

    // Local text survives untouched.
    await expect(page.locator('.cm-content')).toContainText('Local work in progress.');

    // Autosave really has stopped: further typing writes nothing.
    const before = await saveCount(page);
    await typeAtEnd(page, ' Still typing.');
    await page.waitForTimeout(8_000);
    expect(await saveCount(page)).toBe(before);
    expect(await driveContent(page)).not.toContain('Local work in progress.');
  });
});

/**
 * Scenario C — non-conflicting edits on both sides.
 */
test.describe('C. non-conflicting merge', () => {
  test('merges both edits and saves the result', async ({ page }) => {
    await openDocument(page);
    const base = await currentBase(page);

    // Local: append a paragraph at the end.
    await typeAtEnd(page, '\nWritten locally.');
    // Remote: add a bullet in the middle.
    await setRemote(page, base.replace('- Identity graph', '- Identity graph\n- Key rotation'));

    await expect(page.locator('.hw-banner')).toContainText('updated elsewhere', { timeout: 10_000 });
    await page.getByRole('button', { name: 'Merge update' }).click();

    // Both survive.
    const text = await editorText(page);
    expect(text).toContain('Written locally.');
    expect(text).toContain('Key rotation');

    await expect(page.locator('.hw-banner')).toContainText('External changes merged');
    // Remote-derived text is highlighted.
    expect(await page.locator('.hw-merge-remote-line').count()).toBeGreaterThan(0);

    // And the merged document is saved back to the same file.
    await expect(page.locator('.hw-status')).toContainText('Saved to Drive', { timeout: 10_000 });
    const drive = await driveContent(page);
    expect(drive).toContain('Written locally.');
    expect(drive).toContain('Key rotation');
  });
});

/**
 * Scenario D — both sides edit the same region.
 */
test.describe('D. conflict resolution', () => {
  async function createConflict(page: import('@playwright/test').Page) {
    await openDocument(page);
    const base = await currentBase(page);

    // Both sides edit the *same* line, which is what makes this a genuine
    // conflict rather than two independent changes the merge could reconcile
    // on its own.
    await page.locator('.cm-content').getByText('Session brokering').click();
    await page.keyboard.press('End');
    await page.keyboard.type(' MINE', { delay: 12 });

    await setRemote(page, base.replace('- Session brokering', '- Session brokering THEIRS'));
    await expect(page.locator('.hw-banner')).toContainText('updated elsewhere', { timeout: 10_000 });
  }

  test('opens a review, saves nothing until resolved, then applies the decision', async ({ page }) => {
    await createConflict(page);

    await expect(page.locator('.hw-banner')).toContainText('conflict');
    await expect(page.locator('.hw-status')).toContainText('conflict');

    const before = await saveCount(page);
    await page.getByRole('button', { name: 'Review conflicts' }).click();
    await expect(page.getByRole('dialog', { name: 'Resolve conflicts' })).toBeVisible();

    // Apply is disabled until every conflict has a decision.
    await expect(page.getByRole('button', { name: 'Apply merge' })).toBeDisabled();

    // Nothing has been written while the review is open.
    await page.waitForTimeout(6_000);
    expect(await saveCount(page)).toBe(before);

    await page.getByRole('button', { name: 'Keep both' }).first().click();
    const apply = page.getByRole('button', { name: 'Apply merge' });
    await expect(apply).toBeEnabled();
    await apply.click();

    const text = await editorText(page);
    expect(text).toContain('MINE');
    expect(text).toContain('THEIRS');
    expect(text).not.toContain('<<<<<<<');

    await expect(page.locator('.hw-status')).toContainText('Saved to Drive', { timeout: 10_000 });
    const drive = await driveContent(page);
    expect(drive).toContain('MINE');
    expect(drive).toContain('THEIRS');
    expect(drive).not.toContain('<<<<<<<');
  });
});

test.describe('read-only files', () => {
  test('are clearly marked and cannot be edited', async ({ page }) => {
    await page.goto('/?mock=1&readonly=1');
    await page.waitForSelector('.cm-content');
    await page.waitForFunction(() => window.__mockDrive !== undefined);

    await expect(page.locator('.hw-status')).toContainText('View only');

    const driveBefore = await driveContent(page);
    await typeAtEnd(page, 'this must not appear');

    // Note what is *not* asserted here: that the rendered text is unchanged.
    // Clicking to place the caret legitimately changes what is on screen,
    // because the construct under the caret reveals its Markdown markers —
    // that is live preview working, not an edit. What must hold is that the
    // document itself never took the input.
    await expect(page.locator('.cm-content')).not.toContainText('this must not appear');
    expect(await saveCount(page)).toBe(0);
    expect(await driveContent(page)).toBe(driveBefore);
    await expect(page.locator('.hw-status')).toContainText('View only');
  });
});
