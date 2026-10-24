# magora-portal Repo Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give magora-portal a PR flow where required GitHub Actions checks block bad merges, proven to fail on their target defects before branch protection is armed and proven to enforce after.

**Architecture:** Two PRs plus approved settings writes. PR A adds the CI foundation (ESLint fix, lint ratchet, test runner, migration check, `ci.yml`), all as Node scripts so they run identically on macOS, Windows and Ubuntu. Repo settings and labels are written and read back. PR B adds label-gate, advisory security workflows, review config and contributor files. A throwaway proof PR then shows each required check going red on its defect, protection is armed with exactly those contexts, and one post-arm example per mechanism shows it enforcing.

**Tech Stack:** Node 24 (ESM `.mjs`, no dependencies beyond the repo's), ESLint 10 flat config, GitHub Actions, Deno 2.9.5, `gh` CLI, Vercel CLI (read-only).

**Spec:** `docs/superpowers/specs/2026-10-15-repo-harness-design.md` (rev 7). Read it before any task. Section numbers below (§N) are the spec's.

## Global Constraints

- **Every push, settings write, label creation, app install and protection change waits for David's explicit approval in the session**, one approval per action. Approval for one does not carry to the next (spec §6).
- PR-triggered workflows use `pull_request` only, never `pull_request_target`. The only other trigger is OSV's weekly `schedule`. No `push` triggers (§2).
- Every Action is pinned by full commit SHA with the tag in a comment. Pins for this plan (resolved 2026-10-15): `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1`, `actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0`, `denoland/setup-deno@22d081ff2d3a40755e97629de92e3bcbfa7cf2ed # v2.0.5`, `actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1`. Container images by digest.
- `permissions:` is least-privilege per workflow; no `secrets.*` anywhere except Gemini's key (Task 14, conditional).
- Every `ci.yml` check is an npm script implemented in Node; no bash in a required check (§5.1).
- No path filters and no job-level `if:` on any required workflow (§5.1, §7).
- Node version: `.nvmrc` = `24` (Vercel runs `24.x`, §3.1). Deno: `v2.9.5`.
- Depth labels, exact spelling: `mechanical`, `standard`, `subtle-correctness` (§5.3).
- Required contexts are exactly the eight in §5.7, named as observed at V0, bound to the GitHub Actions app. Advisory workflows are never required.
- Merge method: squash only (D-3). Zero required approvals, `enforce_admins: true` (D-7, §5.7).
- No maintainer authorizes a fork-PR Vercel deployment (§2.2).
- Scratch files on a maintainer's machine go in a `mktemp` path, never a fixed `/tmp/<name>` (concurrent sessions share `/tmp` there). Inside a GitHub-hosted workflow job, `/tmp` belongs to that one job's VM, so fixed paths copied from method-project's workflows (Task 14) are acceptable.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`; PR bodies end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

## Review Focus

Inputs the spec implies that no proof-matrix row exercises, most likely to bite first. Each line names the task whose test pins it.

1. **A maintainer's agent worktree under `.claude/worktrees/` inside the checkout.** ESLint and the test runner would walk a second copy of the repo, doubling lint counts (ratchet fails locally for no reason) and running every test twice. Expected: both ignore `.claude/`. Pinned in Task 2 (ESLint ignore in Step 4, planted-probe proof in Step 7) and Task 3 (runner self-test case).
2. **Windows checkout with `core.autocrlf=true` (Noah's default, and the Windows runner's).** Files arrive with CRLF. Expected: lint counts and every harness behave the same as on Ubuntu. Pinned by the `windows-latest` legs of `lint` and `test` in Task 6, and by the CRLF case in the grandfather-list parser test (Task 5).
3. **An ESLint failure that is not a lint finding** (bad config, crash, parse error). Expected: the ratchet goes red, never green-by-zero-counts. Pinned in Task 4's self-test (each fail-closed case) and executed against a broken config in Task 4 Step 6.
4. **A label added and removed in quick succession, or two pushes close together.** Expected: the head's latest label-gate result reflects the labels present when it ran. Pinned in Task 16 Step 6.
5. **A Dependabot PR that bumps ESLint or a plugin and adds new rule findings in untouched files.** Expected: it arrives as its own PR (excluded from the grouped bump) so a ratchet failure is attributable. Pinned in Task 10's `dependabot.yml` group exclusion; observed in Task 17.

---

## File map

| File | Task | Responsibility |
|---|---|---|
| `.nvmrc` | 2 | Node major for CI and maintainers |
| `eslint.config.js` (modify) | 2 | Node globals for `api/`, `scripts/`, `*.mjs`; lint `.mjs`; ignore `.claude` |
| 17 files under `api/` and `scripts/` (modify) | 2 | Delete the line-1 `/* global … */` comment |
| `scripts/run-tests.mjs`, `scripts/run-tests.test.mjs` | 3 | `npm test` runner and its self-test |
| `scripts/ci/lint-ratchet.mjs`, `scripts/ci/lint-ratchet.test.mjs`, `.github/lint-baseline.json` | 4 | Per-rule lint ratchet |
| `scripts/ci/check-migrations.mjs`, `scripts/ci/check-migrations.test.mjs`, `scripts/ci/migrations-grandfathered.txt` | 5 | Migration rollback rule |
| `package.json` (modify) | 3–6 | npm scripts `test`, `lint:ratchet`, `check:migrations`, `check:deno` |
| `.github/workflows/ci.yml` | 6 | The seven required CI contexts |
| `scripts/ci/label-gate.mjs`, `scripts/ci/label-gate.test.mjs`, `.github/workflows/label-gate.yml` | 9 | Exactly-one-depth-label check |
| `.github/workflows/semgrep.yml`, `.github/workflows/osv-scan.yml`, `osv-scanner.toml`, `.github/dependabot.yml` | 10 | Advisory security, dependency updates |
| `.coderabbit.yaml`, `.github/pull_request_template.md` | 11 | Review configuration |
| `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `SECURITY.md` | 12 | Shared agent and contributor instructions |
| `.github/workflows/doc-size-ratchet.yml`, `scripts/doc-size-ratchet.py`, `doc-size.conf` | 13 | Advisory prose-size ratchet |
| `.github/workflows/gemini-review.yml`, `scripts/review/gemini_review.py` | 14 | Conditional: only if §8.3 is decided |

---

## Phase 0 — Before PR A

### Task 1: Prerequisites (human-only steps and the open pre-flight items)

**Files:** none in the repo. Record results in the PR A description.

**Interfaces:**
- Consumes: spec §3.1 unresolved rows, §6 step 2.
- Produces: confirmation that both maintainers can merge; CodeRabbit and the Codex App installed; the Supabase CLI layout check executed; a decision on §8.3 (Gemini key) or a recorded deferral.

- [ ] **Step 1: Ask David to have the org owner do the human-only steps.** Install CodeRabbit and the Codex GitHub App on `magora-project`, scoped to `magora-portal`. Ask whether §8.3 (who creates and pays for the Magora Gemini key) is decided. If not, record "Gemini deferred (§5.3)"; Task 14 is then skipped.

- [ ] **Step 2: Confirm Noah's access.** Noah runs, on his machine:

```bash
gh api repos/magora-project/magora-portal --jq .permissions
```

Expected: `"push": true` (and `"admin": true` if he is to change settings). Record the output. If Noah lacks push, stop: the trunk flow needs both maintainers able to merge.

- [ ] **Step 3: Read installed apps once they are installed.** The org owner runs `gh api orgs/magora-project/installations --jq '.installations[] | {app_slug, repository_selection}'` (needs `admin:org`) and shares the output. Expected: `coderabbitai` and the Codex app present. In the same session the org owner reads both maintainers' org roles: `gh api orgs/magora-project/memberships/bluemtnswalking1 --jq .role` and the same for Noah's login. Record both roles, or record "not readable" with the reason (§6 step 1).

- [ ] **Step 4: Execute the Supabase CLI layout check (§5.5 says this runs before PR A merges).** Needs Docker running.

```bash
S=$(mktemp -d -t supa-layout.XXXXXX) && cd "$S" && supabase --version && supabase init
mkdir -p supabase/migrations/rollbacks
printf 'create table harness_probe (id int);\n' > supabase/migrations/20260101000000_probe.sql
printf 'select 1/0;\n' > supabase/migrations/rollbacks/20260101000000_probe.rollback.sql
supabase db start
supabase migration up --local 2>&1 | tee migrate.log
supabase migration list --local 2>&1 | tee list.log
supabase stop --no-backup
```

Expected: `supabase --version` prints `2.118.0` (or record the actual version), `migration up` applies `20260101000000_probe.sql` with no division-by-zero error (the rollback was not executed), and `list.log` shows exactly one local migration. If the rollback file is applied or listed, stop and tell David: §5.5 must move rollbacks to `supabase/rollbacks/` before PR A.

- [ ] **Step 5: Record.** Paste the outputs of Steps 2–4 into a scratch note for the PR A description.

---

## Phase 1 — PR A: CI foundation

All PR A work happens in one worktree on branch `harness/ci-foundation`, created from `docs/repo-harness-spec`, so the spec and this plan travel in PR A.

### Task 2: Node version and ESLint configuration (D-5)

**Files:**
- Create: `.nvmrc`
- Modify: `eslint.config.js`
- Modify (delete line 1 of each): `api/_node_status/db.js`, `api/_node_status/notify.js`, `api/_pulse/db.js`, `api/_pulse/notify.js`, `api/_report/db.js`, `api/_report/narrate-report.js`, `api/insight-batch.js`, `api/insight.js`, `api/node-status-check.js`, `api/og-report.js`, `api/pulse-batch.js`, `api/range-allowlist-build.js`, `api/report-cron.js`, `api/report-page.js`, `scripts/backfill_ebird_taxonomy.mjs`, `scripts/backfill-null-species-codes.mjs`, `scripts/range-backfill.mjs`

**Interfaces:**
- Produces: a lint configuration whose finding counts are exactly 13 (§3.1), used by Task 4 to record the baseline.

- [ ] **Step 1: Create the worktree.**

```bash
cd /Users/david/magora-portal
git fetch origin
git status --short   # expect clean
git worktree add .claude/worktrees/harness-ci -b harness/ci-foundation docs/repo-harness-spec
cd .claude/worktrees/harness-ci
git log --oneline -3   # expect the spec/plan commits on top of origin/main
npm ci
```

Every path written from here on contains `.claude/worktrees/harness-ci/`.

- [ ] **Step 2: Confirm the starting lint state.** Run:

```bash
npx eslint . 2>&1 | tail -3
```

Expected: `✖ 29 problems (29 errors, 0 warnings)` (§3). If the count differs, `origin/main` has moved since 2026-10-15: stop and re-measure before going on.

- [ ] **Step 3: Write `.nvmrc`.**

```
24
```

- [ ] **Step 4: Replace `eslint.config.js`.**

```js
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // `.vercel/output` is generated by `vercel build` (the reliable way to inspect production
  // routing order — see the SPA-fallback fix). It contains the minified bundle, so linting it
  // yields hundreds of phantom errors the moment anyone runs that command locally.
  // `.claude` holds agent worktrees: whole second checkouts that would double every count.
  globalIgnores(['dist', '.vercel', '.claude']),
  {
    files: ['**/*.{js,jsx,mjs}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  // Node code: Vercel functions under api/, scripts, and every .mjs (tests and tooling).
  {
    files: ['api/**/*.{js,mjs}', 'scripts/**/*.{js,mjs}', '**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
])
```

- [ ] **Step 5: Delete the 17 `/* global … */` comments.** Each is line 1 of its file. Check before deleting:

```bash
for f in api/_node_status/db.js api/_node_status/notify.js api/_pulse/db.js api/_pulse/notify.js api/_report/db.js api/_report/narrate-report.js api/insight-batch.js api/insight.js api/node-status-check.js api/og-report.js api/pulse-batch.js api/range-allowlist-build.js api/report-cron.js api/report-page.js scripts/backfill_ebird_taxonomy.mjs scripts/backfill-null-species-codes.mjs scripts/range-backfill.mjs; do
  head -1 "$f" | grep -qE '^/\* global process(, fetch)? \*/$' || { echo "UNEXPECTED line 1: $f"; break; }
done
```

Expected: no output. Then delete line 1 of each with the Edit tool (17 edits), or `sed -i '' '1d'` on macOS / `sed -i '1d'` on Linux for the same list.

- [ ] **Step 6: Verify the new state.**

```bash
grep -rlE '/\* *global ' api scripts   # expect no output
npx eslint . -f json | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const c={};let fatal=0
for(const f of JSON.parse(s))for(const m of f.messages){if(m.fatal||!m.ruleId){fatal++;continue}c[m.ruleId]=(c[m.ruleId]||0)+1}
console.log(JSON.stringify(c),"fatal="+fatal)})'
```

Expected exactly: `{"no-unused-vars":1,"react-refresh/only-export-components":2,"react-hooks/static-components":7,"react-hooks/set-state-in-effect":3} fatal=0` (key order may differ). No `no-undef`, no `no-redeclare`.

- [ ] **Step 7: Verify the `.claude` ignore with a planted file (Review Focus 1).** `.claude/` is gitignored, so a probe there is never committed. Paths are compared relative to the lint root (the worktree itself sits under the main checkout's `.claude/`, so absolute paths always contain that segment):

```bash
mkdir -p .claude/lint-probe && echo 'harnessUndefinedProbe()' > .claude/lint-probe/probe.js
npx eslint . -f json | node -e 'const path=require("path");let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).filter(f=>path.relative(process.cwd(),f.filePath).split(path.sep)[0]===".claude").length))'
rm -r .claude/lint-probe
```

Expected: `0`. Then remove `'.claude'` from `globalIgnores` temporarily, re-plant the probe and re-run the first two lines: expect `1`, proving the probe would otherwise be linted. Restore the config and delete the probe; `git diff eslint.config.js` must show only Step 4's change.

- [ ] **Step 8: Commit.**

```bash
git add .nvmrc eslint.config.js api/_node_status/db.js api/_node_status/notify.js api/_pulse/db.js api/_pulse/notify.js api/_report/db.js api/_report/narrate-report.js api/insight-batch.js api/insight.js api/node-status-check.js api/og-report.js api/pulse-batch.js api/range-allowlist-build.js api/report-cron.js api/report-page.js scripts/backfill_ebird_taxonomy.mjs scripts/backfill-null-species-codes.mjs scripts/range-backfill.mjs
git diff --cached --stat   # expect 19 files
git commit -m "chore(lint): Node globals for api/scripts/.mjs, lint .mjs, ignore .claude

Drops the 17 now-redundant /* global */ comments. Lint goes from 29 findings to
13 (12 in src/, 1 in api/seed-guilds.js); no no-undef or no-redeclare remain.
Spec §5.1 (D-5).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
git log -1 --stat | tail -3
```

### Task 3: Test runner (`npm test`)

**Files:**
- Create: `scripts/run-tests.mjs`
- Test: `scripts/run-tests.test.mjs`
- Modify: `package.json` (add `"test"` script)

**Interfaces:**
- Produces: `findTests(root: string): string[]` (sorted, `/`-separated paths relative to `root`); `runTests(files: string[], { root, nodePath?, stdio? }): { ok: boolean, failures: string[] }`; `SKIP_DIRS: Set<string>`. CLI: `node scripts/run-tests.mjs [--root <dir>]`, exit 0 when all pass, 1 otherwise.

- [ ] **Step 1: Write the failing self-test** at `scripts/run-tests.test.mjs`:

```js
// Self-test for scripts/run-tests.mjs: the runner must fail on a failing test, on a child that
// cannot launch, and on finding zero tests. Fixtures live in a temp dir, never in the repo.
// Run: node scripts/run-tests.test.mjs
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findTests, runTests } from './run-tests.mjs'

