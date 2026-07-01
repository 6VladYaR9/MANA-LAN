const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
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
    DATA_DIR: path.join(os.tmpdir(), 'mana-production-test-data'),
    ADMIN_LOGIN: 'secure-admin',
    ADMIN_PASSWORD_SALT: 'secure-admin-salt-2026',
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
      if (child.exitCode !== null) return;
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill();
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      }
      await exited;
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

function emit(socket, event, payload) {
  return new Promise((resolve) => {
    if (payload === undefined) {
      socket.emit(event, resolve);
      return;
    }
    socket.emit(event, payload, resolve);
  });
}

async function adminLogin(socket) {
  const response = await emit(socket, 'admin:login', { login: ADMIN_LOGIN, password: ADMIN_PASSWORD });
  assert.equal(response.ok, true);
  return response.token;
}

function waitForEvent(socket, event, timeoutMs = 200) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      resolve(null);
    }, timeoutMs);

    function handler(payload) {
      clearTimeout(timer);
      resolve(payload);
    }

    socket.once(event, handler);
  });
}

async function createRoom(socket, adminToken, overrides = {}) {
  const response = await emit(socket, 'rooms:create', {
    adminToken,
    teamAName: 'Alpha',
    teamBName: 'Bravo',
    teamSize: 1,
    club: 'ЮЗ',
    matchFormat: 'BO1',
    game: 'cs2',
    ...overrides
  });
  assert.equal(response.ok, true);
  return response.room;
}

