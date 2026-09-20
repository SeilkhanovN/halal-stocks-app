# PRD — Halal Stocks MVP

Created 2026-09-16 via `/create-prd`. The task list (JSON, below) is the source
of truth for the ralph loop. `passes` flips to `true` only after a clean
review **and** passing tests — never by hand.

## Locked decisions (from the interview)

| Area | Decision |
|---|---|
| Runtime | Node **24 LTS** (`engines: ">=24"`, `.nvmrc` = `24`). The machine currently has Node 20.18 — the user upgrades before implementation starts. |
| Universe | **For now: S&P 500 only (~503 tickers; user decision 2026-09-17 — NASDAQ-100 is a later follow-up).** Original plan: S&P 500 ∪ NASDAQ-100 (~550 unique tickers), from **checked-in snapshot files** (S&P 500 CSV from `github.com/datasets/s-and-p-500-companies`, NASDAQ-100 list as JSON) with a snapshot date. |
| Data sources | **Finnhub free tier** `/stock/profile2`: name, exchange, `finnhubIndustry`, `marketCapitalization` (**in millions of USD**, so multiply by 1e6). **SEC EDGAR** `company_tickers_exchange.json` (ticker→CIK) + `companyfacts` (financials). Free; Finnhub key via `FINNHUB_API_KEY`; EDGAR requires `SEC_USER_AGENT` (name + email). No third-party halal-verdict API. |
| Freshness | A **seed CLI** (run by hand) fetches, screens, and writes to SQLite. The API serves **only from SQLite** and never calls external APIs at request time. |
| Seed robustness | Throttled (Finnhub ≤ 55 req/min, EDGAR ≤ 8 req/s). **Resumable**: per-ticker `screenedAt` + `fetchError`. Re-runs skip tickers screened in the last 7 days unless `--force`. Failed tickers stay in the list as `unknown`. `--rescreen` recomputes status from stored inputs with no network calls (for threshold changes). `--fixtures` runs fully offline from checked-in fixture JSON. |
| Methodology | **AAOIFI**, thresholds in one config module: debt / market cap **< 30%**; (cash + short-term investments + marketable securities) / market cap **< 30%**; interest income (TTM) / revenue (TTM) **< 5%**. Uses **current** market cap (no trailing average). **Strict `<`**: exactly at the threshold counts as a breach. 33% (DJIM/S&P) is a one-line config change, not a code change. |
| Business activity | Denylist of prohibited `finnhubIndustry` values (e.g. Banking, Insurance, Tobacco, Casinos & Gaming) **plus a small ticker-level denylist** for companies whose industry label is too coarse (e.g. alcohol producers under "Beverages", like STZ, TAP, BF.B). A match means `not_halal` regardless of ratios. |
| Status resolution (in order) | 1) prohibited industry → `not_halal`. 2) any **computable** ratio breaches → `not_halal` (breach wins over missing data). 3) any ratio not computable (missing input, market cap ≤ 0 or missing, revenue ≤ 0 or missing, missing industry, IFRS/foreign filer, fetch failure) → `unknown`. 4) otherwise → `halal`. Every result carries plain-language reasons. |
| EDGAR extraction | Ordered **US-GAAP tag fallback lists** per field. Balance-sheet fields use the latest instant value. Income fields use **TTM** (last 4 quarters, or the latest FY if quarters are unavailable). Companies without US-GAAP facts (IFRS filers such as ASML, AZN, ARM, PDD) resolve to `unknown` with a stored reason; IFRS mapping is out of scope. |
| Storage | `node:sqlite` (built in, no dependency). DB path from `DATABASE_PATH` (default `backend/data/halal-stocks.db`, gitignored). |
| Favorites | **One global list** in SQLite (no users, no auth). |
| Backend tooling | Fastify 5, Vitest, `app.inject()` for route tests, ESLint + typescript-eslint, `typecheck` script. Env loaded with Node's `--env-file-if-exists` (no dotenv). **TypeScript ~6.0** (not 7: typescript-eslint caps at <6.1, decided 2026-09-16). **ESM** (`"type": "module"`, `verbatimModuleSyntax`, `.js` extensions on relative imports; top-level await is OK). `tsconfig.json` type-checks tests; `tsconfig.build.json` excludes them from `dist/`. Errors: throw `AppError(code, statusCode, message)` from `src/lib/errors.ts`. |
| Frontend tooling | React 19 + Vite, **TanStack Query** (data fetching/mutations), Vitest + React Testing Library + jsdom + user-event + jest-dom. **No router**: the detail view is a side panel. Vite dev proxy `/api` → `http://localhost:3000` (strips `/api`), so no CORS dependency. |
| UI | Table (ticker, name, industry, badge, ★) with pagination. Debounced (250 ms) search: ticker prefix or name contains, case-insensitive, exact ticker match ranked first. Status filter chips (All / Halal / Not halal / Unknown). "Favorites only" toggle. Detail side panel showing each ratio vs its threshold and the reasons. "Data as of" date. Disclaimer in the footer **and** the detail panel: automated **financial-ratio** screen (AAOIFI), does **not** analyse revenue breakdowns (so mixed-business companies, e.g. hotels selling alcohol, may show as halal), not a fatwa or financial advice. (Option A, decided 2026-09-16: compute in-house, no paid halal-verdict API.) |
| Error policy | 503 `DATA_NOT_SEEDED` only when the stocks table is empty. Staleness is shown (`dataAsOf`, `screenedAt`), not hidden and not turned into an error. |

## API contract (both services build against this — types are duplicated per service, not shared)

All bodies are camelCase. Errors: `{ "error": { "code": string, "message": string } }`.
Tickers are case-insensitive on input. Canonical form is uppercase with a dot for share classes (`BRK.B`), and `BRK-B` is accepted as an alias.

