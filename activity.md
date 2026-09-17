# Activity log

Append-only. One dated line per state change: `YYYY-MM-DD — <task id> — <pending|in progress|done|blocked> — <note>`.
The source of truth for completion is `"passes"` in prd.md; this log records how each task got there.

## Current state (as of 2026-09-17, restructured into milestones)

| Milestone | Task | Title | State |
|---|---|---|---|
| M0 Foundation | BE-01 | Backend tooling baseline | done |
| M0 Foundation | BE-02 | Halal screening core | done |
| M0 Foundation | BE-03 | SQLite persistence | done |
| M0 Foundation | BE-04 | EDGAR extractor | done |
| **M1 Search MVP** | MVP-01 | S&P 500 snapshot + seed:constituents | done |
| **M1 Search MVP** | MVP-02 | GET /stocks search + pagination | pending |
| **M1 Search MVP** | MVP-03 | Frontend tooling baseline | pending |
| **M1 Search MVP** | MVP-04 | Stock search page | pending |
| **M1 Search MVP** | MVP-05 | Run MVP end to end + quick start | pending |
| M2 Halal badge | BE-05 | Data clients + fixture mode | pending |
| M2 Halal badge | BE-06 | Seed CLI (screening) | pending |
| M2 Halal badge | H-01 | GET /stocks status filter | pending |
| M2 Halal badge | H-02 | Badge column, status chips, disclaimer footer | pending |
| M3 Detail panel | BE-08 | Stock detail + halal-status routes | pending |
| M3 Detail panel | FE-05 | Detail side panel | pending |
| M4 Favorites | BE-09 | Favorites routes (+ favoritesOnly) | pending |
| M4 Favorites | FE-04 | Favorite star + favorites-only toggle | pending |
| M5 Docs | DOC-01 | Full README + end-to-end verification | pending |

## Log

