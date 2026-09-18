import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { fetchStocks } from '../api/client.ts'
import { stockKeys } from '../api/query-keys.ts'
import type { ListStocksParams } from '../api/types.ts'

export function useStocks(params: ListStocksParams) {
  return useQuery({
    queryKey: stockKeys.list(params),
    queryFn: ({ signal }) => fetchStocks(params, signal),
    placeholderData: keepPreviousData,
  })
}
