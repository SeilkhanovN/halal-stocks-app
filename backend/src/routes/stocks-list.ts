import type { FastifyPluginAsync } from "fastify";
import type { StockRecordWithFavorite, StocksRepo } from "../db/stocks-repo.js";
import type { HalalStatus } from "../types/halal.js";
import {
  HALAL_STATUSES,
  isHalalStatus,
  type ListStocksQuery,
  type Paginated,
  type StockSummary,
} from "../types/api.js";
import { AppError } from "../lib/errors.js";

interface StocksListRouteOptions {
  repo: StocksRepo;
}

// Copies exactly the 7 StockSummary fields off a DB row — no spread, so a
// future column added to StockRecord can never leak into the API response
// unnoticed. Exported for reuse by favorites-list.ts, whose StockSummary
// shape is identical.
export function toStockSummary(record: StockRecordWithFavorite): StockSummary {
  return {
    ticker: record.ticker,
    name: record.name,
    exchange: record.exchange,
    industry: record.industry,
    halalStatus: record.halalStatus,
    isFavorite: record.isFavorite,
    screenedAt: record.screenedAt,
  };
}

const stocksListRoute: FastifyPluginAsync<StocksListRouteOptions> = async (app, opts) => {
  const { repo } = opts;

  app.get<{ Querystring: ListStocksQuery }>(
    "/stocks",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            // Upper bound keeps OFFSET within SQLite's 64-bit range (page=1e20
            // otherwise passes "integer" validation and fails in SQLite as a 500).
            page: { type: "integer", minimum: 1, maximum: 1_000_000, default: 1 },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 25 },
            search: { type: "string", maxLength: 50 },
            // Deliberately no `enum` here: a blank status= must mean "no
            // filter", the same way search= already behaves. Validated
            // manually below so the error shape stays VALIDATION_ERROR.
            status: { type: "string", maxLength: 20 },
            // Same rationale as status: a blank favoritesOnly= must mean "no
            // filter" (the contract's own example), so this can't be a
            // JSON-schema boolean (AJV would reject a blank string).
            // Validated manually below.
            favoritesOnly: { type: "string", maxLength: 20 },
          },
        },
      },
    },
    async (request): Promise<Paginated<StockSummary>> => {
      const { page, limit } = request.query;
      const trimmedSearch = request.query.search?.trim();
      const hasSearch = trimmedSearch !== undefined && trimmedSearch !== "";

      // Case-sensitive on purpose: unlike search/tickers (typed casually,
      // so normalized), status values come from a fixed, small set that the
      // UI's filter chips send verbatim.
      let status: HalalStatus | undefined;
      const trimmedStatus = request.query.status?.trim();
      if (trimmedStatus !== undefined && trimmedStatus !== "") {
        if (!isHalalStatus(trimmedStatus)) {
          throw new AppError(
            "VALIDATION_ERROR",
            400,
            `status must be one of: ${HALAL_STATUSES.join(", ")}`,
          );
        }
        status = trimmedStatus;
      }

      // Case-sensitive, same precedent as status above: "true" filters,
      // "false" is accepted but behaviorally identical to omitting it
      // (stocks-repo.list() only branches on `=== true`), anything else
      // (including "TRUE"/"1"/"yes") is a 400.
      let favoritesOnly: boolean | undefined;
      const trimmedFavoritesOnly = request.query.favoritesOnly?.trim();
      if (trimmedFavoritesOnly !== undefined && trimmedFavoritesOnly !== "") {
        if (trimmedFavoritesOnly === "true") {
          favoritesOnly = true;
        } else if (trimmedFavoritesOnly === "false") {
          favoritesOnly = false;
        } else {
          throw new AppError(
            "VALIDATION_ERROR",
            400,
            "favoritesOnly must be 'true' or 'false'",
          );
        }
      }

      if (repo.count() === 0) {
        throw new AppError(
          "DATA_NOT_SEEDED",
          503,
          "No stock data yet. Run `npm run seed:constituents` in backend/.",
        );
      }

      const { rows, total } = repo.list({
        page,
        limit,
        ...(hasSearch ? { search: trimmedSearch } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(favoritesOnly !== undefined ? { favoritesOnly } : {}),
      });

      return {
        data: rows.map(toStockSummary),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
        meta: { dataAsOf: repo.maxScreenedAt() },
      };
    },
  );
};

export default stocksListRoute;
