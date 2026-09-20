import Fastify, { type FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import healthRoute from "./routes/health.js";
import stocksListRoute from "./routes/stocks-list.js";
import stockDetailRoute from "./routes/stock-detail.js";
import stockHalalStatusRoute from "./routes/stock-halal-status.js";
import favoritesListRoute from "./routes/favorites-list.js";
import favoritesAddRoute from "./routes/favorites-add.js";
import favoritesRemoveRoute from "./routes/favorites-remove.js";
import { formatError, handleError } from "./lib/errors.js";
import { createStocksRepo } from "./db/stocks-repo.js";
import { createFavoritesRepo } from "./db/favorites-repo.js";

export interface BuildAppOptions {
  logger?: boolean;
  db?: DatabaseSync;
}

export function buildApp(opts: BuildAppOptions = {}): FastifyInstance {
  const { logger = true, db } = opts;

  const app = Fastify({ logger });

  app.setErrorHandler(handleError);

  app.setNotFoundHandler((request, reply) => {
    reply
      .status(404)
      .send(
        formatError(
          "NOT_FOUND",
          `Route ${request.method} ${request.url} not found`,
        ),
      );
  });

  app.register(healthRoute);

  // /stocks* routes are only registered when a DB is injected — without one,
  // they fall through to the 404 handler above, matching BuildAppOptions'
  // "db is optional" contract (health-only usage stays test-friendly). One
  // shared repo is hoisted here rather than calling createStocksRepo(db)
  // once per route, avoiding three separate prepared-statement sets.
  if (db !== undefined) {
    const repo = createStocksRepo(db);
    app.register(stocksListRoute, { repo });
    app.register(stockDetailRoute, { repo });
    app.register(stockHalalStatusRoute, { repo });

    const favoritesRepo = createFavoritesRepo(db);
    app.register(favoritesListRoute, { stocksRepo: repo, favoritesRepo });
    app.register(favoritesAddRoute, { stocksRepo: repo, favoritesRepo });
    app.register(favoritesRemoveRoute, { stocksRepo: repo, favoritesRepo });
  }

  return app;
}
