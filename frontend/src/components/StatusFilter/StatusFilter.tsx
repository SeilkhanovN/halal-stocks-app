import './StatusFilter.css'
import type { HalalStatus } from '../../api/types.ts'

export type StatusFilterValue = 'all' | HalalStatus

interface StatusFilterProps {
  value: StatusFilterValue
  onChange: (value: StatusFilterValue) => void
}

// eslint-disable-next-line react-refresh/only-export-components -- constant shared with StockSearch's empty-state copy; not a component export.
export const STATUS_OPTION_LABELS: Record<HalalStatus, string> = {
  halal: 'Halal',
  not_halal: 'Not halal',
  unknown: 'Unknown',
}

const OPTIONS: { value: StatusFilterValue; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'halal', label: STATUS_OPTION_LABELS.halal },
  { value: 'not_halal', label: STATUS_OPTION_LABELS.not_halal },
  { value: 'unknown', label: STATUS_OPTION_LABELS.unknown },
]

export function StatusFilter({ value, onChange }: StatusFilterProps) {
  return (
    <fieldset role="radiogroup" className="status-filter">
      <legend>Filter by halal status</legend>
      {OPTIONS.map((option) => {
        const checked = option.value === value
        return (
          <label
            key={option.value}
            className={
              checked ? 'status-filter__chip status-filter__chip--selected' : 'status-filter__chip'
            }
          >
            <input
              type="radio"
              name="status-filter"
              value={option.value}
              checked={checked}
              onChange={() => onChange(option.value)}
            />
            {option.label}
          </label>
        )
      })}
    </fieldset>
  )
}
