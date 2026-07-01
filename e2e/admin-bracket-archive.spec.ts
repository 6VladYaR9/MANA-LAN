import { expect, test } from '@playwright/test';
import { expectNoConsoleErrors, loginAsAdmin, watchConsole } from './helpers';

test('admin can edit and reset the tournament bracket with persisted server sync', async ({ page }) => {
  const errors = watchConsole(page);
  const runId = Date.now().toString(36);
  const teamName = `E2E TEAM ${runId}`.toUpperCase();

  await loginAsAdmin(page);
  await page.goto('/bracket');
  await expect(page.getByTestId('bracket-page')).toBeVisible();

  await page.getByTestId('team-editor-yuz').locator('summary').click();
  await page.getByTestId('team-name-input-yuz-0').fill(teamName);
  await expect(page.getByTestId('bracket-sync-status')).toContainText('Saved to server');

  await page.reload();
  await page.getByTestId('team-editor-yuz').locator('summary').click();
  await expect(page.getByTestId('team-name-input-yuz-0')).toHaveValue(teamName);

  await page.getByTestId('bracket-reset').click();
  await expect(page.getByTestId('bracket-sync-status')).toContainText(/Reset|defaults|server/);
  await expect(page.getByTestId('team-name-input-yuz-0')).not.toHaveValue(teamName);

  await expectNoConsoleErrors(errors);
});

test('admin can create, open, and delete a past tournament card', async ({ page }) => {
  const errors = watchConsole(page);
  const runId = Date.now().toString(36);
  const title = `E2E CUP ${runId}`;

  await loginAsAdmin(page);
  await page.goto('/past');
  await expect(page.getByTestId('past-page')).toBeVisible();

  await page.getByTestId('past-add-button').click();
  await page.getByTestId('past-title-input').fill(title);
  await page.getByTestId('past-date-input').fill('2026-07-01');
  await page.getByTestId('past-description-input').fill(`Archive item ${runId}`);
  await page.getByTestId('past-submit').click();

  const card = page.getByTestId('past-card').filter({ hasText: title });
  await expect(card).toBeVisible();
  await card.getByTestId('past-card-link').click();
  await expect(page.getByTestId('tournament-detail-page')).toBeVisible();
  await expect(page.getByTestId('tournament-detail-title')).toContainText(title);

  await page.goto('/past');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByTestId('past-card').filter({ hasText: title }).getByTestId('past-delete').click();
  await expect(page.getByTestId('past-card').filter({ hasText: title })).toHaveCount(0);

  await expectNoConsoleErrors(errors);
});

test('maintenance mode blocks players and admin logout revokes the panel', async ({ browser, page }) => {
  const adminErrors = watchConsole(page);
  await loginAsAdmin(page);
  await page.goto('/admin');
  await page.getByTestId('maintenance-toggle').click();

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  const guestErrors = watchConsole(guest);
  await guest.goto('/');
  await guest.getByTestId('nickname-input').fill('Blocked Player');
  await guest.getByTestId('nickname-submit').click();
  await expect(guest.getByTestId('technical-mode')).toBeVisible();

  await page.getByTestId('maintenance-toggle').click();
  await guest.reload();
  await expect(guest.getByTestId('hub-page')).toBeVisible();

  await page.getByTestId('admin-logout').click();
  await expect(page.getByTestId('admin-login-form')).toBeVisible();

  await guestContext.close();
  await expectNoConsoleErrors(adminErrors);
  await expectNoConsoleErrors(guestErrors);
});

