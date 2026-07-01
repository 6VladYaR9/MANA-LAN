const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const test = require('node:test');
const { io: createClient } = require('socket.io-client');

const SERVER_DIR = path.join(__dirname, '..');
const PNG_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

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
  const image = PNG_IMAGE;

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

test('state store cleans temp files and new assets when final state rename fails', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mana-save-cleanup-'));
  const stateFile = path.join(dataDir, 'state.json');

  try {
    withStateFileEnv(stateFile, () => {
      const { createStateStore } = require('../services/stateStore');
      const store = createStateStore();
      fs.mkdirSync(stateFile);

      assert.throws(() => {
        store.save({
          rooms: [{
            id: 'room-1',
            resultScreenshot: PNG_IMAGE,
            resultScreenshots: [PNG_IMAGE],
            chatMessages: []
          }],
          adminMessages: [],
          maintenanceMode: false
        });
      }, /EISDIR|rename/i);

      const entries = fs.readdirSync(dataDir);
      assert.equal(entries.some((name) => name.includes('.tmp')), false);
      const assetsDir = path.join(dataDir, 'assets');
      assert.equal(fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir).length : 0, 0);
    });
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('state store keeps externalized asset writes inside the assets directory', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mana-safe-asset-write-'));
  const stateFile = path.join(dataDir, 'state.json');
  const outsideCandidate = path.join(dataDir, 'outside-result.png');

  try {
    withStateFileEnv(stateFile, () => {
      const { createStateStore } = require('../services/stateStore');
      const store = createStateStore();
      store.save({
        rooms: [{
          id: '../../outside',
          resultScreenshot: PNG_IMAGE,
          resultScreenshots: [PNG_IMAGE],
          chatMessages: [{ id: '../../chat-outside', image: PNG_IMAGE }]
        }],
        adminMessages: [{ id: '../../admin-outside', image: PNG_IMAGE }],
        maintenanceMode: false
      });

      const rawState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      const markers = [
        rawState.rooms[0].resultScreenshot.__manaStateAsset,
        rawState.rooms[0].resultScreenshots[0].__manaStateAsset,
        rawState.rooms[0].chatMessages[0].image.__manaStateAsset,
        rawState.adminMessages[0].image.__manaStateAsset
      ];

      markers.forEach((marker) => {
        assert.match(marker, /^assets\//);
        assert.equal(marker.includes('..'), false);
        assert.equal(path.isAbsolute(marker), false);
        assert.equal(fs.existsSync(path.resolve(dataDir, marker)), true);
      });
      assert.equal(fs.existsSync(outsideCandidate), false);
    });
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('state store rejects traversal asset markers instead of reading outside data dir', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mana-traversal-state-'));
  const stateFile = path.join(dataDir, 'state.json');
  const outsideSecret = path.join(os.tmpdir(), `mana-secret-${process.pid}.txt`);
  fs.writeFileSync(outsideSecret, 'SECRET-OUTSIDE-ASSET');
  fs.writeFileSync(stateFile, JSON.stringify({
    adminMessages: [{ id: 'message-1', image: { __manaStateAsset: path.relative(dataDir, outsideSecret).replace(/\\/g, '/') } }],
    rooms: [],
    maintenanceMode: false
  }));

  try {
    withStateFileEnv(stateFile, () => {
      const { createStateStore } = require('../services/stateStore');
      const store = createStateStore();
      const originalError = console.error;
      console.error = () => undefined;
      try {
        const loaded = store.load();
        assert.notEqual(loaded.adminMessages?.[0]?.image, 'SECRET-OUTSIDE-ASSET');
      } finally {
        console.error = originalError;
      }
      const quarantined = fs.readdirSync(dataDir).filter((name) => name.startsWith('state.json.corrupt-'));
      assert.equal(quarantined.length, 1);
    });
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(outsideSecret, { force: true });
  }
});

test('state store rejects traversal markers inside assets prefixes', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mana-assets-traversal-state-'));
  const stateFile = path.join(dataDir, 'state.json');

  const cases = ['assets/../secret.png', 'assets\\..\\secret.png'];
  try {
    for (const marker of cases) {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(stateFile, JSON.stringify({
        adminMessages: [{ id: 'message-1', image: { __manaStateAsset: marker } }],
        rooms: [],
        maintenanceMode: false
      }));

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
      });

      const quarantined = fs.readdirSync(dataDir).filter((name) => name.startsWith('state.json.corrupt-'));
      assert.equal(quarantined.length, 1);
      fs.rmSync(path.join(dataDir, quarantined[0]), { force: true });
    }
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('state store quarantines legacy inline image data that fails validation', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mana-invalid-inline-state-'));
  const stateFile = path.join(dataDir, 'state.json');
  const invalidInline = `data:image/png;base64,${Buffer.from('not really a png').toString('base64')}`;
  fs.writeFileSync(stateFile, JSON.stringify({
    rooms: [{ id: 'room-1', resultScreenshot: invalidInline, resultScreenshots: [], chatMessages: [] }],
    adminMessages: [],
    maintenanceMode: false
  }));

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
    });
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('state store quarantines snapshots with missing image assets instead of dropping references', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mana-missing-asset-state-'));
  const stateFile = path.join(dataDir, 'state.json');
  fs.writeFileSync(stateFile, JSON.stringify({
    rooms: [{
      id: 'room-1',
      resultScreenshot: { __manaStateAsset: 'assets/missing.png' },
      resultScreenshots: [{ __manaStateAsset: 'assets/missing.png' }],
      chatMessages: []
    }],
    adminMessages: [],
    maintenanceMode: false
  }));

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
    });
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('room manager rejects image data URLs with invalid decoded bytes', () => {
  const RoomManager = require('../roomManager');
  const manager = new RoomManager();
  const room = manager.createRoom({
    teamAName: 'Alpha',
    teamBName: 'Bravo',
    teamSize: 1,
    club: 'Р®Р—',
    matchFormat: 'BO1',
    game: 'dota2'
  });
  room.stage = 'live';
  const fakePng = `data:image/png;base64,${Buffer.from('not really a png').toString('base64')}`;

  assert.throws(() => manager.uploadResultScreenshot(room.id, fakePng), /PNG|JPG|WEBP|image|bytes/i);
  assert.throws(() => manager.addAdminMessage({ socketId: 's1', nickname: 'admin', text: 'image', image: fakePng }), /PNG|JPG|WEBP|image|bytes/i);
});

test('room manager rejects image data URLs with only a valid header and garbage body', () => {
  const RoomManager = require('../roomManager');
  const manager = new RoomManager();
  const room = manager.createRoom({
    teamAName: 'Alpha',
    teamBName: 'Bravo',
    teamSize: 1,
    club: 'Р В®Р вЂ”',
    matchFormat: 'BO1',
    game: 'dota2'
  });
  room.stage = 'live';
  const pngHeaderAndGarbage = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('garbage body')
  ]);
  const fakePng = `data:image/png;base64,${pngHeaderAndGarbage.toString('base64')}`;

  assert.throws(() => manager.uploadResultScreenshot(room.id, fakePng), /PNG|JPG|WEBP|image|bytes|structure|decode/i);
});
