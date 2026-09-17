import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { closeDatabase, openDatabase } from "./connection.js";
import { runMigrations } from "./migrations.js";
import { createStocksRepo, type StocksRepo, type UpsertStockInput } from "./stocks-repo.js";
import { screen } from "../lib/halal-screen.js";
import type { HalalScreening, HalalStatus, ScreeningInput } from "../types/halal.js";

let db: DatabaseSync;
let repo: StocksRepo;

beforeEach(() => {
  db = openDatabase(":memory:");
  repo = createStocksRepo(db);
});

afterEach(() => {
  closeDatabase(db);
});

function makeScreeningInput(overrides: Partial<ScreeningInput> = {}): ScreeningInput {
  return {
    ticker: "AAPL",
    industry: "Technology",
    marketCap: 1000,
    totalDebt: 100,
    cashAndSecurities: 150,
    interestIncomeTtm: 1,
    revenueTtm: 100,
    dataIssues: [],
    ...overrides,
  };
}

// Builds a realistic, screen()-derived UpsertStockInput. Every field can be
// overridden; halalStatus/screening default to a real screen() result for
// the given ticker/industry/ratio inputs rather than a hardcoded status, so
// seeded fixtures stay internally consistent.
function makeStock(overrides: Partial<UpsertStockInput> = {}): UpsertStockInput {
  const ticker = overrides.ticker ?? "AAPL";
  const industry = overrides.industry === undefined ? "Technology" : overrides.industry;
  const marketCap = overrides.marketCap === undefined ? 1000 : overrides.marketCap;
  const totalDebt = overrides.totalDebt === undefined ? 100 : overrides.totalDebt;
  const cashAndSecurities = overrides.cashAndSecurities === undefined ? 150 : overrides.cashAndSecurities;
  const interestIncomeTtm = overrides.interestIncomeTtm === undefined ? 1 : overrides.interestIncomeTtm;
  const revenueTtm = overrides.revenueTtm === undefined ? 100 : overrides.revenueTtm;
  const dataIssues = overrides.dataIssues ?? [];

  const screening: HalalScreening | null =
    overrides.screening !== undefined
      ? overrides.screening
      : screen(
          makeScreeningInput({
            ticker,
            industry,
            marketCap,
            totalDebt,
            cashAndSecurities,
            interestIncomeTtm,
            revenueTtm,
            dataIssues,
          }),
        );
  const halalStatus: HalalStatus = overrides.halalStatus ?? screening?.status ?? "unknown";

  return {
    ticker,
    name: overrides.name ?? "Apple Inc",
    exchange: overrides.exchange === undefined ? "NASDAQ" : overrides.exchange,
    industry,
    cik: overrides.cik === undefined ? "0000320193" : overrides.cik,
    marketCap,
    totalDebt,
    cashAndSecurities,
    interestIncomeTtm,
    revenueTtm,
    dataIssues,
    halalStatus,
    screening,
    screenedAt: overrides.screenedAt === undefined ? "2026-01-01T00:00:00.000Z" : overrides.screenedAt,
    fetchError: overrides.fetchError === undefined ? null : overrides.fetchError,
  };
}

describe("runMigrations", () => {
  it("is a no-op the second time it runs on the same DB", () => {
    const before = db.prepare("PRAGMA user_version").get();
    expect(() => {
      runMigrations(db);
    }).not.toThrow();
    const after = db.prepare("PRAGMA user_version").get();
    expect(after).toEqual(before);
  });
});

