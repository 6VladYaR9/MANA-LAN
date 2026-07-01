const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const test = require('node:test');
const { io: createClient } = require('socket.io-client');

const SERVER_DIR = path.join(__dirname, '..');

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

async function startServer() {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      HOST: '127.0.0.1',
      CLIENT_URL: `http://127.0.0.1:${port}`
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const url = `http://127.0.0.1:${port}`;
  await waitForHealth(url, child);
  return {
    url,
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
  const response = await emit(socket, 'admin:login', { login: 'admin', password: 'manakirov2026' });
  assert.equal(response.ok, true);
  return response.token;
}

test('player session token restores a lobby slot after socket reconnect', async () => {
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
      teamSize: 1,
      club: 'ЮЗ',
      matchFormat: 'BO1',
      game: 'dota2'
    });
    assert.equal(created.ok, true);

    const firstSocket = await connect(server.url);
    sockets.push(firstSocket);
    const joined = await emit(firstSocket, 'room:join', { roomId: created.room.id, name: 'Alice', team: 'A' });
    assert.equal(joined.ok, true);
    assert.match(joined.playerSessionToken, /^[a-f0-9]{64}$/);
    const playerId = joined.playerId;

    firstSocket.close();
    await new Promise((resolve) => setTimeout(resolve, 100));

    const resumedSocket = await connect(server.url);
    sockets.push(resumedSocket);
    const resumed = await emit(resumedSocket, 'room:get', {
      roomId: created.room.id,
      playerSessionToken: joined.playerSessionToken
    });
    assert.equal(resumed.ok, true);

    const player = resumed.room.players.find((item) => item.id === playerId);
    assert.ok(player, 'player should remain in the room after reconnect');
    assert.equal(player.connected, true);
    assert.equal(player.socketId, resumedSocket.id);

    const ready = await emit(resumedSocket, 'player:toggleReady', { roomId: created.room.id });
    assert.equal(ready.ok, true);
    assert.equal(ready.room.players.find((item) => item.id === playerId)?.ready, true);
  } finally {
    sockets.forEach((socket) => socket.close());
    await server.stop();
  }
});

test('stale player session tokens do not block public room reads after leaving a slot', async () => {
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
      teamSize: 1,
      club: 'Р®Р—',
      matchFormat: 'BO1',
      game: 'dota2'
    });
    assert.equal(created.ok, true);

    const player = await connect(server.url);
    sockets.push(player);
    const joined = await emit(player, 'room:join', { roomId: created.room.id, name: 'Alice', team: 'A' });
    assert.equal(joined.ok, true);

    const left = await emit(player, 'player:leaveSlot', { roomId: created.room.id });
    assert.equal(left.ok, true);

    const staleRead = await emit(player, 'room:get', {
      roomId: created.room.id,
      playerSessionToken: joined.playerSessionToken
    });
    assert.equal(staleRead.ok, true);
    assert.equal(staleRead.playerSessionToken, '');
    assert.equal(staleRead.room.players.some((item) => item.id === joined.playerId), false);
  } finally {
    sockets.forEach((socket) => socket.close());
    await server.stop();
  }
});
