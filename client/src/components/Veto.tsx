import { useEffect, useMemo, useState } from 'react';
import CoinFlip from './CoinFlip';
import { emitWithAck } from '../socketAck';
import type { MapState, Player, Room, Team, VetoHistoryItem } from '../types';
import './Veto.css';

type Props = {
  room: Room;
  currentPlayer: Player | null;
  onError: (message: string) => void;
  onRoomUpdate: (room: Room) => void;
};

type RoomPayload = { room: Room };
type Side = 'CT' | 'T';

const MAP_IMAGES: Record<string, string> = {
  'Dust 2': '/assets/maps/dust2.svg',
  Mirage: '/assets/maps/mirage.svg',
  Inferno: '/assets/maps/inferno.svg',
  Nuke: '/assets/maps/nuke.svg',
  Ancient: '/assets/maps/ancient.svg',
  Anubis: '/assets/maps/anubis.svg',
  Vertigo: '/assets/maps/vertigo.svg'
};

function teamName(room: Room, team: Team | null) {
  if (team === 'A') return room.teamAName;
  if (team === 'B') return room.teamBName;
  return 'MANA SYSTEM';
}

function teamSide(team: Team) {
  return team === 'A' ? 'L' : 'R';
}

function captainForTeam(room: Room, team: Team) {
  const captainId = room.captains?.[team];
  const savedCaptain = captainId ? room.players.find((player) => player.id === captainId && player.team === team) : null;
  if (savedCaptain) return savedCaptain;

  return room.players
    .filter((player) => player.team === team)
    .sort((a, b) => a.slot - b.slot || a.joinedAt - b.joinedAt)[0];
}

function actionLabel(type: VetoHistoryItem['type']) {
  if (type === 'ban') return 'BAN';
  if (type === 'pick') return 'PICK';
  if (type === 'decider') return 'DECIDER';
  if (type === 'final') return 'FINAL MAP';
  return 'AUTO BAN';
}

function statusLabel(map: MapState) {
  if (map.status === 'banned') return `BAN${map.actedBy ? ` · ${map.actedBy === 'A' ? 'L' : 'R'}` : ''}`;
  if (map.status === 'picked') return map.actedBy ? `PICK · ${map.actedBy === 'A' ? 'L' : 'R'}` : 'DECIDER';
  if (map.status === 'autobanned') return 'AUTO BAN';
  return 'AVAILABLE';
}

function formatRule(room: Room) {
  if (room.matchFormat === 'BO3') {
    return 'BO3 · 3 карты';
  }
  return 'BO1 · 1 карта';
}

