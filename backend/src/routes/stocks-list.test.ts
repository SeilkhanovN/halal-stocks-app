import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import type { FastifyInstance } from "fastify";
import { openDatabase } from "../db/connection.js";
import { createStocksRepo, type IdentityInput } from "../db/stocks-repo.js";
import { buildApp } from "../app.js";
import type { Paginated, StockSummary } from "../types/api.js";
import type { ErrorBody } from "../lib/errors.js";
import { screen } from "../lib/halal-screen.js";

const BASE_STOCKS: IdentityInput[] = [
  { ticker: "AAPL", name: "Apple Inc.", cik: null },
  { ticker: "AAL", name: "American Airlines Group", cik: null },
  { ticker: "A", name: "Agilent Technologies", cik: null },
  { ticker: "MSFT", name: "Microsoft", cik: null },
  { ticker: "BRK.B", name: "Berkshire Hathaway", cik: null },
];

// 30 additional generic tickers so pagination has more than one page to
// exercise. Zero-padded so ticker-ASC ordering (ZZ01, ZZ02, ..., ZZ30)
// matches numeric order, not lexicographic ("ZZ10" < "ZZ2" would otherwise
// sort wrong).
function generatedStocks(count: number): IdentityInput[] {
  return Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    return { ticker: `ZZ${String(n).padStart(2, "0")}`, name: `Test Co ${n}`, cik: null };
  });
}

const GENERATED_STOCKS = generatedStocks(30);
const ALL_STOCKS = [...BASE_STOCKS, ...GENERATED_STOCKS];

// Hand-derived ticker-ASC order for ALL_STOCKS (SQLite's default BINARY
// collation on TEXT is a byte-for-byte comparison, so "A" < "AAL" < "AAPL"
// < "BRK.B" < "MSFT" < "ZZ01" < ... < "ZZ30").
const SORTED_TICKERS = [
  "A",
  "AAL",
  "AAPL",
  "BRK.B",
  "MSFT",
  ...GENERATED_STOCKS.map((s) => s.ticker),
];

function tickers(body: Paginated<StockSummary>): string[] {
  return body.data.map((item) => item.ticker);
}

