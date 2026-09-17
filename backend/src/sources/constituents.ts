// Loads the checked-in S&P 500 constituents snapshot (see
// data/constituents/README.md for the source URL and snapshot date) with no
// network access and no external API keys, so `npm run seed:constituents`
// can populate SQLite with the stock universe before any halal-screening
// data source exists. NASDAQ-100 is deferred (user decision 2026-09-17) —
// this module is S&P 500 only.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isValidTicker, normalizeTicker } from "../lib/ticker.js";

export interface Constituent {
  ticker: string;
  name: string;
  cik: string | null;
}

// A minimal RFC-4180-ish CSV parser: quoted fields (which may contain commas
// and embedded newlines), `""` as an escaped quote inside a quoted field,
// and both \r\n and \n line endings. A leading BOM is stripped. A fully
// blank line is skipped rather than producing a row of one empty field, and
// a trailing final newline does not produce a spurious empty row at the end.
export function parseCsv(text: string): string[][] {
  const stripped = text.length > 0 && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const n = stripped.length;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // Tracks whether the current (not-yet-terminated) row has seen any actual
  // field content (a quote, a comma, or a plain character) — distinguishes
  // a genuinely blank line ("") from a row with one empty field.
  let rowHasContent = false;

  function endRow(): void {
    row.push(field);
    const isBlankLine = row.length === 1 && row[0] === "" && !rowHasContent;
    if (!isBlankLine) {
      rows.push(row);
    }
    row = [];
    field = "";
    rowHasContent = false;
  }

  let i = 0;
  while (i < n) {
    const ch = stripped[i];
    if (ch === undefined) {
      break;
    }

    if (inQuotes) {
      if (ch === '"') {
        if (stripped[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += ch;
        i += 1;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      rowHasContent = true;
      i += 1;
    } else if (ch === ",") {
      row.push(field);
      field = "";
      rowHasContent = true;
      i += 1;
    } else if (ch === "\r") {
      if (stripped[i + 1] === "\n") {
        i += 1;
      }
      i += 1;
      endRow();
    } else if (ch === "\n") {
      i += 1;
      endRow();
    } else {
      field += ch;
      rowHasContent = true;
      i += 1;
    }
  }

  // A trailing newline already ended the last row above, leaving nothing
  // pending — only flush a final row when there's unterminated content.
  if (field !== "" || row.length > 0 || rowHasContent) {
    endRow();
  }

  return rows;
}

function findColumnIndex(header: readonly string[], name: string): number | undefined {
  const index = header.findIndex((column) => column.trim() === name);
  return index === -1 ? undefined : index;
}

function resolveCik(raw: string | undefined, ticker: string, lineNumber: number): string | null {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") {
    return null;
  }
  if (/^[0-9]+$/.test(trimmed)) {
    return trimmed.padStart(10, "0");
  }
  console.warn(`sp500.csv line ${lineNumber}: non-numeric CIK '${trimmed}' for ticker '${ticker}', using null`);
  return null;
}

// Parses the S&P 500 CSV text (header: Symbol,Security,GICS Sector,GICS
// Sub-Industry,Headquarters Location,Date added,CIK,Founded — see
// data/constituents/README.md) into deduplicated, normalized constituents,
// sorted by ticker. Columns are looked up by trimmed header name rather than
// fixed position, so column reordering upstream doesn't silently corrupt
// the parse.
export function parseSp500Csv(text: string): Constituent[] {
  const rows = parseCsv(text);
  const header = rows[0];
  if (header === undefined) {
    throw new Error("sp500.csv is empty — no header row found");
  }

  const symbolIndex = findColumnIndex(header, "Symbol");
  if (symbolIndex === undefined) {
    throw new Error(`sp500.csv is missing the required 'Symbol' column. Header seen: ${header.join(",")}`);
  }
  const securityIndex = findColumnIndex(header, "Security");
  if (securityIndex === undefined) {
    throw new Error(`sp500.csv is missing the required 'Security' column. Header seen: ${header.join(",")}`);
  }
  const cikIndex = findColumnIndex(header, "CIK");

  const byTicker = new Map<string, Constituent>();

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    if (row === undefined) {
      continue;
    }
    const lineNumber = rowIndex + 1; // header is line 1, first data row is line 2

    const symbol = (row[symbolIndex] ?? "").trim();
    const name = (row[securityIndex] ?? "").trim();
    if (symbol === "" || name === "") {
      console.warn(`sp500.csv line ${lineNumber}: skipping row with an empty Symbol or Security`);
      continue;
    }

    const ticker = normalizeTicker(symbol);
    if (!isValidTicker(ticker)) {
      console.warn(`sp500.csv line ${lineNumber}: skipping invalid ticker '${symbol}'`);
      continue;
    }

    const cik = cikIndex === undefined ? null : resolveCik(row[cikIndex], ticker, lineNumber);

    if (!byTicker.has(ticker)) {
      byTicker.set(ticker, { ticker, name, cik });
    }
  }

  return Array.from(byTicker.values()).sort((a, b) => (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0));
}

// Resolves the default constituents directory the same way connection.ts
// resolves the default DB path: derived from this module's own URL, two
// levels up (src/sources -> src -> backend), so it works whether running
// from source or from dist/.
function defaultConstituentsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const backendRoot = join(here, "..", "..");
  return join(backendRoot, "data", "constituents");
}

// Reads and parses <dir>/sp500.csv (default: data/constituents/sp500.csv).
export function loadConstituents(dir: string = defaultConstituentsDir()): Constituent[] {
  const text = readFileSync(join(dir, "sp500.csv"), "utf8");
  return parseSp500Csv(text);
}
