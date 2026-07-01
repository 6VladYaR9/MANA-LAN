import { describe, expect, it } from 'vitest';
import { safeTournamentImageSrc } from './imageSafety';

describe('safeTournamentImageSrc', () => {
  it('allows local archive asset paths', () => {
    expect(safeTournamentImageSrc('/assets/tournaments/banner.svg')).toBe('/assets/tournaments/banner.svg');
    expect(safeTournamentImageSrc('/uploads/archive/photo.webp')).toBe('/uploads/archive/photo.webp');
    expect(safeTournamentImageSrc('/images/archive/photo.png')).toBe('/images/archive/photo.png');
  });

  it('falls back for unsafe local paths', () => {
    expect(safeTournamentImageSrc('/admin/secret.png', '/fallback.svg')).toBe('/fallback.svg');
    expect(safeTournamentImageSrc('../secret.png', '/fallback.svg')).toBe('/fallback.svg');
  });

  it('falls back for remote and empty values', () => {
    expect(safeTournamentImageSrc('https://evil.test/banner.png', '/fallback.svg')).toBe('/fallback.svg');
    expect(safeTournamentImageSrc('', '/fallback.svg')).toBe('/fallback.svg');
  });
});
