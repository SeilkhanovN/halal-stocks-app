# S&P 500 constituents snapshot

- **Source:** https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv
- **Snapshot date:** 2026-09-17
- **Row count:** 503 data rows (504 lines including the header)
- **Header:** `Symbol,Security,GICS Sector,GICS Sub-Industry,Headquarters Location,Date added,CIK,Founded`

## What's used

Only three columns are read by `src/sources/constituents.ts`: `Symbol`
(→ ticker), `Security` (→ name), and `CIK` (→ zero-padded 10-digit CIK, or
`null` if blank). The other columns (GICS sector/sub-industry, headquarters,
date added, founded) are not currently used.

## Refresh steps

1. Re-download the snapshot:
   ```
   curl -sSL -o backend/data/constituents/sp500.csv https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv
   ```
2. Update the snapshot date and row count in this README.
3. Run `npm run seed:constituents` (from `backend/`) to upsert the new
   identities into SQLite. Existing rows only have `name`/`cik` refreshed —
   financials and screening are untouched, so re-running the halal seed
   (`npm run seed`) afterwards is unaffected by this step.

## Deferred

NASDAQ-100 is **not** included in this snapshot — it's a later follow-up
(see `MVP-01`'s scope note in `prd.md`). The universe is S&P 500 only for
now (~503 tickers).
