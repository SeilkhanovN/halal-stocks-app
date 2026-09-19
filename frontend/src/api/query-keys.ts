import type { ListStocksParams } from './types.ts'

export const stockKeys = {
  all: ['stocks'] as const,
  list: (params: ListStocksParams) => ['stocks', 'list', params] as const,
  detail: (ticker: string) => ['stocks', 'detail', ticker] as const,
}
