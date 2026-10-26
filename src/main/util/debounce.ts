export interface DebouncedTask {
  /** (Re)starts the delay; the task runs once the calls stop for `delayMs`. */
  schedule(): void;
  /** Runs a scheduled task now and waits for any run in progress. */
  flush(): Promise<void>;
  cancel(): void;
  readonly pending: boolean;
}

/** Debounces an async task; runs never overlap. */
export function createDebouncedTask(
  task: () => Promise<void>,
  delayMs: number,
  onError: (err: unknown) => void = (err) => console.error(err),
): DebouncedTask {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let chain: Promise<void> = Promise.resolve();

  const run = (): Promise<void> => {
    timer = undefined;
    chain = chain.then(task).catch(onError);
    return chain;
  };

  return {
    schedule() {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => void run(), delayMs);
    },
    flush() {
      if (timer === undefined) return chain;
      clearTimeout(timer);
      return run();
    },
    cancel() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
    get pending() {
      return timer !== undefined;
    },
  };
}
