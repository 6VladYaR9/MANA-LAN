const crypto = require('crypto');

const MAP_POOL = ['Dust 2', 'Mirage', 'Inferno', 'Nuke', 'Ancient', 'Anubis', 'Vertigo'];
const CLUBS = ['ЮЗ', 'Ленина'];
const MATCH_FORMATS = ['BO1', 'BO3'];
const GAMES = ['cs2', 'dota2'];

// Пока IP одинаковый, отличаются игровые порты и GOTV-порты.
// Когда появятся реальные серверы, меняешь только этот массив.
const SERVER_POOLS = {
  ЮЗ: [
    { id: 'yz-1', club: 'ЮЗ', name: 'ЮЗ #1', ip: '192.168.88.250', port: 27015, gotvPort: 27020 },
    { id: 'yz-2', club: 'ЮЗ', name: 'ЮЗ #2', ip: '192.168.88.250', port: 27016, gotvPort: 27021 },
    { id: 'yz-3', club: 'ЮЗ', name: 'ЮЗ #3', ip: '192.168.88.250', port: 27017, gotvPort: 27022 },
    { id: 'yz-4', club: 'ЮЗ', name: 'ЮЗ #4', ip: '192.168.88.250', port: 27018, gotvPort: 27023 }
  ],
  Ленина: [
    { id: 'lenina-1', club: 'Ленина', name: 'Ленина #1', ip: '192.168.88.250', port: 27115, gotvPort: 27120 },
    { id: 'lenina-2', club: 'Ленина', name: 'Ленина #2', ip: '192.168.88.250', port: 27116, gotvPort: 27121 },
    { id: 'lenina-3', club: 'Ленина', name: 'Ленина #3', ip: '192.168.88.250', port: 27117, gotvPort: 27122 },
    { id: 'lenina-4', club: 'Ленина', name: 'Ленина #4', ip: '192.168.88.250', port: 27118, gotvPort: 27123 }
  ]
};

function decorateServer(server, status = 'reserved') {
  if (!server) return null;
  return {
    ...server,
    address: `${server.ip}:${server.port}`,
    gotvAddress: `${server.ip}:${server.gotvPort}`,
    status
  };
}

function otherTeam(team) {
  return team === 'A' ? 'B' : 'A';
}

function normalizeTeamSize(value) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(5, parsed));
}

function normalizeClub(value) {
  return CLUBS.includes(value) ? value : 'ЮЗ';
}

function normalizeMatchFormat(value) {
  return MATCH_FORMATS.includes(value) ? value : 'BO1';
}

function normalizeGame(value) {
  return GAMES.includes(value) ? value : 'cs2';
}

function clonePlain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function cleanText(value, fallback) {
  const text = String(value || '').trim();
  return text || fallback;
}

function buildVetoActions(matchFormat, startingTeam) {
  // startingTeam — команда, которую выбрала монетка.
  const secondTeam = otherTeam(startingTeam);

  if (matchFormat === 'BO3') {
    // BO3: A/B здесь значит не буквальная Team A/Team B, а команда, выбранная монеткой, и её соперник.
    // 1 BAN, 2 BAN, 3 PICK, 4 PICK, 5 BAN, 6 BAN, 7 карта становится DECIDER.
    return [
      { team: startingTeam, type: 'ban' },
      { team: secondTeam, type: 'ban' },
      { team: startingTeam, type: 'pick' },
      { team: secondTeam, type: 'pick' },
      { team: startingTeam, type: 'ban' },
      { team: secondTeam, type: 'ban' }
    ];
  }

  // BO1: шесть банов, последняя карта играется.
  const actions = [];
  let team = startingTeam;
  for (let i = 0; i < 6; i += 1) {
    actions.push({ team, type: 'ban' });
    team = otherTeam(team);
  }
  return actions;
}

class RoomManager {
  constructor(snapshot = {}) {
    const state = snapshot && typeof snapshot === 'object' ? snapshot : {};
    this.rooms = Array.isArray(state.rooms) ? state.rooms.map((room) => this.hydrateRoom(room)).filter(Boolean) : [];
    this.allocatedServerIds = new Set();
    this.rooms.forEach((room) => {
      if (room?.assignedServer?.id && !room.serverReleased) this.allocatedServerIds.add(room.assignedServer.id);
    });
    this.globalMessages = Array.isArray(state.globalMessages) ? state.globalMessages : [];
    this.adminMessages = Array.isArray(state.adminMessages) ? state.adminMessages : [];
    this.adminLogs = Array.isArray(state.adminLogs) ? state.adminLogs : [];
    this.chatCooldowns = new Map();
    this.maintenanceMode = Boolean(state.maintenanceMode);
    this.pastTournaments = Array.isArray(state.pastTournaments) ? state.pastTournaments : this.createDefaultPastTournaments();
    this.bracketStates = state.bracketStates && typeof state.bracketStates === 'object' ? state.bracketStates : {};
  }

