// `npm run seed` / `npm run seed:fixtures` — the halal-screening seed CLI
// (BE-06). Thin wrapper only: flag parsing, constructing the live/fixture
// DataSource (or none, for `--rescreen`), opening/closing the DB, wiring
// SIGINT, and mapping the returned summary to a process exit code. All
// screening/DB logic lives in lib/seed-runner.ts — this file never touches
// it directly. Mirrors seed-constituents.ts's try/catch/finally shape.
import type { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { closeDatabase, openDatabase } from "../db/connection.js";
import { createLiveDataSource, type DataSource } from "../sources/data-source.js";
import { createFixtureDataSource } from "../sources/fixture-source.js";
import { loadConstituents } from "../sources/constituents.js";
import {
  defaultFixtureDirs,
  resolveFixtureTickers,
  runSeed,
  type RunSeedOptions,
  type SeedSummary,
} from "../lib/seed-runner.js";

export interface ParsedArgsOk {
  ok: true;
  fixtures: boolean;
  force: boolean;
  rescreen: boolean;
  limit: number | null;
}

export interface ParsedArgsError {
  ok: false;
  error: string;
}

export type ParsedArgs = ParsedArgsOk | ParsedArgsError;

const LIMIT_FLAG = "--limit";
const LIMIT_FLAG_EQ = "--limit=";

// Hand-rolled flag parsing — NO new dependency. Accepts `--fixtures`,
// `--force`, `--rescreen`, and `--limit N` / `--limit=N` in any combination;
// anything else (an unknown `--flag` or a bare positional argument) is a
// fatal usage error, reported before any DB/network work.
export function parseArgs(argv: readonly string[]): ParsedArgs {
  let fixtures = false;
  let force = false;
  let rescreen = false;
  let limit: number | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;

    if (arg === "--fixtures") {
      fixtures = true;
      continue;
    }
    if (arg === "--force") {
      force = true;
      continue;
    }
    if (arg === "--rescreen") {
      rescreen = true;
      continue;
    }

    if (arg === LIMIT_FLAG || arg.startsWith(LIMIT_FLAG_EQ)) {
      let rawValue: string;
      if (arg === LIMIT_FLAG) {
        const next = argv[i + 1];
        if (next === undefined) {
          return { ok: false, error: "--limit must be a positive integer, got ''" };
        }
        rawValue = next;
        i += 1;
      } else {
        rawValue = arg.slice(LIMIT_FLAG_EQ.length);
      }

      const parsedLimit = Number(rawValue);
      if (rawValue.trim() === "" || !Number.isInteger(parsedLimit) || parsedLimit <= 0) {
        return { ok: false, error: `--limit must be a positive integer, got '${rawValue}'` };
      }
      limit = parsedLimit;
      continue;
    }

    if (arg.startsWith("--")) {
      return { ok: false, error: `Unknown flag: ${arg}` };
    }

    return { ok: false, error: `Unexpected argument: ${arg}` };
  }

  return { ok: true, fixtures, force, rescreen, limit };
}

// 130 (SIGINT) wins over a partial per-ticker failure, which itself is
// reported distinctly from a clean run.
export function exitCodeFor(summary: SeedSummary): number {
  if (summary.interrupted) return 130;
  if (summary.failures > 0) return 1;
  return 0;
}

// Builds the (dataSource, tickers) pair for a non-rescreen run. `--rescreen`
// skips this function entirely — it never constructs a DataSource, which is
// what lets it run with zero env vars and zero network. Exported so tests
// can verify the missing-env-var path throws before any fetch, without
// having to drive the full main()/SIGINT/DB wiring.
export function buildSeedInputs(
  args: Pick<ParsedArgsOk, "fixtures">,
  env: Record<string, string | undefined>,
): { dataSource: DataSource; tickers: string[] } {
  if (args.fixtures) {
    const { finnhubDir, edgarDir } = defaultFixtureDirs();
    return {
      dataSource: createFixtureDataSource(),
      tickers: resolveFixtureTickers(finnhubDir, edgarDir),
    };
  }

  // createLiveDataSource() throws synchronously — before any network call —
  // when FINNHUB_API_KEY/SEC_USER_AGENT are missing. Constructed BEFORE
  // loadConstituents() so that failure surfaces first, unambiguously
  // "before any fetch".
  const dataSource = createLiveDataSource({ env });
  const tickers = loadConstituents().map((constituent) => constituent.ticker);
  return { dataSource, tickers };
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(parsed.error);
    process.exitCode = 2;
    return;
  }

  let interrupted = false;
  const onSigint = (): void => {
    interrupted = true;
  };
  // No process.exit() here — the in-flight ticker's await chain finishes
  // naturally; the loop's next-iteration check (shouldStop) stops the run.
  process.on("SIGINT", onSigint);

  let db: DatabaseSync | undefined;
  try {
    let options: RunSeedOptions;

    if (parsed.rescreen) {
      // `--fixtures`/`--force` are ignored (not an error) here.
      db = openDatabase();
      options = {
        mode: "rescreen",
        db,
        shouldStop: () => interrupted,
        ...(parsed.limit !== null ? { limit: parsed.limit } : {}),
      };
    } else {
      const { dataSource, tickers } = buildSeedInputs(parsed, process.env);
      db = openDatabase();
      options = {
        mode: "seed",
        db,
        dataSource,
        tickers,
        force: parsed.force,
        shouldStop: () => interrupted,
        ...(parsed.limit !== null ? { limit: parsed.limit } : {}),
      };
    }

    const summary = await runSeed(options);
    process.exitCode = exitCodeFor(summary);
  } catch (error) {
    console.error(error);
    process.exitCode = 2;
  } finally {
    process.off("SIGINT", onSigint);
    if (db !== undefined) {
      closeDatabase(db);
    }
  }
}

// Only runs main() when this file is the actual CLI entry point — not when
// seed.test.ts imports parseArgs/exitCodeFor/buildSeedInputs from it. Without
// this guard, importing the module for its pure helpers would also fire off
// a real seed run (DB writes, possibly live network calls) as a side effect.
const entryUrl = process.argv[1] !== undefined ? pathToFileURL(process.argv[1]).href : undefined;
if (import.meta.url === entryUrl) {
  void main();
}
