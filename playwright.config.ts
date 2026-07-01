import { defineConfig, devices } from '@playwright/test';

const clientPort = 5174;
const serverPort = 3101;
const clientUrl = `http://127.0.0.1:${clientPort}`;
const serverUrl = `http://127.0.0.1:${serverPort}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: {
    timeout: 10_000
  },
  reporter: [['list']],
  use: {
    baseURL: clientUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  webServer: [
    {
      command: 'node e2e/start-server.mjs',
      url: `${serverUrl}/api/health`,
      timeout: 60_000,
      reuseExistingServer: false
    },
    {
      command: `npm run dev --prefix client -- --host 127.0.0.1 --port ${clientPort} --strictPort`,
      url: clientUrl,
      env: {
        VITE_SOCKET_URL: serverUrl,
        VITE_API_URL: serverUrl
      },
      timeout: 60_000,
      reuseExistingServer: false
    }
  ],
  projects: [
    {
      name: 'chromium',
      testIgnore: /responsive\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'mobile-chromium',
      testMatch: /responsive\.spec\.ts/,
      use: { ...devices['Pixel 5'] }
    }
  ]
});

