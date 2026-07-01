import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import ManaLogo from '../components/ManaLogo';
import ModalShell from '../components/ModalShell';
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
  const [editingTournament, setEditingTournament] = useState<PastTournament | null>(null);
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

      {error && <div className="errorBox" role="alert" aria-live="polite">{error} <button type="button" className="ghostBtn" onClick={load}>Повторить</button></div>}
      {loading && <div className="emptyRooms compactEmpty"><h3>Загрузка архива...</h3></div>}
      {!loading && tournaments.length === 0 && (
        <div className="emptyRooms compactEmpty" data-testid="past-empty-state">
          <h3>Прошлых турниров пока нет</h3>
        </div>
      )}

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
            {isAdmin && (
              <div className="pastAdminActions">
                <button type="button" className="ghostBtn" data-testid="past-edit" onClick={() => setEditingTournament(tournament)}>Редактировать</button>
                <button type="button" className="ghostBtn pastDeleteButton" data-testid="past-delete" disabled={Boolean(pendingDeleteId)} onClick={() => deleteTournament(tournament.id)}>{pendingDeleteId === tournament.id ? 'Удаляю...' : 'Удалить'}</button>
              </div>
            )}
          </article>
        ))}
      </section>

      {showAdd && (
        <TournamentFormModal
          game={game}
          adminToken={adminToken}
          mode="create"
          onClose={() => setShowAdd(false)}
          onCreated={(items) => {
            setTournaments(items);
            setShowAdd(false);
          }}
          onError={setError}
          onAdminAuthError={onAdminLogout}
        />
      )}
      {editingTournament && (
        <TournamentFormModal
          game={game}
          adminToken={adminToken}
          mode="edit"
          tournament={editingTournament}
          onClose={() => setEditingTournament(null)}
          onCreated={(items) => {
            setTournaments(items);
            setEditingTournament(null);
          }}
          onError={setError}
          onAdminAuthError={onAdminLogout}
        />
      )}
    </main>
  );
}

