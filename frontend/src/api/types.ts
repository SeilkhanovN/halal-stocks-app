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
  status?: HalalStatus
  favoritesOnly?: boolean
}

export type RatioKey = 'debtToMarketCap' | 'cashAndSecuritiesToMarketCap' | 'interestIncomeToRevenue'

export interface RatioResult {
  key: RatioKey
  label: string // e.g. "Debt / market cap"
  value: number | null // fraction, e.g. 0.123; null = not computable
  threshold: number // fraction, e.g. 0.30
  breached: boolean | null // null when value is null
  explanation: string // plain language, e.g. "12.3% is below the 30% limit."
}

export interface HalalScreening {
  status: HalalStatus
  methodology: 'AAOIFI'
  screenedAt: string | null // ISO timestamp; stamped at persistence (BE-06)
  businessActivity: {
    industry: string | null
    prohibited: boolean | null
    explanation: string
  }
  ratios: RatioResult[] // always all three, in RatioKey order
  reasons: string[] // why this status, plain language
}

// GET /stocks/:ticker's response shape: every StockSummary field plus
// marketCap and the full screening breakdown (also served standalone by
// GET /stocks/:ticker/halal-status).
export interface StockDetail extends StockSummary {
  marketCap: number | null
  screening: HalalScreening
}
