import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StockSearch } from './StockSearch.tsx'
import { ApiError } from '../../api/client.ts'
import type { Paginated, StockSummary } from '../../api/types.ts'

vi.mock('../../api/client.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/client.ts')>()
  return { ...actual, fetchStocks: vi.fn(), addFavorite: vi.fn(), removeFavorite: vi.fn() }
})

// Imported after the mock so these bindings are the mocked functions.
const { fetchStocks, addFavorite, removeFavorite } = await import('../../api/client.ts')
const fetchStocksMock = vi.mocked(fetchStocks)
const addFavoriteMock = vi.mocked(addFavorite)
const removeFavoriteMock = vi.mocked(removeFavorite)

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

function makeResponse(overrides: Partial<Paginated<StockSummary>> = {}): Paginated<StockSummary> {
  return {
    data: [
      {
        ticker: 'AAPL',
        name: 'Apple Inc.',
        exchange: 'NASDAQ',
        industry: 'Technology Hardware',
        halalStatus: 'unknown',
        isFavorite: false,
        screenedAt: null,
      },
    ],
    pagination: { page: 1, limit: 25, total: 1, totalPages: 1 },
    meta: { dataAsOf: null },
    ...overrides,
  }
}

// Fake timers are needed for the 250ms debounce, so `findBy`/`waitFor`
// (which poll via setTimeout) can't be relied on here — flush() drives
// pending timers and microtasks explicitly inside `act`, then assertions
// use the synchronous `getBy`/`queryBy` queries.
async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
    // A second, zero-length tick flushes any query fetch that was only
    // kicked off by the state update processed during the tick above (e.g.
    // the debounced search value changing at the end of the ms-tick).
    await vi.advanceTimersByTimeAsync(0)
  })
}

