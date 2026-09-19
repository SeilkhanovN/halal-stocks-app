import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StockDetailPanel } from './StockDetailPanel.tsx'
import { StockSearch } from '../StockSearch/StockSearch.tsx'
import { ApiError } from '../../api/client.ts'
import type { Paginated, StockDetail, StockSummary } from '../../api/types.ts'

vi.mock('../../api/client.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/client.ts')>()
  return { ...actual, fetchStocks: vi.fn(), fetchStockDetail: vi.fn() }
})

// Imported after the mock so these bindings are the mocked functions.
const { fetchStocks, fetchStockDetail } = await import('../../api/client.ts')
const fetchStocksMock = vi.mocked(fetchStocks)
const fetchStockDetailMock = vi.mocked(fetchStockDetail)

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

function makeDetail(overrides: Partial<StockDetail> = {}): StockDetail {
  return {
    ticker: 'AAPL',
    name: 'Apple Inc.',
    exchange: 'NASDAQ',
    industry: 'Technology Hardware',
    halalStatus: 'halal',
    isFavorite: false,
    screenedAt: '2026-01-15T12:00:00.000Z',
    marketCap: 4905541618359.874,
    screening: {
      status: 'halal',
      methodology: 'AAOIFI',
      screenedAt: '2026-01-15T12:00:00.000Z',
      businessActivity: {
        industry: 'Technology Hardware',
        prohibited: false,
        explanation: 'Technology hardware is not a prohibited business line.',
      },
      ratios: [
        {
          key: 'debtToMarketCap',
          label: 'Debt / market cap',
          value: 0.017,
          threshold: 0.3,
          breached: false,
          explanation: '1.7% is below the 30% limit.',
        },
        {
          key: 'cashAndSecuritiesToMarketCap',
          label: 'Cash & securities / market cap',
          value: 0.03,
          threshold: 0.3,
          breached: false,
          explanation: '3.0% is below the 30% limit.',
        },
        {
          key: 'interestIncomeToRevenue',
          label: 'Interest income / revenue',
          value: 0.008,
          threshold: 0.05,
          breached: false,
          explanation: '0.8% is below the 5% limit.',
        },
      ],
      reasons: [],
    },
    ...overrides,
  }
}

function makeNotHalalDetail(): StockDetail {
  return makeDetail({
    ticker: 'JPM',
    name: 'JPMorgan Chase & Co.',
    industry: 'Banking',
    halalStatus: 'not_halal',
    marketCap: 500_000_000_000,
    screening: {
      status: 'not_halal',
      methodology: 'AAOIFI',
      screenedAt: '2026-01-15T12:00:00.000Z',
      businessActivity: {
        industry: 'Banking',
        prohibited: true,
        explanation: 'Conventional banking is a prohibited business line.',
      },
      ratios: [
        {
          key: 'debtToMarketCap',
          label: 'Debt / market cap',
          value: 0.359,
          threshold: 0.3,
          breached: true,
          explanation: '35.9% exceeds the 30% limit.',
        },
        {
          key: 'cashAndSecuritiesToMarketCap',
          label: 'Cash & securities / market cap',
          value: 0.333,
          threshold: 0.3,
          breached: true,
          explanation: '33.3% exceeds the 30% limit.',
        },
        {
          key: 'interestIncomeToRevenue',
          label: 'Interest income / revenue',
          value: 0.311,
          threshold: 0.05,
          breached: true,
          explanation: '31.1% exceeds the 5% limit.',
        },
      ],
      reasons: ['Business activity is a prohibited industry (Banking).', 'Debt / market cap exceeds the 30% limit.'],
    },
  })
}

function makeUnknownDetail(): StockDetail {
  return makeDetail({
    ticker: 'AKAM',
    name: 'Akamai Technologies',
    industry: 'Technology Services',
    halalStatus: 'unknown',
    screening: {
      status: 'unknown',
      methodology: 'AAOIFI',
      screenedAt: null,
      businessActivity: {
        industry: 'Technology Services',
        prohibited: false,
        explanation: 'Technology services is not a prohibited business line.',
      },
      ratios: [
        {
          key: 'debtToMarketCap',
          label: 'Debt / market cap',
          value: null,
          threshold: 0.3,
          breached: null,
          explanation: 'Debt data is not available for this stock.',
        },
        {
          key: 'cashAndSecuritiesToMarketCap',
          label: 'Cash & securities / market cap',
          value: 0.307,
          threshold: 0.3,
          breached: true,
          explanation: '30.7% exceeds the 30% limit.',
        },
        {
          key: 'interestIncomeToRevenue',
          label: 'Interest income / revenue',
          value: null,
          threshold: 0.05,
          breached: null,
          explanation: 'Interest income data is not available for this stock.',
        },
      ],
      reasons: ['Debt / market cap could not be computed.', 'Cash & securities / market cap exceeds the 30% limit.'],
    },
  })
}

