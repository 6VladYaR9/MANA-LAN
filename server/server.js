const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const { Server } = require('socket.io');
const RoomManager = require('./roomManager');
const { loadDotEnv, getBracketRows, FALLBACK_ROWS } = require('./services/bracketSource');
const { createStateStore } = require('./services/stateStore');
const { verifyAdmin, createToken, validateAdminConfig } = require('./auth');

loadDotEnv();
validateAdminConfig();

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || (process.env.NODE_ENV === 'production' ? '127.0.0.1' : '0.0.0.0');
const ADMIN_SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const ROOM_ACCESS_TTL_MS = 1000 * 60 * 60 * 12;
const PLAYER_SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const ADMIN_ROOM = 'admins';
const ADMIN_LOGIN_MAX_ATTEMPTS = Math.max(1, Number.parseInt(process.env.ADMIN_LOGIN_MAX_ATTEMPTS || '5', 10));
const ADMIN_LOGIN_WINDOW_MS = Math.max(1000, Number.parseInt(process.env.ADMIN_LOGIN_WINDOW_MS || '60000', 10));

function parseAllowedOrigins() {
  const raw = String(process.env.CLIENT_URL || '*').trim();
  const origins = raw.split(',').map((origin) => origin.trim()).filter(Boolean);
  const normalized = origins.length > 0 ? origins : ['*'];

  if (process.env.NODE_ENV === 'production' && normalized.includes('*')) {
    throw new Error('CLIENT_URL must list explicit production origins; wildcard origin is not allowed in production.');
  }

  return normalized.includes('*') ? '*' : normalized;
}

const CLIENT_ORIGINS = parseAllowedOrigins();
const stateStore = createStateStore();
const initialState = stateStore.load();

const app = express();
const server = http.createServer(app);
const roomManager = new RoomManager(initialState);
const adminSessions = new Map();
const roomAccessTokens = restoreExpiringMap(initialState.roomAccessTokens);
const playerSessions = restoreExpiringMap(initialState.playerSessions);
const adminLoginFailures = new Map();

app.use(cors({ origin: CLIENT_ORIGINS }));
app.use(express.json({ limit: '6mb' }));

const clientDistPath = process.env.CLIENT_DIST_PATH || path.join(__dirname, '..', 'client', 'dist');
const clientIndexPath = path.join(clientDistPath, 'index.html');

if (process.env.NODE_ENV === 'production' && !fs.existsSync(clientIndexPath)) {
  throw new Error(`Production client build is missing: ${clientIndexPath}. Run npm run build before starting the server.`);
}

app.get('/api/bracket', async (req, res) => {
  try {
    const bracket = await getBracketRows();
    res.json({ ok: true, ...bracket });
  } catch (error) {
    res.status(200).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      source: 'fallback-after-error',
      rows: FALLBACK_ROWS
    });
  }
});

app.get('/api/game-servers', (req, res) => {
  res.json({ ok: true, servers: roomManager.getGameServers() });
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    message: 'MANA CS2/Dota Match Hub backend is running',
    modes: ['1v1', '2v2', '5v5'],
    formats: ['BO1', 'BO3'],
    games: ['cs2', 'dota2'],
    maintenanceMode: roomManager.getMaintenanceMode(),
    servers: roomManager.getGameServers()
  });
});

const io = new Server(server, {
  cors: {
    origin: CLIENT_ORIGINS,
    methods: ['GET', 'POST']
  },
  maxHttpBufferSize: 6e6
});

function restoreExpiringMap(entries) {
  const map = new Map();
  if (!Array.isArray(entries)) return map;

  const now = Date.now();
  entries.forEach((entry) => {
    if (!Array.isArray(entry) || entry.length !== 2) return;
    const [token, value] = entry;
    if (!token || !value || typeof value !== 'object') return;
    if (Number(value.expiresAt) <= now) return;
    map.set(String(token), value);
  });
  return map;
}

