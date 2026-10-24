# magora-portal repo harness — design (Spec 1 of 2)

- **Date:** 2026-10-15
- **Status:** approved rev 6 (David, 2026-10-15); rev 7 records pre-flight results (§3.1) and the
  three amendments they force (§5.1 `deno` row, §5.5 grandfather-list path, §9 finding count)
- **Plan tasks:** H1, H2 of the Magora Consolidated Action Plan (2026-10-09, §08 repo audit)
- **Gate:** G2, 2026-10-30 — harness, PR flow and isolated preview ready before app or site coding
- **Companion:** Spec 2 (staging, plan task E1) is a separate document and is not designed here

This document specifies; it implements nothing. No file, setting or app described here exists yet.

## 1. Goal

Give magora-portal a pull-request flow that two maintainers (David, Noah Waldron) and, later, fork
contributors can work in, where checks that matter actually block a bad merge and every control
lives in GitHub or in files in this repo.

**Success criteria (Spec 1 is done when all hold):**

1. Each required check has been shown to **fail on a defect it exists to catch** before protection
   is armed (§6 step 6).
2. After protection is armed, the gate has been shown to **block** a merge while a required check
   is red and to refuse a direct push to `main`, its required-check list has been read back
   complete, and an ordinary PR has been shown to **merge** once green (§6 step 8).
3. A fork PR has been observed to receive CI and no secrets; a Dependabot PR has been observed to
   pass through the gate.
4. Both maintainers' agents (Claude Code and Codex CLI, on macOS and Windows) have been observed
   to pick up `AGENTS.md` (§6 step 9).

The isolated-preview half of G2 belongs to Spec 2.

## 2. Constraints

- **Two maintainers, two Claude accounts, two OSes.** David develops on macOS, Noah on Windows.
  Both run Claude Code and the Codex CLI.
- **Controls live in GitHub or repo files.** David's personal hooks in `claude-config` (the
  push-review marker gate, the pre-push hook) never reach Noah or forks. They remain optional
  personal aids and are not part of this design.
- **No required approving review (D-7).** David and Noah each merge their own PRs once the
  required checks are green. GitHub never lets an author approve their own PR, so the design
  requires zero approvals rather than self-approval. Merge rights (write access) are the human
  control: fork and Dependabot PRs can only be merged by a maintainer, and that merge is their
  review. No gating status is ever posted by anyone's credential; every required check is a
  GitHub Actions job.
- **Fork safety.** Every PR-triggered workflow uses `pull_request`, never `pull_request_target`.
  The only other trigger in this design is a weekly `schedule` on the OSV scan, which runs on
  `main`, executes no PR code and uses no secret. No `push` triggers. Actions are pinned by full
  commit SHA. `GITHUB_TOKEN` is least-privilege per workflow. No secret is reachable from a fork
  PR's CI.
- **Proof before protection.** Each check is proven to fail on its target defect before
  protection is armed; enforcement is then proven after arming (§6).
- **The repo is already public** (`visibility: public`, measured 2026-10-15) and has no LICENSE.

### 2.1 Trust boundary (what the gate does and does not attest)

A `pull_request` workflow runs the PR's own copy of the workflow YAML. A PR can therefore weaken
a required job (make it skip, or make it always succeed) and still satisfy its context; GitHub
counts a skipped job as passing. Branch protection attests that a check with the right name
reported success, not that the original command ran. The controls for that:

- **Fork and Dependabot PRs:** the maintainer who merges must first read any change to a *control
  file* — `.github/**`, `scripts/run-tests.mjs`, `scripts/ci/**`, `.github/lint-baseline.json`,
  the migration grandfather list, `eslint.config.js`, `AGENTS.md`, `package.json`,
  `scripts/review/**`, `scripts/doc-size-ratchet.py`, `doc-size.conf`. The PR template
  asks the author to declare such changes.
- **A maintainer's own PRs:** trusted (D-7). Nothing stops a maintainer weakening a check in their
  own PR; that is accepted with two maintainers. A control-file change should still be called out
  in the PR description so the other maintainer sees it.

The same applies to `gemini-review.yml`: checking out the base SHA protects the reviewer script,
not the workflow YAML, so a same-repo PR can alter the YAML and reach the Gemini key on its own
run. Same-repo PRs come only from the two maintainers, so this is accepted and recorded, not
prevented.

### 2.2 Fork previews (Vercel)

Vercel builds a preview for every PR, and Preview-scoped env vars include `PROVISION_SECRET`,
`ANTHROPIC_API_KEY` and the production Supabase URL and anon key (§3). Git Fork Protection is on,
so a fork PR's preview is not built until a team member authorizes it — but **authorizing one
runs fork code with those secrets against production**. Vercel skips that authorization when the
commit author is already a Vercel team member; those authors are maintainers and fall under the
trust boundary in §2.1. Until Spec 2 moves Preview to staging:

