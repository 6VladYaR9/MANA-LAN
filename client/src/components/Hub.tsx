import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import ManaLogo from './ManaLogo';
import SideOperatives from './SideOperatives';
import { socket } from '../socket';
import { emitWithAck, isAdminAuthError } from '../socketAck';
import { getRoomAccessToken, setRoomAccessToken } from '../roomAccess';
import type { Club, GameType, MatchFormat, RoomSummary, SocketAck } from '../types';
import './Hub.css';

type RoomsPayload = { rooms: RoomSummary[] };
type CreateRoomAck = SocketAck<{ room: { id: string }; roomAccessToken?: string }>;
type Mode = 1 | 2 | 5;

const CS2_MODES: Array<{ value: Mode; title: string; subtitle: string; button: string }> = [
  { value: 1, title: '1x1', subtitle: 'DUEL MODE · 2 SLOTS', button: 'Создать матч 1x1' },
  { value: 2, title: '2x2', subtitle: 'WINGMAN STYLE · 4 SLOTS', button: 'Создать матч 2x2' },
  { value: 5, title: '5x5', subtitle: 'FULL MATCH · 10 SLOTS', button: 'Создать матч 5x5' }
];

const DOTA_MODES: Array<{ value: Mode; title: string; subtitle: string; button: string }> = [
  { value: 1, title: '1x1', subtitle: 'MID DUEL · 2 SLOTS', button: 'Создать Dota 1x1' },
  { value: 5, title: '5x5', subtitle: 'FULL PARTY · 10 SLOTS', button: 'Создать Dota 5x5' }
];

