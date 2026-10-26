import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ActivityEvent } from '@shared/activity';
import { ActivityLog } from '../src/main/activity/ActivityLog';

let dir: string;
let logs: ActivityLog[] = [];
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'plancia-act-'));
  logs = [];
});
afterEach(async () => {
  await Promise.all(logs.map((l) => l.flush()));
  await rm(dir, { recursive: true, force: true });
});

function makeLog(limit?: number) {
  const events: ActivityEvent[] = [];
  let n = 0;
  let t = 0;
  const log = new ActivityLog({
    dir: () => dir,
    onEvent: (e) => events.push(e),
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, t++)),
    newId: () => `a${++n}`,
    ...(limit ? { limit } : {}),
  });
  logs.push(log);
  return { log, events };
}

describe('ActivityLog', () => {
  it('appends, broadcasts and updates tool entries by tool_use_id', async () => {
    const { log, events } = makeLog();
    log.append('t1', { kind: 'prompt', title: 'Prompt inviato' });
    log.append('t1', {
      kind: 'tool',
      title: 'Bash: ls',
      tool: { name: 'Bash', useId: 'u1', state: 'running' },
    });
    expect(log.updateTool('t1', 'u1', { state: 'ok' })?.tool?.state).toBe('ok');
    expect(log.updateTool('t1', 'missing', { state: 'ok' })).toBeNull();
    expect(events.map((e) => e.id)).toEqual(['a1', 'a2', 'a2']);
    expect((await log.list('t1')).map((e) => [e.title, e.tool?.state])).toEqual([
      ['Prompt inviato', undefined],
      ['Bash: ls', 'ok'],
    ]);
  });

  it('cancels tool calls that never finished', async () => {
    const { log } = makeLog();
    log.append('t1', {
      kind: 'tool',
      title: 'A',
      tool: { name: 'Bash', useId: 'u1', state: 'running' },
    });
    log.append('t1', {
      kind: 'tool',
      title: 'B',
      tool: { name: 'Bash', useId: 'u2', state: 'ok' },
    });
    log.settleRunning('t1');
    expect((await log.list('t1')).map((e) => e.tool?.state)).toEqual(['cancelled', 'ok']);
  });

  it('keeps only the newest entries', async () => {
    const { log } = makeLog(2);
    for (const title of ['a', 'b', 'c']) log.append('t1', { kind: 'session', title });
    expect((await log.list('t1')).map((e) => e.title)).toEqual(['b', 'c']);
  });

  it('reloads from disk, the last version of each entry winning', async () => {
    const first = makeLog();
    first.log.append('t1', {
      kind: 'tool',
      title: 'Edit: a.ts',
      tool: { name: 'Edit', useId: 'u', state: 'running' },
    });
    first.log.updateTool('t1', 'u', { state: 'failed' });
    first.log.append('t1', { kind: 'response', title: 'Risposta completata' });
    await first.log.flush();
    const lines = (await readFile(join(dir, 't1.jsonl'), 'utf8')).trim().split('\n');
    expect(lines.map((l) => JSON.parse(l).tool?.state)).toEqual(['running', 'failed', undefined]);
    const second = makeLog();
    expect((await second.log.list('t1')).map((e) => [e.title, e.tool?.state])).toEqual([
      ['Edit: a.ts', 'failed'],
      ['Risposta completata', undefined],
    ]);
  });

  it('removes a terminal log', async () => {
    const { log } = makeLog();
    log.append('t1', { kind: 'session', title: 'x' });
    await log.flush();
    await log.remove('t1');
    await expect(readFile(join(dir, 't1.jsonl'), 'utf8')).rejects.toThrow();
    expect(await makeLog().log.list('t1')).toEqual([]);
  });
});
