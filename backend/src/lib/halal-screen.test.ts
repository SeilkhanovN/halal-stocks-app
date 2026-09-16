import { describe, expect, it } from "vitest";
import { screen, RATIO_KEYS } from "./halal-screen.js";
import { DEFAULT_SCREENING_CONFIG } from "../config/screening.js";
import { SCREENING_CASES } from "./__fixtures__/screening-cases.js";
import type { RatioKey, ScreeningConfig, ScreeningInput } from "../types/halal.js";

describe("screen()", () => {
  for (const testCase of SCREENING_CASES) {
    it(`${testCase.name}`, () => {
      const result = screen(testCase.input);

      expect(result.status).toBe(testCase.expected.status);
      const [expectedDebt, expectedCash, expectedInterest] = testCase.expected.ratioValues;
      const expectedByKey: Record<RatioKey, number | null> = {
        debtToMarketCap: expectedDebt,
        cashAndSecuritiesToMarketCap: expectedCash,
        interestIncomeToRevenue: expectedInterest,
      };
      for (const ratio of result.ratios) {
        const expectedValue = expectedByKey[ratio.key];
        if (expectedValue === null) {
          expect(ratio.value).toBeNull();
        } else {
          expect(ratio.value).toBeCloseTo(expectedValue, 9);
        }
      }

      if (testCase.expected.reasons) {
        expect(result.reasons).toEqual(testCase.expected.reasons);
      }
    });
  }

  it("case (i) with a config override (0.33 threshold) flips the exactly-30%-debt case to halal, and the default config is untouched", () => {
    const exact30Case = SCREENING_CASES.find((c) => c.name.startsWith("Debt ratio exactly at threshold"));
    expect(exact30Case).toBeDefined();

    const overriddenConfig: ScreeningConfig = {
      ...DEFAULT_SCREENING_CONFIG,
      thresholds: { ...DEFAULT_SCREENING_CONFIG.thresholds, debtToMarketCap: 0.33 },
    };

    const overriddenResult = screen(exact30Case!.input, overriddenConfig);
    expect(overriddenResult.status).toBe("halal");
    expect(overriddenResult.ratios[0]?.breached).toBe(false);

    // The default export itself must remain 0.30, proving the override
    // didn't mutate shared state.
    expect(DEFAULT_SCREENING_CONFIG.thresholds.debtToMarketCap).toBe(0.3);
    const defaultResult = screen(exact30Case!.input);
    expect(defaultResult.status).toBe("not_halal");
  });

  describe("invariants across all known-answer cases", () => {
    for (const testCase of SCREENING_CASES) {
      it(`${testCase.name}: invariants hold`, () => {
        const inputClone = structuredClone(testCase.input);
        const result = screen(testCase.input);

        // Exactly three ratios, in RatioKey order.
        expect(result.ratios).toHaveLength(3);
        expect(result.ratios.map((r) => r.key)).toEqual(RATIO_KEYS);

        // value null <=> breached null.
        for (const ratio of result.ratios) {
          if (ratio.value === null) {
            expect(ratio.breached).toBeNull();
          } else {
            expect(ratio.breached).not.toBeNull();
          }
        }

        // No NaN/Infinity anywhere in the numeric output. JSON.stringify
        // turns NaN/Infinity into null, which would hide a bug, so check
        // the actual numbers directly instead of round-tripping through JSON.
        for (const ratio of result.ratios) {
          if (ratio.value !== null) {
            expect(Number.isFinite(ratio.value)).toBe(true);
          }
          expect(Number.isFinite(ratio.threshold)).toBe(true);
        }

        // Non-halal results carry at least one non-empty reason.
        if (result.status !== "halal") {
          expect(result.reasons.length).toBeGreaterThan(0);
          for (const reason of result.reasons) {
            expect(reason.length).toBeGreaterThan(0);
          }
        }

        expect(typeof result.status).toBe("string");

        // screen() must not mutate its input.
        expect(testCase.input).toEqual(inputClone);
      });
    }
  });

  it("formats a ratio value to 1 decimal place (0.123 -> 12.3%) and the threshold without a trailing .0 (30%)", () => {
    const result = screen({
      ticker: "FMT",
      industry: "Technology",
      marketCap: 1000,
      totalDebt: 123,
      cashAndSecurities: 100,
      interestIncomeTtm: 1,
      revenueTtm: 100,
      dataIssues: [],
    });

    const debtRatio = result.ratios[0];
    expect(debtRatio?.value).toBeCloseTo(0.123, 9);
    expect(debtRatio?.explanation).toContain("12.3%");
    expect(debtRatio?.explanation).toContain("30%");
    expect(debtRatio?.explanation).not.toContain("30.0%");
  });

  it("a halal explanation mentions the percent value and the limit", () => {
    const result = screen({
      ticker: "AAPL",
      industry: "Technology",
      marketCap: 1000,
      totalDebt: 100,
      cashAndSecurities: 150,
      interestIncomeTtm: 1,
      revenueTtm: 100,
      dataIssues: [],
    });

    expect(result.status).toBe("halal");
    const debtRatio = result.ratios[0];
    expect(debtRatio?.explanation).toContain("10.0%");
    expect(debtRatio?.explanation).toContain("30%");
  });

  it("a lowercase, hyphenated ticker ('bf-b') hits the ticker denylist (normalized to BF.B)", () => {
    const result = screen({
      ticker: "bf-b",
      industry: "Beverages",
      marketCap: 1000,
      totalDebt: 100,
      cashAndSecurities: 150,
      interestIncomeTtm: 1,
      revenueTtm: 100,
      dataIssues: [],
    });

    expect(result.status).toBe("not_halal");
    expect(result.businessActivity.prohibited).toBe(true);
    expect(result.businessActivity.explanation).toContain("BF.B");
    // Business-activity reasons are never label-prefixed (only ratio-derived
    // reasons are).
    expect(result.reasons).toEqual(["'BF.B' is on the prohibited-business ticker list."]);
  });

  it("an industry with surrounding whitespace and different case (' banking ') is still prohibited", () => {
    const result = screen({
      ticker: "WSPACE",
      industry: " banking ",
      marketCap: 1000,
      totalDebt: 100,
      cashAndSecurities: 150,
      interestIncomeTtm: 1,
      revenueTtm: 100,
      dataIssues: [],
    });

    expect(result.status).toBe("not_halal");
    expect(result.businessActivity.prohibited).toBe(true);
    expect(result.businessActivity.industry).toBe("banking");
    expect(result.businessActivity.explanation).toBe(
      "Industry 'banking' is not permissible under AAOIFI screening.",
    );
  });

  it("negative debt is treated as missing, not as a valid ratio", () => {
    const result = screen({
      ticker: "NEGDEBT",
      industry: "Technology",
      marketCap: 1000,
      totalDebt: -50,
      cashAndSecurities: 150,
      interestIncomeTtm: 1,
      revenueTtm: 100,
      dataIssues: [],
    });

    const debtRatio = result.ratios[0];
    expect(debtRatio?.value).toBeNull();
    expect(debtRatio?.breached).toBeNull();
    expect(debtRatio?.explanation).toBe("Not available: total debt is negative.");
  });

  describe("status resolution order regression guards", () => {
    // These re-assert (by name) fixtures that already run through the main
    // loop above; the point here is to make the ordering guarantee explicit
    // and named, so a future reader doesn't have to infer it from the
    // fixture comments alone.
    it("case (h): a debt breach outranks a missing ratio (step 2 before step 3) -> not_halal, not unknown", () => {
      const caseH = SCREENING_CASES.find((c) => c.name.startsWith("Debt breach + missing interest income"));
      expect(caseH).toBeDefined();
      const result = screen(caseH!.input);
      expect(result.status).toBe("not_halal");
    });

    it("case (l): a debt breach outranks a missing industry (step 2 before step 3) -> not_halal, not unknown", () => {
      const caseL = SCREENING_CASES.find((c) => c.name.startsWith("Debt breach, industry null"));
      expect(caseL).toBeDefined();
      const result = screen(caseL!.input);
      expect(result.status).toBe("not_halal");
      expect(result.businessActivity.prohibited).toBeNull();
    });

    it("case (k): a prohibited industry outranks a data issue (step 1 before step 3) -> not_halal, not unknown, and no 'Data issue:' reason", () => {
      const caseK = SCREENING_CASES.find((c) => c.name.startsWith("Banking industry with a data issue"));
      expect(caseK).toBeDefined();
      const result = screen(caseK!.input);
      expect(result.status).toBe("not_halal");
      expect(result.reasons.some((r) => r.startsWith("Data issue:"))).toBe(false);
    });
  });

  describe("never falsely halal: bad ratio inputs", () => {
    // A minimal input where every ratio passes and the industry is
    // permissible, so the *only* thing under test is whether corrupting one
    // numeric field ever still lets status fall through to "halal".
    const allPassingInput: ScreeningInput = {
      ticker: "SAFE",
      industry: "Technology",
      marketCap: 1000,
      totalDebt: 100,
      cashAndSecurities: 150,
      interestIncomeTtm: 1,
      revenueTtm: 100,
      dataIssues: [],
    };

    const COMMON_BAD_VALUES: Array<number | null> = [null, NaN, Infinity, -Infinity, -1];

    // Every numeric field in ScreeningInput, flagged with whether it acts as
    // a ratio denominator anywhere (so we also cover 0, which is only
    // meaningful for denominators -- a numerator of 0 is a perfectly valid,
    // passing value).
    const NUMERIC_FIELDS: Array<{ field: keyof ScreeningInput; isDenominator: boolean }> = [
      { field: "totalDebt", isDenominator: false },
      { field: "cashAndSecurities", isDenominator: false },
      { field: "marketCap", isDenominator: true },
      { field: "interestIncomeTtm", isDenominator: false },
      { field: "revenueTtm", isDenominator: true },
    ];

    const badValueCases: Array<[keyof ScreeningInput, number | null]> = [];
    for (const { field, isDenominator } of NUMERIC_FIELDS) {
      for (const badValue of COMMON_BAD_VALUES) {
        badValueCases.push([field, badValue]);
      }
      if (isDenominator) {
        badValueCases.push([field, 0]);
      }
    }

    it.each(badValueCases)("%s = %p never yields status 'halal'", (field, badValue) => {
      const input: ScreeningInput = { ...allPassingInput, [field]: badValue };
      const result = screen(input);
      expect(result.status).not.toBe("halal");
    });
  });

  describe("boundary tests per ratio", () => {
    interface RatioBoundaryFixture {
      ratioKey: RatioKey;
      ratioIndex: 0 | 1 | 2;
      numeratorField: "totalDebt" | "cashAndSecurities" | "interestIncomeTtm";
      denominatorField: "marketCap" | "revenueTtm";
      threshold: number;
    }

    const RATIO_FIXTURES: RatioBoundaryFixture[] = [
      {
        ratioKey: "debtToMarketCap",
        ratioIndex: 0,
        numeratorField: "totalDebt",
        denominatorField: "marketCap",
        threshold: 0.3,
      },
      {
        ratioKey: "cashAndSecuritiesToMarketCap",
        ratioIndex: 1,
        numeratorField: "cashAndSecurities",
        denominatorField: "marketCap",
        threshold: 0.3,
      },
      {
        ratioKey: "interestIncomeToRevenue",
        ratioIndex: 2,
        numeratorField: "interestIncomeTtm",
        denominatorField: "revenueTtm",
        threshold: 0.05,
      },
    ];

    // All-passing baseline shared by every boundary case below; only the
    // ratio under test's own numerator/denominator is overridden.
    const baseInput: ScreeningInput = {
      ticker: "BOUND",
      industry: "Technology",
      marketCap: 1000,
      totalDebt: 100,
      cashAndSecurities: 150,
      interestIncomeTtm: 1,
      revenueTtm: 100,
      dataIssues: [],
    };

    for (const fixture of RATIO_FIXTURES) {
      describe(fixture.ratioKey, () => {
        const denominator = 1000;
        const belowThreshold = fixture.threshold * denominator - 0.1; // e.g. 299.9
        const atThreshold = fixture.threshold * denominator; // e.g. 300
        const aboveThreshold = fixture.threshold * denominator + 0.1; // e.g. 300.1

        it(`just below ${fixture.threshold} -> pass`, () => {
          const input = {
            ...baseInput,
            [fixture.numeratorField]: belowThreshold,
            [fixture.denominatorField]: denominator,
          };
          const result = screen(input);
          expect(result.ratios[fixture.ratioIndex]?.breached).toBe(false);
        });

        it(`exactly ${fixture.threshold} -> breach (strict boundary)`, () => {
          const input = {
            ...baseInput,
            [fixture.numeratorField]: atThreshold,
            [fixture.denominatorField]: denominator,
          };
          const result = screen(input);
          expect(result.ratios[fixture.ratioIndex]?.breached).toBe(true);
        });

        it(`just above ${fixture.threshold} -> breach`, () => {
          const input = {
            ...baseInput,
            [fixture.numeratorField]: aboveThreshold,
            [fixture.denominatorField]: denominator,
          };
          const result = screen(input);
          expect(result.ratios[fixture.ratioIndex]?.breached).toBe(true);
        });

        it("float noise just below the threshold (0.3 - Number.EPSILON) still counts as a breach", () => {
          // 0.3 - Number.EPSILON = 0.29999999999999977, a double strictly
          // less than the threshold but within the 1e-9 slack, so it must
          // still breach (not be misread as "just under").
          const noisyValue = fixture.threshold - Number.EPSILON;
          const input = {
            ...baseInput,
            [fixture.numeratorField]: noisyValue,
            [fixture.denominatorField]: 1,
          };
          const result = screen(input);
          expect(result.ratios[fixture.ratioIndex]?.value).toBeLessThan(fixture.threshold);
          expect(result.ratios[fixture.ratioIndex]?.breached).toBe(true);
        });

        it("float noise just above the threshold (0.1 + 0.2 style) counts as a breach", () => {
          // 0.30000000000000004 is the classic 0.1 + 0.2 float artifact;
          // scaled to this ratio's own threshold via addition of the same
          // relative noise.
          const noisyValue = fixture.threshold + (0.1 + 0.2 - 0.3);
          const input = {
            ...baseInput,
            [fixture.numeratorField]: noisyValue,
            [fixture.denominatorField]: 1,
          };
          const result = screen(input);
          expect(result.ratios[fixture.ratioIndex]?.value).toBeGreaterThan(fixture.threshold);
          expect(result.ratios[fixture.ratioIndex]?.breached).toBe(true);
        });
      });
    }
  });

  describe("a denominator shared by two ratios", () => {
    it("marketCap null makes both market-cap ratios null, each citing 'market cap is missing'", () => {
      const result = screen({
        ticker: "SHAREDNULL",
        industry: "Technology",
        marketCap: null,
        totalDebt: 100,
        cashAndSecurities: 150,
        interestIncomeTtm: 1,
        revenueTtm: 100,
        dataIssues: [],
      });

      const debtRatio = result.ratios[0];
      const cashRatio = result.ratios[1];
      expect(debtRatio?.value).toBeNull();
      expect(debtRatio?.explanation).toBe("Not available: market cap is missing.");
      expect(cashRatio?.value).toBeNull();
      expect(cashRatio?.explanation).toBe("Not available: market cap is missing.");
    });
  });

  describe("config overrides", () => {
    it("adding 'Technology' to prohibitedIndustries makes an AAPL-like case not_halal", () => {
      const aapl = SCREENING_CASES.find((c) => c.name.startsWith("AAPL-like"));
      expect(aapl).toBeDefined();

      const overriddenConfig: ScreeningConfig = {
        ...DEFAULT_SCREENING_CONFIG,
        prohibitedIndustries: [...DEFAULT_SCREENING_CONFIG.prohibitedIndustries, "Technology"],
      };

      const result = screen(aapl!.input, overriddenConfig);
      expect(result.status).toBe("not_halal");
      expect(result.businessActivity.prohibited).toBe(true);

      // Default config is untouched.
      expect(DEFAULT_SCREENING_CONFIG.prohibitedIndustries).not.toContain("Technology");
    });

    it("a threshold of 0 means any positive value breaches", () => {
      const overriddenConfig: ScreeningConfig = {
        ...DEFAULT_SCREENING_CONFIG,
        thresholds: { ...DEFAULT_SCREENING_CONFIG.thresholds, debtToMarketCap: 0 },
      };
      const result = screen(
        {
          ticker: "ZEROTHRESH",
          industry: "Technology",
          marketCap: 1000,
          totalDebt: 1,
          cashAndSecurities: 150,
          interestIncomeTtm: 1,
          revenueTtm: 100,
          dataIssues: [],
        },
        overriddenConfig,
      );
      expect(result.ratios[0]?.breached).toBe(true);
    });

    it("a threshold of 0 with a value of exactly 0 also breaches (0 >= 0 - 1e-9, per the documented strict-boundary rule)", () => {
      const overriddenConfig: ScreeningConfig = {
        ...DEFAULT_SCREENING_CONFIG,
        thresholds: { ...DEFAULT_SCREENING_CONFIG.thresholds, debtToMarketCap: 0 },
      };
      const result = screen(
        {
          ticker: "ZEROTHRESHZEROVAL",
          industry: "Technology",
          marketCap: 1000,
          totalDebt: 0,
          cashAndSecurities: 150,
          interestIncomeTtm: 1,
          revenueTtm: 100,
          dataIssues: [],
        },
        overriddenConfig,
      );
      // Documented behavior, not necessarily "intuitive": a 0% debt ratio
      // against a 0% threshold still counts as "at or above" the limit.
      expect(result.ratios[0]?.value).toBe(0);
      expect(result.ratios[0]?.breached).toBe(true);
      expect(result.status).toBe("not_halal");
    });

    it("mutating DEFAULT_SCREENING_CONFIG throws a TypeError (frozen)", () => {
      expect(() => {
        // No @ts-expect-error needed here: thresholds is typed as a plain
        // Record, not readonly, so this assignment type-checks fine. The
        // immutability is enforced at runtime via Object.freeze, not by the
        // type system -- which is exactly what this test is proving.
        DEFAULT_SCREENING_CONFIG.thresholds.debtToMarketCap = 0.5;
      }).toThrow(TypeError);

      expect(() => {
        // @ts-expect-error -- same rationale: readonly string[] permits
        // reads only at the type level; freeze enforces it at runtime.
        DEFAULT_SCREENING_CONFIG.prohibitedIndustries.push("Technology");
      }).toThrow(TypeError);
    });
  });

  describe("output shape", () => {
    for (const testCase of SCREENING_CASES) {
      it(`${testCase.name}: methodology, screenedAt, trimmed industry, and non-empty text`, () => {
        const result = screen(testCase.input);

        expect(result.methodology).toBe("AAOIFI");
        expect(result.screenedAt).toBeNull();

        if (result.businessActivity.industry !== null) {
          expect(result.businessActivity.industry).toBe(result.businessActivity.industry.trim());
        }

        for (const reason of result.reasons) {
          expect(reason.length).toBeGreaterThan(0);
        }

        for (const ratio of result.ratios) {
          expect(ratio.explanation.length).toBeGreaterThan(0);
        }
      });
    }
  });

  describe("formatting", () => {
    it("a value over 100% formats as e.g. '150.0%'", () => {
      const result = screen({
        ticker: "OVER100",
        industry: "Technology",
        marketCap: 1000,
        totalDebt: 1500,
        cashAndSecurities: 150,
        interestIncomeTtm: 1,
        revenueTtm: 100,
        dataIssues: [],
      });
      const debtRatio = result.ratios[0];
      expect(debtRatio?.value).toBeCloseTo(1.5, 9);
      expect(debtRatio?.explanation).toContain("150.0%");
    });

    it("a threshold override of 0.325 formats as '32.5%' (no trailing-zero trim past 1 decimal)", () => {
      const overriddenConfig: ScreeningConfig = {
        ...DEFAULT_SCREENING_CONFIG,
        thresholds: { ...DEFAULT_SCREENING_CONFIG.thresholds, debtToMarketCap: 0.325 },
      };
      const result = screen(
        {
          ticker: "THRESH325",
          industry: "Technology",
          marketCap: 1000,
          totalDebt: 100,
          cashAndSecurities: 150,
          interestIncomeTtm: 1,
          revenueTtm: 100,
          dataIssues: [],
        },
        overriddenConfig,
      );
      expect(result.ratios[0]?.explanation).toContain("32.5%");
    });

    it("a value of exactly 0 formats as '0.0% is below the 30% limit.'", () => {
      const result = screen({
        ticker: "ZEROVAL",
        industry: "Technology",
        marketCap: 1000,
        totalDebt: 0,
        cashAndSecurities: 150,
        interestIncomeTtm: 1,
        revenueTtm: 100,
        dataIssues: [],
      });
      expect(result.ratios[0]?.explanation).toBe("0.0% is below the 30% limit.");
    });
  });

  describe("determinism", () => {
    it("calling screen() twice on the same input gives deep-equal results", () => {
      const input: ScreeningInput = {
        ticker: "DETERM",
        industry: "Technology",
        marketCap: 1000,
        totalDebt: 100,
        cashAndSecurities: 150,
        interestIncomeTtm: 1,
        revenueTtm: 100,
        dataIssues: [],
      };
      const first = screen(input);
      const second = screen(input);
      expect(first).toEqual(second);
    });
  });

  describe("Fix 1: reasons are labeled per ratio", () => {
    it("case (g): marketCap 0 -> the two 'Not available' reasons are distinct and labeled", () => {
      const caseG = SCREENING_CASES.find((c) => c.name.startsWith("Market cap zero"));
      expect(caseG).toBeDefined();
      const result = screen(caseG!.input);

      expect(result.reasons).toEqual([
        "Debt / market cap: Not available: market cap is zero or negative.",
        "Cash and securities / market cap: Not available: market cap is zero or negative.",
      ]);
      // The two lines must actually be distinct strings (not just distinct
      // in intent) -- this is the whole point of Fix 1.
      expect(result.reasons[0]).not.toBe(result.reasons[1]);
    });

    it("halal case (a): every reason is prefixed by its own ratio's label", () => {
      const caseA = SCREENING_CASES.find((c) => c.name.startsWith("AAPL-like"));
      expect(caseA).toBeDefined();
      const result = screen(caseA!.input);

      expect(result.status).toBe("halal");
      expect(result.reasons).toHaveLength(3);
      for (const ratio of result.ratios) {
        expect(result.reasons).toContain(`${ratio.label}: ${ratio.explanation}`);
      }
    });

    it("RatioResult.explanation itself carries no label prefix", () => {
      const result = screen({
        ticker: "NOLABEL",
        industry: "Technology",
        marketCap: 1000,
        totalDebt: 100,
        cashAndSecurities: 150,
        interestIncomeTtm: 1,
        revenueTtm: 100,
        dataIssues: [],
      });

      for (const ratio of result.ratios) {
        expect(ratio.explanation.startsWith(`${ratio.label}:`)).toBe(false);
      }
    });
  });

  describe("Fix 2: escalated decimal precision near a threshold", () => {
    it("0.0499 interest income ratio (vs 5% threshold) -> '4.99% is below the 5% limit.', status halal", () => {
      const result = screen({
        ticker: "NEARINT",
        industry: "Technology",
        marketCap: 1000,
        totalDebt: 100,
        cashAndSecurities: 150,
        interestIncomeTtm: 499,
        revenueTtm: 10000, // 499 / 10000 = 0.0499
        dataIssues: [],
      });

      expect(result.ratios[2]?.value).toBeCloseTo(0.0499, 9);
      expect(result.ratios[2]?.explanation).toBe("4.99% is below the 5% limit.");
      expect(result.status).toBe("halal");
    });

    it("0.05 exactly (at the 5% threshold) -> '5.0% meets or exceeds the 5% limit.' (stays at 1 decimal)", () => {
      const result = screen({
        ticker: "ATINT",
        industry: "Technology",
        marketCap: 1000,
        totalDebt: 100,
        cashAndSecurities: 150,
        interestIncomeTtm: 500,
        revenueTtm: 10000, // 500 / 10000 = 0.05
        dataIssues: [],
      });

      expect(result.ratios[2]?.value).toBeCloseTo(0.05, 9);
      expect(result.ratios[2]?.explanation).toBe("5.0% meets or exceeds the 5% limit.");
    });

    it("0.29996 debt ratio (vs 30% threshold) -> displayed value doesn't read as exactly '30.0%', and says 'below'", () => {
      const result = screen({
        ticker: "NEARDEBT",
        industry: "Technology",
        marketCap: 100000,
        totalDebt: 29996,
        cashAndSecurities: 150,
        interestIncomeTtm: 1,
        revenueTtm: 100,
        dataIssues: [],
      });

      const debtRatio = result.ratios[0];
      expect(debtRatio?.value).toBeCloseTo(0.29996, 9);
      expect(debtRatio?.explanation).not.toContain("30.0%");
      expect(debtRatio?.explanation).toContain("is below");
    });

    it("a just-above breach (0.30004 vs 30% threshold) -> documented behavior: escalated precision, 'meets or exceeds'", () => {
      const result = screen({
        ticker: "OVERDEBT",
        industry: "Technology",
        marketCap: 100000,
        totalDebt: 30004,
        cashAndSecurities: 150,
        interestIncomeTtm: 1,
        revenueTtm: 100,
        dataIssues: [],
      });

      const debtRatio = result.ratios[0];
      expect(debtRatio?.value).toBeCloseTo(0.30004, 9);
      // Documented rule (see formatRatioValuePercent in halal-screen.ts):
      // decimals escalate until the value's string differs from the
      // threshold's string at that precision, so this resolves to "30.004%"
      // rather than staying at the ambiguous "30.0%"/"30.00%".
      expect(debtRatio?.explanation).toBe("30.004% meets or exceeds the 30% limit.");
      expect(debtRatio?.breached).toBe(true);
    });

    it("property: for many values within 0.0002 of a threshold, the displayed percent never reads as contradicting 'below'/'meets or exceeds'", () => {
      const parsePercent = (explanation: string): number => {
        const match = /^([\d.]+)%/.exec(explanation);
        expect(match).not.toBeNull();
        return Number(match![1]);
      };

      const thresholds: Array<{
        threshold: number;
        thresholdPct: number;
        numeratorField: "totalDebt" | "interestIncomeTtm";
        denominatorField: "marketCap" | "revenueTtm";
        ratioIndex: 0 | 2;
      }> = [
        {
          threshold: DEFAULT_SCREENING_CONFIG.thresholds.debtToMarketCap,
          thresholdPct: DEFAULT_SCREENING_CONFIG.thresholds.debtToMarketCap * 100,
          numeratorField: "totalDebt",
          denominatorField: "marketCap",
          ratioIndex: 0,
        },
        {
          threshold: DEFAULT_SCREENING_CONFIG.thresholds.interestIncomeToRevenue,
          thresholdPct: DEFAULT_SCREENING_CONFIG.thresholds.interestIncomeToRevenue * 100,
          numeratorField: "interestIncomeTtm",
          denominatorField: "revenueTtm",
          ratioIndex: 2,
        },
      ];

      const baseInput: ScreeningInput = {
        ticker: "PROPTEST",
        industry: "Technology",
        marketCap: 1,
        totalDebt: 0.001,
        cashAndSecurities: 0.001,
        interestIncomeTtm: 0.001,
        revenueTtm: 1,
        dataIssues: [],
      };

      for (const { threshold, thresholdPct, numeratorField, denominatorField, ratioIndex } of thresholds) {
        for (let k = 1; k <= 20; k++) {
          const below = threshold - k * 0.00001;
          const above = threshold + k * 0.00001;

          const belowResult = screen({
            ...baseInput,
            [numeratorField]: below,
            [denominatorField]: 1,
          });
          const belowRatio = belowResult.ratios[ratioIndex];
          expect(belowRatio?.breached).toBe(false);
          expect(belowRatio?.explanation).toContain("is below");
          expect(parsePercent(belowRatio!.explanation)).toBeLessThan(thresholdPct);

          const aboveResult = screen({
            ...baseInput,
            [numeratorField]: above,
            [denominatorField]: 1,
          });
          const aboveRatio = aboveResult.ratios[ratioIndex];
          expect(aboveRatio?.breached).toBe(true);
          expect(aboveRatio?.explanation).toContain("meets or exceeds");
          expect(parsePercent(aboveRatio!.explanation)).toBeGreaterThanOrEqual(thresholdPct);
        }
      }
    });
  });
});

