// Shared shapes for halal screening. Mirrors the API contract in prd.md
// exactly (field names, orderings) so routes/ and lib/halal-screen.ts never
// duplicate this shape. Type-only module: no runtime exports here (see
// lib/halal-screen.ts for the RATIO_KEYS runtime constant).

export type HalalStatus = "halal" | "not_halal" | "unknown";

export type RatioKey =
  | "debtToMarketCap"
  | "cashAndSecuritiesToMarketCap"
  | "interestIncomeToRevenue";

export interface RatioResult {
  key: RatioKey;
  label: string; // e.g. "Debt / market cap"
  value: number | null; // fraction, e.g. 0.123; null = not computable
  threshold: number; // fraction, e.g. 0.30
  breached: boolean | null; // null when value is null
  explanation: string; // plain language, e.g. "12.3% is below the 30% limit."
}

export interface HalalScreening {
  status: HalalStatus;
  methodology: "AAOIFI";
  screenedAt: string | null; // ISO timestamp; stamped at persistence (BE-06)
  businessActivity: {
    industry: string | null;
    prohibited: boolean | null;
    explanation: string;
  };
  ratios: RatioResult[]; // always all three, in RatioKey order
  reasons: string[]; // why this status, plain language
}

export interface ScreeningInput {
  ticker: string;
  industry: string | null;
  marketCap: number | null;
  totalDebt: number | null;
  cashAndSecurities: number | null;
  interestIncomeTtm: number | null;
  revenueTtm: number | null;
  dataIssues: string[]; // e.g. "Foreign/IFRS filer — financials not screened"
}

export interface ScreeningConfig {
  methodology: "AAOIFI";
  thresholds: Record<RatioKey, number>;
  prohibitedIndustries: readonly string[];
  prohibitedTickers: readonly string[];
}
