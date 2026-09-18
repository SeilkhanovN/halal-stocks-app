import { useEffect, useState } from 'react'

// Trailing-edge debounce: the initial value is returned immediately, and
// each subsequent change is delayed by `delayMs`. Rapid changes within the
// window collapse into a single update once things settle.
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value)
    }, delayMs)

    return () => {
      clearTimeout(timer)
    }
  }, [value, delayMs])

  return debounced
}
