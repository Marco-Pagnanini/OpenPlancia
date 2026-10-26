import type { PtyProcess, SpawnFn, SpawnOptions } from '../src/main/pty/PtyService';

export class FakePty implements PtyProcess {
  static nextPid = 1000;
  readonly pid = FakePty.nextPid++;
  readonly written: string[] = [];
  readonly resizes: [number, number][] = [];
  readonly kills: (string | undefined)[] = [];
  /** When false, kill() does not make the process exit (simulates a stuck process). */
  exitsOnKill = true;
  private dataListeners: ((d: string) => void)[] = [];
  private exitListeners: ((e: { exitCode: number; signal?: number }) => void)[] = [];

  constructor(readonly options: SpawnOptions) {}

  onData(listener: (d: string) => void) {
    this.dataListeners.push(listener);
    return { dispose: () => undefined };
  }
  onExit(listener: (e: { exitCode: number; signal?: number }) => void) {
    this.exitListeners.push(listener);
    return { dispose: () => undefined };
  }
  write(data: string) {
    this.written.push(data);
  }
  resize(cols: number, rows: number) {
    this.resizes.push([cols, rows]);
  }
  kill(signal?: string) {
    this.kills.push(signal);
    if (this.exitsOnKill || signal === 'SIGKILL') this.exit(signal === 'SIGKILL' ? 137 : 129);
  }
  emit(data: string) {
    for (const l of this.dataListeners) l(data);
  }
  exit(exitCode = 0) {
    const listeners = this.exitListeners;
    this.exitListeners = [];
    for (const l of listeners) l({ exitCode });
  }
}

export function fakeSpawner() {
  const spawned: FakePty[] = [];
  const spawn: SpawnFn = (options) => {
    const pty = new FakePty(options);
    spawned.push(pty);
    return pty;
  };
  return { spawn, spawned };
}
