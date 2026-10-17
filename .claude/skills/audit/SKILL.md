---
name: audit
description: Comprehensive audit of the BBT app — automated gates (lint, types, unit tests, fresh-DB migrations, secrets, pinned actions, npm audit, diagrams, API and browser smoke tests), then six reviewers in parallel (spec and docs, design and simplicity, implementation, security, infrastructure, UX), each finding challenged by a skeptic, and one ranked report. Report only; fixes happen when the owner picks them. Use when asked to audit, to review or check everything, to make sure everything is consistent, accurate, simple, secure or follows best practices, and before every pull request ("/audit pr").
---

# /audit

The owner's standing request, made many times in different words: **everything accurate and consistent (code, docs,
UI), nothing old or dead, as simple as possible, best practices, every decision documented, access enforced on the
server.** This skill checks that in a repeatable way.

**Arguments:** none or `project` → the whole project. `pr` → the changes on this branch against `origin/main`, checked
for consistency with the rest.

**Rules:** report only. Never edit, commit, push or deploy during the audit. Fix only what the owner picks afterwards,
through the normal branch → PR flow.

## 1. Scope

- `git fetch -q origin main`, then `git status -sb` and, for `pr`, `git diff --stat origin/main...HEAD`.
- If there are uncommitted changes, say they're included in what's audited.

## 2. Automated gates

Run `.claude/skills/audit/gates.sh <dir>` with `<dir>` a new folder in the scratchpad (for example `<scratchpad>/audit`);
allow up to 10 minutes. It writes `<dir>/gates.md` (PASS / FAIL / SKIP per gate), a log per gate, and the browser
smoke test's screenshots in `<dir>/shots/`. It starts the local dev server only if it isn't running and stops it after.

- A FAIL is a finding by itself; read its log and include the cause in the report.
- The diagram gate needs mermaid, which isn't a repo dependency: first `npm i --prefix <scratchpad>/mm mermaid@11`,
  then run the gates with `MERMAID_JS=<scratchpad>/mm/node_modules/mermaid/dist/mermaid.min.js`. Without it the gate
  says SKIP; report that.

## 3. Reviewers

Invoking this skill is the owner's opt-in to a multi-agent workflow. Run:

```
Workflow({
  scriptPath: "<repo>/.claude/skills/audit/audit.workflow.js",
  args: { scope: "project" | "pr", base: "origin/main", gates: "<contents of gates.md>", shots: "<dir>/shots" }
})
```

It runs six reviewers in parallel, each with its own checklist (see the script): spec and docs, design and simplicity,
implementation, security, infrastructure and operations, UX consistency. Each finding goes to a skeptic told to refute
it and to check the fix is the simplest one; only confirmed findings reach the report. The last agent writes the report.
Expect roughly 6 reviewers plus one skeptic per finding (findings are capped at 10 per area; the script logs any cut).

## 4. Report

- Save the report to `<dir>/audit-report.md`.
- In chat: the TL;DR, the gate failures, and the critical and major findings, each with file:line and the fix. Offer
  the full report as an artifact page in one line.
- Then ask, multiple choice with a recommendation: which findings to fix (for example "critical and major in one PR,
  minor later"), and whether to fix nits now.
- Don't start fixing until the owner answers.

## Before every pull request

Run `/audit pr` before opening a PR and put a one-line result in the PR description ("Audit: gates pass; 0 critical,
0 major; 2 minor fixed"). For a docs-only change the gates alone are enough; say so.
