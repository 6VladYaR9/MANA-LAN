import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSocket = vi.hoisted(() => ({
  timeout: vi.fn()
}));

vi.mock('./socket', () => ({ socket: mockSocket }));

import { emitWithAck, isAdminAuthError } from './socketAck';

describe('emitWithAck', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits an event without payload', async () => {
    const emit = vi.fn((event: string, done: (error: Error | null, response?: unknown) => void) => {
      done(null, { ok: true, value: 7 });
    });
    mockSocket.timeout.mockReturnValue({ emit });

    await expect(emitWithAck('health')).resolves.toEqual({ ok: true, value: 7 });
    expect(mockSocket.timeout).toHaveBeenCalledWith(8000);
    expect(emit).toHaveBeenCalledWith('health', expect.any(Function));
  });

  it('emits an event with payload', async () => {
    const payload = { roomId: 'room-1' };
    const emit = vi.fn((event: string, sentPayload: unknown, done: (error: Error | null, response?: unknown) => void) => {
      done(null, { ok: true, roomId: (sentPayload as typeof payload).roomId });
    });
    mockSocket.timeout.mockReturnValue({ emit });

    await expect(emitWithAck('room:get', payload, 2500)).resolves.toEqual({ ok: true, roomId: 'room-1' });
    expect(mockSocket.timeout).toHaveBeenCalledWith(2500);
    expect(emit).toHaveBeenCalledWith('room:get', payload, expect.any(Function));
  });

  it('normalizes timeout and empty responses', async () => {
    const timeoutEmit = vi.fn((event: string, done: (error: Error | null) => void) => {
      done(new Error('timeout'));
    });
    mockSocket.timeout.mockReturnValueOnce({ emit: timeoutEmit });

    await expect(emitWithAck('rooms:get')).resolves.toEqual({
      ok: false,
      error: 'Сервер не ответил. Проверь соединение и попробуй еще раз.'
    });

    const emptyEmit = vi.fn((event: string, done: (error: Error | null, response?: unknown) => void) => {
      done(null);
    });
    mockSocket.timeout.mockReturnValueOnce({ emit: emptyEmit });

    await expect(emitWithAck('rooms:get')).resolves.toEqual({
      ok: false,
      error: 'Сервер вернул пустой ответ.'
    });
  });
});

describe('isAdminAuthError', () => {
  it('recognizes admin authorization failures', () => {
    expect(isAdminAuthError('Доступно только админу')).toBe(true);
    expect(isAdminAuthError('forbidden')).toBe(true);
    expect(isAdminAuthError('room not found')).toBe(false);
  });
});