  hydrateRoom(room) {
    if (!room || typeof room !== 'object' || !room.id) return null;

    const matchFormat = normalizeMatchFormat(room.matchFormat);
    const teamSize = normalizeTeamSize(room.teamSize);
    const resultScreenshots = Array.isArray(room.resultScreenshots)
      ? room.resultScreenshots
      : (room.resultScreenshot ? [room.resultScreenshot] : []);

    return {
      ...room,
      game: normalizeGame(room.game),
      club: normalizeClub(room.club),
      matchFormat,
      targetMaps: Number.isFinite(Number(room.targetMaps)) ? Number(room.targetMaps) : (matchFormat === 'BO3' ? 3 : 1),
      password: String(room.password || ''),
      hasPassword: Boolean(room.hasPassword || room.password),
      players: Array.isArray(room.players)
        ? room.players.map((player) => ({ ...player, socketId: '', connected: false }))
        : [],
      captains: {
        A: room.captains?.A || null,
        B: room.captains?.B || null
      },
      teamSize,
      maxPlayers: Number.isFinite(Number(room.maxPlayers)) ? Number(room.maxPlayers) : teamSize * 2,
      selectedMaps: Array.isArray(room.selectedMaps) ? room.selectedMaps : [],
      assignedServer: room.assignedServer || null,
      serverReleased: Boolean(room.serverReleased),
      score: room.score || { A: 0, B: 0 },
      mapScores: Array.isArray(room.mapScores) ? room.mapScores : [],
      winnerTeam: room.winnerTeam || null,
      winnerName: room.winnerName || '',
      resultScreenshot: room.resultScreenshot || resultScreenshots[0] || null,
      resultScreenshots,
      finishedAt: room.finishedAt || null,
      chatMessages: Array.isArray(room.chatMessages) ? room.chatMessages : []
    };
  }

  createDefaultPastTournaments() {
    return [
      {
        id: 'mana-cs2-cup-2026',
        game: 'cs2',
        title: 'MANA CS2 CUP',
        date: '2026',
        bannerImage: '/assets/tournaments/mana-cup-banner.svg',
        description: 'Пример страницы прошедшего турнира. Баннер и фото можно заменить в админке.',
        podium: [
          { place: 1, teamName: 'TEAM A', teamPhoto: '/assets/teams/team-first.svg', players: ['Player 1', 'Player 2', 'Player 3', 'Player 4', 'Player 5'] },
          { place: 2, teamName: 'TEAM E', teamPhoto: '/assets/teams/team-second.svg', players: ['Player 1', 'Player 2', 'Player 3', 'Player 4', 'Player 5'] },
          { place: 3, teamName: 'TEAM C', teamPhoto: '/assets/teams/team-third.svg', players: ['Player 1', 'Player 2', 'Player 3', 'Player 4', 'Player 5'] }
        ]
      },
      {
        id: 'mana-dota-cup-2026',
        game: 'dota2',
        title: 'MANA DOTA 2 CUP',
        date: '2026',
        bannerImage: '/assets/dota/dota-tournament.svg',
        description: 'Временная карточка Dota 2 турнира. Позже можно заменить на реальные фото.',
        podium: [
          { place: 1, teamName: 'DOTA TEAM A', teamPhoto: '/assets/dota/dota-team-first.svg', players: ['Player 1', 'Player 2', 'Player 3', 'Player 4', 'Player 5'] },
          { place: 2, teamName: 'DOTA TEAM B', teamPhoto: '/assets/dota/dota-team-second.svg', players: ['Player 1', 'Player 2', 'Player 3', 'Player 4', 'Player 5'] },
          { place: 3, teamName: 'DOTA TEAM C', teamPhoto: '/assets/dota/dota-team-third.svg', players: ['Player 1', 'Player 2', 'Player 3', 'Player 4', 'Player 5'] }
        ]
      }
    ];
  }

  addAdminLog(action, details = {}, actor = 'admin') {
    const log = {
      id: crypto.randomUUID(),
      action,
      actor,
      details,
      createdAt: Date.now()
    };
    this.adminLogs.unshift(log);
    this.adminLogs = this.adminLogs.slice(0, 300);
    return log;
  }

  getAdminLogs() {
    return this.adminLogs.slice(0, 120);
  }

  setMaintenanceMode(enabled, actor = 'admin') {
    this.maintenanceMode = Boolean(enabled);
    this.addAdminLog(this.maintenanceMode ? 'maintenance:on' : 'maintenance:off', {}, actor);
    return this.maintenanceMode;
  }

  getMaintenanceMode() {
    return this.maintenanceMode;
  }

  getBackup() {
    return {
      exportedAt: new Date().toISOString(),
      rooms: this.rooms.map((room) => this.serializeRoom(room)),
      pastTournaments: this.pastTournaments,
      adminLogs: this.getAdminLogs(),
      globalMessages: this.getGlobalMessages(),
      adminMessages: this.getAdminMessages(),
      bracketStates: clonePlain(this.bracketStates),
      maintenanceMode: this.maintenanceMode
    };
  }

