# Halal Stocks — MVP

A stock list you can search by ticker or company name. Two independent
services meant to be dockerized separately later: `backend/` (Fastify API)
and `frontend/` (React UI).

## Status

**Milestone M1 (search) works end to end.** You can search the S&P 500
by ticker or company name, page through results, and clear the search.

**Not built yet:**
- Halal / not-halal / unknown badges — every stock currently shows no
  halal status, since the screening pipeline (M2) hasn't run.
- Favorite/unfavorite (M4).
- The stock detail side panel (M3).

**Universe:** S&P 500 only (503 tickers) from a checked-in snapshot.
NASDAQ-100 is deferred — see `backend/data/constituents/README.md`.

## Prerequisites

```powershell
node --version   # need Node 24+
```

No API keys are needed for this milestone — the search MVP only reads
the checked-in S&P 500 snapshot, no external stock-data or screening API
is called.

## Quick start

Two terminals, from the repo root.

**Terminal 1 — backend:**

```powershell
cd backend
npm install
npm run seed:constituents
npm run dev
```

**Terminal 2 — frontend:**

```powershell
cd frontend
npm install
npm run dev
```

Then open http://localhost:5173.

The backend listens on http://localhost:3000; the frontend's Vite dev
server proxies `/api/*` to it (stripping the `/api` prefix), so the
browser only ever talks to `localhost:5173`.

## What you can do today

- Search by ticker (e.g. `aapl`) or company name (e.g. `microsoft`),
  case-insensitive, debounced 250 ms after you stop typing.
- Page through results with Prev/Next.
- Clear the search to go back to the full list.

Every stock currently shows no halal status — the AAOIFI screening
pipeline (the screening seed job, thresholds, badge column) is a later
milestone and hasn't been built yet, so there's nothing to display there.

## Where the data comes from

The stock list is a checked-in snapshot of the S&P 500 at
`backend/data/constituents/sp500.csv` (503 rows), loaded into SQLite by
`npm run seed:constituents`. No external API is called at request time —
the backend only ever reads from its own SQLite database.

See `backend/data/constituents/README.md` for the snapshot source URL,
snapshot date, and how to refresh it.

## Database

SQLite, single file at `backend/data/halal-stocks.db` (gitignored — it's
generated locally by seeding, not checked in). Override the location with
the `DATABASE_PATH` environment variable.

It's a plain file with no server process to install or run.

To reset it:

1. Stop the backend dev server.
2. Delete `backend/data/halal-stocks.db` and any `-wal` / `-shm` files
   next to it.
3. Re-run `npm run seed:constituents`.

## Scripts

### backend/

| Command | Runs |
|---|---|
| `npm run dev` | `tsx watch --env-file-if-exists=.env src/server.ts` |
| `npm run seed:constituents` | `tsx --env-file-if-exists=.env src/scripts/seed-constituents.ts` |
| `npm run build` | `tsc -p tsconfig.build.json` |
| `npm start` | `node --env-file-if-exists=.env dist/server.js` |
| `npm test` | `vitest run` |
| `npm run lint` | `eslint .` |
| `npm run typecheck` | `tsc --noEmit` |

### frontend/

| Command | Runs |
|---|---|
| `npm run dev` | `vite` |
| `npm run build` | `tsc -b && vite build` |
| `npm run preview` | `vite preview` |
| `npm test` | `vitest run` |
| `npm run lint` | `eslint .` |
| `npm run typecheck` | `tsc -b` |

## Troubleshooting

**`EADDRINUSE` on port 3000 or 5173** — something else is already
listening on that port. Stop it, or run on another port:
- Backend: set `PORT` in `backend/.env` (or `$env:PORT=3001` before
  `npm run dev`).
- Frontend: `npm run dev -- --port 5174`.

**"No stock data yet. Run `npm run seed:constituents`"** — the `stocks`
table is empty. Run `npm run seed:constituents` from `backend/` (see
Quick start above).

**"`.env` not found. Continuing without it."** — harmless. `--env-file-if-exists`
just means no `.env` file exists yet; this milestone needs no env vars.

## Project layout

```
.
├── backend/      # Node.js + TypeScript + Fastify — the API
├── frontend/     # React + TypeScript + Vite — the UI
├── .claude/      # Claude Code pipeline: agents, commands, settings
├── prd.md        # task list (source of truth) + API contract
├── activity.md   # dated history of what happened per task
├── prompt.md     # definition of done / how to verify
└── CLAUDE.md     # project context + workflow rules, loaded every session
```

## Why two separate services

`backend/` and `frontend/` each get their own `package.json`,
`node_modules`, and (later) `Dockerfile` — there's no shared tooling
between them on purpose, so each can be built, tested, and deployed
independently once this moves to Docker.
