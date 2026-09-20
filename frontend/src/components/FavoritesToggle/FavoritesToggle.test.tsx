import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FavoritesToggle } from './FavoritesToggle.tsx'

describe('FavoritesToggle', () => {
  it('renders an unchecked checkbox with the accessible name "Favorites only"', () => {
    render(<FavoritesToggle checked={false} onChange={vi.fn()} />)

    expect(screen.getByRole('checkbox', { name: 'Favorites only' })).not.toBeChecked()
  })

  it('renders checked when checked is true', () => {
    render(<FavoritesToggle checked={true} onChange={vi.fn()} />)

    expect(screen.getByRole('checkbox', { name: 'Favorites only' })).toBeChecked()
  })

  it('calls onChange(true) when clicked while unchecked', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<FavoritesToggle checked={false} onChange={onChange} />)

    await user.click(screen.getByRole('checkbox', { name: 'Favorites only' }))

    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('calls onChange(false) when clicked while checked', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<FavoritesToggle checked={true} onChange={onChange} />)

    await user.click(screen.getByRole('checkbox', { name: 'Favorites only' }))

    expect(onChange).toHaveBeenCalledWith(false)
  })
})