let pass = 0, fail = 0
const ok = (n, c) => { if (c) { pass++ } else { fail++; console.log('  FAIL', n) } }

const RUNNER = fileURLToPath(new URL('./run-tests.mjs', import.meta.url))
const tmp = mkdtempSync(join(tmpdir(), 'run-tests-selftest-'))
const write = (rel, body) => {
  const p = join(tmp, rel)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, body)
}

try {
  write('good/a.test.mjs', 'process.exit(0)\n')
  write('good/nested/b.test.mjs', 'process.exit(0)\n')
  write('good/node_modules/pkg/c.test.mjs', 'process.exit(1)\n')
  write('good/.claude/worktrees/x/d.test.mjs', 'process.exit(1)\n')
  write('good/not-a-test.mjs', 'process.exit(1)\n')
  write('bad/a.test.mjs', 'process.exit(0)\n')
  write('bad/b.test.mjs', 'process.exit(3)\n')
  mkdirSync(join(tmp, 'empty'))

  const good = join(tmp, 'good')
  ok('finds nested tests, skips node_modules and .claude, sorted',
    JSON.stringify(findTests(good)) === JSON.stringify(['a.test.mjs', 'nested/b.test.mjs']))

  const allPass = runTests(findTests(good), { root: good, stdio: 'ignore' })
  ok('all passing -> ok', allPass.ok === true)

  const bad = join(tmp, 'bad')
  const oneFails = runTests(findTests(bad), { root: bad, stdio: 'ignore' })
  ok('one failing -> not ok', oneFails.ok === false)
  ok('failure names the file and exit code', oneFails.failures.some((f) => f.includes('b.test.mjs') && f.includes('exited 3')))

  const none = runTests(findTests(join(tmp, 'empty')), { root: join(tmp, 'empty'), stdio: 'ignore' })
  ok('zero tests -> not ok', none.ok === false && /no \*\.test\.mjs/.test(none.failures[0]))

  const noLaunch = runTests(['a.test.mjs'], { root: good, nodePath: join(tmp, 'no-such-node'), stdio: 'ignore' })
  ok('launch failure -> not ok', noLaunch.ok === false && /failed to launch/.test(noLaunch.failures[0]))

  const cliEmpty = spawnSync(process.execPath, [RUNNER, '--root', join(tmp, 'empty')], { stdio: 'ignore' })
  ok('CLI exits non-zero on zero tests', cliEmpty.status === 1)
  const cliBad = spawnSync(process.execPath, [RUNNER, '--root', bad], { stdio: 'ignore' })
  ok('CLI exits non-zero on a failing test', cliBad.status === 1)
  const cliGood = spawnSync(process.execPath, [RUNNER, '--root', good], { stdio: 'ignore' })
  ok('CLI exits zero when all pass', cliGood.status === 0)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
```

- [ ] **Step 2: Run it and watch it fail.**

Run: `node scripts/run-tests.test.mjs`
Expected: non-zero exit with `ERR_MODULE_NOT_FOUND` for `./run-tests.mjs`.

- [ ] **Step 3: Write `scripts/run-tests.mjs`.**

```js
// Test runner for `npm test` (repo harness spec §5.1). Finds every *.test.mjs outside the skipped
// directories and runs each with this Node as a child process. Fails if any test exits non-zero, if
// any child fails to launch, or if it finds no tests at all, so it cannot pass vacuously.
// Run: node scripts/run-tests.mjs [--root <dir>]
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

// `.claude` holds agent worktrees, which are whole extra checkouts of this repo.
export const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.vercel', '.claude'])

export function findTests(root) {
  const found = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name))
      } else if (entry.isFile() && entry.name.endsWith('.test.mjs')) {
        found.push(relative(root, join(dir, entry.name)).split(sep).join('/'))
      }
    }
  }
  walk(root)
  return found.sort()
}

export function runTests(files, { root, nodePath = process.execPath, stdio = 'inherit' } = {}) {
  if (files.length === 0) return { ok: false, failures: ['no *.test.mjs files found'] }
  const failures = []
  for (const file of files) {
    console.log(`\n▶ ${file}`)
    const r = spawnSync(nodePath, [join(root, file)], { cwd: root, stdio })
    if (r.error) failures.push(`${file}: failed to launch (${r.error.code ?? r.error.message})`)
    else if (r.status !== 0) failures.push(`${file}: exited ${r.status ?? r.signal}`)
  }
  return { ok: failures.length === 0, failures }
}

function main(argv) {
  const i = argv.indexOf('--root')
  const root = resolve(i >= 0 ? argv[i + 1] : '.')
  const files = findTests(root)
  const { ok, failures } = runTests(files, { root })
  if (ok) {
    console.log(`\nrun-tests: ${files.length} test file(s) passed`)
    return 0
  }
  console.error(`\nrun-tests: FAIL\n  ${failures.join('\n  ')}`)
  return 1
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)))
```

- [ ] **Step 4: Run the self-test.**

Run: `node scripts/run-tests.test.mjs`
Expected: last line `9 passed, 0 failed`, exit 0.

- [ ] **Step 5: Prove the self-test can fail (mutation).** Temporarily change `if (files.length === 0) return { ok: false, …}` to `return { ok: true, failures: [] }` for the zero case. The assertion that should flip is `zero tests -> not ok` (and `CLI exits non-zero on zero tests`). Run `node scripts/run-tests.test.mjs`; expect exit 1 naming those two. Restore the line and re-run; expect `9 passed, 0 failed`.

- [ ] **Step 6: Add the npm script.** In `package.json` `"scripts"`, add `"test": "node scripts/run-tests.mjs",` after `"lint"`.

- [ ] **Step 7: Run it on the repo.**

Run: `npm test 2>&1 | tail -3`
Expected: `run-tests: 7 test file(s) passed` (the six `api/**/*.test.mjs` plus the runner's self-test), exit 0.

- [ ] **Step 8: Commit.**

```bash
git add scripts/run-tests.mjs scripts/run-tests.test.mjs package.json
git diff --cached --stat
git commit -m "feat(ci): npm test runner that fails on zero tests and launch errors

Runs every *.test.mjs outside node_modules/.git/dist/.vercel/.claude as a child
process; self-tested for its three failure modes. Spec §5.1.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 4: Lint ratchet

**Files:**
- Create: `scripts/ci/lint-ratchet.mjs`, `.github/lint-baseline.json`
- Test: `scripts/ci/lint-ratchet.test.mjs`
- Modify: `package.json` (add `"lint:ratchet"`)

**Interfaces:**
- Consumes: Task 2's lint state (13 findings).
- Produces: `evaluate({ spawnError?, status, stdout, stderr?, baselineText }): { ok: boolean, lines: string[], counts?: object }`; `parseBaseline(text)`; `countByRule(results)`; `BASELINE_PATH = '.github/lint-baseline.json'`. CLI: `node scripts/ci/lint-ratchet.mjs` (judge) and `--counts` (print current counts as baseline JSON).

- [ ] **Step 1: Write the failing self-test** at `scripts/ci/lint-ratchet.test.mjs`:

```js
// Self-test for scripts/ci/lint-ratchet.mjs: each fail-closed case, a rise, a fall, and an equal run.
// Pure: feeds evaluate() what the CLI would observe; never runs ESLint.
// Run: node scripts/ci/lint-ratchet.test.mjs
import { evaluate } from './lint-ratchet.mjs'

let pass = 0, fail = 0
const ok = (n, c) => { if (c) { pass++ } else { fail++; console.log('  FAIL', n) } }

const msg = (ruleId, extra = {}) => ({ ruleId, line: 1, message: 'm', severity: 2, ...extra })
const out = (...messages) => JSON.stringify([{ filePath: 'src/a.jsx', messages }])
const base = JSON.stringify({ 'no-unused-vars': 2, 'react-hooks/static-components': 1 })
const run = (o) => evaluate({ status: 1, stdout: out(msg('no-unused-vars'), msg('no-unused-vars')), stderr: '', baselineText: base, ...o })
const couldNotJudge = (v) => v.ok === false && /could not judge/.test(v.lines[0])

// passing and failing directions
ok('equal to baseline -> ok', run({}).ok === true)
ok('exit 0 with no findings -> ok', run({ status: 0, stdout: '[]' }).ok === true)
const fell = run({ stdout: out(msg('no-unused-vars')) })
ok('a fall -> ok', fell.ok === true)
ok('a fall prints a lower-the-baseline reminder', fell.lines.some((l) => /fell\s+no-unused-vars: 2 -> 1/.test(l)))
const rose = run({ stdout: out(msg('no-unused-vars'), msg('no-unused-vars'), msg('no-unused-vars')) })
ok('a rise -> FAIL', rose.ok === false && rose.lines.some((l) => /ROSE\s+no-unused-vars: 2 -> 3/.test(l)))
ok('a rule absent from the baseline counts as 0', run({ stdout: out(msg('no-unused-vars'), msg('no-unused-vars'), msg('eqeqeq')) }).ok === false)
ok('per rule: a fall in one rule does not pay for a rise in another',
  run({ stdout: out(msg('no-unused-vars'), msg('react-hooks/static-components'), msg('react-hooks/static-components')) }).ok === false)

// fail-closed cases
ok('ESLint failed to start -> FAIL', couldNotJudge(run({ spawnError: new Error('ENOENT') })))
ok('ESLint exit 2 (config error) -> FAIL', couldNotJudge(run({ status: 2, stdout: '' })))
ok('ESLint killed (status null) -> FAIL', couldNotJudge(run({ status: null })))
ok('output not JSON -> FAIL', couldNotJudge(run({ stdout: 'Oops! Something went wrong' })))
ok('output JSON but not an array -> FAIL', couldNotJudge(run({ stdout: '{}' })))
ok('result entry without messages -> FAIL', couldNotJudge(run({ stdout: '[{}]' })))
ok('result entry with null messages -> FAIL', couldNotJudge(run({ stdout: '[{"filePath":"x","messages":null}]' })))
ok('null result entry -> FAIL', couldNotJudge(run({ stdout: '[null]' })))
ok('fatal parse error -> FAIL', couldNotJudge(run({ stdout: out(msg(null, { fatal: true })) })))
ok('rule-less diagnostic -> FAIL', couldNotJudge(run({ stdout: out(msg(null)) })))
ok('missing baseline -> FAIL', couldNotJudge(run({ baselineText: null })))
ok('baseline not JSON -> FAIL', couldNotJudge(run({ baselineText: '{' })))
ok('baseline an array -> FAIL', couldNotJudge(run({ baselineText: '[]' })))
ok('baseline negative count -> FAIL', couldNotJudge(run({ baselineText: '{"x": -1}' })))
ok('baseline non-integer count -> FAIL', couldNotJudge(run({ baselineText: '{"x": "3"}' })))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
```

