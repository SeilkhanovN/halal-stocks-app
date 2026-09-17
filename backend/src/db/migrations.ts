import type { DatabaseSync, SQLOutputValue } from "node:sqlite";

// One migration = one schema version, applied in full inside a single
// transaction. `up` is a list of DDL statements run in order.
export interface Migration {
  version: number;
  up: readonly string[];
}

// The DDL below intentionally matches the API contract's field names 1:1
// (snake_case columns map to the camelCase StockRecord fields in
// stocks-repo.ts) so the mapping stays obvious to read.
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    up: [
      `CREATE TABLE stocks (
        ticker TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        exchange TEXT,
        industry TEXT,
        cik TEXT,
        market_cap REAL,
        total_debt REAL,
        cash_and_securities REAL,
        interest_income_ttm REAL,
        revenue_ttm REAL,
        data_issues TEXT NOT NULL DEFAULT '[]',
        halal_status TEXT NOT NULL CHECK (halal_status IN ('halal','not_halal','unknown')),
        screening TEXT,
        screened_at TEXT,
        fetch_error TEXT,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE favorites (
        ticker TEXT PRIMARY KEY NOT NULL REFERENCES stocks(ticker) ON DELETE CASCADE,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_stocks_halal_status ON stocks(halal_status)`,
      `CREATE INDEX idx_stocks_name_nocase ON stocks(name COLLATE NOCASE)`,
      `CREATE INDEX idx_favorites_created_at ON favorites(created_at)`,
    ],
  },
];

export const CURRENT_SCHEMA_VERSION: number = MIGRATIONS.reduce(
  (max, migration) => Math.max(max, migration.version),
  0,
);

function readUserVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get();
  const value: SQLOutputValue | undefined = row?.["user_version"];
  if (typeof value !== "number") {
    throw new Error("PRAGMA user_version did not return a number");
  }
  return value;
}

// PRAGMA statements don't accept bound (`?`) parameters in SQLite, so the
// version is interpolated directly. This is safe: `version` always comes
// from the hardcoded MIGRATIONS array above, never from user input.
function setUserVersion(db: DatabaseSync, version: number): void {
  db.exec(`PRAGMA user_version = ${version}`);
}

function withTransaction(db: DatabaseSync, fn: () => void): void {
  db.exec("BEGIN");
  try {
    fn();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

// Applies every migration with version > the DB's current user_version, in
// ascending order, each inside its own BEGIN/COMMIT (with ROLLBACK on
// error). A no-op (no transaction opened at all) when the DB is already at
// CURRENT_SCHEMA_VERSION — safe to call on every startup.
export function runMigrations(db: DatabaseSync): void {
  const currentVersion = readUserVersion(db);
  const pending = MIGRATIONS.filter((migration) => migration.version > currentVersion).sort(
    (a, b) => a.version - b.version,
  );

  for (const migration of pending) {
    withTransaction(db, () => {
      for (const statement of migration.up) {
        db.exec(statement);
      }
      setUserVersion(db, migration.version);
    });
  }
}
