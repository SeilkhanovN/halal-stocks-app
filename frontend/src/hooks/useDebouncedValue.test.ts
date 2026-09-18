import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useDebouncedValue } from './useDebouncedValue.ts'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useDebouncedValue', () => {
  it('returns the initial value immediately', () => {
    const { result } = renderHook(() => useDebouncedValue('aapl', 250))

    expect(result.current).toBe('aapl')
  })

  it('emits only the last value once, after the delay, for rapid changes', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 250), {
      initialProps: { value: 'a' },
    })

    rerender({ value: 'aa' })
    rerender({ value: 'aap' })
    rerender({ value: 'aapl' })

    expect(result.current).toBe('a')

    act(() => { vi.advanceTimersByTime(250) })

    expect(result.current).toBe('aapl')
  })

  it('does not update before the delay has elapsed', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 250), {
      initialProps: { value: 'a' },
    })

    rerender({ value: 'ab' })
    act(() => { vi.advanceTimersByTime(100) })

    expect(result.current).toBe('a')
  })

  it('does not throw if the component unmounts before the timer fires', () => {
    const { rerender, unmount } = renderHook(({ value }) => useDebouncedValue(value, 250), {
      initialProps: { value: 'a' },
    })

    rerender({ value: 'ab' })
    expect(() => {
      unmount()
      act(() => { vi.advanceTimersByTime(250) })
    }).not.toThrow()
  })

  it('works for a number value', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 250), {
      initialProps: { value: 1 },
    })

    expect(result.current).toBe(1)

    rerender({ value: 2 })
    act(() => { vi.advanceTimersByTime(250) })

    expect(result.current).toBe(2)
  })
})