- [ ] **Step 2: Run it and watch it fail.**

Run: `node scripts/ci/lint-ratchet.test.mjs`
Expected: non-zero exit, `ERR_MODULE_NOT_FOUND` for `./lint-ratchet.mjs`.

- [ ] **Step 3: Write `scripts/ci/lint-ratchet.mjs`.**

```js
// Lint ratchet (repo harness spec §5.1, D-5). Runs ESLint with JSON output and compares the count of
// findings per rule with .github/lint-baseline.json. A rule's count may fall but never rise. Fails
// closed on anything that is not a counted rule finding: ESLint not starting, a config/runtime exit,
// output that is not JSON, a fatal or rule-less diagnostic (parse error), or a bad baseline.
// Run: node scripts/ci/lint-ratchet.mjs            (judge against the baseline)
//      node scripts/ci/lint-ratchet.mjs --counts   (print current counts as baseline JSON)
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const BASELINE_PATH = '.github/lint-baseline.json'

export function parseBaseline(text) {
  let data
  try { data = JSON.parse(text) } catch { throw new Error(`${BASELINE_PATH} is not valid JSON`) }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`${BASELINE_PATH} must be a JSON object of rule -> count`)
  }
  for (const [rule, n] of Object.entries(data)) {
    if (!Number.isInteger(n) || n < 0) throw new Error(`${BASELINE_PATH}: count for ${rule} must be a non-negative integer`)
  }
  return data
}

export function countByRule(results) {
  if (!Array.isArray(results)) throw new Error('ESLint output is not a JSON array')
  const counts = {}
  const unattributed = []
  for (const file of results) {
    if (file === null || typeof file !== 'object' || !Array.isArray(file.messages)) {
      throw new Error('ESLint output has a result without a messages array')
    }
    for (const m of file.messages) {
      if (m.fatal || !m.ruleId) {
        unattributed.push(`${file.filePath}:${m.line ?? '?'} ${m.message}`)
        continue
      }
      counts[m.ruleId] = (counts[m.ruleId] ?? 0) + 1
    }
  }
  return { counts, unattributed }
}

// Everything the CLI observed goes in; a verdict comes out. ESLint exits 0 (no errors) or 1 (lint
// errors found) on a completed run; anything else is an execution failure.
export function evaluate({ spawnError, status, stdout, stderr, baselineText }) {
  const fault = (reason) => ({ ok: false, lines: [`lint-ratchet: FAIL (could not judge): ${reason}`] })
  if (spawnError) return fault(`ESLint failed to start: ${spawnError.message}`)
  if (status !== 0 && status !== 1) return fault(`ESLint exited ${status}${stderr ? `\n${stderr.trim()}` : ''}`)
  if (baselineText == null) return fault(`${BASELINE_PATH} is missing`)
  let baseline, results, counts, unattributed
  try { baseline = parseBaseline(baselineText) } catch (e) { return fault(e.message) }
  try { results = JSON.parse(stdout) } catch { return fault('ESLint output is not valid JSON') }
  try { ({ counts, unattributed } = countByRule(results)) } catch (e) { return fault(e.message) }
  if (unattributed.length) return fault(`fatal or rule-less diagnostics:\n  ${unattributed.join('\n  ')}`)

  const lines = []
  let rose = false
  for (const rule of [...new Set([...Object.keys(baseline), ...Object.keys(counts)])].sort()) {
    const was = baseline[rule] ?? 0
    const now = counts[rule] ?? 0
    if (now > was) { rose = true; lines.push(`  ROSE  ${rule}: ${was} -> ${now}`) }
    else if (now < was) lines.push(`  fell  ${rule}: ${was} -> ${now} (lower ${BASELINE_PATH} in this PR)`)
  }
  lines.unshift(rose ? 'lint-ratchet: FAIL, a rule\'s finding count rose' : 'lint-ratchet: ok')
  return { ok: !rose, lines, counts }
}

function runEslint() {
  try {
    const require = createRequire(import.meta.url)
    const bin = join(dirname(require.resolve('eslint/package.json')), 'bin', 'eslint.js')
    // Through this Node, not the npm shim, so Windows needs no shell.
    return spawnSync(process.execPath, [bin, '.', '--format', 'json'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  } catch (error) {
    return { error }
  }
}

function readBaseline() {
  try { return readFileSync(BASELINE_PATH, 'utf8') } catch (e) { if (e.code === 'ENOENT') return null; throw e }
}

function main(argv) {
  const r = runEslint()
  const printCounts = argv.includes('--counts')
  const verdict = evaluate({
    spawnError: r.error,
    status: r.status,
    stdout: r.stdout,
    stderr: r.stderr,
    baselineText: printCounts ? '{}' : readBaseline(),
  })
  if (printCounts) {
    if (!verdict.counts) { console.error(verdict.lines.join('\n')); return 1 }
    const sorted = Object.fromEntries(Object.entries(verdict.counts).sort(([a], [b]) => a.localeCompare(b)))
    console.log(JSON.stringify(sorted, null, 2))
    return 0
  }
  ;(verdict.ok ? console.log : console.error)(verdict.lines.join('\n'))
  return verdict.ok ? 0 : 1
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)))
```

- [ ] **Step 4: Run the self-test.**

Run: `node scripts/ci/lint-ratchet.test.mjs`
Expected: `22 passed, 0 failed`, exit 0.

- [ ] **Step 5: Record the baseline from a fresh run.**

```bash
mkdir -p .github
node scripts/ci/lint-ratchet.mjs --counts > .github/lint-baseline.json
cat .github/lint-baseline.json
```

Expected exactly:

```json
{
  "no-unused-vars": 1,
  "react-hooks/set-state-in-effect": 3,
  "react-hooks/static-components": 7,
  "react-refresh/only-export-components": 2
}
```

No `no-undef` and no `no-redeclare` key (§5.1). If the file differs, stop: a new script from Tasks 3–4 is adding findings, or `origin/main` moved.

- [ ] **Step 6: Execute the fail-closed and rise paths against real ESLint (Review Focus 3).** Use a `mktemp` backup and restore with `cp`, never `git checkout`:

```bash
B=$(mktemp -d -t ratchet.XXXXXX)
cp src/main.jsx "$B/main.jsx"; cp eslint.config.js "$B/eslint.config.js"
node scripts/ci/lint-ratchet.mjs; echo "clean rc=$?"                       # expect ok, rc=0
echo 'const harnessProofUnused = 1' >> src/main.jsx
node scripts/ci/lint-ratchet.mjs; echo "rise rc=$?"                        # expect ROSE no-unused-vars: 1 -> 2, rc=1
cp "$B/main.jsx" src/main.jsx; echo 'const = ;' >> src/main.jsx
node scripts/ci/lint-ratchet.mjs; echo "parse rc=$?"                       # expect could not judge … Parsing error, rc=1
cp "$B/main.jsx" src/main.jsx; echo 'export const x = ' >> eslint.config.js
node scripts/ci/lint-ratchet.mjs; echo "config rc=$?"                      # expect could not judge: ESLint exited 2, rc=1
cp "$B/eslint.config.js" eslint.config.js
cmp -s "$B/main.jsx" src/main.jsx && cmp -s "$B/eslint.config.js" eslint.config.js && echo restored
node scripts/ci/lint-ratchet.mjs; echo "final rc=$?"                       # expect ok, rc=0
```

Each `rc` must match its comment. These were all observed on 2026-10-15 in a scratch worktree during planning.

- [ ] **Step 7: Add the npm script.** In `package.json` `"scripts"`, add `"lint:ratchet": "node scripts/ci/lint-ratchet.mjs",` after `"lint"`. Run `npm run lint:ratchet`; expect `lint-ratchet: ok`.

- [ ] **Step 8: Run `npm test`.** Expected: `run-tests: 8 test file(s) passed`.

- [ ] **Step 9: Commit.**

```bash
git add scripts/ci/lint-ratchet.mjs scripts/ci/lint-ratchet.test.mjs .github/lint-baseline.json package.json
git diff --cached --stat
git commit -m "feat(ci): per-rule lint ratchet with a 13-finding baseline

Fails if any rule's count rises; fails closed on ESLint start/config/parse
errors, non-JSON output and a bad baseline. Spec §5.1 (D-5).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 5: Migration rollback check

**Files:**
- Create: `scripts/ci/check-migrations.mjs`, `scripts/ci/migrations-grandfathered.txt`
- Test: `scripts/ci/check-migrations.test.mjs`
- Modify: `package.json` (add `"check:migrations"`)

**Interfaces:**
- Produces: `checkMigrations({ forward: string[], rollbacks: Set<string>, grandfathered: Set<string> }): string[]` (problems; empty = ok); `parseGrandfathered(text): Set<string>`; `rollbackFor(name): string`; `readTree(root)`; constants `MIGRATIONS_DIR`, `ROLLBACKS_DIR`, `GRANDFATHER_PATH`. CLI: `node scripts/ci/check-migrations.mjs [--root <dir>]`.

- [ ] **Step 1: Write the failing self-test** at `scripts/ci/check-migrations.test.mjs`:

```js
// Self-test for scripts/ci/check-migrations.mjs. Pure cases plus CLI runs on temp-dir trees.
// Run: node scripts/ci/check-migrations.test.mjs
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkMigrations, parseGrandfathered } from './check-migrations.mjs'

let pass = 0, fail = 0
const ok = (n, c) => { if (c) { pass++ } else { fail++; console.log('  FAIL', n) } }

const check = (forward, rollbacks, grandfathered) =>
  checkMigrations({ forward, rollbacks: new Set(rollbacks), grandfathered: new Set(grandfathered) })

ok('paired migration -> ok', check(['2026_a.sql'], ['2026_a.rollback.sql'], []).length === 0)
ok('grandfathered, unpaired -> ok', check(['2026_a.sql'], [], ['2026_a.sql']).length === 0)
ok('new unpaired -> FAIL naming the rollback path',
  check(['2026_a.sql', '2026_b.sql'], [], ['2026_a.sql']).some((p) => p.includes('rollbacks/2026_b.rollback.sql')))
ok('misnamed rollback does not pair', check(['2026_b.sql'], ['2026_b.sql'], []).length === 1)
ok('stale grandfather entry -> FAIL', check([], [], ['2026_gone.sql']).some((p) => p.includes('2026_gone.sql')))
ok('grandfather list ignores comments, blanks and CRLF',
  JSON.stringify([...parseGrandfathered('# head\r\n\r\n2026_a.sql\r\n  2026_b.sql  \n')]) === JSON.stringify(['2026_a.sql', '2026_b.sql']))

