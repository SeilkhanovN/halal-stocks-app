import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StockTable } from './StockTable.tsx'
import type { StockSummary } from '../../api/types.ts'

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
    render(<StockTable stocks={stocks} />)

    expect(screen.getByText('AAPL')).toBeInTheDocument()
    expect(screen.getByText('Apple Inc.')).toBeInTheDocument()
  })

  it('renders nothing for an empty list', () => {
    const { container } = render(<StockTable stocks={[]} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('sets aria-busy when isFetching is true', () => {
    render(<StockTable stocks={stocks} isFetching />)

    expect(screen.getByRole('table', { name: /stock results/i })).toHaveAttribute(
      'aria-busy',
      'true',
    )
  })
})
