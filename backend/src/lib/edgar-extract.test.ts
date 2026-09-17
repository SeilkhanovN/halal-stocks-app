import { describe, expect, it } from "vitest";
import { extractFinancials } from "./edgar-extract.js";
import { screen } from "./halal-screen.js";
import type { ScreeningInput } from "../types/halal.js";

// Small inline companyfacts-shaped literal builders (no fixture files, no
// network — see the BE-04 scope change in prd.md).

interface FactOptions {
  start?: string;
  form?: string;
  filed?: string;
}

// Builds one EDGAR-shaped fact point. `start` omitted => instant fact.
function fact(val: number, end: string, options: FactOptions = {}): Record<string, unknown> {
  const point: Record<string, unknown> = {
    end,
    val,
    form: options.form ?? "10-K",
    filed: options.filed ?? "2024-01-01",
  };
  if (options.start !== undefined) {
    point["start"] = options.start;
  }
  return point;
}

// Wraps a map of tag -> fact points into a full companyfacts-shaped document
// with every tag reported in USD.
function companyFacts(tags: Record<string, ReadonlyArray<Record<string, unknown>>>): unknown {
  const usGaap: Record<string, unknown> = {};
  for (const [tag, facts] of Object.entries(tags)) {
    usGaap[tag] = { units: { USD: facts } };
  }
  return { facts: { "us-gaap": usGaap } };
}

const IFRS_ISSUE = "Foreign/IFRS filer — financials not screened";

