import type { ScreeningConfig } from "../types/halal.js";

// AAOIFI thresholds and business-activity denylists — the single source of
// truth for screening. lib/halal-screen.ts imports this and never
// hardcodes a threshold or a prohibited-industry/ticker string itself.
//
// Notes:
// - "Financial Services" is deliberately NOT in prohibitedIndustries: it's
//   too coarse a label (it also covers asset managers, exchanges, fintech,
//   etc. that aren't conventional lenders), and interest-bearing lenders
//   under that label are usually still caught by the interestIncomeToRevenue
//   ratio breach. Revisit only with per-company evidence.
// - VERIFIED against a full live seed of the S&P 500 (503 tickers,
//   2026-09-19). "Banking", "Insurance" and "Tobacco" all match real
//   `finnhubIndustry` values. "Casinos & Gaming" matches NOTHING — Finnhub
//   files casinos under "Hotels, Restaurants & Leisure" alongside hotels and
//   cruise lines, so that entry is currently dead. MGM/WYNN/LVS still come
//   out not_halal, but only because they happen to carry heavy debt; a
//   low-debt gambling company would pass. Fixing this properly means adding
//   them to prohibitedTickers (the STZ/TAP/BF.B pattern), not denylisting
//   the industry, which would also catch hotels and cruises. Deferred by the
//   user 2026-09-19.
//
// - Unknown-rate policy (measured on that same live seed, user decided
//   2026-09-19 to KEEP THE CURRENT STRICT BEHAVIOUR). 41% of the S&P 500
//   screens `unknown`, nearly all of it from two data issues that are more
//   bookkeeping than missing data:
//     (B) "TTM approximated from latest full fiscal year" — the figure IS
//         known, it just came from the annual filing instead of four
//         quarters (e.g. ADM: interest 0.6B / revenue 82.1B = 0.7%, passing
//         comfortably), yet the note voids the whole verdict.
//     (C) "Interest income not reported" — the company never files the line
//         because the amount is immaterial. Note the inconsistency this
//         creates: CPRT reports a literal 0 and screens `halal`, while ZTS
//         omits the line and screens `unknown` despite passing both other
//         ratios (debt 28%, cash 5%).
//   Measured effect on `unknown`: B alone 41%->32%, C alone 41%->16%, both
//   41%->6% (173 stocks move unknown->halal, and NOTHING flips to
//   not_halal — these are purely a loosening). Kept strict because C assumes
//   a number we don't have: our extractor checks three interest-income tags,
//   so a company filing under a different tag would look "not reported" and
//   could be wrongly called halal. Revisit only with per-company evidence.
// - Switching to the 33% DJIM/S&P alternative for the two market-cap
//   ratios is a one-line change here (debtToMarketCap /
//   cashAndSecuritiesToMarketCap: 0.33), not a code change in
//   lib/halal-screen.ts.
const config: ScreeningConfig = {
  methodology: "AAOIFI",
  thresholds: {
    debtToMarketCap: 0.3,
    cashAndSecuritiesToMarketCap: 0.3,
    interestIncomeToRevenue: 0.05,
  },
  prohibitedIndustries: ["Banking", "Insurance", "Tobacco", "Casinos & Gaming"],
  prohibitedTickers: ["STZ", "TAP", "BF.B"],
};

// Freeze deeply so an accidental mutation (e.g. `config.thresholds.debtToMarketCap = 0.5`)
// throws in strict-mode ESM instead of silently corrupting the shared default
// for every caller that didn't pass its own config.
Object.freeze(config.thresholds);
Object.freeze(config.prohibitedIndustries);
Object.freeze(config.prohibitedTickers);
export const DEFAULT_SCREENING_CONFIG: ScreeningConfig = Object.freeze(config);
