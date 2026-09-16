---
name: implement
description: Run one task from prd.md through the full planner -> code-developer -> code-reviewer -> unit-tester pipeline, with review pauses. Usage: /implement <task id or short description>
disable-model-invocation: true
---

Implement: $ARGUMENTS

Follow the pipeline defined in CLAUDE.md's Workflow section exactly —
planner, then STOP and show me the spec, then (once I approve)
code-developer, code-reviewer, unit-tester, then STOP and show me the diff
before anything gets committed.

If `$ARGUMENTS` is a task id from `prd.md`, use that task's description and
acceptance criteria as the planner's input. If it's a free-text description
instead, treat it as an ad-hoc task not tracked in prd.md.
