#!/usr/bin/env bash
# The audit's automated gates (.claude/skills/audit/SKILL.md, step 2): facts before opinions.
# Usage: .claude/skills/audit/gates.sh <out-dir>
# Writes <out-dir>/gates.md (one line per gate: PASS / FAIL / SKIP and a short reason), each gate's full output in
# <out-dir>/<gate>.log, and the browser smoke test's screenshots in <out-dir>/shots/. Never changes the repo; starts the
# local dev server only if it isn't running, and stops it again afterwards.
set -u
OUT="${1:?usage: gates.sh <out-dir>}"
mkdir -p "$OUT/shots"
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT" || exit 1
SUMMARY="$OUT/gates.md"
echo "| Gate | Result | Detail |" > "$SUMMARY"
echo "| --- | --- | --- |" >> "$SUMMARY"

row() { echo "| $1 | $2 | $3 |" >> "$SUMMARY"; }
# gate <name> <command…>: runs it, logs everything, records PASS/FAIL with the log's last line.
gate() {
  local name="$1"; shift
  if "$@" > "$OUT/$name.log" 2>&1; then
    row "$name" PASS "$(grep -v '^\s*$' "$OUT/$name.log" | tail -1 | cut -c1-140 | tr '|' '/')"
  else
    row "$name" FAIL "$(grep -iE 'fail|error|×' "$OUT/$name.log" | head -3 | cut -c1-140 | tr '|' '/' | paste -sd ' ' -)"
  fi
}

gate lint npm run -s lint
gate typecheck npx tsc -b
gate unit-tests npm test -s

# Every migration, in order, on a fresh database (catches a migration that only works on top of local data).
FRESH="$(mktemp -d)"
gate migrations-fresh-db npx wrangler d1 migrations apply DB --local --persist-to "$FRESH"
rm -rf "$FRESH"

# Secrets: nothing that looks like a key or token in tracked files (a PEM header counts only with key data after it).
if git ls-files -z | xargs -0 grep -nIE \
  '(-----BEGIN [A-Z ]*PRIVATE KEY-----(\\n|\s)*[A-Za-z0-9+/=]{40,}|AIza[0-9A-Za-z_-]{35}|ghp_[0-9A-Za-z]{36}|sk-[0-9A-Za-z]{32,}|"private_key"\s*:|xox[baprs]-[0-9A-Za-z-]{10,})' \
  > "$OUT/secrets.log" 2>&1; then
  row secrets FAIL "possible secret in a tracked file: $(head -1 "$OUT/secrets.log" | cut -d: -f1,2)"
else
  row secrets PASS "no key or token patterns in tracked files"
fi

# GitHub Actions: third-party actions pinned to a full commit SHA, and every workflow declares its permissions.
grep -nE '^\s*-?\s*uses:\s*[^.][^@]*@' .github/workflows/*.yml | grep -vE '@[0-9a-f]{40}' > "$OUT/actions.log"
if [ -s "$OUT/actions.log" ]; then
  row actions-pinned FAIL "not pinned to a SHA: $(head -1 "$OUT/actions.log" | cut -c1-100)"
else
  row actions-pinned PASS "every action pinned to a commit SHA"
fi
for f in .github/workflows/*.yml; do
  grep -q '^permissions:' "$f" || row actions-permissions FAIL "no top-level permissions in $f"
done

gate npm-audit npm audit --omit=dev --audit-level=high

# Mermaid diagrams in the docs render. Needs mermaid.min.js: set MERMAID_JS to it (mermaid isn't a repo dependency).
MERMAID_JS="${MERMAID_JS:-$ROOT/node_modules/mermaid/dist/mermaid.min.js}"
if [ -f "$MERMAID_JS" ]; then
  gate mermaid node "$ROOT/.claude/skills/audit/mermaid-check.mjs" "$MERMAID_JS"
else
  row mermaid SKIP "MERMAID_JS not found; see SKILL.md"
fi

# End-to-end suites against the local Worker (local D1 migrated first).
STARTED=""
if ! curl -s -o /dev/null http://localhost:8787/api/health; then
  (npm run dev > "$OUT/dev-server.log" 2>&1 &)
  STARTED=1
  for _ in $(seq 1 60); do curl -s -o /dev/null http://localhost:8787/api/health && break; sleep 1; done
fi
if curl -s -o /dev/null http://localhost:8787/api/health; then
  npm run -s db:migrate:local > "$OUT/migrate-local.log" 2>&1
  gate api-smoke npm run -s smoke
  gate browser-smoke npm run -s ui-smoke -- "$OUT/shots"
else
  row api-smoke SKIP "the local dev server didn't start (see dev-server.log)"
  row browser-smoke SKIP "the local dev server didn't start"
fi
if [ -n "$STARTED" ]; then
  for p in $(pgrep -x node); do tr '\0' ' ' < "/proc/$p/cmdline" 2>/dev/null | grep -q vite && kill "$p"; done
fi

cat "$SUMMARY"
