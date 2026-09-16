# Project

Halal Stocks — MVP. A stock list you can search by ticker, favorite, and
see a halal/not-halal badge on. Two separate services meant to be
dockerized independently later: `backend/` (API) and `frontend/` (UI).
No shared `node_modules` or shared package.json between them — treat them
as two independent apps that happen to live in one repo for now.

# Stack & commands

## backend/ (Node.js, TypeScript, Fastify)
- Install: `cd backend && npm install`
- Dev server: `npm run dev` (tsx/nodemon watch mode — TBD once scaffolded)
- Test: `npm test`
- Lint / typecheck: `npm run lint` / `npm run typecheck`
- Build: `npm run build`

## frontend/ (React, TypeScript, Vite)
- Install: `cd frontend && npm install`
- Dev server: `npm run dev`
- Test: `npm test`
- Lint / typecheck: `npm run lint` / `npm run typecheck`
- Build: `npm run build`

<!-- Update the exact scripts once each package.json exists — these are
     the conventional Vite/Fastify defaults, not yet verified against
     real package.json files. -->

# Code style

- TypeScript strict mode in both services.
- No `any` without a comment explaining why it's unavoidable.
- Backend: one route/handler per file (see the api-conventions skill).
- Frontend: colocate a component's styles/tests next to the component.

# MVP scope (don't build past this until it's re-scoped)

- Stock list view (paginated), pulled from an external stock data API.
- Search by ticker.
- Favorite/unfavorite a stock (persisted — storage choice TBD: start with
  SQLite for zero-setup, move to Postgres later if needed).
- Halal / not-halal / unknown badge per stock, computed from the AAOIFI
  screening ratios (debt/market-cap, cash+securities/market-cap, interest
  income/revenue — see prd.md once /create-prd runs for the exact rules)
  or pulled from a halal-screening API if one is used instead of
  computing it in-house.
- Explicitly OUT of scope for the MVP: quarterly re-screening/notifications,
  the RAG knowledge-base layer over the friend's materials, portfolio
  tracking, auth/multi-user. These come later — don't let the pipeline
  scope-creep into them without a fresh /create-prd pass.

# Workflow

IMPORTANT: whenever the user asks to implement, build, work on, do, fix, or
finish a task — any phrasing, whether or not they say "subagent" — ALWAYS
run it through this exact pipeline. Do not ask which subagent to use or in
what order. Do not implement directly in this main thread.

1. Spawn `planner` → spec + file manifest.
2. **STOP.** Show the spec to the user in a few lines. Wait for a go-ahead
   ("looks good" / changes) before continuing. Do not implement yet.
3. Spawn `code-developer` → implements from the approved spec.
4. Spawn `code-reviewer` → findings on the diff.
5. If findings are non-trivial, spawn `code-developer` again to address
   them, then re-review.
6. Spawn `unit-tester` → writes and runs tests, reports pass/fail.
7. If this task came from `prd.md`, mark it `"passes": true` only now, and
   append a dated line to `activity.md`.
8. **STOP.** Summarize what changed (files touched, one line each) and show
   the diff. Never run `git commit` or `git push` without an explicit yes
   from the user on that specific change — this holds even mid-loop under
   ralph-loop; committing is always a distinct human-approved step, never
   bundled into "task complete."

For anything touching more than one file, or an area you're unfamiliar
with, this replaces plan mode — the planner step above already covers it.
For genuine one-line fixes (typo, log line, variable rename), skip the
pipeline and just do it.

Other rules:
- Ask before adding a new dependency/package or touching a file outside
  the current task's file manifest.
- Ask before touching both `backend/` and `frontend/` in the same task —
  most tasks should be scoped to one service; cross-cutting changes (e.g.
  an API contract change) are the exception, not the default.
- For pure research ("how does X work", "where is Y defined") with no
  implementation intent, use a subagent to investigate rather than reading
  everything into this context — that's separate from the pipeline above.

# Repository etiquette

- Branch naming: `feature/<short-description>` or `fix/<short-description>`
- Commit style: conventional-ish — `feat:`, `fix:`, `chore:`, `docs:` prefix
- Never commit: `.env`, API keys, `node_modules/`, secrets.

<!--
Note on ralph-loop: the loop prompt (see README.md / prompt.md once
/create-prd has run) tells each iteration to run this same pipeline, but
to skip the two STOP points above and proceed straight through — that's
the whole point of running it unattended. The commit STOP still applies
even then: the loop implements/reviews/tests every task without you, but
never commits, so you get one full review at the end instead of per-task
ones.
-->

<!-- Keep this file short. If a rule isn't preventing a real mistake, cut it.
     Run /context in Claude Code to confirm this file loaded, and /doctor to
     get suggestions for what to prune once the project has some history. -->