export default function Veto({ room, currentPlayer, onError, onRoomUpdate }: Props) {
  const veto = room.veto;
  const [showCoin, setShowCoin] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!veto || room.stage !== 'veto' || veto.history.length > 0) {
      setShowCoin(false);
      return;
    }

    const unlockAt = veto.coinUnlockAt || veto.createdAt || 0;
    const remaining = Math.max(0, unlockAt - Date.now());
    setShowCoin(remaining > 0);
    if (!remaining) return;
    const timer = window.setTimeout(() => {
      setNow(Date.now());
      setShowCoin(false);
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [room.stage, veto?.createdAt, veto?.coinUnlockAt, veto?.history.length]);

  useEffect(() => {
    if (!veto?.coinUnlockAt || Date.now() >= veto.coinUnlockAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [veto?.coinUnlockAt]);

  const currentAction = veto?.currentAction || null;
  const captain = currentAction ? captainForTeam(room, currentAction.team) : null;
  const coinLocked = Boolean(room.stage === 'veto' && veto?.coinUnlockAt && now < veto.coinUnlockAt);
  const canAct = Boolean(
    room.stage === 'veto' && !coinLocked && !showCoin && currentAction && currentPlayer && captain && currentPlayer.id === captain.id
  );

  const progress = useMemo(() => {
    const total = veto?.actions?.length || 0;
    const done = veto?.currentTurnIndex || 0;
    return total ? `${Math.min(done + 1, total)}/${total}` : '0/0';
  }, [veto?.actions, veto?.currentTurnIndex]);

  if (!veto) return null;

  const pendingSideMap = room.stage === 'side_choice' ? room.selectedMaps.find((item) => !item.side) : null;
  const sideCaptain = pendingSideMap?.sideChoiceTeam ? captainForTeam(room, pendingSideMap.sideChoiceTeam) : null;
  const canChooseSide = Boolean(pendingSideMap && currentPlayer && sideCaptain && currentPlayer.id === sideCaptain.id);

  const selectMap = (mapName: string) => {
    if (!canAct) return;
    onError('');

    void emitWithAck<RoomPayload>('veto:selectMap', { roomId: room.id, mapName }).then((response) => {
      if (!response.ok) {
        onError(response.error);
        return;
      }
      onRoomUpdate(response.room);
    });
  };

  const chooseSide = (side: Side) => {
    if (!pendingSideMap || !canChooseSide) return;
    onError('');

    void emitWithAck<RoomPayload>('veto:chooseSide', { roomId: room.id, round: pendingSideMap.round, side }).then((response) => {
      if (!response.ok) {
        onError(response.error);
        return;
      }
      onRoomUpdate(response.room);
    });
  };

  const startingTeamName = teamName(room, veto.startingTeam);
  const startingSide = teamSide(veto.startingTeam);
  const finalMapsText = room.selectedMaps.map((item) => item.map).join(' / ');

  return (
    <section className="vetoPanel" data-testid="veto-panel">
      {showCoin && <CoinFlip winnerName={startingTeamName} winnerSide={startingSide} />}

      <div className="vetoHead">
        <div>
          <span className="panelLabel">MANA MAP VETO · {room.matchFormat} · {formatRule(room)}</span>
          <h2>MAP <span>VETO</span></h2>
        </div>
        <div className="vetoScore">
          <b>{room.selectedMaps.length}/{room.targetMaps}</b>
          <small>MAPS</small>
        </div>
      </div>

      {room.selectedMaps.length > 0 && (
        <div className="seriesBox">
          <b>Карты серии:</b>
          <div>
            {room.selectedMaps.map((item) => (
              <span key={`${item.round}-${item.map}`}>#{item.round} {item.map}</span>
            ))}
          </div>
        </div>
      )}

      {(room.stage === 'live' || room.stage === 'finished') ? (
        <div className="resultBox">
          <h3>{room.matchFormat === 'BO3' ? 'Карты серии' : 'Финальная карта'}: {finalMapsText}</h3>
          <p>CS2 сервер: <b>{room.gameServerAddress}</b> · GOTV: <b>{room.gotvAddress}</b></p>
          <code>connect {room.gameServerAddress}</code>
          <p className="muted">Сейчас стадия: {room.stage === 'live' ? 'МАТЧ ИДЁТ' : 'МАТЧ ЗАВЕРШЁН'} · Счёт {room.score.A}:{room.score.B}</p>
        </div>
      ) : currentAction ? (
        <div className="turnBox">
          <p>Монетка выбрала: <b>{startingSide}</b> · <b>{startingTeamName}</b></p>
          <p>
            Ход {progress}: <b>{teamSide(currentAction.team)}</b> · <b>{teamName(room, currentAction.team)}</b> ·{' '}
            <b className={currentAction.type === 'pick' ? 'pickWord' : 'banWord'}>{currentAction.type === 'ban' ? 'BAN' : 'PICK'}</b>
          </p>
          <p>Капитан: <b>{captain?.name || 'не найден'}</b></p>
          {!canAct && <p className="muted">{coinLocked ? 'Дождись окончания монетки: сервер откроет первый ход автоматически.' : 'Кнопки активны только у капитана текущей команды.'}</p>}
        </div>
      ) : room.stage === 'side_choice' && pendingSideMap ? (
        <div className="turnBox sideChoiceBox" data-testid="side-choice-panel">
          <p>Карта #{pendingSideMap.round}: <b>{pendingSideMap.map}</b></p>
          <p>Сторону выбирает: <b>{teamName(room, pendingSideMap.sideChoiceTeam || null)}</b></p>
          <p>Капитан: <b>{sideCaptain?.name || 'не найден'}</b></p>
          <div className="sideChoiceActions">
            <button type="button" data-testid="choose-side-ct" disabled={!canChooseSide} onClick={() => chooseSide('CT')}>CT</button>
            <button type="button" data-testid="choose-side-t" disabled={!canChooseSide} onClick={() => chooseSide('T')}>T</button>
          </div>
          {!canChooseSide && <p className="muted">Кнопки активны только у капитана команды, которая выбирает сторону.</p>}
        </div>
      ) : null}

      <div className="mapsGrid">
        {veto.maps.map((map) => {
          const disabled = !canAct || map.status !== 'available' || room.stage !== 'veto';
          return (
            <button
              key={map.name}
              type="button"
              data-testid="map-tile"
              data-map-name={map.name}
              data-map-status={map.status}
              disabled={disabled}
              onClick={() => selectMap(map.name)}
              className={['mapTile', map.status].join(' ')}
            >
              <span className="mapImageWrap" aria-hidden="true">
                <img className="mapImage" src={MAP_IMAGES[map.name]} alt="" draggable={false} />
              </span>
              <span className="mapOverlay" aria-hidden="true" />
              <span className="mapContent">
                <b>{map.name}</b>
                <small>{statusLabel(map)}</small>
              </span>
            </button>
          );
        })}
      </div>

      <div className="historyBox">
        <h3>История veto</h3>
        {veto.history.length === 0 ? (
          <p className="muted">Пока действий нет. Дождись окончания монетки.</p>
        ) : (
          <ol>
            {veto.history.map((item, index) => (
              <li key={`${item.createdAt}-${index}`}>
                <b>{teamName(room, item.team)}</b> — {actionLabel(item.type)} <b>{item.map}</b>
                {item.byPlayerName && item.byPlayerId ? ` by ${item.byPlayerName}` : ''}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
