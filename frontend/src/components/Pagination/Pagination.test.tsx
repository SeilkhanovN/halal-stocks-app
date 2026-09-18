import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Pagination } from './Pagination.tsx'

describe('Pagination', () => {
  it('renders nothing when totalPages is 0', () => {
    const { container } = render(
      <Pagination page={1} totalPages={0} onPageChange={vi.fn()} />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when totalPages is 1', () => {
    const { container } = render(
      <Pagination page={1} totalPages={1} onPageChange={vi.fn()} />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('disables Prev on the first page', () => {
    render(<Pagination page={1} totalPages={5} onPageChange={vi.fn()} />)

    expect(screen.getByRole('button', { name: /prev/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /next/i })).toBeEnabled()
  })

  it('disables Next on the last page', () => {
    render(<Pagination page={5} totalPages={5} onPageChange={vi.fn()} />)

    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /prev/i })).toBeEnabled()
  })

  it('calls onPageChange with page + 1 when Next is clicked', async () => {
    const user = userEvent.setup()
    const onPageChange = vi.fn()
    render(<Pagination page={2} totalPages={5} onPageChange={onPageChange} />)

    await user.click(screen.getByRole('button', { name: /next/i }))

    expect(onPageChange).toHaveBeenCalledWith(3)
  })

  it('calls onPageChange with page - 1 when Prev is clicked', async () => {
    const user = userEvent.setup()
    const onPageChange = vi.fn()
    render(<Pagination page={2} totalPages={5} onPageChange={onPageChange} />)

    await user.click(screen.getByRole('button', { name: /prev/i }))

    expect(onPageChange).toHaveBeenCalledWith(1)
  })

  it('shows "Page 2 of 5"', () => {
    render(<Pagination page={2} totalPages={5} onPageChange={vi.fn()} />)

    expect(screen.getByText('Page 2 of 5')).toBeInTheDocument()
  })
})
