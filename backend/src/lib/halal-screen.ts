import type {
  HalalScreening,
  RatioKey,
  RatioResult,
  ScreeningConfig,
  ScreeningInput,
} from "../types/halal.js";
import { DEFAULT_SCREENING_CONFIG } from "../config/screening.js";

// Canonical order for the three ratios everywhere they appear (the ratios
// array, and the order reasons are appended in).
export const RATIO_KEYS: readonly RatioKey[] = [
  "debtToMarketCap",
  "cashAndSecuritiesToMarketCap",
  "interestIncomeToRevenue",
];

const RATIO_LABELS: Record<RatioKey, string> = {
  debtToMarketCap: "Debt / market cap",
  cashAndSecuritiesToMarketCap: "Cash and securities / market cap",
  interestIncomeToRevenue: "Interest income / revenue",
};

// "At the limit" tolerance for the strict-< boundary: a ratio within 1e-6
// (0.0001 percentage points) of its threshold counts as a breach. This
// absorbs float noise (0.299999999999) and is deliberately conservative —
// e.g. 29.99999% debt/market cap is treated as 30% → not_halal (user
// decision 2026-09-16; that precision is meaningless for financial
// statements reported in thousands/millions). It also guarantees that any
// value outside the band differs from the threshold at 4 decimals, so the
// explanation can never read "30.0000% is below the 30% limit."
const EPSILON = 1e-6;

