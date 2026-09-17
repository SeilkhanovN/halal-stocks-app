# Definition of done — Halal Stocks MVP

## Preconditions (check before the first iteration)

- `node --version` reports **v24.x or newer**. If it doesn't, stop and tell the user. Don't work around it with a different SQLite library.
- Tasks run in prd.md array order, which is grouped into milestones (see prd.md "Milestones"). Each milestone is a vertical slice through backend and frontend. Each task stays inside its `files` manifest; if a task needs a file outside it, stop and ask.

## Milestone gates

Work is delivered milestone by milestone (M1 Search MVP → M2 Halal badge → M3 Detail panel → M4 Favorites → M5 Docs). **When the last task of a milestone passes, stop and let the user try the app before starting the next milestone** — including during a ralph-loop run (end the iteration with a short summary instead of continuing).

### M1 Search MVP is done when

- All of MVP-01 … MVP-05 have `"passes": true`.
- On a fresh DB with **no API keys**: `cd backend && npm run seed:constituents && npm run dev`, then `cd frontend && npm run dev`, open http://localhost:5173.
- Typing `aap` lists AAPL; typing `microsoft` lists MSFT; clearing the search restores the list; Next/Prev pagination works.
- `curl "http://localhost:5173/api/stocks?search=aapl"` returns AAPL first (proves the Vite proxy → backend path).
- Stopping the backend shows an error state with Retry instead of a blank page.
- `npm run typecheck`, `lint`, `test`, `build` pass in both backend/ and frontend/.
- The halal badge, favorites, detail panel, and disclaimer are intentionally absent in M1.

## What "complete" means (whole project, after M5)

The MVP is complete when **every task in prd.md has `"passes": true`** and all of the following are true on a clean checkout:

1. **Data pipeline**
   - The seed CLI fills SQLite from checked-in fixtures (offline) or from Finnhub + SEC EDGAR (live) for the S&P 500 ∪ NASDAQ-100 universe.
   - It's resumable and throttled, and never stores a fabricated status.
   - `--rescreen` re-applies thresholds without network access.
2. **Screening**
   - The AAOIFI rules (debt/market cap < 30%, cash+securities/market cap < 30%, interest income/revenue < 5%, strict `<`, industry and ticker denylist) live in a pure, tested module.
   - Thresholds live in one config file.
   - The status resolution order is: prohibited industry → any breach → any missing → halal.
   - All three statuses (`halal`, `not_halal`, `unknown`) are produced by real fixture data and covered by tests.
3. **API**
   - Every endpoint in the prd.md API contract exists with exactly those shapes, status codes, and error format.
   - Lists are always paginated. An empty DB → 503 `DATA_NOT_SEEDED`.
   - No external API calls happen at request time.
4. **UI**
   - A paginated table shows ticker, name, industry, halal badge, and star.
   - Search is debounced (ticker prefix / name contains).
   - Status filter chips and a favorites-only toggle work.
   - Favorites use optimistic updates and persist across reloads and server restarts.
   - The detail side panel shows each ratio against its limit with explanations; "not available" is never rendered as 0%.
   - The "data as of" date and the not-a-fatwa disclaimer appear in the footer and the detail panel.
5. **Quality gates** (in both `backend/` and `frontend/`)
   - `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` all exit 0.
   - TypeScript is strict.
   - There is no `any` without a justifying comment.
   - No test makes a real network call.
6. **Docs**
   - The README takes someone from clone to a running app (offline fixture path) in about 5 commands.
   - It documents env vars, the methodology, and known limitations.

## Explicitly out of scope

Don't build any of these without a fresh `/create-prd`:
- Quarterly re-screening, schedulers, or notifications.
- The RAG knowledge-base layer.
- Portfolio tracking.
- Auth, users, or per-user favorites.
- Trailing-average market cap.
- IFRS/foreign-filer financial mapping. Those companies stay `unknown`.
- Purification/dividend-cleansing calculations.
- A user-selectable methodology (AAOIFI vs DJIM toggle).
- Third-party halal-verdict APIs.
- Dockerfiles and deployment.
- A router or URL-synced filter state.
- Stocks outside S&P 500 ∪ NASDAQ-100.

## How to verify the end result actually works

Don't stop at "the code looks plausible". Run these checks, and record the outcome in activity.md (task DOC-01):

1. **Gates.** In `backend/` and `frontend/`: `npm ci && npm run typecheck && npm run lint && npm test && npm run build`. Everything must exit 0.
2. **Offline seed.** Delete the DB file, then `cd backend && npm run seed:fixtures`. The summary must show AAPL=halal, JPM=not_halal, T=not_halal, STZ=not_halal, ASML=unknown, NO_INTEREST=unknown. Run it again: every ticker is skipped.
3. **API smoke test.** Start the backend (`npm run dev`), then:
   - `curl localhost:3000/stocks?limit=2`: 2 rows, `pagination.total` = 6, `meta.dataAsOf` is set.
   - `curl "localhost:3000/stocks?search=aa"`: AAPL first.
   - `curl "localhost:3000/stocks?status=unknown"`: ASML and NO_INTEREST only.
   - `curl localhost:3000/stocks/jpm/halal-status`: `not_halal` with an industry reason.
   - `curl localhost:3000/stocks/asml/halal-status`: `unknown`, null ratios, IFRS reason.
   - `curl -X POST localhost:3000/favorites/aapl` returns 201. Repeating it returns 200. `curl localhost:3000/favorites` then includes AAPL.
   - `curl localhost:3000/stocks/ZZZZ` returns 404 `STOCK_NOT_FOUND`. `curl "localhost:3000/stocks?limit=500"` returns 400 `VALIDATION_ERROR`.
   - Stop the server, delete the DB, restart it: `/stocks` returns 503 `DATA_NOT_SEEDED`.
4. **Persistence.** Re-seed, favorite AAPL, restart the backend: AAPL is still a favorite.
5. **Rescreen.** Temporarily change the debt threshold in `config/screening.ts`, run `npm run seed -- --rescreen`, and confirm the affected status changed. Then revert the change and rescreen again.
6. **UI.** Start the frontend (`npm run dev`) with the backend running. If the `run` skill or a browser is available, drive it and confirm each point below. If not, report which checks couldn't be done visually instead of claiming they passed.
   - The table shows 6 stocks with all three badge types.
   - Typing "as" narrows to ASML.
   - The "Unknown" chip filters correctly.
   - Starring a stock fills the star immediately, and it survives a page reload.
   - Favorites-only shows only starred stocks.
   - Clicking JPM opens the panel with the industry reason. Clicking ASML shows "Not available" ratios, not 0%.
   - The disclaimer and data date are visible.
   - The layout works at a ~400px viewport.
7. **Live path (optional, needs keys; not required for completion).** `npm run seed -- --limit 5` with real `FINNHUB_API_KEY` and `SEC_USER_AGENT` completes, and every row has a status and a screenedAt. Skip this if no keys are configured, and say so in activity.md.

## Ralph loop execution contract

Each iteration: find the first task in prd.md with "passes": false. Do NOT
invoke /implement for this — run the planner -> code-developer ->
code-reviewer -> unit-tester pipeline from CLAUDE.md directly, skipping
the post-planning approval pause. Implement, review, and test the task,
but do not commit it. Mark it "passes": true only when review is clean
and tests pass, then append a dated line to activity.md. When every task
in prd.md passes, output <promise>ALL TASKS COMPLETE</promise>.
