import { io, type Socket } from 'socket.io-client';
import type { Ack } from '../../../shared/types';

export const socket: Socket = io({
  autoConnect: false,
  transports: ['websocket', 'polling'],
});

export function request(event: string, data?: unknown, onOk?: (ack: Ack) => void): Promise<Ack> {
  return new Promise((resolve) => {
    socket.timeout(8000).emit(event, data ?? {}, (error: Error | null, ack?: Ack) => {
      const result: Ack = error || !ack ? { ok: false, error: 'No response from the server.' } : ack;
      if (result.ok) onOk?.(result);
      resolve(result);
    });
  });
}
