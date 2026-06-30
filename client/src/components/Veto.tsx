import { useEffect, useMemo, useState } from 'react';
import CoinFlip from './CoinFlip';
import { socket } from '../socket';
import type { MapState, Player, Room, SocketAck, Team, VetoHistoryItem } from '../types';
import './Veto.css';

type Props = {
  room: Room;
  currentPlayer: Player | null;
  onError: (message: string) => void;
  onRoomUpdate: (room: Room) => void;
};

type RoomPayload = { room: Room };

const MAP_IMAGES: Record<string, string> = {
  'Dust 2': 'https://raw.githubusercontent.com/MurkyYT/cs2-map-icons/main/images/thumbs/de_dust2_1_png.png',
  Mirage: 'https://raw.githubusercontent.com/MurkyYT/cs2-map-icons/main/images/thumbs/de_mirage_1_png.png',
  Inferno: 'https://raw.githubusercontent.com/MurkyYT/cs2-map-icons/main/images/thumbs/de_inferno_1_png.png',
  Nuke: 'https://raw.githubusercontent.com/MurkyYT/cs2-map-icons/main/images/thumbs/de_nuke_1_png.png',
  Ancient: 'https://raw.githubusercontent.com/MurkyYT/cs2-map-icons/main/images/thumbs/de_ancient_1_png.png',
  Anubis: 'https://raw.githubusercontent.com/MurkyYT/cs2-map-icons/main/images/thumbs/de_anubis_1_png.png',
  Vertigo: 'https://raw.githubusercontent.com/MurkyYT/cs2-map-icons/main/images/thumbs/de_vertigo_1_png.png'
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

  useEffect(() => {
    if (!veto || room.stage !== 'veto' || veto.history.length > 0) {
      setShowCoin(false);
      return;
    }

    setShowCoin(true);
    const timer = window.setTimeout(() => setShowCoin(false), 7800);
    return () => window.clearTimeout(timer);
  }, [room.stage, veto?.createdAt, veto?.history.length]);

  const currentAction = veto?.currentAction || null;
  const captain = currentAction ? captainForTeam(room, currentAction.team) : null;
  const canAct = Boolean(
    room.stage === 'veto' && !showCoin && currentAction && currentPlayer && captain && currentPlayer.id === captain.id
  );

  const progress = useMemo(() => {
    const total = veto?.actions?.length || 0;
    const done = veto?.currentTurnIndex || 0;
    return total ? `${Math.min(done + 1, total)}/${total}` : '0/0';
  }, [veto?.actions, veto?.currentTurnIndex]);

  if (!veto) return null;

  const selectMap = (mapName: string) => {
    if (!canAct) return;
    onError('');

    socket.emit('veto:selectMap', { roomId: room.id, mapName }, (response: SocketAck<RoomPayload>) => {
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
    <section className="vetoPanel">
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
          {!canAct && <p className="muted">Кнопки активны только у капитана текущей команды. Во время монетки выбор заблокирован.</p>}
        </div>
      ) : null}

      <div className="mapsGrid">
        {veto.maps.map((map) => {
          const disabled = !canAct || map.status !== 'available' || room.stage !== 'veto';
          return (
            <button
              key={map.name}
              type="button"
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
