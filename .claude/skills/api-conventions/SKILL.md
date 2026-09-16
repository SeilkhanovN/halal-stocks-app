---
name: api-conventions
description: API and data-model conventions for the halal-stocks backend — load when writing or reviewing backend/ code or the API contract the frontend consumes.
---

# API conventions — halal-stocks backend

## Endpoints (MVP scope)
- `GET /stocks` — paginated list. Query params: `page`, `limit`, `search`
  (matches ticker or company name).
- `GET /stocks/:ticker` — single stock detail, including halal status.
- `GET /stocks/:ticker/halal-status` — just the screening result and the
  ratios that produced it (debt/market-cap, cash+securities/market-cap,
  interest-income/revenue), so the frontend can show "why."
- `GET /favorites` — the current user's favorited tickers.
- `POST /favorites/:ticker` — add a favorite.
- `DELETE /favorites/:ticker` — remove a favorite.

## Shapes
- JSON bodies: camelCase keys.
- List endpoints always paginate — never return an unbounded array.
- Halal status is one of exactly three values: `"halal"`, `"not_halal"`,
  `"unknown"` — never a boolean. `"unknown"` covers missing financial
  data, not "probably fine."
- Every halal-status response includes the ratios used and which
  threshold (if any) was breached, in plain language — don't return a
  bare label with no explanation.

## Error handling
- Never swallow exceptions silently — log with context or re-raise.
- User-facing errors: `{ "error": { "code": "...", "message": "..." } }`.
- If the external stock-data API is down or rate-limited, return a clear
  `503`-style error rather than a stale or fabricated halal status —
  wrong financial/religious-compliance data is worse than no data.

## File structure (backend/src)
- One route/handler per file under `routes/`.
- Halal-ratio calculation logic lives in its own module (`lib/halal-screen.ts`
  or similar), separate from the route handler, so it's independently
  testable against the AAOIFI thresholds without spinning up the server.
- Shared types (e.g. the `HalalStatus` shape) go in a `types/` module
  imported by both routes and the screening logic — don't duplicate the
  shape definition.
