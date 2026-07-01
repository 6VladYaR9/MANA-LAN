import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ManaLogo from '../components/ManaLogo';
import { emitWithAck } from '../socketAck';
import { safeTournamentImageSrc } from '../imageSafety';
import type { GameType } from '../types';
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
  const requestIdRef = useRef(0);

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setTournament(undefined);

    void emitWithAck<{ tournaments: PastTournament[] }>('past:get', { game }).then((response) => {
      if (requestIdRef.current !== requestId) return;
      if (!response.ok) {
        setTournament(null);
        return;
      }
      setTournament((response.tournaments || []).find((item) => item.id === tournamentId) || null);
    });
  }, [game, tournamentId]);

  if (tournament === undefined) return <main className="appShell tournamentPage"><section className="emptyRooms"><p>Загрузка турнира...</p></section></main>;
  if (!tournament) {
    return (
      <main className="appShell tournamentPage" data-testid="tournament-not-found-page">
        <section className="emptyRooms">
          <h3>Турнир не найден</h3>
          <p>Проверь ссылку или вернись в архив.</p>
          <Link className="adminLinkButton" to="/past">К прошлым турнирам</Link>
        </section>
      </main>
    );
  }

  const first = tournament.podium.find((place) => place.place === 1) as PastTournamentPlace;
  const second = tournament.podium.find((place) => place.place === 2) as PastTournamentPlace;
  const third = tournament.podium.find((place) => place.place === 3) as PastTournamentPlace;

  return (
    <main className="appShell tournamentPage" data-testid="tournament-detail-page">
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
        <div>
          <span className="eyebrow">MANA HALL OF FAME · {game === 'cs2' ? 'CS2' : 'DOTA 2'}</span>
          <h1 data-testid="tournament-detail-title">{tournament.title}</h1>
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
        <img
          src={safeTournamentImageSrc(data.teamPhoto, '/assets/teams/team-first.svg')}
          alt={data.teamName}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={(event) => {
            event.currentTarget.src = safeTournamentImageSrc(null, '/assets/teams/team-first.svg');
          }}
        />
      </div>
      <div className="podiumBlock">
        <span>{placeTitle(data.place)}</span>
        <b>{data.teamName}</b>
      </div>
    </article>
  );
}
