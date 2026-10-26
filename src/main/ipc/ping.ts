import type { PingResponse } from '@shared/ipc';

export function handlePing(now: () => Date = () => new Date()): PingResponse {
  return { message: 'pong', at: now().toISOString() };
}