const CLI = fileURLToPath(new URL('./check-migrations.mjs', import.meta.url))
const tmp = mkdtempSync(join(tmpdir(), 'check-migrations-selftest-'))
const tree = (name, files) => {
  const root = join(tmp, name)
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true })
    writeFileSync(join(root, rel), body)
  }
  return spawnSync(process.execPath, [CLI, '--root', root], { stdio: 'ignore' }).status
}
try {
  ok('CLI ok on a valid tree', tree('valid', {
    'supabase/migrations/1_old.sql': '',
    'supabase/migrations/2_new.sql': '',
    'supabase/migrations/rollbacks/2_new.rollback.sql': '',
    'scripts/ci/migrations-grandfathered.txt': '1_old.sql\n',
  }) === 0)
  ok('CLI FAIL on an unpaired new migration', tree('unpaired', {
    'supabase/migrations/1_old.sql': '',
    'supabase/migrations/2_new.sql': '',
    'scripts/ci/migrations-grandfathered.txt': '1_old.sql\n',
  }) === 1)
  ok('CLI FAIL (fail closed) without a grandfather list', tree('nolist', {
    'supabase/migrations/1_old.sql': '',
  }) === 1)
  ok('CLI FAIL (fail closed) without a migrations dir', tree('nodir', {
    'scripts/ci/migrations-grandfathered.txt': '',
  }) === 1)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
```

- [ ] **Step 2: Run it and watch it fail.**

Run: `node scripts/ci/check-migrations.test.mjs`
Expected: non-zero exit, `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Write `scripts/ci/check-migrations.mjs`.**

```js
// Migration rollback check (repo harness spec §5.5). Every top-level forward migration
// supabase/migrations/<stem>.sql needs supabase/migrations/rollbacks/<stem>.rollback.sql, unless its
// file name is listed in scripts/ci/migrations-grandfathered.txt (the migrations that predate the rule).
// Fails closed if the migrations directory or the grandfather list is missing, and on a stale list
// entry, so the list cannot quietly drift from the directory.
// Run: node scripts/ci/check-migrations.mjs [--root <dir>]
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const MIGRATIONS_DIR = 'supabase/migrations'
export const ROLLBACKS_DIR = 'supabase/migrations/rollbacks'
export const GRANDFATHER_PATH = 'scripts/ci/migrations-grandfathered.txt'

export function parseGrandfathered(text) {
  return new Set(text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')))
}

export const rollbackFor = (migration) => migration.replace(/\.sql$/, '.rollback.sql')

// forward: file names of top-level *.sql; rollbacks: file names in rollbacks/; grandfathered: Set.
export function checkMigrations({ forward, rollbacks, grandfathered }) {
  const problems = []
  const forwardSet = new Set(forward)
  for (const name of [...grandfathered].sort()) {
    if (!forwardSet.has(name)) problems.push(`${GRANDFATHER_PATH} lists ${name}, which is not in ${MIGRATIONS_DIR}/`)
  }
  for (const name of [...forward].sort()) {
    if (grandfathered.has(name)) continue
    if (!rollbacks.has(rollbackFor(name))) problems.push(`${MIGRATIONS_DIR}/${name} has no ${ROLLBACKS_DIR}/${rollbackFor(name)}`)
  }
  return problems
}

const sqlFiles = (dir) => readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile() && d.name.endsWith('.sql')).map((d) => d.name)

export function readTree(root) {
  const forward = sqlFiles(join(root, MIGRATIONS_DIR))
  let rollbacks = []
  try { rollbacks = sqlFiles(join(root, ROLLBACKS_DIR)) } catch (e) { if (e.code !== 'ENOENT') throw e }
  const grandfathered = parseGrandfathered(readFileSync(join(root, GRANDFATHER_PATH), 'utf8'))
  return { forward, rollbacks: new Set(rollbacks), grandfathered }
}

function main(argv) {
  const i = argv.indexOf('--root')
  const root = resolve(i >= 0 ? argv[i + 1] : '.')
  let tree
  try { tree = readTree(root) } catch (e) {
    console.error(`check-migrations: FAIL (could not judge): ${e.message}`)
    return 1
  }
  const problems = checkMigrations(tree)
  if (problems.length) {
    console.error(`check-migrations: FAIL\n  ${problems.join('\n  ')}`)
    return 1
  }
  console.log(`check-migrations: ok (${tree.forward.length} migrations, ${tree.grandfathered.size} grandfathered)`)
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)))
```

- [ ] **Step 4: Run the self-test.**

Run: `node scripts/ci/check-migrations.test.mjs`
Expected: `10 passed, 0 failed`, exit 0.

- [ ] **Step 5: Write the grandfather list from the directory.**

```bash
{
  echo '# Migrations that predate the rollback rule (repo harness spec §5.5). A control file (§2.1):'
  echo '# adding a name here exempts that migration from needing a rollback, so review any change.'
  ls supabase/migrations | grep -E '\.sql$'
} > scripts/ci/migrations-grandfathered.txt
grep -vc '^#' scripts/ci/migrations-grandfathered.txt
```

Expected: `32`.

- [ ] **Step 6: Run it on the repo, then prove both directions.**

```bash
node scripts/ci/check-migrations.mjs; echo "rc=$?"     # expect ok (32 migrations, 32 grandfathered), rc=0
touch supabase/migrations/20261016000000_harness_proof.sql
node scripts/ci/check-migrations.mjs; echo "rc=$?"     # expect FAIL naming rollbacks/20261016000000_harness_proof.rollback.sql, rc=1
rm supabase/migrations/20261016000000_harness_proof.sql
git status --short supabase/                           # expect no output
```

- [ ] **Step 7: Add the npm script.** `"check:migrations": "node scripts/ci/check-migrations.mjs",`. Run `npm run check:migrations`; expect ok. Run `npm test`; expect `run-tests: 9 test file(s) passed`.

- [ ] **Step 8: Commit.**

```bash
git add scripts/ci/check-migrations.mjs scripts/ci/check-migrations.test.mjs scripts/ci/migrations-grandfathered.txt package.json
git diff --cached --stat
git commit -m "feat(ci): require a paired rollback for every new migration

Grandfathers the 32 existing migrations by name in scripts/ci/ (outside
supabase/migrations/, where the CLI would warn about it). Spec §5.5.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 6: `ci.yml` and the Deno check

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `scripts/ci/check-deno.mjs`
- Test: `scripts/ci/check-deno.test.mjs`
- Modify: `package.json` (add `"check:deno"`)

**Interfaces:**
- Consumes: npm scripts `lint:ratchet`, `test`, `build`, `check:migrations` (Tasks 3–5) and `check:deno` (this task).
- Produces: seven check contexts, expected names `lint (ubuntu-latest)`, `lint (windows-latest)`, `test (ubuntu-latest)`, `test (windows-latest)`, `build`, `deno`, `migrations` (confirmed at V0, Task 16).

- [ ] **Step 1: Write the failing self-test** at `scripts/ci/check-deno.test.mjs`. (Why a Node wrapper and not `deno check 'supabase/functions/*/index.ts'` in `package.json`: under `cmd.exe` the quotes reach Deno literally, and `deno check` then exits **0** with "No matching files found". Reproduced in planning; Codex plan review P1.)

```js
// Self-test for scripts/ci/check-deno.mjs: entry-point discovery and the zero-entry failure.
// Never runs Deno (every CLI case here fails before Deno would start).
// Run: node scripts/ci/check-deno.test.mjs
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findEntrypoints } from './check-deno.mjs'

let pass = 0, fail = 0
const ok = (n, c) => { if (c) { pass++ } else { fail++; console.log('  FAIL', n) } }

const CLI = fileURLToPath(new URL('./check-deno.mjs', import.meta.url))
const tmp = mkdtempSync(join(tmpdir(), 'check-deno-selftest-'))
const write = (rel) => {
  mkdirSync(join(tmp, rel, '..'), { recursive: true })
  writeFileSync(join(tmp, rel), '')
}
try {
  write('two/supabase/functions/b-fn/index.ts')
  write('two/supabase/functions/a-fn/index.ts')
  write('two/supabase/functions/_shared/util.ts')
  write('two/supabase/functions/README.md')
  ok('finds each function index.ts, sorted, skipping dirs without one',
    JSON.stringify(findEntrypoints(join(tmp, 'two'))) ===
      JSON.stringify(['supabase/functions/a-fn/index.ts', 'supabase/functions/b-fn/index.ts']))

  write('none/supabase/functions/_shared/util.ts')
  ok('no index.ts -> empty list', findEntrypoints(join(tmp, 'none')).length === 0)
  ok('CLI FAIL (fail closed) on zero functions',
    spawnSync(process.execPath, [CLI, '--root', join(tmp, 'none')], { stdio: 'ignore' }).status === 1)
  mkdirSync(join(tmp, 'nodir'))
  ok('CLI FAIL (fail closed) without supabase/functions',
    spawnSync(process.execPath, [CLI, '--root', join(tmp, 'nodir')], { stdio: 'ignore' }).status === 1)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
```

- [ ] **Step 2: Run it and watch it fail.** `node scripts/ci/check-deno.test.mjs` → `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Write `scripts/ci/check-deno.mjs`.**

```js
// Deno check for the Edge Functions (repo harness spec §5.1 rev 7). A Node wrapper, not a shell
// glob in package.json: under cmd.exe a quoted glob reaches Deno literally, and `deno check` then
// exits 0 with "No matching files found". This finds each supabase/functions/<name>/index.ts
// itself, fails if there are none, and passes Deno an argument array.
// `--no-lock` keeps `deno check` from writing a deno.lock into the checkout. `no-import-prefix` is
// excluded because the functions import `https://esm.sh/…` inline (out of scope, spec §9).
// Run: node scripts/ci/check-deno.mjs [--root <dir>]   (needs Deno 2.9.5 on PATH)
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const FUNCTIONS_DIR = 'supabase/functions'

export function findEntrypoints(root) {
  return readdirSync(join(root, FUNCTIONS_DIR), { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(root, FUNCTIONS_DIR, d.name, 'index.ts')))
    .map((d) => `${FUNCTIONS_DIR}/${d.name}/index.ts`)
    .sort()
}

function deno(args, cwd) {
  const r = spawnSync('deno', args, { cwd, stdio: 'inherit' })
  if (r.error) {
    console.error(`check-deno: FAIL (could not judge): deno failed to start (${r.error.code ?? r.error.message})`)
    return false
  }
  return r.status === 0
}

function main(argv) {
  const i = argv.indexOf('--root')
  const root = resolve(i >= 0 ? argv[i + 1] : '.')
  let entries
  try { entries = findEntrypoints(root) } catch (e) {
    console.error(`check-deno: FAIL (could not judge): ${e.message}`)
    return 1
  }
  if (entries.length === 0) {
    console.error(`check-deno: FAIL (could not judge): no ${FUNCTIONS_DIR}/*/index.ts found`)
    return 1
  }
  if (!deno(['check', '--no-lock', ...entries], root)) return 1
  if (!deno(['lint', '--rules-exclude=no-import-prefix', FUNCTIONS_DIR], root)) return 1
  console.log(`check-deno: ok (${entries.length} function(s))`)
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)))
```

- [ ] **Step 4: Run the self-test.** Expected `4 passed, 0 failed`.

- [ ] **Step 5: Add the npm script and prove it in both directions.** In `package.json`: `"check:deno": "node scripts/ci/check-deno.mjs",`.

```bash
npm run check:deno; echo "rc=$?"                          # expect check-deno: ok (2 function(s)), rc=0
B=$(mktemp -t pn.XXXXXX); cp supabase/functions/provision-node/index.ts "$B"
echo 'export const harnessProof: number = "not a number"' >> supabase/functions/provision-node/index.ts
npm run check:deno; echo "rc=$?"                          # expect a TS2322 type error, rc≠0
cp "$B" supabase/functions/provision-node/index.ts
cmp -s "$B" supabase/functions/provision-node/index.ts && echo restored
git status --short                                        # expect only this task's files; no deno.lock
```

- [ ] **Step 6: Write `.github/workflows/ci.yml`.**

```yaml
# Required CI (repo harness spec §5.1). Every job runs on every PR, including drafts, docs-only and
# Dependabot PRs: no path filters and no job-level `if:`, because a required check that never
# reports leaves a PR pending forever, and a skipped one reads as satisfied.
# No secrets are referenced; fork PRs run this with a read-only token.
name: ci

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]

permissions:
  contents: read

jobs:
  lint:
    name: lint (${{ matrix.os }})
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npm run lint:ratchet

  test:
    name: test (${{ matrix.os }})
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npm test

  build:
    name: build
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      # No env vars on purpose (§5.1). `prebuild` fetches the build doc and falls back to the
      # committed copy if the fetch fails, so a network blip does not fail this job.
      - run: npm run build

  deno:
    name: deno
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: denoland/setup-deno@22d081ff2d3a40755e97629de92e3bcbfa7cf2ed # v2.0.5
        with:
          deno-version: v2.9.5
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version-file: .nvmrc
      - run: npm run check:deno

  migrations:
    name: migrations
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version-file: .nvmrc
      - run: npm run check:migrations