  getStateSnapshot() {
    return {
      version: 1,
      rooms: clonePlain(this.rooms),
      pastTournaments: clonePlain(this.pastTournaments),
      adminLogs: clonePlain(this.adminLogs),
      globalMessages: clonePlain(this.globalMessages),
      adminMessages: clonePlain(this.adminMessages),
      bracketStates: clonePlain(this.bracketStates),
      maintenanceMode: this.maintenanceMode
    };
  }

  getBracketState(game = 'cs2') {
    const normalizedGame = normalizeGame(game);
    return this.bracketStates[normalizedGame] || null;
  }

  saveBracketState(game = 'cs2', state = {}, actor = 'admin') {
    const normalizedGame = normalizeGame(game);
    const safeState = state && typeof state === 'object' ? clonePlain(state) : {};
    if (JSON.stringify(safeState).length > 500_000) throw new Error('Bracket state is too large.');

    const entry = {
      state: safeState,
      updatedAt: Date.now(),
      actor
    };
    this.bracketStates[normalizedGame] = entry;
    this.addAdminLog('bracket:save', { game: normalizedGame }, actor);
    return entry;
  }

  resetBracketState(game = 'cs2', actor = 'admin') {
    const normalizedGame = normalizeGame(game);
    delete this.bracketStates[normalizedGame];
    this.addAdminLog('bracket:reset', { game: normalizedGame }, actor);
    return null;
  }

  getGameServers() {
    return Object.fromEntries(
      Object.entries(SERVER_POOLS).map(([club, servers]) => [
        club,
        servers.map((server) => decorateServer(server, this.allocatedServerIds.has(server.id) ? 'busy' : 'free'))
      ])
    );
  }

  allocateServer(club) {
    const normalizedClub = normalizeClub(club);
    const pool = SERVER_POOLS[normalizedClub] || [];
    const freeServer = pool.find((server) => !this.allocatedServerIds.has(server.id));

    if (!freeServer) {
      throw new Error(`Нет свободных CS2-серверов для клуба ${normalizedClub}. Заверши один из матчей или добавь сервер в SERVER_POOLS.`);
    }

    this.allocatedServerIds.add(freeServer.id);
    return decorateServer(freeServer, 'reserved');
  }

  releaseServer(room) {
    if (!room?.assignedServer?.id || room.serverReleased) return;
    this.allocatedServerIds.delete(room.assignedServer.id);
    room.serverReleased = true;
    room.assignedServer = decorateServer(room.assignedServer, 'released');
  }

  createRoom({ teamAName, teamBName, password, teamSize, club, matchFormat, game }) {
    const normalizedTeamSize = normalizeTeamSize(teamSize);
    const normalizedFormat = normalizeMatchFormat(matchFormat);
    const normalizedClub = normalizeClub(club);
    const normalizedGame = normalizeGame(game);
    const assignedServer = normalizedGame === 'cs2' ? this.allocateServer(normalizedClub) : null;

    const room = {
      id: crypto.randomUUID(),
      teamAName: cleanText(teamAName, 'Team A'),
      teamBName: cleanText(teamBName, 'Team B'),
      game: normalizedGame,
      club: normalizedClub,
      matchFormat: normalizedFormat,
      targetMaps: normalizedFormat === 'BO3' ? 3 : 1,
      password: String(password || ''),
      hasPassword: Boolean(String(password || '').trim()),
      stage: 'lobby',
      createdAt: Date.now(),
      players: [],
      captains: { A: null, B: null },
      teamSize: normalizedTeamSize,
      maxPlayers: normalizedTeamSize * 2,
      selectedMaps: [],
      veto: null,
      assignedServer,
      gameServerAddress: assignedServer?.address || 'DOTA 2 LOBBY',
      gotvAddress: assignedServer?.gotvAddress || '—',
      serverReleased: false,
      score: { A: 0, B: 0 },
      mapScores: [],
      winnerTeam: null,
      winnerName: '',
      resultScreenshot: null,
      resultScreenshots: [],
      finishedAt: null,
      chatMessages: []
    };

    this.rooms.unshift(room);
    return room;
  }

  getRoom(roomId) {
    return this.rooms.find((room) => room.id === roomId) || null;
  }

  getStatus(room) {
    if (room.stage === 'lobby') return 'waiting';
    if (room.stage === 'finished') return 'finished';
    return 'in_progress';
  }

