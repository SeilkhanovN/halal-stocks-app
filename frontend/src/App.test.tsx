import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App.tsx'

// App now renders StockSearch (MVP-04), which calls useQuery and therefore
// needs a QueryClientProvider in the tree. fetchStocks is mocked to a
// never-resolving promise so this test only asserts the shell renders,
// without depending on network/query state.
vi.mock('./api/client.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api/client.ts')>()
  return { ...actual, fetchStocks: vi.fn(() => new Promise(() => {})) }
})

describe('App', () => {
  it('renders the app shell with a "Stock Compliance" heading', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>,
    )

    expect(screen.getByRole('heading', { name: /stock compliance/i })).toBeInTheDocument()
  })
})
