import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RatioRow } from './RatioRow.tsx'
import type { RatioResult } from '../../api/types.ts'

function makeRatio(overrides: Partial<RatioResult> = {}): RatioResult {
  return {
    key: 'debtToMarketCap',
    label: 'Debt / market cap',
    value: 0.1234,
    threshold: 0.3,
    breached: false,
    explanation: '12.3% is below the 30% limit.',
    ...overrides,
  }
}

describe('RatioRow', () => {
  it('formats the value to one decimal and the threshold with no trailing .0', () => {
    render(<RatioRow ratio={makeRatio({ value: 0.1234, threshold: 0.3, breached: false })} />)

    expect(screen.getByText('12.3%')).toBeInTheDocument()
    expect(screen.getByText('Limit 30%')).toBeInTheDocument()
    expect(screen.queryByText(/30\.0%/)).not.toBeInTheDocument()
  })

  it('renders "Not available" (never "0%"/"0.0%") and no fill bar for a null value', () => {
    const { container } = render(
      <RatioRow ratio={makeRatio({ value: null, threshold: 0.3, breached: null })} />,
    )

    // Both the state label and the value cell read "Not available" for a
    // null ratio, so there are two matching text nodes, not one.
    expect(screen.getAllByText('Not available')).toHaveLength(2)
    expect(screen.queryByText('0%')).not.toBeInTheDocument()
    expect(screen.queryByText('0.0%')).not.toBeInTheDocument()
    expect(container.querySelector('.ratio-row__fill')).not.toBeInTheDocument()
  })

  it('shows a Breach marker for a breached ratio', () => {
    render(
      <RatioRow
        ratio={makeRatio({
          value: 0.359,
          threshold: 0.3,
          breached: true,
          explanation: '35.9% exceeds the 30% limit.',
        })}
      />,
    )

    expect(screen.getByText('Breach')).toBeInTheDocument()
    expect(screen.getByText('35.9% exceeds the 30% limit.')).toBeInTheDocument()
  })

  it('rounds the threshold before formatting instead of using a raw .toFixed() (the 0.3 float trap)', () => {
    render(<RatioRow ratio={makeRatio({ value: 0.05, threshold: 0.3, breached: false })} />)

    expect(screen.getByText('Limit 30%')).toBeInTheDocument()
  })

  it('renders a genuine zero value as "0.0%" and Pass (not "Not available"), with a real fill bar', () => {
    // A debt-free company (e.g. ANET/CMG/DECK in the live seed) has a
    // genuinely measured value of 0 — the best possible result on this
    // ratio — which must be rendered distinctly from a null/unknown value.
    const { container } = render(
      <RatioRow ratio={makeRatio({ value: 0, threshold: 0.3, breached: false })} />,
    )

    expect(screen.getByText('0.0%')).toBeInTheDocument()
    expect(screen.getByText('Pass')).toBeInTheDocument()
    expect(screen.queryByText('Not available')).not.toBeInTheDocument()

    // Unlike the null case, a real zero still gets a fill element (the
    // implementation renders it at 0% width rather than omitting it).
    const fill = container.querySelector('.ratio-row__fill')
    expect(fill).not.toBeNull()
  })

  it('places the fill bar exactly at the 40% marker when value equals threshold', () => {
    const { container } = render(
      <RatioRow ratio={makeRatio({ value: 0.3, threshold: 0.3, breached: false })} />,
    )

    const fill = container.querySelector('.ratio-row__fill')
    expect(fill).not.toBeNull()
    expect((fill as HTMLElement).style.width).toBe('40%')
  })

  it('clamps the fill bar at 100% and marks it overflowing for a ratio far past its limit', () => {
    // JPM-like: 31.1% against a 5% limit, 6.2x the threshold.
    const { container } = render(
      <RatioRow
        ratio={makeRatio({
          key: 'interestIncomeToRevenue',
          label: 'Interest income / revenue',
          value: 0.311,
          threshold: 0.05,
          breached: true,
          explanation: '31.1% exceeds the 5% limit.',
        })}
      />,
    )

    const fill = container.querySelector('.ratio-row__fill')
    expect(fill).not.toBeNull()
    expect(fill).toHaveClass('ratio-row__fill--overflow')
    expect((fill as HTMLElement).style.width).toBe('100%')
  })
})
