import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StockTable } from './StockTable.tsx'
import type { StockSummary } from '../../api/types.ts'

// FavoriteButton's mutation would otherwise hit the real fetch (there's no
// server in this test environment) when a star is clicked/Enter-activated
// below — mocked here purely to keep those interactions inert, not to
// exercise the mutation itself (that's useToggleFavorite.test.tsx and
// FavoriteButton.test.tsx).
vi.mock('../../api/client.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/client.ts')>()
  return { ...actual, addFavorite: vi.fn(), removeFavorite: vi.fn() }
})

const noop = vi.fn()

// StockTable's rows now contain FavoriteButton, which calls
// useToggleFavorite() -> useMutation/useQueryClient, so every render needs a
// QueryClientProvider in scope or it throws "No QueryClient set".
function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

const stocks: StockSummary[] = [
  {
    ticker: 'AAPL',
    name: 'Apple Inc.',
    exchange: 'NASDAQ',
    industry: 'Technology Hardware',
    halalStatus: 'halal',
    isFavorite: false,
    screenedAt: null,
  },
]

describe('StockTable', () => {
  it('renders the ticker and company name for a fixture', () => {
    renderWithClient(<StockTable stocks={stocks} onRowActivate={noop} />)

    expect(screen.getByText('AAPL')).toBeInTheDocument()
    expect(screen.getByText('Apple Inc.')).toBeInTheDocument()
  })

  it('renders nothing for an empty list', () => {
    const { container } = renderWithClient(<StockTable stocks={[]} onRowActivate={noop} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('sets aria-busy when isFetching is true', () => {
    renderWithClient(<StockTable stocks={stocks} isFetching onRowActivate={noop} />)

    expect(screen.getByRole('table', { name: /stock results/i })).toHaveAttribute(
      'aria-busy',
      'true',
    )
  })

  it('renders the halal status badge for each row', () => {
    const withNotHalal: StockSummary[] = [
      {
        ticker: 'XOM',
        name: 'Exxon Mobil Corp.',
        exchange: 'NYSE',
        industry: 'Energy',
        halalStatus: 'not_halal',
        isFavorite: false,
        screenedAt: null,
      },
    ]
    renderWithClient(<StockTable stocks={withNotHalal} onRowActivate={noop} />)

    expect(screen.getByText('Not halal')).toBeInTheDocument()
  })

  it('calls onRowActivate with the ticker when a row is clicked', async () => {
    const onRowActivate = vi.fn()
    const user = userEvent.setup()
    renderWithClient(<StockTable stocks={stocks} onRowActivate={onRowActivate} />)

    await user.click(screen.getByRole('row', { name: /view details for aapl/i }))

    expect(onRowActivate).toHaveBeenCalledTimes(1)
    expect(onRowActivate.mock.calls[0]?.[0]).toBe('AAPL')
  })

  it('calls onRowActivate when Enter is pressed on a focused row', async () => {
    const onRowActivate = vi.fn()
    const user = userEvent.setup()
    renderWithClient(<StockTable stocks={stocks} onRowActivate={onRowActivate} />)

    const row = screen.getByRole('row', { name: /view details for aapl/i })
    row.focus()
    await user.keyboard('{Enter}')

    expect(onRowActivate).toHaveBeenCalledTimes(1)
    expect(onRowActivate.mock.calls[0]?.[0]).toBe('AAPL')
  })

  it('renders a favorite star per row', () => {
    renderWithClient(<StockTable stocks={stocks} onRowActivate={noop} />)

    expect(screen.getByRole('button', { name: 'Add AAPL to favorites' })).toBeInTheDocument()
  })

  it('clicking the favorite star does not call onRowActivate', async () => {
    const onRowActivate = vi.fn()
    const user = userEvent.setup()
    renderWithClient(<StockTable stocks={stocks} onRowActivate={onRowActivate} />)

    await user.click(screen.getByRole('button', { name: 'Add AAPL to favorites' }))

    expect(onRowActivate).not.toHaveBeenCalled()
  })

  it('pressing Enter with the favorite star focused does not call onRowActivate', async () => {
    const onRowActivate = vi.fn()
    const user = userEvent.setup()
    renderWithClient(<StockTable stocks={stocks} onRowActivate={onRowActivate} />)

    screen.getByRole('button', { name: 'Add AAPL to favorites' }).focus()
    await user.keyboard('{Enter}')

    expect(onRowActivate).not.toHaveBeenCalled()
  })
})