async function playVetoToLive(initialRoom, socketsByTeam) {
  let currentRoom = initialRoom;
  for (let step = 0; step < 7 && currentRoom.stage === 'veto'; step += 1) {
    const action = currentRoom.veto.currentAction;
    const actor = socketsByTeam[action.team];
    const nextMap = currentRoom.veto.maps.find((map) => map.status === 'available');
    const selected = await emit(actor, 'veto:selectMap', { roomId: currentRoom.id, mapName: nextMap.name });
    assert.equal(selected.ok, true);
    currentRoom = selected.room;
  }
  while (currentRoom.stage === 'side_choice') {
    const pendingMap = currentRoom.selectedMaps.find((map) => !map.side);
    const actor = socketsByTeam[pendingMap.sideChoiceTeam];
    const chosen = await emit(actor, 'veto:chooseSide', { roomId: currentRoom.id, round: pendingMap.round, side: 'CT' });
    assert.equal(chosen.ok, true);
    currentRoom = chosen.room;
  }
  return currentRoom;
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

test('production startup refuses deploy-template admin placeholders', async () => {
  const port = await freePort();
  const result = await runServerExpectExit(productionEnv(port, {
    ADMIN_LOGIN: 'admin-manalan',
    ADMIN_PASSWORD_SALT: 'change-this-generated-salt',
    ADMIN_PASSWORD_HASH: 'change-this-generated-pbkdf2-hash'
  }));

  assert.notEqual(result.exitCode, null, 'server kept running with template admin placeholders');
  assert.notEqual(result.exitCode, 0);
  assert.match(result.output, /placeholder|ADMIN_LOGIN|ADMIN_PASSWORD_HASH/i);
});

test('production startup refuses malformed admin password hash and salt', async () => {
  const port = await freePort();
  const malformedHash = await runServerExpectExit(productionEnv(port, {
    ADMIN_PASSWORD_HASH: 'not-a-hex-hash'
  }));

  assert.notEqual(malformedHash.exitCode, null, 'server kept running with malformed admin password hash');
  assert.notEqual(malformedHash.exitCode, 0);
  assert.match(malformedHash.output, /ADMIN_PASSWORD_HASH|64-character|hex/i);

  const shortSalt = await runServerExpectExit(productionEnv(await freePort(), {
    ADMIN_PASSWORD_SALT: 'short'
  }));

  assert.notEqual(shortSalt.exitCode, null, 'server kept running with too-short admin password salt');
  assert.notEqual(shortSalt.exitCode, 0);
  assert.match(shortSalt.output, /ADMIN_PASSWORD_SALT|16 characters/i);
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

test('production startup refuses implicit state file locations', async () => {
  const port = await freePort();
  const clientDist = fs.mkdtempSync(path.join(os.tmpdir(), 'mana-client-dist-'));
  fs.writeFileSync(path.join(clientDist, 'index.html'), '<!doctype html>');
  try {
    const env = productionEnv(port, { CLIENT_DIST_PATH: clientDist });
    delete env.DATA_DIR;
    delete env.STATE_FILE;

    const result = await runServerExpectExit(env);

    assert.notEqual(result.exitCode, null, 'server kept running without DATA_DIR or STATE_FILE');
    assert.notEqual(result.exitCode, 0);
    assert.match(result.output, /DATA_DIR|STATE_FILE/i);
  } finally {
    fs.rmSync(clientDist, { recursive: true, force: true });
  }
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

test('admin logout revokes every socket using the same token from admin updates', async () => {
  const server = await startServer();
  const sockets = [];
  try {
    const admin = await connect(server.url);
    const secondAdminTab = await connect(server.url);
    const freshAdmin = await connect(server.url);
    sockets.push(admin, secondAdminTab, freshAdmin);

    const adminToken = await adminLogin(admin);
    const checked = await emit(secondAdminTab, 'admin:check', { adminToken });
    assert.equal(checked.ok, true);
    assert.equal(checked.isAdmin, true);

    const logout = await emit(admin, 'admin:logout', { adminToken });
    assert.equal(logout.ok, true);

    const freshToken = await adminLogin(freshAdmin);
    const staleUpdate = waitForEvent(secondAdminTab, 'chat:admin:update', 250);
    const sent = await emit(freshAdmin, 'chat:admin:send', { adminToken: freshToken, nickname: 'admin', text: 'after logout' });
    assert.equal(sent.ok, true);

    assert.equal(await staleUpdate, null);
  } finally {
    sockets.forEach((socket) => socket.close());
    await server.stop();
  }
});

test('expired room access tokens stop protected room update delivery', async () => {
  const server = await startServer({ ROOM_ACCESS_TTL_MS: '50' });
  const sockets = [];
  try {
    const admin = await connect(server.url);
    const outsider = await connect(server.url);
    sockets.push(admin, outsider);
    const adminToken = await adminLogin(admin);
    const room = await createRoom(admin, adminToken, { password: 'secret' });

    const checked = await emit(outsider, 'room:checkPassword', { roomId: room.id, password: 'secret' });
    assert.equal(checked.ok, true);
    const joinedRead = await emit(outsider, 'room:get', { roomId: room.id, roomAccessToken: checked.roomAccessToken });
    assert.equal(joinedRead.ok, true);

    await new Promise((resolve) => setTimeout(resolve, 90));
    const staleUpdate = waitForEvent(outsider, 'room:update', 250);
    const adminMessage = await emit(admin, 'chat:room:send', {
      roomId: room.id,
      adminToken,
      nickname: 'admin',
      text: 'private update after expiry'
    });
    assert.equal(adminMessage.ok, true);

    assert.equal(await staleUpdate, null);
  } finally {
    sockets.forEach((socket) => socket.close());
    await server.stop();
  }
});

test('locked rooms redact sensitive public room metadata', async () => {
  const server = await startServer();
  const sockets = [];
  try {
    const admin = await connect(server.url);
    sockets.push(admin);
    const adminToken = await adminLogin(admin);
    const room = await createRoom(admin, adminToken, {
      password: 'secret',
      teamAName: 'Secret Alpha',
      teamBName: 'Secret Bravo'
    });

    const publicRooms = await emit(admin, 'rooms:get');
    assert.equal(publicRooms.ok, true);
    const publicRoom = publicRooms.rooms.find((item) => item.id === room.id);
    assert.ok(publicRoom);
    assert.equal(publicRoom.hasPassword, true);
    assert.notEqual(publicRoom.teamAName, 'Secret Alpha');
    assert.notEqual(publicRoom.teamBName, 'Secret Bravo');
    assert.equal(publicRoom.selectedMaps.length, 0);
    assert.deepEqual(publicRoom.score, { A: 0, B: 0 });
    assert.equal(publicRoom.winnerName, '');
    assert.equal(publicRoom.playersCount, 0);
  } finally {
    sockets.forEach((socket) => socket.close());
    await server.stop();
  }
});

test('room password checks are rate limited per room and client', async () => {
  const server = await startServer({
    ROOM_PASSWORD_MAX_ATTEMPTS: '2',
    ROOM_PASSWORD_WINDOW_MS: '60000'
  });
  const sockets = [];
  try {
    const admin = await connect(server.url);
    const outsider = await connect(server.url);
    sockets.push(admin, outsider);
    const adminToken = await adminLogin(admin);
    const room = await createRoom(admin, adminToken, { password: 'secret' });

    assert.equal((await emit(outsider, 'room:checkPassword', { roomId: room.id, password: 'bad-1' })).ok, false);
    assert.equal((await emit(outsider, 'room:checkPassword', { roomId: room.id, password: 'bad-2' })).ok, false);
    const blocked = await emit(outsider, 'room:checkPassword', { roomId: room.id, password: 'secret' });
    assert.equal(blocked.ok, false);
    assert.match(blocked.error, /too many|СЃР»РёС€РєРѕРј/i);
  } finally {
    sockets.forEach((socket) => socket.close());
    await server.stop();
  }
});

test('new room passwords are persisted as salted hashes, not plaintext', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mana-password-hash-'));
  const server = await startServer({ DATA_DIR: dataDir });
  const sockets = [];
  try {
    const admin = await connect(server.url);
    sockets.push(admin);
    const adminToken = await adminLogin(admin);
    const room = await createRoom(admin, adminToken, { password: 'secret-password' });

    const state = JSON.parse(fs.readFileSync(path.join(dataDir, 'state.json'), 'utf8'));
    const persisted = state.rooms.find((item) => item.id === room.id);
    assert.ok(persisted);
    assert.equal(persisted.hasPassword, true);
    assert.equal(persisted.password, '');
    assert.match(persisted.passwordHash, /^[a-f0-9]{64}$/);
    assert.match(persisted.passwordSalt, /^[a-f0-9]+$/);
    assert.equal(JSON.stringify(persisted).includes('secret-password'), false);
  } finally {
    sockets.forEach((socket) => socket.close());
    await server.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('room join does not acknowledge success when persistence fails', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mana-save-fail-'));
  const server = await startServer({ DATA_DIR: dataDir });
  const sockets = [];
  try {
    const admin = await connect(server.url);
    const player = await connect(server.url);
    sockets.push(admin, player);
    const adminToken = await adminLogin(admin);
    const room = await createRoom(admin, adminToken);

    const stateFile = path.join(dataDir, 'state.json');
    fs.rmSync(stateFile, { force: true });
    fs.mkdirSync(stateFile);

    const joined = await emit(player, 'room:join', { roomId: room.id, name: 'No Durable Ack', team: 'A' });
    assert.equal(joined.ok, false);
    assert.match(joined.error, /EISDIR|state|save|persist/i);

    const readBack = await emit(admin, 'room:get', { roomId: room.id, adminToken });
    assert.equal(readBack.ok, true);
    assert.equal(readBack.room.players.length, 0);
  } finally {
    sockets.forEach((socket) => socket.close());
    await server.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('failed admin login persistence rolls back the admin session', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mana-admin-save-fail-'));
  const server = await startServer({ DATA_DIR: dataDir });
  const socket = await connect(server.url);
  try {
    const stateFile = path.join(dataDir, 'state.json');
    fs.mkdirSync(stateFile);

    const login = await emit(socket, 'admin:login', { login: ADMIN_LOGIN, password: ADMIN_PASSWORD });
    assert.equal(login.ok, false);
    assert.match(login.error, /EISDIR|state|save|persist/i);

    const checked = await emit(socket, 'admin:check', {});
    assert.equal(checked.ok, true);
    assert.equal(checked.isAdmin, false);

    const logs = await emit(socket, 'admin:logs:get', {});
    assert.equal(logs.ok, false);
  } finally {
    socket.close();
    await server.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('failed room password persistence does not keep an in-memory room token', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mana-room-token-save-fail-'));
  const server = await startServer({ DATA_DIR: dataDir });
  const sockets = [];
  try {
    const admin = await connect(server.url);
    const outsider = await connect(server.url);
    sockets.push(admin, outsider);
    const adminToken = await adminLogin(admin);
    const room = await createRoom(admin, adminToken, { password: 'secret' });

    const stateFile = path.join(dataDir, 'state.json');
    fs.rmSync(stateFile, { force: true });
    fs.mkdirSync(stateFile);

    const checked = await emit(outsider, 'room:checkPassword', { roomId: room.id, password: 'secret' });
    assert.equal(checked.ok, false);
    assert.match(checked.error, /EISDIR|state|save|persist/i);

    const direct = await emit(outsider, 'room:get', { roomId: room.id });
    assert.equal(direct.ok, false);
    assert.equal(direct.error, 'ROOM_PASSWORD_REQUIRED');
  } finally {
    sockets.forEach((socket) => socket.close());
    await server.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('failed screenshot persistence rolls back in-memory screenshots', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mana-screenshot-save-fail-'));
  const server = await startServer({ DATA_DIR: dataDir });
  const sockets = [];
  try {
    const admin = await connect(server.url);
    const playerA = await connect(server.url);
    const playerB = await connect(server.url);
    sockets.push(admin, playerA, playerB);
    const adminToken = await adminLogin(admin);
    const room = await createRoom(admin, adminToken);

    assert.equal((await emit(playerA, 'room:join', { roomId: room.id, name: 'A', team: 'A' })).ok, true);
    assert.equal((await emit(playerB, 'room:join', { roomId: room.id, name: 'B', team: 'B' })).ok, true);
    assert.equal((await emit(playerA, 'player:toggleReady', { roomId: room.id })).ok, true);
    const readyB = await emit(playerB, 'player:toggleReady', { roomId: room.id });
    assert.equal(readyB.ok, true);
    const liveRoom = await playVetoToLive(readyB.room, { A: playerA, B: playerB });
    assert.equal(liveRoom.stage, 'live');

    const stateFile = path.join(dataDir, 'state.json');
    fs.rmSync(stateFile, { force: true });
    fs.mkdirSync(stateFile);

    const uploaded = await emit(playerA, 'match:uploadScreenshot', { roomId: room.id, dataUrl: IMAGE });
    assert.equal(uploaded.ok, false);
    assert.match(uploaded.error, /EISDIR|state|save|persist/i);

    const readBack = await emit(admin, 'room:get', { roomId: room.id, adminToken });
    assert.equal(readBack.ok, true);
    assert.equal(readBack.room.resultScreenshots.length, 0);
  } finally {
    sockets.forEach((socket) => socket.close());
    await server.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('player session token cannot create a second slot in a protected room', async () => {
  const server = await startServer();
  const sockets = [];
  try {
    const admin = await connect(server.url);
    const player = await connect(server.url);
    const secondSocket = await connect(server.url);
    sockets.push(admin, player, secondSocket);
    const adminToken = await adminLogin(admin);
    const room = await createRoom(admin, adminToken, { password: 'secret', teamSize: 2 });
    const access = await emit(player, 'room:checkPassword', { roomId: room.id, password: 'secret' });
    assert.equal(access.ok, true);

    const joined = await emit(player, 'room:join', {
      roomId: room.id,
      name: 'Alice',
      roomAccessToken: access.roomAccessToken
    });
    assert.equal(joined.ok, true);
    assert.match(joined.playerSessionToken, /^[a-f0-9]{64}$/);

    const secondJoin = await emit(secondSocket, 'room:join', {
      roomId: room.id,
      name: 'Second',
      playerSessionToken: joined.playerSessionToken
    });
    assert.equal(secondJoin.ok, false);
    assert.equal(secondJoin.error, 'ROOM_PASSWORD_REQUIRED');
  } finally {
    sockets.forEach((socket) => socket.close());
    await server.stop();
  }
});

test('production startup refuses invalid security numeric environment values', async () => {
  const port = await freePort();
  const result = await runServerExpectExit(productionEnv(port, { ADMIN_SESSION_TTL_MS: 'not-a-number' }));

  assert.notEqual(result.exitCode, null, 'server kept running with invalid security TTL');
  assert.notEqual(result.exitCode, 0);
  assert.match(result.output, /ADMIN_SESSION_TTL_MS|numeric|integer/i);
});

test('production startup refuses partially numeric security environment values', async () => {
  const port = await freePort();
  const result = await runServerExpectExit(productionEnv(port, { ADMIN_LOGIN_WINDOW_MS: '60000ms' }));

  assert.notEqual(result.exitCode, null, 'server kept running with partially numeric security config');
  assert.notEqual(result.exitCode, 0);
  assert.match(result.output, /ADMIN_LOGIN_WINDOW_MS|numeric|integer/i);
});

test('production startup refuses TRUST_PROXY on a public bind host', async () => {
  const port = await freePort();
  const result = await runServerExpectExit(productionEnv(port, { HOST: '0.0.0.0', TRUST_PROXY: '1' }));

  assert.notEqual(result.exitCode, null, 'server kept running with spoofable proxy headers');
  assert.notEqual(result.exitCode, 0);
  assert.match(result.output, /TRUST_PROXY|HOST|loopback/i);
});

test('legacy plaintext room passwords are migrated on the next save', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mana-legacy-password-'));
  const stateFile = path.join(dataDir, 'state.json');
  fs.writeFileSync(stateFile, JSON.stringify({
    rooms: [{
      id: 'legacy-room',
      teamAName: 'Legacy A',
      teamBName: 'Legacy B',
      password: 'old-secret',
      hasPassword: true,
      teamSize: 1,
      maxPlayers: 2,
      players: [],
      stage: 'lobby',
      createdAt: Date.now()
    }]
  }, null, 2));

  const server = await startServer({ DATA_DIR: dataDir });
  const socket = await connect(server.url);
  try {
    const checked = await emit(socket, 'room:checkPassword', { roomId: 'legacy-room', password: 'old-secret' });
    assert.equal(checked.ok, true);

    const persisted = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    const room = persisted.rooms.find((item) => item.id === 'legacy-room');
    assert.ok(room);
    assert.equal(room.password, '');
    assert.match(room.passwordHash, /^[a-f0-9]{64}$/);
    assert.match(room.passwordSalt, /^[a-f0-9]+$/);
    assert.equal(JSON.stringify(room).includes('old-secret'), false);
  } finally {
    socket.close();
    await server.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
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
    const liveRoom = await playVetoToLive(readyB.room, { A: playerA, B: playerB });
    assert.equal(liveRoom.stage, 'live');

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
