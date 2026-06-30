import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import ManaLogo from '../components/ManaLogo';
import { socket } from '../socket';
import type { GameType, SocketAck } from '../types';
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

  const load = () => {
    socket.emit('past:get', { game }, (response: SocketAck<PastPayload>) => {
      if (response.ok) setTournaments(response.tournaments || []);
      else setError(response.error);
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
    socket.emit('past:delete', { id, game, adminToken }, (response: SocketAck<PastPayload>) => {
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setTournaments(response.tournaments || []);
    });
  };

  return (
    <main className="appShell pastPage">
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
        {isAdmin && <button type="button" className="createBtn pastAddButton" onClick={() => setShowAdd(true)}>Добавить турнир</button>}
      </section>

      {error && <div className="errorBox">{error}</div>}

      <section className="pastCardsGrid">
        {tournaments.map((tournament) => (
          <article className="pastTournamentCardShell" key={tournament.id}>
            <Link className="pastTournamentCard" to={`/past/${tournament.id}`}>
              <img src={tournament.bannerImage} alt={tournament.title} />
              <div className="pastTournamentOverlay">
                <span>{tournament.date}</span>
                <h2>{tournament.title}</h2>
                <p>{tournament.description}</p>
                <b>Открыть турнир →</b>
              </div>
            </Link>
            {isAdmin && <button type="button" className="ghostBtn pastDeleteButton" onClick={() => deleteTournament(tournament.id)}>Удалить</button>}
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
  onError
}: {
  game: GameType;
  adminToken: string;
  onClose: () => void;
  onCreated: (items: PastTournament[]) => void;
  onError: (message: string) => void;
}) {
  const [title, setTitle] = useState(game === 'cs2' ? 'MANA CS2 CUP' : 'MANA DOTA 2 CUP');
  const [date, setDate] = useState('2026');
  const [description, setDescription] = useState('Описание турнира');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    socket.emit('past:create', { game, adminToken, title, date, description }, (response: SocketAck<PastPayload>) => {
      if (!response.ok) {
        onError(response.error);
        return;
      }
      onCreated(response.tournaments || []);
    });
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
          <label>Название<input value={title} onChange={(event) => setTitle(event.target.value)} required /></label>
          <label>Дата<input value={date} onChange={(event) => setDate(event.target.value)} required /></label>
          <label>Описание<input value={description} onChange={(event) => setDescription(event.target.value)} required /></label>
          <div className="modalActions">
            <button type="submit">Добавить</button>
            <button type="button" className="ghostBtn" onClick={onClose}>Отмена</button>
          </div>
        </form>
      </div>
    </div>
  );
}
