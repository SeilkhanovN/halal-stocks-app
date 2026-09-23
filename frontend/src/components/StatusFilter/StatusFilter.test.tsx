import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StatusFilter } from './StatusFilter.tsx'

describe('StatusFilter', () => {
  it('renders a radiogroup with the accessible name "Filter by compliance status"', () => {
    render(<StatusFilter value="all" onChange={vi.fn()} />)

    expect(
      screen.getByRole('radiogroup', { name: /filter by compliance status/i }),
    ).toBeInTheDocument()
  })

  it('renders four radio options with the correct accessible names', () => {
    render(<StatusFilter value="all" onChange={vi.fn()} />)

    expect(screen.getAllByRole('radio')).toHaveLength(4)
    expect(screen.getByRole('radio', { name: 'All' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Compliant' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Non-compliant' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Unknown' })).toBeInTheDocument()
  })

  it('calls onChange("not_halal") when "Non-compliant" is clicked', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<StatusFilter value="all" onChange={onChange} />)

    await user.click(screen.getByRole('radio', { name: 'Non-compliant' }))

    expect(onChange).toHaveBeenCalledWith('not_halal')
  })

  it('calls onChange("all") when "All" is clicked', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<StatusFilter value="halal" onChange={onChange} />)

    await user.click(screen.getByRole('radio', { name: 'All' }))

    expect(onChange).toHaveBeenCalledWith('all')
  })

  it('fires onChange for an unchecked radio via keyboard focus + Space', async () => {
    // Native same-name radio groups are a single Tab stop: Tab lands on the
    // currently-checked radio, and a real browser then requires arrow keys to
    // move focus to an unchecked sibling before Space/click activates it (as
    // confirmed here: a second Tab moves focus OUT of the group entirely,
    // since jsdom's user-event correctly models the single-tab-stop
    // grouping). jsdom does not implement the arrow-key-moves-focus behavior
    // itself (that's UA chrome, not DOM/ARIA), so per the spec's jsdom note
    // this test does not simulate ArrowRight. Instead it confirms Tab reaches
    // the group's checked radio, then focuses the unchecked "Non-compliant"
    // radio directly (standing in for the arrow-key move a real browser would
    // perform) and asserts Space activates it and fires onChange — proving
    // the keyboard activation handler itself works correctly.
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<StatusFilter value="all" onChange={onChange} />)

    await user.tab()
    expect(screen.getByRole('radio', { name: 'All' })).toHaveFocus()

    screen.getByRole('radio', { name: 'Non-compliant' }).focus()
    await user.keyboard(' ')

    expect(onChange).toHaveBeenCalledWith('not_halal')
  })
})
