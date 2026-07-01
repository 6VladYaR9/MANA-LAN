import { expect, Page } from '@playwright/test';

export const ADMIN_LOGIN = 'e2e-admin';
export const ADMIN_PASSWORD = 'e2e-admin-password';

export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64'
);

export function watchConsole(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

export async function expectNoConsoleErrors(errors: string[]) {
  expect(errors).toEqual([]);
}

export async function enterNickname(page: Page, nickname: string) {
  await page.goto('/');
  const input = page.getByTestId('nickname-input');
  if (await input.isVisible().catch(() => false)) {
    await input.fill(nickname);
    await page.getByTestId('nickname-submit').click();
  }
  await expect(page.getByTestId('hub-page')).toBeVisible();
}

export async function loginAsAdmin(page: Page, nickname = 'E2E Admin') {
  await enterNickname(page, nickname);
  await page.goto('/admin');
  await page.getByTestId('admin-login-input').fill(ADMIN_LOGIN);
  await page.getByTestId('admin-password-input').fill(ADMIN_PASSWORD);
  await page.getByTestId('admin-login-submit').click();
  await expect(page.getByTestId('admin-panel')).toBeVisible();
}

export async function createRoomFromHub(
  page: Page,
  options: {
    teamA: string;
    teamB: string;
    password?: string;
    mode?: '1' | '2' | '5';
  }
) {
  await page.goto('/');
  await page.getByTestId(`mode-${options.mode || '1'}`).click();
  await page.getByTestId('create-room-button').click();
  await expect(page.getByTestId('create-room-modal')).toBeVisible();

  await page.getByTestId('create-team-a-input').fill(options.teamA);
  await page.getByTestId('create-team-b-input').fill(options.teamB);
  if (options.password) {
    await page.getByTestId('create-room-password-input').fill(options.password);
  }

  await Promise.all([
    page.waitForURL(/\/room\/[^/]+$/),
    page.getByTestId('create-room-submit').click()
  ]);

  return page.url().split('/room/')[1];
}

export async function openProtectedRoomFromHub(page: Page, roomId: string, password: string) {
  await page.goto('/');
  const card = page.locator(`[data-testid="room-card"][data-room-id="${roomId}"]`);
  await expect(card).toBeVisible();
  await card.getByTestId('room-card-open').click();

  await expect(page.getByTestId('room-password-modal')).toBeVisible();
  await page.getByTestId('room-password-input').fill('wrong-password');
  await page.getByTestId('room-password-submit').click();
  await expect(page.getByTestId('room-password-error')).toBeVisible();

  await page.getByTestId('room-password-input').fill(password);
  await Promise.all([
    page.waitForURL(new RegExp(`/room/${roomId}$`)),
    page.getByTestId('room-password-submit').click()
  ]);
  await expect(page.getByTestId('room-page')).toBeVisible();
}

export async function joinRoom(page: Page, team: 'A' | 'B', nickname: string) {
  await page.getByTestId('join-team-select').selectOption(team);
  await page.getByTestId('join-room-submit').click();
  await expect(page.locator(`[data-testid="player-slot"][data-player-name="${nickname}"]`)).toBeVisible();
}

export async function markReady(page: Page, nickname: string) {
  await page.getByTestId('ready-toggle').click();
  await expect(page.locator(`[data-testid="player-slot"][data-player-name="${nickname}"]`)).toHaveAttribute('data-ready', 'true');
}

async function clickFirstEnabledMap(pages: Page[]) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    for (const page of pages) {
      const enabledMap = page.locator('[data-testid="map-tile"]:not([disabled])').first();
      if (await enabledMap.count()) {
        try {
          await page.bringToFront();
          await enabledMap.click({ timeout: 2_000 });
          await page.waitForTimeout(250);
          return;
        } catch {
          // Veto turns can flip while both browser contexts receive socket updates.
          // Retry against the current captain instead of hanging on a stale tile.
        }
      }
    }
    await pages[0].waitForTimeout(250);
  }
  throw new Error('No enabled veto map appeared for either captain');
}

export async function playVetoToLive(pages: Page[]) {
  await expect(pages[0].getByTestId('veto-panel')).toBeVisible({ timeout: 15_000 });

  for (let step = 0; step < 7; step += 1) {
    if (await pages[0].getByTestId('match-control').isVisible().catch(() => false)) return;
    await clickFirstEnabledMap(pages);
  }

  await expect(pages[0].getByTestId('match-control')).toBeVisible({ timeout: 15_000 });
}
