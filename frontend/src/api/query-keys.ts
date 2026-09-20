import type { ListStocksParams } from './types.ts'

export const stockKeys = {
  all: ['stocks'] as const,
  // Prefix shared by every list query regardless of params, so a mutation can
  // patch/invalidate all cached pages/filters at once instead of hardcoding
  // this literal array in more than one place.
  lists: ['stocks', 'list'] as const,
  list: (params: ListStocksParams) => [...stockKeys.lists, params] as const,
  detail: (ticker: string) => ['stocks', 'detail', ticker] as const,
}
