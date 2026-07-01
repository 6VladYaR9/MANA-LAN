import { expect, test } from '@playwright/test';
import {
  createRoomFromHub,
  enterNickname,
  expectNoConsoleErrors,
  joinRoom,
  loginAsAdmin,
  markReady,
  openProtectedRoomFromHub,
  playVetoToLive,
  TINY_PNG,
  watchConsole
} from './helpers';

test('protected match can be created, joined, played through veto, screenshotted, and finished', async ({ browser, page }) => {
  const adminErrors = watchConsole(page);
  const runId = Date.now().toString(36);
  const adminNick = `Admin ${runId}`;
  const guestNick = `Guest ${runId}`;
  const teamA = `ALPHA ${runId}`;
  const teamB = `BRAVO ${runId}`;
  const password = `pass-${runId}`;

  await loginAsAdmin(page, adminNick);
  const roomId = await createRoomFromHub(page, { teamA, teamB, password, mode: '1' });
  await expect(page.getByTestId('room-title')).toContainText(teamA);
  await expect(page.getByTestId('room-title')).toContainText(teamB);

  await joinRoom(page, 'A', adminNick);

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  const guestErrors = watchConsole(guest);
  await enterNickname(guest, guestNick);
  await openProtectedRoomFromHub(guest, roomId, password);
  await joinRoom(guest, 'B', guestNick);

  await page.getByTestId('room-chat-toggle').click();
  await page.getByTestId('room-chat-input').fill(`hello-${runId}`);
  await page.getByTestId('room-chat-submit').click();
  await expect(page.getByTestId('room-chat-message').filter({ hasText: `hello-${runId}` })).toBeVisible();
  await page.getByTestId('room-chat-toggle').click();

  await markReady(page, adminNick);
  await markReady(guest, guestNick);
  await playVetoToLive([page, guest]);

  await page.getByTestId('result-screenshot-input').setInputFiles({
    name: 'result.png',
    mimeType: 'image/png',
    buffer: TINY_PNG
  });
  await expect(page.getByTestId('result-screenshot-item')).toHaveCount(1);

  await page.getByTestId('finish-team-a').click();
  await expect(page.getByTestId('winner-name')).toContainText(teamA);
  await page.setViewportSize({ width: 393, height: 851 });
  await expect(page.getByTestId('match-control')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await guestContext.close();
  await expectNoConsoleErrors(adminErrors);
  await expectNoConsoleErrors(guestErrors);
});
