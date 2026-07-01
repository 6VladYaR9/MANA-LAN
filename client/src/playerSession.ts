export function playerSessionKey(roomId: string) {
  return `player-session-token:${roomId}`;
}

export function getPlayerSessionToken(roomId: string) {
  return sessionStorage.getItem(playerSessionKey(roomId)) || '';
}

export function setPlayerSessionToken(roomId: string, token: string) {
  if (token) {
    sessionStorage.setItem(playerSessionKey(roomId), token);
    return;
  }

  clearPlayerSessionToken(roomId);
}

export function clearPlayerSessionToken(roomId: string) {
  sessionStorage.removeItem(playerSessionKey(roomId));
}
