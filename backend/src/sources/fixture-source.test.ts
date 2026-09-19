import { afterEach, describe, expect, it, vi } from "vitest";
import { createFixtureDataSource } from "./fixture-source.js";
import { extractFinancials } from "../lib/edgar-extract.js";
import { screen } from "../lib/halal-screen.js";
import type { HalalStatus, ScreeningInput } from "../types/halal.js";

describe("createFixtureDataSource", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads no env vars and never calls fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const originalEnv = { ...process.env };

    const dataSource = createFixtureDataSource();
    await dataSource.getProfile("AAPL");
    await dataSource.getCompanyFacts("AAPL");

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(process.env).toEqual(originalEnv);
  });

  it("resolves null for both getProfile and getCompanyFacts when no fixture file exists", async () => {
    const dataSource = createFixtureDataSource();
    expect(await dataSource.getProfile("ZZZZ")).toBeNull();
    expect(await dataSource.getCompanyFacts("ZZZZ")).toBeNull();
  });

  describe("getCompanyFacts() -> extractFinancials()", () => {
    const dataSource = createFixtureDataSource();

    it("AAPL: zero issues, all four figures populated", async () => {
      const raw = await dataSource.getCompanyFacts("AAPL");
      const financials = extractFinancials(raw);

      expect(financials.issues).toEqual([]);
      expect(financials.totalDebt).toBe(100_000_000_000);
      expect(financials.cashAndSecurities).toBe(150_000_000_000);
      expect(financials.revenueTtm).toBe(400_000_000_000);
      expect(financials.interestIncomeTtm).toBe(4_000_000_000);
    });

    it("JPM: zero issues, all four figures populated", async () => {
      const raw = await dataSource.getCompanyFacts("JPM");
      const financials = extractFinancials(raw);

      expect(financials.issues).toEqual([]);
      expect(financials.totalDebt).toBe(300_000_000_000);
      expect(financials.cashAndSecurities).toBe(200_000_000_000);
      expect(financials.revenueTtm).toBe(170_000_000_000);
      expect(financials.interestIncomeTtm).toBe(80_000_000_000);
    });

    it("T: zero issues, debt-breaching figures", async () => {
      const raw = await dataSource.getCompanyFacts("T");
      const financials = extractFinancials(raw);

      expect(financials.issues).toEqual([]);
      expect(financials.totalDebt).toBe(130_000_000_000);
      expect(financials.cashAndSecurities).toBe(5_000_000_000);
      expect(financials.revenueTtm).toBe(120_000_000_000);
      expect(financials.interestIncomeTtm).toBe(500_000_000);
    });

    it("ASML: IFRS filer, all-null with the IFRS issue", async () => {
      const raw = await dataSource.getCompanyFacts("ASML");
      const financials = extractFinancials(raw);

      expect(financials.totalDebt).toBeNull();
      expect(financials.cashAndSecurities).toBeNull();
      expect(financials.revenueTtm).toBeNull();
      expect(financials.interestIncomeTtm).toBeNull();
      expect(financials.issues).toEqual(["Foreign/IFRS filer — financials not screened"]);
    });

    it("NO_INTEREST: interest income missing, everything else populated", async () => {
      const raw = await dataSource.getCompanyFacts("NO_INTEREST");
      const financials = extractFinancials(raw);

      expect(financials.totalDebt).toBe(5_000_000_000);
      expect(financials.cashAndSecurities).toBe(5_000_000_000);
      expect(financials.revenueTtm).toBe(20_000_000_000);
      expect(financials.interestIncomeTtm).toBeNull();
      expect(financials.issues).toEqual(["Interest income not reported"]);
    });
  });

  describe("end-to-end: getProfile() + getCompanyFacts() -> extractFinancials() -> screen()", () => {
    const dataSource = createFixtureDataSource();

    // Recursively asserts that no number in the screening output is NaN or
    // Infinity/-Infinity — a screening result should only ever surface a
    // real finite number or an explicit null, never a computation artifact.
    function expectNoNaNOrInfinity(value: unknown, path = "result"): void {
      if (typeof value === "number") {
        expect(Number.isNaN(value), `${path} is NaN`).toBe(false);
        expect(Number.isFinite(value), `${path} is not finite (${value})`).toBe(true);
        return;
      }
      if (Array.isArray(value)) {
        value.forEach((item, index) => expectNoNaNOrInfinity(item, `${path}[${index}]`));
        return;
      }
      if (value !== null && typeof value === "object") {
        for (const [key, nested] of Object.entries(value)) {
          expectNoNaNOrInfinity(nested, `${path}.${key}`);
        }
      }
    }

    async function screenFixtureTicker(ticker: string): Promise<ReturnType<typeof screen>> {
      const profile = await dataSource.getProfile(ticker);
      const rawFacts = await dataSource.getCompanyFacts(ticker);

      // STZ has no EDGAR fixture on purpose (its not_halal comes purely from
      // the ticker denylist) -- getCompanyFacts returns null for it, and
      // that degrades to all-null financials + a data issue, same as any
      // other "EDGAR has nothing for this company" case would.
      const financials =
        rawFacts === null
          ? {
              totalDebt: null,
              cashAndSecurities: null,
              interestIncomeTtm: null,
              revenueTtm: null,
              issues: ["EDGAR data unavailable"],
            }
          : extractFinancials(rawFacts);

      const input: ScreeningInput = {
        ticker,
        industry: profile ? profile.industry : null,
        marketCap: profile ? profile.marketCap : null,
        totalDebt: financials.totalDebt,
        cashAndSecurities: financials.cashAndSecurities,
        interestIncomeTtm: financials.interestIncomeTtm,
        revenueTtm: financials.revenueTtm,
        dataIssues: financials.issues,
      };

      return screen(input);
    }

    // Sanity check retained: every fixture ticker resolves to its expected
    // top-level status. The per-ticker tests below additionally pin *why*
    // (business activity + each ratio's value/breached + reason count), so a
    // fixture can't drift to the right status for the wrong reason without
    // failing.
    const cases: Array<{ ticker: string; expectedStatus: HalalStatus }> = [
      { ticker: "AAPL", expectedStatus: "halal" },
      { ticker: "JPM", expectedStatus: "not_halal" },
      { ticker: "T", expectedStatus: "not_halal" },
      { ticker: "ASML", expectedStatus: "unknown" },
      { ticker: "NO_INTEREST", expectedStatus: "unknown" },
      { ticker: "STZ", expectedStatus: "not_halal" },
    ];

    it.each(cases)("$ticker -> $expectedStatus", async ({ ticker, expectedStatus }) => {
      const result = await screenFixtureTicker(ticker);
      expect(result.status).toBe(expectedStatus);
      expectNoNaNOrInfinity(result);
    });

    it("AAPL: halal with zero data issues and all three ratios passing", async () => {
      const result = await screenFixtureTicker("AAPL");

      expect(result.status).toBe("halal");
      expect(result.businessActivity.prohibited).toBe(false);

      const [debt, cash, interest] = result.ratios;
      expect(debt?.value).toBeCloseTo(100_000_000_000 / 3_000_000_000_000, 10);
      expect(debt?.breached).toBe(false);
      expect(cash?.value).toBeCloseTo(0.05, 10);
      expect(cash?.breached).toBe(false);
      expect(interest?.value).toBeCloseTo(0.01, 10);
      expect(interest?.breached).toBe(false);
    });

    it("JPM: not_halal by prohibited industry AND all three ratios breached (4 reasons)", async () => {
      const result = await screenFixtureTicker("JPM");

      expect(result.status).toBe("not_halal");
      expect(result.businessActivity.prohibited).toBe(true);
      expect(result.businessActivity.explanation).toBe(
        "Industry 'Banking' is not permissible under AAOIFI screening.",
      );

      const [debt, cash, interest] = result.ratios;
      expect(debt?.value).toBeCloseTo(0.6, 10);
      expect(debt?.breached).toBe(true);
      expect(cash?.value).toBeCloseTo(0.4, 10);
      expect(cash?.breached).toBe(true);
      expect(interest?.value).toBeCloseTo(80_000_000_000 / 170_000_000_000, 10);
      expect(interest?.breached).toBe(true);

      expect(result.reasons).toHaveLength(4);
    });

    it("T: not_halal by ratio ONLY — exactly one reason, only the debt ratio breached", async () => {
      const result = await screenFixtureTicker("T");

      expect(result.status).toBe("not_halal");
      expect(result.businessActivity.prohibited).toBe(false);

      const [debt, cash, interest] = result.ratios;
      expect(debt?.breached).toBe(true);
      expect(debt?.value).toBeCloseTo(130_000_000_000 / 150_000_000_000, 10); // 86.7%
      expect(cash?.breached).toBe(false);
      expect(interest?.breached).toBe(false);

      expect(result.reasons).toHaveLength(1);
      expect(result.reasons[0]).toBe("Debt / market cap: 86.7% meets or exceeds the 30% limit.");
    });

    it("STZ: not_halal by ticker denylist — all ratios null, exactly one reason", async () => {
      const result = await screenFixtureTicker("STZ");

      expect(result.status).toBe("not_halal");
      expect(result.businessActivity.prohibited).toBe(true);
      expect(result.businessActivity.explanation).toBe(
        "'STZ' is on the prohibited-business ticker list.",
      );

      for (const ratio of result.ratios) {
        expect(ratio.value).toBeNull();
        expect(ratio.breached).toBeNull();
      }

      expect(result.reasons).toHaveLength(1);
      expect(result.reasons[0]).toBe("'STZ' is on the prohibited-business ticker list.");
    });

    it("ASML: unknown via IFRS/foreign-filer issue — all ratios null", async () => {
      const result = await screenFixtureTicker("ASML");

      expect(result.status).toBe("unknown");
      const financials = extractFinancials(await dataSource.getCompanyFacts("ASML"));
      expect(financials.issues).toEqual(["Foreign/IFRS filer — financials not screened"]);

      for (const ratio of result.ratios) {
        expect(ratio.value).toBeNull();
      }
    });

    it("NO_INTEREST: unknown via missing interest income only — debt/cash pass at 0.1", async () => {
      const result = await screenFixtureTicker("NO_INTEREST");

      expect(result.status).toBe("unknown");
      const financials = extractFinancials(await dataSource.getCompanyFacts("NO_INTEREST"));
      expect(financials.issues).toEqual(["Interest income not reported"]);

      const [debt, cash, interest] = result.ratios;
      expect(debt?.value).toBeCloseTo(0.1, 10);
      expect(debt?.breached).toBe(false);
      expect(cash?.value).toBeCloseTo(0.1, 10);
      expect(cash?.breached).toBe(false);
      expect(interest?.value).toBeNull();
    });
  });
});