```ts
type HalalStatus = "halal" | "not_halal" | "unknown";
type RatioKey = "debtToMarketCap" | "cashAndSecuritiesToMarketCap" | "interestIncomeToRevenue";

interface RatioResult {
  key: RatioKey;
  label: string;            // "Debt / market cap"
  value: number | null;     // fraction, e.g. 0.123; null = not computable
  threshold: number;        // fraction, e.g. 0.30
  breached: boolean | null; // null when value is null
  explanation: string;      // plain language, e.g. "12.3% is below the 30% limit"
}

interface HalalScreening {
  status: HalalStatus;
  methodology: "AAOIFI";
  screenedAt: string | null; // ISO timestamp
  businessActivity: { industry: string | null; prohibited: boolean | null; explanation: string };
  ratios: RatioResult[];     // always all three, in RatioKey order
  reasons: string[];         // why this status, e.g. ["Industry 'Banking' is not permissible"]
}

interface StockSummary {
  ticker: string; name: string; exchange: string | null; industry: string | null;
  halalStatus: HalalStatus; isFavorite: boolean; screenedAt: string | null;
}
interface StockDetail extends StockSummary { marketCap: number | null; screening: HalalScreening }

interface Paginated<T> {
  data: T[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  meta: { dataAsOf: string | null }; // max(screenedAt) across stocks
}
```

