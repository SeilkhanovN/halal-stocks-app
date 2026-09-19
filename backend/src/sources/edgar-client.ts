// Live client for two SEC EDGAR endpoints: the ticker->CIK map
// (company_tickers_exchange.json) and per-company "companyfacts" JSON
// (data.sec.gov/api/xbrl/companyfacts/CIK##########.json). Every request
// carries the caller-supplied User-Agent verbatim (SEC requires a real one;
// rejecting an empty one is createLiveDataSource's job, done before this
// client is ever constructed) and goes through the shared throttle +
// requestWithRetry() pattern used by finnhub-client.ts.
import { createThrottle, type Throttle } from "../lib/throttle.js";
import { normalizeTicker } from "../lib/ticker.js";
import { DataSourceError, requestWithRetry, TICKER_MAP_CONTEXT, type RetryOptions } from "./data-source.js";

export interface EdgarClientConfig {
  userAgent: string;
  throttle?: Throttle;
  fetchImpl?: typeof fetch;
  tickerMapUrl?: string;
  companyFactsBaseUrl?: string;
  retry?: RetryOptions;
}

export interface EdgarClient {
  loadTickerMap(): Promise<Map<string, string>>;
  getCompanyFacts(cik: string, ticker: string): Promise<unknown>;
}

const DEFAULT_TICKER_MAP_URL = "https://www.sec.gov/files/company_tickers_exchange.json";
const DEFAULT_COMPANY_FACTS_BASE_URL = "https://data.sec.gov/api/xbrl/companyfacts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Parses the real SEC `company_tickers_exchange.json` shape
// (`{ fields: string[], data: unknown[][] }`) into a
// normalizedTicker -> 10-digit CIK map. Columns are found BY NAME, not fixed
// position, mirroring constituents.ts's header-lookup convention. Unknown
// top-level keys (e.g. a fixture's `_note`) are ignored. Malformed input
// degrades to an empty map rather than throwing.
export function parseTickerMap(raw: unknown): Map<string, string> {
  const map = new Map<string, string>();
  if (!isRecord(raw)) return map;

  const fields = raw["fields"];
  const data = raw["data"];
  if (!Array.isArray(fields) || !Array.isArray(data)) return map;

  const tickerIndex = fields.findIndex((field) => field === "ticker");
  const cikIndex = fields.findIndex((field) => field === "cik");
  if (tickerIndex === -1 || cikIndex === -1) return map;

  for (const row of data) {
    if (!Array.isArray(row)) continue;
    const rawTicker = row[tickerIndex];
    const rawCik = row[cikIndex];
    if (typeof rawTicker !== "string" || rawTicker === "") continue;
    if (rawCik === undefined || rawCik === null) continue;

    const cik = String(rawCik).padStart(10, "0");
    map.set(normalizeTicker(rawTicker), cik);
  }

  return map;
}

// Because both the map's keys and this lookup are normalized the same way
// (normalizeTicker), "BRK.B" and "BRK-B" resolve to the same CIK regardless
// of which form SEC's raw data used.
export function getCikForTicker(map: ReadonlyMap<string, string>, ticker: string): string | null {
  return map.get(normalizeTicker(ticker)) ?? null;
}

export function createEdgarClient(config: EdgarClientConfig): EdgarClient {
  const throttle = config.throttle ?? createThrottle({ limit: 8, intervalMs: 1_000 });
  const fetchImpl = config.fetchImpl ?? fetch;
  const tickerMapUrl = config.tickerMapUrl ?? DEFAULT_TICKER_MAP_URL;
  const companyFactsBaseUrl = config.companyFactsBaseUrl ?? DEFAULT_COMPANY_FACTS_BASE_URL;
  const headers = { "User-Agent": config.userAgent };

  return {
    async loadTickerMap(): Promise<Map<string, string>> {
      const response = await requestWithRetry(
        "edgar",
        TICKER_MAP_CONTEXT,
        () => throttle.schedule(() => fetchImpl(tickerMapUrl, { headers })),
        config.retry,
      );

      if (!response.ok) {
        throw new DataSourceError("edgar", TICKER_MAP_CONTEXT, `unexpected HTTP status ${response.status}`);
      }

      const raw: unknown = await response.json();
      return parseTickerMap(raw);
    },

    async getCompanyFacts(cik: string, ticker: string): Promise<unknown> {
      const url = `${companyFactsBaseUrl}/CIK${cik}.json`;

      const response = await requestWithRetry(
        "edgar",
        ticker,
        () => throttle.schedule(() => fetchImpl(url, { headers })),
        config.retry,
      );

      // 404 = "SEC has no companyfacts for this CIK" — not an error, just a
      // not-found result. No retry (429/5xx are the only retryable statuses
      // and requestWithRetry already returns any other status immediately).
      if (response.status === 404) return null;

      if (!response.ok) {
        throw new DataSourceError("edgar", ticker, `unexpected HTTP status ${response.status}`);
      }

      return response.json();
    },
  };
}
