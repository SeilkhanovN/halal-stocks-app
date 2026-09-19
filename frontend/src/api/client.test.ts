import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, buildStocksQuery, fetchStocks, request, shouldRetryQuery } from './client.ts'
import { stockKeys } from './query-keys.ts'
import type { Paginated, StockSummary } from './types.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('buildStocksQuery', () => {
  it('builds a query string from page, limit, and a trimmed search', () => {
    expect(buildStocksQuery({ page: 2, limit: 10, search: ' aapl ' })).toBe(
      '?page=2&limit=10&search=aapl',
    )
  })

  it('omits a whitespace-only search', () => {
    expect(buildStocksQuery({ search: '   ' })).toBe('')
  })

  it('returns an empty string for no params', () => {
    expect(buildStocksQuery({})).toBe('')
  })

  it('encodes special characters via URLSearchParams', () => {
    const qs = buildStocksQuery({ search: 'brk b' })
    expect(qs).toBe('?search=brk+b')
  })

  it('includes status when set', () => {
    expect(buildStocksQuery({ status: 'not_halal' })).toBe('?status=not_halal')
  })

  it('omits status when not set', () => {
    expect(buildStocksQuery({ search: 'aapl' })).toBe('?search=aapl')
  })
})

describe('stockKeys.list', () => {
  it('produces a stable key array including the params, deeply equal across separate calls with equal params', () => {
    const params = { page: 2, search: 'aapl' }
    const key1 = stockKeys.list(params)

    expect(key1).toEqual(['stocks', 'list', { page: 2, search: 'aapl' }])

    // A fresh params object with the same fields must still produce a
    // deeply-equal key — TanStack Query hashes/compares keys structurally
    // to decide cache hits, so reference equality of `params` must not
    // matter.
    const key2 = stockKeys.list({ page: 2, search: 'aapl' })
    expect(key2).toEqual(key1)
  })
})

describe('request / fetchStocks', () => {
  it('resolves with typed data on a 200 response', async () => {
    const body: Paginated<StockSummary> = {
      data: [
        {
          ticker: 'AAPL',
          name: 'Apple Inc.',
          exchange: 'NASDAQ',
          industry: 'Technology Hardware',
          halalStatus: 'halal',
          isFavorite: false,
          screenedAt: null,
        },
      ],
      pagination: { page: 1, limit: 25, total: 1, totalPages: 1 },
      meta: { dataAsOf: null },
    }
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify(body), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const controller = new AbortController()
    const result = await fetchStocks({ search: 'aapl' }, controller.signal)

    expect(result).toEqual(body)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/stocks?search=aapl',
      expect.objectContaining({ signal: controller.signal }),
    )
  })

  it('builds the fetch URL correctly with page, limit, and search combined', async () => {
    const body: Paginated<StockSummary> = {
      data: [],
      pagination: { page: 2, limit: 10, total: 0, totalPages: 0 },
      meta: { dataAsOf: null },
    }
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await fetchStocks({ page: 2, limit: 10, search: 'aapl' })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/stocks?page=2&limit=10&search=aapl',
      expect.anything(),
    )
  })

  it('trusts and returns a 200 body as-is even when it does not match the Paginated shape (no runtime validation)', async () => {
    // Documents current, intentional behavior: request()'s "Trusted cast"
    // comment says shape validation is out of scope for the MVP client, so
    // a 200 with the wrong JSON shape is not rejected — it's returned
    // unchanged and only fails later, at the call site, if at all.
    const wrongShape = { foo: 'bar' }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(wrongShape), { status: 200 })),
    )

    const result = await fetchStocks()

    expect(result).toEqual(wrongShape)
  })

  it('falls back to HTTP_400 when a 400 error body is JSON but not the { error: { code, message } } shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ message: 'nope' }), { status: 400 })),
    )

    await expect(fetchStocks()).rejects.toMatchObject({
      status: 400,
      code: 'HTTP_400',
    })
  })

  it('rejects with an ApiError on 503 DATA_NOT_SEEDED', async () => {
    const errorBody = { error: { code: 'DATA_NOT_SEEDED', message: 'No stocks are seeded yet' } }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(errorBody), { status: 503 })),
    )

    await expect(fetchStocks()).rejects.toMatchObject({
      status: 503,
      code: 'DATA_NOT_SEEDED',
      message: 'No stocks are seeded yet',
    })
    await expect(fetchStocks()).rejects.toBeInstanceOf(ApiError)
  })

  it('rejects with an ApiError on 400 VALIDATION_ERROR', async () => {
    const errorBody = { error: { code: 'VALIDATION_ERROR', message: 'limit must be 1-100' } }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(errorBody), { status: 400 })),
    )

    await expect(fetchStocks()).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
    })
  })

  it('falls back to an HTTP_<status> code for a plain-text 500 body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('Internal Server Error', { status: 500 })),
    )

    await expect(fetchStocks()).rejects.toMatchObject({
      status: 500,
      code: 'HTTP_500',
    })
  })

  it('wraps a network failure as ApiError NETWORK_ERROR', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )

    await expect(fetchStocks()).rejects.toMatchObject({
      status: 0,
      code: 'NETWORK_ERROR',
    })
  })

  it('rethrows an AbortError unchanged (a cancelled query is not NETWORK_ERROR)', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw abortError
      }),
    )

    const rejection = fetchStocks({ search: 'aapl' }).catch((err: unknown) => err)
    const err = await rejection
    expect(err).toBe(abortError)
    expect(err).not.toBeInstanceOf(ApiError)
  })

  it('rethrows the original error when the request signal was aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const original = new TypeError('fetch cancelled')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw original
      }),
    )

    await expect(fetchStocks({}, controller.signal)).rejects.toBe(original)
  })

  it('does not throw and does not parse the body on 204', async () => {
    // A stub Response whose text() would throw if called, to prove the
    // 204 branch returns before reading the body.
    const textSpy = vi.fn(() => {
      throw new Error('text() should not be called for a 204 response')
    })
    const fakeResponse = {
      status: 204,
      ok: true,
      statusText: 'No Content',
      text: textSpy,
    } as unknown as Response

    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse))

    await expect(request('/favorites/AAPL', { method: 'DELETE' })).resolves.toBeUndefined()
    expect(textSpy).not.toHaveBeenCalled()
  })
})

describe('shouldRetryQuery', () => {
  it('does not retry a 503 ApiError', () => {
    expect(shouldRetryQuery(0, new ApiError(503, 'DATA_NOT_SEEDED', 'x'))).toBe(false)
  })

  it('does not retry a 404 ApiError', () => {
    expect(shouldRetryQuery(0, new ApiError(404, 'STOCK_NOT_FOUND', 'x'))).toBe(false)
  })

  it('does not retry a 400 ApiError', () => {
    expect(shouldRetryQuery(0, new ApiError(400, 'VALIDATION_ERROR', 'x'))).toBe(false)
  })

  it('retries a 500 ApiError once', () => {
    expect(shouldRetryQuery(0, new ApiError(500, 'INTERNAL_ERROR', 'x'))).toBe(true)
  })

  it('stops retrying a 500 ApiError after one failure', () => {
    expect(shouldRetryQuery(1, new ApiError(500, 'INTERNAL_ERROR', 'x'))).toBe(false)
  })

  it('retries a non-ApiError (e.g. TypeError) on the first failure', () => {
    expect(shouldRetryQuery(0, new TypeError('boom'))).toBe(true)
  })
})
