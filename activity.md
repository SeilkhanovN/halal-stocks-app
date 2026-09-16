# Activity log

Append-only. One dated line per state change: `YYYY-MM-DD — <task id> — <pending|in progress|done|blocked> — <note>`.
The source of truth for completion is `"passes"` in prd.md; this log records how each task got there.

## Current state (as of 2026-09-16)

| Task | Title | State |
|---|---|---|
| BE-01 | Backend tooling baseline | done |
| BE-02 | Halal screening core | done |
| BE-03 | SQLite persistence | pending |
| BE-04 | EDGAR extractor | pending |
| BE-05 | Data clients + fixture mode | pending |
| BE-06 | Seed CLI | pending |
| BE-07 | GET /stocks | pending |
| BE-08 | Stock detail + halal-status routes | pending |
| BE-09 | Favorites routes | pending |
| FE-01 | Frontend tooling baseline | pending |
| FE-02 | Stock table + states + footer | pending |
| FE-03 | Search + filters | pending |
| FE-04 | Favorite toggle | pending |
| FE-05 | Detail side panel | pending |
| DOC-01 | README + end-to-end verification | pending |

## Log

- 2026-09-16 — ALL — pending — PRD created via /create-prd (15 tasks). Precondition: upgrade local Node from 20.18 to 24 LTS before BE-01.
- 2026-09-16 — BE-01 — in progress — Precondition met: Node upgraded to v24.19.0 (winget OpenJS.NodeJS.LTS). Planner running.
- 2026-09-16 — BE-01 — in progress — Blocker: typescript-eslint 8.70 (incl. canary) peer-caps typescript <6.1.0; backend had ^7.0.2. User chose to pin backend TypeScript to ~6.0 (matches frontend). Implementation resumed.
- 2026-09-16 — BE-01 — done — Review clean (2nd pass), 21/21 tests pass, typecheck/lint/build green. Deviations: TypeScript pinned ~6.0 (typescript-eslint caps <6.1), backend switched to ESM ("type": "module"), added tsconfig.build.json, eslint.config.mjs. .env.example created by user (agent permission deny). Follow-up suggestion: extract resolvePort() from server.ts for testability. Not committed.
- 2026-09-16 — BE-02 — in progress — Spec approved with amendments (reasons: primary cause first, industry line only when prohibited/missing; thresholds formatted "30%"). Data-source decision re-confirmed: Option A — compute AAOIFI in-house (no paid halal API); disclaimer must state it is a financial-ratio screen that does not analyse revenue breakdowns (mixed-business companies may pass). Negative numerators → unknown.
- 2026-09-16 — BE-02 — done — 130/130 tests, typecheck/lint/build green, no fixtures in dist. Review clean except near-limit display bug found by own smoke test + re-review ("30.0000% is below the 30% limit"); fixed per user by widening at-limit tolerance to 1e-6 (values within 0.0001 pct-points of a limit = breach → not_halal) + regression test (verified it fails on old 1e-9). Also: reasons prefixed with ratio label; escalating decimals near limits; isUsableNumber type fix; tsconfig.build.json excludes __fixtures__ (user-approved).
- 2026-09-16 — FOLLOW-UPS (deferred, minor) — (1) extract resolvePort() from server.ts for tests [BE-01]; (2) verify --env-file-if-exists actually loads a .env file [BE-01]; (3) empty/whitespace ticker guard in screen() [BE-02]; (4) runtime typeof-number guard for inputs parsed from external APIs [BE-02, revisit in BE-04/05]; (5) Finnhub industry labels are guesses — verify in BE-05; (6) .gitattributes eol=lf.
