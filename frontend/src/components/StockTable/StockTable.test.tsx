import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StockTable } from './StockTable.tsx'
import type { StockSummary } from '../../api/types.ts'

const noop = vi.fn()

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
    render(<StockTable stocks={stocks} onRowActivate={noop} />)

    expect(screen.getByText('AAPL')).toBeInTheDocument()
    expect(screen.getByText('Apple Inc.')).toBeInTheDocument()
  })

  it('renders nothing for an empty list', () => {
    const { container } = render(<StockTable stocks={[]} onRowActivate={noop} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('sets aria-busy when isFetching is true', () => {
    render(<StockTable stocks={stocks} isFetching onRowActivate={noop} />)

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
    render(<StockTable stocks={withNotHalal} onRowActivate={noop} />)

    expect(screen.getByText('Not halal')).toBeInTheDocument()
  })

  it('calls onRowActivate with the ticker when a row is clicked', async () => {
    const onRowActivate = vi.fn()
    const user = userEvent.setup()
    render(<StockTable stocks={stocks} onRowActivate={onRowActivate} />)

    await user.click(screen.getByRole('row', { name: /view details for aapl/i }))

    expect(onRowActivate).toHaveBeenCalledTimes(1)
    expect(onRowActivate.mock.calls[0]?.[0]).toBe('AAPL')
  })

  it('calls onRowActivate when Enter is pressed on a focused row', async () => {
    const onRowActivate = vi.fn()
    const user = userEvent.setup()
    render(<StockTable stocks={stocks} onRowActivate={onRowActivate} />)

    const row = screen.getByRole('row', { name: /view details for aapl/i })
    row.focus()
    await user.keyboard('{Enter}')

    expect(onRowActivate).toHaveBeenCalledTimes(1)
    expect(onRowActivate.mock.calls[0]?.[0]).toBe('AAPL')
  })
})
