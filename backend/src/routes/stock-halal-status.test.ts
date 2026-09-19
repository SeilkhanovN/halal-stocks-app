import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import type { FastifyInstance } from "fastify";
import { openDatabase } from "../db/connection.js";
import { createStocksRepo } from "../db/stocks-repo.js";
import { buildApp } from "../app.js";
import type { HalalScreening } from "../types/halal.js";
import type { ErrorBody } from "../lib/errors.js";
import { screen } from "../lib/halal-screen.js";

describe("GET /stocks/:ticker/halal-status", () => {
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
      const response = await app.inject({ method: "GET", url: "/stocks/AAPL/halal-status" });

      expect(response.statusCode).toBe(503);
      const body = response.json() as ErrorBody;
      expect(body.error.code).toBe("DATA_NOT_SEEDED");
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

    it("a debt-breach not_halal stock returns the 3 ratios in order, with the breached ratio's explanation and reasons", async () => {
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

      const response = await app.inject({ method: "GET", url: "/stocks/AAPL/halal-status" });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: HalalScreening };
      expect(body.data.ratios.map((ratio) => ratio.key)).toEqual([
        "debtToMarketCap",
        "cashAndSecuritiesToMarketCap",
        "interestIncomeToRevenue",
      ]);

      const debtRatio = body.data.ratios.find((ratio) => ratio.key === "debtToMarketCap");
      expect(debtRatio?.breached).toBe(true);
      expect(debtRatio?.explanation).toMatch(/40\.0% meets or exceeds the 30% limit/);

      expect(body.data.reasons.length).toBeGreaterThanOrEqual(1);
      expect(body.data.reasons).toContain(`${debtRatio?.label}: ${debtRatio?.explanation}`);
    });

    it("a stock with missing interest income screens unknown, with a null ratio and the relevant reasons", async () => {
      const screening = screen({
        ticker: "MSFT",
        industry: "Technology",
        marketCap: 1000,
        totalDebt: 100,
        cashAndSecurities: 50,
        interestIncomeTtm: null,
        revenueTtm: 1000,
        dataIssues: ["Interest income not reported"],
      });
      expect(screening.status).toBe("unknown");

      createStocksRepo(db).upsert({
        ticker: "MSFT",
        name: "Microsoft",
        exchange: "NASDAQ",
        industry: "Technology",
        cik: null,
        marketCap: 1000,
        totalDebt: 100,
        cashAndSecurities: 50,
        interestIncomeTtm: null,
        revenueTtm: 1000,
        dataIssues: ["Interest income not reported"],
        halalStatus: screening.status,
        screening,
        screenedAt: "2026-09-01T00:00:00.000Z",
        fetchError: null,
      });

      const response = await app.inject({ method: "GET", url: "/stocks/MSFT/halal-status" });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: HalalScreening };
      expect(body.data.status).toBe("unknown");

      const interestRatio = body.data.ratios.find((ratio) => ratio.key === "interestIncomeToRevenue");
      expect(interestRatio?.value).toBeNull();
      expect(interestRatio?.breached).toBeNull();

      expect(body.data.reasons.some((reason) => reason.includes("interest income"))).toBe(true);
      expect(body.data.reasons).toContain("Data issue: Interest income not reported");
    });

    it("a dashed share-class ticker returns the same body as its canonical dotted form", async () => {
      const screening = screen({
        ticker: "BRK.B",
        industry: "Technology",
        marketCap: 1000,
        totalDebt: 100,
        cashAndSecurities: 50,
        interestIncomeTtm: 1,
        revenueTtm: 1000,
        dataIssues: [],
      });

      createStocksRepo(db).upsert({
        ticker: "BRK.B",
        name: "Berkshire Hathaway",
        exchange: "NYSE",
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
        screenedAt: "2026-09-01T00:00:00.000Z",
        fetchError: null,
      });

      const [dashed, dotted] = await Promise.all([
        app.inject({ method: "GET", url: "/stocks/brk-b/halal-status" }),
        app.inject({ method: "GET", url: "/stocks/BRK.B/halal-status" }),
      ]);

      expect(dashed.statusCode).toBe(200);
      expect(dashed.json()).toEqual(dotted.json());
    });

    it("an unknown ticker on a non-empty DB -> 404 STOCK_NOT_FOUND", async () => {
      createStocksRepo(db).upsertIdentities([{ ticker: "AAPL", name: "Apple Inc.", cik: null }]);

      const response = await app.inject({ method: "GET", url: "/stocks/NOPE/halal-status" });

      expect(response.statusCode).toBe(404);
      const body = response.json() as ErrorBody;
      expect(body.error.code).toBe("STOCK_NOT_FOUND");
    });

    it("an identity-only row (screening null) does not throw and screens unknown with all-null ratios", async () => {
      createStocksRepo(db).upsertIdentities([{ ticker: "AAPL", name: "Apple Inc.", cik: null }]);

      const response = await app.inject({ method: "GET", url: "/stocks/AAPL/halal-status" });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: HalalScreening };
      expect(body.data.status).toBe("unknown");
      for (const ratio of body.data.ratios) {
        expect(ratio.value).toBeNull();
      }
      expect(body.data.businessActivity.industry).toBeNull();

      // Every ratio is missing its denominator (market cap / revenue), industry
      // is unavailable, and the row itself is flagged "Not screened yet" — a
      // human reading `reasons` should be able to tell all three apart rather
      // than just see `reasons.length > 0`.
      expect(body.data.reasons).toEqual([
        "Industry not available; business activity could not be screened.",
        "Debt / market cap: Not available: market cap is missing.",
        "Cash and securities / market cap: Not available: market cap is missing.",
        "Interest income / revenue: Not available: revenue is missing.",
        "Data issue: Not screened yet",
      ]);
    });
  });
});
