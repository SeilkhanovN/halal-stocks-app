// All testable logic behind `npm run seed` (BE-06): fetch -> extract ->
// screen -> upsert for every ticker in scope, plus the network-free
// `--rescreen` recompute path and the fixture-ticker discovery helper used
// by `--fixtures`. Fully dependency-injected — no module-level singletons,
// no direct `process.env`/`fetch`/`console` access (a `log` callback is
// injected, default `console.log`) — so this module is exercised entirely
// via `runSeed()` against an in-memory DB and hand-written fakes in
// seed-runner.test.ts. `scripts/seed.ts` owns everything this module must
// NOT touch: argv, env, DB open/close, SIGINT, and the process exit code.
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import { createStocksRepo, type StockRecordWithFavorite } from "../db/stocks-repo.js";
import type { CompanyProfile, DataSource } from "../sources/data-source.js";
import { extractFinancials, type ExtractedFinancials } from "./edgar-extract.js";
import { screen } from "./halal-screen.js";
import { DEFAULT_SCREENING_CONFIG } from "../config/screening.js";
import type { HalalScreening, HalalStatus, ScreeningConfig, ScreeningInput } from "../types/halal.js";

export type SeedMode = "seed" | "rescreen";

interface RunSeedOptionsCommon {
  db: DatabaseSync;
  limit?: number; // positive integer; caller has already validated it
  config?: ScreeningConfig; // default DEFAULT_SCREENING_CONFIG
  now?: () => Date; // default () => new Date()
  shouldStop?: () => boolean; // default () => false; polled once per ticker, before starting it
  log?: (line: string) => void; // default console.log
}

export interface RunSeedOptionsSeed extends RunSeedOptionsCommon {
  mode: "seed";
  tickers: readonly string[]; // resolved universe, in processing order
  dataSource: DataSource;
  force?: boolean; // default false
}

export interface RunSeedOptionsRescreen extends RunSeedOptionsCommon {
  mode: "rescreen";
  // Deliberately NO `dataSource` and NO `tickers` field. The rescreen code
  // path (runRescreenMode below) is a separate function that never receives
  // a DataSource reference, so "zero data-source calls" is a COMPILE-TIME
  // property, not merely a tested behavior.
}

export type RunSeedOptions = RunSeedOptionsSeed | RunSeedOptionsRescreen;

export interface FailedTicker {
  ticker: string;
  detail: string; // e.g. "finnhub: request failed after 3 attempts"
}

