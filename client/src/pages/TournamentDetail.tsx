import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import ManaLogo from '../components/ManaLogo';
import { socket } from '../socket';
import type { GameType, SocketAck } from '../types';
import type { PastTournament, PastTournamentPlace } from '../data/tournamentData';
import './TournamentDetail.css';

function placeClass(place: number) {
  if (place === 1) return 'firstPlace';
  if (place === 2) return 'secondPlace';
  return 'thirdPlace';
}

function placeTitle(place: number) {
  if (place === 1) return '1 МЕСТО';
  if (place === 2) return '2 МЕСТО';
  return '3 МЕСТО';
}

export default function TournamentDetail({
  game,
  isAdmin,
  onAdminLogout
}: {
  game: GameType;
  isAdmin: boolean;
  onAdminLogout: () => void;
}) {
  const { tournamentId } = useParams();
  const [tournament, setTournament] = useState<PastTournament | null | undefined>(undefined);

  useEffect(() => {
    socket.emit('past:get', { game }, (response: SocketAck<{ tournaments: PastTournament[] }>) => {
      if (!response.ok) {
        setTournament(null);
        return;
      }
      setTournament((response.tournaments || []).find((item) => item.id === tournamentId) || null);
    });
  }, [game, tournamentId]);

  if (tournament === undefined) return <main className="appShell tournamentPage"><section className="emptyRooms"><p>Загрузка турнира...</p></section></main>;
  if (!tournament) return <Navigate to="/past" replace />;

  const first = tournament.podium.find((place) => place.place === 1) as PastTournamentPlace;
  const second = tournament.podium.find((place) => place.place === 2) as PastTournamentPlace;
  const third = tournament.podium.find((place) => place.place === 3) as PastTournamentPlace;

  return (
    <main className="appShell tournamentPage">
      <header className="topBar">
        <ManaLogo />
        <nav className="roomNav">
          <button type="button" className="miniBadge navLink gameSwitchLink disabledNavButton" disabled>DOTA 2 · В разработке</button>
          <Link className="miniBadge navLink" to="/bracket">Просмотр сетки</Link>
          <Link className="miniBadge navLink" to="/past">Прошлые турниры</Link>
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

      <section className="tournamentBanner">
        <img src={tournament.bannerImage} alt={tournament.title} />
        <div>
          <span className="eyebrow">MANA HALL OF FAME · {game === 'cs2' ? 'CS2' : 'DOTA 2'}</span>
          <h1>{tournament.title}</h1>
          <p>{tournament.date}</p>
          <b>{tournament.description}</b>
        </div>
      </section>

      <section className="podiumSection">
        <div className="podiumTitle">
          <span className="eyebrow">РЕЗУЛЬТАТЫ ТУРНИРА</span>
          <h2>ПЬЕДЕСТАЛ ПОБЕДИТЕЛЕЙ</h2>
        </div>

        <div className="podiumStage">
          <PodiumPlace data={second} />
          <PodiumPlace data={first} />
          <PodiumPlace data={third} />
        </div>
      </section>

      <section className="rosterSection">
        {[second, first, third].map((place) => (
          <article className={`rosterCard ${placeClass(place.place)}`} key={place.place}>
            <h3>{placeTitle(place.place)}</h3>
            <b>{place.teamName}</b>
            <ul>
              {place.players.map((player) => <li key={`${place.teamName}-${player}`}>{player}</li>)}
            </ul>
          </article>
        ))}
      </section>
    </main>
  );
}

function PodiumPlace({ data }: { data: PastTournamentPlace }) {
  return (
    <article className={`podiumPlace ${placeClass(data.place)}`}>
      <div className="teamPhotoFrame">
        <img src={data.teamPhoto} alt={data.teamName} />
      </div>
      <div className="podiumBlock">
        <span>{placeTitle(data.place)}</span>
        <b>{data.teamName}</b>
      </div>
    </article>
  );
}
