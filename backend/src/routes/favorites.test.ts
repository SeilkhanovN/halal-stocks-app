import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { FastifyInstance } from "fastify";
import { openDatabase } from "../db/connection.js";
import { createStocksRepo, type IdentityInput } from "../db/stocks-repo.js";
import { buildApp } from "../app.js";
import type { Paginated, StockSummary } from "../types/api.js";
import type { ErrorBody } from "../lib/errors.js";

const BASE_STOCKS: IdentityInput[] = [
  { ticker: "AAPL", name: "Apple Inc.", cik: null },
  { ticker: "MSFT", name: "Microsoft", cik: null },
  { ticker: "BRK.B", name: "Berkshire Hathaway", cik: null },
];

describe("favorites routes", () => {
  describe("seeded database", () => {
    let db: DatabaseSync;
    let app: FastifyInstance;

    beforeEach(() => {
      db = openDatabase(":memory:");
      createStocksRepo(db).upsertIdentities(BASE_STOCKS);
      app = buildApp({ logger: false, db });
    });

    afterEach(async () => {
      await app.close();
      db.close();
    });

    it("POST /favorites/AAPL -> 201, then POST again -> 200, same body", async () => {
      const first = await app.inject({ method: "POST", url: "/favorites/AAPL" });
      expect(first.statusCode).toBe(201);
      expect(first.json()).toEqual({ data: { ticker: "AAPL" } });

      const second = await app.inject({ method: "POST", url: "/favorites/AAPL" });
      expect(second.statusCode).toBe(200);
      expect(second.json()).toEqual({ data: { ticker: "AAPL" } });
    });

    it("POST /favorites/brk-b -> canonicalizes to BRK.B in the response", async () => {
      const response = await app.inject({ method: "POST", url: "/favorites/brk-b" });

      expect([200, 201]).toContain(response.statusCode);
      expect(response.json()).toEqual({ data: { ticker: "BRK.B" } });
    });

    it("POST /favorites/:ticker for a ticker absent from stocks -> 404 STOCK_NOT_FOUND", async () => {
      const response = await app.inject({ method: "POST", url: "/favorites/NOPE" });

      expect(response.statusCode).toBe(404);
      const body = response.json() as ErrorBody;
      expect(body.error.code).toBe("STOCK_NOT_FOUND");
    });

    it("DELETE /favorites/:ticker for a ticker absent from stocks -> 404 STOCK_NOT_FOUND", async () => {
      const response = await app.inject({ method: "DELETE", url: "/favorites/NOPE" });

      expect(response.statusCode).toBe(404);
      const body = response.json() as ErrorBody;
      expect(body.error.code).toBe("STOCK_NOT_FOUND");
    });

    it("DELETE an existing favorite -> 204; DELETE again -> 204", async () => {
      await app.inject({ method: "POST", url: "/favorites/AAPL" });

      const first = await app.inject({ method: "DELETE", url: "/favorites/AAPL" });
      expect(first.statusCode).toBe(204);
      expect(first.body).toBe("");

      const second = await app.inject({ method: "DELETE", url: "/favorites/AAPL" });
      expect(second.statusCode).toBe(204);
    });

    it("DELETE a stocks ticker that was never favorited -> 204", async () => {
      const response = await app.inject({ method: "DELETE", url: "/favorites/MSFT" });

      expect(response.statusCode).toBe(204);
      expect(response.body).toBe("");
    });

    it("GET /favorites returns exactly the favorited tickers with isFavorite true and full StockSummary fields", async () => {
      await app.inject({ method: "POST", url: "/favorites/AAPL" });
      await app.inject({ method: "POST", url: "/favorites/MSFT" });

      const response = await app.inject({ method: "GET", url: "/favorites" });

      expect(response.statusCode).toBe(200);
      const body = response.json() as Paginated<StockSummary>;
      const tickers = body.data.map((item) => item.ticker);
      expect(tickers.sort()).toEqual(["AAPL", "MSFT"]);
      expect(body.pagination.total).toBe(2);

      const expectedKeys = ["exchange", "halalStatus", "industry", "isFavorite", "name", "screenedAt", "ticker"].sort();
      for (const item of body.data) {
        expect(Object.keys(item).sort()).toEqual(expectedKeys);
        expect(item.isFavorite).toBe(true);
      }
    });

    // favorites-repo.ts's list() orders by `f.created_at DESC, s.ticker ASC`
    // (most-recently-favorited first; ticker-ASC only breaks ties on an
    // identical timestamp). This is deliberately unspecified by the PRD's
    // API contract (which only pins ticker-ASC for GET /stocks) and differs
    // from GET /stocks?favoritesOnly=true's ticker-ASC order. This test pins
    // the current behavior so a change to it is caught rather than silent;
    // it does not imply the ordering is required or "more correct" than any
    // other. Favoriting order (MSFT, AAPL, BRK.B) is neither alphabetical
    // nor reverse-alphabetical, so the expected reverse-insertion-order
    // result ([BRK.B, AAPL, MSFT]) can't be produced by an accidental
    // ticker-ASC or ticker-DESC sort either.
    it("GET /favorites orders by most-recently-favorited first (insertion order, newest first)", async () => {
      const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

      await app.inject({ method: "POST", url: "/favorites/MSFT" });
      await sleep(5);
      await app.inject({ method: "POST", url: "/favorites/AAPL" });
      await sleep(5);
      await app.inject({ method: "POST", url: "/favorites/BRK.B" });

      const response = await app.inject({ method: "GET", url: "/favorites" });

      expect(response.statusCode).toBe(200);
      const body = response.json() as Paginated<StockSummary>;
      expect(body.data.map((item) => item.ticker)).toEqual(["BRK.B", "AAPL", "MSFT"]);
    });

    it("GET /favorites on a seeded-but-unfavorited DB -> 200, data: [], total: 0 (not 503)", async () => {
      const response = await app.inject({ method: "GET", url: "/favorites" });

      expect(response.statusCode).toBe(200);
      const body = response.json() as Paginated<StockSummary>;
      expect(body.data).toEqual([]);
      expect(body.pagination.total).toBe(0);
    });

    it.each([
      { label: "limit=0", query: "limit=0" },
      { label: "limit=500", query: "limit=500" },
      { label: "page=0", query: "page=0" },
    ])("GET /favorites $label -> 400 VALIDATION_ERROR", async ({ query }) => {
      const response = await app.inject({ method: "GET", url: `/favorites?${query}` });

      expect(response.statusCode).toBe(400);
      const body = response.json() as ErrorBody;
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });
  });

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

    it("POST /favorites/:ticker on an empty DB -> 503 DATA_NOT_SEEDED", async () => {
      const response = await app.inject({ method: "POST", url: "/favorites/AAPL" });

      expect(response.statusCode).toBe(503);
      const body = response.json() as ErrorBody;
      expect(body.error.code).toBe("DATA_NOT_SEEDED");
    });

    it("DELETE /favorites/:ticker on an empty DB -> 503 DATA_NOT_SEEDED", async () => {
      const response = await app.inject({ method: "DELETE", url: "/favorites/AAPL" });

      expect(response.statusCode).toBe(503);
      const body = response.json() as ErrorBody;
      expect(body.error.code).toBe("DATA_NOT_SEEDED");
    });

    it("GET /favorites on an empty DB -> 200, data: [], total: 0 (never 503)", async () => {
      const response = await app.inject({ method: "GET", url: "/favorites" });

      expect(response.statusCode).toBe(200);
      const body = response.json() as Paginated<StockSummary>;
      expect(body.data).toEqual([]);
      expect(body.pagination.total).toBe(0);
    });
  });

  describe("persistence across app instances (file-backed DB)", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), "halal-stocks-be09-"));
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it("a favorite added via one app instance is visible from a fresh instance on the same DB file", async () => {
      const dbPath = join(tempDir, "test.db");

      const db1 = openDatabase(dbPath);
      createStocksRepo(db1).upsertIdentities(BASE_STOCKS);
      const app1 = buildApp({ logger: false, db: db1 });

      const postResponse = await app1.inject({ method: "POST", url: "/favorites/AAPL" });
      expect(postResponse.statusCode).toBe(201);

      await app1.close();
      db1.close();

      const db2 = openDatabase(dbPath);
      const app2 = buildApp({ logger: false, db: db2 });

      const getResponse = await app2.inject({ method: "GET", url: "/favorites" });
      expect(getResponse.statusCode).toBe(200);
      const body = getResponse.json() as Paginated<StockSummary>;
      expect(body.data.map((item) => item.ticker)).toEqual(["AAPL"]);

      await app2.close();
      db2.close();
    });
  });
});
