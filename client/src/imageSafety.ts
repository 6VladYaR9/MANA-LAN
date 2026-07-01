const FALLBACK_TOURNAMENT_IMAGE = '/assets/tournaments/mana-cup-banner.svg';
const SAFE_LOCAL_PREFIXES = ['/assets/', '/images/', '/uploads/'];
const SAFE_REMOTE_HOSTS = new Set<string>();

export function safeTournamentImageSrc(value?: string | null, fallback = FALLBACK_TOURNAMENT_IMAGE) {
  const raw = String(value || '').trim();
  if (!raw) return fallback;

  if (raw.startsWith('/')) {
    return SAFE_LOCAL_PREFIXES.some((prefix) => raw.startsWith(prefix)) ? raw : fallback;
  }

  try {
    const url = new URL(raw);
    if (url.protocol === 'https:' && SAFE_REMOTE_HOSTS.has(url.hostname)) return url.toString();
  } catch {
    return fallback;
  }

  return fallback;
}