```

- [ ] **Step 7: Validate the YAML locally.** No actionlint is installed; parse it and check the invariants:

```bash
node -e '
const y=require("fs").readFileSync(".github/workflows/ci.yml","utf8")
const bad=[/pull_request_target/,/\bpush:/,/paths:/,/secrets\./,/@v\d/].filter(r=>r.test(y.replace(/#.*$/gm,"")))
console.log(bad.length?"FAIL "+bad:"invariants ok")'
npx --yes js-yaml@4.1.0 .github/workflows/ci.yml > /dev/null && echo "parses"
```

Expected: `invariants ok` and `parses`. (Static checks only; the workflow is first executed on PR A.)

- [ ] **Step 8: Run every local equivalent once.** `prebuild` may successfully fetch a newer build doc and rewrite the tracked `src/generated/build-doc.js`; that change is unrelated to this PR, so snapshot it and put it back:

```bash
G=$(mktemp -t builddoc.XXXXXX); cp src/generated/build-doc.js "$G"
npm run lint:ratchet && npm test && npm run build && npm run check:deno && npm run check:migrations; echo "rc=$?"
cmp -s "$G" src/generated/build-doc.js || { cp "$G" src/generated/build-doc.js; echo "build-doc regenerated by prebuild; restored"; }
git status --short
```

Expected `rc=0`, `npm test` reporting `10 test file(s) passed`, and `git status` showing only this task's files (no `dist/`, which is ignored; no `deno.lock`; no `src/generated/`).

- [ ] **Step 9: Commit.**

```bash
git add .github/workflows/ci.yml scripts/ci/check-deno.mjs scripts/ci/check-deno.test.mjs package.json
git diff --cached --stat
git commit -m "feat(ci): ci.yml with lint/test on Ubuntu+Windows, build, deno, migrations

pull_request only, contents:read, no secrets, no path filters, actions pinned by
SHA, fail-fast off. deno lint excludes no-import-prefix only (spec §5.1 rev 7).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 7: Open PR A, reach acceptance, merge

**Files:** none new.

**Interfaces:**
- Consumes: Tasks 1–6.
- Produces: PR A merged to `main`; observed context names recorded for Task 16.

- [ ] **Step 1: Pre-push review.** Run the Layer 2 review for `subtle-correctness` (this PR touches control files): Codex CLI on correctness over `git diff origin/main...HEAD`, plus a different-model pass on the complement lens. Address findings, re-run the checks in Task 6 Step 8 after any fix.

- [ ] **Step 2: Check the runner ignores `.claude` with a planted failing test (Review Focus 1).**

```bash
mkdir -p .claude/test-probe && echo 'process.exit(1)' > .claude/test-probe/probe.test.mjs
npm test 2>&1 | tail -2
rm -r .claude/test-probe
```

Expected: `run-tests: 10 test file(s) passed` (the probe was not run). Task 3's self-test pins the same rule.

- [ ] **Step 3: Ask David for approval to push**, naming the branch and head SHA (`git rev-parse HEAD`). Push only after a yes: `git push -u origin harness/ci-foundation` (David's local push-review gate applies on his machine).

- [ ] **Step 4: Open the PR.** After approval:

```bash
BODY=$(mktemp -t prA.XXXXXX); echo "$BODY"
# write the body into "$BODY" with the Write tool or an editor, then:
gh pr create --repo magora-project/magora-portal --base main --head harness/ci-foundation \
  --title "Repo harness PR A: CI foundation" --body-file "$BODY"
```

The body contains: summary, the Task 1 records, "This PR changes control files: yes" (§2.1), test evidence (each `rc` from Tasks 3–6), the depth `subtle-correctness` stated in the body (the labels are created in Task 8 and label-gate arrives in PR B, so PR A carries no label), and the closing line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

- [ ] **Step 5: Watch CI.** `gh pr checks <PR> --watch`. Expected: seven checks green. Record the exact names GitHub shows. If a Windows leg fails, read its log before changing anything: a CRLF-sensitive harness is a real defect Noah would hit (Review Focus 2); fix the harness, not the runner settings.

- [ ] **Step 6: Bots.** Confirm CodeRabbit reviewed this head SHA and the Codex App engaged (comment `@codex review` if it is silent). Read every inline thread with `gh api --paginate repos/magora-project/magora-portal/pulls/<PR>/comments`, answer or fix each, and resolve threads. A fix moves the head: re-run Step 5 on the new head.

- [ ] **Step 7: Merge, with David's approval.** `gh pr merge <PR> --squash --delete-branch` (squash-only is not yet enforced; choose squash explicitly). Then `git fetch origin && git log --oneline -1 origin/main` and record the merge SHA.

---

## Phase 2 — Settings and labels

### Task 8: Labels and repo settings (each written only with approval, each read back)

**Files:** none. Record each command's output in a scratch note for the PR B description.

- [ ] **Step 1: Ask David to approve the writes below (Steps 2, 3, 4, 4b) as a list**, then run them one at a time.

- [ ] **Step 2: Create the depth labels.**

```bash
R=magora-project/magora-portal
gh label create mechanical --repo $R --color c5def5 --description "No review beyond CI (docs, renames, formatting)"
gh label create standard --repo $R --color 0e8a16 --description "Codex CLI correctness review before push"
gh label create subtle-correctness --repo $R --color d93f0b --description "Codex + Anthropic complement review; migrations, auth paths, control files"
gh label list --repo $R --json name --jq '.[].name' | grep -xE 'mechanical|standard|subtle-correctness' | sort
```

Expected: the three names.

- [ ] **Step 3: Merge methods and branch deletion.**

```bash
gh api -X PATCH repos/$R -F allow_squash_merge=true -F allow_merge_commit=false -F allow_rebase_merge=false -F delete_branch_on_merge=true > /dev/null
gh api repos/$R --jq '{squash:.allow_squash_merge,merge:.allow_merge_commit,rebase:.allow_rebase_merge,delete:.delete_branch_on_merge}'
```

Expected: `{"squash":true,"merge":false,"rebase":false,"delete":true}`.

- [ ] **Step 4: Dependabot alerts and security updates.**

```bash
gh api -X PUT repos/$R/vulnerability-alerts
gh api -X PUT repos/$R/automated-security-fixes
gh api repos/$R/vulnerability-alerts -i 2>&1 | head -1      # expect HTTP/2.0 204
gh api repos/$R/automated-security-fixes                     # expect {"enabled":true,"paused":false}
```

- [ ] **Step 4b: Private vulnerability reporting** (`SECURITY.md` in PR B points reporters at it).

```bash
gh api repos/$R/private-vulnerability-reporting                 # read first
gh api -X PUT repos/$R/private-vulnerability-reporting          # only if the read showed enabled:false
gh api repos/$R/private-vulnerability-reporting                 # expect {"enabled":true}
```

- [ ] **Step 5: Read back what needs no write.**

```bash
gh api repos/$R/actions/permissions/fork-pr-contributor-approval   # expect {"approval_policy":"first_time_contributors"} (§3.1; no write)
vercel api /v9/projects/magora-portal --scope noah-waldron-s-projects | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log({gitForkProtection:JSON.parse(s).gitForkProtection}))'
```

Expected: the policy as shown and `{ gitForkProtection: true }` (§2.2). Project only that field; print no env values.

---

## Phase 3 — PR B: review, security, contributor files

Create the worktree from the new `main`:

```bash
cd /Users/david/magora-portal && git fetch origin
git worktree add .claude/worktrees/harness-review -b harness/review-contrib origin/main
cd .claude/worktrees/harness-review && npm ci
```

### Task 9: label-gate

**Files:**
- Create: `scripts/ci/label-gate.mjs`, `.github/workflows/label-gate.yml`
- Test: `scripts/ci/label-gate.test.mjs`

**Interfaces:**
- Produces: `DEPTH_LABELS: string[]`; `evaluateLabels(names: string[]): { ok: boolean, line: string }`; `fetchLabels({ repo, pr, token, fetchImpl? }): Promise<string[]>`. Context name `label-gate`.

- [ ] **Step 1: Write the failing self-test** at `scripts/ci/label-gate.test.mjs`:

```js
// Self-test for scripts/ci/label-gate.mjs. Pure; the API is a stub, no network.
// Run: node scripts/ci/label-gate.test.mjs
import { evaluateLabels, fetchLabels } from './label-gate.mjs'

let pass = 0, fail = 0
const ok = (n, c) => { if (c) { pass++ } else { fail++; console.log('  FAIL', n) } }

ok('exactly one depth label -> ok', evaluateLabels(['standard']).ok === true)
ok('one depth label among others -> ok', evaluateLabels(['dependencies', 'subtle-correctness']).ok === true)
ok('zero labels -> FAIL', evaluateLabels([]).ok === false)
ok('only non-depth labels -> FAIL', evaluateLabels(['dependencies']).ok === false)
ok('two depth labels -> FAIL naming both', (() => {
  const v = evaluateLabels(['mechanical', 'standard'])
  return v.ok === false && /mechanical, standard/.test(v.line)
})())
ok('near-miss name is not a depth label', evaluateLabels(['Standard']).ok === false)

const stub = (pages, status = 200) => async (url) => {
  const page = Number(new URL(url).searchParams.get('page'))
  return { ok: status === 200, status, json: async () => pages[page - 1] ?? [] }
}
const full = Array.from({ length: 100 }, (_, i) => ({ name: `l${i}` }))
ok('paginates past 100 labels', (await fetchLabels({ repo: 'o/r', pr: 1, token: 't', fetchImpl: stub([full, [{ name: 'standard' }]]) })).length === 101)
let threw = false
try { await fetchLabels({ repo: 'o/r', pr: 1, token: 't', fetchImpl: stub([], 403) }) } catch { threw = true }
ok('API error throws (fails closed)', threw)
threw = false
try { await fetchLabels({ repo: 'o/r', pr: 1, token: 't', fetchImpl: async () => ({ ok: true, json: async () => ({}) }) }) } catch { threw = true }
ok('non-array response throws', threw)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
```

- [ ] **Step 2: Run it and watch it fail.** `node scripts/ci/label-gate.test.mjs` → `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Write `scripts/ci/label-gate.mjs`.**

```js
// label-gate (repo harness spec §5.3): a PR must carry exactly one depth label. Reads the PR's
// CURRENT labels from the API at run time, not the event payload, so a run always judges the labels
// that exist when it executes. The job's own exit status is the check; nothing posts a status.
// Run (CI): GITHUB_TOKEN=… GITHUB_REPOSITORY=owner/repo PR_NUMBER=n node scripts/ci/label-gate.mjs
import { pathToFileURL } from 'node:url'

export const DEPTH_LABELS = ['mechanical', 'standard', 'subtle-correctness']

export function evaluateLabels(names) {
  const depth = names.filter((n) => DEPTH_LABELS.includes(n))
  if (depth.length === 1) return { ok: true, line: `label-gate: ok (${depth[0]})` }
  const have = depth.length ? `found ${depth.join(', ')}` : 'found none'
  return { ok: false, line: `label-gate: FAIL, need exactly one of ${DEPTH_LABELS.join(', ')}; ${have}` }
}

export async function fetchLabels({ repo, pr, token, fetchImpl = fetch }) {
  const names = []
  for (let page = 1; ; page++) {
    const res = await fetchImpl(`https://api.github.com/repos/${repo}/issues/${pr}/labels?per_page=100&page=${page}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    })
    if (!res.ok) throw new Error(`GitHub API ${res.status} reading labels`)
    const batch = await res.json()
    if (!Array.isArray(batch)) throw new Error('GitHub API returned a non-array label list')
    names.push(...batch.map((l) => l.name))
    if (batch.length < 100) return names
  }
}

async function main() {
  const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo, PR_NUMBER: pr } = process.env
  if (!token || !repo || !pr) {
    console.error('label-gate: FAIL (could not judge): GITHUB_TOKEN, GITHUB_REPOSITORY and PR_NUMBER are required')
    return 1
  }
  let names
  try { names = await fetchLabels({ repo, pr, token }) } catch (e) {
    console.error(`label-gate: FAIL (could not judge): ${e.message}`)
    return 1
  }
  const v = evaluateLabels(names)
  ;(v.ok ? console.log : console.error)(v.line)
  return v.ok ? 0 : 1
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(await main())
```

- [ ] **Step 4: Run the self-test.** Expected `9 passed, 0 failed`. Then `npm test` → `run-tests: 11 test file(s) passed`, and `npm run lint:ratchet` → ok (the new file adds no findings).

- [ ] **Step 5: Live read-only check of `fetchLabels`.** Against PR A (merged, unlabelled):

```bash
PR_A=$(gh pr list --repo magora-project/magora-portal --state merged --head harness/ci-foundation --json number --jq '.[0].number'); echo "PR A = $PR_A"
GITHUB_TOKEN=$(gh auth token) GITHUB_REPOSITORY=magora-project/magora-portal PR_NUMBER="$PR_A" node scripts/ci/label-gate.mjs; echo "rc=$?"
```

Expected: `label-gate: FAIL, need exactly one of …; found none`, rc=1. The token stays inside the command's environment; it is never echoed.

- [ ] **Step 6: Write `.github/workflows/label-gate.yml`.**

```yaml
# label-gate (repo harness spec §5.3): exactly one depth label. The job's pass/fail IS the check;
# it posts no commit status, because a fork PR's read-only token cannot write one.
# Labels are read live from the API when the job runs (not from the event payload), so removing a
# label re-evaluates. Concurrency is keyed on the head SHA: a run for an older head reports on that
# older SHA and can never touch the current head's result.
name: label-gate

on:
  pull_request:
    types: [opened, synchronize, reopened, labeled, unlabeled]

permissions:
  contents: read
  pull-requests: read
  issues: read

concurrency:
  group: label-gate-${{ github.event.pull_request.number }}-${{ github.event.pull_request.head.sha }}
  cancel-in-progress: false

jobs:
  label-gate:
    name: label-gate
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version-file: .nvmrc
      - run: node scripts/ci/label-gate.mjs
        env:
          GITHUB_TOKEN: ${{ github.token }}
          PR_NUMBER: ${{ github.event.pull_request.number }}
```

- [ ] **Step 7: Commit.**

```bash
git add scripts/ci/label-gate.mjs scripts/ci/label-gate.test.mjs .github/workflows/label-gate.yml
git commit -m "feat(ci): label-gate requires exactly one depth label

Job pass/fail is the check (forks cannot post statuses); reads live labels;
concurrency keyed on head SHA without cancel-in-progress. Spec §5.3.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 10: Security workflows and Dependabot (advisory)

**Files:**
- Create: `.github/workflows/semgrep.yml`, `.github/workflows/osv-scan.yml`, `osv-scanner.toml`, `.github/dependabot.yml`

Adapted from `~/method-project` at `cf31b1bdea82fc848acd666665839c3b1254bdd0` with these deviations: no `push`/`workflow_dispatch` triggers and no Semgrep `schedule` (§2); OSV gains `pull_request` and keeps its weekly `schedule`; OSV drops the issue-filing step and `issues: write` (this repo is public, and that step exits early on public repos anyway); every Action pinned by SHA (the method-project OSV file is tag-pinned).

- [ ] **Step 1: Write `.github/workflows/semgrep.yml`.**

```yaml
# Advisory SAST (repo harness spec §5.2); not a required check for G2.
# Adapted from method-project (cf31b1bd): `--config auto` because there is no SEMGREP_APP_TOKEN
# (and `semgrep ci` refuses --config while logged in); `--no-suppress-errors` so an analysis error
# fails the job instead of passing green having scanned nothing; the image pinned by digest.
# Checkout keeps its default credentials: logged-out `semgrep ci` fetches its own baseline commit.
name: semgrep

on:
  pull_request: {}

permissions:
  contents: read

jobs:
  semgrep:
    name: semgrep/ci
    runs-on: ubuntu-latest
    timeout-minutes: 15
    container:
      # semgrep/semgrep:1.154.0
      image: semgrep/semgrep@sha256:9fb6f44dc162b1e0aada85f072a95141844c61e3bfcedf40b8a46fecf208e986
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - run: semgrep ci --config auto --no-suppress-errors
```

- [ ] **Step 2: Write `.github/workflows/osv-scan.yml`.**

```yaml
# Advisory dependency scan (repo harness spec §5.2); not a required check for G2.
# Adapted from method-project (cf31b1bd): adds pull_request, keeps the weekly schedule (which runs
# on main, executes no PR code and uses no secret), drops the issue-filing step (public repo).
# osv-scanner exit 0 = clean, 1 = findings (advisory); anything else fails the job.
name: osv-sca

on:
  pull_request: {}
  schedule:
    - cron: "0 13 * * 1"  # Mondays 13:00 UTC

permissions:
  contents: read

concurrency:
  group: osv-sca-${{ github.event.pull_request.number || github.run_id }}
  cancel-in-progress: false

jobs:
  sca:
    name: osv-sca
    runs-on: ubuntu-latest
    timeout-minutes: 15
    env:
      # Pinned by digest (captured 2026-06-30 in method-project). Re-pin deliberately.
      OSV_IMAGE: "ghcr.io/google/osv-scanner:latest@sha256:5116601dedc01c1c580eb92371883ec052fc4c13c3fbc109d621a63ac416d475"
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - name: Run osv-scanner (json)
        id: scan
        run: |
          set -uo pipefail
          mkdir -p "$PWD/osv-out"
          test -f osv-scanner.toml || { echo "::error::osv-scanner.toml missing — refusing to scan without per-repo config"; exit 1; }
          set +e
          docker run --rm -v "$PWD:/src:ro" "$OSV_IMAGE" \
            scan source --recursive --config=/src/osv-scanner.toml \
            --format json /src \
            > "$PWD/osv-out/osv.json" 2> "$PWD/osv-out/osv.log"
          osv_exit=$?
          set -e
          echo "osv_exit=$osv_exit" >> "$GITHUB_OUTPUT"
      - name: Coverage assertion + step summary
        if: ${{ always() }}
        env:
          OSV_EXIT: ${{ steps.scan.outputs.osv_exit }}
        run: |
          set -uo pipefail
          json="$PWD/osv-out/osv.json"
          log="$PWD/osv-out/osv.log"
          # `grep -c` prints 0 AND exits 1 on no match; `|| true` keeps a single "0".
          scanned="$(grep -ciE 'scanned .*file' "$log" 2>/dev/null || true)"; scanned="${scanned:-0}"
          advisories="$(python3 -c "import json;d=json.load(open('$json'));print(sum(len(p.get('groups',[])) for r in d.get('results',[]) for p in r.get('packages',[])))" 2>/dev/null || echo 0)"
          {
            echo "### osv-sca"
            echo ""
            echo "| metric | value |"
            echo "|---|---|"
            echo "| lockfiles scanned | $scanned |"
            echo "| advisories (groups) | $advisories |"
            echo "| osv exit code | $OSV_EXIT |"
          } >> "$GITHUB_STEP_SUMMARY"
          case "$OSV_EXIT" in
            0|1) ;;
            *) echo "::error::osv-scanner exited '$OSV_EXIT'"; exit 1 ;;
          esac
          if [ "$scanned" -lt 1 ]; then
            echo "::error::coverage collapse — 0 lockfiles scanned"; exit 1
          fi
      - name: Upload report
        if: ${{ always() }}
        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
        with:
          name: osv-sca-report
          path: osv-out/
          retention-days: 30
```

- [ ] **Step 3: Write `osv-scanner.toml`.**

```toml
# osv-scanner config (repo harness spec §5.2). Each suppression MUST carry a one-line reason and an
# ignoreUntil so it expires. Fixable direct-dependency advisories are bumped via Dependabot, never
# suppressed. No suppressions yet.
#
# [[IgnoredVulns]]
# id = "GHSA-xxxx-xxxx-xxxx"
# ignoreUntil = 2027-01-31
# reason = "transitive via <parent>; not reachable in our runtime / fix tracked in <PR>"
```

- [ ] **Step 4: Write `.github/dependabot.yml`.**

```yaml
# Dependabot (repo harness spec §5.2). Every PR arrives labelled `standard`, so label-gate passes
# with exactly one depth label. Cooldown: a newly published version waits 7 days (security updates
# are exempt and still arrive immediately).
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    cooldown:
      default-days: 7
    schedule:
      interval: "weekly"
      day: "sunday"
    open-pull-requests-limit: 5
    groups:
      patch-and-minor:
        # ESLint and its plugins are excluded: a minor bump can ship new rules that add findings in
        # untouched files, which the lint ratchet then (correctly) fails. Alone, that PR is
        # attributable; inside a group it would block every other bump.
        patterns:
          - "*"
        exclude-patterns:
          - "eslint"
          - "eslint-plugin-*"
          - "@eslint/*"
        update-types:
          - "patch"
          - "minor"
    commit-message:
      prefix: "chore(deps)"
      prefix-development: "chore(deps-dev)"
    labels:
      - "standard"

  - package-ecosystem: "github-actions"
    directory: "/"
    cooldown:
      default-days: 7
    schedule:
      interval: "weekly"
      day: "sunday"
    open-pull-requests-limit: 3
    groups:
      actions:
        patterns:
          - "*"
        update-types:
          - "patch"
          - "minor"
    commit-message:
      prefix: "chore(ci)"
    labels:
      - "standard"
```

- [ ] **Step 5: Static checks.** For each of the four files: `npx --yes js-yaml@4.1.0 <file> >/dev/null && echo parses` (YAML files), and run the invariant check from Task 6 Step 7 on the two workflows; the OSV file is expected to match `schedule:` (allowed) but not `push:`, `pull_request_target`, `secrets.` or a tag pin.

- [ ] **Step 6: Commit.**

```bash
git add .github/workflows/semgrep.yml .github/workflows/osv-scan.yml osv-scanner.toml .github/dependabot.yml
git commit -m "feat(ci): advisory Semgrep and OSV scans, Dependabot with depth label

Adapted from method-project cf31b1bd; pull_request only (OSV adds a weekly
schedule), every Action and image pinned. Advisory for G2 (spec §5.2).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 11: CodeRabbit config and PR template

**Files:**
- Create: `.coderabbit.yaml`, `.github/pull_request_template.md`

- [ ] **Step 1: Write `.coderabbit.yaml`** (fleet baseline from method-project cf31b1bd, retargeted to this repo's JavaScript and to `main` only):

```yaml
# CodeRabbit configuration (repo harness spec §5.3): advisory reviewer, never a required check.
# Adapted from the fleet baseline. CI runs ESLint (the lint ratchet), so CodeRabbit's eslint tool
# is disabled to avoid duplicate findings.
reviews:
  profile: chill
  poem: false
  high_level_summary: true
  collapse_walkthrough: true
  auto_review:
    enabled: true
    drafts: false
    base_branches:
      - "main"
  path_filters:
    - "!**/package-lock.json"
    - "!**/dist/**"
    - "!src/generated/**"
  path_instructions:
    - path: "**/*.{js,jsx,mjs}"
      instructions: >-
        Prioritize correctness, data integrity, security, and incorrect
        assumptions about existing code. Treat style, formatting, and naming as
        low priority — raise them only when they materially affect correctness.
    - path: "**/*.test.mjs"
      instructions: >-
        Focus on missing edge cases, incorrect assertions, and untested error
        paths. Do NOT flag test naming or structure preferences.
    - path: "supabase/migrations/**"
      instructions: >-
        Flag destructive operations and applied-state-stability risks only. Do
        NOT suggest renaming or reordering migrations that may already be applied.
        Every new migration needs a paired rollbacks/<stem>.rollback.sql.
    - path: "**/*.md"
      instructions: >-
        Flag only claims that are factually wrong about this repo, or internally
        contradictory. Do not flag typography or style.
  tools:
    markdownlint:
      enabled: false
    eslint:
      enabled: false
tone_instructions: >-
  Be concise and high-signal. Prioritize correctness, security, and data
  integrity over style. Avoid nitpicks and subjective preferences.
```

- [ ] **Step 2: Write `.github/pull_request_template.md`.**

```markdown
## Depth (exactly one; a maintainer applies the matching label)

- [ ] `mechanical` — docs, renames, formatting; nothing beyond CI
- [ ] `standard` — ordinary change; Codex CLI correctness review before push
- [ ] `subtle-correctness` — migrations, `api/` auth paths, control files, concurrency; Codex plus an Anthropic complement review before push

## What changed

<!-- 1-3 bullets: what and why -->

## Test evidence

<!-- Commands you ran and what they printed (npm test, npm run lint:ratchet, npm run build, …) -->

## Migrations

- [ ] No migration in this PR
- [ ] Each new `supabase/migrations/<stem>.sql` has `supabase/migrations/rollbacks/<stem>.rollback.sql`
- [ ] Expand/contract: nothing a running deploy reads is dropped or renamed in the same PR

## Control files

This PR changes control files (`.github/**`, `scripts/run-tests.mjs`, `scripts/ci/**`, `.github/lint-baseline.json`, `scripts/ci/migrations-grandfathered.txt`, `eslint.config.js`, `AGENTS.md`): **yes / no**

<!-- If yes, say which and why. The merging maintainer reads every control-file change on fork and Dependabot PRs. -->
```

- [ ] **Step 3: Commit.**

```bash
git add .coderabbit.yaml .github/pull_request_template.md
git commit -m "chore(review): CodeRabbit config and PR template with depth and control-file declaration

Spec §5.3, §2.1.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 12: AGENTS.md, CLAUDE.md, CONTRIBUTING.md, SECURITY.md

**Files:**
- Create: `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `SECURITY.md`

**Interfaces:**
- Produces: the text Task 20's smoke check asks about (depth for a migration PR, rollback path).

- [ ] **Step 1: Write `AGENTS.md`.**

```markdown
# AGENTS.md — magora-portal

Instructions for every agent and contributor working in this repo (Claude Code reads this through
`CLAUDE.md`; Codex CLI reads it directly). Design: `docs/superpowers/specs/2026-10-15-repo-harness-design.md`.

## Commands

- `npm ci` — install
- `npm test` — every `*.test.mjs` (fails if none are found)
- `npm run lint:ratchet` — ESLint; fails if any rule's finding count rises above `.github/lint-baseline.json`. If a count falls, lower the baseline in the same PR.
- `npm run build` — production build (needs no env vars)
- `npm run check:migrations` — every new migration has a rollback
- `npm run check:deno` — type-check and lint the Edge Functions (needs Deno 2.9.5)

## Flow

- Trunk: branch from `main`, open a PR to `main`. No long-lived branches.
- Squash merge only. A maintainer merges their own PR once the required checks are green; no approval is required. Fork and Dependabot PRs are merged by a maintainer, who reviews them first.
- Every review thread must be resolved before merge. Read bot findings before resolving them.
- **Agents never push, merge, or change repo settings without their operator's explicit approval.**

## Depth labels (exactly one per PR)

| Label | Use for | Review before push |
|---|---|---|
| `mechanical` | docs, renames, formatting | nothing beyond CI |
| `standard` | ordinary changes | Codex CLI, correctness question |
| `subtle-correctness` | **any PR that touches `supabase/migrations/`, an `api/` auth path, or a control file**; concurrency; anything subtle | Codex CLI on correctness, plus a Fable or Opus subagent on completeness, executability, whether the tests can fail, and what the fixes broke |

If Codex wrote the change, route its review to an Anthropic model instead. An empty reviewer reply is an unrun review, not a pass. This review layer is discipline; the required CI checks are the control.

## Control files

`.github/**`, `scripts/run-tests.mjs`, `scripts/ci/**`, `.github/lint-baseline.json`,
`scripts/ci/migrations-grandfathered.txt`, `eslint.config.js`, `AGENTS.md`.
A PR can weaken a check by editing these. Say so in the PR description when you change one. On fork
and Dependabot PRs, the merging maintainer reads every control-file change before merging.

## Migrations

- A PR that adds a migration is `subtle-correctness`.
- Every new `supabase/migrations/<stem>.sql` needs `supabase/migrations/rollbacks/<stem>.rollback.sql`. CI enforces this.
- Expand/contract for anything a running deploy reads: add first, switch readers, remove later.
- Never apply a migration until its PR is green at its final head.

## Production warnings (until the staging spec lands)

- `vite dev` proxies `/api` to production, and every Vercel preview uses the production Supabase project.
- **Never authorize a Vercel deployment for a fork PR.** Its preview would run fork code with Preview secrets against production. Review fork PRs from CI and the diff only.
```

- [ ] **Step 2: Write `CLAUDE.md`.**

```markdown
# CLAUDE.md

All instructions for this repo live in `AGENTS.md`, shared with Codex and contributors. Do not add rules here.

@AGENTS.md
```

- [ ] **Step 3: Write `CONTRIBUTING.md`.**

```markdown
# Contributing to magora-portal

Licensing and the DCO/CLA question are **pending** (spec §8.1). Until they are settled, we are not
inviting outside contributions.

## Workflow

1. Fork the repo and branch from `main`.
2. Make your change; run the checks below.
3. Open a PR to `main` and fill in the template, including whether you changed control files.
4. A maintainer applies the depth label (forks cannot add labels) and, for a first-time
   contributor, approves the workflow run after reading the change.
5. If your branch falls behind `main`, update it (merge or rebase `main`); that re-runs CI.

A maintainer merges once the required checks pass and review threads are resolved.
Vercel will not build a preview for a fork PR, and maintainers will not authorize one: previews
currently run against production. Your PR is reviewed from CI and the diff.

## Running the checks locally

macOS and Windows (PowerShell or cmd) use the same commands; every check is a Node script.

    npm ci
    npm test
    npm run lint:ratchet
    npm run build
    npm run check:migrations
    npm run check:deno        # needs Deno 2.9.5

## If label-gate shows "cancelled"

The latest label-gate run on your head must finish. If it was cancelled, re-run the job from the
PR's Checks tab, or ask a maintainer to remove and re-add the depth label.

## Agents

See `AGENTS.md`. It applies to your agent too.
```

- [ ] **Step 4: Write `SECURITY.md`.**

```markdown
# Security policy

Report vulnerabilities privately through GitHub: **Security → Report a vulnerability** on this
repository (a private security advisory). Do not open a public issue.

We will acknowledge the report, investigate, and coordinate a fix and disclosure with you.
```

- [ ] **Step 5: Check the smoke-check answer is present.** `grep -n 'subtle-correctness' AGENTS.md | head -3` and `grep -n 'rollbacks/<stem>.rollback.sql' AGENTS.md`. Expected: both found, and the depth table names migrations under `subtle-correctness`.

- [ ] **Step 6: Commit.**

```bash
git add AGENTS.md CLAUDE.md CONTRIBUTING.md SECURITY.md
git commit -m "docs: AGENTS.md as the shared agent/contributor guide, plus CLAUDE.md pointer, CONTRIBUTING, SECURITY

Spec §5.4.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 13: Doc-size ratchet (advisory)

**Files:**
- Create: `scripts/doc-size-ratchet.py` (vendored byte-identical), `doc-size.conf`, `.github/workflows/doc-size-ratchet.yml`

- [ ] **Step 1: Vendor the script from the canonical copy.**

```bash
git -C ~/code/claude-config fetch origin
C=$(git -C ~/code/claude-config rev-parse origin/main); echo "$C"
git -C ~/code/claude-config show "${C}:scripts/doc-size-ratchet.py" > scripts/doc-size-ratchet.py
shasum -a 256 scripts/doc-size-ratchet.py
```

Expected at planning time (`C=db1c7545…`): `cca2e1d29b61a0d4d281b55e3132cd4ff0c486e323c3dc7cb5c662c7f79366a3`. A different hash means the canonical moved; record the new sha and hash in the commit. Never edit the vendored copy.

- [ ] **Step 2: Write `doc-size.conf`.**

```
# Governed docs (repo harness spec §5.4). CI reads THIS FILE FROM BASE: a PR's edit here judges
# the NEXT PR, never itself. Raising a ceiling is a separate config-only PR: switch to cap:N.
CLAUDE.md   ratchet
AGENTS.md   ratchet
```

- [ ] **Step 3: Write `.github/workflows/doc-size-ratchet.yml`** (method-project's, reduced to `pull_request`):

```yaml
# Advisory (repo harness spec §5.4): governed docs may not grow. The script and doc-size.conf are
# read from BASE, never from the PR. On the PR that first adds them, BASE has neither, so the job
# exits 2 ("base has no ratchet"); that is expected once (bootstrap, §6 step 5).
name: doc-size-ratchet

on:
  pull_request:
    # `edited` covers a base retarget, which changes what is judged.
    types: [opened, synchronize, reopened, edited]

permissions:
  contents: read

concurrency:
  group: doc-size-ratchet-${{ github.ref }}
  cancel-in-progress: true

jobs:
  doc-size-ratchet:
    name: doc-size-ratchet
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          # BASE is HEAD^1 of the merge commit.
          fetch-depth: 2
          persist-credentials: false
      - name: Judge governed doc sizes against BASE
        shell: bash
        run: |
          fail() { echo "doc-size-ratchet: $*"; exit 2; }
          HEAD_SHA=$(git rev-parse --verify 'HEAD^{commit}') || fail "cannot resolve HEAD"
          BASE_SHA=$(git rev-parse --verify 'HEAD^1^{commit}') || fail "HEAD^1 is missing; the checkout needs fetch-depth: 2"
          for p in scripts/doc-size-ratchet.py doc-size.conf; do
            listed=$(git ls-tree --name-only "$BASE_SHA" -- "$p") || fail "git ls-tree failed at BASE for $p"
            [ -n "$listed" ] || fail "base has no ratchet ($p is absent at BASE $BASE_SHA)"
          done
          tmp=$(mktemp -d "${RUNNER_TEMP:-/tmp}/doc-size-ratchet.XXXXXX") || fail "mktemp failed"
          git show "${BASE_SHA}:scripts/doc-size-ratchet.py" > "$tmp/ratchet.py" || fail "cannot read the BASE copy of the script"
          python3 "$tmp/ratchet.py" --repo . --base "$BASE_SHA" --head "$HEAD_SHA"
```

- [ ] **Step 4: Commit, naming the canonical sha from Step 1 in the body.**

```bash
git add scripts/doc-size-ratchet.py doc-size.conf .github/workflows/doc-size-ratchet.yml
H=$(shasum -a 256 scripts/doc-size-ratchet.py | cut -d' ' -f1); M=$(mktemp -t dsr-msg.XXXXXX)
printf '%s\n\n%s\n\n%s\n' \
  "chore(docs): advisory doc-size ratchet on AGENTS.md and CLAUDE.md" \
  "Script vendored byte-identical from claude-config ${C}, sha256 ${H}. Spec §5.4." \
  "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" > "$M"
git commit -F "$M" && git log -1 --format=%B
```

`C` is the variable from Step 1; run both steps in one shell, or re-set `C` first.

- [ ] **Step 5: Prove both directions locally** with a temporary commit that is undone without a hard reset:

```bash
BASE=$(git rev-parse HEAD); B=$(mktemp -t agents.XXXXXX); cp AGENTS.md "$B"
python3 scripts/doc-size-ratchet.py --repo . --base "$BASE" --head "$BASE"; echo "same rc=$?"   # expect 0
echo "growth" >> AGENTS.md && git commit -qm "tmp: grow AGENTS.md" -- AGENTS.md
python3 scripts/doc-size-ratchet.py --repo . --base "$BASE" --head HEAD; echo "grow rc=$?"     # expect 1
git reset -q --soft "$BASE" && cp "$B" AGENTS.md && git add AGENTS.md
git diff --cached --quiet && git diff --quiet && [ "$(git rev-parse HEAD)" = "$BASE" ] && echo "restored to $BASE"
```

- [ ] **Step 6: Note the canonical registry.** `claude-config/hooks/canonical-source-registry.tsv` lists method-project as the only downstream of `scripts/doc-size-ratchet.py`. Adding magora-portal there is a claude-config PR, outside this repo; tell David it is owed, do not make it from here.

### Task 14: Gemini review (conditional — only if §8.3 is decided)

**Skip this task and record "Gemini deferred; `gemini-review.yml` absent" if Task 1 Step 1 recorded a deferral, or if Step 0 below finds no secret.**

- [ ] **Step 0: The key exists as an Actions secret.** The org owner (human-only, spec §6 step 2) creates the Magora-owned Gemini key and stores it as repository Actions secret `GEMINI_API_KEY`; nobody pastes it into this session. Check by name only: `gh secret list --repo magora-project/magora-portal --json name --jq '.[].name' | grep -x GEMINI_API_KEY`. No output means Gemini is deferred; skip the rest of this task.

**Files:**
- Create: `.github/workflows/gemini-review.yml`, `scripts/review/gemini_review.py`

- [ ] **Step 1: Vendor the helper.** `mkdir -p scripts/review`, `git -C ~/method-project fetch origin`, then `git -C ~/method-project show "origin/main:scripts/review/gemini_review.py" > scripts/review/gemini_review.py`. Read the whole file; list its imports and any file it reads besides `--rules`. If it imports anything outside the Python standard library or reads another repo file, stop and tell David: the bootstrap list in §6 step 5 must grow.

- [ ] **Step 2: Copy method-project's `.github/workflows/gemini-review.yml`** (from `origin/main`, read in full) and make exactly these edits:
  1. `on.pull_request.types`: `[opened, reopened, ready_for_review, synchronize, labeled]`; `branches: [main]`.
  2. Replace the job `if:` with:

```yaml
    if: >-
      github.event.pull_request.draft == false &&
      github.event.pull_request.head.repo.full_name == github.repository &&
      github.actor != 'dependabot[bot]' &&
      github.event.pull_request.user.login != 'dependabot[bot]' &&
      contains(github.event.pull_request.labels.*.name, 'subtle-correctness') &&
      (github.event.action != 'labeled' || github.event.label.name == 'subtle-correctness')
```

  3. Remove header paragraphs that describe method-project's `dev` branch, runbooks and issue numbers; keep decisions 1, 3, 4, 5 and the cost note.
  4. Keep every other step, the base-SHA trusted checkout, the `python3 -I` posting step and `secrets.GEMINI_API_KEY` unchanged.

- [ ] **Step 3: Verify the secrets surface.** `grep -rn 'secrets' .github/` — the only non-`GITHUB_TOKEN` hit must be `GEMINI_API_KEY` in this file.

- [ ] **Step 4: Commit** both files with message `feat(review): advisory Gemini review on subtle-correctness same-repo PRs` and the spec ref §5.3.

### Task 15: Open PR B, reach acceptance, merge

- [ ] **Step 1: Local checks.** Run Task 6 Step 8's block (it snapshots and restores `src/generated/build-doc.js`). Expected `rc=0`, `npm test` reporting `11 test file(s) passed`, and `git status` showing nothing uncommitted.
- [ ] **Step 2: Layer 2 review** at `subtle-correctness` (control files), as in Task 7 Step 1.
- [ ] **Step 3: Push and open, each with David's approval.** `git push -u origin harness/review-contrib`; `gh pr create --base main --title "Repo harness PR B: review, security, contributor files"` with a body naming: control files changed (yes), Task 8's readbacks, the bootstrap limitation (doc-size-ratchet exits 2 on this PR and Gemini cannot run here, §6 step 5), and the Gemini deferral if any.
- [ ] **Step 4: Label it** `subtle-correctness` (approval covers this as part of opening the PR). Watch `gh pr checks <PR> --watch`. Acceptance: `label-gate` and all seven `ci.yml` contexts green on the final head. Semgrep and OSV: read their results; red there is advisory but must be explained in the PR. doc-size-ratchet: expected exit 2 with "base has no ratchet".
- [ ] **Step 5: Bots.** As Task 7 Step 6.
- [ ] **Step 6: Merge with David's approval.** `gh pr merge <PR> --squash --delete-branch`; `git fetch origin`; record the merge SHA.

---

## Phase 4 — Proof and arming

### Task 16: Pre-arm proof on a throwaway PR (V0, V4–V7, proof matrix, label races)

**Files:** a throwaway branch `harness/proof`; never merged.

- [ ] **Step 1: Branch and open, with approval.** From `origin/main`, create `harness/proof` with one trivial commit (append a line to `docs/superpowers/plans/2026-10-15-repo-harness.md`'s end: `<!-- proof PR marker -->`). Push and open a PR titled "DO NOT MERGE: harness proof"; label `subtle-correctness`.

- [ ] **Step 2: V0 and V6.** When all checks finish:

```bash
R=magora-project/magora-portal
PR=$(gh pr list --repo $R --head harness/proof --json number --jq '.[0].number'); echo "proof PR = $PR"
SHA=$(gh pr view "$PR" --repo $R --json headRefOid --jq .headRefOid); echo "head = $SHA"
gh api --paginate "repos/$R/commits/$SHA/check-runs" --jq '.check_runs[] | [.name, .conclusion, .app.slug, .app.id] | @tsv' | sort
```

Record the output verbatim. Expected: the eight required names with `success` and app `github-actions` (record its `app.id` for Task 18), plus advisory `semgrep/ci`, `osv-sca`, `doc-size-ratchet` (and `gemini-review` if not deferred).

- [ ] **Step 3: V4, V5, Gemini.** Record: CodeRabbit's review on this head (link), the Codex App's engagement (link; comment `@codex review` if silent), Gemini's comment or "deferred; workflow absent".

- [ ] **Step 4: V7.** `gh api repos/magora-project/magora-portal/automated-security-fixes` → `enabled: true`; `gh api repos/magora-project/magora-portal/vulnerability-alerts -i | head -1` → 204.

- [ ] **Step 5: Proof matrix — one defect per commit, push, record, revert.** For each row, ask approval for the push (one approval may cover the whole matrix if David gives it explicitly for this PR). After each push, wait for all checks and record the check-runs table (Step 2's command) at that SHA. Pass = exactly the expected contexts red and every other required context green. Then push a revert commit and confirm all green before the next row.

| # | Defect commit | Expected red |
|---|---|---|
| 1 | Append `const harnessProofUnused = 1` to `src/main.jsx` | `lint (ubuntu-latest)`, `lint (windows-latest)` |
| 2 | Append `const = ;` to `src/main.jsx` | both `lint`, `build` |
| 3 | In `api/_report/labels.test.mjs`, insert `ok('harness proof', false)` on the line before the final ``console.log(`\n${pass} passed`` line | `test (ubuntu-latest)`, `test (windows-latest)` |
| 4 | Insert `import './harness-proof-missing.js'` as line 1 of `src/main.jsx` | `build` |
| 5 | Append `export const harnessProof: number = "not a number"` to `supabase/functions/provision-node/index.ts` | `deno` |
| 6 | Add empty `supabase/migrations/20261016000000_harness_proof.sql` | `migrations` |

Rows 1–6 were executed locally during planning with these exact edits and produced exactly these failures.

- [ ] **Step 6: Label-gate actions (no commits).** On the green head: remove `subtle-correctness` (expect `label-gate` red); add `standard` and `mechanical` (expect red, naming both); remove `mechanical` (expect green); remove `standard` (expect red, "found none"). Re-add `subtle-correctness`. Then the race (Review Focus 4): add and remove `standard` within two seconds, and separately push two empty commits (`git commit --allow-empty`) back to back. Expected: the latest completed `label-gate` run on the current head reflects the labels present at that moment; if the latest is `cancelled`, re-run it and record that the recovery worked.

### Task 17: Fork and Dependabot proof

- [ ] **Step 1: Fork PR.** Needs a GitHub account that is **not** a Vercel team member (spec §6 step 6). Ask David who provides it. From that fork, open a PR with a one-line README change.
  - Approve the first-time-contributor workflow run after reading the diff.
  - Expected: CI runs; Vercel shows the deployment awaiting authorization — **do not authorize it** (§2.2).
  - Apply `standard`; expect label-gate green.
  - No-secret evidence, three parts, recorded: (a) cite GitHub's documentation that fork `pull_request` runs receive no secrets other than a read-only `GITHUB_TOKEN`; (b) `grep -rn 'secrets' .github/` on `main`, every hit reviewed by hand (expect none, or only `GEMINI_API_KEY`), plus `grep -rn 'uses: .*/.*/\.github/workflows/' .github/` showing no reusable workflow from another repo; (c) the Gemini job shows "skipped" on this run (or the workflow is absent).
  - Close the fork PR unmerged.

- [ ] **Step 2: Dependabot PR.** Use a Dependabot PR **created after PR B merged**: `dependabot.yml`, which supplies the label, lands with PR B, so a security-update PR opened between Task 8 and PR B has no label config. Trigger one if none arrives (Insights → Dependency graph → Dependabot → "Check for updates"). An earlier Dependabot PR may be labelled by hand and used for the CI part, but not as the arrival-label proof. Expected: label `standard` on arrival, label-gate green, CI runs. If Gemini is not deferred: Gemini skipped, and still skipped after a maintainer adds `subtle-correctness` (then remove it again).

### Task 18: Arm protection (D1)

- [ ] **Step 1: Generate the request from the proof PR's green head**, so names and the app id come from what GitHub reported, not from typing. `WANT` must equal the eight names recorded at V0 (Task 16 Step 2); if V0 recorded different spellings, stop and tell David before editing the list. Every name in `WANT` must also have gone red in Task 16 Step 5–6.

```bash
R=magora-project/magora-portal
PR=$(gh pr list --repo $R --head harness/proof --json number --jq '.[0].number')
SHA=$(gh pr view "$PR" --repo $R --json headRefOid --jq .headRefOid)
P=$(mktemp -t protection.XXXXXX)
gh api --paginate "repos/$R/commits/$SHA/check-runs" \
  --jq '.check_runs[] | select(.app.slug == "github-actions") | {name, app_id: .app.id, conclusion} | @json' |
SHA="$SHA" WANT='["lint (ubuntu-latest)","lint (windows-latest)","test (ubuntu-latest)","test (windows-latest)","build","deno","migrations","label-gate"]' node -e '
const want = JSON.parse(process.env.WANT)
let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
  const runs = s.trim().split("\n").filter(Boolean).map(l => JSON.parse(l))
  const checks = want.map(n => {
    const r = runs.find(x => x.name === n)
    if (!r || r.conclusion !== "success") { console.error("missing or not green on " + process.env.SHA + ": " + n); process.exit(1) }
    return { context: n, app_id: r.app_id }
  })
  console.log(JSON.stringify({
    required_status_checks: { strict: true, checks },
    enforce_admins: true,
    required_pull_request_reviews: { required_approving_review_count: 0, dismiss_stale_reviews: false, require_code_owner_reviews: false, require_last_push_approval: false },
    required_conversation_resolution: true,
    restrictions: null,
    allow_force_pushes: false,
    allow_deletions: false,
  }, null, 2))
})' > "$P" && cat "$P"
```

Expected: the JSON prints with eight `checks`, all sharing one `app_id`. A `missing or not green` line means the head is not fully green: fix that first.

- [ ] **Step 2: Apply, with David's approval.** `gh api -X PUT "repos/$R/branches/main/protection" --input "$P"`.

- [ ] **Rollback rule (spec §6 step 7):** if any later step shows a required context wedged, remove only that context (`gh api -X DELETE repos/magora-project/magora-portal/branches/main/protection/required_status_checks/contexts` with `-f 'contexts[]=<name>'`), record it in a PR, never disable protection wholesale.

### Task 19: Post-arm enforcement proof (D-8)

- [ ] **Step 1: V1 readback.**

```bash
gh api repos/magora-project/magora-portal/branches/main/protection --jq '{
  checks: [.required_status_checks.checks[] | "\(.context)|\(.app_id)"] | sort,
  strict: .required_status_checks.strict,
  enforce_admins: .enforce_admins.enabled,
  approvals: .required_pull_request_reviews.required_approving_review_count,
  conversation: .required_conversation_resolution.enabled }'
```

Expected: exactly the eight contexts, each with the Actions app id; `strict: true`; `enforce_admins: true`; `approvals: 0`; `conversation: true`. Nothing missing, no advisory context.

- [ ] **Step 2: V2a.** On the proof PR (branch up to date with `main`, no unresolved threads), push proof-matrix row 3 (failing harness), with approval. Expected: both `test` contexts red, every other required context green, and the PR's merge box (`gh pr view <PR> --json mergeStateStatus,statusCheckRollup`) showing `BLOCKED` with the two failing checks. Screenshot or record the JSON. Revert.

- [ ] **Step 3: V2b.** With approval, as an admin, from a scratch clone: commit a trivial change on `main` and `git push origin main`. Expected: the remote rejects with `GH006: Protected branch update failed` (server-side). Record the message. If a local hook (David's push-review gate) blocks the push first, the server never answered: stop and ask David how to run this one probe; do not bypass the hook on your own. Delete the scratch clone afterwards.

- [ ] **Step 4: V3.** The next ordinary PR after arming (a small real change, e.g. lowering the lint baseline after a fix) merges normally once green. Close the proof PR unmerged (`gh pr close <PR> --delete-branch`): merging it would deploy to production.

- [ ] **Step 5: Dependabot under protection.** A Dependabot PR passes every required context and a maintainer merges it normally. Record the PR link.

### Task 20: Agent smoke check and handoff

- [ ] **Step 1: Four sessions.** On David's Mac and Noah's Windows machine, in a fresh checkout of `main`, start a fresh Claude Code session and a fresh Codex CLI session, and ask exactly: "What depth label does a PR that adds a Supabase migration get, and what must it include?" Pass = the answer names `subtle-correctness` and a paired `rollbacks/<stem>.rollback.sql` file. Record pass/fail for all four. A fail means `AGENTS.md` (or `CLAUDE.md`'s import) is not being read: fix that, not the question.

- [ ] **Step 2: Tell the Magora Orchestrator session** the depth-label convention for the Software Roadmap (spec §6 step 10).

- [ ] **Step 3: Record completion.** Check spec §1's four success criteria against the records from Tasks 16–20 and write the outcome into the session handoff.
<!-- proof PR marker -->
