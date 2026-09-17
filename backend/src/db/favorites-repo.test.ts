import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { closeDatabase, openDatabase } from "./connection.js";
import { createFavoritesRepo, StockNotFoundError, type FavoritesRepo } from "./favorites-repo.js";
import { createStocksRepo, type StocksRepo, type UpsertStockInput } from "./stocks-repo.js";
import { screen } from "../lib/halal-screen.js";
import type { ScreeningInput } from "../types/halal.js";

let db: DatabaseSync;
let stocksRepo: StocksRepo;
let favoritesRepo: FavoritesRepo;

beforeEach(() => {
  db = openDatabase(":memory:");
  stocksRepo = createStocksRepo(db);
  favoritesRepo = createFavoritesRepo(db);
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

function makeStock(overrides: Partial<UpsertStockInput> = {}): UpsertStockInput {
  const ticker = overrides.ticker ?? "AAPL";
  const industry = overrides.industry === undefined ? "Technology" : overrides.industry;
  const screening = screen(makeScreeningInput({ ticker, industry }));

  return {
    ticker,
    name: overrides.name ?? "Apple Inc",
    exchange: overrides.exchange === undefined ? "NASDAQ" : overrides.exchange,
    industry,
    cik: overrides.cik === undefined ? "0000320193" : overrides.cik,
    marketCap: overrides.marketCap === undefined ? 1000 : overrides.marketCap,
    totalDebt: overrides.totalDebt === undefined ? 100 : overrides.totalDebt,
    cashAndSecurities: overrides.cashAndSecurities === undefined ? 150 : overrides.cashAndSecurities,
    interestIncomeTtm: overrides.interestIncomeTtm === undefined ? 1 : overrides.interestIncomeTtm,
    revenueTtm: overrides.revenueTtm === undefined ? 100 : overrides.revenueTtm,
    dataIssues: overrides.dataIssues ?? [],
    halalStatus: overrides.halalStatus ?? screening.status,
    screening,
    screenedAt: overrides.screenedAt === undefined ? "2026-01-01T00:00:00.000Z" : overrides.screenedAt,
    fetchError: overrides.fetchError === undefined ? null : overrides.fetchError,
  };
}

describe("add", () => {
  it("adds a favorite for an existing stock and reports added: true", () => {
    stocksRepo.upsert(makeStock({ ticker: "AAPL" }));

    const result = favoritesRepo.add("AAPL");

    expect(result).toEqual({ added: true });
    expect(favoritesRepo.list({ page: 1, limit: 10 }).total).toBe(1);
  });

  it("is idempotent: adding an already-favorited stock reports added: false", () => {
    stocksRepo.upsert(makeStock({ ticker: "AAPL" }));

    favoritesRepo.add("AAPL");
    const second = favoritesRepo.add("AAPL");

    expect(second).toEqual({ added: false });
    expect(favoritesRepo.list({ page: 1, limit: 10 }).total).toBe(1);
  });

  it("normalizes the ticker before checking/inserting", () => {
    stocksRepo.upsert(makeStock({ ticker: "BRK.B", name: "Berkshire Hathaway" }));

    const result = favoritesRepo.add("brk-b");

    expect(result).toEqual({ added: true });
    expect(favoritesRepo.list({ page: 1, limit: 10 }).rows[0]?.ticker).toBe("BRK.B");
  });

  it("throws StockNotFoundError with the normalized ticker for an unknown stock", () => {
    expect(() => favoritesRepo.add("nope")).toThrow(StockNotFoundError);
    try {
      favoritesRepo.add("nope");
      throw new Error("unreachable: add() above should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(StockNotFoundError);
      if (error instanceof StockNotFoundError) {
        expect(error.ticker).toBe("NOPE");
      }
    }
  });
});

describe("remove", () => {
  it("removes an existing favorite", () => {
    stocksRepo.upsert(makeStock({ ticker: "AAPL" }));
    favoritesRepo.add("AAPL");

    favoritesRepo.remove("AAPL");

    expect(favoritesRepo.list({ page: 1, limit: 10 }).total).toBe(0);
  });

  it("is idempotent: removing a non-favorite does not throw", () => {
    stocksRepo.upsert(makeStock({ ticker: "AAPL" }));

    expect(() => favoritesRepo.remove("AAPL")).not.toThrow();
    expect(() => favoritesRepo.remove("AAPL")).not.toThrow();
  });

  it("does not throw for a ticker that isn't even a known stock", () => {
    expect(() => favoritesRepo.remove("NOPE")).not.toThrow();
  });

  it("accepts a lowercase, hyphenated ticker alias", () => {
    stocksRepo.upsert(makeStock({ ticker: "BRK.B", name: "Berkshire Hathaway" }));
    favoritesRepo.add("BRK.B");

    favoritesRepo.remove("brk-b");

    expect(favoritesRepo.list({ page: 1, limit: 10 }).total).toBe(0);
  });
});

describe("list", () => {
  it("orders by created_at desc, then ticker asc, all with isFavorite: true", () => {
    stocksRepo.upsert(makeStock({ ticker: "AAPL" }));
    stocksRepo.upsert(makeStock({ ticker: "AAL", name: "American Airlines" }));
    stocksRepo.upsert(makeStock({ ticker: "JPM", name: "JPMorgan Chase", industry: "Banking" }));

    // Insert out of ticker order and with explicit, distinct created_at
    // timestamps (via the repo's own add(), which stamps "now") by adding
    // sequentially — Date.now() resolution could tie on a very fast
    // machine, so drive created_at directly through the DB for a
    // deterministic order instead.
    db.prepare("INSERT INTO favorites (ticker, created_at) VALUES (?, ?)").run(
      "JPM",
      "2026-01-01T00:00:00.000Z",
    );
    db.prepare("INSERT INTO favorites (ticker, created_at) VALUES (?, ?)").run(
      "AAPL",
      "2026-01-02T00:00:00.000Z",
    );
    db.prepare("INSERT INTO favorites (ticker, created_at) VALUES (?, ?)").run(
      "AAL",
      "2026-01-02T00:00:00.000Z",
    );

    const { rows, total } = favoritesRepo.list({ page: 1, limit: 10 });

    expect(total).toBe(3);
    // AAPL and AAL tie on created_at, so ticker asc breaks the tie; JPM has
    // the oldest created_at, so it sorts last under created_at desc.
    expect(rows.map((r) => r.ticker)).toEqual(["AAL", "AAPL", "JPM"]);
    expect(rows.every((r) => r.isFavorite)).toBe(true);
  });

  it("paginates, with total independent of the requested page", () => {
    for (let i = 0; i < 3; i++) {
      const ticker = `TIC${i}`;
      stocksRepo.upsert(makeStock({ ticker, name: `Company ${i}` }));
      favoritesRepo.add(ticker);
    }

    const page1 = favoritesRepo.list({ page: 1, limit: 2 });
    const page2 = favoritesRepo.list({ page: 2, limit: 2 });
    expect(page1.total).toBe(3);
    expect(page2.total).toBe(3);
    expect(page1.rows).toHaveLength(2);
    expect(page2.rows).toHaveLength(1);
  });

  it("throws a RangeError for a non-positive page or limit", () => {
    expect(() => favoritesRepo.list({ page: 0, limit: 10 })).toThrow(RangeError);
    expect(() => favoritesRepo.list({ page: 1, limit: 0 })).toThrow(RangeError);
  });
});

describe("cascade delete", () => {
  it("removes the favorite when its stock row is deleted", () => {
    stocksRepo.upsert(makeStock({ ticker: "AAPL" }));
    favoritesRepo.add("AAPL");
    expect(favoritesRepo.list({ page: 1, limit: 10 }).total).toBe(1);

    db.prepare("DELETE FROM stocks WHERE ticker = ?").run("AAPL");

    expect(favoritesRepo.list({ page: 1, limit: 10 }).total).toBe(0);
  });
});