beforeEach(() => {
  fetchStocksMock.mockReset()
  fetchStockDetailMock.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('StockDetailPanel', () => {
  it('renders a halal stock with three passing ratios and no breach/unavailable markers', async () => {
    fetchStockDetailMock.mockResolvedValue(makeDetail())
    renderWithClient(<StockDetailPanel ticker="AAPL" onClose={vi.fn()} />)

    await screen.findByText('Apple Inc.', { exact: false })

    expect(screen.getAllByText('Pass')).toHaveLength(3)
    expect(screen.queryByText('Breach')).not.toBeInTheDocument()
    expect(screen.queryByText('Not available')).not.toBeInTheDocument()
  })

  it('renders a not-halal stock with breached ratios and its reasons', async () => {
    fetchStockDetailMock.mockResolvedValue(makeNotHalalDetail())
    renderWithClient(<StockDetailPanel ticker="JPM" onClose={vi.fn()} />)

    await screen.findByText('JPMorgan Chase & Co.', { exact: false })

    expect(screen.getAllByText('Breach').length).toBeGreaterThanOrEqual(1)
    expect(
      screen.getByText('Business activity is a prohibited industry (Banking).'),
    ).toBeInTheDocument()
  })

  it('renders an unknown stock with a null ratio and a breached ratio, never showing 0%/0.0% for the null one', async () => {
    fetchStockDetailMock.mockResolvedValue(makeUnknownDetail())
    renderWithClient(<StockDetailPanel ticker="AKAM" onClose={vi.fn()} />)

    await screen.findByText('Akamai Technologies', { exact: false })

    // The state label and the value cell both read "Not available" for the
    // null debtToMarketCap ratio, so there are two matching text nodes.
    expect(screen.getAllByText('Not available').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Debt / market cap could not be computed.')).toBeInTheDocument()
    expect(screen.queryByText('0.0%')).not.toBeInTheDocument()
    expect(screen.queryByText('0%')).not.toBeInTheDocument()
  })

  it('shows the screened date and the exact disclaimer text', async () => {
    fetchStockDetailMock.mockResolvedValue(makeDetail({ screenedAt: '2026-01-15T12:00:00.000Z' }))
    renderWithClient(<StockDetailPanel ticker="AAPL" onClose={vi.fn()} />)

    await screen.findByText(/screened on/i)

    expect(
      screen.getByText(
        'Automated screen based on AAOIFI financial ratios only — revenue from non-permissible business lines is not analysed. Not a fatwa or financial advice.',
      ),
    ).toBeInTheDocument()
  })

  it('shows the literal "Stock not found" text on a 404 STOCK_NOT_FOUND error', async () => {
    // The message deliberately contains no "not found" substring, so this
    // test can only pass if the branch is driven by `error.code`, not by a
    // string match on `error.message`.
    fetchStockDetailMock.mockRejectedValue(new ApiError(404, 'STOCK_NOT_FOUND', 'nope'))
    renderWithClient(<StockDetailPanel ticker="NOPE" onClose={vi.fn()} />)

    expect(await screen.findByText('Stock not found')).toBeInTheDocument()
  })

  it('shows a generic error message and a working Retry button for a non-404 error', async () => {
    fetchStockDetailMock.mockRejectedValueOnce(new ApiError(500, 'INTERNAL_ERROR', 'boom'))
    const user = userEvent.setup()
    renderWithClient(<StockDetailPanel ticker="AAPL" onClose={vi.fn()} />)

    expect(await screen.findByText('boom')).toBeInTheDocument()

    fetchStockDetailMock.mockResolvedValue(makeDetail())
    await user.click(screen.getByRole('button', { name: /retry/i }))

    await screen.findByText('Apple Inc.', { exact: false })
  })

  it('focuses the close button on mount', async () => {
    fetchStockDetailMock.mockResolvedValue(makeDetail())
    renderWithClient(<StockDetailPanel ticker="AAPL" onClose={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /close/i })).toHaveFocus()
    })
  })

  it('calls onClose when the backdrop is clicked', async () => {
    fetchStockDetailMock.mockResolvedValue(makeDetail())
    const onClose = vi.fn()
    const user = userEvent.setup()
    const { container } = renderWithClient(<StockDetailPanel ticker="AAPL" onClose={onClose} />)
    await screen.findByText('Apple Inc.', { exact: false })

    const backdrop = container.querySelector('.stock-detail-panel__backdrop')
    expect(backdrop).not.toBeNull()
    await user.click(backdrop as HTMLElement)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('wraps Tab back to the close button when it is the only focusable element', async () => {
    fetchStockDetailMock.mockResolvedValue(makeDetail())
    const user = userEvent.setup()
    renderWithClient(<StockDetailPanel ticker="AAPL" onClose={vi.fn()} />)
    await screen.findByText('Apple Inc.', { exact: false })

    const closeButton = screen.getByRole('button', { name: /close/i })
    await waitFor(() => expect(closeButton).toHaveFocus())

    await user.tab()

    expect(closeButton).toHaveFocus()
  })

  it('calls onClose on Escape', async () => {
    fetchStockDetailMock.mockResolvedValue(makeDetail())
    const onClose = vi.fn()
    const user = userEvent.setup()
    renderWithClient(<StockDetailPanel ticker="AAPL" onClose={onClose} />)
    await screen.findByText('Apple Inc.', { exact: false })

    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('StockDetailPanel via StockSearch (click-to-open, close, focus restoration)', () => {
  function makeStocksResponse(): Paginated<StockSummary> {
    return {
      data: [
        {
          ticker: 'AAPL',
          name: 'Apple Inc.',
          exchange: 'NASDAQ',
          industry: 'Technology Hardware',
          halalStatus: 'halal',
          isFavorite: false,
          screenedAt: '2026-01-15T12:00:00.000Z',
        },
      ],
      pagination: { page: 1, limit: 25, total: 1, totalPages: 1 },
      meta: { dataAsOf: '2026-01-15T12:00:00.000Z' },
    }
  }

  it('clicking a row opens the dialog focused on Close; Escape closes it and restores focus to the row', async () => {
    fetchStocksMock.mockResolvedValue(makeStocksResponse())
    fetchStockDetailMock.mockResolvedValue(makeDetail())
    const user = userEvent.setup()
    renderWithClient(<StockSearch />)

    await screen.findByText('AAPL')

    const row = screen.getByRole('row', { name: /AAPL/i })
    await user.click(row)

    await screen.findByRole('dialog')
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /close/i })).toHaveFocus()
    })

    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(screen.getByRole('row', { name: /AAPL/i })).toHaveFocus()
  })

  it('clicking a row opens the dialog; clicking Close closes it and restores focus to the row', async () => {
    fetchStocksMock.mockResolvedValue(makeStocksResponse())
    fetchStockDetailMock.mockResolvedValue(makeDetail())
    const user = userEvent.setup()
    renderWithClient(<StockSearch />)

    await screen.findByText('AAPL')

    const row = screen.getByRole('row', { name: /AAPL/i })
    await user.click(row)

    await screen.findByRole('dialog')
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /close/i })).toHaveFocus()
    })

    await user.click(screen.getByRole('button', { name: /close/i }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(screen.getByRole('row', { name: /AAPL/i })).toHaveFocus()
  })

  it('falls back to the search input when the originating row is no longer in the document on close', async () => {
    fetchStocksMock.mockResolvedValue(makeStocksResponse())
    fetchStockDetailMock.mockResolvedValue(makeDetail())
    const user = userEvent.setup()
    renderWithClient(<StockSearch />)

    await screen.findByText('AAPL')
    const row = screen.getByRole('row', { name: /AAPL/i })
    await user.click(row)
    await screen.findByRole('dialog')

    // Simulate the row disappearing from the result set (e.g. a filter or
    // page change) while the panel is still open.
    fetchStocksMock.mockResolvedValue({
      data: [],
      pagination: { page: 1, limit: 25, total: 0, totalPages: 0 },
      meta: { dataAsOf: null },
    })
    await act(async () => {
      row.remove()
    })

    await user.click(screen.getByRole('button', { name: /close/i }))

    await waitFor(() => {
      expect(screen.getByLabelText(/search by ticker or company/i)).toHaveFocus()
    })
  })
})