describe("extractFinancials()", () => {
  describe("garbage and IFRS-style input (never throws)", () => {
    it("returns nulls + the IFRS issue for a facts object with only dei/ifrs-full facts (no us-gaap)", () => {
      const input = {
        facts: {
          dei: { EntityRegistrantName: { units: { USD: [] } } },
          "ifrs-full": {
            Revenue: { units: { USD: [fact(1000, "2023-12-31", { start: "2023-01-01" })] } },
          },
        },
      };

      const result = extractFinancials(input);
      expect(result).toEqual({
        totalDebt: null,
        cashAndSecurities: null,
        interestIncomeTtm: null,
        revenueTtm: null,
        asOf: { balanceSheet: null, income: null },
        issues: [IFRS_ISSUE],
      });
    });

    it("does not mislabel a US-GAAP filer with no matching tags as IFRS; keeps specific issues", () => {
      const input = companyFacts({
        GrossPremiumsWritten: [fact(900, "2023-12-31", { start: "2023-01-01" })],
      });
      const result = extractFinancials(input);
      expect(result.issues).not.toContain(IFRS_ISSUE);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          "Total debt not reported",
          "Cash and cash equivalents not reported",
          "Revenue not reported",
          "Interest income not reported",
        ]),
      );
      expect(result.totalDebt).toBeNull();
      expect(result.revenueTtm).toBeNull();
      expect(result.asOf).toEqual({ balanceSheet: null, income: null });
    });

    it("dedupes a restated instant whether or not start is present (later filed wins)", () => {
      const input = companyFacts({
        CashAndCashEquivalentsAtCarryingValue: [
          fact(100, "2023-12-31", { filed: "2024-02-01" }),
          fact(150, "2023-12-31", { start: "2023-12-31", filed: "2024-05-01" }),
        ],
      });
      expect(extractFinancials(input).cashAndSecurities).toBe(150);
    });

    it.each<unknown>([null, [], {}, { facts: 5 }, { facts: { "us-gaap": 5 } }])(
      "never throws and returns nulls + the IFRS issue for garbage input %#",
      (input) => {
        expect(() => extractFinancials(input)).not.toThrow();
        const result = extractFinancials(input);
        expect(result.totalDebt).toBeNull();
        expect(result.cashAndSecurities).toBeNull();
        expect(result.interestIncomeTtm).toBeNull();
        expect(result.revenueTtm).toBeNull();
        expect(result.issues).toEqual([IFRS_ISSUE]);
      },
    );
  });

  it("interestIncomeTtm is null with 'Interest income not reported' when all interest tags are absent; other fields still computed", () => {
    const input = companyFacts({
      LongTermDebtNoncurrent: [fact(500, "2023-12-31")],
      CashAndCashEquivalentsAtCarryingValue: [fact(200, "2023-12-31")],
      Revenues: [
        fact(100, "2023-03-31", { start: "2023-01-01" }),
        fact(110, "2023-06-30", { start: "2023-04-01" }),
        fact(120, "2023-09-30", { start: "2023-07-01" }),
        fact(130, "2023-12-31", { start: "2023-10-01" }),
      ],
    });

    const result = extractFinancials(input);
    expect(result.interestIncomeTtm).toBeNull();
    expect(result.issues).toContain("Interest income not reported");
    expect(result.totalDebt).toBe(500);
    expect(result.cashAndSecurities).toBe(200);
    expect(result.revenueTtm).toBe(460);
  });

  describe("TTM", () => {
    it("derives Q4 from FY - 9M when no discrete Q4 is reported, and TTM equals the FY total", () => {
      // Q1=100 (Jan1-Mar31), Q2=110 (Apr1-Jun30), Q3=120 (Jul1-Sep30).
      // 9M (Jan1-Sep30) = 330 (= Q1+Q2+Q3). FY (Jan1-Dec31) = 460.
      // Derived Q4 = FY - 9M = 460 - 330 = 130.
      // TTM = Q1 + Q2 + Q3 + Q4(derived) = 100+110+120+130 = 460 = FY.
      const input = companyFacts({
        Revenues: [
          fact(100, "2023-03-31", { start: "2023-01-01" }),
          fact(110, "2023-06-30", { start: "2023-04-01" }),
          fact(120, "2023-09-30", { start: "2023-07-01" }),
          fact(330, "2023-09-30", { start: "2023-01-01" }),
          fact(460, "2023-12-31", { start: "2023-01-01" }),
        ],
      });

      const result = extractFinancials(input);
      expect(result.revenueTtm).toBe(460);
      expect(result.asOf.income).toBe("2023-12-31");
    });

    it("uses the latest 4 consecutive quarters (not the stale FY) once a newer quarter is reported", () => {
      // Same as above, plus a new Q1 for the next fiscal year (Jan1-Mar31
      // 2024) = 140. TTM should now be Q2+Q3+Q4(derived)+newQ1
      // = 110+120+130+140 = 500, not FY (460).
      const input = companyFacts({
        Revenues: [
          fact(100, "2023-03-31", { start: "2023-01-01" }),
          fact(110, "2023-06-30", { start: "2023-04-01" }),
          fact(120, "2023-09-30", { start: "2023-07-01" }),
          fact(330, "2023-09-30", { start: "2023-01-01" }),
          fact(460, "2023-12-31", { start: "2023-01-01" }),
          fact(140, "2024-03-31", { start: "2024-01-01" }),
        ],
      });

      const result = extractFinancials(input);
      expect(result.revenueTtm).toBe(500);
      expect(result.asOf.income).toBe("2024-03-31");
    });

    it("falls back to the latest FY value with an approximation issue when no quarterly data exists", () => {
      const input = companyFacts({
        Revenues: [fact(1000, "2023-12-31", { start: "2023-01-01" })],
      });

      const result = extractFinancials(input);
      expect(result.revenueTtm).toBe(1000);
      expect(result.asOf.income).toBe("2023-12-31");
      expect(result.issues).toContain(
        "Revenue TTM approximated from latest full fiscal year (quarterly data unavailable)",
      );
    });
  });

  describe("tag fallback", () => {
    it("falls back to RevenueFromContractWithCustomerExcludingAssessedTax when Revenues is absent", () => {
      const input = companyFacts({
        RevenueFromContractWithCustomerExcludingAssessedTax: [
          fact(100, "2023-03-31", { start: "2023-01-01" }),
          fact(110, "2023-06-30", { start: "2023-04-01" }),
          fact(120, "2023-09-30", { start: "2023-07-01" }),
          fact(130, "2023-12-31", { start: "2023-10-01" }),
        ],
      });

      const result = extractFinancials(input);
      expect(result.revenueTtm).toBe(460);
    });

    it("picks the tag with the most recent data even when it is later in the fallback list", () => {
      // Revenues comes first in REVENUE_TAGS but is stale (2016);
      // RevenueFromContract... comes later in the list but has recent
      // (2025) data. Recency must win over list order.
      const input = companyFacts({
        Revenues: [fact(900, "2016-12-31", { start: "2016-01-01" })],
        RevenueFromContractWithCustomerExcludingAssessedTax: [
          fact(100, "2025-03-31", { start: "2025-01-01" }),
          fact(110, "2025-06-30", { start: "2025-04-01" }),
          fact(120, "2025-09-30", { start: "2025-07-01" }),
          fact(130, "2025-12-31", { start: "2025-10-01" }),
        ],
      });

      const result = extractFinancials(input);
      expect(result.revenueTtm).toBe(460);
      expect(result.asOf.income).toBe("2025-12-31");
    });
  });

  describe("debt", () => {
    it("sums LongTermDebtNoncurrent + LongTermDebtCurrent + CommercialPaper at the same date", () => {
      const input = companyFacts({
        LongTermDebtNoncurrent: [fact(1000, "2023-12-31")],
        LongTermDebtCurrent: [fact(200, "2023-12-31")],
        CommercialPaper: [fact(50, "2023-12-31")],
      });

      const result = extractFinancials(input);
      expect(result.totalDebt).toBe(1250);
      expect(result.asOf.balanceSheet).toBe("2023-12-31");
    });

    it("uses LongTermDebt alone (already includes the current portion), not added to LongTermDebtCurrent", () => {
      const input = companyFacts({
        LongTermDebt: [fact(1200, "2023-12-31")],
        LongTermDebtCurrent: [fact(200, "2023-12-31")],
      });

      const result = extractFinancials(input);
      expect(result.totalDebt).toBe(1200);
    });

    it("uses ShortTermBorrowings only, never CommercialPaper too, when both exist and there's no base tag", () => {
      const input = companyFacts({
        ShortTermBorrowings: [fact(300, "2023-12-31")],
        CommercialPaper: [fact(80, "2023-12-31")],
      });

      const result = extractFinancials(input);
      expect(result.totalDebt).toBe(300);
    });

    it("uses ShortTermBorrowings alone when no other debt tags exist", () => {
      const input = companyFacts({
        ShortTermBorrowings: [fact(300, "2023-12-31")],
      });

      const result = extractFinancials(input);
      expect(result.totalDebt).toBe(300);
    });

    it("returns null with 'Total debt not reported' when no debt tags exist at all", () => {
      const input = companyFacts({
        CashAndCashEquivalentsAtCarryingValue: [fact(500, "2023-12-31")],
      });

      const result = extractFinancials(input);
      expect(result.totalDebt).toBeNull();
      expect(result.issues).toContain("Total debt not reported");
    });

    it("does not mix a debt component from an older date into the chosen debtDate", () => {
      const input = companyFacts({
        LongTermDebtNoncurrent: [fact(900, "2022-12-31"), fact(1000, "2023-12-31")],
        LongTermDebtCurrent: [fact(500, "2022-12-31")], // only at the older date
      });

      const result = extractFinancials(input);
      expect(result.totalDebt).toBe(1000);
      expect(result.asOf.balanceSheet).toBe("2023-12-31");
    });
  });

  describe("cash and securities", () => {
    it("sums cash + ShortTermInvestments + MarketableSecuritiesNoncurrent at the cash date", () => {
      const input = companyFacts({
        CashAndCashEquivalentsAtCarryingValue: [fact(1000, "2023-12-31")],
        ShortTermInvestments: [fact(200, "2023-12-31")],
        MarketableSecuritiesNoncurrent: [fact(300, "2023-12-31")],
      });

      const result = extractFinancials(input);
      expect(result.cashAndSecurities).toBe(1500);
    });

    it("uses only the first present short-term securities tag (ShortTermInvestments over MarketableSecuritiesCurrent)", () => {
      const input = companyFacts({
        CashAndCashEquivalentsAtCarryingValue: [fact(1000, "2023-12-31")],
        ShortTermInvestments: [fact(200, "2023-12-31")],
        MarketableSecuritiesCurrent: [fact(999, "2023-12-31")],
      });

      const result = extractFinancials(input);
      expect(result.cashAndSecurities).toBe(1200);
    });

    it("returns null with 'Cash and cash equivalents not reported' when no primary cash tag exists", () => {
      // A debt tag is included so this isn't the "zero usable facts at all"
      // case (which collapses to the IFRS-filer message instead).
      const input = companyFacts({
        LongTermDebtNoncurrent: [fact(1000, "2023-12-31")],
        ShortTermInvestments: [fact(200, "2023-12-31")],
      });

      const result = extractFinancials(input);
      expect(result.cashAndSecurities).toBeNull();
      expect(result.issues).toContain("Cash and cash equivalents not reported");
    });
  });

  it("restatement: keeps the later-filed value when the same period is reported twice", () => {
    const input = companyFacts({
      CashAndCashEquivalentsAtCarryingValue: [
        fact(1000, "2023-12-31", { filed: "2024-01-15" }),
        fact(1100, "2023-12-31", { filed: "2024-03-01" }),
      ],
    });

    const result = extractFinancials(input);
    expect(result.cashAndSecurities).toBe(1100);
  });

  describe("units and forms", () => {
    it("ignores a tag reported only in non-USD units, with an issue", () => {
      // A cash tag is included so this isn't the "zero usable facts at all"
      // case (which collapses to the IFRS-filer message instead).
      const input = {
        facts: {
          "us-gaap": {
            Revenues: {
              units: {
                EUR: [{ start: "2023-01-01", end: "2023-12-31", val: 500, form: "10-K", filed: "2024-01-01" }],
              },
            },
            CashAndCashEquivalentsAtCarryingValue: {
              units: { USD: [{ end: "2023-12-31", val: 1000, form: "10-K", filed: "2024-01-01" }] },
            },
          },
        },
      };

      const result = extractFinancials(input);
      expect(result.revenueTtm).toBeNull();
      expect(result.issues).toContain("Revenues reported in non-USD units; ignored.");
    });

    it("drops facts with a non-numeric val (string) or NaN, silently", () => {
      const input = {
        facts: {
          "us-gaap": {
            CashAndCashEquivalentsAtCarryingValue: {
              units: {
                USD: [
                  { end: "2023-12-31", val: "12", form: "10-K", filed: "2024-01-01" },
                  { end: "2023-11-30", val: Number.NaN, form: "10-K", filed: "2024-01-01" },
                  { end: "2023-10-31", val: 500, form: "10-K", filed: "2024-01-01" },
                ],
              },
            },
          },
        },
      };

      const result = extractFinancials(input);
      expect(result.cashAndSecurities).toBe(500);
    });

    it("ignores an 8-K fact and uses a 20-F fact", () => {
      const input = companyFacts({
        CashAndCashEquivalentsAtCarryingValue: [
          fact(999, "2023-12-31", { form: "8-K" }),
          fact(500, "2023-09-30", { form: "20-F" }),
        ],
      });

      const result = extractFinancials(input);
      expect(result.cashAndSecurities).toBe(500);
    });
  });

  describe("invariants", () => {
    const sampleInput = companyFacts({
      LongTermDebtNoncurrent: [fact(1000, "2023-12-31")],
      LongTermDebtCurrent: [fact(200, "2023-12-31")],
      CashAndCashEquivalentsAtCarryingValue: [fact(500, "2023-12-31")],
      ShortTermInvestments: [fact(100, "2023-12-31")],
      Revenues: [
        fact(100, "2023-03-31", { start: "2023-01-01" }),
        fact(110, "2023-06-30", { start: "2023-04-01" }),
        fact(120, "2023-09-30", { start: "2023-07-01" }),
        fact(130, "2023-12-31", { start: "2023-10-01" }),
      ],
      InvestmentIncomeInterest: [
        fact(5, "2023-03-31", { start: "2023-01-01" }),
        fact(6, "2023-06-30", { start: "2023-04-01" }),
        fact(7, "2023-09-30", { start: "2023-07-01" }),
        fact(8, "2023-12-31", { start: "2023-10-01" }),
      ],
    });

    it("never produces NaN in any numeric output field", () => {
      const result = extractFinancials(sampleInput);
      for (const value of [
        result.totalDebt,
        result.cashAndSecurities,
        result.interestIncomeTtm,
        result.revenueTtm,
      ]) {
        if (value !== null) {
          expect(Number.isNaN(value)).toBe(false);
        }
      }
    });

    it("is deterministic across repeated calls", () => {
      const first = extractFinancials(sampleInput);
      const second = extractFinancials(sampleInput);
      expect(first).toEqual(second);
    });

    it("does not mutate its input", () => {
      const clone = structuredClone(sampleInput);
      extractFinancials(sampleInput);
      expect(sampleInput).toEqual(clone);
    });
  });

  describe("review follow-up gaps", () => {
    it("derives a 98-day Q4 for a 52/53-week fiscal year (91-day quarters, 273-day 9M, 371-day FY) and TTM equals the FY", () => {
      // Apple-style fiscal calendar: Q1-Q3 are 91 days each, 9M is 273 days,
      // FY is 371 days (a 53-week year) => derived Q4 is 98 days
      // (2023-06-25..2023-10-01), still inside the 80-100 "quarter" bucket.
      const input = companyFacts({
        Revenues: [
          fact(100, "2022-12-25", { start: "2022-09-25" }), // Q1, 91 days
          fact(110, "2023-03-26", { start: "2022-12-25" }), // Q2, 91 days
          fact(120, "2023-06-25", { start: "2023-03-26" }), // Q3, 91 days
          fact(330, "2023-06-25", { start: "2022-09-25" }), // 9M, 273 days
          fact(460, "2023-10-01", { start: "2022-09-25" }), // FY, 371 days
        ],
      });

      const result = extractFinancials(input);
      // Derived Q4 = 460 - 330 = 130 (2023-06-25..2023-10-01, 98 days).
      expect(result.revenueTtm).toBe(460);
      expect(result.asOf.income).toBe("2023-10-01");
    });

    it("derives Q4 for two consecutive fiscal years and TTM equals the second year's total, not a mix of both years", () => {
      const input = companyFacts({
        Revenues: [
          // FY1 (2022): Q1-Q3 + 9M + FY.
          fact(100, "2022-03-31", { start: "2022-01-01" }),
          fact(110, "2022-06-30", { start: "2022-04-01" }),
          fact(120, "2022-09-30", { start: "2022-07-01" }),
          fact(330, "2022-09-30", { start: "2022-01-01" }),
          fact(460, "2022-12-31", { start: "2022-01-01" }),
          // FY2 (2023): Q1-Q3 + 9M + FY.
          fact(140, "2023-03-31", { start: "2023-01-01" }),
          fact(150, "2023-06-30", { start: "2023-04-01" }),
          fact(160, "2023-09-30", { start: "2023-07-01" }),
          fact(450, "2023-09-30", { start: "2023-01-01" }),
          fact(620, "2023-12-31", { start: "2023-01-01" }),
        ],
      });

      const result = extractFinancials(input);
      // Derived Q4(2022) = 460-330 = 130; Derived Q4(2023) = 620-450 = 170.
      // TTM = Q1(23)+Q2(23)+Q3(23)+Q4(23) = 140+150+160+170 = 620 = FY2.
      expect(result.revenueTtm).toBe(620);
      expect(result.asOf.income).toBe("2023-12-31");
    });

    it("prefers a reported Q4 over the FY-minus-9M derivation for the same year, without double counting", () => {
      const input = companyFacts({
        Revenues: [
          fact(100, "2023-03-31", { start: "2023-01-01" }), // Q1
          fact(110, "2023-06-30", { start: "2023-04-01" }), // Q2
          fact(120, "2023-09-30", { start: "2023-07-01" }), // Q3
          fact(135, "2023-12-31", { start: "2023-10-01" }), // reported Q4
          fact(330, "2023-09-30", { start: "2023-01-01" }), // 9M
          fact(460, "2023-12-31", { start: "2023-01-01" }), // FY (would derive Q4=130)
        ],
      });

      const result = extractFinancials(input);
      // The reported Q4 (135) wins over the derived one (130); no extra
      // quarter is added on top, so the sum is over exactly 4 quarters.
      expect(result.revenueTtm).toBe(100 + 110 + 120 + 135);
      expect(result.asOf.income).toBe("2023-12-31");
    });

    it("a gap in the quarterly series (missing Q2, no 9M to derive from) falls back to the FY value with the approximation issue, or to null + 'not reported' when there's no FY either", () => {
      const withFy = companyFacts({
        Revenues: [
          fact(100, "2023-03-31", { start: "2023-01-01" }), // Q1
          fact(120, "2023-09-30", { start: "2023-07-01" }), // Q3 (Q2 missing)
          fact(130, "2023-12-31", { start: "2023-10-01" }), // Q4
          fact(500, "2023-12-31", { start: "2023-01-01" }), // FY
        ],
      });
      const withFyResult = extractFinancials(withFy);
      // Only 3 non-adjacent quarters are usable (no 9M to bridge the Q2
      // gap), so computeTtmQuarters can't find 4 consecutive quarters and
      // the module falls back to the latest FY value.
      expect(withFyResult.revenueTtm).toBe(500);
      expect(withFyResult.asOf.income).toBe("2023-12-31");
      expect(withFyResult.issues).toContain(
        "Revenue TTM approximated from latest full fiscal year (quarterly data unavailable)",
      );

      const withoutFy = companyFacts({
        Revenues: [
          fact(100, "2023-03-31", { start: "2023-01-01" }), // Q1
          fact(120, "2023-09-30", { start: "2023-07-01" }), // Q3 (Q2 missing, no FY)
        ],
      });
      const withoutFyResult = extractFinancials(withoutFy);
      expect(withoutFyResult.revenueTtm).toBeNull();
      expect(withoutFyResult.issues).toContain("Revenue not reported");
    });

    it("asOf.balanceSheet and asOf.income are each the later of their two component dates, not always the same component", () => {
      const input = companyFacts({
        // Balance sheet: debt is older, cash is newer -> balanceSheet should
        // follow cash, proving it's not hardcoded to the debt date.
        LongTermDebtNoncurrent: [fact(500, "2023-09-30")],
        CashAndCashEquivalentsAtCarryingValue: [fact(200, "2023-12-31")],
        // Income: revenue's only data point is an FY-length fact ending
        // earlier than interest income's -> income should follow interest.
        Revenues: [fact(1000, "2023-09-30", { start: "2022-10-01" })], // 364 days, "fy"
        InvestmentIncomeInterest: [fact(50, "2023-12-31", { start: "2023-01-01" })], // 365 days, "fy"
      });

      const result = extractFinancials(input);
      expect(result.asOf).toEqual({ balanceSheet: "2023-12-31", income: "2023-12-31" });
    });

    it("feeds cleanly into screen(): a clean company screens halal, and dropping interest tags flips it to unknown with an interest-income reason", () => {
      const revenueAndDebtTags = {
        LongTermDebtNoncurrent: [fact(100, "2023-12-31")],
        CashAndCashEquivalentsAtCarryingValue: [fact(50, "2023-12-31")],
        Revenues: [
          fact(250, "2023-03-31", { start: "2023-01-01" }),
          fact(250, "2023-06-30", { start: "2023-04-01" }),
          fact(250, "2023-09-30", { start: "2023-07-01" }),
          fact(250, "2023-12-31", { start: "2023-10-01" }),
        ],
      };

      const halalInput = companyFacts({
        ...revenueAndDebtTags,
        InvestmentIncomeInterest: [
          fact(3, "2023-03-31", { start: "2023-01-01" }),
          fact(2, "2023-06-30", { start: "2023-04-01" }),
          fact(3, "2023-09-30", { start: "2023-07-01" }),
          fact(2, "2023-12-31", { start: "2023-10-01" }),
        ],
      });
      const halalExtracted = extractFinancials(halalInput);
      expect(halalExtracted.issues).toEqual([]);

      const halalScreeningInput: ScreeningInput = {
        ticker: "HALALCO",
        industry: "Technology Hardware",
        marketCap: 1000,
        totalDebt: halalExtracted.totalDebt,
        cashAndSecurities: halalExtracted.cashAndSecurities,
        interestIncomeTtm: halalExtracted.interestIncomeTtm,
        revenueTtm: halalExtracted.revenueTtm,
        dataIssues: halalExtracted.issues,
      };
      expect(screen(halalScreeningInput).status).toBe("halal");

      // Same company, but no interest-income tags at all.
      const noInterestInput = companyFacts(revenueAndDebtTags);
      const noInterestExtracted = extractFinancials(noInterestInput);
      expect(noInterestExtracted.interestIncomeTtm).toBeNull();

      const unknownScreeningInput: ScreeningInput = {
        ...halalScreeningInput,
        interestIncomeTtm: noInterestExtracted.interestIncomeTtm,
        dataIssues: noInterestExtracted.issues,
      };
      const unknownResult = screen(unknownScreeningInput);
      expect(unknownResult.status).toBe("unknown");
      expect(unknownResult.reasons.some((reason) => reason.includes("Interest income"))).toBe(true);
    });
  });
});
