import type { DatabaseSync, SQLInputValue, SQLOutputValue } from "node:sqlite";
import type { HalalScreening, HalalStatus } from "../types/halal.js";
import { normalizeTicker } from "../lib/ticker.js";

// Row shape stored/returned by the stocks table. Field names mirror the API
// contract's StockDetail/StockSummary shapes; reuses HalalStatus and
// HalalScreening from types/halal.ts rather than redefining them.
export interface StockRecord {
  ticker: string;
  name: string;
  exchange: string | null;
  industry: string | null;
  cik: string | null;
  marketCap: number | null;
  totalDebt: number | null;
  cashAndSecurities: number | null;
  interestIncomeTtm: number | null;
  revenueTtm: number | null;
  dataIssues: string[];
  halalStatus: HalalStatus;
  screening: HalalScreening | null;
  screenedAt: string | null;
  fetchError: string | null;
  updatedAt: string;
}

export type StockRecordWithFavorite = StockRecord & { isFavorite: boolean };

export type UpsertStockInput = Omit<StockRecord, "updatedAt">;

export interface ListStocksParams {
  page: number;
  limit: number;
  search?: string;
  status?: HalalStatus;
  favoritesOnly?: boolean;
}

// Minimal identity used by MVP-01's constituents seed (src/scripts/seed-
// constituents.ts): just enough to populate the stock universe before any
// financial/screening data source exists. Deliberately narrower than
// UpsertStockInput so seeding identities can never accidentally touch
// financials/screening columns.
export interface IdentityInput {
  ticker: string;
  name: string;
  cik: string | null;
}

export interface UpsertIdentitiesResult {
  inserted: number;
  updated: number;
  unchanged: number;
}

export interface StocksRepo {
  upsert(input: UpsertStockInput): void;
  upsertIdentities(identities: readonly IdentityInput[]): UpsertIdentitiesResult;
  getByTicker(ticker: string): StockRecordWithFavorite | undefined;
  count(): number;
  maxScreenedAt(): string | null;
  list(params: ListStocksParams): { rows: StockRecordWithFavorite[]; total: number };
}

type Row = Record<string, SQLOutputValue>;

// --- Small typed readers for turning a raw SQLite row (a null-prototype,
// untyped Record<string, SQLOutputValue>) into StockRecord's typed fields,
// without `any` and without `as` casts. Each throws with the offending
// column and ticker on a shape mismatch, so a corrupt row fails loudly
// instead of silently producing wrong data.

function readRawString(row: Row, column: string): string {
  const value = row[column];
  if (typeof value !== "string") {
    throw new Error(`Expected column '${column}' to be a string`);
  }
  return value;
}

function asString(row: Row, column: string, ticker: string): string {
  const value = row[column];
  if (typeof value !== "string") {
    throw new Error(`Expected column '${column}' to be a string for ticker '${ticker}'`);
  }
  return value;
}

function asNullableString(row: Row, column: string, ticker: string): string | null {
  const value = row[column];
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`Expected column '${column}' to be a string or null for ticker '${ticker}'`);
  }
  return value;
}

function asNullableNumber(row: Row, column: string, ticker: string): number | null {
  const value = row[column];
  if (value === null) {
    return null;
  }
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "bigint") {
    // node:sqlite only returns bigint for INTEGER columns when
    // readBigInts is enabled, which this repo never does — kept as a
    // defensive conversion rather than a silent type error.
    return Number(value);
  }
  throw new Error(`Expected column '${column}' to be a number or null for ticker '${ticker}'`);
}

function asHalalStatus(row: Row, column: string, ticker: string): HalalStatus {
  const value = row[column];
  if (value === "halal" || value === "not_halal" || value === "unknown") {
    return value;
  }
  throw new Error(`Expected column '${column}' to be a valid halal_status for ticker '${ticker}'`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseDataIssues(raw: string, ticker: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse data_issues JSON for ticker '${ticker}': ${errorMessage(error)}`, {
      cause: error,
    });
  }
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    throw new Error(`data_issues for ticker '${ticker}' is not a JSON array of strings`);
  }
  return parsed;
}

function parseScreening(raw: string | null, ticker: string): HalalScreening | null {
  if (raw === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse screening JSON for ticker '${ticker}': ${errorMessage(error)}`, {
      cause: error,
    });
  }
  // This column is only ever written by upsert() below with a HalalScreening
  // value produced by lib/halal-screen.ts's screen(), so once JSON.parse
  // succeeds the shape is trusted rather than re-validated field by field
  // (which would duplicate types/halal.ts as a runtime schema for no real
  // benefit in the MVP). The `as` cast is the unavoidable boundary between
  // JSON.parse's `unknown` and that trusted shape.
  return parsed as HalalScreening;
}

