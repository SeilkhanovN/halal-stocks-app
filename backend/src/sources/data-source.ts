// Shared contract for stock-data sources (Finnhub company profile + SEC
// EDGAR companyfacts), plus the retry/error plumbing both live clients use,
// and the composition root (`createLiveDataSource`) that wires the two
// together into one `DataSource`. Fixture-mode composition lives in
// fixture-source.ts (BE-05) — this module never reads fixture files.
import { createEdgarClient, getCikForTicker, type EdgarClient } from "./edgar-client.js";
import { createFinnhubClient, type FinnhubClient } from "./finnhub-client.js";

export interface CompanyProfile {
  name: string | null;
  exchange: string | null;
  industry: string | null;
  marketCap: number | null;
}

export type DataSourceName = "finnhub" | "edgar";

export class DataSourceError extends Error {
  readonly source: DataSourceName;
  readonly ticker: string;

  constructor(source: DataSourceName, ticker: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DataSourceError";
    this.source = source;
    this.ticker = ticker;
  }
}

export interface DataSource {
  getProfile(ticker: string): Promise<CompanyProfile | null>;
  getCompanyFacts(ticker: string): Promise<unknown>;
}

export interface RetryOptions {
  maxAttempts?: number; // default 3 (TOTAL attempts, not "retries")
  baseDelayMs?: number; // default 300; backoff = baseDelayMs * 2^(attempt-1)
  sleep?: (ms: number) => Promise<void>; // default real setTimeout
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 300;

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

// Retries `attempt()` only on a network-level throw, HTTP 429, or HTTP
// >= 500. Any other status (including 404, 400, etc.) is returned as-is on
// the first try — the caller decides what a non-ok-but-non-retryable status
// means. After `maxAttempts` failed tries, throws a DataSourceError wrapping
// the last failure.
export async function requestWithRetry(
  source: DataSourceName,
  ticker: string,
  attempt: () => Promise<Response>,
  options?: RetryOptions,
): Promise<Response> {
  const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = options?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const sleep = options?.sleep ?? realSleep;

  let lastError: unknown = null;

  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber++) {
    let response: Response | null = null;
    try {
      response = await attempt();
    } catch (error) {
      lastError = error;
    }

    if (response !== null) {
      if (!isRetryableStatus(response.status)) {
        return response;
      }
      lastError = new Error(`unexpected HTTP status ${response.status}`);
    }

    if (attemptNumber < maxAttempts) {
      const delay = baseDelayMs * 2 ** (attemptNumber - 1);
      await sleep(delay);
    }
  }

  throw new DataSourceError(source, ticker, `request failed after ${maxAttempts} attempts`, {
    cause: lastError,
  });
}

// Ticker context used for DataSourceError/requestWithRetry calls that aren't
// about one specific ticker (loading the whole SEC ticker map). Exported so
// edgar-client.ts uses the same placeholder rather than inventing its own.
export const TICKER_MAP_CONTEXT = "TICKER_MAP";

// Builds the production DataSource: Finnhub for profiles, SEC EDGAR for
// companyfacts. Reads FINNHUB_API_KEY / SEC_USER_AGENT from `env` (default
// process.env) unless a client is injected (the test seam). Missing env vars
// fail fast — synchronously, before any network call — since a live source
// with no credentials can only ever produce confusing runtime errors later.
export function createLiveDataSource(options?: {
  env?: Record<string, string | undefined>;
  finnhubClient?: FinnhubClient;
  edgarClient?: EdgarClient;
}): DataSource {
  const env = options?.env ?? process.env;

  const finnhubClient = options?.finnhubClient ?? createDefaultFinnhubClient(env);
  const edgarClient = options?.edgarClient ?? createDefaultEdgarClient(env);

  let tickerMapPromise: Promise<Map<string, string>> | null = null;

  function loadTickerMapMemoized(): Promise<Map<string, string>> {
    if (tickerMapPromise === null) {
      tickerMapPromise = edgarClient.loadTickerMap().catch((error: unknown) => {
        // Reset the memo on rejection so a later call can retry instead of
        // being stuck replaying the same failed promise forever.
        tickerMapPromise = null;
        throw error;
      });
    }
    return tickerMapPromise;
  }

  return {
    getProfile(ticker: string): Promise<CompanyProfile | null> {
      return finnhubClient.getProfile(ticker);
    },
    async getCompanyFacts(ticker: string): Promise<unknown> {
      const tickerMap = await loadTickerMapMemoized();
      const cik = getCikForTicker(tickerMap, ticker);
      if (cik === null) return null;
      return edgarClient.getCompanyFacts(cik, ticker);
    },
  };
}

function createDefaultFinnhubClient(env: Record<string, string | undefined>): FinnhubClient {
  const apiKey = env["FINNHUB_API_KEY"];
  if (apiKey === undefined || apiKey === "") {
    throw new Error(
      "Missing required environment variable FINNHUB_API_KEY (needed for the live Finnhub data source)",
    );
  }
  return createFinnhubClient({ apiKey });
}

function createDefaultEdgarClient(env: Record<string, string | undefined>): EdgarClient {
  const userAgent = env["SEC_USER_AGENT"];
  if (userAgent === undefined || userAgent === "") {
    throw new Error(
      "Missing required environment variable SEC_USER_AGENT (needed for the live EDGAR data source)",
    );
  }
  return createEdgarClient({ userAgent });
}