function serializeExpiringMap(map) {
  const now = Date.now();
  return Array.from(map.entries()).filter(([, value]) => Number(value?.expiresAt) > now);
}

function saveState() {
  stateStore.save({
    ...roomManager.getStateSnapshot(),
    roomAccessTokens: serializeExpiringMap(roomAccessTokens),
    playerSessions: serializeExpiringMap(playerSessions)
  });
}

function publicRoomsPayload() {
  return { rooms: roomManager.getPublicRooms() };
}

function emitRoomsList() {
  io.emit('rooms:update', publicRoomsPayload());
}

function emitRoomState(roomId) {
  const room = roomManager.getRoom(roomId);
  if (!room) return;
  io.to(roomId).emit('room:update', { room: roomManager.serializeRoom(room) });
}

function ackOk(callback, payload = {}) {
  if (typeof callback === 'function') callback({ ok: true, ...payload });
}

function ackError(callback, error) {
  const message = error instanceof Error ? error.message : String(error);
  if (typeof callback === 'function') callback({ ok: false, error: message });
}

function emitAfterRoomChange(roomId) {
  saveState();
  emitRoomState(roomId);
  emitRoomsList();
}

function readToken(socket, payload = {}) {
  return String(payload?.adminToken || socket.data?.adminToken || '').trim();
}

function loginFailureKey(socket, payload = {}) {
  const address = socket.handshake?.address || socket.conn?.remoteAddress || socket.id;
  const login = String(payload?.login || '').trim().toLowerCase();
  return `${address}:${login || 'unknown'}`;
}

function assertAdminLoginAllowed(socket, payload = {}) {
  const key = loginFailureKey(socket, payload);
  const entry = adminLoginFailures.get(key);
  if (!entry) return;

  if (entry.resetAt <= Date.now()) {
    adminLoginFailures.delete(key);
    return;
  }

  if (entry.count >= ADMIN_LOGIN_MAX_ATTEMPTS) {
    throw new Error('Too many admin login attempts. Try again later.');
  }
}

function recordAdminLoginFailure(socket, payload = {}) {
  const key = loginFailureKey(socket, payload);
  const existing = adminLoginFailures.get(key);
  const now = Date.now();
  const entry = existing && existing.resetAt > now
    ? { count: existing.count + 1, resetAt: existing.resetAt }
    : { count: 1, resetAt: now + ADMIN_LOGIN_WINDOW_MS };
  adminLoginFailures.set(key, entry);
}

function clearAdminLoginFailure(socket, payload = {}) {
  adminLoginFailures.delete(loginFailureKey(socket, payload));
}