// Exported so favorites-repo.ts (and route handlers later) can map a raw
// stocks-joined row without duplicating this logic.
export function mapStockRow(row: Row, isFavorite: boolean): StockRecordWithFavorite {
  const ticker = readRawString(row, "ticker");
  return {
    ticker,
    name: asString(row, "name", ticker),
    exchange: asNullableString(row, "exchange", ticker),
    industry: asNullableString(row, "industry", ticker),
    cik: asNullableString(row, "cik", ticker),
    marketCap: asNullableNumber(row, "market_cap", ticker),
    totalDebt: asNullableNumber(row, "total_debt", ticker),
    cashAndSecurities: asNullableNumber(row, "cash_and_securities", ticker),
    interestIncomeTtm: asNullableNumber(row, "interest_income_ttm", ticker),
    revenueTtm: asNullableNumber(row, "revenue_ttm", ticker),
    dataIssues: parseDataIssues(asString(row, "data_issues", ticker), ticker),
    halalStatus: asHalalStatus(row, "halal_status", ticker),
    screening: parseScreening(asNullableString(row, "screening", ticker), ticker),
    screenedAt: asNullableString(row, "screened_at", ticker),
    fetchError: asNullableString(row, "fetch_error", ticker),
    updatedAt: asString(row, "updated_at", ticker),
    isFavorite,
  };
}

function readCount(row: Row | undefined): number {
  const value = row?.["count"];
  if (typeof value !== "number") {
    throw new Error("COUNT(*) query did not return a number");
  }
  return value;
}