describe("openDatabase / closeDatabase with a file-backed DB", () => {
  it("opens, closes, reopens, and closes a file DB without error", () => {
    const dir = mkdtempSync(join(tmpdir(), "halal-stocks-test-"));
    const dbPath = join(dir, "test.db");
    try {
      const first = openDatabase(dbPath);
      closeDatabase(first);

      const second = openDatabase(dbPath);
      closeDatabase(second);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("upsert / getByTicker", () => {
  it("round-trips a stock, including a realistic screen()-built screening object", () => {
    const screening = screen(makeScreeningInput({ ticker: "AAPL", industry: "Technology" }));
    repo.upsert(makeStock({ ticker: "AAPL", screening, halalStatus: screening.status }));

    const result = repo.getByTicker("AAPL");
    expect(result).toBeDefined();
    if (result === undefined) {
      throw new Error("unreachable: asserted defined above");
    }

    const { updatedAt, ...rest } = result;
    expect(rest).toEqual({
      ticker: "AAPL",
      name: "Apple Inc",
      exchange: "NASDAQ",
      industry: "Technology",
      cik: "0000320193",
      marketCap: 1000,
      totalDebt: 100,
      cashAndSecurities: 150,
      interestIncomeTtm: 1,
      revenueTtm: 100,
      dataIssues: [],
      halalStatus: "halal",
      screening,
      screenedAt: "2026-01-01T00:00:00.000Z",
      fetchError: null,
      isFavorite: false,
    });
    expect(Number.isNaN(Date.parse(updatedAt))).toBe(false);
  });

  it("returns undefined for a ticker that was never upserted", () => {
    expect(repo.getByTicker("NOPE")).toBeUndefined();
  });

  it("normalizes the ticker on both upsert and lookup", () => {
    repo.upsert(makeStock({ ticker: "brk-b", name: "Berkshire Hathaway" }));
    expect(repo.getByTicker("BRK.B")?.name).toBe("Berkshire Hathaway");
    expect(repo.getByTicker("brk-b")?.ticker).toBe("BRK.B");
  });

  it("updates an existing row on a second upsert rather than duplicating it", () => {
    repo.upsert(makeStock({ ticker: "AAPL", name: "Apple Inc" }));
    repo.upsert(makeStock({ ticker: "AAPL", name: "Apple Incorporated" }));

    expect(repo.count()).toBe(1);
    expect(repo.getByTicker("AAPL")?.name).toBe("Apple Incorporated");
  });

  it("stores a null screening as SQL NULL and round-trips it as null", () => {
    repo.upsert(makeStock({ ticker: "UNK", screening: null, halalStatus: "unknown" }));
    expect(repo.getByTicker("UNK")?.screening).toBeNull();
  });

  it("clears screening back to null on a later upsert, round-tripping null (not the string 'null')", () => {
    const screening = screen(makeScreeningInput({ ticker: "CLR", industry: "Technology" }));
    repo.upsert(makeStock({ ticker: "CLR", screening, halalStatus: screening.status }));
    expect(repo.getByTicker("CLR")?.screening).toEqual(screening);

    repo.upsert(makeStock({ ticker: "CLR", screening: null, halalStatus: "unknown" }));
    const result = repo.getByTicker("CLR");
    expect(result?.screening).toBeNull();
    expect(result?.screening).not.toBe("null");
  });

  it("round-trips a whole-number REAL market cap (3e12) and zero values as JS numbers", () => {
    repo.upsert(
      makeStock({
        ticker: "ZERO",
        marketCap: 3e12,
        totalDebt: 0,
        cashAndSecurities: 0,
        interestIncomeTtm: 0,
        revenueTtm: 0,
      }),
    );

    const result = repo.getByTicker("ZERO");
    expect(result?.marketCap).toBe(3e12);
    expect(typeof result?.marketCap).toBe("number");
    expect(result?.totalDebt).toBe(0);
    expect(typeof result?.totalDebt).toBe("number");
  });

  it("round-trips a dataIssues entry containing unicode characters", () => {
    const issue = "Foreign/IFRS filer — financials not screened";
    repo.upsert(makeStock({ ticker: "IFRS", dataIssues: [issue], halalStatus: "unknown", screening: null }));
    expect(repo.getByTicker("IFRS")?.dataIssues).toEqual([issue]);
  });

  it("stamps a valid, non-decreasing updatedAt on a repeat upsert", () => {
    repo.upsert(makeStock({ ticker: "UPD" }));
    const first = repo.getByTicker("UPD")?.updatedAt;

    repo.upsert(makeStock({ ticker: "UPD", name: "Updated Name" }));
    const second = repo.getByTicker("UPD")?.updatedAt;

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(Number.isNaN(Date.parse(second ?? ""))).toBe(false);
    expect(new Date(second ?? "").getTime()).toBeGreaterThanOrEqual(new Date(first ?? "").getTime());
  });
});

describe("schema constraints", () => {
  it("rejects an invalid halal_status value at the DB level (CHECK constraint)", () => {
    expect(() => {
      db.prepare(
        `INSERT INTO stocks (ticker, name, halal_status, updated_at) VALUES (?, ?, ?, ?)`,
      ).run("BAD", "Bad Co", "maybe", new Date().toISOString());
    }).toThrow();
  });

  it("rejects a favorites row for a ticker with no matching stocks row (foreign key)", () => {
    expect(() => {
      db.prepare(`INSERT INTO favorites (ticker, created_at) VALUES (?, ?)`).run(
        "NOPE",
        new Date().toISOString(),
      );
    }).toThrow();
  });
});

describe("count / maxScreenedAt", () => {
  it("returns 0 and null on an empty table", () => {
    expect(repo.count()).toBe(0);
    expect(repo.maxScreenedAt()).toBeNull();
  });

  it("counts rows and finds the maximum screenedAt", () => {
    repo.upsert(makeStock({ ticker: "AAPL", screenedAt: "2026-01-01T00:00:00.000Z" }));
    repo.upsert(makeStock({ ticker: "T", screenedAt: "2026-03-01T00:00:00.000Z" }));
    repo.upsert(makeStock({ ticker: "JPM", screenedAt: null }));

    expect(repo.count()).toBe(3);
    expect(repo.maxScreenedAt()).toBe("2026-03-01T00:00:00.000Z");
  });
});

describe("list: pagination", () => {
  beforeEach(() => {
    for (let i = 0; i < 5; i++) {
      const ticker = `TIC${i}`;
      repo.upsert(makeStock({ ticker, name: `Company ${i}` }));
    }
  });

  it("paginates full pages", () => {
    const page1 = repo.list({ page: 1, limit: 2 });
    expect(page1.total).toBe(5);
    expect(page1.rows.map((r) => r.ticker)).toEqual(["TIC0", "TIC1"]);

    const page2 = repo.list({ page: 2, limit: 2 });
    expect(page2.rows.map((r) => r.ticker)).toEqual(["TIC2", "TIC3"]);
  });

  it("returns a partial last page", () => {
    const page3 = repo.list({ page: 3, limit: 2 });
    expect(page3.total).toBe(5);
    expect(page3.rows.map((r) => r.ticker)).toEqual(["TIC4"]);
  });

  it("returns an empty page with the correct total when page is beyond the end", () => {
    const page = repo.list({ page: 10, limit: 2 });
    expect(page.total).toBe(5);
    expect(page.rows).toEqual([]);
  });

  it("returns every row on a single page when limit exceeds the total", () => {
    const { rows, total } = repo.list({ page: 1, limit: 100 });
    expect(total).toBe(5);
    expect(rows.map((r) => r.ticker)).toEqual(["TIC0", "TIC1", "TIC2", "TIC3", "TIC4"]);
  });

  it("throws a RangeError for a non-positive page or limit", () => {
    expect(() => repo.list({ page: 0, limit: 10 })).toThrow(RangeError);
    expect(() => repo.list({ page: 1, limit: 0 })).toThrow(RangeError);
    expect(() => repo.list({ page: 1.5, limit: 10 })).toThrow(RangeError);
  });
});

describe("list: search", () => {
  beforeEach(() => {
    repo.upsert(makeStock({ ticker: "A", name: "Agilent Technologies" }));
    repo.upsert(makeStock({ ticker: "AAL", name: "American Airlines" }));
    repo.upsert(makeStock({ ticker: "AAPL", name: "Apple Inc" }));
    // Name contains a lowercase 'a' but the ticker does not start with 'A' —
    // must rank after ticker-exact/prefix matches for a single-letter search.
    repo.upsert(makeStock({ ticker: "ZETA", name: "Zeta Corp" }));
  });

  it("matches by ticker prefix ('aa' -> AAL, AAPL)", () => {
    const { rows } = repo.list({ page: 1, limit: 10, search: "aa" });
    expect(rows.map((r) => r.ticker)).toEqual(["AAL", "AAPL"]);
  });

  it("matches by name substring ('apple' -> AAPL only)", () => {
    const { rows } = repo.list({ page: 1, limit: 10, search: "apple" });
    expect(rows.map((r) => r.ticker)).toEqual(["AAPL"]);
  });

  it("is case-insensitive", () => {
    const lower = repo.list({ page: 1, limit: 10, search: "apple" });
    const upper = repo.list({ page: 1, limit: 10, search: "APPLE" });
    expect(upper.rows.map((r) => r.ticker)).toEqual(lower.rows.map((r) => r.ticker));
  });

  it("ranks an exact ticker match first, then ticker-prefix matches, then name matches", () => {
    const { rows } = repo.list({ page: 1, limit: 10, search: "a" });
    expect(rows.map((r) => r.ticker)).toEqual(["A", "AAL", "AAPL", "ZETA"]);
  });

  it("treats '%' as a literal character, not a wildcard", () => {
    const { rows, total } = repo.list({ page: 1, limit: 10, search: "%" });
    expect(rows).toEqual([]);
    expect(total).toBe(0);
  });

  it("treats '_' as a literal character, not a wildcard", () => {
    const { rows, total } = repo.list({ page: 1, limit: 10, search: "_" });
    expect(rows).toEqual([]);
    expect(total).toBe(0);
  });

  it("treats a SQL-injection-style search string as a literal, and leaves the table intact", () => {
    expect(() => repo.list({ page: 1, limit: 10, search: "'; DROP TABLE stocks;--" })).not.toThrow();
    const { rows, total } = repo.list({ page: 1, limit: 10, search: "'; DROP TABLE stocks;--" });
    expect(rows).toEqual([]);
    expect(total).toBe(0);
    expect(repo.count()).toBe(4);
  });

  it("finds BRK.B by the 'brk-b' alias, and looks it up the same way", () => {
    repo.upsert(makeStock({ ticker: "BRK.B", name: "Berkshire Hathaway" }));
    const { rows } = repo.list({ page: 1, limit: 10, search: "brk-b" });
    expect(rows.map((r) => r.ticker)).toEqual(["BRK.B"]);
    expect(repo.getByTicker("brk-b")?.ticker).toBe("BRK.B");
  });

  it("treats a whitespace-only search the same as no search", () => {
    const whitespace = repo.list({ page: 1, limit: 10, search: "   " });
    const noSearch = repo.list({ page: 1, limit: 10 });
    expect(whitespace.rows.map((r) => r.ticker)).toEqual(noSearch.rows.map((r) => r.ticker));
    expect(whitespace.total).toBe(noSearch.total);
  });

  it("treats a backslash in the search term as a literal character", () => {
    repo.upsert(makeStock({ ticker: "BSL", name: "Foo\\Bar Inc" }));
    const { rows } = repo.list({ page: 1, limit: 10, search: "o\\b" });
    expect(rows.map((r) => r.ticker)).toEqual(["BSL"]);
  });
});

describe("list: search ordering — a ticker-prefix match always outranks a name-only match", () => {
  it("ranks the ticker-prefix match first even when the name-only match sorts earlier by ticker", () => {
    // AAA only matches via its name ("Abacus" contains "ab"); its ticker does
    // not start with "AB", so it must rank as a name-only match (rank 2).
    // ABZ's ticker starts with "AB", so it must rank as a ticker-prefix
    // match (rank 1) even though "AAA" < "ABZ" alphabetically — proving the
    // ranking isn't just falling out of the ticker ASC tie-break.
    repo.upsert(makeStock({ ticker: "AAA", name: "Abacus Corp" }));
    repo.upsert(makeStock({ ticker: "ABZ", name: "Zenith Ltd" }));

    const { rows } = repo.list({ page: 1, limit: 10, search: "ab" });
    expect(rows.map((r) => r.ticker)).toEqual(["ABZ", "AAA"]);
  });
});

describe("list: status, favoritesOnly, search, and pagination combined", () => {
  beforeEach(() => {
    repo.upsert(
      makeStock({ ticker: "AAPL", name: "Apple Inc", industry: "Technology", halalStatus: "halal" }),
    );
    repo.upsert(
      makeStock({ ticker: "AAL", name: "American Airlines", industry: "Airlines", halalStatus: "halal" }),
    );
    repo.upsert(
      makeStock({ ticker: "JPM", name: "JPMorgan Chase", industry: "Banking", halalStatus: "not_halal" }),
    );
    repo.upsert(
      makeStock({ ticker: "ASML", name: "ASML Holding", industry: "Technology", halalStatus: "unknown" }),
    );

    db.prepare("INSERT INTO favorites (ticker, created_at) VALUES (?, ?)").run(
      "AAPL",
      "2026-01-01T00:00:00.000Z",
    );
    db.prepare("INSERT INTO favorites (ticker, created_at) VALUES (?, ?)").run(
      "AAL",
      "2026-01-02T00:00:00.000Z",
    );
  });

  it("filters by status alone", () => {
    const { rows, total } = repo.list({ page: 1, limit: 10, status: "halal" });
    expect(total).toBe(2);
    expect(rows.map((r) => r.ticker).sort()).toEqual(["AAL", "AAPL"]);
  });

  it("filters by favoritesOnly alone, with isFavorite true on every row", () => {
    const { rows, total } = repo.list({ page: 1, limit: 10, favoritesOnly: true });
    expect(total).toBe(2);
    expect(rows.every((r) => r.isFavorite)).toBe(true);
    expect(rows.map((r) => r.ticker).sort()).toEqual(["AAL", "AAPL"]);
  });

  it("combines status and search without favoritesOnly, returning the correct total", () => {
    // AAPL, AAL, and ASML all match search "a" (ticker or name), but only
    // AAPL and AAL are halal, so the status filter must narrow the total
    // independently of favoritesOnly.
    const { rows, total } = repo.list({ page: 1, limit: 10, status: "halal", search: "a" });
    expect(total).toBe(2);
    expect(rows.map((r) => r.ticker).sort()).toEqual(["AAL", "AAPL"]);
  });

  it("combines status, favoritesOnly, search, and pagination", () => {
    const { rows, total } = repo.list({
      page: 1,
      limit: 1,
      status: "halal",
      favoritesOnly: true,
      search: "a",
    });
    // Both AAPL and AAL are halal + favorited + match search "a"; limit=1
    // exercises pagination on top of the combined filters.
    expect(total).toBe(2);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.isFavorite).toBe(true);
    expect(rows[0]?.halalStatus).toBe("halal");
  });

  it("reports isFavorite: false for non-favorited rows in an unfiltered list", () => {
    const { rows } = repo.list({ page: 1, limit: 10 });
    const jpm = rows.find((r) => r.ticker === "JPM");
    expect(jpm?.isFavorite).toBe(false);
  });
});

describe("getByTicker with corrupted screening JSON", () => {
  it("throws an error whose message names the ticker", () => {
    repo.upsert(makeStock({ ticker: "AAPL" }));
    db.prepare("UPDATE stocks SET screening = ? WHERE ticker = ?").run("{not valid json", "AAPL");

    expect(() => repo.getByTicker("AAPL")).toThrow(/AAPL/);
  });
});

describe("upsertIdentities", () => {
  it("inserts new identities as unscreened 'unknown' rows", () => {
    const result = repo.upsertIdentities([
      { ticker: "AAPL", name: "Apple Inc", cik: "0000320193" },
      { ticker: "MSFT", name: "Microsoft Corp", cik: "0000789019" },
      { ticker: "BRK.B", name: "Berkshire Hathaway", cik: null },
    ]);

    expect(result).toEqual({ inserted: 3, updated: 0, unchanged: 0 });
    expect(repo.count()).toBe(3);

    const aapl = repo.getByTicker("AAPL");
    expect(aapl?.halalStatus).toBe("unknown");
    expect(aapl?.screening).toBeNull();
    expect(aapl?.dataIssues).toEqual(["Not screened yet"]);
    expect(aapl?.name).toBe("Apple Inc");
    expect(aapl?.cik).toBe("0000320193");
  });

  it("reports the same batch re-applied as entirely unchanged, without duplicating rows", () => {
    const identities = [
      { ticker: "AAPL", name: "Apple Inc", cik: "0000320193" },
      { ticker: "MSFT", name: "Microsoft Corp", cik: "0000789019" },
      { ticker: "BRK.B", name: "Berkshire Hathaway", cik: null },
    ];
    repo.upsertIdentities(identities);

    const second = repo.upsertIdentities(identities);
    expect(second).toEqual({ inserted: 0, updated: 0, unchanged: 3 });
    expect(repo.count()).toBe(3);
  });

  it("updates only the identities whose name changed", () => {
    repo.upsertIdentities([
      { ticker: "AAPL", name: "Apple Inc", cik: "0000320193" },
      { ticker: "MSFT", name: "Microsoft Corp", cik: "0000789019" },
      { ticker: "BRK.B", name: "Berkshire Hathaway", cik: null },
    ]);

    const result = repo.upsertIdentities([
      { ticker: "AAPL", name: "Apple Incorporated", cik: "0000320193" },
      { ticker: "MSFT", name: "Microsoft Corp", cik: "0000789019" },
      { ticker: "BRK.B", name: "Berkshire Hathaway", cik: null },
    ]);

    expect(result).toEqual({ inserted: 0, updated: 1, unchanged: 2 });
    expect(repo.getByTicker("AAPL")?.name).toBe("Apple Incorporated");
  });

  it("never touches halalStatus, screening, financials, dataIssues, screenedAt, or fetchError of an already-screened row", () => {
    const screening = screen(makeScreeningInput({ ticker: "AAPL", industry: "Technology" }));
    repo.upsert(
      makeStock({
        ticker: "AAPL",
        name: "Apple Inc",
        screening,
        halalStatus: "halal",
        marketCap: 3_000_000_000_000,
        totalDebt: 100,
        cashAndSecurities: 150,
        interestIncomeTtm: 1,
        revenueTtm: 400_000_000_000,
        dataIssues: [],
        screenedAt: "2026-01-01T00:00:00.000Z",
        fetchError: null,
      }),
    );

    const before = repo.getByTicker("AAPL");

    const result = repo.upsertIdentities([{ ticker: "AAPL", name: "Apple Incorporated", cik: "0000320193" }]);

    expect(result).toEqual({ inserted: 0, updated: 1, unchanged: 0 });
    const after = repo.getByTicker("AAPL");
    expect(after?.name).toBe("Apple Incorporated");
    expect(after?.halalStatus).toBe(before?.halalStatus);
    expect(after?.screening).toEqual(before?.screening);
    expect(after?.marketCap).toBe(before?.marketCap);
    expect(after?.totalDebt).toBe(before?.totalDebt);
    expect(after?.cashAndSecurities).toBe(before?.cashAndSecurities);
    expect(after?.interestIncomeTtm).toBe(before?.interestIncomeTtm);
    expect(after?.revenueTtm).toBe(before?.revenueTtm);
    expect(after?.dataIssues).toEqual(before?.dataIssues);
    expect(after?.screenedAt).toBe(before?.screenedAt);
    expect(after?.fetchError).toBe(before?.fetchError);
  });

  // A rollback test (batch fails partway through, count unchanged) is
  // skipped: IdentityInput's typed fields (ticker/name: string, cik: string
  // | null) don't leave a clean way to force the INSERT/UPDATE to fail
  // without an `as` cast to smuggle in a wrong-shaped value at runtime, which
  // this codebase avoids. The BEGIN/COMMIT/ROLLBACK wiring itself mirrors
  // migrations.ts's withTransaction, which is exercised by the migration
  // tests above.
});
