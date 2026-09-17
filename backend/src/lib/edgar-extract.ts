// Pure, network-free extraction of the four AAOIFI screening inputs
// (total debt, cash+securities, interest income TTM, revenue TTM) from a SEC
// EDGAR "companyfacts" JSON document. No fs, no fetch, no throw — malformed
// or partial input degrades to nulls + an issue, never an exception.
//
// SCOPE (BE-04, 2026-09-17): no fixture files, no network calls. Tests use
// small inline companyfacts-shaped literals only. Realistic EDGAR fixture
// files and the live HTTP client move to BE-05.
//
// Decisions baked into this module (documented here so BE-05/BE-06 don't
// have to reverse-engineer them):
//
// - Day-count convention for classifying a duration fact's length: EXCLUSIVE
//   calendar-day difference between `start` and `end`
//   ((end - start) / 86_400_000ms), not inclusive (+1). A calendar quarter
//   (e.g. 2023-01-01..2023-03-31) is ~89-92 days under this convention,
//   comfortably inside the 80-100 day "quarter" bucket the spec gives; a
//   fiscal year is ~364-365 days, inside 350-380. Any convention that keeps
//   real quarters/9-months/years inside their buckets works — this one was
//   picked for being the simplest `Date` arithmetic.
// - "Adjacency" between two quarters when walking the TTM window backward:
//   two checks, either sufficient (see isAdjacentQuarter below) — (1) the
//   earlier quarter's `end` lines up with the later quarter's `start`
//   (±7 days, absorbing weekend/leap-year period-end drift and a derived
//   quarter's synthetic start date), or (2) as a fallback when start
//   alignment is ambiguous, the two quarters' `end` dates are one
//   quarter-length (80-100 days) apart.
// - Restatement resolution, "at a date" component lookups, and tag-recency
//   selection are all pure string/number comparisons — see the per-function
//   comments below.
export interface ExtractedFinancials {
  totalDebt: number | null;
  cashAndSecurities: number | null;
  interestIncomeTtm: number | null;
  revenueTtm: number | null;
  asOf: { balanceSheet: string | null; income: string | null }; // EDGAR `end` dates
  issues: string[]; // deduped, stable (first-seen) order
}

// ---------------------------------------------------------------------------
// Tag fallback lists (exported so BE-05/BE-06 and tests can reference the
// exact tags this module reads without duplicating the list).
// ---------------------------------------------------------------------------

// Balance sheet: debt. See extractDebt() for how these combine.
export const DEBT_BASE_TAGS = ["LongTermDebtNoncurrent", "LongTermDebt", "DebtCurrent"] as const;
export const DEBT_CURRENT_PORTION_TAG = "LongTermDebtCurrent";
export const SHORT_TERM_DEBT_TAGS = ["ShortTermBorrowings", "CommercialPaper"] as const;

// Balance sheet: cash + securities. See extractCash().
export const PRIMARY_CASH_TAGS = [
  "CashAndCashEquivalentsAtCarryingValue",
  "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
] as const;
export const SHORT_TERM_SECURITIES_TAGS = [
  "ShortTermInvestments",
  "MarketableSecuritiesCurrent",
  "AvailableForSaleSecuritiesDebtSecuritiesCurrent",
] as const;
export const LONG_TERM_SECURITIES_TAGS = [
  "MarketableSecuritiesNoncurrent",
  "AvailableForSaleSecuritiesDebtSecuritiesNoncurrent",
] as const;

// Income: revenue and interest income, each TTM. See extractIncomeField().
export const REVENUE_TAGS = [
  "Revenues",
  "RevenueFromContractWithCustomerExcludingAssessedTax",
  "SalesRevenueNet",
] as const;
export const INTEREST_TAGS = [
  "InvestmentIncomeInterest",
  "InterestAndDividendIncomeOperating",
  "InvestmentIncomeInterestAndDividend",
] as const;

const IFRS_ISSUE = "Foreign/IFRS filer — financials not screened";
const FORM_PATTERN = /^(10-K|10-Q|20-F|40-F)(\/A)?$/;

// ---------------------------------------------------------------------------
// Runtime shape validation. No `any`, no `as` — every unknown is narrowed by
// typeof/Array.isArray checks only. A fact that fails validation is dropped
// silently, per spec.
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getUsGaapFacts(companyFacts: unknown): Record<string, unknown> | null {
  if (!isRecord(companyFacts)) return null;
  const facts = companyFacts["facts"];
  if (!isRecord(facts)) return null;
  const usGaap = facts["us-gaap"];
  if (!isRecord(usGaap)) return null;
  return usGaap;
}