  getPublicRooms() {
    return this.rooms.map((room) => {
      const locked = Boolean(room.hasPassword);
      const screenshots = Array.isArray(room.resultScreenshots) ? room.resultScreenshots : (room.resultScreenshot ? [room.resultScreenshot] : []);

      return {
        id: room.id,
        game: room.game || 'cs2',
        teamAName: room.teamAName,
        teamBName: room.teamBName,
        club: room.club,
        matchFormat: room.matchFormat,
        targetMaps: room.targetMaps,
        hasPassword: room.hasPassword,
        stage: room.stage,
        status: this.getStatus(room),
        playersCount: room.players.length,
        teamSize: room.teamSize,
        maxPlayers: room.maxPlayers,
        selectedMap: room.selectedMaps[room.selectedMaps.length - 1]?.map || room.veto?.selectedMap || null,
        selectedMaps: room.selectedMaps,
        gameServerAddress: locked ? 'LOCKED' : room.gameServerAddress,
        gotvAddress: locked ? 'LOCKED' : room.gotvAddress,
        assignedServer: locked ? null : room.assignedServer,
        score: room.score,
        mapScores: this.ensureMapScores(room),
        winnerTeam: room.winnerTeam,
        winnerName: room.winnerName,
        resultScreenshot: locked ? null : (room.resultScreenshot || screenshots[0] || null),
        resultScreenshots: locked ? [] : screenshots,
        finishedAt: room.finishedAt,
        createdAt: room.createdAt
      };
    });
  }

  checkPassword(roomId, password) {
    const room = this.getRoom(roomId);
    if (!room) throw new Error('Комната не найдена');
    if (!room.hasPassword) return true;
    return room.password === String(password || '');
  }

  serializeRoom(room) {
    return {
      id: room.id,
      game: room.game || 'cs2',
      teamAName: room.teamAName,
      teamBName: room.teamBName,
      club: room.club,
      matchFormat: room.matchFormat,
      targetMaps: room.targetMaps,
      hasPassword: room.hasPassword,
      stage: room.stage,
      status: this.getStatus(room),
      teamSize: room.teamSize,
      maxPlayers: room.maxPlayers,
      gameServerAddress: room.gameServerAddress,
      gotvAddress: room.gotvAddress,
      assignedServer: room.assignedServer,
      serverReleased: room.serverReleased,
      score: room.score,
      mapScores: this.ensureMapScores(room),
      winnerTeam: room.winnerTeam,
      winnerName: room.winnerName,
      resultScreenshot: room.resultScreenshot || (Array.isArray(room.resultScreenshots) ? room.resultScreenshots[0] : null),
      resultScreenshots: Array.isArray(room.resultScreenshots) ? room.resultScreenshots : (room.resultScreenshot ? [room.resultScreenshot] : []),
      finishedAt: room.finishedAt,
      selectedMaps: room.selectedMaps,
      chatMessages: room.chatMessages || [],
      captains: this.getCaptains(room),
      players: room.players.map((player) => this.serializePlayer(player, room)),
      slots: {
        A: this.getSlots(room, 'A'),
        B: this.getSlots(room, 'B')
      },
      veto: room.veto
        ? {
            round: room.veto.round,
            maps: room.veto.maps,
            startingTeam: room.veto.startingTeam,
            currentTurnIndex: room.veto.currentTurnIndex,
            currentAction: this.getCurrentAction(room),
            actions: room.veto.actions,
            history: room.veto.history,
            selectedMap: room.veto.selectedMap,
            createdAt: room.veto.createdAt
          }
        : null
    };
  }

  serializePlayer(player, room = null) {
    const captain = room ? this.getTeamCaptain(room, player.team) : null;
    return {
      id: player.id,
      socketId: player.socketId,
      name: player.name,
      team: player.team,
      slot: player.slot,
      ready: player.ready,
      connected: player.connected,
      joinedAt: player.joinedAt,
      isCaptain: captain?.id === player.id
    };
  }

  getCaptains(room) {
    return {
      A: this.getTeamCaptain(room, 'A')?.id || null,
      B: this.getTeamCaptain(room, 'B')?.id || null
    };
  }

  getSlots(room, team) {
    const slots = Array.from({ length: room.teamSize }, () => null);
    room.players
      .filter((player) => player.team === team)
      .forEach((player) => {
        slots[player.slot] = this.serializePlayer(player, room);
      });
    return slots;
  }

  addPlayer(roomId, { socketId, name, team, password, skipPasswordCheck = false }) {
    const room = this.getRoom(roomId);
    if (!room) throw new Error('Комната не найдена');
    if (!skipPasswordCheck && !this.checkPassword(roomId, password)) throw new Error('Неверный пароль');

    if (room.stage !== 'lobby') {
      throw new Error('Матч уже начался. Новые игроки не могут занимать слот, но комнату можно смотреть.');
    }

    const cleanName = String(name || '').trim();
    if (!cleanName) throw new Error('Сначала введите ник на главной странице');

    const existing = room.players.find((player) => player.socketId === socketId);
    if (existing) {
      existing.name = cleanName;
      existing.connected = true;
      return existing;
    }

    const assigned = this.findFreeSlot(room, team);
    if (!assigned) throw new Error('В выбранной команде нет свободных слотов');

    const player = {
      id: crypto.randomUUID(),
      socketId,
      name: cleanName,
      team: assigned.team,
      slot: assigned.slot,
      ready: false,
      connected: true,
      joinedAt: Date.now()
    };

    room.players.push(player);
    this.ensureCaptain(room, assigned.team);
    this.maybeStartVeto(room);
    return player;
  }

