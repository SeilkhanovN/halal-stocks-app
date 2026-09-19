import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import './StockDetailPanel.css'
import { ApiError } from '../../api/client.ts'
import { useStockDetail } from '../../hooks/useStockDetail.ts'
import { HalalBadge } from '../HalalBadge/HalalBadge.tsx'
import { RatioRow } from '../RatioRow/RatioRow.tsx'
import { DISCLAIMER } from '../Footer/Footer.tsx'
import type { StockDetail } from '../../api/types.ts'

interface StockDetailPanelProps {
  ticker: string
  onClose: () => void
}

const HEADING_ID = 'stock-detail-panel-heading'

// Same selector list the spec calls for: everything a screen reader / the
// browser itself would consider tab-stoppable, scoped to descendants of the
// dialog root at trap time (not cached — RatioRow/Retry/etc. can change the
// set across renders).
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function formatMarketCap(marketCap: number | null): string {
  if (marketCap === null) {
    return 'Market cap unavailable'
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(marketCap)
}

// Duplicated from Footer.tsx's own dateAsOf formatter on purpose (~3 lines):
// that helper is coupled to Footer's "Data as of" wording, this one to
// "Screened on" — formatting-logic duplication, not the disclaimer-string
// duplication the task explicitly warns against.
function formatScreenedAt(screenedAt: string | null): string {
  if (screenedAt === null) {
    return 'Screening date unavailable'
  }
  const date = new Date(screenedAt)
  if (Number.isNaN(date.getTime())) {
    return 'Screening date unavailable'
  }
  return `Screened on ${new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(date)}`
}

interface StockDetailBodyProps {
  data: StockDetail
  isFetching: boolean
}

function StockDetailBody({ data, isFetching }: StockDetailBodyProps) {
  const { screening } = data

  return (
    <div className="stock-detail-panel__body" aria-busy={isFetching}>
      <p className="stock-detail-panel__meta">
        {data.ticker} · {data.exchange ?? 'Exchange unknown'} · {data.industry ?? 'Industry unavailable'}
      </p>
      <HalalBadge status={data.halalStatus} />
      <p className="stock-detail-panel__market-cap">{formatMarketCap(data.marketCap)}</p>

      <section>
        <h3>Business activity</h3>
        <p>{screening.businessActivity.industry ?? 'Industry not available'}</p>
        <p>{screening.businessActivity.explanation}</p>
      </section>

      <section>
        <h3>Ratios</h3>
        {screening.ratios.map((ratio) => (
          <RatioRow key={ratio.key} ratio={ratio} />
        ))}
      </section>

      {screening.reasons.length > 0 ? (
        <section>
          <h3>Reasons</h3>
          <ul>
            {screening.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="stock-detail-panel__screened-at">{formatScreenedAt(screening.screenedAt)}</p>
      <p className="stock-detail-panel__disclaimer">{DISCLAIMER}</p>
    </div>
  )
}

export function StockDetailPanel({ ticker, onClose }: StockDetailPanelProps) {
  const { data, isPending, isError, isFetching, error, refetch } = useStockDetail(ticker)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)

  // Chosen over the dialog container itself because the close button is
  // concrete, always present in every load/error/success state below, and
  // easy to assert on in tests.
  useEffect(() => {
    closeButtonRef.current?.focus()
  }, [])

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      onClose()
      return
    }

    if (event.key !== 'Tab') {
      return
    }

    const root = dialogRef.current
    if (!root) {
      return
    }

    const focusables = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    if (focusables.length === 0) {
      return
    }

    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    if (!first || !last) {
      return
    }
    const active = document.activeElement

    if (event.shiftKey) {
      if (active === first || !root.contains(active)) {
        event.preventDefault()
        last.focus()
      }
    } else if (active === last || !root.contains(active)) {
      event.preventDefault()
      first.focus()
    }
  }

  let heading: string
  let body: ReactNode

  if (isPending) {
    heading = `Loading ${ticker}…`
    body = <p aria-live="polite">Loading stock details…</p>
  } else if (isError) {
    if (error instanceof ApiError && error.code === 'STOCK_NOT_FOUND') {
      heading = 'Stock not found'
      body = null
    } else {
      heading = `Error loading ${ticker}`
      const message = error instanceof Error ? error.message : 'Unknown error'
      body = (
        <>
          <p>Something went wrong loading stock details.</p>
          <p>{message}</p>
          <button type="button" onClick={() => void refetch()}>
            Retry
          </button>
        </>
      )
    }
  } else if (data) {
    heading = `${data.ticker} · ${data.name}`
    body = <StockDetailBody data={data} isFetching={isFetching} />
  } else {
    // Unreachable in practice (TanStack Query's isPending/isError/success
    // are mutually exclusive), kept only so `heading`/`body` are always
    // assigned for TypeScript.
    heading = ticker
    body = null
  }

  return (
    <div className="stock-detail-panel__overlay">
      <div className="stock-detail-panel__backdrop" onClick={onClose} />
      <div
        ref={dialogRef}
        className="stock-detail-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={HEADING_ID}
        onKeyDown={handleKeyDown}
      >
        <div className="stock-detail-panel__header">
          <h2 id={HEADING_ID}>{heading}</h2>
          <button
            type="button"
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="Close stock details"
          >
            Close
          </button>
        </div>
        {body}
      </div>
    </div>
  )
}
