const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const { Server } = require('socket.io');
const RoomManager = require('./roomManager');
const { loadDotEnv, getBracketRows, FALLBACK_ROWS } = require('./services/bracketSource');
const { verifyAdmin, createToken } = require('./auth');

loadDotEnv();

const PORT = process.env.PORT || 3001;
const CLIENT_URL = process.env.CLIENT_URL || '*';
const ADMIN_SESSION_TTL_MS = 1000 * 60 * 60 * 12;

const app = express();
const server = http.createServer(app);
const roomManager = new RoomManager();
const adminSessions = new Map();

app.use(cors({ origin: CLIENT_URL }));
app.use(express.json({ limit: '6mb' }));

const clientDistPath = path.join(__dirname, '..', 'client', 'dist');

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
    origin: CLIENT_URL,
    methods: ['GET', 'POST']
  },
  maxHttpBufferSize: 6e6
});

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
  emitRoomState(roomId);
  emitRoomsList();
}

function readToken(socket, payload = {}) {
  return String(payload?.adminToken || socket.data?.adminToken || '').trim();
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
  }
  return Boolean(session);
}

function requireAdmin(socket, payload = {}) {
  if (!isAdmin(socket, payload)) throw new Error('Действие доступно только админу. Войди через /admin.');
  return socket.data.adminName || 'admin';
}

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);
  socket.emit('rooms:update', publicRoomsPayload());
  socket.emit('maintenance:update', { enabled: roomManager.getMaintenanceMode() });

  socket.on('admin:login', (payload, callback) => {
    try {
      if (!verifyAdmin(payload?.login, payload?.password)) throw new Error('Неверный логин или пароль');
      const token = createToken();
      adminSessions.set(token, {
        login: String(payload?.login || 'admin').trim(),
        nickname: String(payload?.nickname || 'admin').trim(),
        createdAt: Date.now(),
        expiresAt: Date.now() + ADMIN_SESSION_TTL_MS
      });
      socket.data.adminToken = token;
      socket.data.adminName = String(payload?.login || 'admin').trim();
      roomManager.addAdminLog('admin:login', { socketId: socket.id }, socket.data.adminName);
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
      ackOk(callback, { backup: roomManager.getBackup() });
    } catch (error) {
      ackError(callback, error);
    }
  });


  socket.on('admin:chat:clear', (payload, callback) => {
    try {
      const actor = requireAdmin(socket, payload);
      const scope = roomManager.clearChats(payload?.scope, actor);
      ackOk(callback, { scope });

      if (scope === 'global' || scope === 'all') {
        io.emit('chat:global:update', { messages: roomManager.getGlobalMessages() });
      }
      if (scope === 'admin' || scope === 'all') {
        io.emit('chat:admin:update', { messages: roomManager.getAdminMessages() });
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
      ackOk(callback, { enabled });
      io.emit('maintenance:update', { enabled });
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
      ackOk(callback, { room: roomManager.serializeRoom(room) });
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
      ackOk(callback, { message, messages });
      io.emit('chat:admin:update', { messages });
    } catch (error) {
      ackError(callback, error);
    }
  });

  socket.on('chat:room:get', (payload, callback) => {
    try {
      const room = roomManager.getRoom(payload?.roomId);
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
      if (!room) throw new Error('Комната не найдена');
      const message = roomManager.addRoomMessage(room.id, { socketId: socket.id, nickname: payload?.nickname, text: payload?.text });
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
      ackOk(callback, { tournament: removed, tournaments: roomManager.getPastTournaments(payload?.game) });
      io.emit('past:update', { tournaments: roomManager.getPastTournaments(), changedGame: removed.game });
    } catch (error) {
      ackError(callback, error);
    }
  });

  socket.on('room:checkPassword', (payload, callback) => {
    try {
      const valid = roomManager.checkPassword(payload?.roomId, payload?.password);
      if (!valid) throw new Error('Неверный пароль');
      ackOk(callback);
    } catch (error) {
      ackError(callback, error);
    }
  });

  socket.on('room:get', (payload, callback) => {
    try {
      const room = roomManager.getRoom(payload?.roomId);
      if (!room) throw new Error('Комната не найдена');
      socket.join(room.id);
      ackOk(callback, { room: roomManager.serializeRoom(room) });
    } catch (error) {
      ackError(callback, error);
    }
  });

  socket.on('room:join', (payload, callback) => {
    try {
      const player = roomManager.addPlayer(payload?.roomId, { socketId: socket.id, name: payload?.name, team: payload?.team, password: payload?.password });
      socket.join(payload.roomId);
      const room = roomManager.getRoom(payload.roomId);
      ackOk(callback, { playerId: player.id, room: roomManager.serializeRoom(room) });
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
      roomManager.uploadResultScreenshot(payload?.roomId, payload?.dataUrl, payload?.replaceIndex);
      const room = roomManager.getRoom(payload.roomId);
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
    updatedRoomIds.forEach(emitRoomState);
    if (updatedRoomIds.length > 0) emitRoomsList();
  });
});

app.use(express.static(clientDistPath));

app.get('*', (req, res) => {
  res.sendFile(path.join(clientDistPath, 'index.html'));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`MANA CS2/Dota server listening on http://0.0.0.0:${PORT}`);
  console.log('Game server pools:', JSON.stringify(roomManager.getGameServers(), null, 2));
});