  findFreeSlot(room, requestedTeam) {
    const normalizedTeam = requestedTeam === 'A' || requestedTeam === 'B' ? requestedTeam : null;

    if (normalizedTeam) {
      const slot = this.findFirstFreeSlot(room, normalizedTeam);
      return slot === -1 ? null : { team: normalizedTeam, slot };
    }

    const countA = room.players.filter((player) => player.team === 'A').length;
    const countB = room.players.filter((player) => player.team === 'B').length;
    const order = countA <= countB ? ['A', 'B'] : ['B', 'A'];

    for (const team of order) {
      const slot = this.findFirstFreeSlot(room, team);
      if (slot !== -1) return { team, slot };
    }

    return null;
  }

  findFirstFreeSlot(room, team) {
    const usedSlots = new Set(room.players.filter((player) => player.team === team).map((player) => player.slot));
    for (let slot = 0; slot < room.teamSize; slot += 1) {
      if (!usedSlots.has(slot)) return slot;
    }
    return -1;
  }

  toggleReady(roomId, socketId) {
    const room = this.getRoom(roomId);
    if (!room) throw new Error('Комната не найдена');
    if (room.stage !== 'lobby') throw new Error('Готовность можно менять только на стадии сбора игроков');

    const player = room.players.find((item) => item.socketId === socketId);
    if (!player) throw new Error('Вы не занимаете слот в этой комнате');

    player.ready = !player.ready;
    this.maybeStartVeto(room);
    return player;
  }


  leavePlayer(roomId, socketId) {
    const room = this.getRoom(roomId);
    if (!room) throw new Error('Комната не найдена');
    if (room.stage !== 'lobby') throw new Error('Освободить слот можно только до старта MAP VETO');

    const playerIndex = room.players.findIndex((player) => player.socketId === socketId);
    if (playerIndex === -1) throw new Error('Вы не занимаете слот в этой комнате');

    const [removedPlayer] = room.players.splice(playerIndex, 1);
    this.ensureCaptain(room, removedPlayer.team);
    return removedPlayer;
  }

  resumePlayer(roomId, playerId, socketId) {
    const room = this.getRoom(roomId);
    if (!room) throw new Error('Комната не найдена');
    const player = room.players.find((item) => item.id === playerId);
    if (!player) throw new Error('Игрок не найден');

    player.socketId = socketId;
    player.connected = true;
    this.ensureCaptain(room, player.team);
    return player;
  }

  transferCaptain(roomId, socketId, targetPlayerId) {
    const room = this.getRoom(roomId);
    if (!room) throw new Error('Комната не найдена');
    if (room.stage === 'finished') throw new Error('Матч уже завершён');

    const currentPlayer = room.players.find((player) => player.socketId === socketId);
    if (!currentPlayer) throw new Error('Вы не занимаете слот в этой комнате');

    const currentCaptain = this.getTeamCaptain(room, currentPlayer.team);
    if (!currentCaptain || currentCaptain.id !== currentPlayer.id) {
      throw new Error('Передавать капитана может только текущий капитан команды');
    }

    const targetPlayer = room.players.find((player) => player.id === targetPlayerId);
    if (!targetPlayer) throw new Error('Игрок не найден');
    if (targetPlayer.team !== currentPlayer.team) throw new Error('Капитана можно передать только игроку своей команды');
    if (targetPlayer.id === currentPlayer.id) throw new Error('Вы уже капитан');

    room.captains ||= { A: null, B: null };
    room.captains[currentPlayer.team] = targetPlayer.id;
    return targetPlayer;
  }

  maybeStartVeto(room) {
    if (room.stage !== 'lobby') return;

    const fullTeamA = room.players.filter((player) => player.team === 'A').length === room.teamSize;
    const fullTeamB = room.players.filter((player) => player.team === 'B').length === room.teamSize;
    const allReady = room.players.length === room.maxPlayers && room.players.every((player) => player.ready);

    if (fullTeamA && fullTeamB && allReady) {
      if ((room.game || 'cs2') === 'dota2') {
        room.stage = 'live';
        room.selectedMaps = Array.from({ length: room.targetMaps || 1 }, (_, index) => ({
          round: index + 1,
          map: `DOTA GAME ${index + 1}`,
          pickedBy: null,
          pickedByName: 'MANA System',
          createdAt: Date.now()
        }));
      } else {
        this.startVeto(room);
      }
    }
  }

  startVeto(room) {
    const startingTeam = Math.random() < 0.5 ? 'A' : 'B';

    room.stage = 'veto';
    room.veto = {
      round: 1,
      maps: MAP_POOL.map((name) => ({ name, status: 'available', actedBy: null })),
      startingTeam,
      actions: buildVetoActions(room.matchFormat, startingTeam),
      currentTurnIndex: 0,
      history: [],
      selectedMap: null,
      createdAt: Date.now()
    };
  }

