import type { FastifyPluginAsync } from "fastify";
import type { FavoritesRepo } from "../db/favorites-repo.js";
import type { StocksRepo } from "../db/stocks-repo.js";
import type { Paginated, StockSummary } from "../types/api.js";
import { toStockSummary } from "./stocks-list.js";

interface FavoritesListRouteOptions {
  stocksRepo: StocksRepo;
  favoritesRepo: FavoritesRepo;
}

interface FavoritesListQuery {
  page: number;
  limit: number;
}

const favoritesListRoute: FastifyPluginAsync<FavoritesListRouteOptions> = async (app, opts) => {
  const { stocksRepo, favoritesRepo } = opts;

  app.get<{ Querystring: FavoritesListQuery }>(
    "/favorites",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            // Same bounds/overflow guard as GET /stocks — see that route's
            // comment on why page needs an explicit upper bound.
            page: { type: "integer", minimum: 1, maximum: 1_000_000, default: 1 },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 25 },
          },
        },
      },
    },
    async (request): Promise<Paginated<StockSummary>> => {
      const { page, limit } = request.query;

      // Deliberately no repo.count() === 0 check (unlike GET /stocks): an
      // empty favorites list is a normal state (nothing starred yet) even on
      // a fully-seeded DB, and when `stocks` itself is empty the favorites
      // FK guarantees favorites is empty too — 200 with an empty page is
      // simply correct here. GET /stocks already tells the user to seed.
      const { rows, total } = favoritesRepo.list({ page, limit });

      return {
        data: rows.map(toStockSummary),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
        meta: { dataAsOf: stocksRepo.maxScreenedAt() },
      };
    },
  );
};

export default favoritesListRoute;
