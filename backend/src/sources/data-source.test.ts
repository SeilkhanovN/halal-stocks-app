import { describe, expect, it, vi } from "vitest";
import { createLiveDataSource, DataSourceError, requestWithRetry, type CompanyProfile } from "./data-source.js";
import type { FinnhubClient } from "./finnhub-client.js";
import type { EdgarClient } from "./edgar-client.js";

describe("DataSourceError", () => {
  it("carries source and ticker, and is a real Error", () => {
    const error = new DataSourceError("finnhub", "AAPL", "boom");
    expect(error).toBeInstanceOf(Error);
    expect(error.source).toBe("finnhub");
    expect(error.ticker).toBe("AAPL");
    expect(error.message).toBe("boom");
  });
});

describe("requestWithRetry", () => {
  it("returns the response immediately on a non-retryable status without retrying", async () => {
    const attempt = vi.fn(async () => new Response(null, { status: 404 }));
    const response = await requestWithRetry("finnhub", "AAPL", attempt);
    expect(response.status).toBe(404);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("retries on a network-level throw and eventually throws DataSourceError", async () => {
    const attempt = vi.fn(async () => {
      throw new Error("network down");
    });
    await expect(
      requestWithRetry("edgar", "AAPL", attempt, { baseDelayMs: 0, maxAttempts: 2 }),
    ).rejects.toThrow(DataSourceError);
    expect(attempt).toHaveBeenCalledTimes(2);
  });
});

describe("createLiveDataSource", () => {
  it("throws synchronously mentioning FINNHUB_API_KEY when it's missing", () => {
    expect(() => createLiveDataSource({ env: {} })).toThrow(/FINNHUB_API_KEY/);
  });

  it("throws synchronously mentioning SEC_USER_AGENT when FINNHUB_API_KEY is set but SEC_USER_AGENT is missing", () => {
    expect(() => createLiveDataSource({ env: { FINNHUB_API_KEY: "x" } })).toThrow(/SEC_USER_AGENT/);
  });

  function fakeFinnhubClient(profile: CompanyProfile | null): FinnhubClient {
    return {
      getProfile: vi.fn(async () => profile),
    };
  }

  function fakeEdgarClient(
    tickerMap: Map<string, string>,
    facts: Record<string, unknown>,
  ): { client: EdgarClient; loadTickerMap: ReturnType<typeof vi.fn>; getCompanyFacts: ReturnType<typeof vi.fn> } {
    const loadTickerMap = vi.fn(async () => tickerMap);
    const getCompanyFacts = vi.fn(async (cik: string) => facts[cik] ?? null);
    return { client: { loadTickerMap, getCompanyFacts }, loadTickerMap, getCompanyFacts };
  }

  it("getProfile delegates straight to the injected finnhubClient", async () => {
    const profile: CompanyProfile = { name: "Apple Inc.", exchange: "Nasdaq", industry: "Technology", marketCap: 1 };
    const finnhubClient = fakeFinnhubClient(profile);
    const { client: edgarClient } = fakeEdgarClient(new Map(), {});
    const dataSource = createLiveDataSource({ finnhubClient, edgarClient });

    await expect(dataSource.getProfile("AAPL")).resolves.toEqual(profile);
    expect(finnhubClient.getProfile).toHaveBeenCalledWith("AAPL");
  });

  it("getCompanyFacts resolves the CIK via loadTickerMap() then calls edgarClient.getCompanyFacts(cik, ticker)", async () => {
    const tickerMap = new Map([["AAPL", "0000320193"]]);
    const { client: edgarClient, getCompanyFacts } = fakeEdgarClient(tickerMap, {
      "0000320193": { facts: "aapl-facts" },
    });
    const dataSource = createLiveDataSource({ finnhubClient: fakeFinnhubClient(null), edgarClient });

    const result = await dataSource.getCompanyFacts("AAPL");

    expect(result).toEqual({ facts: "aapl-facts" });
    expect(getCompanyFacts).toHaveBeenCalledWith("0000320193", "AAPL");
  });

  it("resolves null without calling getCompanyFacts when the ticker has no CIK entry", async () => {
    const { client: edgarClient, getCompanyFacts } = fakeEdgarClient(new Map(), {});
    const dataSource = createLiveDataSource({ finnhubClient: fakeFinnhubClient(null), edgarClient });

    const result = await dataSource.getCompanyFacts("ZZZZ");

    expect(result).toBeNull();
    expect(getCompanyFacts).not.toHaveBeenCalled();
  });

  it("memoizes loadTickerMap() across multiple getCompanyFacts calls", async () => {
    const tickerMap = new Map([
      ["AAPL", "0000320193"],
      ["JPM", "0000019617"],
    ]);
    const { client: edgarClient, loadTickerMap } = fakeEdgarClient(tickerMap, {
      "0000320193": { facts: "aapl" },
      "0000019617": { facts: "jpm" },
    });
    const dataSource = createLiveDataSource({ finnhubClient: fakeFinnhubClient(null), edgarClient });

    await dataSource.getCompanyFacts("AAPL");
    await dataSource.getCompanyFacts("JPM");

    expect(loadTickerMap).toHaveBeenCalledTimes(1);
  });
});
