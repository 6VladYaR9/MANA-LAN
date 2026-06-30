import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import ManaLogo from './ManaLogo';
import RoomChat from './RoomChat';
import SideOperatives from './SideOperatives';
import Veto from './Veto';
import { socket } from '../socket';
import { getRoomAccessToken, setRoomAccessToken } from '../roomAccess';
import { getPlayerSessionToken, setPlayerSessionToken } from '../playerSession';
import type { Player, Room as RoomType, SocketAck, Stage, Team } from '../types';
import './Room.css';

type RoomPayload = { room: RoomType; roomAccessToken?: string; playerSessionToken?: string };
type JoinAck = SocketAck<RoomPayload & { playerId: string; playerSessionToken?: string }>;
type RoomPasswordAck = SocketAck<{ roomAccessToken?: string }>;

function stageLabel(stage: Stage) {
  if (stage === 'lobby') return 'СБОР ИГРОКОВ';
  if (stage === 'veto') return 'MAP VETO';
  if (stage === 'live') return 'МАТЧ ИДЁТ';
  return 'МАТЧ ЗАВЕРШЁН';
}

function teamName(room: RoomType, team: Team) {
  return team === 'A' ? room.teamAName : room.teamBName;
}

function captainForTeam(room: RoomType, team: Team) {
  const captainId = room.captains?.[team];
  const savedCaptain = captainId ? room.players.find((player) => player.id === captainId && player.team === team) : null;
  if (savedCaptain) return savedCaptain;

  return room.players
    .filter((player) => player.team === team)
    .sort((a, b) => a.slot - b.slot || a.joinedAt - b.joinedAt)[0];
}

