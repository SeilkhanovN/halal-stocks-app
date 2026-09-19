import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { createEdgarClient, getCikForTicker, parseTickerMap } from "./edgar-client.js";
import { DataSourceError, TICKER_MAP_CONTEXT } from "./data-source.js";

const here = dirname(fileURLToPath(import.meta.url));
const tickerMapFixturePath = join(here, "..", "..", "fixtures", "edgar", "company_tickers_exchange.json");
const tickerMapFixture: unknown = JSON.parse(readFileSync(tickerMapFixturePath, "utf8"));

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

function notFoundResponse(): Response {
  return new Response(null, { status: 404 });
}

describe("parseTickerMap / getCikForTicker", () => {
  it("parses the fixture's {fields, data} shape into a normalizedTicker -> 10-digit CIK map", () => {
    const map = parseTickerMap(tickerMapFixture);
    expect(getCikForTicker(map, "AAPL")).toBe("0000320193");
  });

  it("resolves BRK-B and BRK.B to the same CIK", () => {
    const map = parseTickerMap(tickerMapFixture);
    expect(getCikForTicker(map, "BRK-B")).toBe(getCikForTicker(map, "BRK.B"));
    expect(getCikForTicker(map, "BRK-B")).not.toBeNull();
  });

  it("returns null for a ticker not in the map", () => {
    const map = parseTickerMap(tickerMapFixture);
    expect(getCikForTicker(map, "ZZZZ")).toBeNull();
  });

  it("ignores unknown top-level keys like _note", () => {
    const map = parseTickerMap(tickerMapFixture);
    expect(map.size).toBeGreaterThan(0);
  });

  it("degrades to an empty map on malformed input", () => {
    expect(parseTickerMap(null).size).toBe(0);
    expect(parseTickerMap({ fields: ["ticker"] }).size).toBe(0);
  });
});

describe("createEdgarClient", () => {
  it("loadTickerMap() parses the fetched JSON into a usable Map", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, tickerMapFixture));
    const client = createEdgarClient({ userAgent: "test-agent (test@example.com)", fetchImpl });

    const map = await client.loadTickerMap();

    expect(getCikForTicker(map, "AAPL")).toBe("0000320193");
  });

  it("sends the configured User-Agent header verbatim on every request", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, tickerMapFixture))
      .mockResolvedValueOnce(jsonResponse(200, { facts: {} }));
    const client = createEdgarClient({ userAgent: "halal-stocks-app test@example.com", fetchImpl });

    await client.loadTickerMap();
    await client.getCompanyFacts("0000320193", "AAPL");

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const call of fetchImpl.mock.calls) {
      const init = call[1] as RequestInit;
      expect(init.headers).toEqual({ "User-Agent": "halal-stocks-app test@example.com" });
    }
  });

  it("getCompanyFacts resolves null on a 404, without throwing or retrying", async () => {
    const fetchImpl = vi.fn(async () => notFoundResponse());
    const client = createEdgarClient({ userAgent: "test-agent", fetchImpl });

    const result = await client.getCompanyFacts("0000000000", "ZZZZ");

    expect(result).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("getCompanyFacts retries once on a 429 then succeeds, calling fetchImpl exactly twice", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, {}))
      .mockResolvedValueOnce(jsonResponse(200, { facts: {} }));
    const client = createEdgarClient({ userAgent: "test-agent", fetchImpl, retry: { baseDelayMs: 0 } });

    const result = await client.getCompanyFacts("0000320193", "AAPL");

    expect(result).toEqual({ facts: {} });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("loadTickerMap rejects with a DataSourceError carrying TICKER_MAP_CONTEXT (not a real ticker) after exhausting retries on repeated 500s", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, {}));
    const client = createEdgarClient({ userAgent: "test-agent", fetchImpl, retry: { baseDelayMs: 0 } });

    let caught: unknown;
    try {
      await client.loadTickerMap();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(DataSourceError);
    expect((caught as DataSourceError).source).toBe("edgar");
    expect((caught as DataSourceError).ticker).toBe(TICKER_MAP_CONTEXT);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("getCompanyFacts rejects with a DataSourceError after exhausting retries on repeated 500s", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, {}));
    const client = createEdgarClient({ userAgent: "test-agent", fetchImpl, retry: { baseDelayMs: 0 } });

    let caught: unknown;
    try {
      await client.getCompanyFacts("0000320193", "AAPL");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(DataSourceError);
    expect((caught as DataSourceError).source).toBe("edgar");
    expect((caught as DataSourceError).ticker).toBe("AAPL");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
