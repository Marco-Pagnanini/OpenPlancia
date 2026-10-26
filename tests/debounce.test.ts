import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDebouncedTask } from '../src/main/util/debounce';

describe('createDebouncedTask', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs once after calls stop for the delay', async () => {
    const task = vi.fn(() => Promise.resolve());
    const d = createDebouncedTask(task, 500);
    d.schedule();
    await vi.advanceTimersByTimeAsync(300);
    d.schedule();
    await vi.advanceTimersByTimeAsync(300);
    expect(task).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(task).toHaveBeenCalledTimes(1);
    expect(d.pending).toBe(false);
  });

  it('flush runs a pending task immediately', async () => {
    const task = vi.fn(() => Promise.resolve());
    const d = createDebouncedTask(task, 500);
    d.schedule();
    expect(d.pending).toBe(true);
    await d.flush();
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('flush without pending work does not run the task', async () => {
    const task = vi.fn(() => Promise.resolve());
    await createDebouncedTask(task, 500).flush();
    expect(task).not.toHaveBeenCalled();
  });

  it('never overlaps runs and keeps going after an error', async () => {
    let active = 0;
    let maxActive = 0;
    let calls = 0;
    const onError = vi.fn();
    const task = async () => {
      calls++;
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 100));
      active--;
      if (calls === 1) throw new Error('boom');
    };
    const d = createDebouncedTask(task, 10, onError);
    d.schedule();
    await vi.advanceTimersByTimeAsync(20);
    d.schedule();
    await vi.advanceTimersByTimeAsync(500);
    expect(calls).toBe(2);
    expect(maxActive).toBe(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
