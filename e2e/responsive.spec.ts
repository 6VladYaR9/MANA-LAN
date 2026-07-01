import { expect, test } from '@playwright/test';
import { enterNickname, expectNoConsoleErrors, watchConsole } from './helpers';

test('mobile viewport renders the core player surfaces without blank screens', async ({ page }) => {
  const errors = watchConsole(page);
  const runId = Date.now().toString(36);

  await enterNickname(page, `Mobile ${runId}`);
  await expect(page.getByTestId('hub-page')).toBeVisible();

  await page.goto('/bracket');
  await expect(page.getByTestId('bracket-page')).toBeVisible();
  await page.getByTestId('bracket-tab-playoff').click();
  await expect(page.getByTestId('playoff-board')).toBeVisible();

  await page.goto('/past');
  await expect(page.getByTestId('past-page')).toBeVisible();
  await expect(page.getByTestId('past-card').first()).toBeVisible();

  await expectNoConsoleErrors(errors);
});

test('past archive does not overflow at 320px width', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await enterNickname(page, 'Narrow Mobile');
  await page.goto('/past');
  await expect(page.getByTestId('past-page')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

