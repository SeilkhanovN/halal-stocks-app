import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "./migrations.js";

// Resolves the on-disk DB path: DATABASE_PATH env var if set and non-empty,
// else <backendRoot>/data/halal-stocks.db. backendRoot is derived from this
// module's own URL, two levels up, so it resolves correctly whether running
// from source (src/db/connection.ts -> src/db -> backend) or from the built
// output (dist/db/connection.js -> dist/db -> backend).
export function resolveDatabasePath(): string {
  const envPath = process.env["DATABASE_PATH"];
  if (envPath !== undefined && envPath !== "") {
    return envPath;
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const backendRoot = join(here, "..", "..");
  return join(backendRoot, "data", "halal-stocks.db");
}

// Opens (creating if necessary) the SQLite DB at `path`, applies pragmas,
// runs pending migrations, and returns the ready-to-use handle. `":memory:"`
// is supported for tests and skips both directory creation and WAL mode
// (which don't apply to an in-memory DB).
export function openDatabase(path: string = resolveDatabasePath()): DatabaseSync {
  const isFileDb = path !== ":memory:";
  if (isFileDb) {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec("PRAGMA busy_timeout = 5000;");
    if (isFileDb) {
      db.exec("PRAGMA journal_mode = WAL;");
    }
    runMigrations(db);
  } catch (error) {
    // Don't leak the handle (and its WAL/journal files) when setup fails.
    db.close();
    throw error;
  }

  return db;
}

export function closeDatabase(db: DatabaseSync): void {
  db.close();
}