  startNextVeto(roomId) {
    const room = this.getRoom(roomId);
    if (!room) throw new Error('Комната не найдена');
    throw new Error('BO3 выбирается одним veto на 7 картах. Следующее veto запускать не нужно.');
  }

  getCurrentAction(room) {
    if (!room.veto || room.stage !== 'veto') return null;
    return room.veto.actions[room.veto.currentTurnIndex] || null;
  }

  ensureCaptain(room, team) {
    room.captains ||= { A: null, B: null };
    const existingCaptain = room.players.find((player) => player.team === team && player.id === room.captains[team]);
    if (existingCaptain) return existingCaptain;

    const nextCaptain = room.players
      .filter((player) => player.team === team)
      .sort((a, b) => a.slot - b.slot || a.joinedAt - b.joinedAt)[0] || null;

    room.captains[team] = nextCaptain?.id || null;
    return nextCaptain;
  }

  getTeamCaptain(room, team) {
    return this.ensureCaptain(room, team);
  }

  applyVetoAction(roomId, { socketId, mapName }) {
    const room = this.getRoom(roomId);
    if (!room) throw new Error('Комната не найдена');
    if (room.stage !== 'veto' || !room.veto) throw new Error('Veto сейчас не активно');

    const currentAction = this.getCurrentAction(room);
    if (!currentAction) throw new Error('Нет активного хода');

    const captain = this.getTeamCaptain(room, currentAction.team);
    if (!captain || captain.socketId !== socketId) {
      throw new Error('Только капитан текущей команды может выполнять ban/pick');
    }

    const map = room.veto.maps.find((item) => item.name === mapName);
    if (!map) throw new Error('Карта не найдена');
    if (map.status !== 'available') throw new Error('Эта карта уже недоступна');

    map.status = currentAction.type === 'ban' ? 'banned' : 'picked';
    map.actedBy = currentAction.team;

    room.veto.history.push({
      team: currentAction.team,
      type: currentAction.type,
      map: map.name,
      byPlayerId: captain.id,
      byPlayerName: captain.name,
      createdAt: Date.now()
    });

    if (currentAction.type === 'pick') {
      room.selectedMaps.push({
        round: room.selectedMaps.length + 1,
        map: map.name,
        pickedBy: currentAction.team,
        pickedByName: captain.name,
        createdAt: Date.now()
      });
    }

    room.veto.currentTurnIndex += 1;

    if (!this.getCurrentAction(room)) {
      this.finalizeVeto(room);
    }
  }

  finalizeVeto(room) {
    const remainingMaps = room.veto.maps.filter((item) => item.status === 'available');
    const finalMap = remainingMaps[0];

    if (!finalMap) {
      room.stage = 'live';
      return;
    }

    finalMap.status = 'picked';
    finalMap.actedBy = null;
    room.veto.selectedMap = finalMap.name;

    const isBo3Decider = room.matchFormat === 'BO3';

    room.veto.history.push({
      team: null,
      type: isBo3Decider ? 'decider' : 'final',
      map: finalMap.name,
      byPlayerId: null,
      byPlayerName: isBo3Decider ? 'MANA Decider' : 'MANA System',
      createdAt: Date.now()
    });

    room.selectedMaps.push({
      round: room.selectedMaps.length + 1,
      map: finalMap.name,
      pickedBy: null,
      pickedByName: isBo3Decider ? 'Decider' : 'Auto final',
      createdAt: Date.now()
    });

    // После MAP VETO матч переходит в live-стадию, а не закрывается.
    room.stage = 'live';
  }


  ensureMapScores(room) {
    room.mapScores ||= [];
    const existingByRound = new Map(room.mapScores.map((item) => [item.round, item]));

    room.mapScores = room.selectedMaps.map((selectedMap, index) => {
      const round = selectedMap.round || index + 1;
      const existing = existingByRound.get(round) || {};
      return {
        round,
        map: selectedMap.map,
        A: Number.isFinite(Number(existing.A)) ? Math.max(0, Number(existing.A)) : 0,
        B: Number.isFinite(Number(existing.B)) ? Math.max(0, Number(existing.B)) : 0
      };
    });

    return room.mapScores;
  }

  parseScoreNumber(value) {
    const parsed = Number.parseInt(String(value ?? 0), 10);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  }

  updateScore(roomId, score) {
    const room = this.getRoom(roomId);
    if (!room) throw new Error('Комната не найдена');
    if (room.stage !== 'live' && room.stage !== 'finished') throw new Error('Счёт можно менять только после MAP VETO');

    room.score = {
      A: this.parseScoreNumber(score?.A ?? score?.teamA),
      B: this.parseScoreNumber(score?.B ?? score?.teamB)
    };

    const incomingMapScores = Array.isArray(score?.mapScores) ? score.mapScores : [];
    const byRound = new Map(incomingMapScores.map((item) => [Number(item.round), item]));

    room.mapScores = room.selectedMaps.map((selectedMap, index) => {
      const round = selectedMap.round || index + 1;
      const incoming = byRound.get(round) || {};
      const previous = (room.mapScores || []).find((item) => item.round === round) || {};

      return {
        round,
        map: selectedMap.map,
        A: this.parseScoreNumber(incoming.A ?? previous.A),
        B: this.parseScoreNumber(incoming.B ?? previous.B)
      };
    });

    return { score: room.score, mapScores: room.mapScores };
  }

