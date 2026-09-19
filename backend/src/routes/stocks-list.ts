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
// unnoticed.
function toStockSummary(record: StockRecordWithFavorite): StockSummary {
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