beforeEach(() => {
  // shouldAdvanceTime lets userEvent v14's internal setTimeout-based waits
  // (used between keystrokes/clicks) resolve against real elapsed wall
  // time, avoiding a deadlock with Vitest's fake timers. Real elapsed time
  // during synchronous test steps is negligible next to the 250ms debounce,
  // so explicit vi.advanceTimersByTimeAsync() calls still control it.
  vi.useFakeTimers({ shouldAdvanceTime: true })
  fetchStocksMock.mockReset()
  addFavoriteMock.mockReset()
  removeFavoriteMock.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('StockSearch', () => {
  it('fires exactly one request 250ms after typing settles, with the trimmed search', async () => {
    fetchStocksMock.mockResolvedValue(makeResponse())
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithClient(<StockSearch />)

    // Let the initial mount request (search: '') resolve, then clear it so
    // only the typed-search request is counted below.
    await flush()
    fetchStocksMock.mockClear()

    const input = screen.getByLabelText(/search by ticker or company/i)
    await user.type(input, 'aapl')

    expect(fetchStocksMock).not.toHaveBeenCalled()

    await flush(250)

    expect(fetchStocksMock).toHaveBeenCalledTimes(1)
    expect(fetchStocksMock).toHaveBeenCalledWith({ page: 1, search: 'aapl' }, expect.anything())
  })

  it('renders the ticker and company name from a mocked response', async () => {
    fetchStocksMock.mockResolvedValue(makeResponse())
    renderWithClient(<StockSearch />)

    await flush()

    expect(screen.getByText('AAPL')).toBeInTheDocument()
    expect(screen.getByText('Apple Inc.')).toBeInTheDocument()
  })

  it('paginates with Next/Prev, disables at bounds, and resets to page 1 on a new search', async () => {
    fetchStocksMock.mockResolvedValue(
      makeResponse({ pagination: { page: 1, limit: 25, total: 100, totalPages: 5 } }),
    )
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithClient(<StockSearch />)
    await flush()

    expect(screen.getByRole('button', { name: /prev/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /next/i })).toBeEnabled()

    fetchStocksMock.mockClear()
    fetchStocksMock.mockResolvedValue(
      makeResponse({ pagination: { page: 3, limit: 25, total: 100, totalPages: 5 } }),
    )

    await user.click(screen.getByRole('button', { name: /next/i }))
    await flush()
    await user.click(screen.getByRole('button', { name: /next/i }))
    await flush()

    expect(screen.getByText('Page 3 of 5')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /prev/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /next/i })).toBeEnabled()

    fetchStocksMock.mockClear()
    fetchStocksMock.mockResolvedValue(makeResponse())

    const input = screen.getByLabelText(/search by ticker or company/i)
    await user.type(input, 'msft')
    await flush(250)

    const lastCall = fetchStocksMock.mock.calls.at(-1)
    expect(lastCall?.[0]).toEqual({ page: 1, search: 'msft' })
  })

  it('typing while on a later page fires exactly one request (page 1 + the new term)', async () => {
    // Regression: resetting `page` on every keystroke flipped the query key to
    // page 1 while the debounced term was still the OLD one, firing an extra
    // fetch for the previous search and briefly showing its results.
    fetchStocksMock.mockResolvedValue(
      makeResponse({ pagination: { page: 1, limit: 25, total: 100, totalPages: 5 } }),
    )
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithClient(<StockSearch />)
    await flush()

    fetchStocksMock.mockResolvedValue(
      makeResponse({ pagination: { page: 3, limit: 25, total: 100, totalPages: 5 } }),
    )
    await user.click(screen.getByRole('button', { name: /next/i }))
    await flush()
    await user.click(screen.getByRole('button', { name: /next/i }))
    await flush()
    expect(screen.getByText('Page 3 of 5')).toBeInTheDocument()

    fetchStocksMock.mockClear()
    fetchStocksMock.mockResolvedValue(makeResponse())

    await user.type(screen.getByLabelText(/search by ticker or company/i), 'm')
    await flush(250)

    expect(fetchStocksMock).toHaveBeenCalledTimes(1)
    expect(fetchStocksMock).toHaveBeenCalledWith({ page: 1, search: 'm' }, expect.anything())
  })

  it('Next uses the page the user is on, not a stale page echoed by a pending response', async () => {
    // Regression: Pagination received data.pagination.page, so clicking Next
    // right after typing (while the old response was still displayed) stepped
    // from the stale page and skipped past the new result set.
    fetchStocksMock.mockResolvedValue(
      makeResponse({ pagination: { page: 3, limit: 25, total: 100, totalPages: 5 } }),
    )
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithClient(<StockSearch />)
    await flush()

    // The response claims page 3 while local state is still page 1.
    expect(screen.getByText('Page 1 of 5')).toBeInTheDocument()

    fetchStocksMock.mockClear()
    await user.click(screen.getByRole('button', { name: /next/i }))
    await flush()

    expect(fetchStocksMock).toHaveBeenCalledWith({ page: 2, search: '' }, expect.anything())
  })

  it('shows the seed instruction and a Retry button on 503 DATA_NOT_SEEDED', async () => {
    fetchStocksMock.mockRejectedValue(new ApiError(503, 'DATA_NOT_SEEDED', 'No stocks are seeded yet'))
    renderWithClient(<StockSearch />)

    await flush()

    expect(
      screen.getByText(/no stock data yet\. run `npm run seed:constituents` in backend\//i),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })

  it('shows a generic message, the error detail, and a working Retry button on other errors', async () => {
    fetchStocksMock.mockRejectedValue(new ApiError(500, 'INTERNAL_ERROR', 'boom'))
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithClient(<StockSearch />)

    await flush()

    expect(screen.getByText('Something went wrong loading stocks.')).toBeInTheDocument()
    expect(screen.getByText('boom')).toBeInTheDocument()

    fetchStocksMock.mockClear()
    fetchStocksMock.mockResolvedValue(makeResponse())

    await user.click(screen.getByRole('button', { name: /retry/i }))
    await flush()

    expect(fetchStocksMock).toHaveBeenCalledTimes(1)
  })

  it('shows "No stocks match" for an empty result with an active search', async () => {
    fetchStocksMock.mockResolvedValue(makeResponse())
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithClient(<StockSearch />)
    await flush()

    fetchStocksMock.mockResolvedValue(
      makeResponse({ data: [], pagination: { page: 1, limit: 25, total: 0, totalPages: 0 } }),
    )

    const input = screen.getByLabelText(/search by ticker or company/i)
    await user.type(input, 'zzzz')
    await flush(250)
    await flush()

    expect(screen.getByText('No stocks match “zzzz”.')).toBeInTheDocument()
  })

  it('clears the search text and fetches with no search when Clear is clicked', async () => {
    fetchStocksMock.mockResolvedValue(makeResponse())
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithClient(<StockSearch />)
    await flush()

    const input = screen.getByLabelText(/search by ticker or company/i)
    await user.type(input, 'aapl')
    await flush(250)

    expect(screen.getByLabelText(/clear search/i)).toBeInTheDocument()

    fetchStocksMock.mockClear()

    await user.click(screen.getByRole('button', { name: /clear search/i }))
    await flush(250)

    expect(input).toHaveValue('')
    const lastCall = fetchStocksMock.mock.calls.at(-1)
    expect(lastCall?.[0]).toEqual({ page: 1, search: '' })
  })

  it('clicking Clear after paging forward resets to page 1 with an empty search', async () => {
    // Regression coverage for the Clear path specifically: page 3 is reached
    // without a search, then a search is typed (settling back to page 1 on
    // its own), then Clear is clicked. The request that follows Clear must
    // still be page 1 with no search, not whatever page the search typing
    // left behind.
    fetchStocksMock.mockResolvedValue(
      makeResponse({ pagination: { page: 1, limit: 25, total: 100, totalPages: 5 } }),
    )
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithClient(<StockSearch />)
    await flush()

    fetchStocksMock.mockResolvedValue(
      makeResponse({ pagination: { page: 3, limit: 25, total: 100, totalPages: 5 } }),
    )
    await user.click(screen.getByRole('button', { name: /next/i }))
    await flush()
    await user.click(screen.getByRole('button', { name: /next/i }))
    await flush()
    expect(screen.getByText('Page 3 of 5')).toBeInTheDocument()

    fetchStocksMock.mockResolvedValue(makeResponse())
    const input = screen.getByLabelText(/search by ticker or company/i)
    await user.type(input, 'aapl')
    await flush(250)

    expect(screen.getByLabelText(/clear search/i)).toBeInTheDocument()

    fetchStocksMock.mockClear()
    fetchStocksMock.mockResolvedValue(makeResponse())

    await user.click(screen.getByRole('button', { name: /clear search/i }))
    await flush(250)

    expect(input).toHaveValue('')
    const lastCall = fetchStocksMock.mock.calls.at(-1)
    expect(lastCall?.[0]).toEqual({ page: 1, search: '' })
  })

  it('shows the exact status copy for total counts, with and without a search', async () => {
    fetchStocksMock.mockResolvedValue(
      makeResponse({ pagination: { page: 1, limit: 25, total: 503, totalPages: 21 } }),
    )
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithClient(<StockSearch />)
    await flush()

    expect(screen.getByText('503 stocks')).toBeInTheDocument()

    fetchStocksMock.mockResolvedValue(
      makeResponse({ pagination: { page: 1, limit: 25, total: 1, totalPages: 1 } }),
    )
    const input = screen.getByLabelText(/search by ticker or company/i)
    await user.type(input, 'aapl')
    await flush(250)
    await flush()

    expect(screen.getByText('1 match for “aapl”')).toBeInTheDocument()
  })

  it('marks the table busy during a background refetch while the previous rows stay visible', async () => {
    fetchStocksMock.mockResolvedValue(makeResponse())
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithClient(<StockSearch />)
    await flush()

    expect(screen.getByText('AAPL')).toBeInTheDocument()
    expect(
      screen.getByRole('table', { name: /stock results/i }),
    ).toHaveAttribute('aria-busy', 'false')

    let resolveSecond: (value: Paginated<StockSummary>) => void = () => {}
    fetchStocksMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSecond = resolve
        }),
    )

    const input = screen.getByLabelText(/search by ticker or company/i)
    await user.type(input, 'msft')
    await flush(250)

    // Still fetching in the background: previous rows stay on screen and the
    // table is marked busy, rather than flashing to a loading state.
    expect(
      screen.getByRole('table', { name: /stock results/i }),
    ).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('AAPL')).toBeInTheDocument()

    await act(async () => {
      resolveSecond(
        makeResponse({
          data: [
            {
              ticker: 'MSFT',
              name: 'Microsoft Corp.',
              exchange: 'NASDAQ',
              industry: 'Technology Hardware',
              halalStatus: 'unknown',
              isFavorite: false,
              screenedAt: null,
            },
          ],
        }),
      )
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByText('MSFT')).toBeInTheDocument()
    expect(
      screen.getByRole('table', { name: /stock results/i }),
    ).toHaveAttribute('aria-busy', 'false')
  })

  it('selecting a status chip sends the status param; selecting "All" afterward sends no status key', async () => {
    fetchStocksMock.mockResolvedValue(makeResponse())
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithClient(<StockSearch />)
    await flush()

    fetchStocksMock.mockClear()
    fetchStocksMock.mockResolvedValue(makeResponse())

    await user.click(screen.getByRole('radio', { name: 'Not halal' }))
    await flush()

    expect(fetchStocksMock).toHaveBeenLastCalledWith(
      { page: 1, search: '', status: 'not_halal' },
      expect.anything(),
    )

    fetchStocksMock.mockClear()
    fetchStocksMock.mockResolvedValue(makeResponse())

    await user.click(screen.getByRole('radio', { name: 'All' }))
    await flush()

    const lastCall = fetchStocksMock.mock.calls.at(-1)
    expect(lastCall?.[0]).toEqual({ page: 1, search: '' })
  })

  it('selecting a status chip while on a later page fires exactly one request, resetting to page 1', async () => {
    fetchStocksMock.mockResolvedValue(
      makeResponse({ pagination: { page: 1, limit: 25, total: 100, totalPages: 5 } }),
    )
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithClient(<StockSearch />)
    await flush()

    fetchStocksMock.mockResolvedValue(
      makeResponse({ pagination: { page: 3, limit: 25, total: 100, totalPages: 5 } }),
    )
    await user.click(screen.getByRole('button', { name: /next/i }))
    await flush()
    await user.click(screen.getByRole('button', { name: /next/i }))
    await flush()
    expect(screen.getByText('Page 3 of 5')).toBeInTheDocument()

    fetchStocksMock.mockClear()
    fetchStocksMock.mockResolvedValue(
      makeResponse({ pagination: { page: 1, limit: 25, total: 100, totalPages: 5 } }),
    )

    await user.click(screen.getByRole('radio', { name: 'Halal' }))
    await flush()

    expect(fetchStocksMock).toHaveBeenCalledTimes(1)
    expect(fetchStocksMock).toHaveBeenCalledWith(
      { page: 1, search: '', status: 'halal' },
      expect.anything(),
    )
    expect(screen.getByText('Page 1 of 5')).toBeInTheDocument()
  })

  it('renders "Data as of <date>" from the response meta', async () => {
    fetchStocksMock.mockResolvedValue(
      makeResponse({ meta: { dataAsOf: '2026-01-15T12:00:00.000Z' } }),
    )
    renderWithClient(<StockSearch />)
    await flush()

    expect(screen.getByText(/^Data as of /)).toBeInTheDocument()
  })

  it('checking Favorites only sends favoritesOnly:true; unchecking sends no favoritesOnly key', async () => {
    fetchStocksMock.mockResolvedValue(makeResponse())
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithClient(<StockSearch />)
    await flush()

    fetchStocksMock.mockClear()
    fetchStocksMock.mockResolvedValue(makeResponse())

    await user.click(screen.getByRole('checkbox', { name: /favorites only/i }))
    await flush()

    expect(fetchStocksMock).toHaveBeenLastCalledWith(
      { page: 1, search: '', favoritesOnly: true },
      expect.anything(),
    )

    fetchStocksMock.mockClear()
    fetchStocksMock.mockResolvedValue(makeResponse())

    await user.click(screen.getByRole('checkbox', { name: /favorites only/i }))
    await flush()

    const lastCall = fetchStocksMock.mock.calls.at(-1)
    expect(lastCall?.[0]).toEqual({ page: 1, search: '' })
  })

  it('checking Favorites only while on a later page fires exactly one request, resetting to page 1', async () => {
    fetchStocksMock.mockResolvedValue(
      makeResponse({ pagination: { page: 1, limit: 25, total: 100, totalPages: 5 } }),
    )
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithClient(<StockSearch />)
    await flush()

    fetchStocksMock.mockResolvedValue(
      makeResponse({ pagination: { page: 3, limit: 25, total: 100, totalPages: 5 } }),
    )
    await user.click(screen.getByRole('button', { name: /next/i }))
    await flush()
    await user.click(screen.getByRole('button', { name: /next/i }))
    await flush()
    expect(screen.getByText('Page 3 of 5')).toBeInTheDocument()

    fetchStocksMock.mockClear()
    fetchStocksMock.mockResolvedValue(
      makeResponse({ pagination: { page: 1, limit: 25, total: 100, totalPages: 5 } }),
    )

    await user.click(screen.getByRole('checkbox', { name: /favorites only/i }))
    await flush()

    expect(fetchStocksMock).toHaveBeenCalledTimes(1)
    expect(fetchStocksMock).toHaveBeenCalledWith(
      { page: 1, search: '', favoritesOnly: true },
      expect.anything(),
    )
    expect(screen.getByText('Page 1 of 5')).toBeInTheDocument()
  })

  it('unfavoriting a row under the Favorites only filter keeps it visible (empty star) until the refetch confirms removal', async () => {
    fetchStocksMock.mockResolvedValue(
      makeResponse({
        data: [
          {
            ticker: 'AAPL',
            name: 'Apple Inc.',
            exchange: 'NASDAQ',
            industry: 'Technology Hardware',
            halalStatus: 'unknown',
            isFavorite: true,
            screenedAt: null,
          },
        ],
      }),
    )
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithClient(<StockSearch />)
    await flush()

    await user.click(screen.getByRole('checkbox', { name: /favorites only/i }))
    await flush()

    expect(screen.getByRole('button', { name: 'Remove AAPL from favorites' })).toBeInTheDocument()

    let resolveRemove: () => void = () => {}
    removeFavoriteMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRemove = () => resolve(undefined)
        }),
    )

    await user.click(screen.getByRole('button', { name: 'Remove AAPL from favorites' }))

    // Optimistic update only: the row must still be present (star now empty)
    // even though the active query is favoritesOnly=true, because removal is
    // only allowed to happen once the invalidated refetch confirms it.
    expect(screen.getByText('AAPL')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add AAPL to favorites' })).toBeInTheDocument()

    // The refetch triggered once the mutation settles returns a page with no
    // favorites left.
    fetchStocksMock.mockResolvedValue(
      makeResponse({ data: [], pagination: { page: 1, limit: 25, total: 0, totalPages: 0 } }),
    )
    resolveRemove()
    await flush()

    expect(screen.queryByText('AAPL')).not.toBeInTheDocument()
  })

  it('recovers after a DATA_NOT_SEEDED error once Retry succeeds', async () => {
    fetchStocksMock.mockRejectedValueOnce(
      new ApiError(503, 'DATA_NOT_SEEDED', 'No stocks are seeded yet'),
    )
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithClient(<StockSearch />)
    await flush()

    expect(
      screen.getByText(/no stock data yet\. run `npm run seed:constituents` in backend\//i),
    ).toBeInTheDocument()

    fetchStocksMock.mockResolvedValue(makeResponse())
    await user.click(screen.getByRole('button', { name: /retry/i }))
    await flush()

    expect(screen.getByText('AAPL')).toBeInTheDocument()
    expect(screen.getByText('Apple Inc.')).toBeInTheDocument()
  })
})