| Method & path | Response |
|---|---|
| `GET /health` | `{ status: "ok" }` |
| `GET /stocks?page=1&limit=25&search=&status=&favoritesOnly=` | `Paginated<StockSummary>`. `limit` is 1–100 (default 25), `page` ≥ 1, `status` ∈ HalalStatus, `favoritesOnly` is `true`/`false`. Invalid params → 400 `VALIDATION_ERROR`. Empty DB → 503 `DATA_NOT_SEEDED`. Default order is ticker asc; with `search`, exact ticker match comes first, then ticker-prefix matches, then name matches. |
| `GET /stocks/:ticker` | `{ data: StockDetail }` or 404 `STOCK_NOT_FOUND` |
| `GET /stocks/:ticker/halal-status` | `{ data: HalalScreening }` or 404 `STOCK_NOT_FOUND` |
| `GET /favorites?page&limit` | `Paginated<StockSummary>` (all have `isFavorite: true`) |
| `POST /favorites/:ticker` | 201 `{ data: { ticker } }` when added; 200 with the same body if already a favorite. 404 `STOCK_NOT_FOUND` for an unknown ticker. |
| `DELETE /favorites/:ticker` | 204 (idempotent, including when it wasn't a favorite). 404 `STOCK_NOT_FOUND` for an unknown ticker. |

## Milestones (restructured 2026-09-17)

Build a thin working slice through backend **and** frontend first, then add one
visible feature at a time. Tasks in the JSON below are in execution order.
**At the end of each milestone, stop so the user can try the app before the
next milestone starts** (this also applies to ralph-loop runs).

| Milestone | Goal the user can see | Tasks |
|---|---|---|
| M0 Foundation | (done) tooling, screening logic, SQLite, EDGAR parser | BE-01, BE-02, BE-03, BE-04 |
| **M1 Search MVP** | Open http://localhost:5173, type a ticker or company name, see matching stocks — no API keys | MVP-01, MVP-02, MVP-03, MVP-04, MVP-05 |
| M2 Halal badge | Each stock shows Halal / Not halal / Unknown; filter by status; disclaimer | BE-05, BE-06, H-01, H-02 |
| M3 Detail panel | Click a stock to see each ratio vs its limit and why | BE-08, FE-05 |
| M4 Favorites | Star stocks, "favorites only" toggle, persisted | BE-09, FE-04 |
| M5 Docs & full verification | Full README (live seeding, methodology, limitations) + end-to-end checks | DOC-01 |

Replaced task ids (split into the milestones above): BE-07 → MVP-02 + H-01 (+ favoritesOnly in BE-09);
FE-01 → MVP-03; FE-02 → MVP-04 + H-02; FE-03 → MVP-04 + H-02 + FE-04.

## Tasks

```json
[
  {
    "id": "BE-01",
    "title": "Backend tooling baseline: Node 24, Vitest, ESLint, typecheck, app factory",
    "description": "Make the backend testable and lintable before any features. Split the Fastify setup into a buildApp() factory (src/app.ts) that tests can use with app.inject(), and a thin src/server.ts that listens. Add a GET /health route in its own file. Add a shared error helper and a Fastify error handler that turns all errors (including schema validation errors) into { error: { code, message } } and logs unexpected errors with context. Set up the npm scripts dev / build / start / test / lint / typecheck, using --env-file for env loading. Add .env.example with FINNHUB_API_KEY, SEC_USER_AGENT, DATABASE_PATH, PORT. Dependencies approved in the interview: vitest, eslint, @eslint/js, typescript-eslint, @types/node@24. GOTCHA: backend/package.json currently pins typescript ^7. If typescript-eslint or vitest doesn't support TS 7, STOP and report it instead of silently downgrading.",
    "files": [
      ".nvmrc",
      "backend/package.json",
      "backend/package-lock.json",
      "backend/tsconfig.json",
      "backend/eslint.config.js",
      "backend/vitest.config.ts",
      "backend/.env.example",
      "backend/src/app.ts",
      "backend/src/server.ts",
      "backend/src/routes/health.ts",
      "backend/src/lib/errors.ts",
      "backend/src/routes/health.test.ts",
      "backend/src/lib/errors.test.ts"
    ],
    "acceptance_criteria": [
      "backend/package.json has \"engines\": { \"node\": \">=24\" } and the repo root has .nvmrc containing 24",
      "tsconfig has strict: true and includes Node types; `npm run typecheck` exits 0",
      "`npm run lint` exits 0",
      "`npm test` runs Vitest and exits 0, and `npm run build` emits dist/server.js",
      "GET /health via app.inject() returns 200 { status: \"ok\" }",
      "A route that throws an unexpected Error produces 500 { error: { code: \"INTERNAL_ERROR\", message } } and the error is logged, not swallowed",
      "A schema validation failure produces 400 { error: { code: \"VALIDATION_ERROR\", message } }",
      "server.ts reads PORT (default 3000) and contains no route definitions",
      ".env.example exists and is not gitignored; no real secrets are committed"
    ],
    "passes": true,
    "milestone": "M0 Foundation"
  },
  {
    "id": "BE-02",
    "title": "Halal screening core: shared types, AAOIFI config, pure screening function, known-answer tests",
    "description": "Pure, dependency-free screening logic, independently testable without the server or DB. types/halal.ts defines HalalStatus, RatioKey, RatioResult, HalalScreening, and a ScreeningInput ({ industry, ticker, marketCap, totalDebt, cashAndSecurities, interestIncomeTtm, revenueTtm, plus a list of dataIssues such as 'IFRS filer' or a fetch error }, all numeric inputs number | null). config/screening.ts holds the thresholds (0.30, 0.30, 0.05) and the denylists (prohibited finnhubIndustry values + ticker-level denylist) as the single source of truth. lib/halal-screen.ts exports screen(input): HalalScreening, applying the status resolution order from the PRD's locked decisions: prohibited industry → not_halal; any computable breach → not_halal; any non-computable ratio, missing industry, or data issue → unknown; else halal. Use strict < (equal = breach). Guard against division by zero and negative values. Explanations and reasons must be plain language and mention the percent and limit. Known-answer fixture tests must cover all three states.",
    "files": [
      "backend/src/types/halal.ts",
      "backend/src/config/screening.ts",
      "backend/src/lib/halal-screen.ts",
      "backend/src/lib/halal-screen.test.ts",
      "backend/src/lib/__fixtures__/screening-cases.ts"
    ],
    "acceptance_criteria": [
      "screen() has no imports from db/, routes/, or any HTTP client",
      "Known-answer cases pass with hand-computed expected ratios noted in comments: (a) low-debt tech company with all inputs (AAPL-like) → halal; (b) conventional bank (industry Banking, JPM-like) with otherwise passing ratios → not_halal with an industry reason; (c) high-debt company (T-like, debt/market cap > 30%) → not_halal with a debt-ratio reason; (d) ticker-level denylisted alcohol producer under industry Beverages → not_halal; (e) interest income missing but other ratios pass → unknown; (f) IFRS filer with no financials → unknown; (g) market cap 0 → unknown, with no NaN/Infinity anywhere in the output; (h) debt ratio breached AND interest income missing → not_halal (breach wins); (i) debt ratio exactly 0.30 → not_halal (strict <); (j) industry null with passing ratios → unknown",
      "Every result has exactly three ratios in RatioKey order; value null ⇔ breached null",
      "Every non-halal result has at least one non-empty reason; a halal result's explanations state each ratio's percent against its limit",
      "Changing a threshold in config/screening.ts (e.g. 0.30 → 0.33) changes the outcome of case (i) with no code change, and a test proves it by passing a config override",
      "HalalStatus is never represented as a boolean anywhere"
    ],
    "passes": true,
    "milestone": "M0 Foundation"
  },
  {
    "id": "BE-03",
    "title": "SQLite persistence with node:sqlite: schema, migrations, repositories",
    "description": "Database layer using the built-in node:sqlite (no new dependency). connection.ts opens DATABASE_PATH (creating the directory if needed; ':memory:' supported for tests) and runs idempotent migrations. Tables: stocks (ticker PK, name, exchange, industry, cik, market_cap, total_debt, cash_and_securities, interest_income_ttm, revenue_ttm, data_issues JSON, halal_status, screening JSON, screened_at, fetch_error, updated_at) and favorites (ticker PK REFERENCES stocks, created_at). stocks-repo: upsert, getByTicker, count, list({ page, limit, search, status, favoritesOnly }) returning rows + total with an isFavorite join, the search ordering from the API contract, maxScreenedAt. favorites-repo: add (returns whether it was newly added), remove, list (paginated). Everything is parameterized SQL (no string-built queries from user input). Add a ticker normalization helper (uppercase, '-' → '.'). Gitignore the data directory's DB files.",
    "files": [
      ".gitignore",
      "backend/src/db/connection.ts",
      "backend/src/db/migrations.ts",
      "backend/src/db/stocks-repo.ts",
      "backend/src/db/favorites-repo.ts",
      "backend/src/lib/ticker.ts",
      "backend/src/db/stocks-repo.test.ts",
      "backend/src/db/favorites-repo.test.ts",
      "backend/src/lib/ticker.test.ts"
    ],
    "acceptance_criteria": [
      "Running migrations twice on the same DB is a no-op with no error",
      "Repo tests run against ':memory:' and are isolated from each other",
      "list() paginates correctly (total, totalPages, last partial page, page beyond the end → empty data with the correct total)",
      "Search 'aa' matches ticker prefix AAPL/AAL; search 'apple' matches by name; an exact ticker match sorts first; matching is case-insensitive",
      "Filters status and favoritesOnly combine correctly with search and pagination",
      "A SQL-injection-style search string (e.g. \"'; DROP TABLE stocks;--\") is treated as a literal and the table survives",
      "favorites add is idempotent and reports added vs already present; remove is idempotent",
      "normalizeTicker('brk-b') === 'BRK.B'",
      "The screening JSON column round-trips to a HalalScreening object with types from types/halal.ts (no duplicated shape)",
      "*.db files under backend/data are gitignored"
    ],
    "passes": true,
    "milestone": "M0 Foundation"
  },
  {
    "id": "BE-04",
    "title": "EDGAR companyfacts extractor (pure parsing, US-GAAP tag fallbacks, TTM)",
    "description": "Pure function extractFinancials(companyFacts JSON) → { totalDebt, cashAndSecurities, interestIncomeTtm, revenueTtm, asOf, issues[] }, with no network access. Ordered US-GAAP tag fallback lists per field in one place. Debt: LongTermDebtNoncurrent/LongTermDebt + LongTermDebtCurrent/DebtCurrent + ShortTermBorrowings/CommercialPaper, and when LongTermDebt already includes the current portion, don't double count. Cash+securities: CashAndCashEquivalentsAtCarryingValue + ShortTermInvestments/MarketableSecuritiesCurrent/AvailableForSaleSecuritiesDebtSecuritiesCurrent + MarketableSecuritiesNoncurrent/AvailableForSaleSecuritiesDebtSecuritiesNoncurrent. Interest income: InvestmentIncomeInterest, then InterestAndDividendIncomeOperating, then InvestmentIncomeInterestAndDividend. Revenue: Revenues, then RevenueFromContractWithCustomerExcludingAssessedTax, then SalesRevenueNet. Balance-sheet fields use the latest instant (from the same filing period when possible). Income fields are TTM: the sum of the latest 4 discrete quarters (derive Q4 from FY minus 9M when needed), otherwise the latest FY. A company with no us-gaap facts (IFRS filer) returns all nulls plus the issue 'Foreign/IFRS filer — financials not screened'. A missing field → null plus a specific issue. The planner should confirm the tag lists against the trimmed fixtures and document any change. SCOPE CHANGE 2026-09-17 (user): no fixture files and no SEC download in BE-04; tests use small inline companyfacts-shaped literals. Realistic EDGAR fixture files move to BE-05 (needed for --fixtures offline mode). Also: forms 10-K/10-Q/20-F/40-F (+/A); TTM = latest 4 consecutive quarters from a quarterly series with Q4 derived as FY − 9M per year; primary tag chosen by most recent data (income and balance-sheet); missing debt tags → null + issue (conservative); leases excluded.",
    "files": [
      "backend/src/lib/edgar-extract.ts",
      "backend/src/lib/edgar-extract.test.ts"
    ],
    "acceptance_criteria": [
      "Pure function, no network/fs access in edgar-extract.ts; input typed unknown and validated at runtime (no any, no casts)",
      "Inline IFRS-style input (no us-gaap facts) → all financial fields null + the issue 'Foreign/IFRS filer — financials not screened'",
      "Inline input missing all interest-income tags → interestIncomeTtm null + 'Interest income not reported'",
      "TTM test: FY + 9M YTD but no discrete Q4 → Q4 derived correctly; with a newer 10-Q quarter after the FY, TTM uses the latest 4 consecutive quarters (not the old fiscal year)",
      "Tag fallback tested: first-choice tag absent → next tag used; a stale older tag loses to a tag with more recent data",
      "Debt is not double-counted (LongTermDebt alone vs Noncurrent + Current; ShortTermBorrowings and CommercialPaper never both)",
      "Restated fact (same period, two filed dates) → later filed value used",
      "Values are numbers in USD; no NaN; non-USD-only tags ignored with an issue",
      "Never throws on malformed/partial input (null, [], {}, { facts: 5 }, non-numeric val) — returns nulls + issues"
    ],
    "passes": true,
    "milestone": "M0 Foundation"
  },
  {
    "id": "MVP-01",
    "milestone": "M1 Search MVP",
    "title": "S&P 500 universe snapshot + `npm run seed:constituents` (no API keys)",
    "description": "SCOPE CHANGE 2026-09-17 (user): S&P 500 only for now — NASDAQ-100 is a later follow-up. Load the S&P 500 into SQLite with NO external API keys, so search works end to end. Check in backend/data/constituents/sp500.csv (downloaded once from https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv — public, verified 503 rows with header Symbol,Security,GICS Sector,GICS Sub-Industry,Headquarters Location,Date added,CIK,Founded); record the source URL, snapshot date, and row count in backend/data/constituents/README.md. src/sources/constituents.ts: a hand-written CSV parser (quoted fields, escaped quotes, CRLF/LF, BOM) and parseSp500Csv(text) / loadConstituents(dir?) returning deduplicated { ticker (normalizeTicker), name, cik (zero-padded to 10 digits) | null }. stocks-repo.ts gains upsertIdentities(list) → { inserted, updated, unchanged } in one transaction: new rows get halalStatus 'unknown', screening null, dataIssues ['Not screened yet']; existing rows only get name/cik refreshed — financials and screening columns are never touched. src/scripts/seed-constituents.ts (npm run seed:constituents) opens the default DB, upserts, prints the counts, always closes the DB, exit code 1 on error.",
    "files": [
      "backend/data/constituents/sp500.csv",
      "backend/data/constituents/README.md",
      "backend/src/sources/constituents.ts",
      "backend/src/sources/constituents.test.ts",
      "backend/src/db/stocks-repo.ts",
      "backend/src/db/stocks-repo.test.ts",
      "backend/src/scripts/seed-constituents.ts",
      "backend/package.json"
    ],
    "acceptance_criteria": [
      "sp500.csv is checked in; README.md in that folder names the source URL, snapshot date, and row count; no API key or email is needed",
      "Loader returns ~503 unique normalized tickers (real-file test asserts 495–510, no duplicates, contains AAPL, MSFT, BRK.B); share classes in dot form (BRK.B, BF.B); CIK zero-padded to 10 digits",
      "Parser tests use small inline CSV samples (quoted name with a comma, escaped quote, CRLF, BOM, missing required header → throws), not the full file",
      "`npm run seed:constituents` on an empty DB exits 0 and prints counts; running it again keeps the same total (no duplicates)",
      "Re-seeding identities never wipes halal_status / screening / financial columns of an existing row (repo test)",
      "New rows have halalStatus 'unknown' and screening null"
    ],
    "passes": true
  },
  {
    "id": "MVP-02",
    "milestone": "M1 Search MVP",
    "replaces": "BE-07 (search + pagination part)",
    "title": "GET /stocks — search by ticker/name with pagination (DB wired into the app)",
    "description": "buildApp({ logger?, db? }) accepts an injected DatabaseSync (tests pass openDatabase(':memory:')); server.ts opens the default DB via openDatabase() and closes it on shutdown. Route file routes/stocks-list.ts: GET /stocks?page&limit&search with a Fastify JSON schema (page ≥ 1 default 1; limit 1–100 default 25; search optional, trimmed, max 50 chars). Empty stocks table → 503 DATA_NOT_SEEDED. Otherwise returns Paginated<StockSummary> exactly per the PRD API contract (halalStatus comes from the DB — 'unknown' until M2; isFavorite from the repo), meta.dataAsOf = maxScreenedAt (null until M2). The status and favoritesOnly query params are NOT part of this task (H-01 / BE-09 add them). types/api.ts holds the response types and reuses types/halal.ts.",
    "files": [
      "backend/src/app.ts",
      "backend/src/server.ts",
      "backend/src/routes/stocks-list.ts",
      "backend/src/routes/stocks-list.test.ts",
      "backend/src/types/api.ts"
    ],
    "acceptance_criteria": [
      "Empty DB → 503 { error: { code: 'DATA_NOT_SEEDED', message } }",
      "limit=500, limit=0, page=0 → 400 VALIDATION_ERROR",
      "Response has exactly data / pagination / meta; pagination math correct, including a page beyond the end",
      "search=aapl returns AAPL first; search=apple matches by name; case-insensitive; search=brk-b finds BRK.B",
      "Never returns an unbounded array (limit always applied)",
      "Existing health / error-handler / 404 tests still pass with the DB-injected buildApp",
      "Manual: after `npm run seed:constituents` and `npm run dev`, `curl \"localhost:3000/stocks?search=aapl\"` returns AAPL"
    ],
    "passes": true
  },
  {
    "id": "MVP-03",
    "title": "Frontend tooling baseline: TanStack Query, Vitest + RTL, Vite proxy, /stocks API client",
    "description": "Remove the Vite template boilerplate (hero, counter, logos). Add the approved dependencies: @tanstack/react-query, vitest, jsdom, @testing-library/react, @testing-library/user-event, @testing-library/jest-dom. Add test and typecheck scripts and a Vitest config (jsdom, setup file). In vite.config.ts, proxy /api → http://localhost:3000 with /api stripped. src/api/types.ts mirrors the PRD API contract (a deliberate duplicate; no shared package). src/api/client.ts is a typed fetch wrapper that parses the { error } shape into an ApiError (status, code, message) and never treats a non-2xx response as data. Include a query-key factory and a fetcher for GET /stocks (page, limit, search) only — other endpoints are added by the milestone that needs them. main.tsx wraps the app in QueryClientProvider with sane defaults (retry: 1, no retry on 4xx or 503). Engines node >= 24.",
    "files": [
      "frontend/package.json",
      "frontend/package-lock.json",
      "frontend/vite.config.ts",
      "frontend/vitest.config.ts",
      "frontend/src/test/setup.ts",
      "frontend/src/main.tsx",
      "frontend/src/App.tsx",
      "frontend/src/App.css",
      "frontend/src/index.css",
      "frontend/src/assets/hero.png",
      "frontend/src/assets/react.svg",
      "frontend/src/assets/vite.svg",
      "frontend/src/api/types.ts",
      "frontend/src/api/client.ts",
      "frontend/src/api/query-keys.ts",
      "frontend/src/api/client.test.ts"
    ],
    "acceptance_criteria": [
      "`npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` all exit 0",
      "The Vite template boilerplate is gone; App renders an app shell with a header",
      "The client test: a 503 { error: { code: 'DATA_NOT_SEEDED' } } response → rejects with ApiError code DATA_NOT_SEEDED; a 204 → resolves with no JSON parse error",
      "The client builds /stocks query strings correctly, omitting empty search and unset filters",
      "HalalStatus is a string union, never a boolean; types match the PRD contract field-for-field",
      "The QueryClient doesn't retry 4xx/503 responses"
    ],
    "passes": true,
    "milestone": "M1 Search MVP",
    "replaces": "FE-01"
  },
  {
    "id": "MVP-04",
    "milestone": "M1 Search MVP",
    "replaces": "FE-02 (table/pagination/states) + FE-03 (search)",
    "title": "Stock search page: debounced ticker search + results table + pagination",
    "description": "The page a user sees: components/StockSearch with a SearchInput (250 ms debounce, trimmed, clear button, autofocus, placeholder 'Search by ticker or company'), components/StockTable (columns: Ticker, Company), components/Pagination (Prev / Next, 'Page X of Y', disabled at bounds). hooks/useStocks (TanStack useQuery, placeholderData keepPreviousData so the table doesn't flash) and hooks/useDebouncedValue. A search change resets page to 1. States: loading; 503 DATA_NOT_SEEDED → message telling the user to run `npm run seed:constituents` in backend/; any other error → message + Retry button; empty result → 'No stocks match'. NOT in this task: halal badge, status chips, favorites, detail panel, disclaimer footer (later milestones). Styles and tests colocated with each component.",
    "files": [
      "frontend/src/App.tsx",
      "frontend/src/App.css",
      "frontend/src/components/StockSearch/StockSearch.tsx",
      "frontend/src/components/StockSearch/StockSearch.css",
      "frontend/src/components/StockSearch/StockSearch.test.tsx",
      "frontend/src/components/StockTable/StockTable.tsx",
      "frontend/src/components/StockTable/StockTable.css",
      "frontend/src/components/StockTable/StockTable.test.tsx",
      "frontend/src/components/Pagination/Pagination.tsx",
      "frontend/src/components/Pagination/Pagination.css",
      "frontend/src/components/Pagination/Pagination.test.tsx",
      "frontend/src/hooks/useStocks.ts",
      "frontend/src/hooks/useDebouncedValue.ts",
      "frontend/src/hooks/useDebouncedValue.test.ts"
    ],
    "acceptance_criteria": [
      "Typing 'aapl' quickly fires exactly one request after 250 ms with search=aapl (fake timers)",
      "Table renders ticker + company name from a mocked response; Next/Prev change page and are disabled on the first/last page; changing the search on page 3 resets to page 1",
      "503 DATA_NOT_SEEDED shows the seed instruction; other errors show a Retry button that refetches; an empty result shows 'No stocks match'",
      "Clear button empties the search and shows the unfiltered list",
      "Tests mock fetch / the API client — no real network; `npm run typecheck`, `lint`, `test`, `build` pass in frontend/",
      "Usable at 400px width (table scrolls inside its own container)"
    ],
    "passes": true
  },
  {
    "id": "MVP-05",
    "milestone": "M1 Search MVP",
    "title": "Run the search MVP end to end + README quick start",
    "description": "Docs + real verification. Root README.md gets a 'Quick start (search MVP)' section: prerequisites (Node 24), `npm install` in backend/ and frontend/, `cd backend && npm run seed:constituents && npm run dev`, `cd frontend && npm run dev`, open http://localhost:5173. Then actually run it on a fresh DB: seed, start both servers, and check it in a real browser (use the run skill or claude-in-chrome if available; if not, verify through the Vite proxy with curl and clearly list which visual checks could not be done). Stop all servers afterwards (confirm nothing listens on 3000/5173). Record results in activity.md. This task ends milestone M1 — STOP for the user to try the app before starting M2.",
    "files": [
      "README.md"
    ],
    "acceptance_criteria": [
      "Following the README on a fresh DB works with no API keys",
      "`curl \"http://localhost:5173/api/stocks?search=aapl\"` (through the Vite proxy) returns AAPL first",
      "In the browser: typing 'aap' lists AAPL; typing 'microsoft' lists MSFT; clearing restores the full list; Next/Prev pagination works",
      "Stopping the backend while the page is open shows the error state with Retry",
      "No servers left running; verification results recorded in activity.md"
    ],
    "passes": true
  },
  {
    "id": "BE-05",
    "title": "Data clients: Finnhub profile, EDGAR HTTP + companyfacts fixtures, throttle, fixture mode",
    "description": "RESTRUCTURE 2026-09-17: the constituents snapshot + loader moved to MVP-01 — reuse src/sources/constituents.ts, don't recreate it. I/O layer for the seed job. constituents.ts loads the checked-in snapshots (data/constituents/sp500.csv and nasdaq100.json, each with a snapshot date) → a deduplicated, normalized ticker list. finnhub-client.ts: getProfile(ticker) → { name, exchange, industry, marketCap (profile2 marketCapitalization × 1e6) }. edgar-client.ts: loadTickerMap() from company_tickers_exchange.json → CIK lookup (handles BRK.B/BRK-B), getCompanyFacts(cik). Both use global fetch through a shared throttle (Finnhub ≤ 55/min, EDGAR ≤ 8/s), retry 429/5xx with backoff (max 3), and send the SEC User-Agent from env. On repeated failure they throw a typed DataSourceError with ticker + source context; they never return fabricated data. A DataSource interface has two implementations, live and fixture (reads backend/fixtures/finnhub/*.json and backend/fixtures/edgar/*.json, and returns 'not found' for tickers without fixtures). Missing FINNHUB_API_KEY or SEC_USER_AGENT in live mode → a clear startup error. No new dependencies. SCOPE CHANGE 2026-09-17: BE-05 also creates the EDGAR companyfacts fixture files (AAPL, JPM, T, ASML, NO_INTEREST; trimmed, <200 KB, _note with source/date; real or synthetic decided at BE-05 planning) moved out of BE-04, and a fixture-mode test asserting extractFinancials() on each yields the inputs the Fixture set criterion needs.",
    "files": [
      "backend/src/sources/data-source.ts",
      "backend/src/sources/finnhub-client.ts",
      "backend/src/sources/edgar-client.ts",
      "backend/src/sources/fixture-source.ts",
      "backend/src/lib/throttle.ts",
      "backend/fixtures/finnhub/AAPL.json",
      "backend/fixtures/finnhub/JPM.json",
      "backend/fixtures/finnhub/T.json",
      "backend/fixtures/finnhub/ASML.json",
      "backend/fixtures/finnhub/STZ.json",
      "backend/fixtures/finnhub/NO_INTEREST.json",
      "backend/fixtures/edgar/AAPL.json",
      "backend/fixtures/edgar/JPM.json",
      "backend/fixtures/edgar/T.json",
      "backend/fixtures/edgar/ASML.json",
      "backend/fixtures/edgar/NO_INTEREST.json",
      "backend/fixtures/edgar/company_tickers_exchange.json",
      "backend/src/sources/finnhub-client.test.ts",
      "backend/src/sources/edgar-client.test.ts",
      "backend/src/lib/throttle.test.ts"
    ],
    "acceptance_criteria": [
      "HTTP clients are tested with a mocked fetch; no test makes a real network call",
      "Finnhub marketCapitalization 3000000 (millions) → marketCap 3e12",
      "An empty Finnhub profile ({}) is treated as not found, not as zero values",
      "429 then 200 → retried and succeeds; 3× 500 → DataSourceError carrying ticker + source",
      "Every EDGAR request sends a User-Agent header equal to SEC_USER_AGENT",
      "The throttle test uses fake timers and proves the rate cap is respected",
      "Fixture mode reads no env vars and makes no network calls",
      "Fixture set covers halal (AAPL), not_halal by industry (JPM), not_halal by ratio (T), not_halal by ticker denylist (STZ), unknown by IFRS (ASML), unknown by missing interest income (NO_INTEREST)"
    ],
    "passes": true,
    "milestone": "M2 Halal badge"
  },
  {
    "id": "BE-06",
    "title": "Seed CLI: resumable fetch → extract → screen → upsert, with --fixtures / --force / --rescreen / --limit",
    "description": "RESTRUCTURE 2026-09-17: MVP-01 already loads the universe (seed:constituents) as 'unknown' rows; this seed fills financials + screening for those rows (and still works on an empty DB). src/scripts/seed.ts (npm run seed). For each constituent ticker: skip it if screened within 7 days (unless --force); fetch the Finnhub profile + EDGAR facts; extractFinancials; screen(); upsert the stock row with its inputs, status, screening JSON, screenedAt, and fetchError. A per-ticker failure is logged with ticker + source, stored as fetchError, and the row is upserted with status unknown and a reason like 'Data unavailable: <source> error'; the run continues. Flags: --fixtures (fixture data source, only tickers that have fixtures), --force, --limit N (first N tickers, for smoke runs), --rescreen (no network: recompute screening for every stored row from stored inputs with the current config, e.g. after a threshold change). Ctrl+C stops cleanly after the current ticker; the next run resumes. Prints a progress line per ticker and a final summary (counts by status, failures). Also add npm scripts seed and seed:fixtures.",
    "files": [
      "backend/src/scripts/seed.ts",
      "backend/src/lib/seed-runner.ts",
      "backend/src/lib/seed-runner.test.ts",
      "backend/package.json"
    ],
    "acceptance_criteria": [
      "`npm run seed:fixtures` on an empty DB exits 0 and produces the 6 fixture stocks with statuses AAPL=halal, JPM=not_halal, T=not_halal, STZ=not_halal, ASML=unknown, NO_INTEREST=unknown",
      "Running seed:fixtures again immediately skips all tickers (resumable); with --force it re-screens them",
      "A data source that throws for one ticker → that ticker is stored as unknown with fetchError set, other tickers still succeed, and the summary reports 1 failure",
      "--rescreen makes zero data-source calls (asserted with a spy) and updates statuses when the config thresholds are overridden",
      "seed-runner logic is tested with an in-memory DB and a fake DataSource; no network",
      "Live mode with missing env vars exits non-zero with a message naming the missing variable, before any fetch",
      "A failure never stores a halal status (wrong data is worse than no data)"
    ],
    "passes": true,
    "milestone": "M2 Halal badge"
  },
  {
    "id": "H-01",
    "milestone": "M2 Halal badge",
    "replaces": "BE-07 (status filter + dataAsOf part)",
    "title": "GET /stocks — halal status filter",
    "description": "Extend routes/stocks-list.ts with the optional `status` query param (enum HalalStatus) passed through to the repo; it combines with search and pagination. meta.dataAsOf (max screenedAt) is already returned by MVP-02 and becomes non-null once BE-06 has screened stocks.",
    "files": [
      "backend/src/routes/stocks-list.ts",
      "backend/src/routes/stocks-list.test.ts",
      "backend/src/types/api.ts"
    ],
    "acceptance_criteria": [
      "status=not_halal returns only not_halal stocks with the correct total; omitting status returns all",
      "status combines with search and pagination",
      "status=maybe → 400 VALIDATION_ERROR",
      "After `npm run seed:fixtures`, meta.dataAsOf is a non-null ISO timestamp"
    ],
    "passes": true
  },
  {
    "id": "H-02",
    "milestone": "M2 Halal badge",
    "replaces": "FE-02 (badge + footer part) + FE-03 (status chips)",
    "title": "Halal badge column, status filter chips, disclaimer footer with data-as-of",
    "description": "components/HalalBadge (three distinct visual states, each with a text label — not color-only) added as a column in StockTable. components/StatusFilter chips (All / Halal / Not halal / Unknown, single-select radio group) sending `status` (All omits it); changing the filter resets page to 1. components/Footer with the disclaimer 'Automated screen based on AAOIFI financial ratios only — revenue from non-permissible business lines is not analysed. Not a fatwa or financial advice.' plus 'Data as of <date>' from meta.dataAsOf ('Data date unavailable' when null). The API client gains the status param.",
    "files": [
      "frontend/src/App.tsx",
      "frontend/src/api/client.ts",
      "frontend/src/hooks/useStocks.ts",
      "frontend/src/components/StockTable/StockTable.tsx",
      "frontend/src/components/StockTable/StockTable.test.tsx",
      "frontend/src/components/HalalBadge/HalalBadge.tsx",
      "frontend/src/components/HalalBadge/HalalBadge.css",
      "frontend/src/components/HalalBadge/HalalBadge.test.tsx",
      "frontend/src/components/StatusFilter/StatusFilter.tsx",
      "frontend/src/components/StatusFilter/StatusFilter.css",
      "frontend/src/components/StatusFilter/StatusFilter.test.tsx",
      "frontend/src/components/Footer/Footer.tsx",
      "frontend/src/components/Footer/Footer.css",
      "frontend/src/components/Footer/Footer.test.tsx"
    ],
    "acceptance_criteria": [
      "HalalBadge renders 'Halal', 'Not halal', 'Unknown' with accessible text (test covers all three)",
      "Selecting 'Not halal' sends status=not_halal; 'All' omits status; changing the filter on page 3 resets to page 1",
      "Chips are keyboard accessible (radio-group semantics)",
      "Footer shows the disclaimer text and a formatted dataAsOf, or 'Data date unavailable' when null",
      "Tests mock the API; typecheck/lint/test/build pass in frontend/"
    ],
    "passes": true
  },
  {
    "id": "BE-08",
    "title": "GET /stocks/:ticker and GET /stocks/:ticker/halal-status",
    "description": "Two route files. Normalize the ticker param (case-insensitive, BRK-B → BRK.B). Detail returns { data: StockDetail }; halal-status returns { data: HalalScreening } with all three ratios, businessActivity, and reasons. An unknown ticker → 404 STOCK_NOT_FOUND. An empty DB → 503 DATA_NOT_SEEDED.",
    "files": [
      "backend/src/routes/stock-detail.ts",
      "backend/src/routes/stock-halal-status.ts",
      "backend/src/routes/stock-detail.test.ts",
      "backend/src/routes/stock-halal-status.test.ts",
      "backend/src/app.ts"
    ],
    "acceptance_criteria": [
      "GET /stocks/aapl and /stocks/AAPL return the same stock; /stocks/BRK-B resolves to BRK.B",
      "The halal-status response for a not_halal stock has at least one reason, and each breached ratio has breached: true and an explanation mentioning the percent and limit",
      "The halal-status response for an unknown stock has null values for the missing ratios and reasons explaining what is missing",
      "Unknown ticker → 404 STOCK_NOT_FOUND in the standard error shape",
      "Route tests use app.inject() with a seeded in-memory DB"
    ],
    "passes": true,
    "milestone": "M3 Detail panel"
  },
  {
    "id": "FE-05",
    "title": "Detail side panel: ratios vs thresholds, business activity, reasons, disclaimer",
    "description": "RESTRUCTURE 2026-09-17: the favorite star inside the panel moved to FE-04 (M4). Clicking a row (or pressing Enter on a focused row) opens components/StockDetailPanel, which fetches GET /stocks/:ticker via useStockDetail. It shows name/ticker/exchange/industry, the HalalBadge, market cap (compact format), the business-activity result, and a ratio list: each RatioResult as label, value %, limit %, a visual bar or indicator, a pass/breach/not-available state, and its explanation. Also the reasons list, 'Screened on <date>', and the disclaimer. Closes with Esc, the close button, or a backdrop click; focus moves into the panel on open and returns to the row on close. Loading, 404, and error states are included.",
    "files": [
      "frontend/src/App.tsx",
      "frontend/src/hooks/useStockDetail.ts",
      "frontend/src/components/StockDetailPanel/StockDetailPanel.tsx",
      "frontend/src/components/StockDetailPanel/StockDetailPanel.css",
      "frontend/src/components/StockDetailPanel/StockDetailPanel.test.tsx",
      "frontend/src/components/RatioRow/RatioRow.tsx",
      "frontend/src/components/RatioRow/RatioRow.css",
      "frontend/src/components/RatioRow/RatioRow.test.tsx",
      "frontend/src/components/StockTable/StockTable.tsx"
    ],
    "acceptance_criteria": [
      "A panel test covers each of the three states using mocked detail responses: halal (all three ratios pass), not_halal (a breached ratio visibly marked plus its reason), unknown (a null ratio shown as 'Not available' with a reason, never as 0%)",
      "Ratio values are formatted as percentages to 1 decimal place (0.1234 → 12.3%) alongside a limit (30%)",
      "Esc and the close button close the panel; focus returns to the originating row",
      "The panel shows the disclaimer text and the screenedAt date",
      "A 404 shows 'Stock not found'",
      "At 400px width the panel is full-width"
    ],
    "passes": true,
    "milestone": "M3 Detail panel"
  },
  {
    "id": "BE-09",
    "title": "Favorites routes: GET /favorites, POST /favorites/:ticker, DELETE /favorites/:ticker",
    "description": "Three route files over favorites-repo, with one global list (no user concept). The POST and DELETE status codes and idempotency are exactly as in the PRD API contract. GET is paginated like /stocks. RESTRUCTURE 2026-09-17: also adds the optional `favoritesOnly` query param to GET /stocks (routes/stocks-list.ts), moved here from BE-07.",
    "files": [
      "backend/src/routes/favorites-list.ts",
      "backend/src/routes/favorites-add.ts",
      "backend/src/routes/favorites-remove.ts",
      "backend/src/routes/favorites.test.ts",
      "backend/src/app.ts",
      "backend/src/routes/stocks-list.ts",
      "backend/src/routes/stocks-list.test.ts"
    ],
    "acceptance_criteria": [
      "POST a new favorite → 201; POST the same again → 200; both have body { data: { ticker } } with the canonical ticker",
      "DELETE an existing favorite → 204; DELETE again → 204",
      "POST/DELETE for a ticker not in stocks → 404 STOCK_NOT_FOUND",
      "GET /favorites returns Paginated<StockSummary>, all with isFavorite true; limit bounds are validated",
      "After POST, GET /stocks?favoritesOnly=true includes the ticker; after DELETE it doesn't",
      "Favorites persist across buildApp instances sharing the same file DB (tested with a temp file)",
      "GET /stocks?favoritesOnly=notabool → 400 VALIDATION_ERROR"
    ],
    "passes": true,
    "milestone": "M4 Favorites"
  },
  {
    "id": "FE-04",
    "title": "Favorite star toggle with optimistic update",
    "description": "components/FavoriteButton (★/☆, aria-pressed, aria-label 'Add AAPL to favorites' / 'Remove AAPL from favorites'). hooks/useToggleFavorite uses a TanStack useMutation (POST/DELETE) with an optimistic update of cached stock lists and detail, rolls back on error with a visible non-blocking error message, and invalidates stock + favorites queries on settle. Clicking the star must not open the detail panel (stop propagation). RESTRUCTURE 2026-09-17: this task also adds the ★ column to StockTable, the star inside StockDetailPanel (toggling there updates the table row via the shared query cache), and the 'Favorites only' toggle (sends favoritesOnly=true, omitted when off; changing it resets page to 1) — moved here from FE-02 / FE-03 / FE-05. The API client gains the favorites endpoints and the favoritesOnly param.",
    "files": [
      "frontend/src/components/FavoriteButton/FavoriteButton.tsx",
      "frontend/src/components/FavoriteButton/FavoriteButton.css",
      "frontend/src/components/FavoriteButton/FavoriteButton.test.tsx",
      "frontend/src/hooks/useToggleFavorite.ts",
      "frontend/src/hooks/useToggleFavorite.test.tsx",
      "frontend/src/components/StockTable/StockTable.tsx",
      "frontend/src/components/StockDetailPanel/StockDetailPanel.tsx",
      "frontend/src/components/FavoritesToggle/FavoritesToggle.tsx",
      "frontend/src/components/FavoritesToggle/FavoritesToggle.css",
      "frontend/src/components/FavoritesToggle/FavoritesToggle.test.tsx",
      "frontend/src/hooks/useStocks.ts",
      "frontend/src/api/client.ts",
      "frontend/src/App.tsx"
    ],
    "acceptance_criteria": [
      "Clicking an empty star sends POST /api/favorites/AAPL and the star fills immediately, before the response arrives",
      "Clicking a filled star sends DELETE, and the star empties immediately",
      "A server error rolls back the star state and shows an error message",
      "With the favorites-only filter on, unfavoriting removes the row after the invalidation refetch",
      "aria-pressed reflects state and the accessible label names the ticker",
      "Double-clicking quickly does not leave the UI out of sync with the server (the button is disabled while pending, or the last write wins; test it)",
      "Favorites-only toggle sends favoritesOnly=true and omits it when off; toggling it on page 3 resets to page 1",
      "Toggling the star inside the detail panel updates the table row star too (shared cache)"
    ],
    "passes": false,
    "milestone": "M4 Favorites"
  },
  {
    "id": "DOC-01",
    "title": "README run instructions + end-to-end verification",
    "description": "RESTRUCTURE 2026-09-17: MVP-05 already added a 'Quick start (search MVP)' README section — extend it rather than rewriting. Documentation only (a cross-service docs change, explicitly allowed). The root README covers the prerequisites (Node 24, Finnhub free key, SEC User-Agent) and clone → install → seed → run in about 5 commands, for both offline (`npm run seed:fixtures`) and live (`npm run seed`, ~15 min) paths. It also covers the methodology summary (AAOIFI thresholds, status resolution order, where to change thresholds, then `npm run seed -- --rescreen`), known limitations (financial-ratio screen only: no revenue-segment analysis, so mixed-business companies may be marked halal where commercial screeners like Zoya/Musaffa would not; 5% rule counts interest income only; current market cap not averaged, IFRS filers → unknown, Finnhub free tier is personal-use only, EDGAR data up to a quarter old), and the disclaimer. Update backend/README.md and frontend/README.md with the service-specific scripts. Then actually run the end-to-end verification from prompt.md and record the result in activity.md.",
    "files": [
      "README.md",
      "backend/README.md",
      "frontend/README.md"
    ],
    "acceptance_criteria": [
      "Following the README's offline path on a clean checkout (fresh DB) produces a working app with the 6 fixture stocks and no API keys",
      "The README lists every env var from backend/.env.example with a description",
      "The README states the thresholds and matches config/screening.ts values",
      "The end-to-end checks from prompt.md 'How to verify' pass and are recorded in activity.md with the date"
    ],
    "passes": false,
    "milestone": "M5 Docs & full verification"
  }
]
```
