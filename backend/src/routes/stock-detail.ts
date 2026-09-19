import type { FastifyPluginAsync } from "fastify";
import type { StockRecordWithFavorite, StocksRepo } from "../db/stocks-repo.js";
import type { HalalScreening } from "../types/halal.js";
import type { StockDetail } from "../types/api.js";
import { AppError } from "../lib/errors.js";
import { normalizeTicker } from "../lib/ticker.js";
import { screen } from "../lib/halal-screen.js";

interface StockDetailRouteOptions {
  repo: StocksRepo;
}

// Shared by this route and stock-halal-status.ts: check order matches
// stocks-list.ts's "validate shape, then resource state" precedent —
// repo.count() === 0 (nothing seeded yet) is checked before the per-ticker
// lookup, so a specific unknown ticker on a totally empty DB tells the user
// to seed rather than claiming the stock doesn't exist.
export function resolveStockOrThrow(repo: StocksRepo, rawTicker: string): StockRecordWithFavorite {
  if (repo.count() === 0) {
    throw new AppError(
      "DATA_NOT_SEEDED",
      503,
      "No stock data yet. Run `npm run seed:constituents` in backend/.",
    );
  }

  const record = repo.getByTicker(rawTicker);
  if (record === undefined) {
    throw new AppError("STOCK_NOT_FOUND", 404, `Stock '${normalizeTicker(rawTicker)}' was not found`);
  }
  return record;
}

// Serves the stored screening verbatim when one exists — the API never
// recomputes an existing verdict; only `--rescreen` changes stored verdicts.
// When `screening` is null (an identity-only row from seed:constituents),
// there is no verdict to recompute: this builds a ScreeningInput from the
// record's own fields and calls screen() to reuse the single source of
// truth for response shape rather than hand-rolling a synthetic
// HalalScreening. Every financial input on such a row is null, so the
// result is deterministic regardless of thresholds.
export function resolveScreening(record: StockRecordWithFavorite): HalalScreening {
  return (
    record.screening ??
    screen({
      ticker: record.ticker,
      industry: record.industry,
      marketCap: record.marketCap,
      totalDebt: record.totalDebt,
      cashAndSecurities: record.cashAndSecurities,
      interestIncomeTtm: record.interestIncomeTtm,
      revenueTtm: record.revenueTtm,
      dataIssues: record.dataIssues,
    })
  );
}

// Copies exactly the 9 StockDetail fields off a DB row — no spread, so
// totalDebt/cashAndSecurities/interestIncomeTtm/revenueTtm/dataIssues/
// fetchError/cik/updatedAt can never leak into the response unnoticed.
function toStockDetail(record: StockRecordWithFavorite): StockDetail {
  return {
    ticker: record.ticker,
    name: record.name,
    exchange: record.exchange,
    industry: record.industry,
    halalStatus: record.halalStatus,
    isFavorite: record.isFavorite,
    screenedAt: record.screenedAt,
    marketCap: record.marketCap,
    screening: resolveScreening(record),
  };
}

const stockDetailRoute: FastifyPluginAsync<StockDetailRouteOptions> = async (app, opts) => {
  const { repo } = opts;

  app.get<{ Params: { ticker: string } }>(
    "/stocks/:ticker",
    async (request): Promise<{ data: StockDetail }> => {
      const record = resolveStockOrThrow(repo, request.params.ticker);
      return { data: toStockDetail(record) };
    },
  );
};

export default stockDetailRoute;
