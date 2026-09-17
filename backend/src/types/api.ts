// API response shapes served by routes/. Mirrors the API contract in
// prd.md exactly (field names, orderings) and reuses HalalStatus from
// types/halal.ts rather than redefining it.

import type { HalalStatus } from "./halal.js";

export interface StockSummary {
  ticker: string;
  name: string;
  exchange: string | null;
  industry: string | null;
  halalStatus: HalalStatus;
  isFavorite: boolean;
  screenedAt: string | null;
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
}