  finishMatch(roomId, winnerTeam, isAdmin = false) {
    const room = this.getRoom(roomId);
    if (!room) throw new Error('Комната не найдена');
    if (!isAdmin) throw new Error('Победителя теперь выставляет только админ после проверки скриншотов.');
    if (room.stage !== 'live' && room.stage !== 'finished') throw new Error((room.game || 'cs2') === 'dota2' ? 'Завершить матч можно только после старта игры' : 'Завершить матч можно только после MAP VETO');

    const normalizedWinner = winnerTeam === 'A' || winnerTeam === 'B' ? winnerTeam : null;
    if (!normalizedWinner) throw new Error('Выбери победителя: Team A или Team B');

    room.winnerTeam = normalizedWinner;
    room.winnerName = normalizedWinner === 'A' ? room.teamAName : room.teamBName;
    room.stage = 'finished';
    room.finishedAt = Date.now();
    this.releaseServer(room);

    return room;
  }

  uploadResultScreenshot(roomId, dataUrl, replaceIndex = null) {
    const room = this.getRoom(roomId);
    if (!room) throw new Error('Комната не найдена');
    const text = String(dataUrl || '');
    if (!/^data:image\/(png|jpeg|jpg|webp);base64,/.test(text)) throw new Error('Разрешены только PNG, JPG или WEBP.');
    if (text.length > 4_500_000) throw new Error('Скриншот слишком большой. Сожми изображение до 3-4 MB.');

    const limit = room.matchFormat === 'BO3' ? 3 : 1;
    const current = Array.isArray(room.resultScreenshots)
      ? [...room.resultScreenshots]
      : (room.resultScreenshot ? [room.resultScreenshot] : []);

    const replacement = Number.isInteger(Number(replaceIndex)) ? Number(replaceIndex) : null;
    if (replacement !== null && replacement >= 0 && replacement < current.length) {
      current[replacement] = text;
    } else {
      if (current.length >= limit) {
        throw new Error(room.matchFormat === 'BO3'
          ? 'Для BO3 можно загрузить максимум 3 скриншота результата.'
          : 'Для BO1 можно загрузить только 1 скриншот результата.');
      }
      current.push(text);
    }
    room.resultScreenshots = current;
    room.resultScreenshot = current[0] || null;
    return room;
  }


