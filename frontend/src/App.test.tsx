import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from './App.tsx'

describe('App', () => {
  it('renders the app shell with a "Halal Stocks" heading', () => {
    // App doesn't read from TanStack Query yet, so no QueryClientProvider
    // is needed here. Proves the jsdom + RTL + jest-dom wiring from
    // MVP-03 actually works end-to-end.
    render(<App />)

    expect(screen.getByRole('heading', { name: /halal stocks/i })).toBeInTheDocument()
  })
})
