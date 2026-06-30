const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
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
      // keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('server did not become healthy');
}

async function startServer(dataDir) {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      HOST: '127.0.0.1',
      CLIENT_URL: `http://127.0.0.1:${port}`,
      DATA_DIR: dataDir
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', () => undefined);
  child.stderr.on('data', () => undefined);
  const url = `http://127.0.0.1:${port}`;
  await waitForHealth(url, child);
  return {
    url,
    stop: async () => {
      if (child.exitCode !== null) return;
      const exited = new Promise((resolve) => child.once('exit', resolve));
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        child.kill('SIGTERM');
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

test('rooms survive server restart when DATA_DIR is configured', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mana-state-'));
  let server = await startServer(dataDir);
  let socket = await connect(server.url);
  try {
    const login = await emit(socket, 'admin:login', { login: 'admin', password: 'manakirov2026' });
    assert.equal(login.ok, true);

    const created = await emit(socket, 'rooms:create', {
      adminToken: login.token,
      teamAName: 'Persist A',
      teamBName: 'Persist B',
      teamSize: 1,
      club: 'ЮЗ',
      matchFormat: 'BO1',
      game: 'dota2'
    });
    assert.equal(created.ok, true);

    const joined = await emit(socket, 'room:join', {
      roomId: created.room.id,
      name: 'Persistent Player',
      team: 'A'
    });
    assert.equal(joined.ok, true);
    assert.equal(Boolean(joined.playerSessionToken), true);

    const savedBracket = await emit(socket, 'bracket:save', {
      adminToken: login.token,
      game: 'cs2',
      state: {
        activeTab: 'playoff',
        winners: { qf: ['top', null, null, null], sf: [null, null], final: null }
      }
    });
    assert.equal(savedBracket.ok, true);

    socket.close();
    await server.stop();

    server = await startServer(dataDir);
    socket = await connect(server.url);
    const rooms = await emit(socket, 'rooms:get');
    assert.equal(rooms.ok, true);
    assert.equal(rooms.rooms.some((room) => room.id === created.room.id), true);

    const bracket = await emit(socket, 'bracket:get', { game: 'cs2' });
    assert.equal(bracket.ok, true);
    assert.equal(bracket.bracket.state.activeTab, 'playoff');

    const roomState = await emit(socket, 'room:get', {
      roomId: created.room.id,
      playerSessionToken: joined.playerSessionToken
    });
    assert.equal(roomState.ok, true);
    assert.equal(roomState.room.players.some((player) => player.id === joined.playerId && player.connected), true);
  } finally {
    socket?.close();
    await server?.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

function withStateFileEnv(stateFile, fn) {
  const originalEnv = {
    NODE_ENV: process.env.NODE_ENV,
    DATA_DIR: process.env.DATA_DIR,
    STATE_FILE: process.env.STATE_FILE,
    STATE_STORE_DISABLED: process.env.STATE_STORE_DISABLED
  };

  process.env.NODE_ENV = 'test';
  delete process.env.DATA_DIR;
  process.env.STATE_FILE = stateFile;
  delete process.env.STATE_STORE_DISABLED;

  try {
    return fn();
  } finally {
    Object.entries(originalEnv).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
  }
}

test('state store quarantines corrupt JSON instead of overwriting it', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mana-corrupt-state-'));
  const stateFile = path.join(dataDir, 'state.json');
  fs.writeFileSync(stateFile, '{bad json');

  try {
    withStateFileEnv(stateFile, () => {
      const { createStateStore } = require('../services/stateStore');
      const store = createStateStore();
      const originalError = console.error;
      console.error = () => undefined;
      try {
        assert.deepEqual(store.load(), {});
      } finally {
        console.error = originalError;
      }
      const quarantined = fs.readdirSync(dataDir).filter((name) => name.startsWith('state.json.corrupt-'));
      assert.equal(quarantined.length, 1);
      assert.equal(fs.readFileSync(path.join(dataDir, quarantined[0]), 'utf8'), '{bad json');

      store.save({ rooms: [], maintenanceMode: false });
      assert.equal(fs.existsSync(stateFile), true);
    });
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('state store externalizes inline image data and rehydrates it on load', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mana-image-state-'));
  const stateFile = path.join(dataDir, 'state.json');
  const image = `data:image/png;base64,${Buffer.from('fake-image').toString('base64')}`;

  try {
    withStateFileEnv(stateFile, () => {
      const { createStateStore } = require('../services/stateStore');
      const store = createStateStore();
      store.save({
        rooms: [{
          id: 'room-1',
          resultScreenshot: image,
          resultScreenshots: [image],
          chatMessages: []
        }],
        adminMessages: [{ id: 'message-1', image }],
        maintenanceMode: false
      });

      const rawState = fs.readFileSync(stateFile, 'utf8');
      assert.equal(rawState.includes(image), false);
      assert.match(rawState, /__manaStateAsset/);

      const loaded = store.load();
      assert.equal(loaded.rooms[0].resultScreenshot, image);
      assert.equal(loaded.rooms[0].resultScreenshots[0], image);
      assert.equal(loaded.adminMessages[0].image, image);
    });
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
