import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createThrottle } from "./throttle.js";

describe("createThrottle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("caps concurrent runs at `limit` per `intervalMs` sliding window", async () => {
    const throttle = createThrottle({ limit: 2, intervalMs: 1000 });
    const runTimes: number[] = [];

    const tasks = Array.from({ length: 5 }, () =>
      throttle.schedule(async () => {
        runTimes.push(Date.now());
        return runTimes.length;
      }),
    );

    // Nothing async has happened yet from the caller's perspective, but the
    // first `limit` tasks run synchronously inside schedule()'s pump() call.
    expect(runTimes).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(1000);
    expect(runTimes).toHaveLength(4);

    await vi.advanceTimersByTimeAsync(1000);
    expect(runTimes).toHaveLength(5);

    await Promise.all(tasks);
  });

  it("introduces no delay when under the limit", () => {
    const throttle = createThrottle({ limit: 5, intervalMs: 1000 });
    const runTimes: number[] = [];

    for (let i = 0; i < 3; i++) {
      void throttle.schedule(async () => {
        runTimes.push(Date.now());
      });
    }

    expect(runTimes).toHaveLength(3);
  });

  it("resolves schedule() with the wrapped function's return value", async () => {
    const throttle = createThrottle({ limit: 1, intervalMs: 1000 });
    const result = await throttle.schedule(async () => 42);
    expect(result).toBe(42);
  });

  it("rejects schedule() when the wrapped function rejects", async () => {
    const throttle = createThrottle({ limit: 1, intervalMs: 1000 });
    await expect(
      throttle.schedule(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });

  it("keeps draining the queue across multiple windows in FIFO order", async () => {
    const throttle = createThrottle({ limit: 1, intervalMs: 1000 });
    const order: number[] = [];

    const p1 = throttle.schedule(async () => {
      order.push(1);
    });
    const p2 = throttle.schedule(async () => {
      order.push(2);
    });
    const p3 = throttle.schedule(async () => {
      order.push(3);
    });

    expect(order).toEqual([1]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(order).toEqual([1, 2]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(order).toEqual([1, 2, 3]);

    await Promise.all([p1, p2, p3]);
  });
});
