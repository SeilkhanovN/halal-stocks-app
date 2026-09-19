// Live client for Finnhub's `/stock/profile2` endpoint (company profile:
// name, exchange, industry, market cap). Throttled to stay under Finnhub's
// free-tier rate limit and retried on transient failures via the shared
// requestWithRetry() helper in data-source.ts.
import { createThrottle, type Throttle } from "../lib/throttle.js";
import { normalizeTicker } from "../lib/ticker.js";
import { DataSourceError, requestWithRetry, type CompanyProfile, type RetryOptions } from "./data-source.js";

export interface FinnhubClientConfig {
  apiKey: string;
  throttle?: Throttle;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  retry?: RetryOptions;
}

export interface FinnhubClient {
  getProfile(ticker: string): Promise<CompanyProfile | null>;
}

const DEFAULT_BASE_URL = "https://finnhub.io/api/v1";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

// Maps a raw `/stock/profile2` JSON body to a CompanyProfile, or `null` if
// the body isn't found data at all (Finnhub returns `{}` with a 200 status
// for an unknown symbol — checked by KEY PRESENCE, never by falsy/zero
// values, since a real profile can legitimately have e.g. marketCap 0 or an
// empty-string field). Reused as-is by fixture-source.ts so fixture mode and
// live mode parse identically.
export function parseFinnhubProfile(raw: unknown): CompanyProfile | null {
  if (!isRecord(raw)) return null;

  const hasAnyField =
    raw["name"] !== undefined ||
    raw["exchange"] !== undefined ||
    raw["finnhubIndustry"] !== undefined ||
    raw["marketCapitalization"] !== undefined;
  if (!hasAnyField) return null;

  const marketCapitalization = raw["marketCapitalization"];
  const marketCap =
    typeof marketCapitalization === "number" && Number.isFinite(marketCapitalization)
      ? marketCapitalization * 1_000_000
      : null;

  return {
    name: stringOrNull(raw["name"]),
    exchange: stringOrNull(raw["exchange"]),
    industry: stringOrNull(raw["finnhubIndustry"]),
    marketCap,
  };
}

export function createFinnhubClient(config: FinnhubClientConfig): FinnhubClient {
  const throttle = config.throttle ?? createThrottle({ limit: 55, intervalMs: 60_000 });
  const fetchImpl = config.fetchImpl ?? fetch;
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;

  return {
    async getProfile(ticker: string): Promise<CompanyProfile | null> {
      const url = `${baseUrl}/stock/profile2?symbol=${encodeURIComponent(normalizeTicker(ticker))}&token=${encodeURIComponent(config.apiKey)}`;

      const response = await requestWithRetry(
        "finnhub",
        ticker,
        () => throttle.schedule(() => fetchImpl(url)),
        config.retry,
      );

      if (!response.ok) {
        throw new DataSourceError("finnhub", ticker, `unexpected HTTP status ${response.status}`);
      }

      const raw: unknown = await response.json();
      return parseFinnhubProfile(raw);
    },
  };
}
