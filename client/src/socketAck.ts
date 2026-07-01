import { socket } from './socket';
import type { SocketAck } from './types';

const DEFAULT_ACK_TIMEOUT_MS = 8000;

export function isAdminAuthError(error = '') {
  return /admin|админ|доступно только|unauthorized|forbidden/i.test(error);
}

export function emitWithAck<T = unknown>(event: string, payload?: unknown, timeoutMs = DEFAULT_ACK_TIMEOUT_MS) {
  return new Promise<SocketAck<T>>((resolve) => {
    const done = (error: Error | null, response?: SocketAck<T>) => {
      if (error) {
        resolve({ ok: false, error: 'Сервер не ответил. Проверь соединение и попробуй еще раз.' });
        return;
      }

      resolve(response || { ok: false, error: 'Сервер вернул пустой ответ.' });
    };

    if (payload === undefined) {
      socket.timeout(timeoutMs).emit(event, done);
      return;
    }

    socket.timeout(timeoutMs).emit(event, payload, done);
  });
}