// Escapes a LIKE pattern's special characters (\, %, _) with a backslash so
// the value matches literally under `ESCAPE '\'`. Must escape backslashes
// first, or a value's own backslash would be re-escaped by the % / _ steps.
function escapeLikePattern(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

interface WhereClause {
  clause: string; // "" or "WHERE ..."
  values: SQLInputValue[];
}

function buildWhereClause(params: ListStocksParams): WhereClause {
  const conditions: string[] = [];
  const values: SQLInputValue[] = [];

  if (params.status !== undefined) {
    conditions.push("s.halal_status = ?");
    values.push(params.status);
  }

  if (params.favoritesOnly === true) {
    conditions.push("f.ticker IS NOT NULL");
  }

  const search = params.search?.trim();
  if (search !== undefined && search !== "") {
    const tickerTerm = normalizeTicker(search);
    const escapedTickerTerm = escapeLikePattern(tickerTerm);
    const escapedRawTerm = escapeLikePattern(search);
    conditions.push("(s.ticker LIKE ? ESCAPE '\\' OR s.name LIKE ? ESCAPE '\\')");
    values.push(`${escapedTickerTerm}%`, `%${escapedRawTerm}%`);
  }

  const clause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return { clause, values };
}

function buildOrderClause(params: ListStocksParams): { clause: string; values: SQLInputValue[] } {
  const search = params.search?.trim();
  if (search === undefined || search === "") {
    return { clause: "ORDER BY s.ticker ASC", values: [] };
  }

  const tickerTerm = normalizeTicker(search);
  const escapedTickerTerm = escapeLikePattern(tickerTerm);
  return {
    clause:
      "ORDER BY CASE WHEN s.ticker = ? THEN 0 WHEN s.ticker LIKE ? ESCAPE '\\' THEN 1 ELSE 2 END, s.ticker ASC",
    values: [tickerTerm, `${escapedTickerTerm}%`],
  };
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer, got ${value}`);
  }
}

const STOCK_COLUMNS = `
  ticker, name, exchange, industry, cik, market_cap, total_debt,
  cash_and_securities, interest_income_ttm, revenue_ttm, data_issues,
  halal_status, screening, screened_at, fetch_error, updated_at
`;

export function createStocksRepo(db: DatabaseSync): StocksRepo {
  const upsertStmt = db.prepare(`
    INSERT INTO stocks (${STOCK_COLUMNS})
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(ticker) DO UPDATE SET
      name = excluded.name,
      exchange = excluded.exchange,
      industry = excluded.industry,
      cik = excluded.cik,
      market_cap = excluded.market_cap,
      total_debt = excluded.total_debt,
      cash_and_securities = excluded.cash_and_securities,
      interest_income_ttm = excluded.interest_income_ttm,
      revenue_ttm = excluded.revenue_ttm,
      data_issues = excluded.data_issues,
      halal_status = excluded.halal_status,
      screening = excluded.screening,
      screened_at = excluded.screened_at,
      fetch_error = excluded.fetch_error,
      updated_at = excluded.updated_at
  `);

  const getByTickerStmt = db.prepare(`
    SELECT s.*, CASE WHEN f.ticker IS NOT NULL THEN 1 ELSE 0 END AS is_favorite
    FROM stocks s
    LEFT JOIN favorites f ON f.ticker = s.ticker
    WHERE s.ticker = ?
  `);

  const countStmt = db.prepare(`SELECT COUNT(*) AS count FROM stocks`);
  const maxScreenedAtStmt = db.prepare(`SELECT MAX(screened_at) AS max_screened_at FROM stocks`);

  const selectIdentityStmt = db.prepare(`SELECT name, cik FROM stocks WHERE ticker = ?`);

  // exchange/industry/financials stay NULL, data_issues starts as
  // '["Not screened yet"]', and halal_status starts 'unknown' — a
  // constituents-only row is not yet screened. screening/screened_at/
  // fetch_error stay NULL until a screening run (BE-06) writes them.
  const insertIdentityStmt = db.prepare(`
    INSERT INTO stocks (
      ticker, name, exchange, industry, cik, market_cap, total_debt,
      cash_and_securities, interest_income_ttm, revenue_ttm, data_issues,
      halal_status, screening, screened_at, fetch_error, updated_at
    ) VALUES (?, ?, NULL, NULL, ?, NULL, NULL, NULL, NULL, NULL, '["Not screened yet"]', 'unknown', NULL, NULL, NULL, ?)
  `);

  // Only ever touches name/cik/updated_at — financials and screening columns
  // of an existing row are never written by identity re-seeding.
  const updateIdentityStmt = db.prepare(`UPDATE stocks SET name = ?, cik = ?, updated_at = ? WHERE ticker = ?`);

  function upsert(input: UpsertStockInput): void {
    const ticker = normalizeTicker(input.ticker);
    const updatedAt = new Date().toISOString();
    upsertStmt.run(
      ticker,
      input.name,
      input.exchange,
      input.industry,
      input.cik,
      input.marketCap,
      input.totalDebt,
      input.cashAndSecurities,
      input.interestIncomeTtm,
      input.revenueTtm,
      JSON.stringify(input.dataIssues),
      input.halalStatus,
      input.screening === null ? null : JSON.stringify(input.screening),
      input.screenedAt,
      input.fetchError,
      updatedAt,
    );
  }

  // Upserts a batch of bare identities (ticker/name/cik) in one transaction,
  // used by the constituents seed to populate the stock universe with no
  // external API keys. A new ticker is inserted as an unscreened 'unknown'
  // row; an existing ticker only has name/cik refreshed when they differ —
  // financials and screening are never touched. Rolls back the whole batch
  // on any error.
  function upsertIdentities(identities: readonly IdentityInput[]): UpsertIdentitiesResult {
    const updatedAt = new Date().toISOString();
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;

    db.exec("BEGIN");
    try {
      for (const identity of identities) {
        const ticker = normalizeTicker(identity.ticker);
        const existingRow = selectIdentityStmt.get(ticker);

        if (existingRow === undefined) {
          insertIdentityStmt.run(ticker, identity.name, identity.cik, updatedAt);
          inserted += 1;
          continue;
        }

        const existingName = asString(existingRow, "name", ticker);
        const existingCik = asNullableString(existingRow, "cik", ticker);
        if (existingName !== identity.name || existingCik !== identity.cik) {
          updateIdentityStmt.run(identity.name, identity.cik, updatedAt, ticker);
          updated += 1;
        } else {
          unchanged += 1;
        }
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    return { inserted, updated, unchanged };
  }

  function getByTicker(ticker: string): StockRecordWithFavorite | undefined {
    const normalized = normalizeTicker(ticker);
    const row = getByTickerStmt.get(normalized);
    if (row === undefined) {
      return undefined;
    }
    return mapStockRow(row, row["is_favorite"] === 1);
  }

  function count(): number {
    return readCount(countStmt.get());
  }

  function maxScreenedAt(): string | null {
    const row = maxScreenedAtStmt.get();
    const value = row?.["max_screened_at"];
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value !== "string") {
      throw new Error("MAX(screened_at) query did not return a string");
    }
    return value;
  }

  // The WHERE clause is built dynamically (its shape depends on which
  // filters are present), so unlike the statements above it can't be
  // prepared once up front — it's reprepared per call, sharing the same
  // builder between the COUNT and row queries so they can never diverge.
  function list(params: ListStocksParams): { rows: StockRecordWithFavorite[]; total: number } {
    assertPositiveInteger(params.page, "page");
    assertPositiveInteger(params.limit, "limit");

    const { clause: whereClause, values: whereValues } = buildWhereClause(params);
    const joinClause = "FROM stocks s LEFT JOIN favorites f ON f.ticker = s.ticker";

    const countRow = db.prepare(`SELECT COUNT(*) AS count ${joinClause} ${whereClause}`).get(...whereValues);
    const total = readCount(countRow);

    const { clause: orderClause, values: orderValues } = buildOrderClause(params);
    const offset = (params.page - 1) * params.limit;

    const rowsStmt = db.prepare(`
      SELECT s.*, CASE WHEN f.ticker IS NOT NULL THEN 1 ELSE 0 END AS is_favorite
      ${joinClause}
      ${whereClause}
      ${orderClause}
      LIMIT ? OFFSET ?
    `);
    const rawRows = rowsStmt.all(...whereValues, ...orderValues, params.limit, offset);
    const rows = rawRows.map((row) => mapStockRow(row, row["is_favorite"] === 1));

    return { rows, total };
  }

  return { upsert, upsertIdentities, getByTicker, count, maxScreenedAt, list };
}
