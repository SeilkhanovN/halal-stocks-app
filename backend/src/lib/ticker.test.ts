import { describe, expect, it } from "vitest";
import { isValidTicker, normalizeTicker } from "./ticker.js";

describe("normalizeTicker", () => {
  it("uppercases", () => {
    expect(normalizeTicker("aapl")).toBe("AAPL");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeTicker("  aapl  ")).toBe("AAPL");
  });

  it("maps a dash share-class separator to a dot", () => {
    expect(normalizeTicker("brk-b")).toBe("BRK.B");
  });

  it("leaves an already-canonical ticker unchanged", () => {
    expect(normalizeTicker("BRK.B")).toBe("BRK.B");
  });

  it("maps every dash, not just the first", () => {
    expect(normalizeTicker("a-b-c")).toBe("A.B.C");
  });

  it("is idempotent", () => {
    const once = normalizeTicker("brk-b");
    expect(normalizeTicker(once)).toBe(once);
  });
});

describe("isValidTicker", () => {
  it.each(["AAPL", "A", "BRK.B", "brk-b", "AAL", "A1"])("accepts %s", (ticker) => {
    expect(isValidTicker(ticker)).toBe(true);
  });

  it.each([
    "",
    " ",
    "TOOLONGTICKER",
    "AAPL!",
    "AA PL",
    "AA_PL",
    "aapl$",
  ])("rejects %j", (ticker) => {
    expect(isValidTicker(ticker)).toBe(false);
  });

  it("accepts exactly 10 normalized characters", () => {
    expect(isValidTicker("A123456789")).toBe(true);
  });

  it("rejects 11 normalized characters", () => {
    expect(isValidTicker("A1234567890")).toBe(false);
  });
});
