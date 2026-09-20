// API response shapes served by routes/. Mirrors the API contract in
// prd.md exactly (field names, orderings) and reuses HalalStatus from
// types/halal.ts rather than redefining it.

import type { HalalScreening, HalalStatus } from "./halal.js";

export interface StockSummary {
  ticker: string;
  name: string;
  exchange: string | null;
  industry: string | null;
  halalStatus: HalalStatus;
  isFavorite: boolean;
  screenedAt: string | null;
}

// GET /stocks/:ticker's response shape: every StockSummary field plus
// marketCap and the full screening breakdown (also served standalone by
// GET /stocks/:ticker/halal-status).
export interface StockDetail extends StockSummary {
  marketCap: number | null;
  screening: HalalScreening;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  data: T[];
  pagination: PaginationMeta;
  meta: { dataAsOf: string | null }; // max(screenedAt) across stocks
}

export interface ListStocksQuery {
  page: number;
  limit: number;
  search?: string;
  status?: string; // raw, unvalidated — the route validates against HALAL_STATUSES
  favoritesOnly?: string; // raw, unvalidated — the route validates 'true'/'false'
}

// Single source of truth for the three halal-status literals a caller may
// filter by. Deliberately not enforced via a JSON-schema `enum` in the
// route (a blank status= must mean "no filter", same as search=) — the
// route validates against this at runtime instead.
export const HALAL_STATUSES: readonly HalalStatus[] = ["halal", "not_halal", "unknown"];

export function isHalalStatus(value: string): value is HalalStatus {
  return (HALAL_STATUSES as readonly string[]).includes(value);
}
