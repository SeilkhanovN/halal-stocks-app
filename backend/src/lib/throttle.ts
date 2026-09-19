// Sliding-window rate limiter shared by the outbound data clients
// (finnhub-client.ts: 55 req / 60s to stay under Finnhub's free-tier cap;
// edgar-client.ts: 8 req / 1s to respect SEC EDGAR's documented fair-use
// guidance). Uses Date.now()/setTimeout only (no other timer APIs), so tests
// can drive it deterministically with vi.useFakeTimers(), which mocks Date.
export interface ThrottleOptions {
  limit: number;
  intervalMs: number;
}

export interface Throttle {
  schedule<T>(fn: () => Promise<T>): Promise<T>;
}

interface QueueItem {
  run: () => void;
}

// Drops timestamps older than the sliding window from the front of the
// (time-ordered) array.
function pruneTimestamps(timestamps: number[], intervalMs: number, now: number): void {
  while (timestamps.length > 0 && timestamps[0] !== undefined && now - timestamps[0] >= intervalMs) {
    timestamps.shift();
  }
}

export function createThrottle(options: ThrottleOptions): Throttle {
  const { limit, intervalMs } = options;
  const timestamps: number[] = [];
  const queue: QueueItem[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  // Drains as much of the queue as the current window allows, then — if
  // anything is left — schedules exactly ONE setTimeout to retry once the
  // oldest timestamp ages out. Never recurses/loops on its own; the single
  // `timer` handle guards against ever having more than one pending timer.
  function pump(): void {
    const now = Date.now();
    pruneTimestamps(timestamps, intervalMs, now);

    while (timestamps.length < limit && queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      timestamps.push(Date.now());
      item.run();
    }

    if (queue.length > 0 && timer === null) {
      const oldest = timestamps[0];
      const delay = oldest === undefined ? 0 : Math.max(0, oldest + intervalMs - Date.now());
      timer = setTimeout(() => {
        timer = null;
        pump();
      }, delay);
    }
  }

  return {
    schedule<T>(fn: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        queue.push({
          run: () => {
            fn().then(resolve, reject);
          },
        });
        if (timer === null) {
          pump();
        }
      });
    },
  };
}
