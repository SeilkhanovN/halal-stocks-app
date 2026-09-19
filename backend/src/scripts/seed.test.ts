import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSeedInputs, exitCodeFor, parseArgs } from "./seed.js";
import type { SeedSummary } from "../lib/seed-runner.js";
import * as dataSourceModule from "../sources/data-source.js";
import * as constituentsModule from "../sources/constituents.js";

// CLI-layer tests only: flag parsing, exit-code mapping, and the
// missing-env-var path. Never imports/exercises main() itself (importing
// seed.ts is safe — main() only runs when the file is the actual CLI entry
// point, guarded by the import.meta.url check at the bottom of seed.ts), so
// no test here opens a real DB, hits the network, or reads the real .env.

describe("parseArgs", () => {
  it("defaults: no flags", () => {
    expect(parseArgs([])).toEqual({ ok: true, fixtures: false, force: false, rescreen: false, limit: null });
  });

  it("--fixtures", () => {
    expect(parseArgs(["--fixtures"])).toEqual({
      ok: true,
      fixtures: true,
      force: false,
      rescreen: false,
      limit: null,
    });
  });

  it("--force", () => {
    expect(parseArgs(["--force"])).toEqual({
      ok: true,
      fixtures: false,
      force: true,
      rescreen: false,
      limit: null,
    });
  });

  it("--rescreen", () => {
    expect(parseArgs(["--rescreen"])).toEqual({
      ok: true,
      fixtures: false,
      force: false,
      rescreen: true,
      limit: null,
    });
  });

  it("--limit 10 (space-separated)", () => {
    expect(parseArgs(["--limit", "10"])).toEqual({
      ok: true,
      fixtures: false,
      force: false,
      rescreen: false,
      limit: 10,
    });
  });

  it("--limit=10 (equals form)", () => {
    expect(parseArgs(["--limit=10"])).toEqual({
      ok: true,
      fixtures: false,
      force: false,
      rescreen: false,
      limit: 10,
    });
  });

  it("combinations: --fixtures --force --limit=5", () => {
    expect(parseArgs(["--fixtures", "--force", "--limit=5"])).toEqual({
      ok: true,
      fixtures: true,
      force: true,
      rescreen: false,
      limit: 5,
    });
  });

  it("combinations: --rescreen --limit 3", () => {
    expect(parseArgs(["--rescreen", "--limit", "3"])).toEqual({
      ok: true,
      fixtures: false,
      force: false,
      rescreen: true,
      limit: 3,
    });
  });

  it.each([
    ["0", "0"],
    ["-1", "-1"],
    ["1.5", "1.5"],
    ["abc", "abc"],
  ])("--limit=%s is rejected as a usage error", (raw) => {
    const result = parseArgs([`--limit=${raw}`]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("--limit must be a positive integer");
      expect(result.error).toContain(`'${raw}'`);
    }
  });

  it("--limit with a missing value is rejected as a usage error", () => {
    const result = parseArgs(["--limit"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("--limit must be a positive integer");
    }
  });

  it("unknown flag --nope is a fatal usage error", () => {
    const result = parseArgs(["--nope"]);
    expect(result).toEqual({ ok: false, error: "Unknown flag: --nope" });
  });

  it("bare positional argument is a fatal usage error", () => {
    const result = parseArgs(["foo"]);
    expect(result).toEqual({ ok: false, error: "Unexpected argument: foo" });
  });
});

describe("exitCodeFor", () => {
  function baseSummary(overrides: Partial<SeedSummary> = {}): SeedSummary {
    return {
      mode: "seed",
      totalConsidered: 0,
      processed: 0,
      skipped: 0,
      failures: 0,
      interrupted: false,
      statusCounts: { halal: 0, not_halal: 0, unknown: 0 },
      failedTickers: [],
      distinctIndustries: [],
      unmatchedDenylistEntries: [],
      ...overrides,
    };
  }

  it("0 on a clean run", () => {
    expect(exitCodeFor(baseSummary())).toBe(0);
  });

  it("1 when failures > 0", () => {
    expect(exitCodeFor(baseSummary({ failures: 2 }))).toBe(1);
  });

  it("130 when interrupted, even if failures > 0 (130 wins)", () => {
    expect(exitCodeFor(baseSummary({ interrupted: true, failures: 3 }))).toBe(130);
  });

  it("130 when interrupted with zero failures", () => {
    expect(exitCodeFor(baseSummary({ interrupted: true }))).toBe(130);
  });
});

describe("buildSeedInputs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("--fixtures builds the fixture data source and the 6 fixture tickers, without touching env or fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { dataSource, tickers } = buildSeedInputs({ fixtures: true }, {});

    expect(tickers).toEqual(["AAPL", "ASML", "JPM", "NO_INTEREST", "STZ", "T"]);
    await dataSource.getProfile("AAPL");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("live mode throws before any fetch when FINNHUB_API_KEY is missing", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    expect(() => buildSeedInputs({ fixtures: false }, {})).toThrow(/FINNHUB_API_KEY/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("live mode throws before any fetch when SEC_USER_AGENT is missing", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    expect(() => buildSeedInputs({ fixtures: false }, { FINNHUB_API_KEY: "x" })).toThrow(/SEC_USER_AGENT/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // Regression guard for the spec's explicit ordering requirement: live mode
  // must construct the DataSource (so a missing-env-var throw happens first)
  // BEFORE loadConstituents() runs. Both missing-env-var tests above prove a
  // throw happens and fetch is never called, but loadConstituents() doesn't
  // itself throw, so a reordering regression (loadConstituents() moved ahead
  // of createLiveDataSource()) would slip past them silently. This spies on
  // both named exports (via their module namespace objects — no change to
  // seed.ts's structure or to constituents.ts) to record call order directly,
  // while still delegating to the real implementations so the test exercises
  // real behavior rather than a stub.
  it("constructs the live DataSource before loading constituents (missing-env-var-first ordering)", () => {
    const order: string[] = [];
    const realCreateLiveDataSource = dataSourceModule.createLiveDataSource;
    const realLoadConstituents = constituentsModule.loadConstituents;

    vi.spyOn(dataSourceModule, "createLiveDataSource").mockImplementation((...args) => {
      order.push("createLiveDataSource");
      return realCreateLiveDataSource(...args);
    });
    vi.spyOn(constituentsModule, "loadConstituents").mockImplementation((...args) => {
      order.push("loadConstituents");
      return realLoadConstituents(...args);
    });

    buildSeedInputs({ fixtures: false }, { FINNHUB_API_KEY: "x", SEC_USER_AGENT: "y" });

    expect(order).toEqual(["createLiveDataSource", "loadConstituents"]);
  });
});