- **No maintainer authorizes a fork-PR Vercel deployment.** Fork PRs are reviewed from CI and the
  diff only. `AGENTS.md` and `CONTRIBUTING.md` state this.
- Git Fork Protection is read back in §6 step 4 and must stay on; turning it off is a control-file
  change in spirit and needs both maintainers.
- Same-repo (maintainer) previews keep hitting production, as they do today.

## 3. Current state (measured 2026-10-15 unless noted)

| Fact | Evidence |
|---|---|
| `origin/main` = local `main` = `1fae773` | `git fetch` then `git log origin/main` |
| No `.github/` directory, no workflows | `ls .github` → absent |
| No LICENSE, CONTRIBUTING, SECURITY, CODEOWNERS, AGENTS.md, CLAUDE.md | top-level listing |
| Merge methods: merge, squash and rebase all allowed; default branch `main`; public | `gh api repos/magora-project/magora-portal` |
| `package.json` scripts: `dev`, `vendor:build-doc`, `prebuild`, `build`, `lint`, `preview`; no `test` | `package.json` |
| `prebuild` runs `scripts/vendor-build-doc.mjs`, which fetches another repo's mutable `release` ref and rewrites `src/generated/build-doc.js`, falling back to the committed copy on fetch failure; so `build` is network-dependent | read the script (Codex round 1) |
| Plain JavaScript, no TypeScript in the app; Deno TypeScript in `supabase/functions/`, importing `https://esm.sh/@supabase/supabase-js@2` (unpinned minor) | file listing; Codex round 1 |
| Six harnesses `api/**/*.test.mjs`; all six exit 0 locally; only `proxy.test.mjs` uses `fetch`, and stubs it. Imported modules contain network-capable code, so "no network" is not guaranteed | ran each with `node`; Codex round 1 reproduced on Node 22 |
| Other `scripts/*.mjs` (backfills, `verify-reference-audio`, `eval-insight-models`) hit networks, databases or paid models; none matches `*.test.mjs` | Codex round 1 |
| ESLint matches only `**/*.{js,jsx}` with browser globals, so `.mjs` files and Deno `.ts` are not linted | `eslint.config.js` |
| Lint: 29 errors in 9 files — 16 `no-undef` (`process` in Node files under `api/`), 7 `react-hooks/static-components`, 3 `react-hooks/set-state-in-effect`, 2 `react-refresh/only-export-components`, 1 `no-unused-vars` | `npx eslint . -f json` after `npm ci`; reproduced by Codex |
| 17 files under `api/` and `scripts/` carry `/* global process */` (14) or `/* global process, fetch */` (3) comments; adding Node globals turns these into 20 `no-redeclare` errors | grep; Codex reproduced in memory |
| `vite.config.js` proxies dev `/api` to `https://magora-portal.vercel.app` (production) | `vite.config.js` |
| 32 migrations in `supabase/migrations/`, none with a rollback file | listing |
| Edge Functions `provision-node`, `storage-upload` | `supabase/functions/` |
| Vercel project `magora-portal` (team `noah-waldron-s-projects`) is linked to `magora-project/magora-portal`, production branch `main`, with **Git Fork Protection on** (`gitForkProtection: true`): a fork PR's preview is not built until a team member authorizes it | `vercel api /v9/projects/magora-portal`, fields projected, no values read |
| Preview-scoped env vars (names only): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (production project), `ANTHROPIC_API_KEY`, `EBIRD_API_KEY`, `PROVISION_SECRET`, `XENO_CANTO_API_KEY`. `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET` are production-only | same call |

### 3.1 Pre-flight results (§6 step 1, measured 2026-10-15 on macOS, Node 22.23.2)

| Item | Result | Evidence |
|---|---|---|
| `vite build` with no env vars | **Passes** (rc 0); `prebuild` left `src/generated/build-doc.js` byte-identical | `env -i PATH HOME npm run build`, then `cmp` against a copy |
| `deno check` on both functions | **Passes** (rc 0 each) | `deno check supabase/functions/<f>/index.ts`, deno 2.9.5 |
| `deno lint` on both functions | **Fails**: 2 × `no-import-prefix` (the unpinned `https://esm.sh/…` import). With `--rules-exclude=no-import-prefix`: rc 0 | `deno lint supabase/functions/` |
| Supabase CLI and a `rollbacks/` subdirectory | Ignored silently: both CLI implementations skip directories when listing migrations | **Source read, not executed** (Docker was down): `apps/cli-go/pkg/migration/list.go` and `apps/cli/src/command-internal/migration-list.ts` at tag `v2.118.0` (the installed version) |
| Supabase CLI and a non-migration file in `supabase/migrations/` | Skipped, but prints `Skipping migration <name>... (file name must match pattern "<timestamp>_name.sql")` to stderr on every command that lists migrations | same source read |
| Fork-workflow approval policy | Already `first_time_contributors`; no write needed | `GET repos/…/actions/permissions/fork-pr-contributor-approval` |
| Default workflow token | `default_workflow_permissions: read`, cannot approve PRs | `GET repos/…/actions/permissions/workflow` |
| Branch protection on `main` | None | `GET …/branches/main/protection` → 404 "Branch not protected" |
| David's access | `bluemtnswalking1` is repo admin | `GET repos/…/collaborators` |
| Noah's access and both org roles | **Unresolved.** The collaborators listing shows only `bluemtnswalking1`; org membership reads need `admin:org`, which this token lacks. Noah confirms his own access, or an org owner reads it, before PR A merges | same call; `orgs/…/memberships` → 403 scope |
| Installed GitHub Apps | **Unresolved** (needs `admin:org`); the org owner checks in §6 step 2 | — |
| Vercel Node version | `24.x`, so `.nvmrc` is `24` | `vercel api /v9/projects/magora-portal`, `nodeVersion` projected |
| Lint after the D-5 config change | 13 findings, 0 `no-undef`, 0 `no-redeclare`, 0 fatal: 7 `react-hooks/static-components`, 3 `react-hooks/set-state-in-effect`, 2 `react-refresh/only-export-components` (all in `src/`), 1 `no-unused-vars` (in `api/seed-guilds.js`) | applied to a scratch worktree of `1fae773`, `npx eslint . -f json` |

