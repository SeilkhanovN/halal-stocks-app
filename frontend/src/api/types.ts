// Frontend copy of the API response/request shapes served by the backend.
// Deliberately duplicated (no shared package between frontend/ and
// backend/) — mirrors backend/src/types/api.ts and
// backend/src/types/halal.ts field-for-field. Keep in sync by hand.

export type HalalStatus = 'halal' | 'not_halal' | 'unknown'

export interface StockSummary {
  ticker: string
  name: string
  exchange: string | null
  industry: string | null
  halalStatus: HalalStatus
  isFavorite: boolean
  screenedAt: string | null
}

export interface PaginationMeta {
  page: number
  limit: number
  total: number
  totalPages: number
}

export interface Paginated<T> {
  data: T[]
  pagination: PaginationMeta
  meta: { dataAsOf: string | null } // max(screenedAt) across stocks
}

export interface ApiErrorBody {
  error: {
    code: string
    message: string
  }
}

export interface ListStocksParams {
  page?: number
  limit?: number
  search?: string
}
