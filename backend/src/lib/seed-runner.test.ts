import { afterEach, describe, expect, it, vi } from "vitest";
import { closeDatabase, openDatabase } from "../db/connection.js";
import { createStocksRepo } from "../db/stocks-repo.js";
import { createFixtureDataSource } from "../sources/fixture-source.js";
import { DataSourceError, type DataSource } from "../sources/data-source.js";
import { DEFAULT_SCREENING_CONFIG } from "../config/screening.js";
import type { ScreeningInput } from "../types/halal.js";
import { screen } from "./halal-screen.js";
import { defaultFixtureDirs, resolveFixtureTickers, runSeed } from "./seed-runner.js";

// All tests below run against an in-memory DB (":memory:") and either the
// checked-in fixture DataSource or a hand-written fake — no network, no
// real .env, no real backend/data/halal-stocks.db.

const NO_LOG = (): void => {};

describe("resolveFixtureTickers / defaultFixtureDirs", () => {
  it("returns exactly the 6 fixture tickers, excluding the SEC ticker-map snapshot", () => {
    const { finnhubDir, edgarDir } = defaultFixtureDirs();
    expect(resolveFixtureTickers(finnhubDir, edgarDir)).toEqual([
      "AAPL",
      "ASML",
      "JPM",
      "NO_INTEREST",
      "STZ",
      "T",
    ]);
  });

  it("returns an empty list for a missing directory instead of throwing", () => {
    expect(resolveFixtureTickers("/does/not/exist/finnhub", "/does/not/exist/edgar")).toEqual([]);
  });
});

