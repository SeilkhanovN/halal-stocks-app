import type { KeyboardEvent, SyntheticEvent } from 'react'
import './StockTable.css'
import { HalalBadge } from '../HalalBadge/HalalBadge.tsx'
import type { StockSummary } from '../../api/types.ts'

interface StockTableProps {
  stocks: StockSummary[]
  isFetching?: boolean
  onRowActivate: (ticker: string, event: SyntheticEvent<HTMLTableRowElement>) => void
}

export function StockTable({ stocks, isFetching, onRowActivate }: StockTableProps) {
  if (stocks.length === 0) {
    return null
  }

  return (
    <div className="stock-table__wrapper">
      <table
        aria-label="Stock results"
        aria-busy={isFetching}
        className={isFetching ? 'stock-table stock-table--updating' : 'stock-table'}
      >
        <thead>
          <tr>
            <th scope="col">Ticker</th>
            <th scope="col">Company</th>
            <th scope="col">Halal status</th>
          </tr>
        </thead>
        <tbody>
          {stocks.map((stock) => (
            <tr
              key={stock.ticker}
              className="stock-table__row"
              tabIndex={0}
              data-ticker={stock.ticker}
              aria-label={`View details for ${stock.ticker}, ${stock.name}`}
              onClick={(event) => onRowActivate(stock.ticker, event)}
              onKeyDown={(event: KeyboardEvent<HTMLTableRowElement>) => {
                if (event.key === 'Enter') {
                  onRowActivate(stock.ticker, event)
                }
              }}
            >
              <td className="stock-table__ticker">{stock.ticker}</td>
              <td>{stock.name}</td>
              <td>
                <HalalBadge status={stock.halalStatus} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
