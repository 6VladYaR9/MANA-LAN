export type Team = 'A' | 'B';
export type Stage = 'lobby' | 'veto' | 'live' | 'finished';
export type RoomStatus = 'waiting' | 'in_progress' | 'finished';
export type VetoActionType = 'ban' | 'pick' | 'auto_ban' | 'decider' | 'final';
export type Club = 'ЮЗ' | 'Ленина';
export type MatchFormat = 'BO1' | 'BO3';
export type GameType = 'cs2' | 'dota2';


export type ChatMessage = {
  id: string;
  scope: 'global' | 'room' | 'admin';
  roomId: string | null;
  socketId: string;
  nickname: string;
  text: string;
  image?: string | null;
  createdAt: number;
};

export type Player = {
  id: string;
  socketId: string;
  name: string;
  team: Team;
  slot: number;
  ready: boolean;
  connected: boolean;
  joinedAt: number;
  isCaptain?: boolean;
};

export type GameServer = {
  id: string;
  club: Club;
  name: string;
  ip: string;
  port: number;
  gotvPort: number;
  address: string;
  gotvAddress: string;
  status: 'free' | 'busy' | 'reserved' | 'released';
};

export type MatchScore = {
  A: number;
  B: number;
};

export type MapScore = {
  round: number;
  map: string;
  A: number;
  B: number;
};

export type MapState = {
  name: string;
  status: 'available' | 'banned' | 'picked' | 'autobanned';
  actedBy: Team | null;
};

export type VetoHistoryItem = {
  team: Team | null;
  type: VetoActionType;
  map: string;
  byPlayerId: string | null;
  byPlayerName: string;
  createdAt: number;
};

export type CurrentAction = {
  team: Team;
  type: 'ban' | 'pick';
};

export type SelectedMap = {
  round: number;
  map: string;
  pickedBy: Team | null;
  pickedByName: string;
  createdAt: number;
};

export type VetoState = {
  round: number;
  maps: MapState[];
  startingTeam: Team;
  currentTurnIndex: number;
  currentAction: CurrentAction | null;
  actions?: CurrentAction[];
  history: VetoHistoryItem[];
  selectedMap: string | null;
  createdAt: number;
};

export type Room = {
  id: string;
  game: GameType;
  teamAName: string;
  teamBName: string;
  club: Club;
  matchFormat: MatchFormat;
  targetMaps: number;
  hasPassword: boolean;
  stage: Stage;
  status: RoomStatus;
  gameServerAddress: string;
  gotvAddress: string;
  assignedServer: GameServer | null;
  serverReleased: boolean;
  score: MatchScore;
  mapScores: MapScore[];
  winnerTeam: Team | null;
  winnerName: string;
  resultScreenshot: string | null;
  resultScreenshots: string[];
  finishedAt: number | null;
  teamSize: number;
  maxPlayers: number;
  selectedMaps: SelectedMap[];
  chatMessages: ChatMessage[];
  captains: {
    A: string | null;
    B: string | null;
  };
  players: Player[];
  slots: {
    A: Array<Player | null>;
    B: Array<Player | null>;
  };
  veto: VetoState | null;
};

export type RoomSummary = {
  id: string;
  game: GameType;
  teamAName: string;
  teamBName: string;
  club: Club;
  matchFormat: MatchFormat;
  targetMaps: number;
  hasPassword: boolean;
  stage: Stage;
  status: RoomStatus;
  playersCount: number;
  teamSize: number;
  maxPlayers: number;
  selectedMap: string | null;
  selectedMaps: SelectedMap[];
  gameServerAddress: string;
  gotvAddress: string;
  assignedServer: GameServer | null;
  score: MatchScore;
  mapScores: MapScore[];
  winnerTeam: Team | null;
  winnerName: string;
  resultScreenshot: string | null;
  resultScreenshots: string[];
  finishedAt: number | null;
  createdAt: number;
};

export type SocketAck<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; error: string };
