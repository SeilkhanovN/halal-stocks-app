import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import type { FastifyInstance } from "fastify";
import { openDatabase } from "../db/connection.js";
import { createStocksRepo } from "../db/stocks-repo.js";
import { buildApp } from "../app.js";
import type { StockDetail } from "../types/api.js";
import type { ErrorBody } from "../lib/errors.js";
import { screen } from "../lib/halal-screen.js";

const STOCK_DETAIL_KEYS = [
  "ticker",
  "name",
  "exchange",
  "industry",
  "halalStatus",
  "isFavorite",
  "screenedAt",
  "marketCap",
  "screening",
].sort();

describe("GET /stocks/:ticker", () => {
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
      const response = await app.inject({ method: "GET", url: "/stocks/AAPL" });

      expect(response.statusCode).toBe(503);
      const body = response.json() as ErrorBody;
      expect(body).toEqual({
        error: { code: "DATA_NOT_SEEDED", message: expect.any(String) as string },
      });
    });
  });

  describe("seeded database", () => {
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

    it("an unscreened (identity-only) row is case-insensitive and falls back to a computed unknown screening", async () => {
      createStocksRepo(db).upsertIdentities([{ ticker: "AAPL", name: "Apple Inc.", cik: null }]);

      const [lower, upper] = await Promise.all([
        app.inject({ method: "GET", url: "/stocks/aapl" }),
        app.inject({ method: "GET", url: "/stocks/AAPL" }),
      ]);

      expect(lower.statusCode).toBe(200);
      expect(upper.statusCode).toBe(200);
      expect(lower.json()).toEqual(upper.json());

      const body = lower.json() as { data: StockDetail };
      expect(body.data.screening.status).toBe("unknown");
      for (const ratio of body.data.screening.ratios) {
        expect(ratio.value).toBeNull();
      }
      expect(body.data.marketCap).toBeNull();
      expect(body.data.isFavorite).toBe(false);
    });

    it("normalizes a dashed share-class ticker to its canonical dotted form", async () => {
      createStocksRepo(db).upsertIdentities([{ ticker: "BRK.B", name: "Berkshire Hathaway", cik: null }]);

      const response = await app.inject({ method: "GET", url: "/stocks/BRK-B" });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: StockDetail };
      expect(body.data.ticker).toBe("BRK.B");
    });

    it("an unknown ticker on a non-empty DB -> 404 STOCK_NOT_FOUND", async () => {
      createStocksRepo(db).upsertIdentities([{ ticker: "AAPL", name: "Apple Inc.", cik: null }]);

      const response = await app.inject({ method: "GET", url: "/stocks/NOPE" });

      expect(response.statusCode).toBe(404);
      const body = response.json() as ErrorBody;
      expect(body.error.code).toBe("STOCK_NOT_FOUND");
    });

    it("a fully screened not_halal stock returns exactly the 9 StockDetail keys with no leakage", async () => {
      const screening = screen({
        ticker: "AAPL",
        industry: "Technology",
        marketCap: 1000,
        totalDebt: 400,
        cashAndSecurities: 50,
        interestIncomeTtm: 1,
        revenueTtm: 1000,
        dataIssues: [],
      });
      expect(screening.status).toBe("not_halal");

      createStocksRepo(db).upsert({
        ticker: "AAPL",
        name: "Apple Inc.",
        exchange: "NASDAQ",
        industry: "Technology",
        cik: null,
        marketCap: 1000,
        totalDebt: 400,
        cashAndSecurities: 50,
        interestIncomeTtm: 1,
        revenueTtm: 1000,
        dataIssues: [],
        halalStatus: screening.status,
        screening,
        screenedAt: "2026-09-01T00:00:00.000Z",
        fetchError: null,
      });

      const response = await app.inject({ method: "GET", url: "/stocks/AAPL" });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: StockDetail };
      expect(body.data.halalStatus).toBe("not_halal");
      expect(Object.keys(body.data).sort()).toEqual(STOCK_DETAIL_KEYS);

      const leakedKeys = ["totalDebt", "cashAndSecurities", "interestIncomeTtm", "revenueTtm", "dataIssues", "fetchError", "cik", "updatedAt"];
      for (const key of leakedKeys) {
        expect(body.data).not.toHaveProperty(key);
      }
    });
  });
});
