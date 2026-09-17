import type { DatabaseSync } from "node:sqlite";
import { buildApp } from "./app.js";
import { closeDatabase, openDatabase, resolveDatabasePath } from "./db/connection.js";
import { createStocksRepo } from "./db/stocks-repo.js";

function resolvePort(): number {
  const raw = process.env.PORT;
  if (raw === undefined || raw === "") {
    return 3000;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`Invalid PORT value: "${raw}"`);
  }

  return parsed;
}

async function start(): Promise<void> {
  const dbPath = resolveDatabasePath();

  let db: DatabaseSync;
  try {
    db = openDatabase(dbPath);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }

  const app = buildApp({ db });
  app.log.info({ dbPath }, "using database");

  if (createStocksRepo(db).count() === 0) {
    app.log.warn("stocks table is empty — run `npm run seed:constituents`");
  }

  // Guards against SIGINT/SIGTERM both firing (or the same signal firing
  // twice) and trying to close the app/DB more than once.
  let shuttingDown = false;
  async function shutdown(): Promise<void> {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    let exitCode = 0;
    try {
      await app.close();
      closeDatabase(db);
    } catch (err) {
      app.log.error(err, "error during shutdown");
      exitCode = 1;
    } finally {
      process.exit(exitCode);
    }
  }
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  try {
    const port = resolvePort();
    await app.listen({ port, host: "0.0.0.0" });
  } catch (err) {
    app.log.error(err);
    closeDatabase(db);
    process.exit(1);
  }
}

void start();