describe("GET /stocks", () => {
  describe("empty database", () => {
    let db: DatabaseSync;
    let app: FastifyInstance;

    beforeEach(() => {
      db = openDatabase(":memory:");
      app = buildApp({ logger: false, db });
    });

    afterEach(async () => {
      await app.close();
      db.close();
    });

    it("returns 503 DATA_NOT_SEEDED", async () => {
      const response = await app.inject({ method: "GET", url: "/stocks" });

      expect(response.statusCode).toBe(503);
      const body = response.json() as ErrorBody;
      expect(body).toEqual({
        error: { code: "DATA_NOT_SEEDED", message: expect.any(String) as string },
      });
    });

    it("503 message mentions the seed:constituents command", async () => {
      const response = await app.inject({ method: "GET", url: "/stocks" });

      const body = response.json() as ErrorBody;
      expect(body.error.message).toContain("seed:constituents");
    });

    // Status validation happens before the empty-DB check, so an invalid
    // status against an empty database must still surface as a 400
    // VALIDATION_ERROR rather than being masked by 503 DATA_NOT_SEEDED (which
    // the "returns 503 DATA_NOT_SEEDED" test above confirms is what a
    // status-less request against the same empty DB returns instead).
    it("status=maybe against an empty database -> 400 VALIDATION_ERROR, not 503", async () => {
      const response = await app.inject({ method: "GET", url: "/stocks?status=maybe" });

      expect(response.statusCode).toBe(400);
      const body = response.json() as ErrorBody;
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("seeded database", () => {
    let db: DatabaseSync;
    let app: FastifyInstance;

    beforeEach(() => {
      db = openDatabase(":memory:");
      createStocksRepo(db).upsertIdentities(ALL_STOCKS);
      app = buildApp({ logger: false, db });
    });

    afterEach(async () => {
      await app.close();
      db.close();
    });

    it.each([
      { label: "limit=500", query: "limit=500" },
      { label: "limit=0", query: "limit=0" },
      { label: "page=0", query: "page=0" },
      { label: "page=abc", query: "page=abc" },
      // Regression: a huge integer used to pass validation and crash SQLite's OFFSET bind (500).
      { label: "page=1e20", query: "page=100000000000000000000" },
      { label: "page=1000001", query: "page=1000001" },
    ])("$label -> 400 VALIDATION_ERROR", async ({ query }) => {
      const response = await app.inject({ method: "GET", url: `/stocks?${query}` });

      expect(response.statusCode).toBe(400);
      const body = response.json() as ErrorBody;
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("default request returns exactly data/pagination/meta with 7-field items", async () => {
      const response = await app.inject({ method: "GET", url: "/stocks" });

      expect(response.statusCode).toBe(200);
      const body = response.json() as Paginated<StockSummary>;
      expect(Object.keys(body).sort()).toEqual(["data", "meta", "pagination"]);

      const expectedKeys = ["exchange", "halalStatus", "industry", "isFavorite", "name", "screenedAt", "ticker"].sort();
      for (const item of body.data) {
        expect(Object.keys(item).sort()).toEqual(expectedKeys);
      }

      expect(body.pagination).toEqual({ page: 1, limit: 25, total: 35, totalPages: 2 });
      expect(body.data).toHaveLength(25);
      expect(tickers(body)).toEqual(SORTED_TICKERS.slice(0, 25));
    });

    it("page beyond the end returns empty data with the correct total", async () => {
      const response = await app.inject({ method: "GET", url: "/stocks?page=3&limit=25" });

      expect(response.statusCode).toBe(200);
      const body = response.json() as Paginated<StockSummary>;
      expect(body.data).toEqual([]);
      expect(body.pagination.total).toBe(35);
      expect(body.pagination.totalPages).toBe(2);
    });

    it("limit=2&page=2 returns the correct 2 tickers in ticker-ASC order", async () => {
      const response = await app.inject({ method: "GET", url: "/stocks?limit=2&page=2" });

      expect(response.statusCode).toBe(200);
      const body = response.json() as Paginated<StockSummary>;
      expect(tickers(body)).toEqual(SORTED_TICKERS.slice(2, 4));
    });

    it("search=aapl returns AAPL first", async () => {
      const response = await app.inject({ method: "GET", url: "/stocks?search=aapl" });

      const body = response.json() as Paginated<StockSummary>;
      expect(body.data[0]?.ticker).toBe("AAPL");
    });

    it("search=apple matches by name and includes AAPL", async () => {
      const response = await app.inject({ method: "GET", url: "/stocks?search=apple" });

      const body = response.json() as Paginated<StockSummary>;
      expect(tickers(body)).toContain("AAPL");
    });

    it("search=AAPL is the same as search=aapl (case-insensitive)", async () => {
      const [lower, upper] = await Promise.all([
        app.inject({ method: "GET", url: "/stocks?search=aapl" }),
        app.inject({ method: "GET", url: "/stocks?search=AAPL" }),
      ]);

      expect(upper.json()).toEqual(lower.json());
    });

    it("search=brk-b finds BRK.B", async () => {
      const response = await app.inject({ method: "GET", url: "/stocks?search=brk-b" });

      const body = response.json() as Paginated<StockSummary>;
      expect(tickers(body)).toContain("BRK.B");
    });

    it("a whitespace-only search behaves like no search", async () => {
      const [noSearch, whitespaceSearch] = await Promise.all([
        app.inject({ method: "GET", url: "/stocks" }),
        app.inject({ method: "GET", url: "/stocks?search=%20%20" }),
      ]);

      const noSearchBody = noSearch.json() as Paginated<StockSummary>;
      const whitespaceBody = whitespaceSearch.json() as Paginated<StockSummary>;
      expect(whitespaceBody.pagination.total).toBe(noSearchBody.pagination.total);
      expect(tickers(whitespaceBody)).toEqual(tickers(noSearchBody));
    });

    it("a 51-char search -> 400 VALIDATION_ERROR", async () => {
      const response = await app.inject({ method: "GET", url: `/stocks?search=${"a".repeat(51)}` });

      expect(response.statusCode).toBe(400);
      const body = response.json() as ErrorBody;
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("ignores unknown query params", async () => {
      const response = await app.inject({ method: "GET", url: "/stocks?foo=bar" });

      expect(response.statusCode).toBe(200);
    });

    it("meta.dataAsOf is null and every stock is unscreened", async () => {
      const response = await app.inject({ method: "GET", url: "/stocks" });

      const body = response.json() as Paginated<StockSummary>;
      expect(body.meta.dataAsOf).toBeNull();
      for (const item of body.data) {
        expect(item.halalStatus).toBe("unknown");
        expect(item.isFavorite).toBe(false);
      }
    });

    it("meta.dataAsOf equals a screened stock's screenedAt, and that stock's halalStatus/screenedAt come through", async () => {
      const screenedAt = "2026-09-01T00:00:00.000Z";
      const screening = screen({
        ticker: "AAPL",
        industry: "Technology",
        marketCap: 1000,
        totalDebt: 100,
        cashAndSecurities: 50,
        interestIncomeTtm: 1,
        revenueTtm: 1000,
        dataIssues: [],
      });
      expect(screening.status).toBe("halal");

      createStocksRepo(db).upsert({
        ticker: "AAPL",
        name: "Apple Inc.",
        exchange: "NASDAQ",
        industry: "Technology",
        cik: null,
        marketCap: 1000,
        totalDebt: 100,
        cashAndSecurities: 50,
        interestIncomeTtm: 1,
        revenueTtm: 1000,
        dataIssues: [],
        halalStatus: screening.status,
        screening,
        screenedAt,
        fetchError: null,
      });

      const response = await app.inject({ method: "GET", url: "/stocks?search=aapl" });
      const body = response.json() as Paginated<StockSummary>;
      const aapl = body.data.find((item) => item.ticker === "AAPL");

      expect(aapl?.halalStatus).toBe("halal");
      expect(aapl?.screenedAt).toBe(screenedAt);
      expect(body.meta.dataAsOf).toBe(screenedAt);
    });

    it("search=a ranks the exact ticker match first, then ticker-prefix matches, then name-only matches", async () => {
      createStocksRepo(db).upsertIdentities([{ ticker: "ZZZ", name: "Aardvark Corp", cik: null }]);

      const response = await app.inject({ method: "GET", url: "/stocks?search=a" });
      const body = response.json() as Paginated<StockSummary>;

      // Matches for "a": A (exact), AAL/AAPL (ticker prefix "A%"), BRK.B
      // ("Berkshire Hathaway" contains "a") and ZZZ ("Aardvark Corp") are
      // both name-only matches, ordered alphabetically by ticker within
      // that last group.
      expect(tickers(body)).toEqual(["A", "AAL", "AAPL", "BRK.B", "ZZZ"]);
    });

    it("search with surrounding spaces behaves the same as the trimmed search", async () => {
      const [padded, trimmed] = await Promise.all([
        app.inject({ method: "GET", url: "/stocks?search=%20%20aapl%20%20" }),
        app.inject({ method: "GET", url: "/stocks?search=aapl" }),
      ]);

      expect(padded.statusCode).toBe(200);
      expect(padded.json()).toEqual(trimmed.json());
    });

    describe("status filter", () => {
      // AAPL/MSFT screen halal (permissible industry, passing ratios); AAL/A
      // screen not_halal via the "Banking" industry denylist, regardless of
      // ratios. The rest of ALL_STOCKS stays identity-only ('unknown').
      const NOT_HALAL_TICKERS = ["AAL", "A"];

      function seedScreened(ticker: string, name: string, industry: string): void {
        const screening = screen({
          ticker,
          industry,
          marketCap: 1000,
          totalDebt: 100,
          cashAndSecurities: 50,
          interestIncomeTtm: 1,
          revenueTtm: 1000,
          dataIssues: [],
        });

        createStocksRepo(db).upsert({
          ticker,
          name,
          exchange: "NASDAQ",
          industry,
          cik: null,
          marketCap: 1000,
          totalDebt: 100,
          cashAndSecurities: 50,
          interestIncomeTtm: 1,
          revenueTtm: 1000,
          dataIssues: [],
          halalStatus: screening.status,
          screening,
          screenedAt: "2026-09-01T00:00:00.000Z",
          fetchError: null,
        });
      }

      beforeEach(() => {
        seedScreened("AAPL", "Apple Inc.", "Technology");
        seedScreened("MSFT", "Microsoft", "Technology");
        seedScreened("AAL", "American Airlines Group", "Banking");
        seedScreened("A", "Agilent Technologies", "Banking");
      });

      it("status=not_halal returns only not_halal stocks with the correct total", async () => {
        const [filtered, unfiltered] = await Promise.all([
          app.inject({ method: "GET", url: "/stocks?status=not_halal" }),
          app.inject({ method: "GET", url: "/stocks" }),
        ]);

        expect(filtered.statusCode).toBe(200);
        const body = filtered.json() as Paginated<StockSummary>;
        expect(body.pagination.total).toBe(NOT_HALAL_TICKERS.length);
        for (const item of body.data) {
          expect(item.halalStatus).toBe("not_halal");
        }
        expect(tickers(body).sort()).toEqual([...NOT_HALAL_TICKERS].sort());

        expect(unfiltered.statusCode).toBe(200);
        const unfilteredBody = unfiltered.json() as Paginated<StockSummary>;
        expect(unfilteredBody.pagination.total).toBe(ALL_STOCKS.length);
      });

      it("status combines with search", async () => {
        const response = await app.inject({ method: "GET", url: "/stocks?status=halal&search=aapl" });

        expect(response.statusCode).toBe(200);
        const body = response.json() as Paginated<StockSummary>;
        expect(tickers(body)).toEqual(["AAPL"]);
        expect(body.pagination.total).toBe(1);
      });

      it("status combines with pagination", async () => {
        const response = await app.inject({ method: "GET", url: "/stocks?status=halal&page=2&limit=1" });

        expect(response.statusCode).toBe(200);
        const body = response.json() as Paginated<StockSummary>;
        expect(body.pagination).toEqual({ page: 2, limit: 1, total: 2, totalPages: 2 });
        expect(tickers(body)).toEqual(["MSFT"]);
      });

      it("status=maybe -> 400 VALIDATION_ERROR", async () => {
        const response = await app.inject({ method: "GET", url: "/stocks?status=maybe" });

        expect(response.statusCode).toBe(400);
        const body = response.json() as ErrorBody;
        expect(body.error.code).toBe("VALIDATION_ERROR");
      });

      it("status=HALAL -> 400 VALIDATION_ERROR (case sensitive, not normalized)", async () => {
        const response = await app.inject({ method: "GET", url: "/stocks?status=HALAL" });

        expect(response.statusCode).toBe(400);
        const body = response.json() as ErrorBody;
        expect(body.error.code).toBe("VALIDATION_ERROR");
      });

      it("a blank status= behaves exactly like omitting it", async () => {
        const [noStatus, blankStatus] = await Promise.all([
          app.inject({ method: "GET", url: "/stocks" }),
          app.inject({ method: "GET", url: "/stocks?status=" }),
        ]);

        expect(blankStatus.statusCode).toBe(200);
        const noStatusBody = noStatus.json() as Paginated<StockSummary>;
        const blankStatusBody = blankStatus.json() as Paginated<StockSummary>;
        expect(blankStatusBody.pagination.total).toBe(noStatusBody.pagination.total);
        expect(tickers(blankStatusBody)).toEqual(tickers(noStatusBody));
      });
    });
  });

  describe("without an injected db", () => {
    it("GET /stocks -> 404 NOT_FOUND, GET /health still works", async () => {
      const app = buildApp({ logger: false });

      const stocksResponse = await app.inject({ method: "GET", url: "/stocks" });
      expect(stocksResponse.statusCode).toBe(404);
      const stocksBody = stocksResponse.json() as ErrorBody;
      expect(stocksBody.error.code).toBe("NOT_FOUND");

      const healthResponse = await app.inject({ method: "GET", url: "/health" });
      expect(healthResponse.statusCode).toBe(200);

      await app.close();
    });
  });
});
