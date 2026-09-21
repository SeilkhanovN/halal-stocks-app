# frontend

React + TypeScript + Vite UI for halal-stocks: search, halal/not-halal/
unknown badges, a detail panel per stock, and favorites.

## Prerequisites

- Node 24+ (`"engines": { "node": ">=24" }`).
- The backend running on `http://localhost:3000` (its default port) —
  the dev server proxies `/api/*` to it. See `backend/README.md`.

## Install

```powershell
cd frontend
npm install
```

## Dev

```powershell
npm run dev
```

Opens on `http://localhost:5173`. The Vite dev server proxies `/api/*`
to the backend (stripping the `/api` prefix), so the browser only ever
talks to `localhost:5173` and there's no CORS dependency. Override the
proxy target with the `VITE_API_PROXY_TARGET` environment variable if
the backend is running somewhere other than `http://localhost:3000`
(e.g. `$env:VITE_API_PROXY_TARGET="http://localhost:3100"` before
`npm run dev`) — this variable is frontend-only and dev-only; it has no
effect on a production build.

## Scripts

| Command | Runs |
|---|---|
| `npm run dev` | `vite` |
| `npm run build` | `tsc -b && vite build` |
| `npm run preview` | `vite preview` |
| `npm test` | `vitest run` |
| `npm run lint` | `eslint .` |
| `npm run typecheck` | `tsc -b` |

## Testing

Vitest + React Testing Library + jsdom + `@testing-library/user-event` +
`@testing-library/jest-dom`. The API client is mocked in every test — no
real network calls. Each component's styles and tests are colocated
next to it (`.tsx` / `.css` / `.test.tsx` in the same folder).

## Current layout

```
frontend/
├── src/
│   ├── components/
│   │   ├── StockSearch/        # search input + page state (debounce, status, favoritesOnly)
│   │   ├── StockTable/         # ticker/name/industry/badge/★ table
│   │   ├── Pagination/         # Prev/Next, "Page X of Y"
│   │   ├── HalalBadge/         # Halal/Not halal/Unknown badge
│   │   ├── StatusFilter/       # All/Halal/Not halal/Unknown radio chips
│   │   ├── Footer/             # disclaimer + "Data as of <date>"
│   │   ├── StockDetailPanel/   # per-stock ratio/business-activity/reasons panel
│   │   ├── RatioRow/           # one ratio vs its threshold, with a visual bar
│   │   ├── FavoriteButton/     # ★/☆ toggle with optimistic update
│   │   └── FavoritesToggle/    # "Favorites only" checkbox
│   ├── hooks/
│   │   ├── useStocks.ts            # GET /stocks (search/status/favoritesOnly/pagination)
│   │   ├── useDebouncedValue.ts    # 250ms search debounce
│   │   ├── useStockDetail.ts       # GET /stocks/:ticker
│   │   └── useToggleFavorite.ts    # POST/DELETE /favorites/:ticker mutation
│   └── api/
│       ├── client.ts       # typed fetch wrapper, parses { error } into ApiError
│       ├── types.ts        # mirrors the backend API contract (duplicated on purpose)
│       └── query-keys.ts   # TanStack Query key factory
├── package.json
└── vite.config.ts
```