  sanitizeChatText(value, limit = 300) {
    return String(value || '')
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
      .replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, '')
      .replace(/<img[\s\S]*?>/gi, '')
      .replace(/<[^>]*>/g, '')
      .replace(/[<>]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, limit);
  }

  assertChatCooldown(socketId, scope) {
    const key = `${scope}:${socketId || 'anon'}`;
    const now = Date.now();
    const last = this.chatCooldowns.get(key) || 0;
    if (now - last < 1200) throw new Error('Слишком часто. Подожди секунду перед следующим сообщением.');
    this.chatCooldowns.set(key, now);
  }

  createChatMessage({ scope, roomId = null, socketId, nickname, text, image = null, skipCooldown = false }) {
    if (!skipCooldown) this.assertChatCooldown(socketId, scope);
    const cleanNickname = this.sanitizeChatText(nickname || 'Player', 24) || 'Player';
    const cleanTextValue = this.sanitizeChatText(text, scope === 'admin' ? 500 : 300);
    const cleanImage = image ? this.validateChatImage(image) : null;
    if (!cleanTextValue && !cleanImage) throw new Error('Сообщение не может быть пустым');

    return {
      id: crypto.randomUUID(),
      scope,
      roomId,
      socketId,
      nickname: cleanNickname,
      text: cleanTextValue,
      image: cleanImage,
      createdAt: Date.now()
    };
  }

  validateChatImage(image) {
    const text = String(image || '');
    if (!/^data:image\/(png|jpeg|jpg|webp);base64,/.test(text)) throw new Error('В админ-чат можно прикрепить только PNG, JPG или WEBP.');
    if (text.length > 3_500_000) throw new Error('Картинка слишком большая. Лимит примерно 3 MB.');
    return text;
  }

  getGlobalMessages() {
    return this.globalMessages.slice(-80);
  }

  addGlobalMessage({ socketId, nickname, text }) {
    const message = this.createChatMessage({ scope: 'global', socketId, nickname, text });
    this.globalMessages.push(message);
    this.globalMessages = this.globalMessages.slice(-120);
    return message;
  }

  getAdminMessages() {
    return this.adminMessages.slice(-120);
  }

  addAdminMessage({ socketId, nickname, text, image }) {
    const message = this.createChatMessage({ scope: 'admin', socketId, nickname, text, image });
    this.adminMessages.push(message);
    this.adminMessages = this.adminMessages.slice(-180);
    return message;
  }

  getRoomMessages(roomId) {
    const room = this.getRoom(roomId);
    if (!room) throw new Error('Комната не найдена');
    room.chatMessages ||= [];
    return room.chatMessages.slice(-80);
  }

  addRoomMessage(roomId, { socketId, nickname, text }) {
    const room = this.getRoom(roomId);
    if (!room) throw new Error('Комната не найдена');
    room.chatMessages ||= [];
    const message = this.createChatMessage({ scope: 'room', roomId, socketId, nickname, text });
    room.chatMessages.push(message);
    room.chatMessages = room.chatMessages.slice(-120);
    return message;
  }


  clearChats(scope = 'global', actor = 'admin') {
    const normalizedScope = ['global', 'admin', 'room', 'all'].includes(scope) ? scope : 'global';

    if (normalizedScope === 'global' || normalizedScope === 'all') {
      this.globalMessages = [];
    }

    if (normalizedScope === 'admin' || normalizedScope === 'all') {
      this.adminMessages = [];
    }

    if (normalizedScope === 'room' || normalizedScope === 'all') {
      this.rooms.forEach((room) => {
        room.chatMessages = [];
      });
    }

    this.addAdminLog('chat:clear', { scope: normalizedScope }, actor);
    return normalizedScope;
  }



  getPastTournaments(game = null) {
    const normalizedGame = game ? normalizeGame(game) : null;
    return normalizedGame ? this.pastTournaments.filter((item) => (item.game || 'cs2') === normalizedGame) : this.pastTournaments;
  }

  getPastTournament(id) {
    return this.pastTournaments.find((item) => item.id === id) || null;
  }

  createPastTournament(data = {}, actor = 'admin') {
    const game = normalizeGame(data.game);
    const title = cleanText(data.title, game === 'dota2' ? 'MANA DOTA 2 CUP' : 'MANA CS2 CUP').slice(0, 60);
    const idBase = title.toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '-').replace(/^-|-$/g, '').slice(0, 48) || 'mana-tournament';
    const item = {
      id: `${idBase}-${Date.now()}`,
      game,
      title,
      date: cleanText(data.date, String(new Date().getFullYear())).slice(0, 24),
      bannerImage: cleanText(data.bannerImage, game === 'dota2' ? '/assets/dota/dota-tournament.svg' : '/assets/tournaments/mana-cup-banner.svg'),
      description: cleanText(data.description, 'Описание турнира можно изменить в админке.').slice(0, 240),
      podium: [1, 2, 3].map((place) => ({
        place,
        teamName: cleanText(data[`place${place}Team`], `TEAM ${place}`).slice(0, 40),
        teamPhoto: cleanText(data[`place${place}Photo`], game === 'dota2' ? `/assets/dota/dota-team-${place === 1 ? 'first' : place === 2 ? 'second' : 'third'}.svg` : `/assets/teams/team-${place === 1 ? 'first' : place === 2 ? 'second' : 'third'}.svg`),
        players: cleanText(data[`place${place}Players`], 'Player 1, Player 2, Player 3, Player 4, Player 5')
          .split(/[,\n]/)
          .map((name) => this.sanitizeChatText(name, 28))
          .filter(Boolean)
          .slice(0, 8)
      }))
    };
    this.pastTournaments.unshift(item);
    this.addAdminLog('past:create', { id: item.id, title: item.title, game }, actor);
    return item;
  }

  deletePastTournament(id, actor = 'admin') {
    const index = this.pastTournaments.findIndex((item) => item.id === id);
    if (index === -1) throw new Error('Турнир не найден');
    const [removed] = this.pastTournaments.splice(index, 1);
    this.addAdminLog('past:delete', { id: removed.id, title: removed.title, game: removed.game }, actor);
    return removed;
  }

  deleteRoom(roomId) {
    const roomIndex = this.rooms.findIndex((room) => room.id === roomId);
    if (roomIndex === -1) throw new Error('Матч не найден');
    const [room] = this.rooms.splice(roomIndex, 1);
    this.releaseServer(room);
    return room;
  }

  handleDisconnect(socketId) {
    const updatedRoomIds = [];

    for (const room of this.rooms) {
      const playerIndex = room.players.findIndex((player) => player.socketId === socketId);
      if (playerIndex === -1) continue;

      const affectedTeam = room.players[playerIndex].team;

      room.players[playerIndex].connected = false;

      this.ensureCaptain(room, affectedTeam);
      updatedRoomIds.push(room.id);
    }

    return updatedRoomIds;
  }
}

RoomManager.SERVER_POOLS = SERVER_POOLS;
RoomManager.normalizeGame = normalizeGame;
module.exports = RoomManager;