// Honest predicate: true only for a real, finite number. (The previous
// isMissingNumber(value): value is null lied about its own type — it also
// returned true for NaN/Infinity, which are not null, so TypeScript would
// happily let you treat a NaN as `null` afterwards.)
function isUsableNumber(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

interface RatioComputation {
  value: number | null;
  cause: string | null; // set when value is null
}

// Computes one ratio (numerator / denominator), guarding against missing,
// negative, and non-positive-denominator inputs. When BOTH the numerator
// and the denominator are missing/invalid, the denominator's cause is
// reported (a deliberate, documented choice — see halal-screen.test.ts —
// since "we don't even know the base to divide by" reads as the more
// fundamental problem than "we don't have the top number either").
function computeRatio(
  numerator: number | null,
  numeratorName: string,
  denominator: number | null,
  denominatorName: string,
): RatioComputation {
  if (!isUsableNumber(denominator)) {
    return { value: null, cause: `${denominatorName} is missing` };
  }
  if (denominator <= 0) {
    return { value: null, cause: `${denominatorName} is zero or negative` };
  }
  if (!isUsableNumber(numerator)) {
    return { value: null, cause: `${numeratorName} is missing` };
  }
  if (numerator < 0) {
    return { value: null, cause: `${numeratorName} is negative` };
  }

  const value = numerator / denominator;
  if (!Number.isFinite(value)) {
    // Should be unreachable given the guards above (finite numerator,
    // finite denominator > 0 always yields a finite quotient), but kept as
    // a safety net so the function can never leak NaN/Infinity.
    return { value: null, cause: `${denominatorName} is missing` };
  }
  return { value, cause: null };
}

// Rounds a fraction to a percent string with exactly 1 decimal place, e.g.
// 0.1234 -> "12.3%", 0 -> "0.0%". Used for ratio *values* that are not close
// enough to their threshold to need escalated precision (see
// formatRatioValuePercent below).
function formatValuePercent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

// Formats a ratio *value* as a percent for its explanation, escalating past
// the default 1 decimal place when 1-decimal rounding would make the value
// display identically to the threshold's own display (e.g. 0.0499 vs a 5%
// threshold both read "5.0%" at 1 decimal, which looks contradictory next to
// "is below the 5% limit."). A value within EPSILON of the threshold is left
// at 1 decimal — it's deliberately meant to read as "at the limit", since it
// effectively is (see the strict-boundary EPSILON slack elsewhere in this
// file).
//
// Rule: starting at 1 decimal, add a decimal place at a time (capped at 4)
// until the value's rounded string differs from the threshold's rounded
// string at that same precision, then use that precision. This is the
// simplest rule that guarantees the displayed value differs from the
// displayed limit whenever the true value differs from the true threshold
// (a fixed "always show 2 decimals" rule doesn't have this property — e.g.
// 0.29999 vs a 0.30 threshold still reads "30.00%" for both at 2 decimals).
function formatRatioValuePercent(value: number, threshold: number): string {
  if (Math.abs(value - threshold) <= EPSILON) {
    return formatValuePercent(value);
  }

  const valuePct = value * 100;
  const thresholdPct = threshold * 100;
  const MAX_DECIMALS = 4;
  for (let decimals = 1; decimals <= MAX_DECIMALS; decimals++) {
    const valueStr = valuePct.toFixed(decimals);
    if (valueStr !== thresholdPct.toFixed(decimals)) {
      return `${valueStr}%`;
    }
  }
  // Unreachable: agreeing at 4 decimals of percent requires being within
  // 0.00005 percentage points, which is inside the EPSILON band (0.0001
  // points) handled above. Kept as a defensive fallback.
  return `${valuePct.toFixed(MAX_DECIMALS)}%`;
}

// Rounds a fraction to a percent string with up to 1 decimal place, dropping
// a trailing ".0", e.g. 0.30 -> "30%", 0.05 -> "5%", 0.325 -> "32.5%". Used
// for *thresholds*, which are configured as round-ish numbers.
function formatThresholdPercent(fraction: number): string {
  const rounded = Math.round(fraction * 1000) / 10; // percent, 1 decimal
  const fixed = rounded.toFixed(1);
  const trimmed = fixed.endsWith(".0") ? fixed.slice(0, -2) : fixed;
  return `${trimmed}%`;
}

function buildRatioResult(
  key: RatioKey,
  numerator: number | null,
  numeratorName: string,
  denominator: number | null,
  denominatorName: string,
  threshold: number,
): RatioResult {
  const { value, cause } = computeRatio(numerator, numeratorName, denominator, denominatorName);
  const label = RATIO_LABELS[key];

  if (value === null) {
    return {
      key,
      label,
      value: null,
      threshold,
      breached: null,
      explanation: `Not available: ${cause}.`,
    };
  }

  const breached = value >= threshold - EPSILON;
  const valuePct = formatRatioValuePercent(value, threshold);
  const thresholdPct = formatThresholdPercent(threshold);
  const explanation = breached
    ? `${valuePct} meets or exceeds the ${thresholdPct} limit.`
    : `${valuePct} is below the ${thresholdPct} limit.`;

  return { key, label, value, threshold, breached, explanation };
}

// Uppercases, trims, and maps '-' to '.' so BF-B/BRK-B style aliases match
// the canonical dotted ticker form used in the denylist. This duplicates a
// sliver of what BE-03's lib/ticker.ts will do; that module is canonical
// once it lands and this local helper should be replaced with an import
// from it (screen() must stay dependency-free from db/ in the meantime).
function normalizeTickerLocal(ticker: string): string {
  return ticker.trim().toUpperCase().replaceAll("-", ".");
}

interface BusinessActivity {
  industry: string | null;
  prohibited: boolean | null;
  explanation: string;
}

function resolveBusinessActivity(input: ScreeningInput, config: ScreeningConfig): BusinessActivity {
  const normalizedTicker = normalizeTickerLocal(input.ticker);
  const trimmedIndustry = input.industry === null ? null : input.industry.trim();
  const industry = trimmedIndustry === "" ? null : trimmedIndustry;

  // Ticker denylist is checked first. When a ticker AND its industry are
  // both on their respective denylists (e.g. a hypothetical alcohol
  // producer also labeled "Beverages" that later also gets its industry
  // added to prohibitedIndustries), the ticker-list explanation wins simply
  // because it's evaluated first — a deterministic, documented tie-break
  // rather than a special case.
  if (config.prohibitedTickers.includes(normalizedTicker)) {
    return {
      industry,
      prohibited: true,
      explanation: `'${normalizedTicker}' is on the prohibited-business ticker list.`,
    };
  }

  if (industry !== null) {
    const industryIsProhibited = config.prohibitedIndustries.some(
      (prohibited) => prohibited.toLowerCase() === industry.toLowerCase(),
    );
    if (industryIsProhibited) {
      return {
        industry,
        prohibited: true,
        explanation: `Industry '${industry}' is not permissible under AAOIFI screening.`,
      };
    }
    return {
      industry,
      prohibited: false,
      explanation: `Industry '${industry}' is permissible under AAOIFI screening.`,
    };
  }

  return {
    industry: null,
    prohibited: null,
    explanation: "Industry not available; business activity could not be screened.",
  };
}

function resolveStatus(
  businessActivity: BusinessActivity,
  ratios: RatioResult[],
  dataIssues: string[],
): HalalScreening["status"] {
  if (businessActivity.prohibited === true) {
    return "not_halal";
  }
  if (ratios.some((ratio) => ratio.breached === true)) {
    return "not_halal";
  }
  if (
    ratios.some((ratio) => ratio.value === null) ||
    businessActivity.prohibited === null ||
    dataIssues.length > 0
  ) {
    return "unknown";
  }
  return "halal";
}

// Prefixes a ratio's explanation with its label for the *reasons* list only
// (e.g. "Debt / market cap: 40.0% meets or exceeds the 30% limit."), so a
// reader can tell which ratio each line refers to and, when marketCap is 0,
// so the two "Not available: market cap is zero or negative." lines read as
// distinct. RatioResult.explanation itself is left unlabeled: the API
// contract already carries `label` as its own field alongside `explanation`
// for callers (e.g. the UI) that show them side by side rather than
// concatenated.
function labeledRatioReason(ratio: RatioResult): string {
  return `${ratio.label}: ${ratio.explanation}`;
}

function buildReasons(
  status: HalalScreening["status"],
  businessActivity: BusinessActivity,
  ratios: RatioResult[],
  dataIssues: string[],
): string[] {
  const reasons: string[] = [];

  if (status === "not_halal") {
    if (businessActivity.prohibited === true) {
      reasons.push(businessActivity.explanation);
    }
    for (const ratio of ratios) {
      if (ratio.breached === true) {
        reasons.push(labeledRatioReason(ratio));
      }
    }
    return reasons;
  }

  if (status === "unknown") {
    if (businessActivity.prohibited === null) {
      reasons.push(businessActivity.explanation);
    }
    for (const ratio of ratios) {
      if (ratio.value === null) {
        reasons.push(labeledRatioReason(ratio));
      }
    }
    for (const issue of dataIssues) {
      reasons.push(`Data issue: ${issue}`);
    }
    return reasons;
  }

  // halal: no prohibition and no missing data, so every ratio explanation
  // is a "pass" explanation.
  for (const ratio of ratios) {
    reasons.push(labeledRatioReason(ratio));
  }
  return reasons;
}

// Pure AAOIFI screening: no Date, no I/O, no imports beyond types/ and
// config/. `screenedAt` is always null here — the seed job (BE-06) stamps
// it with the actual screening timestamp at persistence time, since this
// function has no clock access by design (keeps it trivially testable and
// referentially transparent).
export function screen(
  input: ScreeningInput,
  config: ScreeningConfig = DEFAULT_SCREENING_CONFIG,
): HalalScreening {
  const businessActivity = resolveBusinessActivity(input, config);

  const ratios: RatioResult[] = [
    buildRatioResult(
      "debtToMarketCap",
      input.totalDebt,
      "total debt",
      input.marketCap,
      "market cap",
      config.thresholds.debtToMarketCap,
    ),
    buildRatioResult(
      "cashAndSecuritiesToMarketCap",
      input.cashAndSecurities,
      "cash and securities",
      input.marketCap,
      "market cap",
      config.thresholds.cashAndSecuritiesToMarketCap,
    ),
    buildRatioResult(
      "interestIncomeToRevenue",
      input.interestIncomeTtm,
      "interest income",
      input.revenueTtm,
      "revenue",
      config.thresholds.interestIncomeToRevenue,
    ),
  ];

  const status = resolveStatus(businessActivity, ratios, input.dataIssues);
  const reasons = buildReasons(status, businessActivity, ratios, input.dataIssues);

  return {
    status,
    methodology: "AAOIFI",
    screenedAt: null,
    businessActivity,
    ratios,
    reasons,
  };
}
