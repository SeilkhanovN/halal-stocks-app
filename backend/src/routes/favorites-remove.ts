import type { FastifyPluginAsync } from "fastify";
import type { FavoritesRepo } from "../db/favorites-repo.js";
import type { StocksRepo } from "../db/stocks-repo.js";
import { resolveStockOrThrow } from "./stock-detail.js";

interface FavoritesRemoveRouteOptions {
  stocksRepo: StocksRepo;
  favoritesRepo: FavoritesRepo;
}

const favoritesRemoveRoute: FastifyPluginAsync<FavoritesRemoveRouteOptions> = async (app, opts) => {
  const { stocksRepo, favoritesRepo } = opts;

  app.delete<{ Params: { ticker: string } }>(
    "/favorites/:ticker",
    async (request, reply): Promise<void> => {
      // favoritesRepo.remove() is a bare DELETE that never checks stock
      // existence and never throws, so resolveStockOrThrow is the ONLY
      // source of the 404 for a ticker absent from `stocks` — without this
      // call, an unknown ticker would silently 204.
      const record = resolveStockOrThrow(stocksRepo, request.params.ticker);
      favoritesRepo.remove(record.ticker);

      reply.status(204).send();
    },
  );
};

export default favoritesRemoveRoute;
