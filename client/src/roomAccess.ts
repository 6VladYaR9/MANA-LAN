export function roomAccessKey(roomId: string) {
  return `room-access-token:${roomId}`;
}

export function getRoomAccessToken(roomId: string) {
  return sessionStorage.getItem(roomAccessKey(roomId)) || '';
}

export function setRoomAccessToken(roomId: string, token: string) {
  if (token) sessionStorage.setItem(roomAccessKey(roomId), token);
}

export function clearRoomAccessToken(roomId: string) {
  sessionStorage.removeItem(roomAccessKey(roomId));
}