describe("runSeed (mode: seed) — fixtures", () => {
  it("criterion 1: screens all 6 fixture tickers to their expected status with zero failures", async () => {
    const db = openDatabase(":memory:");
    try {
      const repo = createStocksRepo(db);
      const { finnhubDir, edgarDir } = defaultFixtureDirs();
      const tickers = resolveFixtureTickers(finnhubDir, edgarDir);

      const summary = await runSeed({
        mode: "seed",
        db,
        tickers,
        dataSource: createFixtureDataSource(),
        force: false,
        log: NO_LOG,
      });

      expect(repo.getByTicker("AAPL")?.halalStatus).toBe("halal");
      expect(repo.getByTicker("JPM")?.halalStatus).toBe("not_halal");
      expect(repo.getByTicker("T")?.halalStatus).toBe("not_halal");
      expect(repo.getByTicker("STZ")?.halalStatus).toBe("not_halal");
      expect(repo.getByTicker("ASML")?.halalStatus).toBe("unknown");
      expect(repo.getByTicker("NO_INTEREST")?.halalStatus).toBe("unknown");

      expect(summary.statusCounts).toEqual({ halal: 1, not_halal: 3, unknown: 2 });
      expect(summary.failures).toBe(0);
      expect(summary.processed).toBe(6);
    } finally {
      closeDatabase(db);
    }
  });

  it("criterion 2: the 7-day skip window, then --force overrides it", async () => {
    const db = openDatabase(":memory:");
    try {
      const repo = createStocksRepo(db);
      const { finnhubDir, edgarDir } = defaultFixtureDirs();
      const tickers = resolveFixtureTickers(finnhubDir, edgarDir);
      const dataSource = createFixtureDataSource();

      let clockMs = Date.parse("2024-01-01T00:00:00.000Z");
      const now = (): Date => new Date(clockMs);

      const run1 = await runSeed({ mode: "seed", db, tickers, dataSource, force: false, now, log: NO_LOG });
      expect(run1.processed).toBe(6);
      const screenedAtAfterRun1 = new Map(tickers.map((ticker) => [ticker, repo.getByTicker(ticker)?.screenedAt]));

      const run2 = await runSeed({ mode: "seed", db, tickers, dataSource, force: false, now, log: NO_LOG });
      expect(run2.skipped).toBe(6);
      expect(run2.processed).toBe(0);
      for (const ticker of tickers) {
        expect(repo.getByTicker(ticker)?.screenedAt).toBe(screenedAtAfterRun1.get(ticker));
      }

      clockMs += 1000;
      const run3 = await runSeed({ mode: "seed", db, tickers, dataSource, force: true, now, log: NO_LOG });
      expect(run3.processed).toBe(6);
      for (const ticker of tickers) {
        const before = screenedAtAfterRun1.get(ticker);
        const after = repo.getByTicker(ticker)?.screenedAt;
        expect(after).not.toBe(before);
        expect(Date.parse(after ?? "")).toBeGreaterThan(Date.parse(before ?? ""));
      }
    } finally {
      closeDatabase(db);
    }
  });

  it("criterion 3: a per-ticker data-source failure stores unknown+fetchError for that ticker only", async () => {
    const db = openDatabase(":memory:");
    try {
      const repo = createStocksRepo(db);
      const { finnhubDir, edgarDir } = defaultFixtureDirs();
      const tickers = resolveFixtureTickers(finnhubDir, edgarDir);
      const fixtureSource = createFixtureDataSource();

      const dataSource: DataSource = {
        getProfile: (ticker: string) => {
          if (ticker === "JPM") {
            return Promise.reject(new DataSourceError("finnhub", "JPM", "simulated failure"));
          }
          return fixtureSource.getProfile(ticker);
        },
        getCompanyFacts: (ticker: string) => fixtureSource.getCompanyFacts(ticker),
      };

      const summary = await runSeed({ mode: "seed", db, tickers, dataSource, force: false, log: NO_LOG });

      expect(summary.failures).toBe(1);
      expect(summary.failedTickers).toEqual([{ ticker: "JPM", detail: "finnhub: simulated failure" }]);

      const jpm = repo.getByTicker("JPM");
      // The profile fetch failed, so industry is null this run and the
      // business-activity denylist can't fire (businessActivity.prohibited
      // is null, not true) — but JPM's real EDGAR fixture facts (unaffected
      // by the Finnhub failure) still breach the interestIncomeToRevenue
      // ratio (80B/170B ~= 47% vs. the 5% threshold) independently of
      // marketCap, which forces "not_halal" on its own. Either way the
      // invariant this criterion protects holds: a failed fetch never
      // stores "halal".
      expect(jpm?.screening?.businessActivity.prohibited).toBeNull();
      expect(jpm?.halalStatus).toBe("not_halal");
      expect(jpm?.halalStatus).not.toBe("halal");
      expect(jpm?.fetchError).toBe("finnhub: simulated failure");

      expect(repo.getByTicker("AAPL")?.halalStatus).toBe("halal");
    } finally {
      closeDatabase(db);
    }
  });

  it("criterion 7: a ticker that WOULD screen halal but whose fetches both throw is stored unknown, never halal", async () => {
    const db = openDatabase(":memory:");
    try {
      const repo = createStocksRepo(db);
      const dataSource: DataSource = {
        getProfile: () => Promise.reject(new Error("boom-profile")),
        getCompanyFacts: () => Promise.reject(new Error("boom-facts")),
      };

      const summary = await runSeed({ mode: "seed", db, tickers: ["AAPL"], dataSource, log: NO_LOG });

      expect(summary.failures).toBe(1);
      const record = repo.getByTicker("AAPL");
      expect(record?.halalStatus).toBe("unknown");
      expect(record?.dataIssues.length).toBeGreaterThan(0);
      expect(record?.fetchError).toBe("finnhub: boom-profile; edgar: boom-facts");
    } finally {
      closeDatabase(db);
    }
  });

  it("--limit scopes totalConsidered and only touches the first N tickers", async () => {
    const db = openDatabase(":memory:");
    try {
      const repo = createStocksRepo(db);
      const { finnhubDir, edgarDir } = defaultFixtureDirs();
      const tickers = resolveFixtureTickers(finnhubDir, edgarDir);
      const dataSource = createFixtureDataSource();

      const summary = await runSeed({ mode: "seed", db, tickers, dataSource, limit: 2, log: NO_LOG });

      expect(summary.totalConsidered).toBe(2);
      expect(summary.processed).toBe(2);
      for (const ticker of tickers.slice(0, 2)) {
        expect(repo.getByTicker(ticker)).toBeDefined();
      }
      for (const ticker of tickers.slice(2)) {
        expect(repo.getByTicker(ticker)).toBeUndefined();
      }
    } finally {
      closeDatabase(db);
    }
  });

  it("shouldStop interrupts after exactly one ticker; a later run resumes the rest", async () => {
    const db = openDatabase(":memory:");
    try {
      const repo = createStocksRepo(db);
      const { finnhubDir, edgarDir } = defaultFixtureDirs();
      const tickers = resolveFixtureTickers(finnhubDir, edgarDir);
      const dataSource = createFixtureDataSource();

      let calls = 0;
      const shouldStop = (): boolean => {
        calls += 1;
        return calls > 1;
      };

      const summary1 = await runSeed({ mode: "seed", db, tickers, dataSource, shouldStop, log: NO_LOG });
      expect(summary1.interrupted).toBe(true);
      expect(summary1.processed).toBe(1);

      const summary2 = await runSeed({
        mode: "seed",
        db,
        tickers,
        dataSource,
        shouldStop: () => false,
        log: NO_LOG,
      });
      expect(summary2.interrupted).toBe(false);
      for (const ticker of tickers) {
        expect(repo.getByTicker(ticker)).toBeDefined();
      }
    } finally {
      closeDatabase(db);
    }
  });

  it("collects distinct industries and flags denylist entries matched by zero companies this run", async () => {
    const db = openDatabase(":memory:");
    try {
      const { finnhubDir, edgarDir } = defaultFixtureDirs();
      const tickers = resolveFixtureTickers(finnhubDir, edgarDir);
      const dataSource = createFixtureDataSource();

      const summary = await runSeed({ mode: "seed", db, tickers, dataSource, log: NO_LOG });

      expect(summary.distinctIndustries).toEqual(
        expect.arrayContaining([
          "Banking",
          "Beverages",
          "Semiconductors",
          "Technology",
          "Telecommunication Services",
        ]),
      );
      expect(summary.unmatchedDenylistEntries).toEqual(
        expect.arrayContaining(["Insurance", "Tobacco", "Casinos & Gaming"]),
      );
      expect(summary.unmatchedDenylistEntries).not.toContain("Banking");
    } finally {
      closeDatabase(db);
    }
  });
});

