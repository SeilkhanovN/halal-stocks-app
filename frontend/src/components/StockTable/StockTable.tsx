import './StockTable.css'
import { HalalBadge } from '../HalalBadge/HalalBadge.tsx'
import type { StockSummary } from '../../api/types.ts'

interface StockTableProps {
  stocks: StockSummary[]
  isFetching?: boolean
}

export function StockTable({ stocks, isFetching }: StockTableProps) {
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
            <tr key={stock.ticker}>
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
