export const meta = {
  name: 'bbt-audit',
  description: 'Audit BBT: six reviewers in parallel (spec/docs, simplicity, implementation, security, infra, UX), each finding challenged by a skeptic, one ranked report',
  whenToUse: 'Run by the /audit skill after its automated gates; pass args {scope, base, gates, shots}',
  phases: [
    { title: 'Review', detail: 'one reviewer per area, against its checklist' },
    { title: 'Verify', detail: 'a skeptic tries to refute each finding and checks the fix is the simplest' },
    { title: 'Report', detail: 'dedupe, rank, list what was not covered' },
  ],
}

// args: { scope: 'project' | 'pr', base: 'origin/main', gates: '<gates.md table>', shots: '<dir of screenshots>' }
const A = args || {}
const SCOPE = A.scope === 'pr'
  ? `the changes on this branch (git diff ${A.base || 'origin/main'}...HEAD), checked for consistency with the rest of the project`
  : 'the whole project'
const MAX_PER_AREA = 10

const STANDARD = `The owner's standard, applied in every area: accurate and precise; consistent everywhere (code, docs, UI);
no old, dead or duplicated code or text; as simple as possible (the simplest thing that fully works); best practices;
every behaviour and decision documented; access enforced on the server. Sources of truth: DESIGN.md (spec),
DECISIONS.md (decision log), ARCHITECTURE.md (architecture), SETUP.md (accounts, secrets), README.md.`

const AREAS = [
  { key: 'spec-docs', title: 'Spec and docs', checklist: `
- Every claim in DESIGN.md, DECISIONS.md, ARCHITECTURE.md, README.md, SETUP.md, public/privacy.html, the Help guide
  (src/pages/HelpGuide.tsx, HelpGarmin.tsx) and What's new (src/pages/Updates.tsx) matches the code: numbers (limits,
  TTLs, cron, retention, counts of tests/tables/migrations), routes and who may call them, names and labels on screen.
- Stale or superseded statements (old names, removed features, "v1" behaviour presented as current).
- Contradictions between documents.
- Behaviour in the code with no spec or decision behind it, and decisions never implemented.
- The privacy page lists every kind of personal data stored and who can see it.
- The Help guide is accurate, concise, and readable by non-technical people.` },
  { key: 'simplicity', title: 'Design and simplicity', checklist: `
- Dead code: unused files, exports, functions, types, CSS classes, routes, npm dependencies, scripts, env vars.
- Duplication: the same logic in two places (worker vs shared vs client), copy-pasted queries or components that
  should share one helper.
- Over-engineering: abstractions with one caller, options nothing passes, layers that add nothing.
- More than one way to do the same thing (fetching, errors, dates/time zones, buttons, panels, notifications).
- Comments that no longer describe the code; misleading names.
For each, name the simplest change that removes it.` },
  { key: 'implementation', title: 'Implementation', checklist: `
- Bugs and wrong results, with a concrete input that triggers them.
- Edge cases: New York dates and DST, past/future limits, empty lists, the D1 100-bound-parameter limit, very long text,
  disabled or deleted users, an activity or poll deleted while open elsewhere.
- Races: read-then-write without a guard inside the D1 batch; concurrent edits (baseUpdatedAt).
- Error handling: errors swallowed, unclear messages, 500s that should be 4xx.
- Client: TanStack Query cache invalidation after every mutation, loading/error/empty states, stale UI.
- Performance: N+1 queries, work over the Workers free-plan CPU budget (~10 ms), unnecessary re-renders.` },
  { key: 'security', title: 'Security', checklist: `
- Every /api route (worker/index.ts, worker/routes/*): session required unless intentionally public, role check, and
  ownership / visibility (visible() for activities, pollVisible() for date polls) on reads AND writes, including the
  message edit/delete routes and anything returned inside another object.
- The API smoke test's access matrix (scripts/smoke.ts) covers every route that touches private data; name any route
  it doesn't cover.
- Notifications (worker/push.ts) never reach people who can't see the thing, and never carry its content to them.
- Input: every body validated with zod; size limits; SQL only with bound parameters (interpolated fragments constant).
- CSRF (sameOrigin), cookies, sessions, rate limits, invite-only sign-up, single-use hashed link tokens.
- Data exposure: emails, roles, phone numbers and other fields in API responses only to who should see them.
- Headers and transport: CSP and security headers (public/_headers, www/), HTTPS only, the signed calendar feed.
- Secrets: none in the repo or built assets; least-privilege tokens; documented in SETUP.md by name only.` },
  { key: 'infra', title: 'Infrastructure and operations', checklist: `
- wrangler.jsonc and www/wrangler.jsonc: bindings, compatibility date/flags, routes, cron, queue retries, observability.
- Migrations (migrations/*.sql): forward-only, safe while the previous code is still running (they apply before the
  deploy), no table rebuilds (D1 enforces foreign keys), triggers and cascades correct, indexes for the queries used.
- .github/workflows: job order (checks, Android, migrations, deploy), concurrency, least-privilege permissions,
  pinned actions, secrets used, what happens when a step fails.
- The risks and gaps listed in ARCHITECTURE.md (no staging, alerting, off-platform backups): still accurate? anything new?
- Android build (android/): signing, versioning, cleartext disabled, update flow.
- Free-tier limits: CPU per request, queue batch sizes, KV write limits, D1 limits.` },
  { key: 'ux', title: 'UX consistency', checklist: `
- The same action looks and reads the same everywhere (buttons, tiles, panel headers, kickers, links, icons).
- Wording: plain, consistent names (Public/Private, In/Maybe/Out, Date poll, Messages), no jargon for members.
- Phone first: nothing wider than the screen, touch targets at least 44 px, a collapsed activity fits 390 × 760.
- Dark mode, empty, loading and error states on every page.
- Accessibility: real buttons and links, labels on inputs and icon buttons, contrast.
Screenshots from the browser smoke test are in the screenshots folder given below: look at them (Read the PNGs).` },
]

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['critical', 'major', 'minor', 'nit'] },
          title: { type: 'string' },
          file: { type: 'string', description: 'repo-relative path, or a component name' },
          line: { type: 'integer' },
          evidence: { type: 'string', description: 'what you saw, quoted or cited' },
          impact: { type: 'string' },
          fix: { type: 'string', description: 'the simplest concrete fix' },
        },
        required: ['severity', 'title', 'file', 'evidence', 'impact', 'fix'],
      },
    },
    solid: { type: 'array', items: { type: 'string' }, description: 'things checked and found right, one line each' },
    notCovered: { type: 'array', items: { type: 'string' }, description: 'checklist items you could not check, and why' },
  },
  required: ['findings', 'solid', 'notCovered'],
}

