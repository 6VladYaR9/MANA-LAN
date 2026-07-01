import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import ManaLogo from '../components/ManaLogo';
import { socket } from '../socket';
import { emitWithAck, isAdminAuthError } from '../socketAck';
import { safeTournamentImageSrc } from '../imageSafety';
import type { GameType } from '../types';
import type { PastTournament } from '../data/tournamentData';
import './PastTournaments.css';

type PastPayload = { tournaments: PastTournament[] };

export default function PastTournaments({
  game,
  isAdmin,
  adminToken,
  onAdminLogout
}: {
  game: GameType;
  isAdmin: boolean;
  adminToken: string;
  onAdminLogout: () => void;
}) {
  const [tournaments, setTournaments] = useState<PastTournament[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [pendingDeleteId, setPendingDeleteId] = useState('');
  const loadRequestIdRef = useRef(0);

  const load = () => {
    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;
    setLoading(true);
    void emitWithAck<PastPayload>('past:get', { game }).then((response) => {
      if (loadRequestIdRef.current !== requestId) return;
      setLoading(false);
      if (response.ok) {
        setError('');
        setTournaments(response.tournaments || []);
      } else {
        setError(response.error);
      }
    });
  };

  useEffect(() => {
    load();
    const onUpdate = (payload: { tournaments: PastTournament[] }) => {
      setTournaments((payload.tournaments || []).filter((item) => (item.game || 'cs2') === game));
    };
    socket.on('past:update', onUpdate);
    return () => {
      socket.off('past:update', onUpdate);
    };
  }, [game]);

  const deleteTournament = (id: string) => {
    if (!window.confirm('Удалить этот прошлый турнир?')) return;
    if (pendingDeleteId) return;
    setPendingDeleteId(id);
    void emitWithAck<PastPayload>('past:delete', { id, game, adminToken }).then((response) => {
      setPendingDeleteId('');
      if (!response.ok) {
        setError(response.error);
        if (isAdminAuthError(response.error)) onAdminLogout();
        return;
      }
      setTournaments(response.tournaments || []);
    });
  };

  return (
    <main className="appShell pastPage" data-testid="past-page">
      <header className="topBar">
        <ManaLogo />
        <nav className="roomNav">
          <button type="button" className="miniBadge navLink gameSwitchLink disabledNavButton" disabled>DOTA 2 · В разработке</button>
          <Link className="miniBadge navLink" to="/bracket">Просмотр сетки</Link>
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

      <section className="pastHero">
        <div className="eyebrow">MANA ARCHIVE · {game === 'cs2' ? 'CS2' : 'DOTA 2'}</div>
        <h1>ПРОШЛЫЕ <span>ТУРНИРЫ</span></h1>
        <p className="muted upper">В админ-режиме можно добавить или удалить карточки прошлых турниров.</p>
        {isAdmin && <button type="button" className="createBtn pastAddButton" data-testid="past-add-button" onClick={() => setShowAdd(true)}>Добавить турнир</button>}
      </section>

      {error && <div className="errorBox">{error} <button type="button" className="ghostBtn" onClick={load}>Повторить</button></div>}
      {loading && <div className="emptyRooms compactEmpty"><h3>Загрузка архива...</h3></div>}

      <section className="pastCardsGrid">
        {tournaments.map((tournament) => (
          <article className="pastTournamentCardShell" data-testid="past-card" data-tournament-id={tournament.id} key={tournament.id}>
            <Link className="pastTournamentCard" data-testid="past-card-link" to={`/past/${tournament.id}`}>
              <img
                src={safeTournamentImageSrc(tournament.bannerImage)}
                alt={tournament.title}
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                onError={(event) => {
                  event.currentTarget.src = safeTournamentImageSrc(null);
                }}
              />
              <div className="pastTournamentOverlay">
                <span>{tournament.date}</span>
                <h2>{tournament.title}</h2>
                <p>{tournament.description}</p>
                <b>Открыть турнир →</b>
              </div>
            </Link>
            {isAdmin && <button type="button" className="ghostBtn pastDeleteButton" data-testid="past-delete" disabled={Boolean(pendingDeleteId)} onClick={() => deleteTournament(tournament.id)}>{pendingDeleteId === tournament.id ? 'Удаляю...' : 'Удалить'}</button>}
          </article>
        ))}
      </section>

      {showAdd && (
        <AddTournamentModal
          game={game}
          adminToken={adminToken}
          onClose={() => setShowAdd(false)}
          onCreated={(items) => {
            setTournaments(items);
            setShowAdd(false);
          }}
          onError={setError}
          onAdminAuthError={onAdminLogout}
        />
      )}
    </main>
  );
}

function AddTournamentModal({
  game,
  adminToken,
  onClose,
  onCreated,
  onError,
  onAdminAuthError
}: {
  game: GameType;
  adminToken: string;
  onClose: () => void;
  onCreated: (items: PastTournament[]) => void;
  onError: (message: string) => void;
  onAdminAuthError: () => void;
}) {
  const [title, setTitle] = useState(game === 'cs2' ? 'MANA CS2 CUP' : 'MANA DOTA 2 CUP');
  const [date, setDate] = useState('2026');
  const [description, setDescription] = useState('Описание турнира');
  const [creating, setCreating] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (creating) return;
    setCreating(true);
    const response = await emitWithAck<PastPayload>('past:create', { game, adminToken, title, date, description });
    setCreating(false);
    if (!response.ok) {
      onError(response.error);
      if (isAdminAuthError(response.error)) onAdminAuthError();
      return;
    }
    onCreated(response.tournaments || []);
  };

  return (
    <div className="modalBackdrop">
      <div className="modal createMatchModal">
        <div className="modalHead">
          <div>
            <span>Архив MANA</span>
            <h2>Добавить турнир</h2>
          </div>
          <button type="button" className="xBtn" onClick={onClose}>×</button>
        </div>
        <form className="modalForm" onSubmit={submit}>
          <label>Название<input data-testid="past-title-input" value={title} onChange={(event) => setTitle(event.target.value)} required /></label>
          <label>Дата<input data-testid="past-date-input" value={date} onChange={(event) => setDate(event.target.value)} required /></label>
          <label>Описание<input data-testid="past-description-input" value={description} onChange={(event) => setDescription(event.target.value)} required /></label>
          <div className="modalActions">
            <button type="submit" data-testid="past-submit" disabled={creating}>{creating ? 'Добавляю...' : 'Добавить'}</button>
            <button type="button" className="ghostBtn" onClick={onClose}>Отмена</button>
          </div>
        </form>
      </div>
    </div>
  );
}
