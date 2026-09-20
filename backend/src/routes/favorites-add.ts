import type { FastifyPluginAsync } from "fastify";
import type { FavoritesRepo } from "../db/favorites-repo.js";
import type { StocksRepo } from "../db/stocks-repo.js";
import { resolveStockOrThrow } from "./stock-detail.js";

interface FavoritesAddRouteOptions {
  stocksRepo: StocksRepo;
  favoritesRepo: FavoritesRepo;
}

const favoritesAddRoute: FastifyPluginAsync<FavoritesAddRouteOptions> = async (app, opts) => {
  const { stocksRepo, favoritesRepo } = opts;

  app.post<{ Params: { ticker: string } }>(
    "/favorites/:ticker",
    async (request, reply): Promise<{ data: { ticker: string } }> => {
      // Resolve first so an unknown ticker/empty DB surfaces as 404/503
      // instead of favoritesRepo.add()'s own StockNotFoundError (a plain
      // Error that handleError would otherwise turn into a 500). Because
      // this already proved the row exists, add()'s internal
      // StockNotFoundError path is unreachable here.
      const record = resolveStockOrThrow(stocksRepo, request.params.ticker);
      const { added } = favoritesRepo.add(record.ticker);

      reply.status(added ? 201 : 200);
      return { data: { ticker: record.ticker } };
    },
  );
};

export default favoritesAddRoute;
