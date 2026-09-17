// Canonical ticker normalization, shared by the DB layer and (eventually)
// route param handling: uppercase, trimmed, share-class dashes normalized to
// dots (BRK-B -> BRK.B), matching the API contract's "canonical form is
// uppercase with a dot for share classes" rule.
//
// This duplicates the tiny normalizeTickerLocal() helper in
// lib/halal-screen.ts, which predates this module and is documented there as
// a temporary stand-in until this module landed. lib/halal-screen.ts must
// stay dependency-free from db/, so it is not changed here (out of scope for
// BE-03) — but this module is now the canonical implementation for
// everything else.
const TICKER_PATTERN = /^[A-Z0-9.]{1,10}$/;

export function normalizeTicker(input: string): string {
  return input.trim().toUpperCase().replaceAll("-", ".");
}

// Validates the *normalized* form of `input`: 1-10 chars, uppercase
// letters/digits/dots only (e.g. "BRK.B", "AAPL"). Does not itself normalize
// the input it's given back to the caller — call normalizeTicker() first if
// you need the normalized string too.
export function isValidTicker(input: string): boolean {
  return TICKER_PATTERN.test(normalizeTicker(input));
}
