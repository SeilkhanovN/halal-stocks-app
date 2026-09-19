import { describe, expect, it, vi } from "vitest";
import { createFinnhubClient, parseFinnhubProfile } from "./finnhub-client.js";
import { DataSourceError } from "./data-source.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("parseFinnhubProfile", () => {
  it("maps a populated profile, converting marketCapitalization (millions) to marketCap (raw)", () => {
    const profile = parseFinnhubProfile({
      name: "Apple Inc.",
      exchange: "NASDAQ NMS - GLOBAL MARKET",
      finnhubIndustry: "Technology",
      marketCapitalization: 3000000,
    });

    expect(profile).toEqual({
      name: "Apple Inc.",
      exchange: "NASDAQ NMS - GLOBAL MARKET",
      industry: "Technology",
      marketCap: 3_000_000_000_000,
    });
  });

  it("returns null for an empty object (unknown symbol), not a zero-filled profile", () => {
    expect(parseFinnhubProfile({})).toBeNull();
  });

  it("returns null for a non-object value", () => {
    expect(parseFinnhubProfile(null)).toBeNull();
    expect(parseFinnhubProfile("nope")).toBeNull();
    expect(parseFinnhubProfile([1, 2, 3])).toBeNull();
  });

  it("maps missing/empty string fields to null without dropping the whole profile", () => {
    const profile = parseFinnhubProfile({ marketCapitalization: 0 });
    expect(profile).toEqual({ name: null, exchange: null, industry: null, marketCap: 0 });
  });
});

describe("createFinnhubClient.getProfile", () => {
  it("resolves a parsed profile on a 200 response", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        name: "Apple Inc.",
        exchange: "NASDAQ NMS - GLOBAL MARKET",
        finnhubIndustry: "Technology",
        marketCapitalization: 3000000,
      }),
    );
    const client = createFinnhubClient({ apiKey: "test-key", fetchImpl });

    const profile = await client.getProfile("AAPL");

    expect(profile).toEqual({
      name: "Apple Inc.",
      exchange: "NASDAQ NMS - GLOBAL MARKET",
      industry: "Technology",
      marketCap: 3_000_000_000_000,
    });
  });

  it("resolves null for a 200 response with an empty body", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {}));
    const client = createFinnhubClient({ apiKey: "test-key", fetchImpl });

    expect(await client.getProfile("ZZZZ")).toBeNull();
  });

  it("retries once on a 429 then succeeds, calling fetchImpl exactly twice", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, {}))
      .mockResolvedValueOnce(
        jsonResponse(200, { name: "Apple Inc.", marketCapitalization: 3000000 }),
      );
    const client = createFinnhubClient({ apiKey: "test-key", fetchImpl, retry: { baseDelayMs: 0 } });

    const profile = await client.getProfile("AAPL");

    expect(profile).not.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects with a DataSourceError after exhausting retries on repeated 500s", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, {}));
    const client = createFinnhubClient({ apiKey: "test-key", fetchImpl, retry: { baseDelayMs: 0 } });

    let caught: unknown;
    try {
      await client.getProfile("AAPL");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(DataSourceError);
    expect((caught as DataSourceError).source).toBe("finnhub");
    expect((caught as DataSourceError).ticker).toBe("AAPL");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("builds a request URL containing the normalized ticker symbol and the API key token", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(200, {}));
    const client = createFinnhubClient({ apiKey: "my-token", fetchImpl });

    await client.getProfile("aapl");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0];
    if (!call) throw new Error("expected fetchImpl to have been called");
    const [url] = call;
    expect(url).toContain("symbol=AAPL");
    expect(url).toContain("token=my-token");
  });
});