export default function Room({
  nickname,
  isAdmin,
  adminToken,
  onAdminLogout
}: {
  nickname: string;
  isAdmin: boolean;
  adminToken: string;
  onAdminLogout: () => void;
}) {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const [room, setRoom] = useState<RoomType | null>(null);
  const [socketId, setSocketId] = useState(socket.id || '');
  const [team, setTeam] = useState<'auto' | Team>('auto');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [accessRequired, setAccessRequired] = useState(false);
  const [accessPassword, setAccessPassword] = useState('');

  useEffect(() => {
    const onConnect = () => setSocketId(socket.id || '');
    socket.on('connect', onConnect);
    if (socket.connected) setSocketId(socket.id || '');
    return () => {
      socket.off('connect', onConnect);
    };
  }, []);

  const loadRoom = useCallback((tokenOverride?: string) => {
    if (!roomId) return;

    socket.emit(
      'room:get',
      {
        roomId,
        adminToken,
        roomAccessToken: tokenOverride ?? getRoomAccessToken(roomId),
        playerSessionToken: getPlayerSessionToken(roomId)
      },
      (response: SocketAck<RoomPayload>) => {
        if (!response.ok) {
          if (response.error === 'ROOM_PASSWORD_REQUIRED') {
            setRoom(null);
            setAccessRequired(true);
            setError('');
            return;
          }
          setError(response.error);
          return;
        }
        if (response.roomAccessToken) setRoomAccessToken(roomId, response.roomAccessToken);
        if (response.playerSessionToken) setPlayerSessionToken(roomId, response.playerSessionToken);
        setAccessRequired(false);
        setAccessPassword('');
        setRoom(response.room);
      }
    );
  }, [adminToken, roomId]);

  useEffect(() => {
    if (!roomId) return;

    loadRoom();

    const onRoomUpdate = (payload: RoomPayload) => {
      if (payload.room.id === roomId) setRoom(payload.room);
    };

    const onRoomDeleted = (payload: { roomId: string }) => {
      if (payload.roomId === roomId) navigate('/');
    };

    const onReconnect = () => {
      setSocketId(socket.id || '');
      loadRoom();
    };

    socket.on('room:update', onRoomUpdate);
    socket.on('room:deleted', onRoomDeleted);
    socket.on('connect', onReconnect);
    return () => {
      socket.off('room:update', onRoomUpdate);
      socket.off('room:deleted', onRoomDeleted);
      socket.off('connect', onReconnect);
    };
  }, [loadRoom, navigate, roomId]);

  const currentPlayer = useMemo<Player | null>(() => {
    if (!room || !socketId) return null;
    return room.players.find((player) => player.socketId === socketId) || null;
  }, [room, socketId]);

  const joinRoom = (event: FormEvent) => {
    event.preventDefault();
    if (!roomId) return;
    setError('');

    socket.emit(
      'room:join',
      {
        roomId,
        name: nickname,
        team: team === 'auto' ? null : team,
        roomAccessToken: getRoomAccessToken(roomId)
      },
      (response: JoinAck) => {
        if (!response.ok) {
          setError(response.error);
          return;
        }
        if (response.roomAccessToken) setRoomAccessToken(roomId, response.roomAccessToken);
        if (response.playerSessionToken) setPlayerSessionToken(roomId, response.playerSessionToken);
        setRoom(response.room);
      }
    );
  };

  const toggleReady = () => {
    if (!roomId) return;
    setError('');

    socket.emit('player:toggleReady', { roomId }, (response: SocketAck<RoomPayload>) => {
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setRoom(response.room);
    });
  };


  const leaveSlot = () => {
    if (!roomId) return;
    setError('');

    socket.emit('player:leaveSlot', { roomId }, (response: SocketAck<RoomPayload>) => {
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setRoom(response.room);
    });
  };

  const transferCaptain = (targetPlayerId: string) => {
    if (!roomId) return;
    setError('');

    socket.emit('player:transferCaptain', { roomId, targetPlayerId }, (response: SocketAck<RoomPayload>) => {
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setRoom(response.room);
    });
  };

  const copyConnect = async (address: string, kind: string) => {
    const command = `connect ${address}`;
    try {
      await navigator.clipboard.writeText(command);
      setCopied(`${kind}: ${command}`);
      window.setTimeout(() => setCopied(''), 2200);
    } catch {
      setCopied(`Скопируй вручную: ${command}`);
    }
  };

  const submitAccessPassword = (event: FormEvent) => {
    event.preventDefault();
    if (!roomId) return;
    setError('');

    socket.emit('room:checkPassword', { roomId, password: accessPassword }, (response: RoomPasswordAck) => {
      if (!response.ok) {
        setError(response.error);
        return;
      }
      const token = response.roomAccessToken || '';
      setRoomAccessToken(roomId, token);
      loadRoom(token);
    });
  };

  if (accessRequired) {
    return (
      <>
        <SideOperatives />
        <main className="appShell roomPage hasDecor">
          <header className="topBar roomTopBar">
            <ManaLogo />
            <Link className="backButton" to="/">в†ђ РќР°Р·Р°Рґ РІ С…Р°Р±</Link>
          </header>
          <section className="roomPanel joinPanel">
            <div>
              <span className="panelLabel">РџР°СЂРѕР»СЊ РєРѕРјРЅР°С‚С‹</span>
              <h2>Р—Р°РєСЂС‹С‚С‹Р№ РјР°С‚С‡</h2>
              <p className="muted">Р’РІРµРґРё РїР°СЂРѕР»СЊ, С‡С‚РѕР±С‹ РѕС‚РєСЂС‹С‚СЊ РєРѕРјРЅР°С‚Сѓ.</p>
            </div>
            <form className="joinForm" onSubmit={submitAccessPassword}>
              <input
                autoFocus
                type="password"
                value={accessPassword}
                onChange={(event) => setAccessPassword(event.target.value)}
                placeholder="РџР°СЂРѕР»СЊ"
                required
              />
              <button type="submit">РћС‚РєСЂС‹С‚СЊ</button>
            </form>
          </section>
          {error && <div className="errorBox">{error}</div>}
        </main>
      </>
    );
  }

  if (!room) {
    return (
      <>
        <SideOperatives />
        <main className="appShell roomPage hasDecor">
          <header className="topBar roomTopBar">
            <ManaLogo />
            <Link className="backButton" to="/">← Назад в хаб</Link>
          </header>
          <section className="emptyRooms"><p>{error || 'Загрузка комнаты...'}</p></section>
        </main>
      </>
    );
  }

  const lobbyCanJoin = room.stage === 'lobby' && !currentPlayer;
  const readyCount = room.players.filter((player) => player.ready).length;

  return (
    <>
      <SideOperatives />
      <main className="appShell roomPage hasDecor">
        <header className="topBar roomTopBar">
          <ManaLogo />
          <nav className="roomNav">
            <span className="serverPill"><i /> {room.club}</span>
            <span className="miniBadge">{room.teamSize}x{room.teamSize}</span>
            <span className="miniBadge">{room.matchFormat}</span>
            <button type="button" className="miniBadge navLink gameSwitchLink disabledNavButton" disabled title="Dota 2 пока в разработке">DOTA 2 · В разработке</button>
            <Link className="miniBadge navLink" to="/bracket">Сетка</Link>
            {isAdmin ? (
              <>
                <Link className="miniBadge navLink adminTopButton" to="/admin">Админ панель</Link>
                <button type="button" className="miniBadge navLink logoutTopButton" onClick={onAdminLogout}>Выйти</button>
              </>
            ) : (
              <Link className="miniBadge navLink" to="/admin">Админ</Link>
            )}
            <Link className="backButton" to="/">← Назад в хаб</Link>
          </nav>
        </header>

        <section className="roomHero">
          <div className="eyebrow">{room.game === 'cs2' ? 'MATCH ROOM' : 'DOTA ROOM'} · {stageLabel(room.stage)}</div>
          <h1>{room.teamAName} <span>VS</span> {room.teamBName}</h1>
          <p className="muted upper">
            Игроки {room.players.length}/{room.maxPlayers} · Готовы {readyCount}/{room.maxPlayers}{room.winnerName ? ` · Победитель: ${room.winnerName}` : ''}
          </p>
        </section>

        <section className="roomPanel serverPanel">
          <div>
            <span className="panelLabel">{room.game === 'cs2' ? 'Назначенный сервер' : 'Dota 2 лобби'}</span>
            <h2>{room.game === 'cs2' ? `${room.assignedServer?.name || room.club} · ${room.gameServerAddress}` : 'Лобби создаётся админом в клиенте Dota 2'}</h2>
            <p className="muted">{room.game === 'cs2' ? `GOTV: ${room.gotvAddress} · ${room.serverReleased ? 'IP освобождён после завершения' : 'IP зарезервирован за матчем'}` : 'Пики/баны для Dota-раздела отключены.'}</p>
          </div>
          <div className="serverActions">
            {room.game === 'cs2' ? (<>
              <button type="button" onClick={() => copyConnect(room.gameServerAddress, 'CS2')}>Скопировать IP</button>
              <button type="button" className="ghostBtn" onClick={() => copyConnect(room.gotvAddress, 'GOTV')}>Скопировать GOTV</button>
            </>) : (
              <span className="adminOnlyNotice">Dota 2 серверы пока не трогаем</span>
            )}
          </div>
        </section>

        {copied && <div className="copyBox">{copied}</div>}
        {error && <div className="errorBox">{error}</div>}

        {lobbyCanJoin && (
          <section className="roomPanel joinPanel">
            <div>
              <span className="panelLabel">Занять слот</span>
              <h2>{nickname}</h2>
              <p className="muted">Ник берётся с главной страницы и сохраняется в браузере.</p>
            </div>
            <form className="joinForm" onSubmit={joinRoom}>
              <select value={team} onChange={(event) => setTeam(event.target.value as 'auto' | Team)}>
                <option value="auto">Автоматически</option>
                <option value="A">{room.teamAName}</option>
                <option value="B">{room.teamBName}</option>
              </select>
              <button type="submit">Войти игроком</button>
            </form>
          </section>
        )}

        {currentPlayer && room.stage === 'lobby' && (
          <section className="roomPanel readyPanel">
            <div>
              <span className="panelLabel">Ваш слот</span>
              <h2>{teamName(room, currentPlayer.team)} · #{currentPlayer.slot + 1}</h2>
            </div>
            <div className="readyActions">
              <button type="button" onClick={toggleReady} className={currentPlayer.ready ? 'readyButton' : ''}>
                {currentPlayer.ready ? 'Готов ✓' : 'Я готов'}
              </button>
              <button type="button" className="ghostBtn leaveSlotButton" onClick={leaveSlot}>
                Выйти из комнаты
              </button>
            </div>
          </section>
        )}

        <section className="teamsGrid">
          <TeamColumn room={room} team="A" currentPlayer={currentPlayer} onTransferCaptain={transferCaptain} />
          <TeamColumn room={room} team="B" currentPlayer={currentPlayer} onTransferCaptain={transferCaptain} />
        </section>

        <RoomChat
          room={room}
          nickname={nickname}
          onError={setError}
          onRoomUpdate={setRoom}
          onAccessRequired={() => {
            setRoom(null);
            setAccessRequired(true);
          }}
        />

        {room.stage === 'lobby' && (
          <section className="roomPanel hintPanel">
            <span className="panelLabel">{room.game === 'cs2' ? 'Старт MAP VETO' : 'Старт Dota-матча'}</span>
            <p>
              Для режима {room.teamSize}x{room.teamSize} нужно заполнить {room.maxPlayers} слота и всем нажать «Я готов».
              После этого {room.game === 'cs2' ? 'MAP VETO запустится автоматически' : 'матч перейдёт в стадию игры без veto'}.
            </p>
          </section>
        )}

        {room.game === 'cs2' && (room.stage === 'veto' || room.stage === 'live' || room.stage === 'finished') && (
          <Veto room={room} currentPlayer={currentPlayer} onError={setError} onRoomUpdate={setRoom} />
        )}

        {(room.stage === 'live' || room.stage === 'finished') && (
          <MatchStatsPanel room={room} />
        )}

        {(room.stage === 'live' || room.stage === 'finished') && (
          <MatchControl room={room} currentPlayer={currentPlayer} isAdmin={isAdmin} adminToken={adminToken} onError={setError} onRoomUpdate={setRoom} />
        )}
      </main>
    </>
  );
}

