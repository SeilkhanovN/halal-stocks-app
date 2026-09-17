import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConstituents, parseCsv, parseSp500Csv } from "./constituents.js";

const HEADER = "Symbol,Security,GICS Sector,GICS Sub-Industry,Headquarters Location,Date added,CIK,Founded";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseCsv", () => {
  it("parses a quoted field containing a comma", () => {
    const text = 'a,b,c\n1,"Louisville, Kentucky",3\n';
    expect(parseCsv(text)).toEqual([
      ["a", "b", "c"],
      ["1", "Louisville, Kentucky", "3"],
    ]);
  });

  it("parses an escaped quote inside a quoted field", () => {
    const text = 'a,b\n1,"She said ""hi"""\n';
    expect(parseCsv(text)).toEqual([
      ["a", "b"],
      ["1", 'She said "hi"'],
    ]);
  });

  it("parses CRLF and a leading BOM the same as plain LF", () => {
    const lf = "a,b\n1,2\n";
    const crlfWithBom = "﻿a,b\r\n1,2\r\n";
    expect(parseCsv(crlfWithBom)).toEqual(parseCsv(lf));
  });

  it("skips fully blank lines and does not produce a trailing empty row", () => {
    const text = "a,b\n1,2\n\n3,4\n";
    expect(parseCsv(text)).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("parses a file with no trailing newline the same as one with a trailing newline", () => {
    const withTrailing = "a,b\n1,2\n";
    const withoutTrailing = "a,b\n1,2";
    expect(parseCsv(withoutTrailing)).toEqual(parseCsv(withTrailing));
  });

  it("keeps an embedded newline inside a quoted field as one field, and still parses the following row", () => {
    const text = 'a,b\n1,"Line1\nLine2",3\n4,5,6\n';
    expect(parseCsv(text)).toEqual([
      ["a", "b"],
      ["1", "Line1\nLine2", "3"],
      ["4", "5", "6"],
    ]);
  });

  it("keeps the remaining text as field content when a quote is unterminated at EOF", () => {
    const text = 'a,b\n1,"unterminated';
    expect(() => parseCsv(text)).not.toThrow();
    expect(parseCsv(text)).toEqual([
      ["a", "b"],
      ["1", "unterminated"],
    ]);
  });
});

describe("parseSp500Csv", () => {
  it("throws naming the missing 'Symbol' header", () => {
    const text = "Security,CIK\nApple Inc,320193\n";
    expect(() => parseSp500Csv(text)).toThrow(/Symbol/);
  });

  it("throws naming the missing 'Security' header", () => {
    const text = "Symbol,CIK\nAAPL,320193\n";
    expect(() => parseSp500Csv(text)).toThrow(/Security/);
  });

  it("normalizes BRK-B and brk.b to BRK.B", () => {
    const text = `${HEADER}\nBRK-B,Berkshire Hathaway,Financials,Multi-Sector Holdings,"Omaha, Nebraska",2010-02-16,1067983,1839\n`;
    const result = parseSp500Csv(text);
    expect(result).toHaveLength(1);
    expect(result[0]?.ticker).toBe("BRK.B");
  });

  it("skips a row with an invalid ticker", () => {
    const text = `${HEADER}\nAA PL,Bad Ticker Co,Tech,Sub,"City, ST",2020-01-01,111111,1990\n`;
    expect(parseSp500Csv(text)).toEqual([]);
  });

  it("skips a row with an empty name", () => {
    const text = `${HEADER}\nAAPL,,Tech,Sub,"City, ST",2020-01-01,320193,1976\n`;
    expect(parseSp500Csv(text)).toEqual([]);
  });

  it("zero-pads a numeric CIK to 10 digits", () => {
    const text = `${HEADER}\nAAPL,Apple Inc,Tech,Sub,"Cupertino, CA",1982-11-30,320193,1976\n`;
    const result = parseSp500Csv(text);
    expect(result[0]?.cik).toBe("0000320193");
  });

  it("returns null for an empty CIK", () => {
    const text = `${HEADER}\nAAPL,Apple Inc,Tech,Sub,"Cupertino, CA",1982-11-30,,1976\n`;
    const result = parseSp500Csv(text);
    expect(result[0]?.cik).toBeNull();
  });

  it("keeps the first occurrence when a ticker is duplicated", () => {
    const text = `${HEADER}\nAAPL,Apple Inc,Tech,Sub,"Cupertino, CA",1982-11-30,320193,1976\nAAPL,Apple Duplicate,Tech,Sub,"Cupertino, CA",1982-11-30,999999,1976\n`;
    const result = parseSp500Csv(text);
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("Apple Inc");
  });

  it("sorts the result by ticker", () => {
    const text = `${HEADER}\nZETA,Zeta Corp,Tech,Sub,"City, ST",2020-01-01,111111,1990\nAAPL,Apple Inc,Tech,Sub,"Cupertino, CA",1982-11-30,320193,1976\n`;
    const result = parseSp500Csv(text);
    expect(result.map((c) => c.ticker)).toEqual(["AAPL", "ZETA"]);
  });

  it("returns an empty array for a header-only CSV with a trailing newline", () => {
    const text = `${HEADER}\n`;
    expect(() => parseSp500Csv(text)).not.toThrow();
    expect(parseSp500Csv(text)).toEqual([]);
  });

  it("returns an empty array for a header-only CSV with no trailing newline", () => {
    const text = HEADER;
    expect(() => parseSp500Csv(text)).not.toThrow();
    expect(parseSp500Csv(text)).toEqual([]);
  });
});

describe("loadConstituents (real file)", () => {
  it("loads the checked-in sp500.csv with a sane row count, no duplicates, and known tickers", () => {
    const result = loadConstituents();

    expect(result.length).toBeGreaterThanOrEqual(495);
    expect(result.length).toBeLessThanOrEqual(510);

    const tickers = result.map((c) => c.ticker);
    expect(new Set(tickers).size).toBe(tickers.length);

    expect(tickers).toContain("AAPL");
    expect(tickers).toContain("MSFT");
    expect(tickers).toContain("BRK.B");

    for (const constituent of result) {
      expect(constituent.cik === null || /^[0-9]{10}$/.test(constituent.cik)).toBe(true);
    }
  });
});