function statusLabel(room: RoomSummary) {
  if (room.stage === 'locked') return 'ЗАКРЫТО';
  if (room.stage === 'lobby') return 'СБОР ИГРОКОВ';
  if (room.stage === 'veto') return 'MAP VETO';
  if (room.stage === 'live') return 'МАТЧ ИДЁТ';
  return 'МАТЧ ЗАВЕРШЁН';
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function selectedMapsText(room: RoomSummary) {
  if (!room.selectedMaps.length) return '';
  return room.selectedMaps.map((item) => item.map).join(', ');
}

export default function Hub({
  game,
  nickname,
  onNicknameChange,
  isAdmin,
  adminToken,
  onAdminLogout
}: {
  game: GameType;
  nickname: string;
  onNicknameChange: (nickname: string) => void;
  isAdmin: boolean;
  adminToken: string;
  onAdminLogout: () => void;
}) {
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [selectedMode, setSelectedMode] = useState<Mode>(1);
  const [createModal, setCreateModal] = useState<Mode | null>(null);
  const [passwordModal, setPasswordModal] = useState<{ roomId: string; password: string; error: string } | null>(null);
  const [nicknameDraft, setNicknameDraft] = useState(nickname);
  const [showNicknameEditor, setShowNicknameEditor] = useState(false);
  const [error, setError] = useState('');
  const [passwordChecking, setPasswordChecking] = useState(false);
  const [deletingRoomId, setDeletingRoomId] = useState('');
  const passwordRequestIdRef = useRef(0);

  useEffect(() => {
    void emitWithAck<RoomsPayload>('rooms:get').then((response) => {
      if (response.ok) setRooms(response.rooms);
      else setError(response.error);
    });

    const onRoomsUpdate = (payload: RoomsPayload) => setRooms(payload.rooms);
    const onConnectError = () => setError('Нет соединения с backend. Проверь, что сервер запущен на порту 3001.');

    socket.on('rooms:update', onRoomsUpdate);
    socket.on('connect_error', onConnectError);
    return () => {
      socket.off('rooms:update', onRoomsUpdate);
      socket.off('connect_error', onConnectError);
    };
  }, []);

  useEffect(() => {
    setNicknameDraft(nickname);
  }, [nickname]);

  const modes = game === 'dota2' ? DOTA_MODES : CS2_MODES;
  const selectedModeInfo = useMemo(() => modes.find((mode) => mode.value === selectedMode) || modes[0], [modes, selectedMode]);
  const gameRooms = rooms.filter((room) => (room.game || 'cs2') === game);
  const activeRooms = gameRooms.filter((room) => room.stage !== 'finished');
  const finishedRooms = gameRooms.filter((room) => room.stage === 'finished');

  useEffect(() => {
    if (game === 'dota2' && selectedMode === 2) setSelectedMode(1);
  }, [game, selectedMode]);

  const saveNickname = (event: FormEvent) => {
    event.preventDefault();
    const cleanNickname = nicknameDraft.trim();

    if (cleanNickname.length < 2) {
      setError('Ник должен быть минимум 2 символа');
      return;
    }

    onNicknameChange(cleanNickname);
    setShowNicknameEditor(false);
    setError('');
  };

  const connectToRoom = (room: RoomSummary) => {
    setError('');

    if (room.hasPassword && !isAdmin && !getRoomAccessToken(room.id)) {
      setPasswordModal({ roomId: room.id, password: '', error: '' });
      return;
    }

    navigate(`/room/${room.id}`);
  };

  const submitRoomPassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!passwordModal || passwordChecking) return;

    const requestId = passwordRequestIdRef.current + 1;
    passwordRequestIdRef.current = requestId;
    const requestRoomId = passwordModal.roomId;
    const requestPassword = passwordModal.password;
    setPasswordChecking(true);
    const response = await emitWithAck<{ roomAccessToken?: string }>('room:checkPassword', { roomId: requestRoomId, password: requestPassword });
    if (passwordRequestIdRef.current !== requestId) return;
    setPasswordChecking(false);
    if (!response.ok) {
      setPasswordModal((current) => current?.roomId === requestRoomId ? { ...current, error: response.error } : current);
      return;
    }

    setRoomAccessToken(requestRoomId, response.roomAccessToken || '');
    navigate(`/room/${requestRoomId}`);
  };


  const closeRoom = (room: RoomSummary) => {
    const message = room.stage === 'finished'
      ? `Убрать завершённый матч ${room.teamAName} vs ${room.teamBName} из списка?`
      : `Закрыть матч ${room.teamAName} vs ${room.teamBName} и освободить сервер?`;

    if (!window.confirm(message)) return;
    if (deletingRoomId) return;

    setError('');
    setDeletingRoomId(room.id);
    void emitWithAck('rooms:delete', { roomId: room.id, adminToken }).then((response: SocketAck) => {
      setDeletingRoomId('');
      if (!response.ok) {
        setError(response.error);
        if (isAdminAuthError(response.error)) onAdminLogout();
      }
    });
  };

  return (
    <>
      <SideOperatives />
      <main className="appShell hubPage hasDecor" data-testid="hub-page">
        <header className="topBar">
          <ManaLogo />
          <div className="topActions">
            <button type="button" className="miniBadge navLink gameSwitchLink disabledNavButton" disabled title="Dota 2 пока в разработке">DOTA 2 · В разработке</button>
            <Link className="miniBadge navLink" to="/bracket">Просмотр сетки</Link>
            <Link className="miniBadge navLink" to="/past">Прошлые турниры</Link>
            <div className="adminNavGroup">
              {isAdmin ? (
                <>
                  <Link className="miniBadge navLink adminTopButton" to="/admin">Админ панель</Link>
                  <button type="button" className="miniBadge navLink logoutTopButton" onClick={onAdminLogout}>Выйти</button>
                </>
              ) : (
                <Link className="miniBadge navLink adminTopButton" to="/admin">Админ</Link>
              )}
            </div>
          </div>
        </header>

        <section className="hubHero">
          <div className="heroCopy">
            <div className="eyebrow">MANA KIROV · CS2 MATCH HUB</div>
            <h1>DON'T PLAY <span>ALONE</span></h1>
            <p className="muted upper">Админ создаёт матч, игроки заходят в комнату, занимают слоты, жмут готовность и загружают скриншоты результата.</p>
          </div>
          <a className="heroQrCard" href="https://vk.com/mana_kirov" target="_blank" rel="noreferrer" aria-label="Группа MANA Kirov во ВКонтакте">
            <img src="/assets/vk-mana-qr.png" alt="QR-код на группу MANA Kirov во ВКонтакте" />
            <div>
              <span>VK COMMUNITY</span>
              <b>@mana_kirov</b>
              <small>Сканируй QR или нажми</small>
            </div>
          </a>
        </section>

        <section className="nickStrip">
          <div className="nickInfo">
            <b>Твой ник</b>
            <span>{nickname}</span>
          </div>
          <button type="button" onClick={() => setShowNicknameEditor(true)}>Обновить ник</button>
        </section>

        <section className="bookingTitle">
          <h2>MATCH <span>BOOKING</span></h2>
          <p>Админ выбирает размер команды, клуб, формат BO1/BO3 и пароль. Игроки видят только готовые матчи и подключаются к ним.</p>
        </section>

        {isAdmin ? (
          <section className="modePanel adminModePanel">
            <div className="modeIntro">
              <span>Новый матч</span>
              <h3>Выбор формата</h3>
              <p>{game === 'cs2' ? 'После создания сервер резервируется до ручного завершения матча.' : 'Dota-матч идёт без veto, но с BO1/BO3 и скриншотами результата.'}</p>
            </div>
            <div className="modeCards">
              {modes.map((mode) => (
                <button
                  type="button"
                  key={mode.value}
                  data-testid={`mode-${mode.value}`}
                  className={`modeCard ${selectedMode === mode.value ? 'active' : ''}`}
                  onClick={() => setSelectedMode(mode.value)}
                >
                  <b>{mode.title}</b>
                  <span>{mode.subtitle}</span>
                </button>
              ))}
            </div>
            <button type="button" className="createBtn" data-testid="create-room-button" onClick={() => setCreateModal(selectedMode)}>
              {selectedModeInfo.button}
            </button>
          </section>
        ) : (
          <section className="playerNoticePanel">
            <div>
              <span>Режим игрока</span>
              <h3>Ожидай созданный матч</h3>
              <p>Создание комнат и выбор формата скрыты. Когда админ создаст матч, он появится ниже в списке активных матчей.</p>
            </div>
            <Link className="playerAdminLink" to="/admin">Вход для админа</Link>
          </section>
        )}

        {error && <div className="errorBox">{error}</div>}

        <RoomsBlock game={game} title="Активные матчи" rooms={activeRooms} empty="Комнат пока нет" connectToRoom={connectToRoom} closeRoom={closeRoom} isAdmin={isAdmin} />
        <RoomsBlock game={game} title="Завершённые матчи" rooms={finishedRooms} empty="Завершённых матчей пока нет" connectToRoom={connectToRoom} closeRoom={closeRoom} isAdmin={isAdmin} />

        {createModal && (
          <CreateMatchModal
            game={game}
            adminToken={adminToken}
            mode={createModal}
            onClose={() => setCreateModal(null)}
            onCreated={(roomId, roomAccessToken) => {
              setRoomAccessToken(roomId, roomAccessToken);
              navigate(`/room/${roomId}`);
            }}
            onError={setError}
            onAdminAuthError={onAdminLogout}
          />
        )}

        {showNicknameEditor && (
          <div className="modalBackdrop">
            <div className="modal microModal">
              <h2>Сменить ник</h2>
              <form className="modalForm" onSubmit={saveNickname}>
                <input
                  autoFocus
                  value={nicknameDraft}
                  onChange={(event) => setNicknameDraft(event.target.value)}
                  maxLength={24}
                  required
                />
                <div className="modalActions">
                  <button type="submit">Сохранить</button>
                  <button type="button" className="ghostBtn" onClick={() => setShowNicknameEditor(false)}>Отмена</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {passwordModal && (
          <div className="modalBackdrop">
            <div className="modal microModal" data-testid="room-password-modal">
              <h2>Пароль комнаты</h2>
              <form className="modalForm" onSubmit={submitRoomPassword}>
                <input
                  data-testid="room-password-input"
                  autoFocus
                  type="password"
                  value={passwordModal.password}
                  onChange={(event) => setPasswordModal({ ...passwordModal, password: event.target.value, error: '' })}
                  placeholder="Введите пароль"
                  required
                />
                {passwordModal.error && <p className="errorText" data-testid="room-password-error">{passwordModal.error}</p>}
                <div className="modalActions">
                  <button type="submit" data-testid="room-password-submit" disabled={passwordChecking}>{passwordChecking ? 'Проверяю...' : 'Войти'}</button>
                  <button
                    type="button"
                    className="ghostBtn"
                    onClick={() => {
                      passwordRequestIdRef.current += 1;
                      setPasswordModal(null);
                      setPasswordChecking(false);
                    }}
                  >Отмена</button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </>
  );
}

function RoomsBlock({
  game,
  title,
  rooms,
  empty,
  connectToRoom,
  closeRoom,
  isAdmin
}: {
  game: GameType;
  title: string;
  rooms: RoomSummary[];
  empty: string;
  connectToRoom: (room: RoomSummary) => void;
  closeRoom: (room: RoomSummary) => void;
  isAdmin: boolean;
}) {
  return (
    <section className="roomsSection">
      <div className="sectionHeaderLine">
        <h3>{title}</h3>
        <span>{rooms.length}</span>
      </div>

      {rooms.length === 0 ? (
        <div className="emptyRooms compactEmpty"><h3>{empty}</h3></div>
      ) : (
        <div className="roomsList">
          {rooms.map((room) => (
            <article
              className={`roomCard ${room.stage === 'finished' ? 'finishedRoomCard' : ''}`}
              data-testid="room-card"
              data-room-id={room.id}
              data-room-stage={room.stage}
              key={room.id}
            >
              <div className="roomMain">
                <div className="roomMeta">
                  <span>{room.club}</span>
                  <span>{room.teamSize}x{room.teamSize}</span>
                  <span>{room.matchFormat}</span>
                  <span>{formatTime(room.createdAt)}</span>
                  <span>{statusLabel(room)}</span>
                  {room.hasPassword && <span>LOCK</span>}
                </div>
                <h3>{room.teamAName} <em>vs</em> {room.teamBName}</h3>
                <p>
                  Игроки: {room.playersCount}/{room.maxPlayers} · Счёт: {room.score?.A ?? 0}:{room.score?.B ?? 0}
                  {selectedMapsText(room) ? ` · Карты: ${selectedMapsText(room)}` : ''}
                  {room.winnerName ? ` · Победитель: ${room.winnerName}` : ''}
                </p>
                <p className="serverLine">{game === 'cs2' ? `CS2: ${room.gameServerAddress} · GOTV: ${room.gotvAddress}` : 'Dota 2: лобби создаётся админом в клиенте игры'}</p>
              </div>
              <div className="roomCardActions">
                <button type="button" data-testid="room-card-open" onClick={() => connectToRoom(room)}>
                  {room.stage === 'finished' ? 'Смотреть' : 'Подключиться'}
                </button>
                {isAdmin && (
                  <button type="button" className="ghostBtn closeRoomButton" onClick={() => closeRoom(room)}>
                    Закрыть
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function CreateMatchModal({
  game,
  adminToken,
  mode,
  onClose,
  onCreated,
  onError,
  onAdminAuthError
}: {
  game: GameType;
  adminToken: string;
  mode: Mode;
  onClose: () => void;
  onCreated: (roomId: string, roomAccessToken: string) => void;
  onError: (message: string) => void;
  onAdminAuthError: () => void;
}) {
  const [club, setClub] = useState<Club>('ЮЗ');
  const [matchFormat, setMatchFormat] = useState<MatchFormat>('BO1');
  const [teamAName, setTeamAName] = useState('Team A');
  const [teamBName, setTeamBName] = useState('Team B');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState('');
  const [creating, setCreating] = useState(false);

  const createRoom = (event: FormEvent) => {
    event.preventDefault();
    setLocalError('');
    onError('');

    if (!teamAName.trim() || !teamBName.trim()) {
      setLocalError('Заполни названия обеих команд');
      return;
    }

    setCreating(true);
    void emitWithAck<{ room: { id: string }; roomAccessToken?: string }>('rooms:create', {
      teamAName: teamAName.trim(),
      teamBName: teamBName.trim(),
      club,
      password: password.trim(),
      teamSize: mode,
      matchFormat,
      game,
      adminToken
    }).then((response: CreateRoomAck) => {
        setCreating(false);
        if (!response.ok) {
          setLocalError(response.error);
          onError(response.error);
          if (isAdminAuthError(response.error)) onAdminAuthError();
          return;
        }

        onCreated(response.room.id, response.roomAccessToken || '');
      });
  };

  return (
    <div className="modalBackdrop">
      <div className="modal createMatchModal" data-testid="create-room-modal">
        <div className="modalHead">
          <div>
            <span>Новый матч MANA</span>
            <h2>Создать {game === 'cs2' ? 'CS2' : 'Dota 2'} {mode}x{mode}</h2>
          </div>
          <button type="button" className="xBtn" onClick={onClose}>×</button>
        </div>

        <form className="modalForm" onSubmit={createRoom}>
          <div className="twoFields">
            <label>
              Клуб
              <select value={club} onChange={(event) => setClub(event.target.value as Club)}>
                <option value="ЮЗ">ЮЗ</option>
                <option value="Ленина">Ленина</option>
              </select>
            </label>
            <label>
              Формат матча
              <select value={matchFormat} onChange={(event) => setMatchFormat(event.target.value as MatchFormat)}>
                <option value="BO1">BO1 — 1 карта</option>
                <option value="BO3">BO3 — 3 карты</option>
              </select>
            </label>
          </div>

          <div className="twoFields">
            <label>
              Команда A
              <input data-testid="create-team-a-input" value={teamAName} onChange={(event) => setTeamAName(event.target.value)} maxLength={30} required />
            </label>
            <label>
              Команда B
              <input data-testid="create-team-b-input" value={teamBName} onChange={(event) => setTeamBName(event.target.value)} maxLength={30} required />
            </label>
          </div>

          <label>
            Пароль <small>не обязательно</small>
            <input
              data-testid="create-room-password-input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Можно оставить пустым"
              maxLength={32}
            />
          </label>

          {localError && <p className="errorText">{localError}</p>}

          <div className="modalActions">
            <button type="submit" data-testid="create-room-submit" disabled={creating}>{creating ? 'Создаю...' : `Создать ${mode}x${mode}`}</button>
            <button type="button" className="ghostBtn" onClick={onClose}>Отмена</button>
          </div>
        </form>
      </div>
    </div>
  );
}
