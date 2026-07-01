import { expect, test } from '@playwright/test';
import { expectNoConsoleErrors, loginAsAdmin, watchConsole } from './helpers';

test('admin can create and edit a past tournament archive entry', async ({ page }) => {
  const errors = watchConsole(page);
  const runId = Date.now().toString(36);
  const title = `MANA ARCHIVE ${runId}`;
  const editedTitle = `MANA ARCHIVE EDITED ${runId}`;

  await loginAsAdmin(page, `Archive Admin ${runId}`);
  await page.goto('/past');
  await page.getByTestId('past-add-button').click();
  await expect(page.getByRole('dialog', { name: 'Добавить турнир' })).toBeVisible();

  await page.getByTestId('past-title-input').fill(title);
  await page.getByTestId('past-date-input').fill('2026-07-01');
  await page.getByTestId('past-description-input').fill(`Archive description ${runId}`);
  await page.getByTestId('past-place1-team-input').fill(`WINNERS ${runId}`);
  await page.getByTestId('past-submit').click();

  const createdCard = page.getByTestId('past-card').filter({ hasText: title }).first();
  await expect(createdCard).toBeVisible();

  await createdCard.getByTestId('past-edit').click();
  await expect(page.getByRole('dialog', { name: 'Редактировать турнир' })).toBeVisible();
  await page.getByTestId('past-title-input').fill(editedTitle);
  await page.getByTestId('past-place1-team-input').fill(`EDITED WINNERS ${runId}`);
  await page.getByTestId('past-submit').click();

  const editedCard = page.getByTestId('past-card').filter({ hasText: editedTitle }).first();
  await expect(editedCard).toBeVisible();
  await expect(page.getByTestId('past-card').filter({ hasText: title })).toHaveCount(0);

  await editedCard.getByTestId('past-card-link').click();
  await expect(page.getByTestId('tournament-detail-page')).toBeVisible();
  await expect(page.getByTestId('tournament-detail-title')).toContainText(editedTitle);
  await expect(page.locator('.podiumSection').getByText(`EDITED WINNERS ${runId}`)).toBeVisible();

  await expectNoConsoleErrors(errors);
});
