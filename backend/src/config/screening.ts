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
// - These industry/ticker labels are best-effort guesses at Finnhub's
//   `finnhubIndustry` vocabulary and ticker-level exceptions. They must be
//   verified against real Finnhub responses once BE-05 wires up the live
//   data source, and adjusted there if the actual labels differ.
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
