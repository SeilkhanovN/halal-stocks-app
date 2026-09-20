import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FavoriteButton } from './FavoriteButton.tsx'

vi.mock('../../api/client.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/client.ts')>()
  return { ...actual, addFavorite: vi.fn(), removeFavorite: vi.fn() }
})

const { addFavorite, removeFavorite } = await import('../../api/client.ts')
const addFavoriteMock = vi.mocked(addFavorite)
const removeFavoriteMock = vi.mocked(removeFavorite)

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  addFavoriteMock.mockReset()
  removeFavoriteMock.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('FavoriteButton', () => {
  it('renders an unpressed star with an "Add" label when not a favorite', () => {
    renderWithClient(<FavoriteButton ticker="AAPL" isFavorite={false} />)

    const button = screen.getByRole('button', { name: 'Add AAPL to favorites' })
    expect(button).toHaveAttribute('aria-pressed', 'false')
  })

  it('renders a pressed star with a "Remove" label when a favorite', () => {
    renderWithClient(<FavoriteButton ticker="AAPL" isFavorite={true} />)

    const button = screen.getByRole('button', { name: 'Remove AAPL from favorites' })
    expect(button).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows a role="status" error and reverts on a rejected mutation, dismissible via its button', async () => {
    addFavoriteMock.mockRejectedValue(new Error('boom'))
    const user = userEvent.setup()
    renderWithClient(<FavoriteButton ticker="AAPL" isFavorite={false} />)

    await user.click(screen.getByRole('button', { name: 'Add AAPL to favorites' }))

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent("Couldn't update favorite for AAPL.")
    expect(screen.getByRole('button', { name: 'Add AAPL to favorites' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )

    await user.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('ignores a second click while the first mutation is still pending, calling the API exactly once', async () => {
    let resolveMutation: (value: { ticker: string }) => void = () => {}
    addFavoriteMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMutation = resolve
        }),
    )
    const user = userEvent.setup()
    renderWithClient(<FavoriteButton ticker="AAPL" isFavorite={false} />)

    const button = screen.getByRole('button', { name: 'Add AAPL to favorites' })
    await user.click(button)
    await user.click(button)

    expect(addFavoriteMock).toHaveBeenCalledTimes(1)

    await waitFor(() => resolveMutation({ ticker: 'AAPL' }))

    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })
  })

  it('releases the double-click guard after a failed mutation, allowing a retry click to call the API again', async () => {
    // pendingRef is reset in the mutate-call-level onSettled, which fires on
    // rejection too. If that regressed (e.g. moved into an onSuccess-only
    // path), a single failed toggle would permanently freeze this star — the
    // other tests wouldn't catch that since they only ever click once after
    // a rejection.
    addFavoriteMock.mockRejectedValueOnce(new Error('boom'))
    const user = userEvent.setup()
    renderWithClient(<FavoriteButton ticker="AAPL" isFavorite={false} />)

    const button = screen.getByRole('button', { name: 'Add AAPL to favorites' })
    await user.click(button)

    await screen.findByRole('status')
    expect(addFavoriteMock).toHaveBeenCalledTimes(1)

    addFavoriteMock.mockResolvedValueOnce({ ticker: 'AAPL' })
    await user.click(button)

    await waitFor(() => {
      expect(addFavoriteMock).toHaveBeenCalledTimes(2)
    })
  })
})