- 2026-09-16 — ALL — pending — PRD created via /create-prd (15 tasks). Precondition: upgrade local Node from 20.18 to 24 LTS before BE-01.
- 2026-09-16 — BE-01 — in progress — Precondition met: Node upgraded to v24.19.0 (winget OpenJS.NodeJS.LTS). Planner running.
- 2026-09-16 — BE-01 — in progress — Blocker: typescript-eslint 8.70 (incl. canary) peer-caps typescript <6.1.0; backend had ^7.0.2. User chose to pin backend TypeScript to ~6.0 (matches frontend). Implementation resumed.
- 2026-09-16 — BE-01 — done — Review clean (2nd pass), 21/21 tests pass, typecheck/lint/build green. Deviations: TypeScript pinned ~6.0 (typescript-eslint caps <6.1), backend switched to ESM ("type": "module"), added tsconfig.build.json, eslint.config.mjs. .env.example created by user (agent permission deny). Follow-up suggestion: extract resolvePort() from server.ts for testability. Not committed.
- 2026-09-16 — BE-02 — in progress — Spec approved with amendments (reasons: primary cause first, industry line only when prohibited/missing; thresholds formatted "30%"). Data-source decision re-confirmed: Option A — compute AAOIFI in-house (no paid halal API); disclaimer must state it is a financial-ratio screen that does not analyse revenue breakdowns (mixed-business companies may pass). Negative numerators → unknown.
- 2026-09-16 — BE-02 — done — 130/130 tests, typecheck/lint/build green, no fixtures in dist. Review clean except near-limit display bug found by own smoke test + re-review ("30.0000% is below the 30% limit"); fixed per user by widening at-limit tolerance to 1e-6 (values within 0.0001 pct-points of a limit = breach → not_halal) + regression test (verified it fails on old 1e-9). Also: reasons prefixed with ratio label; escalating decimals near limits; isUsableNumber type fix; tsconfig.build.json excludes __fixtures__ (user-approved).
- 2026-09-16 — FOLLOW-UPS (deferred, minor) — (1) extract resolvePort() from server.ts for tests [BE-01]; (2) verify --env-file-if-exists actually loads a .env file [BE-01]; (3) empty/whitespace ticker guard in screen() [BE-02]; (4) runtime typeof-number guard for inputs parsed from external APIs [BE-02, revisit in BE-04/05]; (5) Finnhub industry labels are guesses — verify in BE-05; (6) .gitattributes eol=lf.
- 2026-09-16 — BE-03 — in progress — Branch feature/be-03-sqlite off master (after PR #1 merge). Planner running.
- 2026-09-17 — BE-03 — done — 203/203 tests, typecheck/lint/build green; review approved (1 should-fix applied: openDatabase closes handle if setup/migrations throw). Own smoke test confirmed search ranking, literal wildcards, brk-b alias, combined filters, pagination, favorites idempotency, StockNotFoundError, screening JSON round-trip. No new deps (node:sqlite).
- 2026-09-17 — FOLLOW-UPS (deferred, minor) — (7) list() queries re-prepared per call; cache if hot [BE-03]; (8) screening JSON read with an unvalidated cast — revisit when external data is written (BE-05/06) [BE-03]; (9) migration rollback not unit-tested (no injection point) [BE-03]; (10) replace halal-screen.ts normalizeTickerLocal with lib/ticker.ts [BE-02/03].
- 2026-09-17 — BE-04 — in progress — Branch feature/be-04-edgar-extract off master (after PR #2 merge). Planner running.
- 2026-09-17 — BE-04 — in progress — Scope change (user): no fixture files / no SEC download in BE-04; small inline tests instead. EDGAR fixture files moved to BE-05 (offline mode). prd.md BE-04 files/ACs + BE-05 files updated. Plan amendments: latest-4-quarter TTM series, recency-based tag choice (income + balance sheet), 20-F/40-F forms, ST-borrowings-only debt, missing debt → null (conservative).
- 2026-09-17 — FOLLOW-UPS (deferred) — (11) after first live seed, measure how many stocks are unknown due to 'Total debt not reported' (debt-free companies like ISRG/MNST/CPRT); revisit null-vs-0 then [BE-04].
- 2026-09-17 — BE-04 — done — 239/239 tests, typecheck/lint/build green; pure extractor (no any/casts/fs/network). Review clean; applied its should-fix (US-GAAP filer with unmatched tags no longer mislabeled 'Foreign/IFRS filer' — keeps specific 'not reported' issues) and nit (instant restatement dedupe independent of start). Tests cover 52/53-week FY, multi-year Q4 derivation, reported-Q4 no double count, TTM rollover, tag recency, debt non-double-counting, feed into screen().
- 2026-09-17 — RESTRUCTURE — Tasks regrouped into milestones (user request): build a thin search MVP through backend + frontend first (MVP-01..05: universe snapshot, GET /stocks search, frontend tooling, search page, run end to end), then add features one at a time — M2 halal badge, M3 detail panel, M4 favorites, M5 docs. BE-07/FE-01/FE-02/FE-03 split into MVP-02/H-01/MVP-03/MVP-04/H-02 and parts of BE-09/FE-04. Stop for user review at the end of each milestone.
- 2026-09-17 — MVP-01 — in progress — Branch feature/mvp-01-seed-constituents off master (after PR #4). Planner running.
- 2026-09-17 — MVP-01 — in progress — Scope change (user): S&P 500 only; NASDAQ-100 snapshot dropped for now. Spec approved with that change (no manual transcription fallback).
- 2026-09-17 — FOLLOW-UPS (deferred) — (12) add NASDAQ-100 constituents (source TBD; BE-05/BE-06 prd text still mentions it) [MVP-01].
- 2026-09-17 — MVP-01 — done — 262/262 tests, typecheck/lint/build green; review clean (nits only). S&P 500 snapshot (503 rows, github.com/datasets) + hand-written CSV parser + stocks-repo.upsertIdentities + npm run seed:constituents. Own verification: seed twice on temp DB → 503 inserted, then 503 unchanged. Default DB path backend/data/halal-stocks.db (gitignored).
- 2026-09-17 — FOLLOW-UPS (deferred, minor) — (13) .gitattributes eol=lf for backend/data/constituents/*.csv (overlaps 6); (14) upsertIdentities rollback path not unit-tested (no clean way to force a DB error) [MVP-01].
