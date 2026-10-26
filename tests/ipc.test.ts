import { describe, expect, it } from 'vitest';
import { IpcChannels } from '@shared/ipc';

describe('IpcChannels', () => {
  const channels = Object.values(IpcChannels);

  it('uses unique channel names', () => {
    expect(new Set(channels).size).toBe(channels.length);
  });

  it('prefixes every channel with plancia:', () => {
    for (const channel of channels) expect(channel).toMatch(/^plancia:[a-z][a-zA-Z:.-]*$/);
  });
});