const VERDICT = {
  type: 'object',
  properties: {
    real: { type: 'boolean' },
    severity: { type: 'string', enum: ['critical', 'major', 'minor', 'nit'] },
    fixIsSimplest: { type: 'boolean' },
    betterFix: { type: 'string' },
    reason: { type: 'string' },
  },
  required: ['real', 'severity', 'fixIsSimplest', 'reason'],
}

const reviewPrompt = (a) => `You are the "${a.title}" reviewer in an audit of the BBT app (this repository).
Scope: ${SCOPE}. Read-only: never edit files, commit, push or call external systems; read-only shell commands only.

${STANDARD}

Results of the automated gates (already run; don't re-run them, cite them when relevant):
${A.gates || '(not provided)'}
Browser screenshots folder: ${A.shots || '(none)'}

Check, with evidence from the actual files:
${a.checklist}

Report at most ${MAX_PER_AREA} findings, most severe first; merge near-duplicates. Severity: critical (data leak,
data loss, broken core flow), major (wrong behaviour or a doc that misleads), minor (inconsistency, dead code, small
bug), nit (polish). Do not report style preferences or anything you couldn't confirm in the code. Also list what you
checked and found solid, and any checklist item you couldn't check.`

const verifyPrompt = (a, f) => `Act as a skeptic. Another reviewer (area: ${a.title}) claims this about the BBT repository:

[${f.severity}] ${f.title}
Where: ${f.file}${f.line ? `:${f.line}` : ''}
Evidence: ${f.evidence}
Impact: ${f.impact}
Proposed fix: ${f.fix}

Try to REFUTE it by reading the code and docs yourself (read-only). It's real only if you can confirm it; if you're
unsure, it's not real. If real, set the severity you'd give it, say whether the proposed fix is the simplest one that
fully fixes it, and if not give the simpler fix.`

phase('Review')
const reviewed = await pipeline(
  AREAS,
  (a) => agent(reviewPrompt(a), { label: `review:${a.key}`, phase: 'Review', schema: FINDINGS }),
  (r, a) => {
    if (!r) return { area: a, findings: [], solid: [], notCovered: ['the reviewer did not finish'] }
    if (r.findings.length > MAX_PER_AREA) log(`${a.title}: kept the first ${MAX_PER_AREA} of ${r.findings.length} findings`)
    return parallel(r.findings.slice(0, MAX_PER_AREA).map((f) => () =>
      agent(verifyPrompt(a, f), { label: `verify:${a.key}`, phase: 'Verify', schema: VERDICT, effort: 'high' })
        .then((v) => ({ ...f, verdict: v })),
    )).then((checked) => ({ area: a, findings: checked.filter(Boolean), solid: r.solid, notCovered: r.notCovered }))
  },
)

const areas = reviewed.filter(Boolean)
const confirmed = areas.flatMap((x) => x.findings
  .filter((f) => f.verdict && f.verdict.real)
  .map((f) => ({
    area: x.area.title,
    severity: f.verdict.severity,
    title: f.title,
    where: f.file + (f.line ? `:${f.line}` : ''),
    impact: f.impact,
    fix: f.verdict.fixIsSimplest ? f.fix : (f.verdict.betterFix || f.fix),
    why: f.verdict.reason,
  })))
const refuted = areas.reduce((n, x) => n + x.findings.filter((f) => !f.verdict || !f.verdict.real).length, 0)
log(`${confirmed.length} findings confirmed, ${refuted} refuted`)

phase('Report')
const report = await agent(`Write the audit report for the BBT app owner (a CTO): Markdown, TL;DR first, direct, no filler.

Scope: ${SCOPE}.
Automated gates:
${A.gates || '(not provided)'}

Confirmed findings (each survived a skeptic; JSON):
${JSON.stringify(confirmed, null, 1)}

Found solid, per area (JSON): ${JSON.stringify(areas.map((x) => ({ area: x.area.title, solid: x.solid })))}
Not covered, per area (JSON): ${JSON.stringify(areas.map((x) => ({ area: x.area.title, notCovered: x.notCovered })))}
Refuted by skeptics: ${refuted} (not listed).

Structure:
1. TL;DR: overall verdict in 2–3 lines; counts by severity; any failing gate.
2. Gates: the table, failures first.
3. Findings: merge duplicates across areas; group by severity (critical, major, minor, nit); number them; each with
   area, file:line, impact, and the fix. Keep each to 2–4 lines.
4. Solid: one short list of what was checked and is right.
5. Not covered: what this audit could not check (completeness), and how to check it.
6. Suggested next step: which findings to fix first, as one PR or several.
Only use facts from the inputs; don't invent findings.`, { label: 'report', phase: 'Report' })

return { report, confirmed: confirmed.length, refuted }
