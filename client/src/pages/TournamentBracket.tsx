import { ChangeEvent, ReactNode, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import ManaLogo from '../components/ManaLogo';
import type { GameType } from '../types';
import {
  ROUND_ROBIN_GROUPS,
  QuarterFinalPair,
  RoundRobinGroupConfig,
  RoundRobinGroupKey,
  RoundRobinResults,
  RoundRobinTeam
} from '../data/tournamentData';
import './TournamentBracket.css';

type TeamStats = RoundRobinTeam & {
  wins: number;
  losses: number;
  mapsWon: number;
  mapsLost: number;
  points: number;
};

type WinnerSide = 'top' | 'bottom' | null;
type BracketTab = RoundRobinGroupKey | 'playoff';

type PlayoffState = {
  qf: WinnerSide[];
  sf: WinnerSide[];
  final: WinnerSide;
};

type GroupState = {
  teams: RoundRobinTeam[];
  results: RoundRobinResults;
};

type GroupMap = Record<RoundRobinGroupKey, GroupState>;
type QuarterFinalOverrides = Array<Partial<QuarterFinalPair>>;

const STORAGE_KEY_PREFIX = 'mana-bracket-editor-v6';

const DEFAULT_PLAYOFF: PlayoffState = {
  qf: [null, null, null, null],
  sf: [null, null],
  final: null
};

function cloneResults(results: RoundRobinResults): RoundRobinResults {
  return Object.fromEntries(
    Object.entries(results).map(([teamId, values]) => [teamId, { ...values }])
  );
}

function cloneTeams(teams: RoundRobinTeam[]) {
  return teams.map((team) => ({ ...team }));
}

function makeDefaultGroups(): GroupMap {
  const entries = ROUND_ROBIN_GROUPS.map((group) => [
    group.key,
    {
      teams: cloneTeams(group.teams),
      results: cloneResults(group.results)
    }
  ]);

  return Object.fromEntries(entries) as GroupMap;
}

function emptyResultsForTeams(teams: RoundRobinTeam[], source: RoundRobinResults): RoundRobinResults {
  const next: RoundRobinResults = {};
  teams.forEach((rowTeam, rowIndex) => {
    next[rowTeam.id] = {};
    teams.forEach((colTeam, colIndex) => {
      if (rowIndex < colIndex) {
        next[rowTeam.id][colTeam.id] = source[rowTeam.id]?.[colTeam.id] || '';
      }
    });
  });
  return next;
}

function reverseScore(score: string) {
  const parts = score.split(':').map((part) => part.trim());
  if (parts.length !== 2) return score;
  return `${parts[1]}:${parts[0]}`;
}

function parseScore(score: string) {
  const match = score.trim().match(/^(\d+)\s*[:\-]\s*(\d+)$/);
  if (!match) return null;

  const left = Number(match[1]);
  const right = Number(match[2]);
  if (!Number.isFinite(left) || !Number.isFinite(right) || left === right) return null;

  return { left, right };
}

function getPairScore(results: RoundRobinResults, rowId: string, colId: string) {
  if (results[rowId]?.[colId]) return results[rowId][colId];
  if (results[colId]?.[rowId]) return reverseScore(results[colId][rowId]);
  return '';
}

function buildStandings(teams: RoundRobinTeam[], results: RoundRobinResults): TeamStats[] {
  const stats = teams.map((team) => ({ ...team, wins: 0, losses: 0, mapsWon: 0, mapsLost: 0, points: 0 }));
  const byId = new Map(stats.map((team) => [team.id, team]));

  teams.forEach((teamA, aIndex) => {
    teams.forEach((teamB, bIndex) => {
      if (aIndex >= bIndex) return;
      const score = parseScore(getPairScore(results, teamA.id, teamB.id));
      if (!score) return;

      const aStats = byId.get(teamA.id);
      const bStats = byId.get(teamB.id);
      if (!aStats || !bStats) return;

      aStats.mapsWon += score.left;
      aStats.mapsLost += score.right;
      bStats.mapsWon += score.right;
      bStats.mapsLost += score.left;

      if (score.left > score.right) {
        aStats.wins += 1;
        bStats.losses += 1;
        aStats.points += 3;
      } else {
        bStats.wins += 1;
        aStats.losses += 1;
        bStats.points += 3;
      }
    });
  });

  return [...stats].sort((a, b) => {
    const pointDiff = b.points - a.points;
    if (pointDiff) return pointDiff;

    const winDiff = b.wins - a.wins;
    if (winDiff) return winDiff;

    const mapDiff = (b.mapsWon - b.mapsLost) - (a.mapsWon - a.mapsLost);
    if (mapDiff) return mapDiff;

    return a.name.localeCompare(b.name, 'ru');
  });
}

function teamAt(standings: TeamStats[], index: number, fallback: string) {
  return standings[index]?.name || fallback;
}

function buildAutoQuarterFinals(groups: GroupMap): QuarterFinalPair[] {
  const yuz = buildStandings(groups.yuz.teams, groups.yuz.results);
  const lenina = buildStandings(groups.lenina.teams, groups.lenina.results);

  return [
    { top: teamAt(yuz, 0, 'ЮЗ #1'), bottom: teamAt(lenina, 3, 'ЛЕНИНА #4') },
    { top: teamAt(yuz, 1, 'ЮЗ #2'), bottom: teamAt(lenina, 2, 'ЛЕНИНА #3') },
    { top: teamAt(lenina, 0, 'ЛЕНИНА #1'), bottom: teamAt(yuz, 3, 'ЮЗ #4') },
    { top: teamAt(lenina, 1, 'ЛЕНИНА #2'), bottom: teamAt(yuz, 2, 'ЮЗ #3') }
  ];
}

function applyQuarterFinalOverrides(auto: QuarterFinalPair[], overrides: QuarterFinalOverrides): QuarterFinalPair[] {
  return auto.map((match, index) => ({
    top: overrides[index]?.top || match.top,
    bottom: overrides[index]?.bottom || match.bottom
  }));
}

function getStoredState(game: GameType) {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}:${game}`);
    if (!raw) return null;
    return JSON.parse(raw) as {
      activeTab?: BracketTab;
      groups?: GroupMap;
      quarterFinalOverrides?: QuarterFinalOverrides;
      winners?: PlayoffState;
    };
  } catch {
    return null;
  }
}

function saveState(game: GameType, payload: {
  activeTab: BracketTab;
  groups: GroupMap;
  quarterFinalOverrides: QuarterFinalOverrides;
  winners: PlayoffState;
}) {
  localStorage.setItem(`${STORAGE_KEY_PREFIX}:${game}`, JSON.stringify(payload));
}

export default function TournamentBracket({ game, isAdmin, onAdminLogout }: { game: GameType; isAdmin: boolean; onAdminLogout: () => void }) {
  const defaults = makeDefaultGroups();
  const stored = getStoredState(game);

  const [activeTab, setActiveTab] = useState<BracketTab>(stored?.activeTab || 'yuz');
  const [groups, setGroups] = useState<GroupMap>(stored?.groups || defaults);
  const [quarterFinalOverrides, setQuarterFinalOverrides] = useState<QuarterFinalOverrides>(stored?.quarterFinalOverrides || []);
  const [winners, setWinners] = useState<PlayoffState>(stored?.winners || DEFAULT_PLAYOFF);

  const autoQuarterFinals = useMemo(() => buildAutoQuarterFinals(groups), [groups]);
  const quarterFinals = useMemo(
    () => applyQuarterFinalOverrides(autoQuarterFinals, quarterFinalOverrides),
    [autoQuarterFinals, quarterFinalOverrides]
  );

  const activeGroupConfig = useMemo(
    () => ROUND_ROBIN_GROUPS.find((group) => group.key === (activeTab === 'playoff' ? 'yuz' : activeTab)) || ROUND_ROBIN_GROUPS[0],
    [activeTab]
  );
  const activeGroupKey = activeGroupConfig.key;
  const activeGroup = groups[activeGroupKey];
  const activeStandings = useMemo(
    () => buildStandings(activeGroup.teams, activeGroup.results),
    [activeGroup]
  );

  const persist = (
    nextActiveTab = activeTab,
    nextGroups = groups,
    nextOverrides = quarterFinalOverrides,
    nextWinners = winners
  ) => {
    saveState(game, {
      activeTab: nextActiveTab,
      groups: nextGroups,
      quarterFinalOverrides: nextOverrides,
      winners: nextWinners
    });
  };

  const changeTab = (tab: BracketTab) => {
    setActiveTab(tab);
    persist(tab);
  };

  const updateTeamName = (groupKey: RoundRobinGroupKey, index: number, value: string) => {
    const nextGroups: GroupMap = {
      ...groups,
      [groupKey]: {
        ...groups[groupKey],
        teams: groups[groupKey].teams.map((team, teamIndex) => (
          teamIndex === index ? { ...team, name: value.toUpperCase() } : team
        ))
      }
    };

    const nextWinners = DEFAULT_PLAYOFF;
    setGroups(nextGroups);
    setWinners(nextWinners);
    persist(activeTab, nextGroups, quarterFinalOverrides, nextWinners);
  };

  const updateScore = (groupKey: RoundRobinGroupKey, rowId: string, colId: string, value: string) => {
    const group = groups[groupKey];
    const rowIndex = group.teams.findIndex((team) => team.id === rowId);
    const colIndex = group.teams.findIndex((team) => team.id === colId);
    if (rowIndex === colIndex) return;

    const nextResults = emptyResultsForTeams(group.teams, group.results);
    const cleanValue = value.replace(/[^0-9:\-]/g, '').slice(0, 5);

    if (rowIndex < colIndex) {
      nextResults[rowId][colId] = cleanValue;
    } else {
      nextResults[colId][rowId] = reverseScore(cleanValue);
    }

    const nextGroups: GroupMap = {
      ...groups,
      [groupKey]: {
        ...group,
        results: nextResults
      }
    };

    const nextWinners = DEFAULT_PLAYOFF;
    setGroups(nextGroups);
    setWinners(nextWinners);
    persist(activeTab, nextGroups, quarterFinalOverrides, nextWinners);
  };

  const updateQuarterFinalTeam = (matchIndex: number, side: 'top' | 'bottom', value: string) => {
    const nextOverrides = [...quarterFinalOverrides];
    nextOverrides[matchIndex] = {
      ...nextOverrides[matchIndex],
      [side]: value.toUpperCase()
    };
    const nextWinners = { ...winners, qf: [...DEFAULT_PLAYOFF.qf], sf: [...DEFAULT_PLAYOFF.sf], final: null };
    setQuarterFinalOverrides(nextOverrides);
    setWinners(nextWinners);
    persist(activeTab, groups, nextOverrides, nextWinners);
  };

  const resetQuarterFinalOverrides = () => {
    const nextOverrides: QuarterFinalOverrides = [];
    const nextWinners = DEFAULT_PLAYOFF;
    setQuarterFinalOverrides(nextOverrides);
    setWinners(nextWinners);
    persist(activeTab, groups, nextOverrides, nextWinners);
  };

  const setWinner = (stage: 'qf' | 'sf' | 'final', index: number, side: 'top' | 'bottom') => {
    const nextWinners: PlayoffState = {
      qf: [...winners.qf],
      sf: [...winners.sf],
      final: winners.final
    };

    if (stage === 'qf') {
      nextWinners.qf[index] = side;
      const sfIndex = index < 2 ? 0 : 1;
      nextWinners.sf[sfIndex] = null;
      nextWinners.final = null;
    }

    if (stage === 'sf') {
      nextWinners.sf[index] = side;
      nextWinners.final = null;
    }

    if (stage === 'final') {
      nextWinners.final = side;
    }

    setWinners(nextWinners);
    persist(activeTab, groups, quarterFinalOverrides, nextWinners);
  };

  const reset = () => {
    const nextGroups = makeDefaultGroups();
    const nextOverrides: QuarterFinalOverrides = [];
    const nextWinners = DEFAULT_PLAYOFF;
    setGroups(nextGroups);
    setQuarterFinalOverrides(nextOverrides);
    setWinners(nextWinners);
    saveState(game, { activeTab, groups: nextGroups, quarterFinalOverrides: nextOverrides, winners: nextWinners });
  };

  const qfWinners = quarterFinals.map((match, index) => getMatchWinnerName(match, winners.qf[index]));
  const semiFinals: QuarterFinalPair[] = [
    { top: qfWinners[0] || 'ПОБЕДИТЕЛЬ QF1', bottom: qfWinners[1] || 'ПОБЕДИТЕЛЬ QF2' },
    { top: qfWinners[2] || 'ПОБЕДИТЕЛЬ QF3', bottom: qfWinners[3] || 'ПОБЕДИТЕЛЬ QF4' }
  ];
  const sfWinnerNames = semiFinals.map((match, index) => getMatchWinnerName(match, winners.sf[index]));
  const finalMatch: QuarterFinalPair = {
    top: sfWinnerNames[0] || 'ПОБЕДИТЕЛЬ SF1',
    bottom: sfWinnerNames[1] || 'ПОБЕДИТЕЛЬ SF2'
  };
  const champion = getMatchWinnerName(finalMatch, winners.final);

  return (
    <main className="appShell bracketPage">
      <header className="topBar bracketTopBar">
        <ManaLogo />
        <nav className="roomNav">
          <button type="button" className="miniBadge navLink gameSwitchLink disabledNavButton" disabled>DOTA 2 · В разработке</button>
          {isAdmin && <button type="button" className="ghostBtn bracketReload" onClick={reset}>Сбросить сетки</button>}
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

      <section className="bracketSelectorPanel">
        <div>
          <span className="eyebrow">MANA TOURNAMENT VIEW · {game === 'cs2' ? 'CS2' : 'DOTA 2'}</span>
          <h1>ПРОСМОТР <span>СЕТКИ</span></h1>
          <p className="muted">Победители Round Robin автоматически попадают в playoff: 1 место клуба играет против 4 места противоположного клуба, 2 место — против 3 места.</p>
        </div>

        <div className="bracketSwitches">
          <button type="button" className={`bracketSwitch ${activeTab === 'yuz' ? 'active' : ''}`} onClick={() => changeTab('yuz')}>
            <span>ROUND ROBIN</span>
            <b>ЮЗ</b>
          </button>
          <button type="button" className={`bracketSwitch ${activeTab === 'lenina' ? 'active' : ''}`} onClick={() => changeTab('lenina')}>
            <span>ROUND ROBIN</span>
            <b>ЛЕНИНА</b>
          </button>
          <button type="button" className={`bracketSwitch ${activeTab === 'playoff' ? 'active' : ''}`} onClick={() => changeTab('playoff')}>
            <span>PLAYOFF</span>
            <b>SINGLE ELIMINATION</b>
          </button>
        </div>
      </section>

      {activeTab === 'playoff' ? (
        <SingleEliminationSection
          quarterFinals={quarterFinals}
          semiFinals={semiFinals}
          finalMatch={finalMatch}
          winners={winners}
          champion={champion}
          onQuarterFinalTeamChange={updateQuarterFinalTeam}
          onWinnerSelect={setWinner}
          onResetOverrides={resetQuarterFinalOverrides}
          isAdmin={isAdmin}
        />
      ) : (
        <RoundRobinSection
          group={activeGroupConfig}
          teams={activeGroup.teams}
          results={activeGroup.results}
          standings={activeStandings}
          onTeamNameChange={(index, value) => updateTeamName(activeGroupKey, index, value)}
          onScoreChange={(rowId, colId, value) => updateScore(activeGroupKey, rowId, colId, value)}
          isAdmin={isAdmin}
        />
      )}
    </main>
  );
}

function RoundRobinSection({
  group,
  teams,
  results,
  standings,
  onTeamNameChange,
  onScoreChange,
  isAdmin
}: {
  group: RoundRobinGroupConfig;
  teams: RoundRobinTeam[];
  results: RoundRobinResults;
  standings: TeamStats[];
  onTeamNameChange: (index: number, value: string) => void;
  onScoreChange: (rowId: string, colId: string, value: string) => void;
  isAdmin: boolean;
}) {
  return (
    <section className="roundRobinBoard">
      <div className="boardTitleRow">
        <div>
          <span className="eyebrow">ГРУППОВОЙ ЭТАП · BO1</span>
          <h2>ROUND ROBIN — {group.clubName}</h2>
        </div>
        <div className="boardBadge">8 TEAMS</div>
      </div>

      <div className="rrGrid">
        <aside className="rrStandings">
          <div className="rrScoreTitle">СЧЁТ</div>
          {standings.map((team, index) => (
            <div className={index < 4 ? 'rrStandingRow rrQualifyRow' : 'rrStandingRow rrDangerRow'} key={team.id}>
              <span>{index + 1}</span>
              <b>{team.name}</b>
              <strong>{team.wins}-{team.losses}</strong>
              <em>{team.points}P</em>
            </div>
          ))}
        </aside>

        <div className="rrMatrixWrap">
          <div className="rrMatrix">
            <div className="rrCorner rrHeaderCell">#</div>
            {teams.map((team) => <div className="rrAxis rrHeaderCell" key={`top-${team.id}`}>{team.label}</div>)}

            {teams.map((rowTeam, rowIndex) => (
              <RowFragment key={rowTeam.id}>
                <div className="rrAxis rrSideAxis rrHeaderCell">{rowTeam.label}</div>
                {teams.map((colTeam, colIndex) => {
                  const score = getPairScore(results, rowTeam.id, colTeam.id);
                  const parsed = parseScore(score);
                  const isWin = parsed ? parsed.left > parsed.right : false;
                  const isLoss = parsed ? parsed.left < parsed.right : false;

                  return (
                    <div
                      className={`rrCell ${rowIndex === colIndex ? 'rrDiagonal' : ''} ${isWin ? 'rrWin' : ''} ${isLoss ? 'rrLoss' : ''}`}
                      key={`${rowTeam.id}-${colTeam.id}`}
                    >
                      {rowIndex === colIndex ? '' : (
                        <input
                          aria-label={`${rowTeam.name} vs ${colTeam.name}`}
                          value={score}
                          placeholder="-"
                          readOnly={!isAdmin}
                          className={!isAdmin ? 'readOnlyInput' : ''}
                          onChange={(event) => isAdmin && onScoreChange(rowTeam.id, colTeam.id, event.target.value)}
                        />
                      )}
                    </div>
                  );
                })}
              </RowFragment>
            ))}

            <div className="rrCorner rrHeaderCell">#</div>
            {teams.map((team) => <div className="rrAxis rrHeaderCell" key={`bottom-${team.id}`}>{team.label}</div>)}
          </div>
        </div>
      </div>

      {isAdmin ? (
        <details className="bracketEditor">
          <summary>Редактор команд — {group.clubName}</summary>
          <div className="teamEditorGrid">
            {teams.map((team, index) => (
              <label key={team.id}>
                Команда {team.label}
                <input value={team.name} onChange={(event: ChangeEvent<HTMLInputElement>) => onTeamNameChange(index, event.target.value)} />
              </label>
            ))}
          </div>
        </details>
      ) : (
        <p className="adminOnlyNotice bracketNotice">Редактирование сетки доступно только в админ-режиме.</p>
      )}
    </section>
  );
}

function SingleEliminationSection({
  quarterFinals,
  semiFinals,
  finalMatch,
  winners,
  champion,
  onQuarterFinalTeamChange,
  onWinnerSelect,
  onResetOverrides,
  isAdmin
}: {
  quarterFinals: QuarterFinalPair[];
  semiFinals: QuarterFinalPair[];
  finalMatch: QuarterFinalPair;
  winners: PlayoffState;
  champion: string;
  onQuarterFinalTeamChange: (matchIndex: number, side: 'top' | 'bottom', value: string) => void;
  onWinnerSelect: (stage: 'qf' | 'sf' | 'final', index: number, side: 'top' | 'bottom') => void;
  onResetOverrides: () => void;
  isAdmin: boolean;
}) {
  return (
    <section className="singleElimBoard">
      <div className="boardTitleRow">
        <div>
          <span className="eyebrow">PLAYOFF STAGE</span>
          <h2>SINGLE ELIMINATION</h2>
        </div>
        <div className="boardBadge">QF · SF · FINAL</div>
      </div>

      {isAdmin && (
        <div className="playoffAutoHint">
          <span>QF заполняется автоматически из Round Robin.</span>
          <button type="button" className="ghostBtn" onClick={onResetOverrides}>Сбросить ручные замены QF</button>
        </div>
      )}

      <div className="singleHeaders">
        <div>ЧЕТВЕРТЬФИНАЛ <span>BO1</span></div>
        <div>ПОЛУФИНАЛ <span>BO3</span></div>
        <div>ФИНАЛ <span>BO3</span></div>
      </div>

      <div className="playoffBracket">
        <div className="bracketColumn qfColumn">
          {quarterFinals.map((match, index) => (
            <EditableMatchBox
              key={`qf-${index}`}
              match={match}
              winner={winners.qf[index]}
              onWinner={(side) => isAdmin && onWinnerSelect('qf', index, side)}
              onNameChange={(side, value) => isAdmin && onQuarterFinalTeamChange(index, side, value)}
              isAdmin={isAdmin}
            />
          ))}
        </div>

        <div className="bracketColumn sfColumn">
          {semiFinals.map((match, index) => (
            <MatchBox
              key={`sf-${index}`}
              match={match}
              winner={winners.sf[index]}
              disabled={!isAdmin || match.top.includes('ПОБЕДИТЕЛЬ') || match.bottom.includes('ПОБЕДИТЕЛЬ')}
              onWinner={(side) => isAdmin && onWinnerSelect('sf', index, side)}
            />
          ))}
        </div>

        <div className="bracketColumn finalColumn">
          <MatchBox
            match={finalMatch}
            winner={winners.final}
            disabled={!isAdmin || finalMatch.top.includes('ПОБЕДИТЕЛЬ') || finalMatch.bottom.includes('ПОБЕДИТЕЛЬ')}
            onWinner={(side) => isAdmin && onWinnerSelect('final', 0, side)}
          />
          {champion && <div className="championPlate">ПОБЕДИТЕЛЬ <b>{champion}</b></div>}
        </div>
      </div>
      {!isAdmin && <p className="adminOnlyNotice bracketNotice">Выбор победителей playoff доступен только в админ-режиме.</p>}
    </section>
  );
}

function getMatchWinnerName(match: QuarterFinalPair, winner: WinnerSide) {
  if (!winner) return '';
  return winner === 'top' ? match.top : match.bottom;
}

function getRowClass(side: 'top' | 'bottom', winner: WinnerSide) {
  if (!winner) return '';
  return winner === side ? 'teamWinner' : 'teamLoser';
}

function MatchBox({
  match,
  winner,
  disabled,
  onWinner
}: {
  match: QuarterFinalPair;
  winner: WinnerSide;
  disabled?: boolean;
  onWinner: (side: 'top' | 'bottom') => void;
}) {
  return (
    <div className={`matchBox ${disabled ? 'matchDisabled' : ''}`}>
      <button type="button" className={`teamLine ${getRowClass('top', winner)}`} onClick={() => !disabled && onWinner('top')}>
        <span>{match.top}</span>
        <b>{winner ? (winner === 'top' ? 'W' : 'L') : ''}</b>
      </button>
      <button type="button" className={`teamLine ${getRowClass('bottom', winner)}`} onClick={() => !disabled && onWinner('bottom')}>
        <span>{match.bottom}</span>
        <b>{winner ? (winner === 'bottom' ? 'W' : 'L') : ''}</b>
      </button>
    </div>
  );
}

function EditableMatchBox({
  match,
  winner,
  onWinner,
  onNameChange,
  isAdmin
}: {
  match: QuarterFinalPair;
  winner: WinnerSide;
  onWinner: (side: 'top' | 'bottom') => void;
  onNameChange: (side: 'top' | 'bottom', value: string) => void;
  isAdmin: boolean;
}) {
  return (
    <div className="matchBox editableMatchBox">
      <div className={`teamLine editableTeamLine ${getRowClass('top', winner)}`}>
        <input value={match.top} readOnly={!isAdmin} onChange={(event) => isAdmin && onNameChange('top', event.target.value)} />
        <button type="button" disabled={!isAdmin} onClick={() => onWinner('top')}>{winner ? (winner === 'top' ? 'W' : 'L') : '✓'}</button>
      </div>
      <div className={`teamLine editableTeamLine ${getRowClass('bottom', winner)}`}>
        <input value={match.bottom} readOnly={!isAdmin} onChange={(event) => isAdmin && onNameChange('bottom', event.target.value)} />
        <button type="button" disabled={!isAdmin} onClick={() => onWinner('bottom')}>{winner ? (winner === 'bottom' ? 'W' : 'L') : '✓'}</button>
      </div>
    </div>
  );
}

function RowFragment({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