describe("runSeed (mode: rescreen)", () => {
  // Guards against a leaked `vi.spyOn(globalThis, "fetch")` (see criterion 4
  // below) bleeding into later tests in this file if an assertion above its
  // manual `mockRestore()` call were to throw. Matches the
  // `afterEach(() => vi.restoreAllMocks())` pattern already used in
  // scripts/seed.test.ts.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("criterion 4: recomputes from stored inputs only, never calls fetch", async () => {
    const db = openDatabase(":memory:");
    try {
      const repo = createStocksRepo(db);

      const screeningInput: ScreeningInput = {
        ticker: "XYZ",
        industry: "Technology",
        marketCap: 1000,
        totalDebt: 320, // 0.32 -> not_halal under the default 0.30 threshold
        cashAndSecurities: 100,
        interestIncomeTtm: 1,
        revenueTtm: 100,
        dataIssues: [],
      };
      const initialScreening = screen(screeningInput);
      repo.upsert({
        ticker: "XYZ",
        name: "Xyz Corp",
        exchange: "NASDAQ",
        industry: "Technology",
        cik: null,
        marketCap: 1000,
        totalDebt: 320,
        cashAndSecurities: 100,
        interestIncomeTtm: 1,
        revenueTtm: 100,
        dataIssues: [],
        halalStatus: initialScreening.status,
        screening: { ...initialScreening, screenedAt: "2024-01-01T00:00:00.000Z" },
        screenedAt: "2024-01-01T00:00:00.000Z",
        fetchError: null,
      });
      expect(repo.getByTicker("XYZ")?.halalStatus).toBe("not_halal");

      const fetchSpy = vi.spyOn(globalThis, "fetch");

      const summary = await runSeed({
        mode: "rescreen",
        db,
        config: {
          ...DEFAULT_SCREENING_CONFIG,
          thresholds: { ...DEFAULT_SCREENING_CONFIG.thresholds, debtToMarketCap: 0.5 },
        },
        log: NO_LOG,
      });

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(summary.processed).toBe(1);
      expect(summary.failures).toBe(0);
      const updated = repo.getByTicker("XYZ");
      expect(updated?.halalStatus).toBe("halal");
      expect(updated?.screenedAt).not.toBe("2024-01-01T00:00:00.000Z");
    } finally {
      closeDatabase(db);
    }
  });

  it("returns an all-zero summary without calling repo.list() when the table is empty", async () => {
    const db = openDatabase(":memory:");
    try {
      const summary = await runSeed({ mode: "rescreen", db, log: NO_LOG });
      expect(summary).toEqual({
        mode: "rescreen",
        totalConsidered: 0,
        processed: 0,
        skipped: 0,
        failures: 0,
        interrupted: false,
        statusCounts: { halal: 0, not_halal: 0, unknown: 0 },
        failedTickers: [],
        distinctIndustries: [],
        unmatchedDenylistEntries: [],
      });
    } finally {
      closeDatabase(db);
    }
  });

  it("preserves fetchError verbatim (rescreen never fetches, so it can't confirm or refute it)", async () => {
    const db = openDatabase(":memory:");
    try {
      const repo = createStocksRepo(db);
      const screeningInput: ScreeningInput = {
        ticker: "ABC",
        industry: "Technology",
        marketCap: 1000,
        totalDebt: 100,
        cashAndSecurities: 100,
        interestIncomeTtm: 1,
        revenueTtm: 100,
        dataIssues: ["Data unavailable: finnhub error"],
      };
      const initialScreening = screen(screeningInput);
      repo.upsert({
        ticker: "ABC",
        name: "Abc Corp",
        exchange: null,
        industry: "Technology",
        cik: null,
        marketCap: 1000,
        totalDebt: 100,
        cashAndSecurities: 100,
        interestIncomeTtm: 1,
        revenueTtm: 100,
        dataIssues: ["Data unavailable: finnhub error"],
        halalStatus: initialScreening.status,
        screening: { ...initialScreening, screenedAt: "2024-01-01T00:00:00.000Z" },
        screenedAt: "2024-01-01T00:00:00.000Z",
        fetchError: "finnhub: request failed after 3 attempts",
      });

      const summary = await runSeed({ mode: "rescreen", db, log: NO_LOG });
      expect(summary.processed).toBe(1);
      expect(repo.getByTicker("ABC")?.fetchError).toBe("finnhub: request failed after 3 attempts");
    } finally {
      closeDatabase(db);
    }
  });
});
