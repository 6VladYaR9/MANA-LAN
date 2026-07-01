import { expect, test } from '@playwright/test';
import { enterNickname, loginAsAdmin } from './helpers';

test('admin route is reachable before nickname gate', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.getByTestId('admin-login-form')).toBeVisible();
  await expect(page.getByTestId('nickname-gate')).toHaveCount(0);
});

test('unknown route renders not found instead of redirecting home', async ({ page }) => {
  await enterNickname(page, 'Route Tester');
  await page.goto('/missing-route');
  await expect(page.getByTestId('not-found-page')).toBeVisible();
});

test('unknown archive id shows not found state', async ({ page }) => {
  await enterNickname(page, 'Archive Tester');
  await page.goto('/past/not-a-real-tournament');
  await expect(page.getByTestId('tournament-not-found-page')).toBeVisible();
});

test('dota placeholder hides floating chats', async ({ page }) => {
  await loginAsAdmin(page, 'Dota Admin');
  await page.goto('/dota');
  await expect(page.locator('.floatingChatButton')).toHaveCount(0);
});
