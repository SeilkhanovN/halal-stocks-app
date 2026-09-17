# PRD — Halal Stocks MVP

Created 2026-09-16 via `/create-prd`. The task list (JSON, below) is the source
of truth for the ralph loop. `passes` flips to `true` only after a clean
review **and** passing tests — never by hand.

## Locked decisions (from the interview)

| Area | Decision |
|---|---|
| Runtime | Node **24 LTS** (`engines: ">=24"`, `.nvmrc` = `24`). The machine currently has Node 20.18 — the user upgrades before implementation starts. |
| Universe | S&P 500 ∪ NASDAQ-100 (~550 unique tickers), from **checked-in snapshot files** (S&P 500 CSV from `github.com/datasets/s-and-p-500-companies`, NASDAQ-100 list as JSON) with a snapshot date. |
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
    "passes": true
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
    "passes": true
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
    "passes": true
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
    "passes": true
  },
  {
    "id": "BE-05",
    "title": "Data clients: constituents snapshot, Finnhub profile, EDGAR HTTP, throttle, fixture mode",
    "description": "I/O layer for the seed job. constituents.ts loads the checked-in snapshots (data/constituents/sp500.csv and nasdaq100.json, each with a snapshot date) → a deduplicated, normalized ticker list. finnhub-client.ts: getProfile(ticker) → { name, exchange, industry, marketCap (profile2 marketCapitalization × 1e6) }. edgar-client.ts: loadTickerMap() from company_tickers_exchange.json → CIK lookup (handles BRK.B/BRK-B), getCompanyFacts(cik). Both use global fetch through a shared throttle (Finnhub ≤ 55/min, EDGAR ≤ 8/s), retry 429/5xx with backoff (max 3), and send the SEC User-Agent from env. On repeated failure they throw a typed DataSourceError with ticker + source context; they never return fabricated data. A DataSource interface has two implementations, live and fixture (reads backend/fixtures/finnhub/*.json and backend/fixtures/edgar/*.json, and returns 'not found' for tickers without fixtures). Missing FINNHUB_API_KEY or SEC_USER_AGENT in live mode → a clear startup error. No new dependencies. SCOPE CHANGE 2026-09-17: BE-05 also creates the EDGAR companyfacts fixture files (AAPL, JPM, T, ASML, NO_INTEREST; trimmed, <200 KB, _note with source/date; real or synthetic decided at BE-05 planning) moved out of BE-04, and a fixture-mode test asserting extractFinancials() on each yields the inputs the Fixture set criterion needs.",
    "files": [
      "backend/data/constituents/sp500.csv",
      "backend/data/constituents/nasdaq100.json",
      "backend/src/sources/constituents.ts",
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
      "backend/src/sources/constituents.test.ts",
      "backend/src/sources/finnhub-client.test.ts",
      "backend/src/sources/edgar-client.test.ts",
      "backend/src/lib/throttle.test.ts"
    ],
    "acceptance_criteria": [
      "The constituents loader returns ~550 unique normalized tickers; duplicates between the two indexes appear once",
      "HTTP clients are tested with a mocked fetch; no test makes a real network call",
      "Finnhub marketCapitalization 3000000 (millions) → marketCap 3e12",
      "An empty Finnhub profile ({}) is treated as not found, not as zero values",
      "429 then 200 → retried and succeeds; 3× 500 → DataSourceError carrying ticker + source",
      "Every EDGAR request sends a User-Agent header equal to SEC_USER_AGENT",
      "The throttle test uses fake timers and proves the rate cap is respected",
      "Fixture mode reads no env vars and makes no network calls",
      "Fixture set covers halal (AAPL), not_halal by industry (JPM), not_halal by ratio (T), not_halal by ticker denylist (STZ), unknown by IFRS (ASML), unknown by missing interest income (NO_INTEREST)"
    ],
    "passes": false
  },
  {
    "id": "BE-06",
    "title": "Seed CLI: resumable fetch → extract → screen → upsert, with --fixtures / --force / --rescreen / --limit",
    "description": "src/scripts/seed.ts (npm run seed). For each constituent ticker: skip it if screened within 7 days (unless --force); fetch the Finnhub profile + EDGAR facts; extractFinancials; screen(); upsert the stock row with its inputs, status, screening JSON, screenedAt, and fetchError. A per-ticker failure is logged with ticker + source, stored as fetchError, and the row is upserted with status unknown and a reason like 'Data unavailable: <source> error'; the run continues. Flags: --fixtures (fixture data source, only tickers that have fixtures), --force, --limit N (first N tickers, for smoke runs), --rescreen (no network: recompute screening for every stored row from stored inputs with the current config, e.g. after a threshold change). Ctrl+C stops cleanly after the current ticker; the next run resumes. Prints a progress line per ticker and a final summary (counts by status, failures). Also add npm scripts seed and seed:fixtures.",
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
    "passes": false
  },
  {
    "id": "BE-07",
    "title": "GET /stocks — paginated list with search, status filter, favoritesOnly, dataAsOf",
    "description": "Route file routes/stocks-list.ts registered in buildApp. Validate the query with a Fastify JSON schema (page ≥ 1 default 1; limit 1–100 default 25; search optional, trimmed, max 50 chars; status enum; favoritesOnly boolean). If the stocks table is empty → 503 DATA_NOT_SEEDED. Otherwise return Paginated<StockSummary> exactly per the PRD API contract, with meta.dataAsOf = max screenedAt. buildApp accepts an injected DB for tests.",
    "files": [
      "backend/src/routes/stocks-list.ts",
      "backend/src/routes/stocks-list.test.ts",
      "backend/src/app.ts",
      "backend/src/types/api.ts"
    ],
    "acceptance_criteria": [
      "Empty DB → 503 { error: { code: 'DATA_NOT_SEEDED', message } }",
      "limit=500 or page=0 or status=maybe → 400 VALIDATION_ERROR",
      "Response has the exact keys data / pagination / meta, and the pagination math is correct",
      "search, status, and favoritesOnly each work and combine; isFavorite is accurate per row",
      "An exact ticker match appears first in search results",
      "Never returns an unbounded array (limit is always applied)",
      "API response types live in types/api.ts and reuse types/halal.ts (no duplicated HalalStatus)"
    ],
    "passes": false
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
    "passes": false
  },
  {
    "id": "BE-09",
    "title": "Favorites routes: GET /favorites, POST /favorites/:ticker, DELETE /favorites/:ticker",
    "description": "Three route files over favorites-repo, with one global list (no user concept). The POST and DELETE status codes and idempotency are exactly as in the PRD API contract. GET is paginated like /stocks.",
    "files": [
      "backend/src/routes/favorites-list.ts",
      "backend/src/routes/favorites-add.ts",
      "backend/src/routes/favorites-remove.ts",
      "backend/src/routes/favorites.test.ts",
      "backend/src/app.ts"
    ],
    "acceptance_criteria": [
      "POST a new favorite → 201; POST the same again → 200; both have body { data: { ticker } } with the canonical ticker",
      "DELETE an existing favorite → 204; DELETE again → 204",
      "POST/DELETE for a ticker not in stocks → 404 STOCK_NOT_FOUND",
      "GET /favorites returns Paginated<StockSummary>, all with isFavorite true; limit bounds are validated",
      "After POST, GET /stocks?favoritesOnly=true includes the ticker; after DELETE it doesn't",
      "Favorites persist across buildApp instances sharing the same file DB (tested with a temp file)"
    ],
    "passes": false
  },
  {
    "id": "FE-01",
    "title": "Frontend tooling baseline: TanStack Query, Vitest + RTL, typecheck, Vite proxy, API client & types",
    "description": "Remove the Vite template boilerplate (hero, counter, logos). Add the approved dependencies: @tanstack/react-query, vitest, jsdom, @testing-library/react, @testing-library/user-event, @testing-library/jest-dom. Add test and typecheck scripts and a Vitest config (jsdom, setup file). In vite.config.ts, proxy /api → http://localhost:3000 with /api stripped. src/api/types.ts mirrors the PRD API contract (a deliberate duplicate; no shared package). src/api/client.ts is a typed fetch wrapper that parses the { error } shape into an ApiError (status, code, message) and never treats a non-2xx response as data. Include query-key factories and hooks-ready fetchers for every endpoint. main.tsx wraps the app in QueryClientProvider with sane defaults (retry: 1, no retry on 4xx or 503). Engines node >= 24.",
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
    "passes": false
  },
  {
    "id": "FE-02",
    "title": "Stock table with pagination, badges, data-as-of, disclaimer footer, and loading/error/empty states",
    "description": "components/StockTable (columns: ticker, name, industry, HalalBadge, favorite star placeholder that is display-only in this task), components/Pagination (prev/next, 'Page X of Y', disabled at the bounds), components/HalalBadge (three distinct visual states with a text label, not color-only), and components/Footer with the disclaimer ('Automated screen based on AAOIFI financial ratios only — revenue from non-permissible business lines is not analysed. Not a fatwa or financial advice.') plus 'Data as of <date>' from meta.dataAsOf. Uses useQuery with placeholderData keepPreviousData so the table doesn't flash on page change. States: loading skeleton; a DATA_NOT_SEEDED message telling the user to run `npm run seed`; a generic error with a retry button; an empty result. Styles and tests are colocated next to each component.",
    "files": [
      "frontend/src/App.tsx",
      "frontend/src/components/StockTable/StockTable.tsx",
      "frontend/src/components/StockTable/StockTable.css",
      "frontend/src/components/StockTable/StockTable.test.tsx",
      "frontend/src/components/HalalBadge/HalalBadge.tsx",
      "frontend/src/components/HalalBadge/HalalBadge.css",
      "frontend/src/components/HalalBadge/HalalBadge.test.tsx",
      "frontend/src/components/Pagination/Pagination.tsx",
      "frontend/src/components/Pagination/Pagination.css",
      "frontend/src/components/Pagination/Pagination.test.tsx",
      "frontend/src/components/Footer/Footer.tsx",
      "frontend/src/components/Footer/Footer.css",
      "frontend/src/components/Footer/Footer.test.tsx",
      "frontend/src/hooks/useStocks.ts"
    ],
    "acceptance_criteria": [
      "HalalBadge renders the distinct labels 'Halal', 'Not halal', and 'Unknown', each with accessible text (a test covers all three)",
      "The table renders rows from a mocked API response; Next/Prev change page and are disabled on the first/last page",
      "A 503 DATA_NOT_SEEDED shows a seed instruction, not a generic error; another error shows a retry button that refetches",
      "An empty result shows 'No stocks match'",
      "The footer shows the disclaimer and a formatted dataAsOf date, or 'Data date unavailable' when it's null",
      "Tests mock fetch or the API client; no real network",
      "Layout works at 400px width (the table scrolls horizontally inside its own container)"
    ],
    "passes": false
  },
  {
    "id": "FE-03",
    "title": "Search (debounced), halal status filter chips, favorites-only toggle",
    "description": "components/Toolbar containing SearchInput (250 ms debounce, trimmed, clear button), StatusFilter chips (All / Halal / Not halal / Unknown as a single-select radio group), and a FavoritesOnly toggle. hooks/useDebouncedValue. Filter state lives in App and is passed into useStocks → query key and params. Any filter or search change resets page to 1.",
    "files": [
      "frontend/src/App.tsx",
      "frontend/src/hooks/useStocks.ts",
      "frontend/src/hooks/useDebouncedValue.ts",
      "frontend/src/hooks/useDebouncedValue.test.ts",
      "frontend/src/components/Toolbar/Toolbar.tsx",
      "frontend/src/components/Toolbar/Toolbar.css",
      "frontend/src/components/Toolbar/Toolbar.test.tsx"
    ],
    "acceptance_criteria": [
      "Typing 'aapl' quickly fires exactly one request after 250 ms (tested with fake timers), with search=aapl",
      "Selecting the 'Not halal' chip sends status=not_halal; 'All' omits status",
      "The favorites-only toggle sends favoritesOnly=true and omits it when off",
      "Changing search, status, or favorites-only while on page 3 resets to page 1",
      "Chips are keyboard accessible (radio-group semantics, arrow/tab + space)",
      "The clear button empties the search and refetches the unfiltered list"
    ],
    "passes": false
  },
  {
    "id": "FE-04",
    "title": "Favorite star toggle with optimistic update",
    "description": "components/FavoriteButton (★/☆, aria-pressed, aria-label 'Add AAPL to favorites' / 'Remove AAPL from favorites'). hooks/useToggleFavorite uses a TanStack useMutation (POST/DELETE) with an optimistic update of cached stock lists and detail, rolls back on error with a visible non-blocking error message, and invalidates stock + favorites queries on settle. Clicking the star must not open the detail panel (stop propagation).",
    "files": [
      "frontend/src/components/FavoriteButton/FavoriteButton.tsx",
      "frontend/src/components/FavoriteButton/FavoriteButton.css",
      "frontend/src/components/FavoriteButton/FavoriteButton.test.tsx",
      "frontend/src/hooks/useToggleFavorite.ts",
      "frontend/src/hooks/useToggleFavorite.test.tsx",
      "frontend/src/components/StockTable/StockTable.tsx"
    ],
    "acceptance_criteria": [
      "Clicking an empty star sends POST /api/favorites/AAPL and the star fills immediately, before the response arrives",
      "Clicking a filled star sends DELETE, and the star empties immediately",
      "A server error rolls back the star state and shows an error message",
      "With the favorites-only filter on, unfavoriting removes the row after the invalidation refetch",
      "aria-pressed reflects state and the accessible label names the ticker",
      "Double-clicking quickly does not leave the UI out of sync with the server (the button is disabled while pending, or the last write wins; test it)"
    ],
    "passes": false
  },
  {
    "id": "FE-05",
    "title": "Detail side panel: ratios vs thresholds, business activity, reasons, disclaimer",
    "description": "Clicking a row (or pressing Enter on a focused row) opens components/StockDetailPanel, which fetches GET /stocks/:ticker via useStockDetail. It shows name/ticker/exchange/industry, the HalalBadge, market cap (compact format), a favorite button, the business-activity result, and a ratio list: each RatioResult as label, value %, limit %, a visual bar or indicator, a pass/breach/not-available state, and its explanation. Also the reasons list, 'Screened on <date>', and the disclaimer. Closes with Esc, the close button, or a backdrop click; focus moves into the panel on open and returns to the row on close. Loading, 404, and error states are included.",
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
      "Toggling favorite in the panel updates the table row star too (shared cache)",
      "A 404 shows 'Stock not found'",
      "At 400px width the panel is full-width"
    ],
    "passes": false
  },
  {
    "id": "DOC-01",
    "title": "README run instructions + end-to-end verification",
    "description": "Documentation only (a cross-service docs change, explicitly allowed). The root README covers the prerequisites (Node 24, Finnhub free key, SEC User-Agent) and clone → install → seed → run in about 5 commands, for both offline (`npm run seed:fixtures`) and live (`npm run seed`, ~15 min) paths. It also covers the methodology summary (AAOIFI thresholds, status resolution order, where to change thresholds, then `npm run seed -- --rescreen`), known limitations (financial-ratio screen only: no revenue-segment analysis, so mixed-business companies may be marked halal where commercial screeners like Zoya/Musaffa would not; 5% rule counts interest income only; current market cap not averaged, IFRS filers → unknown, Finnhub free tier is personal-use only, EDGAR data up to a quarter old), and the disclaimer. Update backend/README.md and frontend/README.md with the service-specific scripts. Then actually run the end-to-end verification from prompt.md and record the result in activity.md.",
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
    "passes": false
  }
]
```
