import type { FastifyPluginAsync } from "fastify";
import type { StocksRepo } from "../db/stocks-repo.js";
import type { HalalScreening } from "../types/halal.js";
import { resolveScreening, resolveStockOrThrow } from "./stock-detail.js";

interface StockHalalStatusRouteOptions {
  repo: StocksRepo;
}

const stockHalalStatusRoute: FastifyPluginAsync<StockHalalStatusRouteOptions> = async (app, opts) => {
  const { repo } = opts;

  app.get<{ Params: { ticker: string } }>(
    "/stocks/:ticker/halal-status",
    async (request): Promise<{ data: HalalScreening }> => {
      const record = resolveStockOrThrow(repo, request.params.ticker);
      return { data: resolveScreening(record) };
    },
  );
};

export default stockHalalStatusRoute;