function TournamentFormModal({
  game,
  adminToken,
  mode,
  tournament,
  onClose,
  onCreated,
  onError,
  onAdminAuthError
}: {
  game: GameType;
  adminToken: string;
  mode: 'create' | 'edit';
  tournament?: PastTournament;
  onClose: () => void;
  onCreated: (items: PastTournament[]) => void;
  onError: (message: string) => void;
  onAdminAuthError: () => void;
}) {
  const first = tournament?.podium.find((place) => place.place === 1);
  const second = tournament?.podium.find((place) => place.place === 2);
  const third = tournament?.podium.find((place) => place.place === 3);
  const [title, setTitle] = useState(tournament?.title || (game === 'cs2' ? 'MANA CS2 CUP' : 'MANA DOTA 2 CUP'));
  const [date, setDate] = useState(tournament?.date || '2026');
  const [bannerImage, setBannerImage] = useState(tournament?.bannerImage || (game === 'cs2' ? '/assets/tournaments/mana-cup-banner.svg' : '/assets/dota/dota-tournament.svg'));
  const [description, setDescription] = useState(tournament?.description || 'Описание турнира');
  const [place1Team, setPlace1Team] = useState(first?.teamName || 'TEAM A');
  const [place2Team, setPlace2Team] = useState(second?.teamName || 'TEAM B');
  const [place3Team, setPlace3Team] = useState(third?.teamName || 'TEAM C');
  const [place1Photo, setPlace1Photo] = useState(first?.teamPhoto || (game === 'cs2' ? '/assets/teams/team-first.svg' : '/assets/dota/dota-team-first.svg'));
  const [place2Photo, setPlace2Photo] = useState(second?.teamPhoto || (game === 'cs2' ? '/assets/teams/team-second.svg' : '/assets/dota/dota-team-second.svg'));
  const [place3Photo, setPlace3Photo] = useState(third?.teamPhoto || (game === 'cs2' ? '/assets/teams/team-third.svg' : '/assets/dota/dota-team-third.svg'));
  const [place1Players, setPlace1Players] = useState((first?.players || ['Player 1', 'Player 2', 'Player 3', 'Player 4', 'Player 5']).join(', '));
  const [place2Players, setPlace2Players] = useState((second?.players || ['Player 1', 'Player 2', 'Player 3', 'Player 4', 'Player 5']).join(', '));
  const [place3Players, setPlace3Players] = useState((third?.players || ['Player 1', 'Player 2', 'Player 3', 'Player 4', 'Player 5']).join(', '));
  const [creating, setCreating] = useState(false);
  const [localError, setLocalError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (creating) return;
    setCreating(true);
    setLocalError('');
    onError('');
    const response = await emitWithAck<PastPayload>(mode === 'edit' ? 'past:edit' : 'past:create', {
      id: tournament?.id,
      game,
      adminToken,
      title,
      date,
      bannerImage,
      description,
      place1Team,
      place2Team,
      place3Team,
      place1Photo,
      place2Photo,
      place3Photo,
      place1Players,
      place2Players,
      place3Players
    });
    setCreating(false);
    if (!response.ok) {
      setLocalError(response.error);
      onError(response.error);
      if (isAdminAuthError(response.error)) onAdminAuthError();
      return;
    }
    onCreated(response.tournaments || []);
  };

  return (
    <ModalShell className="createMatchModal" labelledBy="past-form-title" onClose={onClose}>
        <div className="modalHead">
          <div>
            <span>Архив MANA</span>
            <h2 id="past-form-title">{mode === 'edit' ? 'Редактировать турнир' : 'Добавить турнир'}</h2>
          </div>
          <button type="button" className="xBtn" aria-label="Закрыть форму турнира" onClick={onClose}>×</button>
        </div>
        <form className="modalForm" onSubmit={submit}>
          <label>Название<input data-testid="past-title-input" value={title} onChange={(event) => setTitle(event.target.value)} required /></label>
          <label>Дата<input data-testid="past-date-input" value={date} onChange={(event) => setDate(event.target.value)} required /></label>
          <label>Баннер<input data-testid="past-banner-input" value={bannerImage} onChange={(event) => setBannerImage(event.target.value)} required /></label>
          <label>Описание<input data-testid="past-description-input" value={description} onChange={(event) => setDescription(event.target.value)} required /></label>
          <div className="twoFields">
            <label>1 место<input data-testid="past-place1-team-input" value={place1Team} onChange={(event) => setPlace1Team(event.target.value)} required /></label>
            <label>Фото 1 места<input value={place1Photo} onChange={(event) => setPlace1Photo(event.target.value)} required /></label>
          </div>
          <label>Игроки 1 места<input value={place1Players} onChange={(event) => setPlace1Players(event.target.value)} required /></label>
          <div className="twoFields">
            <label>2 место<input value={place2Team} onChange={(event) => setPlace2Team(event.target.value)} required /></label>
            <label>Фото 2 места<input value={place2Photo} onChange={(event) => setPlace2Photo(event.target.value)} required /></label>
          </div>
          <label>Игроки 2 места<input value={place2Players} onChange={(event) => setPlace2Players(event.target.value)} required /></label>
          <div className="twoFields">
            <label>3 место<input value={place3Team} onChange={(event) => setPlace3Team(event.target.value)} required /></label>
            <label>Фото 3 места<input value={place3Photo} onChange={(event) => setPlace3Photo(event.target.value)} required /></label>
          </div>
          <label>Игроки 3 места<input value={place3Players} onChange={(event) => setPlace3Players(event.target.value)} required /></label>
          {localError && <p className="errorText" role="alert" aria-live="polite">{localError}</p>}
          <div className="modalActions">
            <button type="submit" data-testid="past-submit" disabled={creating}>{creating ? 'Сохраняю...' : mode === 'edit' ? 'Сохранить' : 'Добавить'}</button>
            <button type="button" className="ghostBtn" onClick={onClose}>Отмена</button>
          </div>
        </form>
    </ModalShell>
  );
}
