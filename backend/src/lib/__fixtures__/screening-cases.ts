// Known-answer fixtures for lib/halal-screen.test.ts.
//
// All figures below are illustrative round numbers chosen to make the hand
// computation obvious — they are NOT real filings/market data for the named
// companies (real Finnhub/EDGAR data is wired up in BE-05/BE-06). Company
// names are only used as flavor for recognizable industries/tickers.
import type { HalalStatus, RatioKey, ScreeningInput } from "../../types/halal.js";

export interface ScreeningCase {
  name: string;
  input: ScreeningInput;
  expected: {
    status: HalalStatus;
    // In RatioKey order: [debtToMarketCap, cashAndSecuritiesToMarketCap, interestIncomeToRevenue]
    ratioValues: [number | null, number | null, number | null];
    reasons?: string[];
  };
}

// Shared RatioKey-order reference for readers of this file (not used at
// runtime; halal-screen.ts's RATIO_KEYS is the actual runtime source).
export const RATIO_KEY_ORDER: readonly RatioKey[] = [
  "debtToMarketCap",
  "cashAndSecuritiesToMarketCap",
  "interestIncomeToRevenue",
];

export const SCREENING_CASES: ScreeningCase[] = [
  {
    // (a) AAPL-like: low debt, healthy cash, small interest income. All
    // three ratios pass and the industry is permissible -> halal.
    //   debt/marketCap     = 100/1000  = 0.10 (10%)  < 30% -> pass
    //   cash/marketCap     = 150/1000  = 0.15 (15%)  < 30% -> pass
    //   interest/revenue   = 1/100     = 0.01 (1%)   < 5%  -> pass
    name: "AAPL-like: all ratios pass, permissible industry -> halal",
    input: {
      ticker: "AAPL",
      industry: "Technology",
      marketCap: 1000,
      totalDebt: 100,
      cashAndSecurities: 150,
      interestIncomeTtm: 1,
      revenueTtm: 100,
      dataIssues: [],
    },
    expected: {
      status: "halal",
      ratioValues: [0.1, 0.15, 0.01],
      reasons: [
        "Debt / market cap: 10.0% is below the 30% limit.",
        "Cash and securities / market cap: 15.0% is below the 30% limit.",
        "Interest income / revenue: 1.0% is below the 5% limit.",
      ],
    },
  },
  {
    // (b) JPM-like: conventional bank. Ratios would all pass on their own,
    // but "Banking" is a prohibited industry, so the industry reason alone
    // drives not_halal (Amendment 1: reasons are exactly the prohibition
    // explanation, ratio passes are not appended).
    //   debt/marketCap   = 100/1000 = 0.10 (10%) < 30% -> pass
    //   cash/marketCap   = 150/1000 = 0.15 (15%) < 30% -> pass
    //   interest/revenue = 1/100    = 0.01 (1%)  < 5%  -> pass
    name: "JPM-like: Banking industry, ratios pass -> not_halal by industry",
    input: {
      ticker: "JPM",
      industry: "Banking",
      marketCap: 1000,
      totalDebt: 100,
      cashAndSecurities: 150,
      interestIncomeTtm: 1,
      revenueTtm: 100,
      dataIssues: [],
    },
    expected: {
      status: "not_halal",
      ratioValues: [0.1, 0.15, 0.01],
      reasons: ["Industry 'Banking' is not permissible under AAOIFI screening."],
    },
  },
  {
    // (c) T-like: high debt telecom. Industry is permissible, cash and
    // interest ratios pass, but debt/marketCap breaches -> not_halal with
    // exactly the debt-breach reason.
    //   debt/marketCap   = 400/1000 = 0.40 (40%) >= 30% -> breach
    //   cash/marketCap   = 100/1000 = 0.10 (10%) < 30%  -> pass
    //   interest/revenue = 1/100    = 0.01 (1%)  < 5%   -> pass
    name: "T-like: debt ratio breach in permissible industry -> not_halal",
    input: {
      ticker: "T",
      industry: "Telecommunication Services",
      marketCap: 1000,
      totalDebt: 400,
      cashAndSecurities: 100,
      interestIncomeTtm: 1,
      revenueTtm: 100,
      dataIssues: [],
    },
    expected: {
      status: "not_halal",
      ratioValues: [0.4, 0.1, 0.01],
      reasons: ["Debt / market cap: 40.0% meets or exceeds the 30% limit."],
    },
  },
  {
    // (d) STZ: ticker-level denylist (alcohol producer under the coarse
    // "Beverages" industry label). Ratios all pass, but the ticker match
    // alone drives not_halal.
    //   debt/marketCap   = 100/1000 = 0.10 (10%) < 30% -> pass
    //   cash/marketCap   = 150/1000 = 0.15 (15%) < 30% -> pass
    //   interest/revenue = 1/100    = 0.01 (1%)  < 5%  -> pass
    name: "STZ: ticker denylist under Beverages industry -> not_halal",
    input: {
      ticker: "STZ",
      industry: "Beverages",
      marketCap: 1000,
      totalDebt: 100,
      cashAndSecurities: 150,
      interestIncomeTtm: 1,
      revenueTtm: 100,
      dataIssues: [],
    },
    expected: {
      status: "not_halal",
      ratioValues: [0.1, 0.15, 0.01],
      reasons: ["'STZ' is on the prohibited-business ticker list."],
    },
  },
  {
    // (e) Technology company with interest income missing (e.g. not
    // reported); debt and cash ratios still pass -> unknown.
    //   debt/marketCap   = 100/1000 = 0.10 (10%) < 30% -> pass
    //   cash/marketCap   = 150/1000 = 0.15 (15%) < 30% -> pass
    //   interest/revenue = null (interest income missing)
    name: "Technology, interest income missing -> unknown",
    input: {
      ticker: "TECU",
      industry: "Technology",
      marketCap: 1000,
      totalDebt: 100,
      cashAndSecurities: 150,
      interestIncomeTtm: null,
      revenueTtm: 100,
      dataIssues: [],
    },
    expected: {
      status: "unknown",
      ratioValues: [0.1, 0.15, null],
      reasons: ["Interest income / revenue: Not available: interest income is missing."],
    },
  },
  {
    // (f) IFRS filer: no US-GAAP financials at all (all null), with the
    // IFRS data issue recorded upstream -> unknown, all three ratios null.
    name: "IFRS filer, no financials -> unknown",
    input: {
      ticker: "IFRSCO",
      industry: "Technology",
      marketCap: null,
      totalDebt: null,
      cashAndSecurities: null,
      interestIncomeTtm: null,
      revenueTtm: null,
      dataIssues: ["Foreign/IFRS filer — financials not screened"],
    },
    expected: {
      status: "unknown",
      ratioValues: [null, null, null],
      reasons: [
        "Debt / market cap: Not available: market cap is missing.",
        "Cash and securities / market cap: Not available: market cap is missing.",
        "Interest income / revenue: Not available: revenue is missing.",
        "Data issue: Foreign/IFRS filer — financials not screened",
      ],
    },
  },
  {
    // (g) Market cap 0: both market-cap-denominated ratios become null
    // (denominator zero-or-negative), interest ratio still computes and
    // passes -> unknown, no NaN/Infinity.
    //   debt/marketCap   = null (market cap is zero or negative)
    //   cash/marketCap   = null (market cap is zero or negative)
    //   interest/revenue = 1/100 = 0.01 (1%) < 5% -> pass
    name: "Market cap zero -> unknown, no NaN/Infinity",
    input: {
      ticker: "ZCAP",
      industry: "Technology",
      marketCap: 0,
      totalDebt: 100,
      cashAndSecurities: 100,
      interestIncomeTtm: 1,
      revenueTtm: 100,
      dataIssues: [],
    },
    expected: {
      status: "unknown",
      ratioValues: [null, null, 0.01],
      reasons: [
        "Debt / market cap: Not available: market cap is zero or negative.",
        "Cash and securities / market cap: Not available: market cap is zero or negative.",
      ],
    },
  },
  {
    // (h) Debt ratio breach AND interest income missing -> breach wins,
    // not_halal, and the reason list contains only the breach (the missing
    // ratio's "Not available" text is not a not_halal reason).
    //   debt/marketCap   = 500/1000 = 0.50 (50%) >= 30% -> breach
    //   cash/marketCap   = 100/1000 = 0.10 (10%) < 30%  -> pass
    //   interest/revenue = null (interest income missing)
    name: "Debt breach + missing interest income -> not_halal (breach wins)",
    input: {
      ticker: "HIDEBT",
      industry: "Technology",
      marketCap: 1000,
      totalDebt: 500,
      cashAndSecurities: 100,
      interestIncomeTtm: null,
      revenueTtm: 100,
      dataIssues: [],
    },
    expected: {
      status: "not_halal",
      ratioValues: [0.5, 0.1, null],
      reasons: ["Debt / market cap: 50.0% meets or exceeds the 30% limit."],
    },
  },
  {
    // (i) Debt ratio exactly at the 30% threshold -> breach (strict >=,
    // i.e. "equal counts as breach"). Also used in halal-screen.test.ts
    // with a config override (threshold 0.33) to prove the same case
    // becomes halal.
    //   debt/marketCap   = 300/1000 = 0.30 (30%) >= 30% -> breach
    //   cash/marketCap   = 100/1000 = 0.10 (10%) < 30%  -> pass
    //   interest/revenue = 1/100    = 0.01 (1%)  < 5%   -> pass
    name: "Debt ratio exactly at threshold -> not_halal (strict boundary)",
    input: {
      ticker: "EXACT30",
      industry: "Technology",
      marketCap: 1000,
      totalDebt: 300,
      cashAndSecurities: 100,
      interestIncomeTtm: 1,
      revenueTtm: 100,
      dataIssues: [],
    },
    expected: {
      status: "not_halal",
      ratioValues: [0.3, 0.1, 0.01],
      reasons: ["Debt / market cap: 30.0% meets or exceeds the 30% limit."],
    },
  },
  {
    // (j) Industry missing/null with otherwise-passing ratios -> unknown,
    // businessActivity.prohibited is null (not false), and the reason is
    // the industry-missing explanation.
    //   debt/marketCap   = 100/1000 = 0.10 (10%) < 30% -> pass
    //   cash/marketCap   = 150/1000 = 0.15 (15%) < 30% -> pass
    //   interest/revenue = 1/100    = 0.01 (1%)  < 5%  -> pass
    name: "Industry null, ratios pass -> unknown, prohibited null",
    input: {
      ticker: "NOIND",
      industry: null,
      marketCap: 1000,
      totalDebt: 100,
      cashAndSecurities: 150,
      interestIncomeTtm: 1,
      revenueTtm: 100,
      dataIssues: [],
    },
    expected: {
      status: "unknown",
      ratioValues: [0.1, 0.15, 0.01],
      reasons: ["Industry not available; business activity could not be screened."],
    },
  },
  {
    // (k) Banking industry (prohibited) with a data issue AND all ratios
    // passing -> not_halal. Regression guard for status-order step 1
    // (prohibition) never being evaluated after step 3 (data issues): if it
    // were, this would incorrectly resolve to "unknown". Reasons are
    // EXACTLY the prohibition explanation -- no "Data issue: ..." line,
    // since not_halal reasons never include data-issue text (Amendment 1).
    //   debt/marketCap   = 100/1000 = 0.10 (10%) < 30% -> pass
    //   cash/marketCap   = 150/1000 = 0.15 (15%) < 30% -> pass
    //   interest/revenue = 1/100    = 0.01 (1%)  < 5%  -> pass
    name: "Banking industry with a data issue, ratios pass -> not_halal (prohibition wins)",
    input: {
      ticker: "BKISS",
      industry: "Banking",
      marketCap: 1000,
      totalDebt: 100,
      cashAndSecurities: 150,
      interestIncomeTtm: 1,
      revenueTtm: 100,
      dataIssues: ["Interest income not reported"],
    },
    expected: {
      status: "not_halal",
      ratioValues: [0.1, 0.15, 0.01],
      reasons: ["Industry 'Banking' is not permissible under AAOIFI screening."],
    },
  },
  {
    // (l) Industry null (would resolve to "unknown" on its own) AND a debt
    // ratio breach -> not_halal. Regression guard for status-order step 2
    // (breach) never being evaluated after step 3 (missing industry): if it
    // were, this would incorrectly resolve to "unknown". Reasons are
    // EXACTLY the debt-breach explanation; businessActivity.prohibited
    // stays null (the industry truly is unknown, it's just not what drove
    // the status).
    //   debt/marketCap   = 400/1000 = 0.40 (40%) >= 30% -> breach
    //   cash/marketCap   = 100/1000 = 0.10 (10%) < 30%  -> pass
    //   interest/revenue = 1/100    = 0.01 (1%)  < 5%   -> pass
    name: "Debt breach, industry null -> not_halal (breach wins over missing industry)",
    input: {
      ticker: "NOINDBRCH",
      industry: null,
      marketCap: 1000,
      totalDebt: 400,
      cashAndSecurities: 100,
      interestIncomeTtm: 1,
      revenueTtm: 100,
      dataIssues: [],
    },
    expected: {
      status: "not_halal",
      ratioValues: [0.4, 0.1, 0.01],
      reasons: ["Debt / market cap: 40.0% meets or exceeds the 30% limit."],
    },
  },
];
