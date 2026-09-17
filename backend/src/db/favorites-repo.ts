import type { DatabaseSync, SQLOutputValue } from "node:sqlite";
import { normalizeTicker } from "../lib/ticker.js";
import { mapStockRow, type StockRecordWithFavorite } from "./stocks-repo.js";

export class StockNotFoundError extends Error {
  readonly ticker: string;

  constructor(ticker: string) {
    super(`Stock '${ticker}' was not found`);
    this.name = "StockNotFoundError";
    this.ticker = ticker;
  }
}

export interface FavoritesRepo {
  add(ticker: string): { added: boolean };
  remove(ticker: string): void;
  list(params: { page: number; limit: number }): { rows: StockRecordWithFavorite[]; total: number };
}

function readCount(row: Record<string, SQLOutputValue> | undefined): number {
  const value = row?.["count"];
  if (typeof value !== "number") {
    throw new Error("COUNT(*) query did not return a number");
  }
  return value;
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer, got ${value}`);
  }
}

export function createFavoritesRepo(db: DatabaseSync): FavoritesRepo {
  const stockExistsStmt = db.prepare(`SELECT 1 AS present FROM stocks WHERE ticker = ?`);
  const insertStmt = db.prepare(`INSERT OR IGNORE INTO favorites (ticker, created_at) VALUES (?, ?)`);
  const deleteStmt = db.prepare(`DELETE FROM favorites WHERE ticker = ?`);
  const countStmt = db.prepare(`SELECT COUNT(*) AS count FROM favorites`);
  const listStmt = db.prepare(`
    SELECT s.*
    FROM favorites f
    JOIN stocks s ON s.ticker = f.ticker
    ORDER BY f.created_at DESC, s.ticker ASC
    LIMIT ? OFFSET ?
  `);

  function add(ticker: string): { added: boolean } {
    const normalized = normalizeTicker(ticker);
    const exists = stockExistsStmt.get(normalized);
    if (exists === undefined) {
      throw new StockNotFoundError(normalized);
    }
    const result = insertStmt.run(normalized, new Date().toISOString());
    return { added: Number(result.changes) > 0 };
  }

  function remove(ticker: string): void {
    const normalized = normalizeTicker(ticker);
    deleteStmt.run(normalized);
  }

  function list(params: { page: number; limit: number }): {
    rows: StockRecordWithFavorite[];
    total: number;
  } {
    assertPositiveInteger(params.page, "page");
    assertPositiveInteger(params.limit, "limit");

    const total = readCount(countStmt.get());
    const offset = (params.page - 1) * params.limit;
    const rawRows = listStmt.all(params.limit, offset);
    const rows = rawRows.map((row) => mapStockRow(row, true));

    return { rows, total };
  }

  return { add, remove, list };
}