interface RawFact {
  start: string | null;
  end: string;
  val: number;
  form: string;
  filed: string;
}

function parseFactPoint(value: unknown): RawFact | null {
  if (!isRecord(value)) return null;
  const end = value["end"];
  const val = value["val"];
  const form = value["form"];
  const filed = value["filed"];
  const start = value["start"];

  if (typeof end !== "string" || end === "") return null;
  if (typeof val !== "number" || !Number.isFinite(val)) return null;
  if (typeof form !== "string" || form === "") return null;
  if (typeof filed !== "string" || filed === "") return null;
  if (start !== undefined && typeof start !== "string") return null;

  return {
    start: typeof start === "string" ? start : null,
    end,
    val,
    form,
    filed,
  };
}

// Groups by period (instants by `end` alone, so an omitted start and
// start === end dedupe together; durations by `${start}|${end}`) and keeps the fact with the greatest
// `filed` (ISO string comparison); on a filed tie, keeps the one that comes
// later in the input array (implemented by using `>=` so a later occurrence
// always replaces an equal-filed earlier one).
function dedupeRestatements(facts: readonly RawFact[]): RawFact[] {
  const byPeriod = new Map<string, RawFact>();
  for (const fact of facts) {
    const isInstant = fact.start === null || fact.start === fact.end;
    const key = isInstant ? `|${fact.end}` : `${fact.start}|${fact.end}`;
    const existing = byPeriod.get(key);
    if (!existing || fact.filed >= existing.filed) {
      byPeriod.set(key, fact);
    }
  }
  return [...byPeriod.values()];
}

interface TagExtraction {
  facts: RawFact[];
  nonUsdOnly: boolean;
}

// Reads one us-gaap tag's `{ units: { USD: [...] } }` shape: validates each
// fact point, keeps only the forms this module screens, and dedupes
// restatements. A tag whose `units` object is non-empty but has no `USD` key
// is reported via `nonUsdOnly` so the caller can add the "ignored" issue.
function extractTagFacts(tagValue: unknown): TagExtraction {
  if (!isRecord(tagValue)) return { facts: [], nonUsdOnly: false };
  const units = tagValue["units"];
  if (!isRecord(units)) return { facts: [], nonUsdOnly: false };

  const usd = units["USD"];
  if (!Array.isArray(usd)) {
    return { facts: [], nonUsdOnly: Object.keys(units).length > 0 };
  }

  const parsed: RawFact[] = [];
  for (const item of usd) {
    const parsedFact = parseFactPoint(item);
    if (parsedFact) parsed.push(parsedFact);
  }
  const formFiltered = parsed.filter((f) => FORM_PATTERN.test(f.form));
  return { facts: dedupeRestatements(formFiltered), nonUsdOnly: false };
}

// ---------------------------------------------------------------------------
// Small shared utilities.
// ---------------------------------------------------------------------------

interface IssueCollector {
  add(issue: string): void;
  toArray(): string[];
}

function createIssueCollector(): IssueCollector {
  const seen = new Set<string>();
  const list: string[] = [];
  return {
    add(issue: string): void {
      if (!seen.has(issue)) {
        seen.add(issue);
        list.push(issue);
      }
    },
    toArray(): string[] {
      return [...list];
    },
  };
}

function isInstantFact(fact: RawFact): boolean {
  return fact.start === null || fact.start === fact.end;
}

interface DurationFact extends RawFact {
  start: string;
}

function isDurationFact(fact: RawFact): fact is DurationFact {
  return fact.start !== null && fact.start !== fact.end;
}

function latestEndOf(facts: readonly RawFact[]): string | null {
  let latest: string | null = null;
  for (const f of facts) {
    if (latest === null || f.end > latest) latest = f.end;
  }
  return latest;
}

function findFactAt(facts: readonly RawFact[], date: string): RawFact | null {
  return facts.find((f) => f.end === date) ?? null;
}

function laterOf(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a > b ? a : b;
}

