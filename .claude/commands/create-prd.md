---
name: create-prd
description: Interview the user about a feature/project and turn it into prd.md, activity.md, and prompt.md
disable-model-invocation: true
---

Interview the user in detail about: $ARGUMENTS

Use the AskUserQuestion tool (or plain questions if it's unavailable). Ask
about technical implementation, UI/UX, edge cases, and tradeoffs. Don't ask
things you can just infer from the codebase — dig into the parts the user
probably hasn't fully thought through yet. Keep interviewing until the
scope is genuinely clear, not just superficially answered.

When done, write three files:

**prd.md** — every task as a JSON array, each with at minimum:
```json
{
  "id": "...",
  "title": "...",
  "description": "...",
  "files": ["..."],
  "acceptance_criteria": ["..."],
  "passes": false
}
```
`passes` flips to `true` only once a task has been reviewed clean and its
tests pass — never set it manually.

**activity.md** — a running log of task state (pending / in progress /
done), so any session (or the ralph-loop plugin) can tell what's left
without re-reading the whole conversation. Append, don't rewrite.

**prompt.md** — the definition of done for this project as a whole,
derived from the interview: what "complete" means, what's explicitly out
of scope, and how to verify the end result actually works (not just that
the code looks plausible). Then append this fixed section verbatim, so the
ralph-loop invocation never has to spell it out again:

```markdown
## Ralph loop execution contract

Each iteration: find the first task in prd.md with "passes": false. Do NOT
invoke /implement for this — run the planner -> code-developer ->
code-reviewer -> unit-tester pipeline from CLAUDE.md directly, skipping
the post-planning approval pause. Implement, review, and test the task,
but do not commit it. Mark it "passes": true only when review is clean
and tests pass, then append a dated line to activity.md. When every task
in prd.md passes, output <promise>ALL TASKS COMPLETE</promise>.
```

If the interview surfaced a stack/tooling choice that needs specific CLI
permissions (e.g. `next`, `prisma`, `docker`, a deploy CLI), add the
relevant commands to the `allow` list in `.claude/settings.json` so you're
not asked to approve routine commands for tools that didn't exist in the
project yet. Tell the user what you added.

If the user seems unsure about a technical choice (framework, DB, hosting)
rather than deciding immediately, offer to research current options and
tradeoffs before locking it into the PRD.

Do not start implementing anything in this command — planning only.

**STOP here.** Show a short summary of prd.md (task count and titles) and
ask the user to review prd.md, activity.md, prompt.md, and the
settings.json change before anything gets implemented. Implementation
starts only after they say to proceed — either with `/implement <task>`
one at a time, or by starting a ralph-loop run.
