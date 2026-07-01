import { beforeEach, describe, expect, it } from 'vitest';
import { clearPlayerSessionToken, getPlayerSessionToken, playerSessionKey, setPlayerSessionToken } from './playerSession';

describe('player session token storage', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('stores player sessions per room', () => {
    setPlayerSessionToken('room-1', 'player-token-a');

    expect(playerSessionKey('room-1')).toBe('player-session-token:room-1');
    expect(getPlayerSessionToken('room-1')).toBe('player-token-a');
    expect(getPlayerSessionToken('room-2')).toBe('');
  });

  it('drops stale sessions when an empty token is written', () => {
    setPlayerSessionToken('room-1', 'player-token-a');
    setPlayerSessionToken('room-1', '');

    expect(getPlayerSessionToken('room-1')).toBe('');
  });

  it('clears only the requested room session', () => {
    setPlayerSessionToken('room-1', 'player-token-a');
    setPlayerSessionToken('room-2', 'player-token-b');
    clearPlayerSessionToken('room-1');

    expect(getPlayerSessionToken('room-1')).toBe('');
    expect(getPlayerSessionToken('room-2')).toBe('player-token-b');
  });
});
