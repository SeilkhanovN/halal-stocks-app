import './RatioRow.css'
import type { RatioResult } from '../../api/types.ts'

type RatioState = 'pass' | 'breach' | 'unavailable'

function getRatioState(ratio: RatioResult): RatioState {
  if (ratio.value === null || ratio.breached === null) {
    return 'unavailable'
  }
  return ratio.breached ? 'breach' : 'pass'
}

// Local to this component on purpose, same convention as HalalBadge's
// LABELS/ICONS maps: RatioRow is a leaf component and shouldn't reach for a
// shared constant just because the words happen to overlap elsewhere.
const ICONS: Record<RatioState, string> = {
  pass: '✓',
  breach: '✕',
  unavailable: '–',
}

const LABELS: Record<RatioState, string> = {
  pass: 'Pass',
  breach: 'Breach',
  unavailable: 'Not available',
}

// `0.1234 -> "12.3%"`. Never called with a null value (callers must guard).
function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

// FLOAT TRAP: `0.3 * 100 === 29.999999999999996` in JS, so the threshold is
// rounded to one decimal place *before* it is stringified, never formatted
// with `.toFixed()` on the raw product.
function formatThreshold(threshold: number): string {
  return `${Math.round(threshold * 1000) / 10}%`
}

interface RatioRowProps {
  ratio: RatioResult
}

export function RatioRow({ ratio }: RatioRowProps) {
  const state = getRatioState(ratio)

  // A null value must never render as "0%"/"0.0%" and must never draw a
  // zero-width fill bar — both would misrepresent missing data as a real
  // measured zero. The threshold marker is fixed at 40% of the track (not
  // 100%) so all three ratios share one comparable gauge regardless of
  // their individual limits (30%, 30%, 5%); the clamp at 100% keeps ratios
  // far past their limit (e.g. 31.1% against a 5% limit, 6.2x) from
  // overflowing the DOM.
  const fillPercent =
    ratio.value === null ? null : Math.min(100, (ratio.value / ratio.threshold) * 40)
  const isOverflow = ratio.value !== null && ratio.value / ratio.threshold > 2.5

  return (
    <div className={`ratio-row ratio-row--${state}`}>
      <div className="ratio-row__header">
        <span className="ratio-row__label">{ratio.label}</span>
        <span className="ratio-row__state">
          <span className="ratio-row__icon" aria-hidden="true">
            {ICONS[state]}
          </span>
          <span>{LABELS[state]}</span>
        </span>
      </div>
      <div className="ratio-row__values">
        <span className="ratio-row__value">
          {state === 'unavailable' || ratio.value === null ? 'Not available' : formatPercent(ratio.value)}
        </span>
        <span className="ratio-row__limit">Limit {formatThreshold(ratio.threshold)}</span>
      </div>
      <div className="ratio-row__bar" aria-hidden="true">
        {fillPercent === null ? null : (
          <div
            className={
              isOverflow ? 'ratio-row__fill ratio-row__fill--overflow' : 'ratio-row__fill'
            }
            style={{ width: `${fillPercent}%` }}
          />
        )}
      </div>
      <p className="ratio-row__explanation">{ratio.explanation}</p>
    </div>
  )
}
