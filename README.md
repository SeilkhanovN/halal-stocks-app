# Halal Stocks — MVP

A stock list with search, favorites, and a halal/not-halal badge per
stock (screened against the AAOIFI ratios). Two independent services,
meant to be dockerized separately later:

```
.
├── backend/      # Node.js + TypeScript + Fastify — the API
├── frontend/     # React + TypeScript — the UI
├── .claude/      # Claude Code pipeline: agents, commands, settings
└── CLAUDE.md     # project context + workflow rules, loaded every session
```

## Status

Skeleton only — folders exist, nothing scaffolded yet. Next steps:

1. `cd backend && npm init -y` (or your Fastify starter of choice), add
   TypeScript + Fastify + a dev-watch script.
2. `cd frontend && npm create vite@latest . -- --template react-ts`
3. Run `/create-prd` in Claude Code from the project root to interview
   yourself about the exact MVP scope (data source API, storage choice,
   auth or none) and generate `prd.md` / `activity.md` / `prompt.md`.
4. Work through tasks with `/implement <task>`, or hand the whole list to
   `/ralph-loop` once `prompt.md` exists — see the Claude Code kit's own
   notes for the exact invocation.

## Why two separate services

`backend/` and `frontend/` each get their own `package.json`,
`node_modules`, and (later) `Dockerfile` — there's no shared tooling
between them on purpose, so each can be built, tested, and deployed
independently once this moves to Docker.
