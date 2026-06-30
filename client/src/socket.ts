import { io } from 'socket.io-client';

// В dev-режиме Vite работает на 5173, backend на 3001.
// В production сайт и Socket.io работают на одном домене через backend.
const DEV_SOCKET_URL = `${window.location.protocol}//${window.location.hostname}:3001`;
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || (window.location.port === '5173' ? DEV_SOCKET_URL : undefined);

export const socket = io(SOCKET_URL, {
  autoConnect: true,
  reconnection: true
});
