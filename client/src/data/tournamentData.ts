export type RoundRobinTeam = {
  id: string;
  label: string;
  name: string;
};

export type RoundRobinResults = Record<string, Record<string, string>>;

export type RoundRobinGroupKey = 'yuz' | 'lenina';

export type RoundRobinGroupConfig = {
  key: RoundRobinGroupKey;
  clubName: string;
  teams: RoundRobinTeam[];
  results: RoundRobinResults;
};

export type QuarterFinalPair = {
  top: string;
  bottom: string;
};

export type PastTournamentPlace = {
  place: 1 | 2 | 3;
  teamName: string;
  teamPhoto: string;
  players: string[];
};

export type PastTournament = {
  id: string;
  game?: 'cs2' | 'dota2';
  title: string;
  date: string;
  bannerImage: string;
  description: string;
  podium: [PastTournamentPlace, PastTournamentPlace, PastTournamentPlace];
};

const DEFAULT_RESULTS: RoundRobinResults = {
  A: { B: '2:0', C: '2:1', D: '2:0', E: '2:0', F: '2:0', G: '2:0', H: '2:1' },
  B: { C: '2:0', D: '2:1', E: '2:1', F: '2:0', G: '2:0', H: '2:1' },
  C: { D: '2:0', E: '2:0', F: '2:1', G: '2:1', H: '2:0' },
  D: { E: '2:1', F: '2:0', G: '2:0', H: '2:0' },
  E: { F: '2:0', G: '2:1', H: '2:0' },
  F: { G: '2:1', H: '2:1' },
  G: { H: '2:0' },
  H: {}
};

function makeTeams(prefix: string): RoundRobinTeam[] {
  return [
    { id: 'A', label: 'A', name: `${prefix} TEAM A` },
    { id: 'B', label: 'B', name: `${prefix} TEAM B` },
    { id: 'C', label: 'C', name: `${prefix} TEAM C` },
    { id: 'D', label: 'D', name: `${prefix} TEAM D` },
    { id: 'E', label: 'E', name: `${prefix} TEAM E` },
    { id: 'F', label: 'F', name: `${prefix} TEAM F` },
    { id: 'G', label: 'G', name: `${prefix} TEAM G` },
    { id: 'H', label: 'H', name: `${prefix} TEAM H` }
  ];
}

export const ROUND_ROBIN_GROUPS: RoundRobinGroupConfig[] = [
  {
    key: 'yuz',
    clubName: 'ЮЗ',
    teams: makeTeams('ЮЗ'),
    results: DEFAULT_RESULTS
  },
  {
    key: 'lenina',
    clubName: 'ЛЕНИНА',
    teams: makeTeams('ЛЕН'),
    results: DEFAULT_RESULTS
  }
];

export const QUARTER_FINALS: QuarterFinalPair[] = [
  { top: 'TEAM A', bottom: 'TEAM B' },
  { top: 'TEAM C', bottom: 'TEAM D' },
  { top: 'TEAM E', bottom: 'TEAM F' },
  { top: 'TEAM G', bottom: 'TEAM H' }
];

// Здесь удобно менять карточки прошлых турниров, фото, пьедестал и составы.
// Фото должны лежать в client/public и указываться от корня сайта, например /assets/teams/team-first.svg.
export const PAST_TOURNAMENTS: PastTournament[] = [
  {
    id: 'mana-cs2-cup-2026',
    title: 'MANA CS2 CUP',
    date: '2026',
    bannerImage: '/assets/tournaments/mana-cup-banner.svg',
    description: 'Пример страницы прошедшего турнира. Замени баннер, фото команд и составы в client/src/data/tournamentData.ts.',
    podium: [
      {
        place: 1,
        teamName: 'TEAM A',
        teamPhoto: '/assets/teams/team-first.svg',
        players: ['Player 1', 'Player 2', 'Player 3', 'Player 4', 'Player 5']
      },
      {
        place: 2,
        teamName: 'TEAM E',
        teamPhoto: '/assets/teams/team-second.svg',
        players: ['Player 1', 'Player 2', 'Player 3', 'Player 4', 'Player 5']
      },
      {
        place: 3,
        teamName: 'TEAM C',
        teamPhoto: '/assets/teams/team-third.svg',
        players: ['Player 1', 'Player 2', 'Player 3', 'Player 4', 'Player 5']
      }
    ]
  }
];
