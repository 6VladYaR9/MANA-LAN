const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const test = require('node:test');
const { io: createClient } = require('socket.io-client');

const SERVER_DIR = path.join(__dirname, '..');
const ADMIN_LOGIN = 'admin';
const ADMIN_PASSWORD = 'manakirov2026';
const IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
const NON_DEFAULT_HASH = '4d282762df5aa7198ed7ef2283a4a3a836199b345ccf64211e0f2d441486079c';

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

function productionEnv(port, overrides = {}) {
  return {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(port),
    HOST: '127.0.0.1',
    CLIENT_URL: 'https://manalan.ru',
    ADMIN_LOGIN: 'secure-admin',
    ADMIN_PASSWORD_SALT: 'secure-salt',
    ADMIN_PASSWORD_HASH: NON_DEFAULT_HASH,
    ...overrides
  };
}

async function runServerExpectExit(env) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: SERVER_DIR,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  const exitCode = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill();
      resolve(null);
    }, 1500);
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  return { exitCode, output };
}

async function waitForHealth(url, child) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < 5000) {
    if (child.exitCode !== null) {
      throw new Error(`server exited early with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw lastError || new Error('server did not become healthy');
}

async function startServer(extraEnv = {}) {
  const port = await freePort();
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(port),
    HOST: '127.0.0.1',
    CLIENT_URL: `http://127.0.0.1:${port}`,
    ...extraEnv
  };
  const child = spawn(process.execPath, ['server.js'], {
    cwd: SERVER_DIR,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const output = [];
  child.stdout.on('data', (chunk) => output.push(chunk.toString()));
  child.stderr.on('data', (chunk) => output.push(chunk.toString()));
  const url = `http://127.0.0.1:${port}`;
  await waitForHealth(url, child);
  return {
    url,
    output,
    stop: async () => {
      if (child.exitCode === null) child.kill();
      await new Promise((resolve) => child.once('exit', resolve));
    }
  };
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = createClient(url, {
      forceNew: true,
      reconnection: false,
      transports: ['websocket']
    });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

function emit(socket, event, payload = {}) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

async function adminLogin(socket) {
  const response = await emit(socket, 'admin:login', { login: ADMIN_LOGIN, password: ADMIN_PASSWORD });
  assert.equal(response.ok, true);
  return response.token;
}

async function createRoom(socket, adminToken, overrides = {}) {
  const response = await emit(socket, 'rooms:create', {
    adminToken,
    teamAName: 'Alpha',
    teamBName: 'Bravo',
    teamSize: 1,
    club: 'ЮЗ',
    matchFormat: 'BO1',
    game: 'dota2',
    ...overrides
  });
  assert.equal(response.ok, true);
  return response.room;
}

test('production startup refuses bundled admin credentials', async () => {
  const port = await freePort();
  const env = productionEnv(port);
  delete env.ADMIN_LOGIN;
  delete env.ADMIN_PASSWORD_HASH;
  delete env.ADMIN_PASSWORD_SALT;

  const result = await runServerExpectExit(env);

  assert.notEqual(result.exitCode, null, 'server kept running with default production credentials');
  assert.notEqual(result.exitCode, 0);
  assert.match(result.output, /ADMIN_PASSWORD_HASH|default admin/i);
});

test('production startup refuses wildcard CORS origins', async () => {
  const port = await freePort();
  const result = await runServerExpectExit(productionEnv(port, { CLIENT_URL: '*' }));

  assert.notEqual(result.exitCode, null, 'server kept running with wildcard production CORS');
  assert.notEqual(result.exitCode, 0);
  assert.match(result.output, /CLIENT_URL|origin/i);
});

test('production startup refuses missing built client bundle', async () => {
  const port = await freePort();
  const result = await runServerExpectExit(productionEnv(port, {
    CLIENT_DIST_PATH: path.join(__dirname, 'missing-dist')
  }));

  assert.notEqual(result.exitCode, null, 'server kept running with a missing client build');
  assert.notEqual(result.exitCode, 0);
  assert.match(result.output, /client build|index\.html/i);
});

test('protected rooms require a room access token for state and chat', async () => {
  const server = await startServer();
  const sockets = [];
  try {
    const admin = await connect(server.url);
    sockets.push(admin);
    const adminToken = await adminLogin(admin);
    const room = await createRoom(admin, adminToken, { password: 'secret' });

    const outsider = await connect(server.url);
    sockets.push(outsider);
    const direct = await emit(outsider, 'room:get', { roomId: room.id });
    assert.equal(direct.ok, false);
    assert.equal(direct.error, 'ROOM_PASSWORD_REQUIRED');

    const deniedChat = await emit(outsider, 'chat:room:send', { roomId: room.id, nickname: 'Spy', text: 'hello' });
    assert.equal(deniedChat.ok, false);
    assert.equal(deniedChat.error, 'ROOM_PASSWORD_REQUIRED');

    const checked = await emit(outsider, 'room:checkPassword', { roomId: room.id, password: 'secret' });
    assert.equal(checked.ok, true);
    assert.match(checked.roomAccessToken, /^[a-f0-9]{64}$/);

    const allowed = await emit(outsider, 'room:get', { roomId: room.id, roomAccessToken: checked.roomAccessToken });
    assert.equal(allowed.ok, true);
    assert.equal(allowed.room.id, room.id);

    const allowedChat = await emit(outsider, 'chat:room:send', { roomId: room.id, nickname: 'Player', text: 'hello', roomAccessToken: checked.roomAccessToken });
    assert.equal(allowedChat.ok, true);
  } finally {
    sockets.forEach((socket) => socket.close());
    await server.stop();
  }
});

test('admin chat updates are only emitted to authenticated admin sockets', async () => {
  const server = await startServer();
  const sockets = [];
  try {
    const admin = await connect(server.url);
    const outsider = await connect(server.url);
    sockets.push(admin, outsider);
    const adminToken = await adminLogin(admin);

    let outsiderReceived = false;
    let adminReceived = false;
    outsider.on('chat:admin:update', () => { outsiderReceived = true; });
    admin.on('chat:admin:update', () => { adminReceived = true; });

    const sent = await emit(admin, 'chat:admin:send', { adminToken, nickname: 'admin', text: 'private' });
    assert.equal(sent.ok, true);
    await new Promise((resolve) => setTimeout(resolve, 150));

    assert.equal(adminReceived, true);
    assert.equal(outsiderReceived, false);
  } finally {
    sockets.forEach((socket) => socket.close());
    await server.stop();
  }
});

test('screenshots require live participant/admin access and replacements are admin-only', async () => {
  const server = await startServer();
  const sockets = [];
  try {
    const admin = await connect(server.url);
    sockets.push(admin);
    const adminToken = await adminLogin(admin);
    const room = await createRoom(admin, adminToken);
    const outsider = await connect(server.url);
    sockets.push(outsider);

    const lobbyUpload = await emit(outsider, 'match:uploadScreenshot', { roomId: room.id, dataUrl: IMAGE });
    assert.equal(lobbyUpload.ok, false);

    const playerA = await connect(server.url);
    const playerB = await connect(server.url);
    sockets.push(playerA, playerB);
    assert.equal((await emit(playerA, 'room:join', { roomId: room.id, name: 'A', team: 'A' })).ok, true);
    assert.equal((await emit(playerB, 'room:join', { roomId: room.id, name: 'B', team: 'B' })).ok, true);
    assert.equal((await emit(playerA, 'player:toggleReady', { roomId: room.id })).ok, true);
    const readyB = await emit(playerB, 'player:toggleReady', { roomId: room.id });
    assert.equal(readyB.ok, true);
    assert.equal(readyB.room.stage, 'live');

    const outsiderUpload = await emit(outsider, 'match:uploadScreenshot', { roomId: room.id, dataUrl: IMAGE });
    assert.equal(outsiderUpload.ok, false);

    const participantUpload = await emit(playerA, 'match:uploadScreenshot', { roomId: room.id, dataUrl: IMAGE });
    assert.equal(participantUpload.ok, true);
    assert.equal(participantUpload.room.resultScreenshots.length, 1);

    const participantReplace = await emit(playerA, 'match:uploadScreenshot', { roomId: room.id, dataUrl: IMAGE, replaceIndex: 0 });
    assert.equal(participantReplace.ok, false);

    const adminReplace = await emit(admin, 'match:uploadScreenshot', { roomId: room.id, dataUrl: IMAGE, replaceIndex: 0, adminToken });
    assert.equal(adminReplace.ok, true);
  } finally {
    sockets.forEach((socket) => socket.close());
    await server.stop();
  }
});

test('admin login rate limit blocks repeated invalid attempts', async () => {
  const server = await startServer({ ADMIN_LOGIN_MAX_ATTEMPTS: '2', ADMIN_LOGIN_WINDOW_MS: '60000' });
  const socket = await connect(server.url);
  try {
    assert.equal((await emit(socket, 'admin:login', { login: 'admin', password: 'bad-1' })).ok, false);
    assert.equal((await emit(socket, 'admin:login', { login: 'admin', password: 'bad-2' })).ok, false);
    const blocked = await emit(socket, 'admin:login', { login: 'admin', password: 'bad-3' });
    assert.equal(blocked.ok, false);
    assert.match(blocked.error, /too many/i);
  } finally {
    socket.close();
    await server.stop();
  }
});
