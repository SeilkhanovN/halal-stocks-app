import type { ListStocksParams } from './types.ts'

export const stockKeys = {
  all: ['stocks'] as const,
  list: (params: ListStocksParams) => ['stocks', 'list', params] as const,
}
