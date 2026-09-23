# Stock Compliance — MVP

A stock list you can search by ticker or company name, with a compliant /
non-compliant / unknown badge, a detail panel explaining the verdict, and
favorites. Two independent services meant to be dockerized separately
later: `backend/` (Fastify API) and `frontend/` (React UI).

## Status

**The full MVP feature set is built** (milestones M1–M4 complete; see
`activity.md` for the dated history of how each piece landed):

- Search by ticker or company name, debounced, paginated.
- A compliant / non-compliant / unknown badge per stock, plus a status filter.
- Favorite/unfavorite a stock, with a "favorites only" toggle — persisted
  in SQLite.
- A detail panel per stock: each AAOIFI ratio vs its limit, the
  business-activity check, plain-language reasons, and the disclaimer.

**Universe:** S&P 500 only (503 tickers), from a checked-in snapshot.
NASDAQ-100 is deferred — see `backend/data/constituents/README.md`.

Nothing described in this README is "not built yet" — this is the last
task of the MVP (`DOC-01`).

## Prerequisites

```powershell
node --version   # need Node 24+
```

- The **offline path** (below) needs no API keys at all.
- The **live path** needs two free credentials, only if you want real
  Finnhub/SEC EDGAR data instead of the 6 built-in fixtures:
  - A [Finnhub](https://finnhub.io/register) free-tier API key.
  - A SEC EDGAR `User-Agent` string identifying you, per SEC's fair-access
    policy — app name plus a contact email, e.g.
    `"StockCompliance contact@example.com"` (use your own contact address,
    not this placeholder).

## Quick start

Two terminals, from the repo root. Start with the offline path — it needs
no keys and no wait.

### Offline (no API keys, 6 fixture stocks)

**Terminal 1 — backend:**

```powershell
cd backend
npm install
npm run seed:fixtures
npm run dev
```

**Terminal 2 — frontend:**

```powershell
cd frontend
npm install
npm run dev
```

Then open http://localhost:5173.

`seed:fixtures` screens 6 known-answer stocks from checked-in fixture
data (no network calls), which doubles as a smoke test:

| Ticker | Status | Why |
|---|---|---|
| AAPL | halal | passes all three ratios |
| JPM | not_halal | prohibited industry (Banking) |
| T | not_halal | debt/market cap breach |
| STZ | not_halal | ticker-level denylist (alcohol producer) |
| ASML | unknown | IFRS filer, no US-GAAP financials |
| NO_INTEREST | unknown | interest income not reported |

### Live (optional, real data, needs keys, ~35 min)

```powershell
cd backend
npm install
copy .env.example .env   # then fill in FINNHUB_API_KEY and SEC_USER_AGENT
npm run seed:constituents   # loads 503 S&P 500 identities, no keys needed
npm run seed                # fetches + screens every ticker — measured ~35 min
npm run dev
```

Then, in a second terminal, `cd frontend && npm install && npm run dev`
and open http://localhost:5173 as above.

For a fast smoke run instead of the full ~35 minutes, use
`npm run seed -- --limit 10` to screen only the first 10 tickers.

## What you can do today

- Search by ticker (e.g. `aapl`) or company name (e.g. `microsoft`),
  case-insensitive, debounced 250 ms after you stop typing.
- Page through results with Prev/Next.
- See a Compliant / Non-compliant / Unknown badge on every row, and filter the
  list with the status chips (All / Compliant / Non-compliant / Unknown).
- Star a stock to favorite it (updates instantly), and toggle "Favorites
  only" to see just your starred stocks.
- Click (or press Enter on) a row to open its detail panel: each ratio
  vs its limit with a pass/breach/not-available indicator, the
  business-activity result, the plain-language reasons for the verdict,
  and the disclaimer.

## Where the data comes from

The stock list starts from a checked-in snapshot of the S&P 500 at
`backend/data/constituents/sp500.csv` (503 rows), loaded into SQLite by
`npm run seed:constituents`. See `backend/data/constituents/README.md`
for the snapshot source URL, date, and how to refresh it.

The live path fills in financials and a halal verdict from two external
sources, both called only by the seed job, never at request time:

- **Finnhub** `/stock/profile2` — name, exchange, industry, market cap.
- **SEC EDGAR** `companyfacts` — total debt, cash + securities, interest
  income, revenue (via US-GAAP XBRL tags).

The API only ever reads from its own SQLite database — no external API
is called while the app is running or in response to a request.

## Environment variables

All four are read by the backend from `backend/.env` (copy
`backend/.env.example` to start). None are required for the offline path.

| Variable | Purpose | Required for | Default |
|---|---|---|---|
| `FINNHUB_API_KEY` | Finnhub API key for `/stock/profile2` | Live seeding only | none — startup error if missing in live mode |
| `SEC_USER_AGENT` | User-Agent sent on every SEC EDGAR request (name + contact email), per SEC's fair-access policy | Live seeding only | none — startup error if missing in live mode |
| `DATABASE_PATH` | SQLite file path | Always (has a default) | `backend/data/halal-stocks.db` |
| `PORT` | Port the API server listens on | Always (has a default) | `3000` |

## Methodology

Screening is computed in-house from AAOIFI financial ratios — no paid
halal-verdict API. Thresholds (`backend/src/config/screening.ts`), all
**strict `<`** (exactly at the limit counts as a breach):

| Ratio | Limit |
|---|---|
| Debt / market cap | < 30% |
| (Cash + short-term investments + marketable securities) / market cap | < 30% |
| Interest income (TTM) / revenue (TTM) | < 5% |

Status is resolved in this order:

1. Prohibited industry or ticker (denylist) → `not_halal`.
2. Any **computable** ratio breaches its limit → `not_halal` (a breach
   always wins over missing data elsewhere).
3. Any ratio that isn't computable, a missing industry, an IFRS/foreign
   filer, or a fetch failure → `unknown`.
4. Otherwise → `halal`.

Every result carries plain-language reasons for its status.

To change a threshold, edit the one config module
`backend/src/config/screening.ts` and reapply it to already-fetched data
with no network calls:

```powershell
npm run seed -- --rescreen
```

## Known limitations

Ordered by user-facing impact, measured against the first full live seed
(503/503 S&P 500 stocks, 2026-09-19):

1. **~41% of the S&P 500 screens `unknown`** (halal 144/29%, not_halal
   154/31%, unknown 205/41%) — a data-availability limit, not a bug.
   Breakdown: 144 "Interest income not reported", 53 "TTM approximated
   from latest full fiscal year", 22 "Total debt not reported", 8
   "Revenue not reported".
2. **Financial-ratio screen only — no revenue-segment analysis.**
   Mixed-business companies may be classified differently than
   commercial screeners (Zoya, Musaffa), which analyze revenue lines.
   Concretely: the `Casinos & Gaming` denylist entry matches zero real
   Finnhub industry labels (Finnhub files casinos under "Hotels,
   Restaurants & Leisure"); MGM/WYNN/LVS are `not_halal` today only
   because of heavy debt, not a business-activity match.
3. **The 5% rule counts interest income only**, not other
   prohibited-income types.
4. **Uses current market cap, not a trailing average** — a stock near a
   threshold can flip status between seed runs. Worked example: AKAM is
   `not_halal` on cash+securities at 30.7% vs the 30% limit (0.7
   percentage points over), with its debt figure missing entirely.
5. **IFRS/foreign filers with no US-GAAP data** (e.g. ASML) always
   resolve to `unknown` — out of scope for the MVP.
6. **Finnhub's free tier is personal-use only** — check its terms before
   any production use.
7. **EDGAR data can be up to a quarter old**; this is also why some TTM
   figures are approximated from the latest fiscal year instead of four
   discrete quarters (see limitation 1).
8. **A ratio of exactly 0% is a real, distinct result** from "Not
   available" — 16 stocks are genuinely debt-free (e.g. ANET, CMG) vs
   246 with an unreported ratio (`null`). The UI shows these
   differently; don't read one as the other.

## Disclaimer

> Automated screen based on AAOIFI financial ratios only — revenue from
> non-permissible business lines is not analysed. Not a fatwa or
> financial advice.

This is not a fatwa or financial advice — do your own due diligence
before acting on any status shown here.

## Database

SQLite, single file at `backend/data/halal-stocks.db` (gitignored — it's
generated locally by seeding, not checked in). Override the location
with the `DATABASE_PATH` environment variable (see Environment variables
above).

It's a plain file with no server process to install or run.

To reset it:

1. Stop the backend dev server.
2. Delete `backend/data/halal-stocks.db` and any `-wal` / `-shm` files
   next to it.
3. Re-run `npm run seed:constituents` and/or `npm run seed:fixtures` /
   `npm run seed`.

## Scripts

Each service's scripts are documented once, in its own README, to avoid
the two copies drifting apart:

- Backend scripts: see `backend/README.md`.
- Frontend scripts: see `frontend/README.md`.

## Troubleshooting

**`EADDRINUSE` on port 3000 or 5173** — something else is already
listening on that port. Stop it, or run on another port:
- Backend: set `PORT` in `backend/.env` (or `$env:PORT=3001` before
  `npm run dev`).
- Frontend: `npm run dev -- --port 5174`.

**"No stock data yet"** — the `stocks` table is empty.
- Offline: run `npm run seed:fixtures` from `backend/`.
- Live: run `npm run seed:constituents` then `npm run seed` from
  `backend/`.

**"`.env` not found. Continuing without it."** — harmless if you're on
the offline path, which needs no env vars. On the live path, copy
`backend/.env.example` to `backend/.env` and fill it in.

**The live seed is slow** — measured ~35 minutes for all 503 tickers.
It's throttled (Finnhub ≤ 55 req/min, EDGAR ≤ 8 req/s) and resumable:
Ctrl+C stops cleanly after the ticker in flight, and the next run skips
any ticker screened within the last 7 days unless you pass `--force`.
Use `npm run seed -- --limit 10` for a quick smoke run instead.

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