// Picks the candidate whose latest usable `end` is the most recent; ties
// broken by list order (the first candidate with the max end wins, since we
// only replace `best` on a strict `>`).
function pickMostRecentTag<T extends { latestEnd: string | null }>(candidates: readonly T[]): T | null {
  let best: T | null = null;
  let bestEnd: string | null = null;
  for (const candidate of candidates) {
    if (candidate.latestEnd === null) continue;
    if (bestEnd === null || candidate.latestEnd > bestEnd) {
      best = candidate;
      bestEnd = candidate.latestEnd;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Balance sheet (instants).
// ---------------------------------------------------------------------------

interface TagData {
  tag: string;
  facts: RawFact[];
  latestEnd: string | null;
}

function buildTagDataOne(
  usGaap: Record<string, unknown>,
  tag: string,
  filterFn: (fact: RawFact) => boolean,
  issues: IssueCollector,
): TagData {
  const extraction = extractTagFacts(usGaap[tag]);
  if (extraction.nonUsdOnly) {
    issues.add(`${tag} reported in non-USD units; ignored.`);
  }
  const facts = extraction.facts.filter(filterFn);
  return { tag, facts, latestEnd: latestEndOf(facts) };
}

function buildTagData(
  usGaap: Record<string, unknown>,
  tags: readonly string[],
  filterFn: (fact: RawFact) => boolean,
  issues: IssueCollector,
): TagData[] {
  return tags.map((tag) => buildTagDataOne(usGaap, tag, filterFn, issues));
}

function findTagData(data: readonly TagData[], tag: string): TagData {
  return data.find((d) => d.tag === tag) ?? { tag, facts: [], latestEnd: null };
}

interface DebtResult {
  totalDebt: number | null;
  debtDate: string | null;
}

// Base tag chosen by recency among LongTermDebtNoncurrent / LongTermDebt /
// DebtCurrent (list order breaks ties). Then:
//  - LongTermDebtNoncurrent: + LongTermDebtCurrent at the same date (or 0).
//  - LongTermDebt: used alone — it already includes the current portion, so
//    LongTermDebtCurrent is never added on top of it (would double-count).
//  - DebtCurrent: used alone.
// Either way, + ShortTermBorrowings at debtDate if present, else
// CommercialPaper at debtDate if present, else 0 (never both).
// If none of the three base tags exist but a short-term borrowing tag does,
// that tag alone (chosen by recency) becomes the whole debt figure.
// If NONE of these five tags exist at all, totalDebt is null with an issue —
// deliberately conservative: "we don't know" must resolve to `unknown`
// status downstream, never to a fabricated "no debt" (0).
// Lease liabilities (operating/finance) are intentionally excluded from
// debt for this MVP screen, per the BE-04 spec.
function extractDebt(usGaap: Record<string, unknown>, issues: IssueCollector): DebtResult {
  const baseData = buildTagData(usGaap, DEBT_BASE_TAGS, isInstantFact, issues);
  const shortData = buildTagData(usGaap, SHORT_TERM_DEBT_TAGS, isInstantFact, issues);
  const currentPortionData = buildTagDataOne(usGaap, DEBT_CURRENT_PORTION_TAG, isInstantFact, issues);

  const chosenBase = pickMostRecentTag(baseData);
  if (chosenBase && chosenBase.latestEnd !== null) {
    const debtDate = chosenBase.latestEnd;
    const baseFact = findFactAt(chosenBase.facts, debtDate);
    let value = baseFact ? baseFact.val : 0;

    if (chosenBase.tag === "LongTermDebtNoncurrent") {
      const currentAtDate = findFactAt(currentPortionData.facts, debtDate);
      if (currentAtDate) value += currentAtDate.val;
    }

    const stbData = findTagData(shortData, "ShortTermBorrowings");
    const cpData = findTagData(shortData, "CommercialPaper");
    const stbAtDate = findFactAt(stbData.facts, debtDate);
    if (stbAtDate) {
      value += stbAtDate.val;
    } else {
      const cpAtDate = findFactAt(cpData.facts, debtDate);
      if (cpAtDate) value += cpAtDate.val;
    }

    return { totalDebt: value, debtDate };
  }

  const chosenShort = pickMostRecentTag(shortData);
  if (chosenShort && chosenShort.latestEnd !== null) {
    const debtDate = chosenShort.latestEnd;
    const fact = findFactAt(chosenShort.facts, debtDate);
    return { totalDebt: fact ? fact.val : 0, debtDate };
  }

  issues.add("Total debt not reported");
  return { totalDebt: null, debtDate: null };
}

interface CashResult {
  cashAndSecurities: number | null;
  cashDate: string | null;
}

function firstPresentAt(tagsData: readonly TagData[], date: string, order: readonly string[]): RawFact | null {
  for (const tagName of order) {
    const data = tagsData.find((d) => d.tag === tagName);
    if (!data) continue;
    const fact = findFactAt(data.facts, date);
    if (fact) return fact;
  }
  return null;
}

// Primary cash tag chosen by recency; cashDate = its latest end. Plus, at
// cashDate exactly, the first present short-term securities tag (in list
// order) and the first present long-term securities tag (in list order) —
// list order here (not recency) because these are components at a fixed
// date, not alternative primaries.
function extractCash(usGaap: Record<string, unknown>, issues: IssueCollector): CashResult {
  const primaryData = buildTagData(usGaap, PRIMARY_CASH_TAGS, isInstantFact, issues);
  const shortData = buildTagData(usGaap, SHORT_TERM_SECURITIES_TAGS, isInstantFact, issues);
  const longData = buildTagData(usGaap, LONG_TERM_SECURITIES_TAGS, isInstantFact, issues);

  const chosenPrimary = pickMostRecentTag(primaryData);
  if (!chosenPrimary || chosenPrimary.latestEnd === null) {
    issues.add("Cash and cash equivalents not reported");
    return { cashAndSecurities: null, cashDate: null };
  }

  const cashDate = chosenPrimary.latestEnd;
  const primaryFact = findFactAt(chosenPrimary.facts, cashDate);
  let value = primaryFact ? primaryFact.val : 0;

  const shortFact = firstPresentAt(shortData, cashDate, SHORT_TERM_SECURITIES_TAGS);
  if (shortFact) value += shortFact.val;

  const longFact = firstPresentAt(longData, cashDate, LONG_TERM_SECURITIES_TAGS);
  if (longFact) value += longFact.val;

  return { cashAndSecurities: value, cashDate };
}

// ---------------------------------------------------------------------------
// Income (durations, TTM).
// ---------------------------------------------------------------------------

interface DurationTagData {
  tag: string;
  facts: DurationFact[];
  latestEnd: string | null;
}

function buildDurationTagData(
  usGaap: Record<string, unknown>,
  tags: readonly string[],
  issues: IssueCollector,
): DurationTagData[] {
  return tags.map((tag) => {
    const extraction = extractTagFacts(usGaap[tag]);
    if (extraction.nonUsdOnly) {
      issues.add(`${tag} reported in non-USD units; ignored.`);
    }
    const facts = extraction.facts.filter(isDurationFact);
    return { tag, facts, latestEnd: latestEndOf(facts) };
  });
}

function dayDiff(a: string, b: string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000;
}

// ±7 days: absorbs weekend/holiday-shifted period-end dates and a derived
// quarter's synthetic boundary (a 9M-YTD `end` used as the next quarter's
// `start`).
function closeTo(a: string, b: string): boolean {
  return Math.abs(dayDiff(a, b)) <= 7;
}

function classifyDuration(fact: DurationFact): "quarter" | "ytd9" | "fy" | null {
  const len = dayDiff(fact.start, fact.end);
  if (len >= 80 && len <= 100) return "quarter";
  if (len >= 250 && len <= 285) return "ytd9";
  if (len >= 350 && len <= 380) return "fy";
  return null;
}

interface Quarter {
  start: string;
  end: string;
  val: number;
  source: "reported" | "derived";
}

// Dedupes by `end` within ±7 days; a reported quarter always beats a derived
// one for the same period. Callers push reported quarters before derived
// ones, so on any other tie (derived vs derived, reported vs reported) the
// first-seen one wins — an arbitrary but deterministic tie-break the spec
// doesn't otherwise constrain.
function dedupeQuarters(quarters: readonly Quarter[]): Quarter[] {
  const result: Quarter[] = [];
  for (const q of quarters) {
    const existingIndex = result.findIndex((r) => closeTo(r.end, q.end));
    if (existingIndex === -1) {
      result.push(q);
      continue;
    }
    const existing = result[existingIndex];
    if (existing && existing.source === "derived" && q.source === "reported") {
      result[existingIndex] = q;
    }
  }
  return result;
}

// See the module-level comment for the rationale of these two checks.
function isAdjacentQuarter(later: Quarter, earlier: Quarter): boolean {
  if (closeTo(earlier.end, later.start)) return true;
  const spacing = dayDiff(earlier.end, later.end);
  return spacing >= 80 && spacing <= 100;
}

// Sorts quarters by `end` descending and walks backward from the most
// recent one, requiring each next (earlier) quarter to be adjacent to the
// last one collected. Stops at the first gap. Returns exactly 4 quarters
// (most-recent-first) or null if 4 consecutive quarters can't be found.
function computeTtmQuarters(quarters: readonly Quarter[]): Quarter[] | null {
  if (quarters.length === 0) return null;
  const sorted = [...quarters].sort((a, b) => (a.end < b.end ? 1 : a.end > b.end ? -1 : 0));
  const first = sorted[0];
  if (!first) return null;

  const chosen: Quarter[] = [first];
  for (let i = 1; i < sorted.length && chosen.length < 4; i++) {
    const candidate = sorted[i];
    const last = chosen[chosen.length - 1];
    if (!candidate || !last) break;
    if (isAdjacentQuarter(last, candidate)) {
      chosen.push(candidate);
    } else {
      break;
    }
  }
  return chosen.length === 4 ? chosen : null;
}

interface IncomeFieldResult {
  value: number | null;
  asOf: string | null;
}

// One tag is chosen for the whole field, by recency (see pickMostRecentTag);
// every period used (quarters, 9M, FY) comes from that single tag — mixing
// tags across periods would risk double counting or unit mismatches between
// a company's old and new tag choices.
function extractIncomeField(
  usGaap: Record<string, unknown>,
  tags: readonly string[],
  fieldLabel: string,
  issues: IssueCollector,
): IncomeFieldResult {
  const tagData = buildDurationTagData(usGaap, tags, issues);
  const chosen = pickMostRecentTag(tagData);
  if (!chosen) {
    issues.add(`${fieldLabel} not reported`);
    return { value: null, asOf: null };
  }

  const reportedQuarters: Quarter[] = [];
  const fyFacts: DurationFact[] = [];
  const ytdFacts: DurationFact[] = [];
  for (const fact of chosen.facts) {
    const kind = classifyDuration(fact);
    if (kind === "quarter") {
      reportedQuarters.push({ start: fact.start, end: fact.end, val: fact.val, source: "reported" });
    } else if (kind === "fy") {
      fyFacts.push(fact);
    } else if (kind === "ytd9") {
      ytdFacts.push(fact);
    }
  }

  // Derive Q4 = FY - 9M for each FY fact that has a matching 9M-YTD fact
  // (same start, ±7 days) and no already-reported quarter covering
  // (9M.end, FY.end].
  const derivedQuarters: Quarter[] = [];
  for (const fy of fyFacts) {
    const matchingYtd = ytdFacts.find((y) => closeTo(y.start, fy.start));
    if (!matchingYtd) continue;
    const alreadyCovered = reportedQuarters.some(
      (q) => closeTo(q.start, matchingYtd.end) && closeTo(q.end, fy.end),
    );
    if (alreadyCovered) continue;
    derivedQuarters.push({
      start: matchingYtd.end,
      end: fy.end,
      // Passed through as-is, including if negative — the screening layer
      // already treats a negative numerator as "not computable", so this
      // module doesn't clamp.
      val: fy.val - matchingYtd.val,
      source: "derived",
    });
  }

  const quarters = dedupeQuarters([...reportedQuarters, ...derivedQuarters]);
  const ttmQuarters = computeTtmQuarters(quarters);

  if (ttmQuarters) {
    const value = ttmQuarters.reduce((sum, q) => sum + q.val, 0);
    const latest = ttmQuarters[0];
    return { value, asOf: latest ? latest.end : null };
  }

  if (fyFacts.length > 0) {
    let latestFy: DurationFact | null = null;
    for (const fy of fyFacts) {
      if (latestFy === null || fy.end > latestFy.end) latestFy = fy;
    }
    if (latestFy) {
      issues.add(`${fieldLabel} TTM approximated from latest full fiscal year (quarterly data unavailable)`);
      return { value: latestFy.val, asOf: latestFy.end };
    }
  }

  issues.add(`${fieldLabel} not reported`);
  return { value: null, asOf: null };
}

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

function ifrsResult(): ExtractedFinancials {
  return {
    totalDebt: null,
    cashAndSecurities: null,
    interestIncomeTtm: null,
    revenueTtm: null,
    asOf: { balanceSheet: null, income: null },
    issues: [IFRS_ISSUE],
  };
}

export function extractFinancials(companyFacts: unknown): ExtractedFinancials {
  const usGaap = getUsGaapFacts(companyFacts);
  if (!usGaap) return ifrsResult();

  const issues = createIssueCollector();
  const debtResult = extractDebt(usGaap, issues);
  const cashResult = extractCash(usGaap, issues);
  const revenueResult = extractIncomeField(usGaap, REVENUE_TAGS, "Revenue", issues);
  const interestResult = extractIncomeField(usGaap, INTEREST_TAGS, "Interest income", issues);

  // us-gaap present but none of our tags matched (e.g. an insurer using
  // industry-specific tags) is NOT an IFRS filer — keep the specific
  // "not reported" issues so the user-facing reasons stay accurate.
  return {
    totalDebt: debtResult.totalDebt,
    cashAndSecurities: cashResult.cashAndSecurities,
    interestIncomeTtm: interestResult.value,
    revenueTtm: revenueResult.value,
    asOf: {
      balanceSheet: laterOf(debtResult.debtDate, cashResult.cashDate),
      income: laterOf(revenueResult.asOf, interestResult.asOf),
    },
    issues: issues.toArray(),
  };
}