function TeamColumn({
  room,
  team,
  currentPlayer,
  onTransferCaptain
}: {
  room: RoomType;
  team: Team;
  currentPlayer: Player | null;
  onTransferCaptain: (targetPlayerId: string) => void;
}) {
  const captain = captainForTeam(room, team);
  const currentPlayerIsCaptain = Boolean(currentPlayer && captain?.id === currentPlayer.id && currentPlayer.team === team);

  return (
    <section className="teamColumn">
      <h2>{teamName(room, team)}</h2>
      {currentPlayerIsCaptain && (
        <p className="captainTransferHelp">Ты капитан. Нажми на игрока своей команды, чтобы передать ему капитана.</p>
      )}
      <div className="slots">
        {room.slots[team].map((player, index) => {
          const isCurrentPlayer = currentPlayer?.id === player?.id;
          const isCaptain = captain?.id === player?.id;
          const canTransferCaptain = Boolean(currentPlayerIsCaptain && player && !isCurrentPlayer && player.team === team);

          return (
            <div
              key={`${team}-${index}`}
              role={canTransferCaptain ? 'button' : undefined}
              tabIndex={canTransferCaptain ? 0 : undefined}
              title={canTransferCaptain ? `Передать капитана игроку ${player?.name}` : undefined}
              onClick={() => {
                if (canTransferCaptain && player) onTransferCaptain(player.id);
              }}
              onKeyDown={(event) => {
                if (!canTransferCaptain || !player) return;
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onTransferCaptain(player.id);
                }
              }}
              className={[
                'slot',
                player ? 'filled' : 'empty',
                player?.ready ? 'ready' : '',
                isCurrentPlayer ? 'currentPlayer' : '',
                isCaptain ? 'captainSlot' : '',
                canTransferCaptain ? 'transferCaptainSlot' : ''
              ].join(' ')}
            >
              <span className="slotNumber">#{index + 1}</span>
              {player ? (
                <div className="slotBody">
                  <b>{player.name}</b>
                  {isCaptain && <span className="captainBadge" title="Капитан команды">👑 CAPTAIN</span>}
                  {canTransferCaptain && <span className="captainTransferBadge">Передать CAP</span>}
                  <p>{player.ready ? 'READY' : 'NOT READY'} · {player.connected ? 'ONLINE' : 'OFFLINE'}</p>
                </div>
              ) : (
                <span>Свободно</span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}


function MatchStatsPanel({ room }: { room: RoomType }) {
  const [open, setOpen] = useState(false);

  return (
    <section className={`matchStatsPanel ${open ? 'open' : ''}`}>
      <button type="button" className="matchStatsToggle" onClick={() => setOpen((value) => !value)}>
        <span>СТАТИСТИКА МАТЧА</span>
        <b>{open ? 'Скрыть' : 'Открыть'}</b>
      </button>

      {open && (
        <div className="matchStatsBody">
          <article className="matchStatsCard">
            <span className="panelLabel">Гейм лог</span>
            <h3>Ожидание данных</h3>
            <p className="muted">Раунды, события матча и ключевые моменты появятся здесь после подключения парсинга с сервера.</p>
          </article>

          <article className="matchStatsCard">
            <span className="panelLabel">Матч статус</span>
            <h3>{room.stage === 'finished' ? 'Матч завершён' : 'Матч идёт'}</h3>
            <p className="muted">Текущая карта, live-счёт, паузы и статус сервера будут добавлены позже.</p>
          </article>

          <article className="matchStatsCard broadcastCard">
            <span className="panelLabel">Трансляция</span>
            <h3>Twitch</h3>
            <p className="muted">Временная ссылка на трансляцию. Позже можно будет подставлять нужный канал для конкретного матча.</p>
            <a href="https://www.twitch.tv/fissure_cs_a" target="_blank" rel="noreferrer">Открыть Twitch</a>
          </article>
        </div>
      )}
    </section>
  );
}

function MatchControl({
  room,
  currentPlayer,
  isAdmin,
  adminToken,
  onError,
  onRoomUpdate
}: {
  room: RoomType;
  currentPlayer: Player | null;
  isAdmin: boolean;
  adminToken: string;
  onError: (message: string) => void;
  onRoomUpdate: (room: RoomType) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [replaceIndex, setReplaceIndex] = useState<number | null>(null);
  const screenshotLimit = room.matchFormat === 'BO3' ? 3 : 1;
  const screenshots = room.resultScreenshots?.length ? room.resultScreenshots : (room.resultScreenshot ? [room.resultScreenshot] : []);
  const canSubmitScreenshot = isAdmin || Boolean(currentPlayer);
  const canReplaceScreenshot = isAdmin;
  const canUploadScreenshot = canSubmitScreenshot && screenshots.length < screenshotLimit;

  const sendScreenshot = (file: File, index: number | null = null) => {
    if (!canSubmitScreenshot) {
      onError('Загружать скриншоты могут только игроки матча и админ.');
      return;
    }

    if (index !== null && !canReplaceScreenshot) {
      onError('Заменять скриншоты может только админ.');
      return;
    }

    if (!file.type.match(/^image\/(png|jpeg|jpg|webp)$/)) {
      onError('Разрешены только PNG, JPG или WEBP.');
      return;
    }

    if (file.size > 4 * 1024 * 1024) {
      onError('Скриншот слишком большой. Лимит примерно 4 MB.');
      return;
    }

    if (index === null && !canUploadScreenshot) {
      onError(room.matchFormat === 'BO3' ? 'Для BO3 можно загрузить максимум 3 скриншота.' : 'Для BO1 можно загрузить только 1 скриншот.');
      return;
    }

    setUploading(true);
    const reader = new FileReader();
    reader.onload = () => {
      socket.emit(
        'match:uploadScreenshot',
        { roomId: room.id, dataUrl: String(reader.result || ''), replaceIndex: index, adminToken, roomAccessToken: getRoomAccessToken(room.id) },
        (response: SocketAck<RoomPayload>) => {
          setUploading(false);
          setReplaceIndex(null);
          if (!response.ok) {
            onError(response.error);
            return;
          }
          onRoomUpdate(response.room);
        }
      );
    };
    reader.onerror = () => {
      setUploading(false);
      onError('Не удалось прочитать файл');
    };
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (!canSubmitScreenshot) return;
      if (room.stage !== 'live' && room.stage !== 'finished') return;
      const items = Array.from(event.clipboardData?.items || []);
      const imageItem = items.find((item) => item.type.startsWith('image/'));
      const file = imageItem?.getAsFile();
      if (!file) return;
      if (screenshots.length >= screenshotLimit && !canReplaceScreenshot) return;
      event.preventDefault();
      const targetIndex = screenshots.length >= screenshotLimit ? Math.max(0, screenshotLimit - 1) : null;
      sendScreenshot(file, targetIndex);
    };

    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [room.id, room.stage, screenshots.length, screenshotLimit, canUploadScreenshot, canReplaceScreenshot, canSubmitScreenshot, adminToken]);

  const uploadScreenshot = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    sendScreenshot(file, replaceIndex);
    event.target.value = '';
  };

  const finishMatch = (winnerTeam: Team) => {
    onError('');
    socket.emit('match:finish', { roomId: room.id, winnerTeam, adminToken }, (response: SocketAck<RoomPayload>) => {
      if (!response.ok) {
        onError(response.error);
        return;
      }
      onRoomUpdate(response.room);
    });
  };

  return (
    <section className="roomPanel matchControlPanel resultOnlyPanel">
      <div className="matchScoreBlock">
        <span className="panelLabel">Результаты</span>
        <h2>{screenshots.length}/{screenshotLimit}</h2>
        <p className="muted">Ручной ввод счёта отключён. Пока игроки загружают только скриншоты результата.</p>
      </div>

      <div className="screenshotBox screenshotBoxWide">
        <span className="panelLabel">Скриншоты результата {screenshots.length}/{screenshotLimit}</span>
        {canSubmitScreenshot && (canUploadScreenshot || replaceIndex !== null) && (
        <label className={`uploadLabel ${!canUploadScreenshot && replaceIndex === null ? 'uploadLabelDisabled' : ''}`}>
          {uploading ? 'Загружаю...' : replaceIndex !== null ? `Заменить скриншот ${replaceIndex + 1}` : 'Загрузить изображение'}
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadScreenshot} />
        </label>
        )}
        {canSubmitScreenshot ? (
          <p className="muted">{canReplaceScreenshot ? 'Можно вставить скриншот через Ctrl+V. Если лимит заполнен, вставка заменит последний скриншот.' : 'Игроки матча могут добавить скриншот до заполнения лимита.'}</p>
        ) : (
          <p className="muted adminOnlyNotice">Скриншоты загружают только игроки матча и админ.</p>
        )}
        {replaceIndex !== null && canReplaceScreenshot && <button type="button" className="ghostBtn" onClick={() => setReplaceIndex(null)}>Отменить замену</button>}

        {screenshots.length > 0 ? (
          <div className="screenshotsGrid">
            {screenshots.map((screenshot, index) => (
              <figure className="screenshotItem" key={`${screenshot.slice(0, 32)}-${index}`}>
                <img src={screenshot} alt={`Скриншот результата ${index + 1}`} />
                <figcaption>
                  Карта {index + 1}
                  {canReplaceScreenshot && <button type="button" className="ghostBtn replaceShotButton" onClick={() => setReplaceIndex(index)}>Заменить</button>}
                </figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <p className="muted">Для BO1 можно загрузить 1 фото, для BO3 — до 3 фото.</p>
        )}
      </div>

      <div className="winnerControls">
        <span className="panelLabel">Победитель</span>
        {room.winnerName && <h3>{room.winnerName}</h3>}
        {isAdmin ? (
          <>
            <p className="muted adminWinnerHint">Победителя теперь выставляет только админ после проверки скриншотов.</p>
            <div className="winnerButtons">
              <button type="button" onClick={() => finishMatch('A')}>{room.winnerTeam === 'A' ? '✓ ' : ''}{room.teamAName}</button>
              <button type="button" onClick={() => finishMatch('B')}>{room.winnerTeam === 'B' ? '✓ ' : ''}{room.teamBName}</button>
            </div>
          </>
        ) : (
          <p className="muted adminOnlyNotice">Загрузи скриншот результата. Победителя выставит админ.</p>
        )}
      </div>
    </section>
  );
}
