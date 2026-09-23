# backend

Node.js + TypeScript + Fastify API for Stock Compliance. Serves stock data,
halal screening verdicts, and favorites — always from its own SQLite
database, never by calling an external API at request time.

## Prerequisites

Node 24+ (`"engines": { "node": ">=24" }`).

## Install

```powershell
cd backend
npm install
```

## Environment variables

See the root `README.md`'s "Environment variables" table for the full
list, purposes, and defaults (`FINNHUB_API_KEY`, `SEC_USER_AGENT`,
`DATABASE_PATH`, `PORT`). Copy `.env.example` to `.env` and fill in the
values you need — none are required for `npm run seed:fixtures`.

## Scripts

| Command | Runs | Notes |
|---|---|---|
| `npm run dev` | `tsx watch --env-file-if-exists=.env src/server.ts` | Watch-mode dev server. |
| `npm run seed:constituents` | `tsx --env-file-if-exists=.env src/scripts/seed-constituents.ts` | Loads the 503 S&P 500 identities from `data/constituents/sp500.csv`. No API keys needed. Safe to re-run — only refreshes name/CIK, never touches financials or screening. |
| `npm run seed` | `tsx --env-file-if-exists=.env src/scripts/seed.ts` | Fetches financials (Finnhub + EDGAR) and screens every constituent. Needs `FINNHUB_API_KEY`/`SEC_USER_AGENT`. Flags: `--force` (re-screen tickers screened within the last 7 days instead of skipping them), `--limit N` (only the first N tickers, for a fast smoke run), `--rescreen` (recompute status from already-stored inputs with the current thresholds — zero network calls, use after editing `src/config/screening.ts`). |
| `npm run seed:fixtures` | `tsx --env-file-if-exists=.env src/scripts/seed.ts --fixtures` | Same seed pipeline, but reads checked-in fixture JSON instead of the network. No env vars needed. Works on an empty DB without running `seed:constituents` first — produces exactly 6 fully-screened stocks. |
| `npm run build` | `tsc -p tsconfig.build.json` | Emits `dist/`. |
| `npm start` | `node --env-file-if-exists=.env dist/server.js` | Runs the built server. |
| `npm test` | `vitest run` | |
| `npm run lint` | `eslint .` | |
| `npm run typecheck` | `tsc --noEmit` | |

## Database

SQLite via Node's built-in `node:sqlite` — no database server and no
extra dependency. The path comes from `resolveDatabasePath()`
(`src/db/connection.ts`): the `DATABASE_PATH` env var if set, else
`<backendRoot>/data/halal-stocks.db`. The default file is gitignored —
it's generated locally by seeding, not checked in. Tests use `:memory:`.

## Testing

Vitest, with routes tested via Fastify's `app.inject()` (no real HTTP
server, no open ports). No test makes a real network call — HTTP data
clients (Finnhub, EDGAR) are tested against a mocked `fetch`, and the
seed/screening logic is tested against fixture data or hand-written
literals.

## Current layout

```
backend/
├── src/
│   ├── routes/          # one file per route (see .claude/skills/api-conventions)
│   ├── lib/              # halal-screen.ts, edgar-extract.ts, throttle.ts, ticker.ts, errors.ts
│   ├── db/               # connection.ts, migrations.ts, stocks-repo.ts, favorites-repo.ts
│   ├── sources/          # finnhub-client.ts, edgar-client.ts, fixture-source.ts, data-source.ts, constituents.ts
│   ├── scripts/          # seed-constituents.ts, seed.ts (CLI entry points)
│   ├── config/
│   │   └── screening.ts  # AAOIFI thresholds + denylists — the single source of truth
│   ├── types/            # halal.ts, api.ts
│   ├── app.ts            # buildApp() factory, used by both server.ts and tests
│   └── server.ts         # listens on PORT, no route definitions
├── fixtures/             # finnhub/ and edgar/ JSON used by --fixtures
├── data/
│   └── constituents/     # checked-in S&P 500 snapshot (sp500.csv) + its README
├── package.json
└── tsconfig.json / tsconfig.build.json
```
