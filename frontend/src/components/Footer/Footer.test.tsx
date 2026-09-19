import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Footer } from './Footer.tsx'

const DISCLAIMER =
  'Automated screen based on AAOIFI financial ratios only — revenue from non-permissible business lines is not analysed. Not a fatwa or financial advice.'

describe('Footer', () => {
  it('always renders the exact disclaimer text', () => {
    render(<Footer dataAsOf={null} />)

    expect(screen.getByText(DISCLAIMER)).toBeInTheDocument()
  })

  it('shows "Data date unavailable" for a null dataAsOf', () => {
    render(<Footer dataAsOf={null} />)

    expect(screen.getByText('Data date unavailable')).toBeInTheDocument()
  })

  it('shows "Data date unavailable" for an undefined dataAsOf', () => {
    render(<Footer dataAsOf={undefined} />)

    expect(screen.getByText('Data date unavailable')).toBeInTheDocument()
  })

  it('shows "Data date unavailable" for an unparseable dataAsOf', () => {
    render(<Footer dataAsOf="not-a-date" />)

    expect(screen.getByText('Data date unavailable')).toBeInTheDocument()
  })

  it('shows a formatted date (year/month only, to avoid timezone-dependent day flakiness) for a valid ISO string', () => {
    render(<Footer dataAsOf="2026-01-15T12:00:00.000Z" />)

    expect(screen.getByText(/^Data as of .*2026/)).toBeInTheDocument()
  })
})
