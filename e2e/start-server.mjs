import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mana-e2e-'));

function cleanupDataDir() {
  fs.rmSync(dataDir, { recursive: true, force: true });
}

process.on('exit', cleanupDataDir);
process.on('SIGINT', () => {
  cleanupDataDir();
  process.exit(130);
});
process.on('SIGTERM', () => {
  cleanupDataDir();
  process.exit(143);
});

Object.assign(process.env, {
  NODE_ENV: 'test',
  PORT: '3101',
  HOST: '127.0.0.1',
  CLIENT_URL: 'http://127.0.0.1:5174',
  DATA_DIR: dataDir,
  STATE_FILE: path.join(dataDir, 'state.json'),
  STATE_STORE_DISABLED: '0',
  ADMIN_LOGIN: 'e2e-admin',
  ADMIN_PASSWORD_SALT: 'e2e-admin-salt',
  ADMIN_PASSWORD_HASH: 'b2652096e842a8254b855002529bcabd8cf9b0a0bdd106b52363324828532bcd',
  ADMIN_LOGIN_MAX_ATTEMPTS: '50',
  ADMIN_LOGIN_WINDOW_MS: '1000',
  ROOM_PASSWORD_MAX_ATTEMPTS: '50',
  ROOM_PASSWORD_WINDOW_MS: '1000',
  GOOGLE_SHEETS_PUBLIC_CSV_URL: 'data:text/csv,Stage,A,B',
  BRACKET_FETCH_TIMEOUT_MS: '1000',
  BRACKET_CACHE_TTL_MS: '1'
});

await import('../server/server.js');