## 4. Decisions taken in the brainstorm

| # | Decision | Rejected alternatives |
|---|---|---|
| D-1 | Two specs: this harness spec, and a separate staging spec (E1). Previews stay production-backed until Spec 2 lands; this spec says so rather than fixing it. | Moving the Vite-proxy repoint into Spec 1. |
| D-2 | **Trunk flow.** Feature branches PR straight to `main`; no long-lived `dev`, no promotion step, no `main → dev` sync. Each PR's Vercel preview is where it is checked. Promotion is selective because each PR merges independently. | method-project's whole-`dev` promotion; a disposable integration `dev`; cherry-pick release PRs. A shared integration branch can be added later if needed. |
| D-3 | **Squash merge only**, delete branch on merge. | Merge-commit only (method-project's promotion rule). |
| D-4 | **Reviewer matrix recycled in two layers** (§5.3): Layer 1 on the PR, Layer 2 as `AGENTS.md` guidance for agents before pushing. | Bots as required checks; Layer 2 as hooks (cannot reach Noah or forks). |
| D-5 | **Lint: fix the config, then ratchet.** Correct globals for Node files, bring `.mjs` into lint, record per-rule counts as a baseline; CI fails if any rule's count rises. The 13 remaining findings (12 in `src/`, 1 in `api/seed-guilds.js`, §3.1) are fixed in their own PRs. | Fix all findings in the harness PR; inline `eslint-disable` with TODOs. |
| D-6 | LICENSE does not block G2; it blocks inviting fork contributors. | — |
| D-7 | **No required approval.** Each maintainer merges their own PR once required checks are green; branch protection still requires a PR (no direct pushes) and green checks. Fork and Dependabot PRs are reviewed by whichever maintainer merges them. | The other maintainer's required approval (the handoff's proposal), which would stop either maintainer merging alone. |
| D-8 | **Post-arm proof is one example per mechanism**: one red check blocks a merge, a direct push is refused, the required-check list is read back complete. Every check's ability to go red is already proven pre-arm. | A post-arm block test for each of the 7 checks (Codex round 2); no post-arm red-check test at all (Gemini). |

## 5. Components

### 5.1 CI — `.github/workflows/ci.yml`

- Trigger: `pull_request` (all branches, types `opened`, `synchronize`, `reopened`,
  `ready_for_review`). No path filters — a filtered workflow leaves required checks pending on
  PRs it skips. Every job runs on every PR, including drafts, docs-only and Dependabot PRs.
- `permissions: contents: read`. No secrets referenced.
- Node version from a checked-in `.nvmrc`; `npm ci`.
- Every check is an npm script implemented in Node (no bash), so it runs the same on Windows.