function getAdminSession(token) {
  const session = adminSessions.get(token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    adminSessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + ADMIN_SESSION_TTL_MS;
  return session;
}

function isAdmin(socket, payload = {}) {
  const token = readToken(socket, payload);
  const session = getAdminSession(token);
  if (session) {
    socket.data.adminToken = token;
    socket.data.adminName = session.login;
    socket.join(ADMIN_ROOM);
  } else if (socket.data.adminToken) {
    socket.leave(ADMIN_ROOM);
    socket.data.adminToken = null;
    socket.data.adminName = null;
  }
  return Boolean(session);
}

function requireAdmin(socket, payload = {}) {
  if (!isAdmin(socket, payload)) throw new Error('Действие доступно только админу. Войди через /admin.');
  return socket.data.adminName || 'admin';
}

function rememberRoomAccess(socket, roomId, token) {
  socket.data.roomAccessTokens ||= {};
  socket.data.roomAccessTokens[roomId] = token;
}

function readRoomAccessToken(socket, payload = {}) {
  const roomId = payload?.roomId;
  return String(payload?.roomAccessToken || socket.data.roomAccessTokens?.[roomId] || '').trim();
}

function validateRoomAccessToken(roomId, token) {
  if (!token) return false;
  const session = roomAccessTokens.get(token);
  if (!session || session.roomId !== roomId) return false;
  if (session.expiresAt < Date.now()) {
    roomAccessTokens.delete(token);
    return false;
  }
  session.expiresAt = Date.now() + ROOM_ACCESS_TTL_MS;
  return true;
}

function rememberPlayerSession(socket, roomId, token) {
  socket.data.playerSessionTokens ||= {};
  socket.data.playerSessionTokens[roomId] = token;
}

function readPlayerSessionToken(socket, payload = {}) {
  const roomId = payload?.roomId;
  return String(payload?.playerSessionToken || socket.data.playerSessionTokens?.[roomId] || '').trim();
}

function validatePlayerSession(roomId, token) {
  if (!token) return null;
  const session = playerSessions.get(token);
  if (!session || session.roomId !== roomId) return null;
  if (session.expiresAt < Date.now()) {
    playerSessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + PLAYER_SESSION_TTL_MS;
  return session;
}

function grantPlayerSession(socket, room, player) {
  if (!room || !player) return '';
  const token = createToken();
  playerSessions.set(token, {
    roomId: room.id,
    playerId: player.id,
    createdAt: Date.now(),
    expiresAt: Date.now() + PLAYER_SESSION_TTL_MS
  });
  rememberPlayerSession(socket, room.id, token);
  return token;
}

function resumePlayerSession(socket, room, payload = {}) {
  if (!room) return null;
  const token = readPlayerSessionToken(socket, payload);
  const session = validatePlayerSession(room.id, token);
  if (!session) return null;

  const player = roomManager.resumePlayer(room.id, session.playerId, socket.id);
  rememberPlayerSession(socket, room.id, token);
  return { player, token };
}

function grantRoomAccess(socket, room) {
  if (!room?.hasPassword) return '';
  const token = createToken();
  roomAccessTokens.set(token, {
    roomId: room.id,
    createdAt: Date.now(),
    expiresAt: Date.now() + ROOM_ACCESS_TTL_MS
  });
  rememberRoomAccess(socket, room.id, token);
  return token;
}

function hasRoomAccess(socket, room, payload = {}) {
  if (!room?.hasPassword) return true;
  if (isAdmin(socket, payload)) return true;
  if (room.players.some((player) => player.socketId === socket.id)) return true;
  if (validatePlayerSession(room.id, readPlayerSessionToken(socket, payload))) return true;

  const token = readRoomAccessToken(socket, payload);
  if (validateRoomAccessToken(room.id, token)) {
    rememberRoomAccess(socket, room.id, token);
    return true;
  }

  return false;
}

function assertRoomAccess(socket, room, payload = {}) {
  if (!hasRoomAccess(socket, room, payload)) throw new Error('ROOM_PASSWORD_REQUIRED');
}

function isReplacementUpload(replaceIndex) {
  if (replaceIndex === null || replaceIndex === undefined || replaceIndex === '') return false;
  const value = Number(replaceIndex);
  return Number.isInteger(value) && value >= 0;
}

function assertScreenshotUploadAllowed(socket, room, payload = {}) {
  if (room.stage !== 'live' && room.stage !== 'finished') {
    throw new Error('Screenshots can be uploaded only after the match is live.');
  }

  const admin = isAdmin(socket, payload);
  const participant = room.players.some((player) => player.socketId === socket.id);
  if (!admin && !participant) {
    throw new Error('Screenshot upload requires a room participant or admin.');
  }

  if (isReplacementUpload(payload?.replaceIndex) && !admin) {
    throw new Error('Only admin can replace uploaded screenshots.');
  }
}

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);
  socket.emit('rooms:update', publicRoomsPayload());
  socket.emit('maintenance:update', { enabled: roomManager.getMaintenanceMode() });

  socket.on('admin:login', (payload, callback) => {
    try {
      assertAdminLoginAllowed(socket, payload);
      const adminVerified = verifyAdmin(payload?.login, payload?.password);
      if (!adminVerified) recordAdminLoginFailure(socket, payload);
      if (!verifyAdmin(payload?.login, payload?.password)) throw new Error('Неверный логин или пароль');
      clearAdminLoginFailure(socket, payload);
      const token = createToken();
      adminSessions.set(token, {
        login: String(payload?.login || 'admin').trim(),
        nickname: String(payload?.nickname || 'admin').trim(),
        createdAt: Date.now(),
        expiresAt: Date.now() + ADMIN_SESSION_TTL_MS
      });
      socket.data.adminToken = token;
      socket.data.adminName = String(payload?.login || 'admin').trim();
      socket.join(ADMIN_ROOM);
      roomManager.addAdminLog('admin:login', { socketId: socket.id }, socket.data.adminName);
      saveState();
      ackOk(callback, { token, admin: { login: socket.data.adminName } });
    } catch (error) {
      ackError(callback, error);
    }
  });

  socket.on('admin:check', (payload, callback) => {
    try {
      const valid = isAdmin(socket, payload);
      ackOk(callback, { isAdmin: valid, admin: valid ? { login: socket.data.adminName || 'admin' } : null });
    } catch (error) {
      ackError(callback, error);
    }
  });

  socket.on('admin:logout', (payload, callback) => {
    const token = readToken(socket, payload);
    if (token) adminSessions.delete(token);
    socket.leave(ADMIN_ROOM);
    socket.data.adminToken = null;
    socket.data.adminName = null;
    ackOk(callback);
  });

  socket.on('admin:logs:get', (payload, callback) => {
    try {
      requireAdmin(socket, payload);
      ackOk(callback, { logs: roomManager.getAdminLogs() });
    } catch (error) {
      ackError(callback, error);
    }
  });

  socket.on('admin:backup:get', (payload, callback) => {
    try {
      requireAdmin(socket, payload);
      roomManager.addAdminLog('backup:export', {}, socket.data.adminName || 'admin');
      saveState();
      ackOk(callback, { backup: roomManager.getBackup() });
    } catch (error) {
      ackError(callback, error);
    }
  });


  socket.on('admin:chat:clear', (payload, callback) => {
    try {
      const actor = requireAdmin(socket, payload);
      const scope = roomManager.clearChats(payload?.scope, actor);
      saveState();
      ackOk(callback, { scope });

      if (scope === 'global' || scope === 'all') {
        io.emit('chat:global:update', { messages: roomManager.getGlobalMessages() });
      }
      if (scope === 'admin' || scope === 'all') {
        io.to(ADMIN_ROOM).emit('chat:admin:update', { messages: roomManager.getAdminMessages() });
      }
      if (scope === 'room' || scope === 'all') {
        for (const room of roomManager.rooms) {
          emitRoomState(room.id);
        }
      }
    } catch (error) {
      ackError(callback, error);
    }
  });

  socket.on('maintenance:get', (callback) => {
    ackOk(callback, { enabled: roomManager.getMaintenanceMode() });
  });

  socket.on('maintenance:set', (payload, callback) => {
    try {
      const actor = requireAdmin(socket, payload);
      const enabled = roomManager.setMaintenanceMode(Boolean(payload?.enabled), actor);
      saveState();
      ackOk(callback, { enabled });
      io.emit('maintenance:update', { enabled });
    } catch (error) {
      ackError(callback, error);
    }
  });

  socket.on('bracket:get', (payload, callback) => {
    const done = typeof payload === 'function' ? payload : callback;
    const request = typeof payload === 'function' ? {} : payload || {};
    try {
      ackOk(done, { bracket: roomManager.getBracketState(request.game) });
    } catch (error) {
      ackError(done, error);
    }
  });

  socket.on('bracket:save', (payload, callback) => {
    try {
      const actor = requireAdmin(socket, payload);
      const game = RoomManager.normalizeGame(payload?.game);
      const bracket = roomManager.saveBracketState(game, payload?.state, actor);
      saveState();
      ackOk(callback, { bracket });
      io.emit('bracket:update', { game, bracket });
    } catch (error) {
      ackError(callback, error);
    }
  });

  socket.on('bracket:reset', (payload, callback) => {
    try {
      const actor = requireAdmin(socket, payload);
      const game = RoomManager.normalizeGame(payload?.game);
      const bracket = roomManager.resetBracketState(game, actor);
      saveState();
      ackOk(callback, { bracket });
      io.emit('bracket:update', { game, bracket });
    } catch (error) {
      ackError(callback, error);
    }
  });

  socket.on('rooms:get', (callback) => {
    ackOk(callback, publicRoomsPayload());
  });

  socket.on('rooms:create', (payload, callback) => {
    try {
      const actor = requireAdmin(socket, payload);
      const room = roomManager.createRoom(payload || {});
      roomManager.addAdminLog('room:create', { roomId: room.id, game: room.game, title: `${room.teamAName} vs ${room.teamBName}` }, actor);
      socket.join(room.id);
      const roomAccessToken = grantRoomAccess(socket, room);
      saveState();
      ackOk(callback, { room: roomManager.serializeRoom(room), roomAccessToken });
      emitRoomsList();
    } catch (error) {
      ackError(callback, error);
    }
  });

  socket.on('rooms:delete', (payload, callback) => {
    try {
      const actor = requireAdmin(socket, payload);
      const room = roomManager.deleteRoom(payload?.roomId);
      roomManager.addAdminLog('room:delete', { roomId: room.id, title: `${room.teamAName} vs ${room.teamBName}` }, actor);
      saveState();
      ackOk(callback, { roomId: room.id });
      io.to(room.id).emit('room:deleted', { roomId: room.id });
      emitRoomsList();
    } catch (error) {
      ackError(callback, error);
    }
  });

  socket.on('chat:global:get', (payload, callback) => {
    const done = typeof payload === 'function' ? payload : callback;
    try {
      ackOk(done, { messages: roomManager.getGlobalMessages() });
    } catch (error) {
      ackError(done, error);
    }
  });

  socket.on('chat:global:send', (payload, callback) => {
    try {
      const message = roomManager.addGlobalMessage({ socketId: socket.id, nickname: payload?.nickname, text: payload?.text });
      const messages = roomManager.getGlobalMessages();
      saveState();
      ackOk(callback, { message, messages });
      io.emit('chat:global:update', { messages });
    } catch (error) {
      ackError(callback, error);
    }
  });

  socket.on('chat:admin:get', (payload, callback) => {
    try {
      requireAdmin(socket, payload);
      ackOk(callback, { messages: roomManager.getAdminMessages() });
    } catch (error) {
      ackError(callback, error);
    }
  });

  socket.on('chat:admin:send', (payload, callback) => {
    try {
      requireAdmin(socket, payload);
      const message = roomManager.addAdminMessage({ socketId: socket.id, nickname: payload?.nickname || 'admin', text: payload?.text, image: payload?.image });
      const messages = roomManager.getAdminMessages();
      saveState();
      ackOk(callback, { message, messages });
      io.to(ADMIN_ROOM).emit('chat:admin:update', { messages });
    } catch (error) {
      ackError(callback, error);
    }
  });

  socket.on('chat:room:get', (payload, callback) => {
    try {
      const room = roomManager.getRoom(payload?.roomId);
      assertRoomAccess(socket, room, payload);
      if (!room) throw new Error('Комната не найдена');
      socket.join(room.id);
      ackOk(callback, { messages: roomManager.getRoomMessages(room.id) });
    } catch (error) {
      ackError(callback, error);
    }
  });

  socket.on('chat:room:send', (payload, callback) => {
    try {
      const room = roomManager.getRoom(payload?.roomId);
      assertRoomAccess(socket, room, payload);
      if (!room) throw new Error('Комната не найдена');
      socket.join(room.id);
      const message = roomManager.addRoomMessage(room.id, { socketId: socket.id, nickname: payload?.nickname, text: payload?.text });
      saveState();
      ackOk(callback, { message, messages: roomManager.getRoomMessages(room.id), room: roomManager.serializeRoom(room) });
      emitRoomState(room.id);
    } catch (error) {
      ackError(callback, error);
    }
  });

  socket.on('past:get', (payload, callback) => {
    try {
      ackOk(callback, { tournaments: roomManager.getPastTournaments(payload?.game) });
    } catch (error) {
      ackError(callback, error);
    }
  });

  socket.on('past:create', (payload, callback) => {
    try {
      const actor = requireAdmin(socket, payload);
      const item = roomManager.createPastTournament(payload, actor);
      saveState();
      ackOk(callback, { tournament: item, tournaments: roomManager.getPastTournaments(payload?.game) });
      io.emit('past:update', { tournaments: roomManager.getPastTournaments(), changedGame: item.game });
    } catch (error) {
      ackError(callback, error);
    }
  });

  socket.on('past:delete', (payload, callback) => {
    try {
      const actor = requireAdmin(socket, payload);
      const removed = roomManager.deletePastTournament(payload?.id, actor);
      saveState();
      ackOk(callback, { tournament: removed, tournaments: roomManager.getPastTournaments(payload?.game) });
      io.emit('past:update', { tournaments: roomManager.getPastTournaments(), changedGame: removed.game });
    } catch (error) {
      ackError(callback, error);
    }
  });

  socket.on('room:checkPassword', (payload, callback) => {
    try {
      const valid = roomManager.checkPassword(payload?.roomId, payload?.password);
      const room = roomManager.getRoom(payload?.roomId);
      if (!valid) throw new Error('Неверный пароль');
      const roomAccessToken = grantRoomAccess(socket, room);
      saveState();
      ackOk(callback, { roomAccessToken });
    } catch (error) {
      ackError(callback, error);
    }
  });

  socket.on('room:get', (payload, callback) => {
    try {
      const room = roomManager.getRoom(payload?.roomId);
      const resumedSession = resumePlayerSession(socket, room, payload);
      assertRoomAccess(socket, room, payload);
      if (!room) throw new Error('Комната не найдена');
      socket.join(room.id);
      const roomAccessToken = resumedSession ? grantRoomAccess(socket, room) : '';
      if (resumedSession || roomAccessToken) saveState();
      ackOk(callback, { room: roomManager.serializeRoom(room), playerSessionToken: resumedSession?.token || '', roomAccessToken });
    } catch (error) {
      ackError(callback, error);
    }
  });

  socket.on('room:join', (payload, callback) => {
    try {
      const roomBeforeJoin = roomManager.getRoom(payload?.roomId);
      const skipPasswordCheck = hasRoomAccess(socket, roomBeforeJoin, payload);
      const player = roomManager.addPlayer(payload?.roomId, { socketId: socket.id, name: payload?.name, team: payload?.team, password: payload?.password, skipPasswordCheck });
      socket.join(payload.roomId);
      const room = roomManager.getRoom(payload.roomId);
      const roomAccessToken = grantRoomAccess(socket, room);
      const playerSessionToken = grantPlayerSession(socket, room, player);
      ackOk(callback, { playerId: player.id, room: roomManager.serializeRoom(room), roomAccessToken, playerSessionToken });
      emitAfterRoomChange(payload.roomId);
    } catch (error) {
      ackError(callback, error);
    }
  });

  socket.on('player:toggleReady', (payload, callback) => {
    try {
      roomManager.toggleReady(payload?.roomId, socket.id);
      const room = roomManager.getRoom(payload.roomId);
      ackOk(callback, { room: roomManager.serializeRoom(room) });
      emitAfterRoomChange(payload.roomId);
    } catch (error) {
      ackError(callback, error);
    }
  });

  socket.on('player:leaveSlot', (payload, callback) => {
    try {
      roomManager.leavePlayer(payload?.roomId, socket.id);
      const room = roomManager.getRoom(payload.roomId);
      ackOk(callback, { room: roomManager.serializeRoom(room) });
      emitAfterRoomChange(payload.roomId);
    } catch (error) {
      ackError(callback, error);
    }
  });

  socket.on('player:transferCaptain', (payload, callback) => {
    try {
      roomManager.transferCaptain(payload?.roomId, socket.id, payload?.targetPlayerId);
      const room = roomManager.getRoom(payload.roomId);
      ackOk(callback, { room: roomManager.serializeRoom(room) });
      emitAfterRoomChange(payload.roomId);
    } catch (error) {
      ackError(callback, error);
    }
  });

  socket.on('veto:selectMap', (payload, callback) => {
    try {
      roomManager.applyVetoAction(payload?.roomId, { socketId: socket.id, mapName: payload?.mapName });
      const room = roomManager.getRoom(payload.roomId);
      ackOk(callback, { room: roomManager.serializeRoom(room) });
      emitAfterRoomChange(payload.roomId);
    } catch (error) {
      ackError(callback, error);
    }
  });

  socket.on('veto:startNext', (payload, callback) => {
    try {
      roomManager.startNextVeto(payload?.roomId, socket.id);
      const room = roomManager.getRoom(payload.roomId);
      ackOk(callback, { room: roomManager.serializeRoom(room) });
      emitAfterRoomChange(payload.roomId);
    } catch (error) {
      ackError(callback, error);
    }
  });

  socket.on('match:updateScore', (payload, callback) => {
    try {
      requireAdmin(socket, payload);
      roomManager.updateScore(payload?.roomId, payload?.score);
      const room = roomManager.getRoom(payload.roomId);
      ackOk(callback, { room: roomManager.serializeRoom(room) });
      emitAfterRoomChange(payload.roomId);
    } catch (error) {
      ackError(callback, error);
    }
  });

  socket.on('match:finish', (payload, callback) => {
    try {
      const actor = requireAdmin(socket, payload);
      roomManager.finishMatch(payload?.roomId, payload?.winnerTeam, true);
      const room = roomManager.getRoom(payload.roomId);
      roomManager.addAdminLog('match:winner', { roomId: room.id, winner: room.winnerName }, actor);
      ackOk(callback, { room: roomManager.serializeRoom(room) });
      emitAfterRoomChange(payload.roomId);
    } catch (error) {
      ackError(callback, error);
    }
  });

  socket.on('match:uploadScreenshot', (payload, callback) => {
    try {
      const room = roomManager.getRoom(payload.roomId);
      if (!room) throw new Error('Комната не найдена');
      assertScreenshotUploadAllowed(socket, room, payload);
      roomManager.uploadResultScreenshot(payload?.roomId, payload?.dataUrl, payload?.replaceIndex);
      if (isAdmin(socket, payload)) roomManager.addAdminLog('screenshot:upload', { roomId: room.id, replaceIndex: payload?.replaceIndex ?? null }, socket.data.adminName || 'admin');
      ackOk(callback, { room: roomManager.serializeRoom(room) });
      emitAfterRoomChange(payload.roomId);
    } catch (error) {
      ackError(callback, error);
    }
  });

  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
    const updatedRoomIds = roomManager.handleDisconnect(socket.id);
    if (updatedRoomIds.length > 0) {
      saveState();
      updatedRoomIds.forEach(emitRoomState);
      emitRoomsList();
    }
  });
});

app.use(express.static(clientDistPath));

app.get('*', (req, res) => {
  res.sendFile(path.join(clientDistPath, 'index.html'));
});

server.listen(PORT, HOST, () => {
  console.log(`MANA CS2/Dota server listening on http://${HOST}:${PORT}`);
  console.log('Game server pools:', JSON.stringify(roomManager.getGameServers(), null, 2));
});
