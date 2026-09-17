// `npm run seed:constituents` — populates the stocks table with the S&P 500
// universe from the checked-in snapshot (data/constituents/sp500.csv), with
// no external API keys and no network access. New tickers are inserted as
// unscreened 'unknown' rows; existing tickers only have name/cik refreshed.
// Financials/screening are filled in later by the halal-screening seed
// (BE-06), which this script does not touch.

import type { DatabaseSync } from "node:sqlite";
import { closeDatabase, openDatabase, resolveDatabasePath } from "../db/connection.js";
import { createStocksRepo } from "../db/stocks-repo.js";
import { loadConstituents } from "../sources/constituents.js";

let db: DatabaseSync | undefined;

try {
  db = openDatabase();
  const repo = createStocksRepo(db);

  const constituents = loadConstituents();
  const { inserted, updated, unchanged } = repo.upsertIdentities(constituents);
  const total = inserted + updated + unchanged;

  console.log(
    `Seeded S&P 500 constituents: ${total} total (${inserted} inserted, ${updated} updated, ${unchanged} unchanged) → ${resolveDatabasePath()}`,
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (db !== undefined) {
    closeDatabase(db);
  }
}
