import { useMutation, useQueryClient } from '@tanstack/react-query'
import { addFavorite, removeFavorite } from '../api/client.ts'
import { stockKeys } from '../api/query-keys.ts'
import type { Paginated, StockDetail, StockSummary } from '../api/types.ts'

export interface ToggleFavoriteVariables {
  ticker: string
  nextIsFavorite: boolean
}

interface ToggleFavoriteContext {
  previousLists: [readonly unknown[], Paginated<StockSummary> | undefined][]
  previousDetail: StockDetail | undefined
  ticker: string
}

// No `retry` override here on purpose: TanStack v5 mutations already default
// to 0 retries (unlike queries, whose global default is overridden via
// shouldRetryQuery), so this is exactly what exercises the rollback path.
export function useToggleFavorite() {
  const queryClient = useQueryClient()

  return useMutation<{ ticker: string } | void, Error, ToggleFavoriteVariables, ToggleFavoriteContext>({
    mutationFn: ({ ticker, nextIsFavorite }) =>
      nextIsFavorite ? addFavorite(ticker) : removeFavorite(ticker),

    onMutate: async ({ ticker, nextIsFavorite }) => {
      await queryClient.cancelQueries({ queryKey: stockKeys.all })

      const previousLists = queryClient.getQueriesData<Paginated<StockSummary>>({
        queryKey: stockKeys.lists,
      })
      const previousDetail = queryClient.getQueryData<StockDetail>(stockKeys.detail(ticker))

      // Patch every cached list query, not just the active one — a ticker can
      // sit in several cached pages/filters at once (unfiltered page 1, a
      // status-filtered view, a favoritesOnly view, an older page), and
      // staleTime: 30s means TanStack serves any of them from cache instantly
      // on remount with no refetch. Patch in place only; NEVER remove the row
      // here — even when the active query is favoritesOnly=true and
      // nextIsFavorite is false — so the row doesn't vanish under the user's
      // cursor mid-click. Removal happens only once onSettled's refetch comes
      // back without it.
      queryClient.setQueriesData<Paginated<StockSummary>>({ queryKey: stockKeys.lists }, (old) => {
        if (!old) return old
        return {
          ...old,
          data: old.data.map((stock) =>
            stock.ticker === ticker ? { ...stock, isFavorite: nextIsFavorite } : stock,
          ),
        }
      })

      queryClient.setQueryData<StockDetail>(stockKeys.detail(ticker), (old) =>
        old ? { ...old, isFavorite: nextIsFavorite } : old,
      )

      return { previousLists, previousDetail, ticker }
    },

    onError: (_err, _vars, context) => {
      if (!context) return
      for (const [key, data] of context.previousLists) {
        queryClient.setQueryData(key, data)
      }
      queryClient.setQueryData(stockKeys.detail(context.ticker), context.previousDetail)
    },

    onSettled: () => {
      // Covers stocks/list/* and stocks/detail/* in one call. There is no
      // separate /favorites query hook (per the M4 decision to reuse
      // GET /stocks?favoritesOnly=), so "favorites queries" ARE the
      // stocks/list queries filtered by favoritesOnly, already covered here.
      void queryClient.invalidateQueries({ queryKey: stockKeys.all })
    },
  })
}
