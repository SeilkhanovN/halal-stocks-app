// Typed fetch wrapper for the backend API. Talks to the Vite dev proxy at
// /api (see vite.config.ts), which forwards to the Fastify backend and
// strips the prefix, so no CORS handling is needed here.

import type { ApiErrorBody, ListStocksParams, Paginated, StockSummary } from './types.ts'

export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

const API_BASE = '/api'

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof value.error === 'object' &&
    value.error !== null &&
    'code' in value.error &&
    'message' in value.error &&
    typeof value.error.code === 'string' &&
    typeof value.error.message === 'string'
  )
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text()
  if (text === '') {
    return undefined
  }
  try {
    // JSON.parse's return type is already `any`, which is assignable to
    // this function's declared `unknown` return type without a cast.
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'name' in err && err.name === 'AbortError'
}

// Returns `T | undefined` rather than `T` so a 204 No Content response can
// be represented honestly (there is no body to trust as T) without an
// unsound cast. Callers for endpoints that always return a body (like
// fetchStocks below) narrow the `undefined` case away explicitly.
export async function request<T>(path: string, init?: RequestInit): Promise<T | undefined> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, init)
  } catch (err) {
    // A cancelled request (TanStack Query aborts on key change / unmount) is
    // not a network failure — rethrow it untouched so it isn't retried or
    // shown as an error.
    if (init?.signal?.aborted || isAbortError(err)) {
      throw err
    }
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server')
  }

  if (res.status === 204) {
    return undefined
  }

  const body = await readBody(res)

  if (!res.ok) {
    if (isApiErrorBody(body)) {
      throw new ApiError(res.status, body.error.code, body.error.message)
    }
    throw new ApiError(res.status, `HTTP_${res.status}`, res.statusText || 'Request failed')
  }

  // Trusted cast: the response contract is defined in src/api/types.ts
  // (mirroring backend/src/types/api.ts and halal.ts). Runtime validation
  // of the body shape is out of scope for the MVP client.
  return body as T
}

export function buildStocksQuery(params: ListStocksParams): string {
  const qs = new URLSearchParams()

  if (params.page !== undefined) {
    qs.set('page', String(params.page))
  }
  if (params.limit !== undefined) {
    qs.set('limit', String(params.limit))
  }
  if (params.search !== undefined) {
    const trimmed = params.search.trim()
    if (trimmed !== '') {
      qs.set('search', trimmed)
    }
  }
  if (params.status !== undefined) {
    qs.set('status', params.status)
  }

  const qsString = qs.toString()
  return qsString === '' ? '' : `?${qsString}`
}

export async function fetchStocks(
  params: ListStocksParams = {},
  signal?: AbortSignal,
): Promise<Paginated<StockSummary>> {
  const body = await request<Paginated<StockSummary>>(`/stocks${buildStocksQuery(params)}`, {
    signal,
  })
  if (body === undefined) {
    // GET /stocks always returns a body; this only guards the type and
    // should never be reachable in practice.
    throw new ApiError(0, 'EMPTY_RESPONSE', 'Expected a response body from GET /stocks')
  }
  return body
}

export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError) {
    if (error.status === 503) {
      return false
    }
    if (error.status >= 400 && error.status <= 499) {
      return false
    }
  }
  return failureCount < 1
}