export interface SeedSummary {
  mode: SeedMode;
  totalConsidered: number; // tickers/rows in scope after --limit
  processed: number; // ran through fetch(or read-stored)+screen+upsert, regardless of outcome
  skipped: number; // seed mode only: skipped by the 7-day window; 0 in rescreen mode
  failures: number; // subset of `processed` where a data source threw; always 0 in rescreen
  interrupted: boolean;
  statusCounts: { halal: number; not_halal: number; unknown: number }; // among rows written this run
  failedTickers: readonly FailedTicker[];
  distinctIndustries: readonly string[]; // sorted, deduped, non-null industries seen this run
  unmatchedDenylistEntries: readonly string[]; // prohibitedIndustries entries matching none (case-insensitive)
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const EXCLUDED_FIXTURE_FILENAME = "company_tickers_exchange.json";
const JSON_EXTENSION = ".json";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function emptyStatusCounts(): { halal: number; not_halal: number; unknown: number } {
  return { halal: 0, not_halal: 0, unknown: 0 };
}

// Case-insensitive match of every configured prohibited-industry label
// against the industries actually observed (and written) this run. See the
// module-level "industry-label mitigation" note on runSeed() for why this
// exists.
function computeUnmatchedDenylistEntries(
  config: ScreeningConfig,
  observedIndustries: ReadonlySet<string>,
): string[] {
  const lowerObserved = new Set(Array.from(observedIndustries, (industry) => industry.toLowerCase()));
  return config.prohibitedIndustries.filter((entry) => !lowerObserved.has(entry.toLowerCase()));
}

function interruptedLine(interrupted: boolean, lastTicker: string | null): string {
  if (!interrupted) return "Interrupted: no";
  return lastTicker === null
    ? "Interrupted: yes (stopped before any ticker; re-run to resume)"
    : `Interrupted: yes (stopped after ${lastTicker}; re-run to resume)`;
}

// Prints the same final block for both modes. The industry-mitigation lines
// matter more than they look: config/screening.ts's prohibitedIndustries are
// best-effort guesses at Finnhub's real `finnhubIndustry` vocabulary (see
// config/screening.ts's own comment) — nothing has verified them against a
// live response. If a real bank/insurer/etc. shows up under a DIFFERENT
// label than the denylist expects, every such company silently screens
// `halal` instead of `not_halal`, which is the worst failure mode this app
// has. This block is the only visibility into that risk; fixing the labels
// themselves is explicitly out of scope for BE-06 (see the spec).
function logSummary(summary: SeedSummary, lastTicker: string | null, log: (line: string) => void): void {
  log(`=== Seed run summary (mode: ${summary.mode}) ===`);
  log(
    `Considered: ${summary.totalConsidered}, Processed: ${summary.processed}, ` +
      `Skipped: ${summary.skipped}, Failures: ${summary.failures}`,
  );
  log(
    `Status counts: halal=${summary.statusCounts.halal}, ` +
      `not_halal=${summary.statusCounts.not_halal}, unknown=${summary.statusCounts.unknown}`,
  );
  log(
    `Distinct finnhubIndustry values observed (${summary.distinctIndustries.length}): ` +
      `${summary.distinctIndustries.join(", ")}`,
  );
  log(
    `Prohibited industries matched by zero companies this run: ${summary.unmatchedDenylistEntries.join(", ")}\n` +
      "  (zero matches is expected on a small/--limit run or the fixture set — re-check after a full,\n" +
      "   unfiltered `npm run seed` before trusting the industry denylist; if a real bank/insurer/etc.\n" +
      "   shows here with a DIFFERENT label than expected, update config/screening.ts)",
  );
  log(interruptedLine(summary.interrupted, lastTicker));
}

function isFresh(screenedAt: string | null, now: () => Date): boolean {
  if (screenedAt === null) return false;
  const parsed = Date.parse(screenedAt);
  if (Number.isNaN(parsed)) return false;
  return now().getTime() - parsed < SEVEN_DAYS_MS;
}

interface SeedPipelineResult {
  fetchError: string | null;
  status: HalalStatus;
  industry: string | null;
}

// The one-and-only per-ticker seed pipeline. Both fetches are ALWAYS
// attempted, independently, even if the other already failed. Structural
// guarantee for "a failure never stores halal": whenever fetchError !==
// null, this function unconditionally pushes at least one string into
// dataIssues, and halal-screen.ts's resolveStatus() returns "unknown"
// whenever dataIssues.length > 0 (unless business activity is prohibited,
// which forces "not_halal" — also not halal). There is no separate "if
// failed, force unknown" special case that could drift out of sync from
// that already-tested screen() behavior.
async function processSeedTicker(params: {
  ticker: string;
  existing: StockRecordWithFavorite | undefined;
  repo: ReturnType<typeof createStocksRepo>;
  dataSource: DataSource;
  config: ScreeningConfig;
  now: () => Date;
}): Promise<SeedPipelineResult> {
  const { ticker, existing, repo, dataSource, config, now } = params;

  let profile: CompanyProfile | null = null;
  let profileFailure: string | null = null;
  try {
    profile = await dataSource.getProfile(ticker);
  } catch (error) {
    profileFailure = errorMessage(error);
  }

  let rawFacts: unknown = null;
  let factsFailure: string | null = null;
  try {
    rawFacts = await dataSource.getCompanyFacts(ticker);
  } catch (error) {
    factsFailure = errorMessage(error);
  }

  const dataIssues: string[] = [];
  if (profileFailure !== null) {
    dataIssues.push("Data unavailable: finnhub error");
  }
  // profile === null (a clean not-found, not a throw) adds NOTHING extra —
  // screen()'s own null-industry/null-marketCap explanations already
  // surface that.

  const extracted: ExtractedFinancials =
    factsFailure !== null
      ? {
          totalDebt: null,
          cashAndSecurities: null,
          interestIncomeTtm: null,
          revenueTtm: null,
          asOf: { balanceSheet: null, income: null },
          issues: ["Data unavailable: edgar error"],
        }
      : rawFacts === null
        ? {
            // Exact string, matches fixture-source.test.ts's precedent for
            // "EDGAR has nothing for this company".
            totalDebt: null,
            cashAndSecurities: null,
            interestIncomeTtm: null,
            revenueTtm: null,
            asOf: { balanceSheet: null, income: null },
            issues: ["EDGAR data unavailable"],
          }
        : extractFinancials(rawFacts);
  dataIssues.push(...extracted.issues);

  const fetchErrorParts: string[] = [];
  if (profileFailure !== null) fetchErrorParts.push(`finnhub: ${profileFailure}`);
  if (factsFailure !== null) fetchErrorParts.push(`edgar: ${factsFailure}`);
  const fetchError = fetchErrorParts.length > 0 ? fetchErrorParts.join("; ") : null;

  const name = existing?.name ?? profile?.name ?? ticker;
  const cik = existing?.cik ?? null; // BE-06 never resolves CIK itself; MVP-01 owns identity
  const exchange = profile?.exchange ?? null;
  const industry = profile?.industry ?? null;
  const marketCap = profile?.marketCap ?? null;

  const screeningInput: ScreeningInput = {
    ticker,
    industry,
    marketCap,
    totalDebt: extracted.totalDebt,
    cashAndSecurities: extracted.cashAndSecurities,
    interestIncomeTtm: extracted.interestIncomeTtm,
    revenueTtm: extracted.revenueTtm,
    dataIssues,
  };
  // screen() always returns screenedAt: null (documented in
  // halal-screen.ts) — the runner stamps it, exactly once, here.
  const screening: HalalScreening = { ...screen(screeningInput, config), screenedAt: now().toISOString() };

  repo.upsert({
    ticker,
    name,
    exchange,
    industry,
    cik,
    marketCap,
    totalDebt: extracted.totalDebt,
    cashAndSecurities: extracted.cashAndSecurities,
    interestIncomeTtm: extracted.interestIncomeTtm,
    revenueTtm: extracted.revenueTtm,
    dataIssues,
    halalStatus: screening.status,
    screening,
    screenedAt: screening.screenedAt,
    fetchError,
  });

  return { fetchError, status: screening.status, industry: screening.businessActivity.industry };
}

async function runSeedMode(options: RunSeedOptionsSeed): Promise<SeedSummary> {
  const repo = createStocksRepo(options.db);
  const config = options.config ?? DEFAULT_SCREENING_CONFIG;
  const now = options.now ?? ((): Date => new Date());
  const shouldStop = options.shouldStop ?? ((): boolean => false);
  const log = options.log ?? console.log;
  const force = options.force ?? false;

  const scopedTickers = options.limit !== undefined ? options.tickers.slice(0, options.limit) : options.tickers;
  const total = scopedTickers.length;

  let processed = 0;
  let skipped = 0;
  let failures = 0;
  let interrupted = false;
  let lastTicker: string | null = null;
  const statusCounts = emptyStatusCounts();
  const failedTickers: FailedTicker[] = [];
  const distinctIndustries = new Set<string>();

  for (let i = 0; i < scopedTickers.length; i++) {
    const ticker = scopedTickers[i];
    if (ticker === undefined) continue;

    if (shouldStop()) {
      interrupted = true;
      break;
    }

    const position = i + 1;
    const existing = repo.getByTicker(ticker);

    if (!force && isFresh(existing?.screenedAt ?? null, now)) {
      skipped += 1;
      lastTicker = ticker;
      log(`[${position}/${total}] ${ticker} ... skip (screened ${existing?.screenedAt ?? "unknown"})`);
      continue;
    }

    const result = await processSeedTicker({ ticker, existing, repo, dataSource: options.dataSource, config, now });
    processed += 1;
    lastTicker = ticker;
    statusCounts[result.status] += 1;
    if (result.industry !== null) {
      distinctIndustries.add(result.industry);
    }

    if (result.fetchError !== null) {
      failures += 1;
      failedTickers.push({ ticker, detail: result.fetchError });
      log(`[${position}/${total}] ${ticker} ... FAILED (${result.fetchError}) -> stored as ${result.status}`);
    } else {
      log(`[${position}/${total}] ${ticker} ... ${result.status}`);
    }
  }

  const summary: SeedSummary = {
    mode: "seed",
    totalConsidered: total,
    processed,
    skipped,
    failures,
    interrupted,
    statusCounts,
    failedTickers,
    distinctIndustries: Array.from(distinctIndustries).sort(),
    unmatchedDenylistEntries: computeUnmatchedDenylistEntries(config, distinctIndustries),
  };

  logSummary(summary, lastTicker, log);
  return summary;
}

// `--rescreen`: recomputes every stored row's screening from its already-
// stored inputs, with NO freshness check and NO data-source call of any
// kind (this function's parameter type has no `dataSource`/`tickers` field
// at all — see RunSeedOptionsRescreen). `fetchError` is preserved verbatim:
// rescreen never fetches, so it can neither confirm nor refute a prior
// failure.
async function runRescreenMode(options: RunSeedOptionsRescreen): Promise<SeedSummary> {
  const repo = createStocksRepo(options.db);
  const config = options.config ?? DEFAULT_SCREENING_CONFIG;
  const now = options.now ?? ((): Date => new Date());
  const shouldStop = options.shouldStop ?? ((): boolean => false);
  const log = options.log ?? console.log;

  const totalRows = repo.count();
  if (totalRows === 0) {
    // Deliberately does NOT call repo.list() — list() throws on limit < 1,
    // and there is nothing to list anyway.
    return {
      mode: "rescreen",
      totalConsidered: 0,
      processed: 0,
      skipped: 0,
      failures: 0,
      interrupted: false,
      statusCounts: emptyStatusCounts(),
      failedTickers: [],
      distinctIndustries: [],
      unmatchedDenylistEntries: [],
    };
  }

  // ticker-ascending, list()'s default order.
  const allRows = repo.list({ page: 1, limit: totalRows }).rows;
  const scopedRows = options.limit !== undefined ? allRows.slice(0, options.limit) : allRows;
  const total = scopedRows.length;

  let processed = 0;
  let interrupted = false;
  let lastTicker: string | null = null;
  const statusCounts = emptyStatusCounts();
  const distinctIndustries = new Set<string>();

  for (let i = 0; i < scopedRows.length; i++) {
    const row = scopedRows[i];
    if (row === undefined) continue;

    if (shouldStop()) {
      interrupted = true;
      break;
    }

    const position = i + 1;
    const input: ScreeningInput = {
      ticker: row.ticker,
      industry: row.industry,
      marketCap: row.marketCap,
      totalDebt: row.totalDebt,
      cashAndSecurities: row.cashAndSecurities,
      interestIncomeTtm: row.interestIncomeTtm,
      revenueTtm: row.revenueTtm,
      dataIssues: row.dataIssues,
    };
    const screening: HalalScreening = { ...screen(input, config), screenedAt: now().toISOString() };

    repo.upsert({
      ticker: row.ticker,
      name: row.name,
      exchange: row.exchange,
      industry: row.industry,
      cik: row.cik,
      marketCap: row.marketCap,
      totalDebt: row.totalDebt,
      cashAndSecurities: row.cashAndSecurities,
      interestIncomeTtm: row.interestIncomeTtm,
      revenueTtm: row.revenueTtm,
      dataIssues: row.dataIssues,
      halalStatus: screening.status,
      screening,
      screenedAt: screening.screenedAt,
      fetchError: row.fetchError,
    });

    processed += 1;
    lastTicker = row.ticker;
    statusCounts[screening.status] += 1;
    if (screening.businessActivity.industry !== null) {
      distinctIndustries.add(screening.businessActivity.industry);
    }

    log(`[${position}/${total}] ${row.ticker} ... rescreened -> ${screening.status}`);
  }

  const summary: SeedSummary = {
    mode: "rescreen",
    totalConsidered: total,
    processed,
    skipped: 0,
    failures: 0,
    interrupted,
    statusCounts,
    failedTickers: [],
    distinctIndustries: Array.from(distinctIndustries).sort(),
    unmatchedDenylistEntries: computeUnmatchedDenylistEntries(config, distinctIndustries),
  };

  logSummary(summary, lastTicker, log);
  return summary;
}

export async function runSeed(options: RunSeedOptions): Promise<SeedSummary> {
  if (options.mode === "rescreen") {
    return runRescreenMode(options);
  }
  return runSeedMode(options);
}

// Resolves the default fixtures directories the same way fixture-source.ts
// resolves them internally (derived from this module's own URL, two levels
// up: src/lib -> src -> backend). fixture-source.ts does not export its own
// defaultFixturesDir() helper; rather than adding an export to a file
// outside this task's manifest, this duplicates the same idiom
// constituents.ts and fixture-source.ts each already use independently.
export function defaultFixtureDirs(): { finnhubDir: string; edgarDir: string } {
  const here = dirname(fileURLToPath(import.meta.url));
  const backendRoot = join(here, "..", "..");
  return {
    finnhubDir: join(backendRoot, "fixtures", "finnhub"),
    edgarDir: join(backendRoot, "fixtures", "edgar"),
  };
}

function listFixtureTickers(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    // A missing fixtures dir yields an empty list, never throws.
    return [];
  }
  return entries
    .filter((name) => name.endsWith(JSON_EXTENSION) && name !== EXCLUDED_FIXTURE_FILENAME)
    .map((name) => name.slice(0, -JSON_EXTENSION.length));
}

// Reads *.json filenames from both fixture dirs (excluding the SEC ticker
// map snapshot), unions the two sets, sorts. Deliberately does NOT filter
// through isValidTicker() — "NO_INTEREST" (11 chars, contains "_") fails
// that real-ticker pattern but must still be included; a constituents-driven
// list would silently miss it (it's not an S&P 500 member).
export function resolveFixtureTickers(finnhubDir: string, edgarDir: string): string[] {
  const union = new Set([...listFixtureTickers(finnhubDir), ...listFixtureTickers(edgarDir)]);
  return Array.from(union).sort();
}