| Job (context name) | Command | Notes |
|---|---|---|
| `lint (ubuntu-latest)`, `lint (windows-latest)` | `npm run lint:ratchet` | `scripts/ci/lint-ratchet.mjs` runs ESLint with JSON output and compares per-rule counts to `.github/lint-baseline.json`. Fails on any increase. A decrease prints a reminder to lower the baseline in the same PR; it does not fail. **Fails closed** on anything that is not a counted rule violation: a fatal diagnostic or `ruleId: null` (parse errors), ESLint failing to start or exiting for a config error, output that is not valid JSON, or a missing or malformed baseline. ESLint's ordinary "lint errors found" exit is expected and tolerated; the ratchet tells it apart from an execution failure. Its own self-test covers each fail-closed case. |
| `test (ubuntu-latest)`, `test (windows-latest)` | `npm test` | `scripts/run-tests.mjs` finds every `*.test.mjs` outside `node_modules`, runs each with `node` as a child process, and fails if any exits non-zero, if any child fails to launch, or if it found zero files. The runner has its own `scripts/run-tests.test.mjs` covering those three failure modes, so it tests itself. |
| `build` | `npm run build` | Ubuntu only. Must pass with no env vars. `prebuild` fetches the build doc over the network and falls back to the committed copy, so a fetch failure does not fail CI; recorded as existing behaviour. |
| `deno` | `npm run check:deno`: `deno check` on each function's `index.ts`, then `deno lint --rules-exclude=no-import-prefix supabase/functions/` | Deno pinned to 2.9.5. Rev 7: `deno check` passes on current code, so it runs. `deno lint` fails only on `no-import-prefix`, which flags the unpinned `esm.sh` import that §9 leaves out of scope, so that one rule is excluded on the command line; a `deno.json` was not added, so the harness adds no file that Deno's upward config discovery could hand to the function deploy (not tested; avoided). The rule rejects any inline `https:`/`npm:`/`jsr:` specifier, pinned or not (Codex rev-7 round, per Deno's rule docs), so lifting the exclusion needs the functions to declare dependencies in a config and import bare specifiers, or an explicit lint-policy decision; pinning the version alone does not lift it. The exclusion affects lint only, not `deno check`. |
| `migrations` | `npm run check:migrations` | §5.5. |

Exact context names are confirmed from the proof PR (V0), not assumed from this table. Matrix
jobs set `strategy.fail-fast: false`, so one OS failing never cancels the other before it reports.

ESLint config change (D-5): a second config block applying `globals.node` to `api/**`,
`scripts/**` and `**/*.mjs`, widening the file pattern to include `.mjs`, **and deleting the 17
now-redundant `/* global … */` comments**. The baseline is recorded after this, from a fresh run;
it must contain no `no-redeclare` and no `no-undef` entries.

### 5.2 Security

Adapted from `~/method-project/.github/workflows/`, with every Action re-pinned by SHA (the
method-project OSV workflow is tag-pinned) and every helper/config file it reads included:

- `semgrep.yml` on `pull_request`.
- `osv-scan.yml` on `pull_request` **and** a weekly `schedule` (method-project's runs on schedule
  only), plus its `osv-scanner.toml`.
- `.github/dependabot.yml` for `npm` and `github-actions`, with a `cooldown`, and
  `labels: ["standard"]` so every Dependabot PR arrives with exactly one depth label (§5.3).

Semgrep and OSV are **advisory for G2** and are not in D1's required set. Promoting either to
required is a later, separate decision once their false-positive rate on real PRs is known.

### 5.3 Review

**Layer 1 — on every PR, whoever opens it.**

| Reviewer | Role | Blocking? |
|---|---|---|
| The required CI checks (§5.1) and label-gate | The gate | **Yes** |
| The maintainer who merges | Reads bot findings before merging; for fork and Dependabot PRs, also reads control-file changes (§2.1) | By merge rights, not a setting (D-7) |
| CodeRabbit (GitHub App, fleet `.coderabbit.yaml` baseline) | Analyzer-running reviewer | No |
| Codex GitHub App | Cross-vendor correctness | No |
| Gemini (`gemini-review.yml`) | Cross-vendor complement lens, comment-only | No |

No approving review is required (D-7). A maintainer merges their own PR once checks are green.
Two things apply to bot output, and only one is enforced:
- **Enforced:** requiring conversation resolution (§5.7) blocks the merge while any *review
  thread* (an inline comment, including CodeRabbit's or the Codex App's) is unresolved. Replying
  does not clear it; the PR author or someone with write access must mark it resolved — so a fork
  author can resolve bot threads on their own PR. Bot summary comments are not review threads and
  never block.
- **Discipline, not enforced:** the merging maintainer reading the bots' summaries and threads
  (including any the author resolved) and deciding what to act on.

Either maintainer can still ask the other for a review when they want one.

**Gemini workflow.** Triggers `pull_request` types `opened`, `synchronize`, `reopened`,
`ready_for_review`, `labeled`. Runs only when all hold: non-draft; same-repo
(`head.repo.full_name == github.repository`); neither the triggering actor nor the PR author
(`pull_request.user.login`) is `dependabot[bot]` — Dependabot PRs are excluded however they are
labelled; label `subtle-correctness` present; and, on a `labeled` event, the label just added is
`subtle-correctness` (other label additions do not re-run it). Gemini is reachable on Dependabot
PRs only if a maintainer opts in later; that is out of scope. Checks out the **base** SHA for its
helper script, mirroring method-project. The helper script it runs is added in PR B; until PR B
is on `main`, the workflow cannot run (bootstrap, §6). The key is a Magora-owned Actions secret.
**If open decision §8.3 (who owns and pays for the key) is unresolved when PR B is ready, Gemini is
deferred:** `gemini-review.yml` is left out of PR B and added in a follow-up PR once the key
exists. Gemini is advisory, so G2 does not depend on it; Layer 1 then runs with CodeRabbit and the
Codex App.

**Depth labels.** `mechanical`, `standard`, `subtle-correctness`, created in §6 step 4.

**`label-gate.yml`.** Requires exactly one depth label.
- Implemented as a job whose own pass/fail is the check, not a posted commit status: a fork
  PR's `GITHUB_TOKEN` is read-only and cannot write statuses.
- Triggers `pull_request` types `opened`, `synchronize`, `reopened`, `labeled`, `unlabeled`, so
  removing a label re-evaluates.
- Reads the PR's **current** labels from the API (`permissions: pull-requests: read, issues:
  read`) at evaluation time, not the event payload.
- `concurrency` group keyed on workflow, PR number **and head SHA**, with
  `cancel-in-progress: false`. Runs for an older head report against that older SHA and cannot
  touch the current head's check. Runs for the same head queue rather than overlap; GitHub may
  cancel a queued run when a newer one is queued, and the newer one then runs and reads current
  labels. A cancelled run is not an accepted conclusion, so if the latest run on the head is ever
  `cancelled`, recovery is to re-run the job or toggle a label; `CONTRIBUTING.md` says so.
- Fork authors cannot add labels; the reviewing maintainer applies the depth label.
- A first-time contributor's fork runs wait for workflow approval regardless of labels; a
  maintainer approves the run after inspecting the change.

**PR template** (`.github/pull_request_template.md`): depth checkbox, what changed, test
evidence, migration checklist, and "this PR changes control files: yes/no" (§2.1).

**Layer 2 — in `AGENTS.md`, followed by whichever agent is working before it pushes.** This is
the claude-config Grid A matrix, unchanged in substance:

| Depth | Before push |
|---|---|
| `mechanical` | Nothing beyond CI. |
| `standard` | Codex CLI, correctness question. |
| `subtle-correctness` | Codex CLI on correctness, plus a Fable or Opus subagent on the complement lens (completeness, executability, can these tests fail, what did the fixes break). |
| Any depth, author was Codex | Route the review to an Anthropic model instead. |

An empty reviewer completion is an unrun check, not a pass. Layer 2 is discipline, not a control;
Layer 1 is the control.

**Left out on purpose:** the marker gate, the self-posted `codex-review` status, the tier
classifier, the review ledger, auto-merge, wait-for-pr-age, the orchestrator, owner-approval,
issue-closer.

### 5.4 Shared instructions and contributor files

- `AGENTS.md`: the single source for both maintainers' agents and for contributors' agents.
  Contents: commands (`npm ci`, `npm test`, `npm run lint:ratchet`, `npm run build`), the trunk
  flow, depth labels and how to choose one (any PR touching `supabase/migrations/`, `api/` auth
  paths or a control file is `subtle-correctness`), Layer 2, the control-file rule (§2.1), the
  migration rules (§5.5), the
  warning that local `vite dev` and previews hit production until Spec 2, and the rule that agents
  never push without their operator's approval. Codex CLI reads `AGENTS.md` natively.
- `CLAUDE.md`: a thin pointer to `AGENTS.md`, because Claude Code reads `CLAUDE.md`.
- `CONTRIBUTING.md`: fork workflow, depth labels, updating a behind branch (which re-runs CI),
  how to run checks locally on Windows and macOS. Licensing and DCO/CLA
  marked pending (§8).
- `SECURITY.md`: private reporting via GitHub security advisories.
- `doc-size-ratchet.yml` on `AGENTS.md` and `CLAUDE.md`, adapted from method-project with its
  helper script and config included in PR B. **Advisory** (not required): it guards prose size,
  not correctness.

### 5.5 Migration rule, enforced by CI

- `scripts/ci/check-migrations.mjs` fails if a migration file added in the PR has no paired
  rollback file. It discovers only top-level forward migrations (`supabase/migrations/*.sql`) and
  never treats anything under `rollbacks/` as a migration. The 32 existing migrations are
  grandfathered by name in `scripts/ci/migrations-grandfathered.txt` (a control file, §2.1).
  Rev 7: the list moved out of `supabase/migrations/` because the CLI warns about every
  non-migration file there (§3.1).
- Pairing mirrors method-project: `supabase/migrations/<stem>.sql` pairs with
  `supabase/migrations/rollbacks/<stem>.rollback.sql`. Pre-flight (§3.1) read the v2.118.0 CLI
  source: both implementations skip subdirectories, so `rollbacks/` stays. That evidence is a
  source read; the plan executes it once with Docker before PR A merges.
- `AGENTS.md` states: expand/contract for anything a running deploy reads; a migration is never
  applied until its PR is green at its final head. **Where** migrations are applied is Spec 2.

### 5.6 Repo settings (each written in §6 step 4 and read back)

- Squash merge only; auto-delete head branches.
- Dependabot alerts and security updates on.
- Fork-workflow approval: require approval for first-time contributors (at least). The current
  org/repo policy is measured in pre-flight; the write is made only if it is weaker.

### 5.7 Branch protection on `main` (D1)

- Required status checks: **exactly this allowlist**, by the exact names observed at V0 — the
  seven `ci.yml` contexts (`lint` ×2 OS, `test` ×2 OS, `build`, `deno`, `migrations`) plus
  `label-gate` — **each bound to the GitHub Actions app as its source** so no other credential can
  satisfy it. Advisory workflows (Semgrep, OSV, doc-size-ratchet, Gemini) are never on it, even
  though they are observed in §6 step 6.
- Code-owner review and last-push approval: off.
- Require a pull request before merging, with **zero** required approvals (D-7): no direct
  pushes to `main`.
- Require branches up to date before merge.
- Require conversation resolution.
- **Enforce for admins: on** (`enforce_admins: true`, an explicit setting — GitHub exempts admins
  by default). No review bypass is needed because no review is required; the PR requirement,
  required checks and conversation resolution all apply to admins. If a required check wedges,
  the fix is the per-context rollback in §6 step 7.

## 6. Rollout

Order follows `claude-config/scripts/fleet-pr-pipeline/repo-onboarding-checklist.md`, adapted for
two maintainers. Its scripts are hard-wired to owner `bluemtnswalking1` and a solo owner, so the
procedure is reused, not the scripts. **Every push, settings write and app install waits for
David's explicit approval.**

1. **Pre-flight (read-only).** Measure both maintainers' org roles and repo permissions; list
   installed GitHub Apps; read the fork-workflow approval policy; run `vite build` with no env
   vars; run `deno check` on both functions; confirm Supabase CLI behaviour on the full layout
   (`rollbacks/` subdirectory) in a scratch project, recording the CLI version; confirm both
   maintainers have write access. **Done 2026-10-15 except** the two unresolved rows in §3.1 and
   the executed (not source-read) CLI check, which the plan runs before PR A merges.
2. **Human-only steps (org owner).** Install CodeRabbit and the Codex App on `magora-project`,
   scoped to `magora-portal`. If §8.3 is decided, create the Magora-owned Gemini key and store it
   as an Actions secret; otherwise Gemini is deferred (§5.3).
3. **PR A — CI foundation.** ESLint config fix and `global`-comment removal,
   lint baseline and ratchet, test runner and its self-test, migration check and grandfather list,
   `ci.yml`, `.nvmrc`. Acceptance before merge: every `ci.yml` job green on PR A's final head, and
   the bots' findings on that head read and answered. Merged before PR B.
4. **Settings and labels (approved writes, each read back).** Create the three depth labels.
   Write §5.6 settings. Read each back via the API and record the response. Read back Vercel
   `gitForkProtection` (must be `true`, §2.2).
5. **PR B — review, security, contributor files.** Security workflows and
   `osv-scanner.toml`, `dependabot.yml`, `.coderabbit.yaml`, `gemini-review.yml` and its helper
   (only if Gemini is not deferred, §5.3),
   `label-gate.yml`, PR template, `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `SECURITY.md`,
   doc-size-ratchet and its helper. **Bootstrap limitation:** workflows that read
   base-SHA helpers (Gemini, doc-size-ratchet) cannot run on PR B itself, because the helpers are
   not on its base; PR B is reviewed by hand for those, and they are proven in step 6. Acceptance:
   label-gate and every `ci.yml` job green on the final head, and the bots' findings on that head
   read and answered.
6. **Pre-arm proof (no protection yet), on a throwaway proof PR at `subtle-correctness`:**
   - V0: record every check's exact context name.
   - V4: CodeRabbit reviewed this head. V5: the Codex App engaged. Gemini commented (if not
     deferred; if deferred, record that `gemini-review.yml` is absent).
   - V6: CI green. V7: Dependabot alerts and security updates live.
   - **Each required check fails on its target defect**, per the proof matrix below: one defect
     per commit, reverted after each, and the evidence recorded per context name at that head.
   - Rapid label toggling and two quick pushes leave the current head with a conclusive
     label-gate result.
   - From a test fork owned by an account that is **not** a Vercel team member (Vercel skips fork
     authorization for team-member authors): CI runs; Vercel waits for authorization (not given,
     §2.2). No-secret evidence, recorded in three parts: (a) GitHub withholds every secret except a
     read-only `GITHUB_TOKEN` from fork `pull_request` runs — the platform guarantee; (b) a
     by-hand review of every hit of `grep -rn 'secrets' .github/` on `main` (catching
     `secrets.X`, `secrets['X']`, `toJSON(secrets)` and `secrets: inherit`), plus confirmation
     that no job calls a reusable workflow from another repository, shows Gemini is the only
     consumer of a non-`GITHUB_TOKEN` secret (none if Gemini is deferred); (c) Gemini's job is
     skipped on the fork run. Label-gate passes once a maintainer labels the PR.
   - A real Dependabot PR (or the first one to arrive): arrives labelled `standard`, CI runs, and
     (if Gemini is not deferred) Gemini skips — including after a maintainer adds
     `subtle-correctness` to it.

   **Proof matrix** (each row's defect must turn red exactly the contexts in its "expected red"
   cell, and every required context outside that cell must stay green):

   | Defect commit / action | Expected red contexts |
   |---|---|
   | New lint error in a `src/` file | `lint (ubuntu-latest)`, `lint (windows-latest)` |
   | Syntax error in a linted file (ratchet fail-closed) | both `lint` contexts and `build` |
   | Failing assertion in one harness | `test (ubuntu-latest)`, `test (windows-latest)` |
   | Broken import in `src/` that only `vite build` resolves | `build` |
   | Deno type error in a function (`deno check` runs, §5.1 rev 7) | `deno` |
   | New migration without rollback | `migrations` |
   | Labels: zero, then two, then remove the only one (API actions, not commits) | `label-gate` |
7. **D1 — arm protection** with only the contexts proven in step 6, bound to GitHub Actions.
   Rollback if any later step fails: remove the offending required context (onboarding checklist
   §5), never disable protection wholesale.
8. **Post-arm enforcement proof (one-time; D-8):**
   - V1: read protection back and compare with §5.7: the required list equals the §5.7 allowlist
     exactly (nothing missing, no advisory context), each with GitHub Actions as source;
     `enforce_admins` on; zero required approvals; conversation resolution on.
   - V2a: on the proof PR, with the branch up to date and no unresolved review threads, push one
     defect (the failing harness assertion). Pass = `test (ubuntu-latest)` and
     `test (windows-latest)` red, every other required context green, and GitHub's merge box
     naming the failing required checks as the reason it is blocked. Revert.
   - V2b: as an admin, attempt a direct push of a trivial commit to `main`. Pass = GitHub's
     server-side rejection message citing the protected-branch rule (not a local hook or
     authentication failure).
   - V3: the first ordinary PR after D1 (a small real change) merges normally once green. The
     proof PR is closed unmerged, because merging it would deploy to production.
   - Dependabot under protection: a Dependabot PR passes every required context and a maintainer
     merges it normally.
9. **Agent smoke check.** On each maintainer's machine, start a fresh Claude Code session and a
   fresh Codex CLI session in the checkout and ask: "What depth label does a PR that adds a
   Supabase migration get, and what must it include?" **Pass** = the answer names
   `subtle-correctness` and a paired `rollbacks/<stem>.rollback.sql` file. Record pass/fail for
   all four (2 agents × 2 machines).
10. **Tell the Magora Orchestrator session** the depth-label convention for the Software Roadmap.

## 7. Risks

| Risk | Mitigation |
|---|---|
| A required check that never reports wedges every PR | No path filters; require only contexts observed in step 6; per-context rollback |
| A maintainer merges their own change with nobody else reading it | Accepted (D-7). Bots comment on every PR; their inline review threads must be marked resolved before merge (by the author or a maintainer, without necessarily acting — so this is a speed bump, not an enforced review; reading them is maintainer discipline); Layer 2 runs before push; either maintainer can request the other's review |
| A broken CI service wedges an urgent fix | Per-context rollback (§6 step 7), recorded in the PR; protection is never disabled wholesale |
| A maintainer authorizes a fork preview, running fork code with Preview secrets against production | §2.2 rule in `AGENTS.md` and `CONTRIBUTING.md`; Git Fork Protection read back; removed by Spec 2 |
| A PR weakens a required job in its own YAML | Fork/Dependabot: the merging maintainer reads control-file changes (§2.1). Maintainer PRs: trusted, and called out in the description |
| Fork PR reaches a secret | `pull_request` only; Gemini gated to same-repo, non-Dependabot; proven in step 6 |
| Lint ratchet hides new debt in one rule by fixing another | Ratchet is per rule, not total |
| Test runner passes vacuously | Fails on zero files and launch errors; self-tested; sabotage-proven in step 6 |
| `build` depends on a network fetch | Falls back to the committed copy; recorded, not changed here |
| Deno's `esm.sh` import is unpinned | Recorded; pinning is out of scope (a functions change) |
| Previews and local dev still hit production | Documented in `AGENTS.md`; fixed by Spec 2 |

## 8. Open decisions for David and Noah (not decided here)

1. Portal license, and DCO versus CLA. Blocks inviting fork contributors, not G2.
2. ~~Who holds the emergency bypass~~ — resolved by D-7: no review is required, so no review
   bypass is needed. All other protections apply to admins too (§5.7).
3. Who creates and pays for the Magora Gemini key.
4. (Spec 2) the staging domain and who is billed for the staging Supabase project.
5. Whether the PWA-versus-native decision changes the repo layout. The Field App repo comes later,
   from a harness kit extracted after G2.

## 9. Out of scope

Everything in Spec 2: the baseline migration for the five production-only tables, the staging
Supabase project and Fly worker, Vercel Preview env vars, repointing the Vite proxy, the CI
isolation check, RLS tests. Also fixing the 13 remaining lint findings (12 in `src/`: 10
React-hooks, 2 react-refresh; 1 unused variable in `api/seed-guilds.js`) in separate PRs, and
pinning the Deno `esm.sh` import and lifting the `no-import-prefix` exclusion (which needs more than pinning, §5.1).

## 10. Review log

| Round | Reviewer | Result | Disposition |
|---|---|---|---|
| 1 | Codex CLI (`codex exec`, 102,798 tokens) on rev 1 | REWORK, 11 findings (6 P1, 4 P2, 1 P3) | All 11 accepted after checking against the repo and method-project: dropped `push` trigger; label-gate events, live labels and concurrency; split pre-arm proof from post-arm enforcement with per-cause isolation; enumerated helper files, OSV trigger and pins, bootstrap limitation; PR A/B reviewer, acceptance and merge order; settings writes and readbacks, Actions source binding; trust boundary §2.1; Dependabot label and Gemini exclusion; `global`-comment removal; agent smoke check and Supabase CLI proof; script list and lint counts. |
| 2 | Codex CLI on rev 2 (fix-verification prompt) | REWORK, 6 findings (1 P1, 4 P2, 1 P3); 7 of 11 round-1 items closed, 3 partial, 1 not closed | All 6 accepted: per-context proof matrix with `fail-fast: false`, Deno mode matched, label actions replayed separately, fresh approval per post-arm case; ratchet fails closed on fatal/null-rule/invocation/baseline errors; label-gate concurrency keyed on head SHA without cancel-in-progress, plus recovery; Gemini excludes Dependabot-authored PRs and non-`subtle-correctness` label events; Dependabot proven under armed protection; smoke check has a fixed question and pass rule (and `AGENTS.md` now states the depth rule it tests). |
| 3 | Gemini (`gemini-3.1-pro-preview`, `gemini_review.py`, rc 0, `finishReason=STOP`) on rev 3, fitness/executability/human-factors prompt | BLOCK, 6 findings (1 P0, 3 P1, 2 P2) | P0 "fork PRs auto-deploy production-connected previews": premise refuted by measurement (Git Fork Protection is on, so fork previews need authorization), but the conclusion partly holds — an authorized fork preview gets Preview secrets including `PROVISION_SECRET` — so §2.2 added (no fork-preview authorization until Spec 2; read-back). Two-spec split kept, pending David. P1 proof-matrix contradiction: fixed. P1 Gemini key undecided: Gemini deferred if §8.3 is open. P1 security-check criteria: Semgrep/OSV advisory for G2. P2 bypass by toggling: replaced with a named bypass allowance. P2 "cut V2b": **contradicts Codex round 2** (which required per-check post-arm proof); surfaced to David, not decided. |
| 4 | Codex CLI on rev 4 (diff + full spec; D-7/D-8 consistency, Gemini fixes) | REWORK, 5 findings (all P2) plus an admin-enforcement note | All accepted: conversation resolution described as enforced-for-review-threads only; Gemini proof steps conditional on deferral, with a secrets grep as fork evidence; V2a/V2b pass conditions made attributable; required checks defined as an explicit allowlist excluding advisory workflows; `enforce_admins` made an explicit setting with readback; Vercel team-member exception documented and the fork proof uses a non-team account. |
| 5 | Codex CLI on rev 5 (its rev-4 findings + full spec) | REWORK, 2 findings (both P2); all 5 rev-4 findings and the admin note closed or partially closed | Both accepted: no-secret evidence is now platform guarantee + by-hand review of every `secrets` hit and reusable-workflow calls + skipped Gemini job; thread resolution correctly attributed to "PR author or write access", and its "forces a look" claim removed. |
| 6 | Codex CLI (`codex exec -s read-only`, 42,121 tokens) on the rev 6→7 diff + full spec; reproduced the lint counts and both `deno check` passes; could not execute the CLI layout check (sandbox EPERM on `~/.supabase/telemetry.json`) | REWORK, 2 findings (1 P2, 1 P3) | Both accepted: removal condition for the `no-import-prefix` exclusion corrected (pinning alone does not lift it); D-5's finding count corrected. Grandfather-list move: no new hole. |
| 7 | Codex CLI (`-s read-only`, 28,136 tokens), fix-verification on round 6 | PASS; both findings closed, no new inconsistency | — |
| — | David, 2026-10-15 | Decisions | Post-arm proof: middle option (D-8). No required approval; each maintainer merges their own PRs (D-7) — supersedes the handoff's other-maintainer approval; CODEOWNERS and the bypass decision dropped as a result. Fork-preview rule (§2.2) kept. |
| 8 | Opus subagent (final whole-branch review of PR B) + Codex CLI | With fixes | Control-file list extended with `package.json`, `scripts/review/**`, `scripts/doc-size-ratchet.py`, `doc-size.conf` (a merged weakening of these affects every later PR; `scripts/review/**` runs with `GEMINI_API_KEY`); AGENTS.md states the Dependabot `standard` exception. |
