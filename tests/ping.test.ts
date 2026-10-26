import { describe, expect, it } from 'vitest';
import { handlePing } from '../src/main/ipc/ping';
import { pingResponseSchema } from '@shared/schemas';

describe('handlePing', () => {
  it('answers pong with the current time', () => {
    const fixed = new Date('2026-01-02T03:04:05.000Z');
    expect(handlePing(() => fixed)).toEqual({ message: 'pong', at: '2026-01-02T03:04:05.000Z' });
  });

  it('produces a payload that matches the shared schema', () => {
    expect(pingResponseSchema.safeParse(handlePing()).success).toBe(true);
  });
});
