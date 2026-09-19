import { useState, type ReactNode } from 'react'
import './StockSearch.css'
import { ApiError } from '../../api/client.ts'
import { useStocks } from '../../hooks/useStocks.ts'
import { useDebouncedValue } from '../../hooks/useDebouncedValue.ts'
import { StockTable } from '../StockTable/StockTable.tsx'
import { Pagination } from '../Pagination/Pagination.tsx'
import { StatusFilter, STATUS_OPTION_LABELS, type StatusFilterValue } from '../StatusFilter/StatusFilter.tsx'
import { Footer } from '../Footer/Footer.tsx'
import type { Paginated, StockSummary } from '../../api/types.ts'

export function StockSearch() {
  const [searchText, setSearchText] = useState('')
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<StatusFilterValue>('all')

  const debouncedSearch = useDebouncedValue(searchText, 250)

  // Reset to page 1 in the same render the settled search term changes, not on
  // every keystroke: resetting in the change handler would flip the query key
  // (page N -> 1) while `debouncedSearch` is still the OLD term, firing an
  // extra fetch for the previous search. Adjusting state during render is the
  // documented React pattern for "derive state from a prop/state change".
  const [lastSettledSearch, setLastSettledSearch] = useState(debouncedSearch)
  if (debouncedSearch !== lastSettledSearch) {
    setLastSettledSearch(debouncedSearch)
    setPage(1)
  }

  const { data, isPending, isError, isFetching, error, refetch } = useStocks({
    page,
    search: debouncedSearch,
    status: status === 'all' ? undefined : status,
  })

  function handleSearchChange(next: string) {
    setSearchText(next)
  }

  // Status has no debounce — a chip click is already a settled value the
  // instant it fires, so (unlike search) there is no intermediate render
  // where `status` has changed but the query key hasn't. Resetting the page
  // here, batched with the status change, is safe and produces exactly one
  // fetch (page N -> 1, status old -> new in a single render).
  function handleStatusChange(next: StatusFilterValue) {
    setStatus(next)
    setPage(1)
  }

  const showUpdating = isFetching && !isPending

  return (
    <>
      <section className="stock-search">
        <div className="stock-search__controls">
          <label htmlFor="stock-search-input">Search by ticker or company</label>
          <input
            id="stock-search-input"
            type="text"
            autoFocus
            placeholder="Search by ticker or company"
            value={searchText}
            onChange={(e) => handleSearchChange(e.target.value)}
          />
          {searchText !== '' ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => handleSearchChange('')}
            >
              Clear
            </button>
          ) : null}
        </div>

        <StatusFilter value={status} onChange={handleStatusChange} />

        <p className="stock-search__status" aria-live="polite">
          {renderStatus({ isPending, isError, error, data, debouncedSearch, status })}
        </p>

        {isError ? (
          <button type="button" onClick={() => void refetch()}>
            Retry
          </button>
        ) : null}

        {!isPending && !isError && data ? (
          <>
            <StockTable stocks={data.data} isFetching={showUpdating} />
            {/* Local `page`, not data.pagination.page: with keepPreviousData the
                response can still echo the previous page while a new one loads,
                and Next/Prev must step from the page the user is actually on. */}
            <Pagination
              page={page}
              totalPages={data.pagination.totalPages}
              onPageChange={setPage}
            />
          </>
        ) : null}
      </section>
      <Footer dataAsOf={data?.meta.dataAsOf} />
    </>
  )
}

interface RenderStatusArgs {
  isPending: boolean
  isError: boolean
  error: Error | null
  data: Paginated<StockSummary> | undefined
  debouncedSearch: string
  status: StatusFilterValue
}

function renderStatus({
  isPending,
  isError,
  error,
  data,
  debouncedSearch,
  status,
}: RenderStatusArgs): ReactNode {
  if (isPending) {
    return 'Loading stocks…'
  }

  if (isError) {
    if (error instanceof ApiError && error.code === 'DATA_NOT_SEEDED') {
      return 'No stock data yet. Run `npm run seed:constituents` in backend/.'
    }
    const message = error instanceof Error ? error.message : 'Unknown error'
    return (
      <>
        <span>Something went wrong loading stocks.</span>
        <br />
        <span>{message}</span>
      </>
    )
  }

  if (data) {
    const total = data.pagination.total
    const hasSearch = debouncedSearch !== ''
    const hasStatus = status !== 'all'
    if (data.data.length === 0) {
      if (hasSearch && hasStatus) {
        return `No stocks match “${debouncedSearch}” with the “${STATUS_OPTION_LABELS[status]}” filter.`
      }
      if (hasSearch) {
        return `No stocks match “${debouncedSearch}”.`
      }
      if (hasStatus) {
        return `No stocks match the “${STATUS_OPTION_LABELS[status]}” filter.`
      }
      return 'No stocks found.'
    }
    if (hasSearch) {
      return total === 1
        ? `1 match for “${debouncedSearch}”`
        : `${total} matches for “${debouncedSearch}”`
    }
    return total === 1 ? '1 stock' : `${total} stocks`
  }

  return ''
}
