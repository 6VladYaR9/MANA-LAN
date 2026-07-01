const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const test = require('node:test');
const { io: createClient } = require('socket.io-client');

const SERVER_DIR = path.join(__dirname, '..');
const ADMIN_LOGIN = 'admin';
const ADMIN_PASSWORD = 'manakirov2026';
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

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

async function waitForHealth(url, child) {
  const started = Date.now();
  while (Date.now() - started < 5000) {
    if (child.exitCode !== null) throw new Error(`server exited early with code ${child.exitCode}`);
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return;
    } catch {
      // keep polling until the child is ready
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('server did not become healthy');
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
  const url = `http://127.0.0.1:${port}`;
  await waitForHealth(url, child);
  return {
    url,
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

function connect(url, options = {}) {
  return new Promise((resolve, reject) => {
    const socket = createClient(url, {
      forceNew: true,
      reconnection: false,
      transports: ['websocket'],
      ...options
    });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

function connectExpectError(url, options = {}) {
  return new Promise((resolve, reject) => {
    const socket = createClient(url, {
      forceNew: true,
      reconnection: false,
      timeout: 1000,
      transports: ['websocket'],
      ...options
    });
    socket.once('connect', () => {
      socket.close();
      reject(new Error('socket connected but should have been rejected'));
    });
    socket.once('connect_error', (error) => {
      socket.close();
      resolve(error);
    });
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

function waitForEvent(socket, event, timeoutMs = 500) {
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
    club: 'Р®Р—',
    matchFormat: 'BO1',
    game: 'cs2',
    ...overrides
  });
  assert.equal(response.ok, true);
  return response.room;
}

async function createLiveRoom(server, adminToken, admin) {
  const playerA = await connect(server.url);
  const playerB = await connect(server.url);
  const room = await createRoom(admin, adminToken);

  assert.equal((await emit(playerA, 'room:join', { roomId: room.id, name: 'Alice', team: 'A' })).ok, true);
  assert.equal((await emit(playerB, 'room:join', { roomId: room.id, name: 'Bob', team: 'B' })).ok, true);
  assert.equal((await emit(playerA, 'player:toggleReady', { roomId: room.id })).ok, true);
  const readyB = await emit(playerB, 'player:toggleReady', { roomId: room.id });
  assert.equal(readyB.ok, true);

  let currentRoom = readyB.room;
  for (let step = 0; step < 7 && currentRoom.stage === 'veto'; step += 1) {
    const action = currentRoom.veto.currentAction;
    const actor = action.team === 'A' ? playerA : playerB;
    const nextMap = currentRoom.veto.maps.find((map) => map.status === 'available');
    const selected = await emit(actor, 'veto:selectMap', { roomId: currentRoom.id, mapName: nextMap.name });
    assert.equal(selected.ok, true);
    currentRoom = selected.room;
  }

  while (currentRoom.stage === 'side_choice') {
    const pendingMap = currentRoom.selectedMaps.find((map) => !map.side);
    const actor = pendingMap.sideChoiceTeam === 'A' ? playerA : playerB;
    const chosen = await emit(actor, 'veto:chooseSide', { roomId: currentRoom.id, round: pendingMap.round, side: 'CT' });
    assert.equal(chosen.ok, true);
    currentRoom = chosen.room;
  }

  return { room: currentRoom, playerA, playerB };
}

async function createVetoRoom(server, adminToken, admin, overrides = {}) {
  const playerA = await connect(server.url);
  const playerB = await connect(server.url);
  const room = await createRoom(admin, adminToken, overrides);

  assert.equal((await emit(playerA, 'room:join', { roomId: room.id, name: 'Alice', team: 'A' })).ok, true);
  assert.equal((await emit(playerB, 'room:join', { roomId: room.id, name: 'Bob', team: 'B' })).ok, true);
  assert.equal((await emit(playerA, 'player:toggleReady', { roomId: room.id })).ok, true);
  const readyB = await emit(playerB, 'player:toggleReady', { roomId: room.id });
  assert.equal(readyB.ok, true);
  assert.equal(readyB.room.stage, 'veto');

  return { room: readyB.room, playerA, playerB };
}

test('maintenance mode rejects non-admin player mutations server-side', async () => {
  const server = await startServer();
  const sockets = [];
  try {
    const admin = await connect(server.url);
    const player = await connect(server.url);
    sockets.push(admin, player);
    const adminToken = await adminLogin(admin);
    const room = await createRoom(admin, adminToken);

    const maintenance = await emit(admin, 'maintenance:set', { adminToken, enabled: true });
    assert.equal(maintenance.ok, true);

    const joined = await emit(player, 'room:join', { roomId: room.id, name: 'Blocked', team: 'A' });
    assert.equal(joined.ok, false);
    assert.match(joined.error, /maintenance|technical|тех/i);

    const chat = await emit(player, 'chat:global:send', { nickname: 'Blocked', text: 'hello during maintenance' });
    assert.equal(chat.ok, false);
    assert.match(chat.error, /maintenance|technical|тех/i);
  } finally {
    sockets.forEach((socket) => socket.close());
    await server.stop();
  }
});

test('websocket handshake rejects disallowed Origin headers', async () => {
  const server = await startServer();
  try {
    await connectExpectError(server.url, {
      extraHeaders: {
        Origin: 'https://evil.test'
      }
    });
  } finally {
    await server.stop();
  }
});

test('http responses include baseline security headers', async () => {
  const server = await startServer();
  try {
    const response = await fetch(`${server.url}/api/health`);
    assert.equal(response.ok, true);
    assert.match(response.headers.get('content-security-policy') || '', /default-src 'self'/i);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  } finally {
    await server.stop();
  }
});

test('admin login rejects oversized credentials before hashing', async () => {
  const server = await startServer();
  const socket = await connect(server.url);
  try {
    const response = await emit(socket, 'admin:login', {
      login: 'admin',
      password: 'x'.repeat(20_000)
    });
    assert.equal(response.ok, false);
    assert.match(response.error, /password|credential|length|длин/i);
  } finally {
    socket.close();
    await server.stop();
  }
});

test('room creation rejects oversized names and unsupported team sizes', async () => {
  const server = await startServer();
  const sockets = [];
  try {
    const admin = await connect(server.url);
    sockets.push(admin);
    const adminToken = await adminLogin(admin);

    const hugeName = 'A'.repeat(10_000);
    const oversized = await emit(admin, 'rooms:create', {
      adminToken,
      teamAName: hugeName,
      teamBName: 'Bravo',
      teamSize: 1,
      club: 'Р®Р—',
      matchFormat: 'BO1',
      game: 'cs2'
    });
    assert.equal(oversized.ok, false);
    assert.match(oversized.error, /team|name|length|длин/i);

    const invalidSize = await emit(admin, 'rooms:create', {
      adminToken,
      teamAName: 'Alpha',
      teamBName: 'Bravo',
      teamSize: 3,
      club: 'Р®Р—',
      matchFormat: 'BO1',
      game: 'cs2'
    });
    assert.equal(invalidSize.ok, false);
    assert.match(invalidSize.error, /team size|mode|режим|формат/i);
  } finally {
    sockets.forEach((socket) => socket.close());
    await server.stop();
  }
});

test('dota rooms are rejected while dota backend is disabled', async () => {
  const server = await startServer();
  const sockets = [];
  try {
    const admin = await connect(server.url);
    sockets.push(admin);
    const adminToken = await adminLogin(admin);

    const created = await emit(admin, 'rooms:create', {
      adminToken,
      teamAName: 'Radiant',
      teamBName: 'Dire',
      teamSize: 5,
      club: 'Р®Р—',
      matchFormat: 'BO1',
      game: 'dota2'
    });

    assert.equal(created.ok, false);
    assert.match(created.error, /dota|disabled|разработ/i);
  } finally {
    sockets.forEach((socket) => socket.close());
    await server.stop();
  }
});

test('admin-created protected room access token is revoked on logout', async () => {
  const server = await startServer();
  const sockets = [];
  try {
    const admin = await connect(server.url);
    sockets.push(admin);
    const adminToken = await adminLogin(admin);

    const created = await emit(admin, 'rooms:create', {
      adminToken,
      teamAName: 'Alpha',
      teamBName: 'Bravo',
      password: 'secret',
      teamSize: 1,
      club: 'Р®Р—',
      matchFormat: 'BO1',
      game: 'cs2'
    });
    assert.equal(created.ok, true);
    assert.equal(created.roomAccessToken || '', '');

    const logout = await emit(admin, 'admin:logout', { adminToken });
    assert.equal(logout.ok, true);

    const staleRead = await emit(admin, 'room:get', {
      roomId: created.room.id,
      roomAccessToken: created.roomAccessToken || ''
    });
    assert.equal(staleRead.ok, false);
    assert.equal(staleRead.error, 'ROOM_PASSWORD_REQUIRED');
  } finally {
    sockets.forEach((socket) => socket.close());
    await server.stop();
  }
});

test('repeated room join from the same socket reuses the player session token', async () => {
  const server = await startServer();
  const sockets = [];
  try {
    const admin = await connect(server.url);
    const player = await connect(server.url);
    sockets.push(admin, player);
    const adminToken = await adminLogin(admin);
    const room = await createRoom(admin, adminToken);

    const firstJoin = await emit(player, 'room:join', { roomId: room.id, name: 'Alice', team: 'A' });
    assert.equal(firstJoin.ok, true);
    const secondJoin = await emit(player, 'room:join', { roomId: room.id, name: 'Alice Again', team: 'A' });
    assert.equal(secondJoin.ok, true);

    assert.equal(secondJoin.playerId, firstJoin.playerId);
    assert.equal(secondJoin.playerSessionToken, firstJoin.playerSessionToken);
    assert.equal(secondJoin.room.players.length, 1);
    assert.equal(secondJoin.room.players[0].name, 'Alice Again');
  } finally {
    sockets.forEach((socket) => socket.close());
    await server.stop();
  }
});

test('match finish requires screenshots and does not rewrite a finished winner', async () => {
  const server = await startServer();
  const sockets = [];
  try {
    const admin = await connect(server.url);
    sockets.push(admin);
    const adminToken = await adminLogin(admin);
    const live = await createLiveRoom(server, adminToken, admin);
    sockets.push(live.playerA, live.playerB);

    const premature = await emit(admin, 'match:finish', { roomId: live.room.id, winnerTeam: 'A', adminToken });
    assert.equal(premature.ok, false);
    assert.match(premature.error, /screenshot|скрин/i);

    const uploaded = await emit(live.playerA, 'match:uploadScreenshot', { roomId: live.room.id, dataUrl: TINY_PNG });
    assert.equal(uploaded.ok, true, uploaded.error);

    const finished = await emit(admin, 'match:finish', { roomId: live.room.id, winnerTeam: 'A', adminToken });
    assert.equal(finished.ok, true);
    assert.equal(finished.room.winnerTeam, 'A');

    const rewritten = await emit(admin, 'match:finish', { roomId: live.room.id, winnerTeam: 'B', adminToken });
    assert.equal(rewritten.ok, false);
    assert.match(rewritten.error, /finished|заверш/i);
  } finally {
    sockets.forEach((socket) => socket.close());
    await server.stop();
  }
});

test('ready disconnected players do not start veto', async () => {
  const server = await startServer();
  const sockets = [];
  try {
    const admin = await connect(server.url);
    const playerA = await connect(server.url);
    const playerB = await connect(server.url);
    sockets.push(admin, playerA, playerB);
    const adminToken = await adminLogin(admin);
    const room = await createRoom(admin, adminToken);

    assert.equal((await emit(playerA, 'room:join', { roomId: room.id, name: 'Alice', team: 'A' })).ok, true);
    assert.equal((await emit(playerA, 'player:toggleReady', { roomId: room.id })).ok, true);
    playerA.close();
    await new Promise((resolve) => setTimeout(resolve, 150));

    assert.equal((await emit(playerB, 'room:join', { roomId: room.id, name: 'Bob', team: 'B' })).ok, true);
    const readyB = await emit(playerB, 'player:toggleReady', { roomId: room.id });
    assert.equal(readyB.ok, true);
    assert.equal(readyB.room.stage, 'lobby');
    assert.equal(readyB.room.players.find((player) => player.name === 'Alice')?.ready, false);
  } finally {
    sockets.forEach((socket) => socket.close());
    await server.stop();
  }
});

test('server rejects veto actions before the coin unlock time', async () => {
  const server = await startServer({ COIN_UNLOCK_DELAY_MS: '250' });
  const sockets = [];
  try {
    const admin = await connect(server.url);
    sockets.push(admin);
    const adminToken = await adminLogin(admin);
    const vetoRoom = await createVetoRoom(server, adminToken, admin);
    sockets.push(vetoRoom.playerA, vetoRoom.playerB);

    const action = vetoRoom.room.veto.currentAction;
    const actor = action.team === 'A' ? vetoRoom.playerA : vetoRoom.playerB;
    const nextMap = vetoRoom.room.veto.maps.find((map) => map.status === 'available');
    const locked = await emit(actor, 'veto:selectMap', { roomId: vetoRoom.room.id, mapName: nextMap.name });
    assert.equal(locked.ok, false);
    assert.match(locked.error, /coin|unlock|монет/i);

    await new Promise((resolve) => setTimeout(resolve, 275));
    const selected = await emit(actor, 'veto:selectMap', { roomId: vetoRoom.room.id, mapName: nextMap.name });
    assert.equal(selected.ok, true);
  } finally {
    sockets.forEach((socket) => socket.close());
    await server.stop();
  }
});

test('cs2 veto requires captain side choice before match goes live', async () => {
  const server = await startServer();
  const sockets = [];
  try {
    const admin = await connect(server.url);
    sockets.push(admin);
    const adminToken = await adminLogin(admin);
    const vetoRoom = await createVetoRoom(server, adminToken, admin);
    sockets.push(vetoRoom.playerA, vetoRoom.playerB);

    let currentRoom = vetoRoom.room;
    for (let step = 0; step < 7 && currentRoom.stage === 'veto'; step += 1) {
      const action = currentRoom.veto.currentAction;
      const actor = action.team === 'A' ? vetoRoom.playerA : vetoRoom.playerB;
      const nextMap = currentRoom.veto.maps.find((map) => map.status === 'available');
      const selected = await emit(actor, 'veto:selectMap', { roomId: currentRoom.id, mapName: nextMap.name });
      assert.equal(selected.ok, true);
      currentRoom = selected.room;
    }

    assert.equal(currentRoom.stage, 'side_choice');
    const pendingMap = currentRoom.selectedMaps.find((map) => !map.side);
    assert.ok(pendingMap);
    assert.ok(pendingMap.sideChoiceTeam === 'A' || pendingMap.sideChoiceTeam === 'B');

    const wrongActor = pendingMap.sideChoiceTeam === 'A' ? vetoRoom.playerB : vetoRoom.playerA;
    const denied = await emit(wrongActor, 'veto:chooseSide', { roomId: currentRoom.id, round: pendingMap.round, side: 'CT' });
    assert.equal(denied.ok, false);

    const actor = pendingMap.sideChoiceTeam === 'A' ? vetoRoom.playerA : vetoRoom.playerB;
    const chosen = await emit(actor, 'veto:chooseSide', { roomId: currentRoom.id, round: pendingMap.round, side: 'CT' });
    assert.equal(chosen.ok, true);
    assert.equal(chosen.room.selectedMaps[0].side, 'CT');
    assert.equal(chosen.room.stage, 'live');
  } finally {
    sockets.forEach((socket) => socket.close());
    await server.stop();
  }
});

test('resuming a player session broadcasts the replacement socket to observers', async () => {
  const server = await startServer();
  const sockets = [];
  try {
    const admin = await connect(server.url);
    const player = await connect(server.url);
    const observer = await connect(server.url);
    sockets.push(admin, player, observer);
    const adminToken = await adminLogin(admin);
    const room = await createRoom(admin, adminToken);
    const joined = await emit(player, 'room:join', { roomId: room.id, name: 'Alice', team: 'A' });
    assert.equal(joined.ok, true);

    const watched = await emit(observer, 'room:get', { roomId: room.id });
    assert.equal(watched.ok, true);
    player.close();
    await new Promise((resolve) => setTimeout(resolve, 150));

    const replacement = await connect(server.url);
    sockets.push(replacement);
    const updatePromise = waitForEvent(observer, 'room:update', 800);
    const resumed = await emit(replacement, 'room:get', {
      roomId: room.id,
      playerSessionToken: joined.playerSessionToken
    });
    assert.equal(resumed.ok, true);

    const update = await updatePromise;
    assert.ok(update, 'observer did not receive room:update after resume');
    const playerState = update.room.players.find((item) => item.id === joined.playerId);
    assert.equal(playerState?.socketId, replacement.id);
    assert.equal(playerState?.connected, true);
  } finally {
    sockets.forEach((socket) => socket.close());
    await server.stop();
  }
});