// Regression: values just outside a 1e-9 band used to render
// "30.0000% is below the 30% limit." and screen as halal. With the 1e-6
// "at the limit" tolerance, anything within 0.0001 percentage points is a
// breach, and every "below" line displays a number strictly under the limit.
describe("sub-0.0001% boundary band", () => {
  const base: ScreeningInput = {
    ticker: "X",
    industry: "Technology",
    marketCap: 1,
    totalDebt: 0.1,
    cashAndSecurities: 0.15,
    interestIncomeTtm: 1,
    revenueTtm: 100,
    dataIssues: [],
  };

  it.each([0.2999999, 0.29999999, 0.2999995, 0.3000001])(
    "debt ratio %s (within 0.0001 points of the 30 percent limit) is a breach",
    (debt) => {
      const result = screen({ ...base, totalDebt: debt });
      expect(result.ratios[0]?.breached).toBe(true);
      expect(result.status).toBe("not_halal");
    },
  );

  it("never displays a 'below' value >= the limit, or a breach value < it, across a fine sweep", () => {
    for (let k = 1; k <= 2000; k++) {
      for (const debt of [0.3 - k * 1e-8, 0.3 + k * 1e-8]) {
        const ratio = screen({ ...base, totalDebt: debt }).ratios[0];
        const shown = Number.parseFloat(ratio?.explanation ?? "");
        if (ratio?.breached === false) {
          expect(shown).toBeLessThan(30);
        } else {
          expect(shown).toBeGreaterThanOrEqual(30);
        }
      }
    }
  });
});
