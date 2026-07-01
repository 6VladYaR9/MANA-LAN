import { expect, test } from '@playwright/test';
import {
  createRoomFromHub,
  enterNickname,
  loginAsAdmin,
  watchConsole,
  expectNoConsoleErrors
} from './helpers';

test('protected room direct link requires password and opens after valid password', async ({ browser, page }) => {
  const errors = watchConsole(page);
  const runId = Date.now().toString(36);
  const password = `direct-${runId}`;

  await loginAsAdmin(page, `Admin ${runId}`);
  const roomId = await createRoomFromHub(page, {
    teamA: `ALPHA ${runId}`,
    teamB: `BRAVO ${runId}`,
    password,
    mode: '1'
  });

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  const guestErrors = watchConsole(guest);
  await enterNickname(guest, `Guest ${runId}`);
  await guest.goto(`/room/${roomId}`);
  await expect(guest.getByTestId('room-password-page')).toBeVisible();

  await guest.getByTestId('direct-room-password-input').fill('wrong');
  await guest.getByTestId('direct-room-password-submit').click();
  await expect(guest.locator('.errorBox')).toBeVisible();

  await guest.getByTestId('direct-room-password-input').fill(password);
  await guest.getByTestId('direct-room-password-submit').click();
  await expect(guest.getByTestId('room-page')).toBeVisible();

  await guestContext.close();
  await expectNoConsoleErrors(errors);
  await expectNoConsoleErrors(guestErrors);
});
