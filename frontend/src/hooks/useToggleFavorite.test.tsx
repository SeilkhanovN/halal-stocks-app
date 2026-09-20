import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useToggleFavorite } from './useToggleFavorite.ts'
import { stockKeys } from '../api/query-keys.ts'
import type { Paginated, StockDetail, StockSummary } from '../api/types.ts'

vi.mock('../api/client.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client.ts')>()
  return { ...actual, addFavorite: vi.fn(), removeFavorite: vi.fn() }
})

const { addFavorite, removeFavorite } = await import('../api/client.ts')
const addFavoriteMock = vi.mocked(addFavorite)
const removeFavoriteMock = vi.mocked(removeFavorite)

function makeSummary(overrides: Partial<StockSummary> = {}): StockSummary {
  return {
    ticker: 'AAPL',
    name: 'Apple Inc.',
    exchange: 'NASDAQ',
    industry: 'Technology Hardware',
    halalStatus: 'halal',
    isFavorite: false,
    screenedAt: null,
    ...overrides,
  }
}

function makePage(overrides: Partial<Paginated<StockSummary>> = {}): Paginated<StockSummary> {
  return {
    data: [makeSummary()],
    pagination: { page: 1, limit: 25, total: 1, totalPages: 1 },
    meta: { dataAsOf: null },
    ...overrides,
  }
}

function makeDetail(overrides: Partial<StockDetail> = {}): StockDetail {
  return {
    ...makeSummary(),
    marketCap: 1_000_000,
    screening: {
      status: 'halal',
      methodology: 'AAOIFI',
      screenedAt: null,
      businessActivity: { industry: 'Technology Hardware', prohibited: false, explanation: 'x' },
      ratios: [],
      reasons: [],
    },
    ...overrides,
  }
}

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

beforeEach(() => {
  addFavoriteMock.mockReset()
  removeFavoriteMock.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useToggleFavorite', () => {
  it('optimistically flips isFavorite to true in the cache before the POST resolves', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const listParams = { page: 1, search: '' }
    queryClient.setQueryData(stockKeys.list(listParams), makePage())

    // Never-resolving promise: proves the cache is patched synchronously in
    // onMutate, not after the mutation settles.
    addFavoriteMock.mockImplementation(() => new Promise(() => {}))

    const { result } = renderHook(() => useToggleFavorite(), {
      wrapper: makeWrapper(queryClient),
    })

    result.current.mutate({ ticker: 'AAPL', nextIsFavorite: true })

    await waitFor(() => {
      const cached = queryClient.getQueryData<Paginated<StockSummary>>(stockKeys.list(listParams))
      expect(cached?.data[0]?.isFavorite).toBe(true)
    })
  })

  it('optimistically flips isFavorite to false in the cache before the DELETE resolves', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const listParams = { page: 1, search: '' }
    queryClient.setQueryData(stockKeys.list(listParams), makePage({ data: [makeSummary({ isFavorite: true })] }))

    removeFavoriteMock.mockImplementation(() => new Promise(() => {}))

    const { result } = renderHook(() => useToggleFavorite(), {
      wrapper: makeWrapper(queryClient),
    })

    result.current.mutate({ ticker: 'AAPL', nextIsFavorite: false })

    await waitFor(() => {
      const cached = queryClient.getQueryData<Paginated<StockSummary>>(stockKeys.list(listParams))
      expect(cached?.data[0]?.isFavorite).toBe(false)
    })
  })

  it('patches every cached list query matching the stocks/list prefix, not just one', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const unfiltered = { page: 1, search: '' }
    const favoritesOnly = { page: 1, favoritesOnly: true }
    queryClient.setQueryData(stockKeys.list(unfiltered), makePage())
    queryClient.setQueryData(stockKeys.list(favoritesOnly), makePage())

    addFavoriteMock.mockImplementation(() => new Promise(() => {}))

    const { result } = renderHook(() => useToggleFavorite(), {
      wrapper: makeWrapper(queryClient),
    })

    result.current.mutate({ ticker: 'AAPL', nextIsFavorite: true })

    await waitFor(() => {
      const a = queryClient.getQueryData<Paginated<StockSummary>>(stockKeys.list(unfiltered))
      const b = queryClient.getQueryData<Paginated<StockSummary>>(stockKeys.list(favoritesOnly))
      expect(a?.data[0]?.isFavorite).toBe(true)
      expect(b?.data[0]?.isFavorite).toBe(true)
    })
  })

  it('never removes a row from a favoritesOnly list on optimistic unfavorite', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const favoritesOnly = { page: 1, favoritesOnly: true }
    queryClient.setQueryData(
      stockKeys.list(favoritesOnly),
      makePage({ data: [makeSummary({ isFavorite: true })] }),
    )

    removeFavoriteMock.mockImplementation(() => new Promise(() => {}))

    const { result } = renderHook(() => useToggleFavorite(), {
      wrapper: makeWrapper(queryClient),
    })

    result.current.mutate({ ticker: 'AAPL', nextIsFavorite: false })

    await waitFor(() => {
      const cached = queryClient.getQueryData<Paginated<StockSummary>>(stockKeys.list(favoritesOnly))
      expect(cached?.data).toHaveLength(1)
      expect(cached?.data[0]?.isFavorite).toBe(false)
    })
  })

  it('rolls back the list and detail caches to their pre-mutation snapshots on error', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const listParams = { page: 1, search: '' }
    const originalList = makePage()
    const originalDetail = makeDetail()
    queryClient.setQueryData(stockKeys.list(listParams), originalList)
    queryClient.setQueryData(stockKeys.detail('AAPL'), originalDetail)

    addFavoriteMock.mockRejectedValue(new Error('boom'))

    const { result } = renderHook(() => useToggleFavorite(), {
      wrapper: makeWrapper(queryClient),
    })

    result.current.mutate({ ticker: 'AAPL', nextIsFavorite: true })

    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(queryClient.getQueryData(stockKeys.list(listParams))).toEqual(originalList)
    expect(queryClient.getQueryData(stockKeys.detail('AAPL'))).toEqual(originalDetail)
  })
})
