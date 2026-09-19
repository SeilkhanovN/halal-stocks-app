// Offline DataSource backed by checked-in fixture files instead of live
// Finnhub/EDGAR calls. Reads no env vars and calls no fetch — for local dev,
// tests, and seeding without API keys. Fixture files are read synchronously
// (existsSync/readFileSync), the same style constituents.ts uses for its CSV.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeTicker } from "../lib/ticker.js";
import type { CompanyProfile, DataSource } from "./data-source.js";
import { parseFinnhubProfile } from "./finnhub-client.js";

export interface FixtureSourceConfig {
  finnhubDir?: string;
  edgarDir?: string;
}

// Resolves the default fixtures directory the same way constituents.ts
// resolves its default data directory: derived from this module's own URL,
// two levels up (src/sources -> src -> backend), so it works whether running
// from source or from dist/.
function defaultFixturesDir(subdir: "finnhub" | "edgar"): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const backendRoot = join(here, "..", "..");
  return join(backendRoot, "fixtures", subdir);
}

// Reads `<dir>/<TICKER>.json`, returning `null` when the file doesn't exist.
function readFixtureJson(dir: string, ticker: string): unknown | null {
  const path = join(dir, `${normalizeTicker(ticker)}.json`);
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8");
  return JSON.parse(text) as unknown;
}

export function createFixtureDataSource(config: FixtureSourceConfig = {}): DataSource {
  const finnhubDir = config.finnhubDir ?? defaultFixturesDir("finnhub");
  const edgarDir = config.edgarDir ?? defaultFixturesDir("edgar");

  return {
    async getProfile(ticker: string): Promise<CompanyProfile | null> {
      const raw = readFixtureJson(finnhubDir, ticker);
      if (raw === null) return null;
      // Reused from finnhub-client.ts so the "{}"-is-not-found and
      // marketCap x1e6 rules are identical between live and fixture mode.
      return parseFinnhubProfile(raw);
    },

    async getCompanyFacts(ticker: string): Promise<unknown> {
      // Returned as-is (unknown) for extractFinancials() to consume — this
      // module does no EDGAR-specific parsing itself.
      return readFixtureJson(edgarDir, ticker);
    },
  };
}
