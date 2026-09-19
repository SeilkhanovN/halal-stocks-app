import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HalalBadge } from './HalalBadge.tsx'

describe('HalalBadge', () => {
  it('renders the "Halal" label inside a halal-badge--halal element', () => {
    render(<HalalBadge status="halal" />)

    const label = screen.getByText('Halal')
    expect(label.closest('.halal-badge--halal')).not.toBeNull()
  })

  it('renders the "Not halal" label inside a halal-badge--not_halal element', () => {
    render(<HalalBadge status="not_halal" />)

    const label = screen.getByText('Not halal')
    expect(label.closest('.halal-badge--not_halal')).not.toBeNull()
  })

  it('renders the "Unknown" label inside a halal-badge--unknown element', () => {
    render(<HalalBadge status="unknown" />)

    const label = screen.getByText('Unknown')
    expect(label.closest('.halal-badge--unknown')).not.toBeNull()
  })
})
