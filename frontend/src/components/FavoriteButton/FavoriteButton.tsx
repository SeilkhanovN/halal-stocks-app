import { useRef, type KeyboardEvent, type MouseEvent } from 'react'
import './FavoriteButton.css'
import { useToggleFavorite } from '../../hooks/useToggleFavorite.ts'

interface FavoriteButtonProps {
  ticker: string
  isFavorite: boolean
}

export function FavoriteButton({ ticker, isFavorite }: FavoriteButtonProps) {
  // A synchronous ref, not `mutation.isPending`: the double-click guard must
  // block the SECOND click before React has even re-rendered with the
  // pending state, so it can't depend on render timing. Native `disabled`
  // isn't used either — it drops the button from the tab order and can steal
  // focus mid-interaction. `aria-disabled` below reflects pending for
  // styling only.
  const pendingRef = useRef(false)
  const mutation = useToggleFavorite()

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    // Stops the ancestor <tr>'s onClick (opens the detail panel) from firing.
    event.stopPropagation()
    if (pendingRef.current) return
    pendingRef.current = true
    mutation.mutate(
      { ticker, nextIsFavorite: !isFavorite },
      { onSettled: () => { pendingRef.current = false } },
    )
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    // Only Enter is stopped, not stopped unconditionally: this button also
    // renders inside StockDetailPanel's dialog, whose Tab-trap handler lives
    // on an ANCESTOR div and relies on Tab bubbling up to it. Stopping
    // propagation unconditionally (as originally specified) would silently
    // break that trap whenever the star has focus. Restricting the stop to
    // Enter still blocks the row's onKeyDown (which only acts on Enter)
    // while leaving Tab (and everything else) free to bubble.
    if (event.key === 'Enter') {
      event.stopPropagation()
    }
  }

  function handleDismiss(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation()
    mutation.reset()
  }

  return (
    <span className="favorite-button">
      <button
        type="button"
        className="favorite-button__star"
        aria-pressed={isFavorite}
        aria-label={isFavorite ? `Remove ${ticker} from favorites` : `Add ${ticker} to favorites`}
        aria-disabled={mutation.isPending}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
      >
        <span aria-hidden="true">{isFavorite ? '★' : '☆'}</span>
      </button>
      {mutation.isError ? (
        <span role="status" className="favorite-button__error">
          Couldn't update favorite for {ticker}.
          <button type="button" onClick={handleDismiss}>
            Dismiss
          </button>
        </span>
      ) : null}
    </span>
  )
}
