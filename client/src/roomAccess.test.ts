import { beforeEach, describe, expect, it } from 'vitest';
import { clearRoomAccessToken, getRoomAccessToken, roomAccessKey, setRoomAccessToken } from './roomAccess';

describe('room access token storage', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('stores and reads room-scoped access tokens', () => {
    setRoomAccessToken('room-1', 'token-a');

    expect(roomAccessKey('room-1')).toBe('room-access-token:room-1');
    expect(getRoomAccessToken('room-1')).toBe('token-a');
    expect(getRoomAccessToken('room-2')).toBe('');
  });

  it('clears stale tokens when the server returns an empty token', () => {
    setRoomAccessToken('room-1', 'token-a');
    setRoomAccessToken('room-1', '');

    expect(getRoomAccessToken('room-1')).toBe('');
  });

  it('removes only the requested room token', () => {
    setRoomAccessToken('room-1', 'token-a');
    setRoomAccessToken('room-2', 'token-b');
    clearRoomAccessToken('room-1');

    expect(getRoomAccessToken('room-1')).toBe('');
    expect(getRoomAccessToken('room-2')).toBe('token-b');
  });
});
