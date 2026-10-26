import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PtyService } from '../src/main/pty/PtyService';
import { fakeSpawner } from './fakePty';

const OPTS = { file: '/bin/zsh', args: ['-l'], cwd: '/tmp', env: {}, cols: 80, rows: 24 };

function setup(bufferLimit?: number) {
  const { spawn, spawned } = fakeSpawner();
  const data: [string, string, number][] = [];
  const exits: [string, number][] = [];
  const service = new PtyService({
    spawn,
    onData: (id, d, start) => data.push([id, d, start]),
    onExit: (id, code) => exits.push([id, code]),
    flushDelayMs: 5,
    ...(bufferLimit ? { bufferLimit } : {}),
  });
  return { service, spawned, data, exits };
}

describe('PtyService', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('coalesces output and reports absolute offsets', async () => {
    const { service, spawned, data } = setup();
    service.start('t1', OPTS);
    spawned[0]!.emit('hel');
    spawned[0]!.emit('lo');
    await vi.advanceTimersByTimeAsync(10);
    spawned[0]!.emit(' world');
    await vi.advanceTimersByTimeAsync(10);
    expect(data).toEqual([
      ['t1', 'hello', 0],
      ['t1', ' world', 5],
    ]);
    expect(service.snapshot('t1')).toEqual({ data: 'hello world', end: 11 });
  });

  it('keeps only the tail in the replay buffer but offsets stay absolute', () => {
    const { service, spawned } = setup(4);
    service.start('t1', OPTS);
    spawned[0]!.emit('abcdefgh');
    expect(service.snapshot('t1')).toEqual({ data: 'efgh', end: 8 });
  });

  it('forwards writes and resizes to the running process', () => {
    const { service, spawned } = setup();
    service.start('t1', OPTS);
    service.write('t1', 'ls\r');
    service.resize('t1', 120, 40);
    service.write('nope', 'x');
    expect(spawned[0]!.written).toEqual(['ls\r']);
    expect(spawned[0]!.resizes).toEqual([[120, 40]]);
  });

  it('refuses to start twice, allows restart after exit and keeps history', async () => {
    const { service, spawned, exits, data } = setup();
    service.start('t1', OPTS);
    expect(() => service.start('t1', OPTS)).toThrow();
    spawned[0]!.emit('first\n');
    spawned[0]!.exit(1);
    expect(exits).toEqual([['t1', 1]]);
    expect(service.isRunning('t1')).toBe(false);

    service.start('t1', OPTS);
    spawned[1]!.emit('second');
    await vi.advanceTimersByTimeAsync(10);
    expect(data.at(-1)).toEqual(['t1', 'second', 6]);
    expect(service.snapshot('t1')?.data).toBe('first\nsecond');
  });

  it('ignores the exit of a process that was already replaced', () => {
    const { service, spawned, exits } = setup();
    service.start('t1', OPTS);
    const old = spawned[0]!;
    old.exitsOnKill = false;
    // Simulate: old exits late, after a new process took over the id.
    old.exit(0);
    service.start('t1', OPTS);
    exits.length = 0;
    old.exit(0);
    expect(exits).toEqual([]);
    expect(service.isRunning('t1')).toBe(true);
  });

  it('stop sends SIGHUP, then SIGKILL if the process lingers', async () => {
    const { service, spawned } = setup();
    service.start('t1', OPTS);
    spawned[0]!.exitsOnKill = false;
    const stopping = service.stop('t1');
    await vi.advanceTimersByTimeAsync(2000);
    await stopping;
    expect(spawned[0]!.kills).toEqual([undefined, 'SIGKILL']);
    expect(service.isRunning('t1')).toBe(false);
  });

  it('dispose forgets the history; disposeAll stops everything', async () => {
    const { service, spawned } = setup();
    service.start('a', OPTS);
    service.start('b', OPTS);
    spawned[0]!.emit('x');
    await service.dispose('a');
    expect(service.snapshot('a')).toBeNull();
    await service.disposeAll();
    expect(service.runningIds()).toEqual([]);
    expect(spawned[1]!.kills).toEqual([undefined]);
  });
});
