import { useQuery } from '@tanstack/react-query'
import { fetchStockDetail } from '../api/client.ts'
import { stockKeys } from '../api/query-keys.ts'

// No `enabled` flag: StockDetailPanel only mounts when a ticker is selected,
// so there is nothing to gate. No retry override either — the global
// QueryClient default already skips retrying 4xx/503, so the 404
// (STOCK_NOT_FOUND) case isn't masked by retry spam.
export function useStockDetail(ticker: string) {
  return useQuery({
    queryKey: stockKeys.detail(ticker),
    queryFn: ({ signal }) => fetchStockDetail(ticker, signal),
  })
}
