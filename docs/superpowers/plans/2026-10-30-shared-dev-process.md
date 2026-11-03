# magora-portal Shared Development Process Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax; track them in your session, never by editing this file (see Global Constraints).

**Goal:** Move the development process into the repo so that every developer, on Windows or macOS, runs the same stages, and so that a skipped spec, plan, conformance, pre-push or PR-stage review blocks the merge through two new required checks, `review-evidence` and `review-gate`.

**Architecture:** A committed `.claude/` carries the settings, Node hooks, repo skills, slot prompts and process rules. Local reviews run through one Node runner, `scripts/review/review.mjs`, which spawns the reviewer, classifies the outcome mechanically, and writes a JSON record into `.review/`. Two `pull_request` workflows run pure Node checkers: `review-evidence` judges the local records against the PR's live input identity and body fields, and `review-gate` judges the committed PR review record against live bot state read from the GitHub API. Steps on David's machine, in claude-config, or in GitHub settings are **operator steps**.

**Tech Stack:** Node 24 ESM (`.nvmrc`), no new dependencies; git ≥ 2.40 (`git patch-id --verbatim`); GitHub Actions; Codex CLI ≥ 0.161 (`codex exec --output-schema`); Claude Code ≥ 2.1 (`claude -p`); Gemini API (`streamGenerateContent`, as `gemini_review.py`); Semgrep CLI; `gh`.

**Spec:** `docs/superpowers/specs/2026-10-29-shared-dev-process-design.md` (rev 5, approved 2026-10-29). Read it before any task. §N below refers to the spec's sections.

## Global Constraints

- **Agents never push, merge, change repo settings or branch protection, or edit `~/.claude-b` or `~/code/claude-config` without David's explicit approval, one approval per action** (AGENTS.md). Each operator step below is one such action.
- Everything a developer runs is Node (`.mjs`), and works on Windows and macOS (§5.8). The one exception is the promotion script, which lives in claude-config and runs on David's Mac only. (The plan's own verification steps may run existing CI scripts such as `scripts/doc-size-ratchet.py` on the executor's Mac; those are not developer tooling.)
- Node spawns external tools with an argument array and `shell: false`. Git is called as `git` (Git for Windows ships `git.exe`). Paths are joined with `node:path`, and records store repo paths with `/`.
- Evidence directory: `.review/` (§7, decided below). Nothing else is excluded from the input identity (§5.3).
- Slot IDs, verbatim: `spec`, `plan`, `conformance`, `correctness`, `completeness`, `substitute:coderabbit`, `substitute:codex`, `substitute:gemini` (§5.3).
- Outcomes, verbatim: `completed`, `failed`, `refused`, `truncated`, `timeout` (§5.3).
- Lane values, verbatim: `specced`, `direct`, `docs-only`, `dependency` (§5.2).
- Blocking by default: Codex P0–P2; CodeRabbit Critical and Major; every Gemini finding; local-record findings P0–P2; anything whose severity cannot be parsed. Nit by default: Codex P3; CodeRabbit Minor, Nitpick, Trivial; local P3 (§5.6).
- Bot logins, read 2026-10-30: `coderabbitai[bot]`, `chatgpt-codex-connector[bot]`, `github-actions[bot]` (Gemini comments).
- Substitution timeout: 30 minutes after the head commit's push, or after a full-review request (§5.5, §7).
- Gemini's diff limit is 400,000 bytes; over it, the PR is split (§5.5). No chunking.
- Actions are pinned by full SHA with the tag in a comment, using the pins in `ci.yml`: `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1`, `actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0`.
- New workflows trigger on `pull_request` only, never `pull_request_target`, and post no status with any credential: each job's own pass or fail is the check (§2.1). Each job reads PR state live from the API, not the event payload (the `label-gate.mjs` pattern).
- `AGENTS.md` is size-ratcheted (`doc-size.conf`): every edit is byte-neutral or smaller. Process rules that do not fit go in `.claude/rules/process.md` (§5.7).
- Tests follow `scripts/ci/label-gate.test.mjs`: a `*.test.mjs` beside the module, a local `ok(name, cond)` counter, stubbed `fetchImpl` and stubbed spawns, and an `ok` that **counts a thenable `cond` as a failure** ("unawaited Promise"), because a Promise is truthy even when it resolves to `false`: every async assertion is written `ok(name, await …)`, non-zero exit on any failure. The snippets below abbreviate: `slotState` (`s`), `evaluateGate`, `diffTooLarge`, `geminiDiff`, `claudeRun` and the other adapters are async, so await every call before reading a property, and write negative checks as `=== false` or an expected value, never `!x.ok` or `!==`, which pass on `undefined`. Tests that need a real git repo build one in `mkdtemp` and delete it.
- Every PR in this plan is `subtle-correctness`: each touches `AGENTS.md`, `.github/**`, `package.json`, `scripts/review/**` or `.claude/**`, which are or become control files. Each PR description says which control files it changes.
- `npm run lint:ratchet` stays green; new files add no ESLint findings (Task 1 narrows ESLint's `.claude` ignore so the hooks are linted).
- **The committed plan and spec are not edited for progress.** Executors track checkboxes in their own session, not in the file: any edit changes the blob and voids the `spec`/`plan` records every later PR relies on (§5.3). Only rulings and amendments edit them, each inside the PR that owns the edit (Task 0 → PR D, Task 20), followed by a chained `plan`/`spec` re-review.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; PR bodies end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

## Verified before planning (2026-10-30)

Each fact below was measured while planning. Rows marked **spec deviation** contradict a spec sentence; the plan follows the measured behaviour and **needs David's ruling before PR D starts** (Task 0).

| # | Spec item | Finding | Source |
|---|---|---|---|
| V1 | §5.3 identity | One `git patch-id --stable` line is printed for a whole multi-file diff. A `main` commit that renames the enclosing function and shifts lines above the PR's hunk leaves the ID unchanged (patch-id ignores hunk-header context as well as line numbers). Changing `--src-prefix`/`--dst-prefix` **changes** the ID, so user git config (`diff.noprefix`, `diff.mnemonicPrefix`, `diff.renames`, `diff.algorithm`) must be overridden by flags. An empty diff prints nothing. | Scratch repo, git 2.50.1 |
| V2 | §5.5 Codex coverage, **spec deviation** | A clean Codex App review submits **no review object**. It edits one summary issue comment carrying `<!-- codex-review-state:v1 {"code_review":{"commit_sha":…,"has_any_findings":…,"status":"completed"}} -->`. PR #43's Codex review exists only there. Coverage by "the latest review's `commit_id`" would never cover a clean Codex review, so the gate could block forever (an anti-goal). Plan: Codex coverage comes from this machine marker (the comment's `updated_at` is its time) or from a non-empty Codex review object, whichever is later. | `issues/43/comments`, `issues/44/comments`, `pulls/43/reviews` |
| V3 | §5.5 CodeRabbit failure, **spec deviation** | CodeRabbit posts no commit status here. It posts a **check run** named `CodeRabbit` (app `coderabbitai`), whose `conclusion` and `output.title` carry the signal: PR #44's head shows `skipped` / "No files to review". Plan: failure is read from that check run. | `commits/<sha>/check-runs` on #43, #44 |
| V4 | §5.5 "an empty review" as failure, **spec deviation** | Empty reviews are routine: on #43, CodeRabbit submitted three empty-body reviews on `ed7a13a` (thread replies) after its 11,585-byte review, and David's three thread replies are empty reviews too. Treating an empty review as a terminal failure would demand substitution on almost every PR. Plan: an empty review is never usable and never a failure signal; it is ignored. | `pulls/43/reviews` |
| V5 | §5.5 no-loop guarantee, **spec deviation** | `gemini-review.yml` re-runs on every `synchronize` and reviews the whole diff, so an evidence-only commit would get a fresh Gemini run with new finding indices, which would fail the gate until the record is updated, which is another commit. That is a loop. Plan: Gemini's verdict marker carries the input identity, and the workflow skips the model call when a usable verdict for the same identity already exists. No finding is ever dropped: the gate collects findings from every usable Gemini verdict on the PR. | `gemini-review.yml` triggers |
| V6 | §3 "re-reviews only after a nudge" | The Codex App also reviews on new commits here ("Review trigger: New commits" on #44). The design is unaffected: an evidence-only commit keeps the identity, and findings located only in `.review/` are outside the gate. | `issues/44/comments` |
| V7 | §3 claude-b inventory | `~/.claude-b` has 12 symlinks, not 10: also `plans` → `~/code/claude-memory/plans/claude-b` and `reflections`. Task 8 enumerates links live rather than from the spec's list. Spec §3 corrected 2026-11-01. | `ls -la ~/.claude-b` |
| V8 | §5.8 "Node 22" | `.nvmrc` is `24` and CI uses it. The plan uses Node 24; `CONTRIBUTING.md` says 24. Spec §5.8 corrected 2026-11-01. | `.nvmrc` |
| V9 | §5.7 skills | The personal `writing-plans` (220 KB with assets) and `codex-review` (196 KB) depend on bash scripts and `~/code/claude-config` paths. Neither can be vendored as-is for Windows. | `find ~/code/claude-config/skills/<name>` |
| V10 | §5.7 committed `.claude/` | `scripts/run-tests.mjs` skips `.claude` wholesale, so hook tests under `.claude/hooks/` would never run. Task 1 narrows the skip to `.claude/worktrees`. | `scripts/run-tests.mjs:10` |

## Decisions the spec left to the builder (§7)

| Item | Decision |
|---|---|
| Evidence directory | `.review/`. Local records: `.review/records/<slotfile>--<id12>--<n>.json`, where `<slotfile>` is the slot ID with `:` replaced by `-` (Windows forbids `:` in filenames), `<id12>` is the first 12 characters of the input identity, and `<n>` is the next free integer. PR review record: `.review/pr/<pr-number>.json`. |
| Record schema | JSON, `schema: 1`, defined in Task 11. |
| Stable finding IDs | Bot thread finding: `thread:<GraphQL node id>`. CodeRabbit outside-diff finding: `cr:<marker>`, the marker format pinned in Task 21 from a live comment. Gemini: `gemini:<id12>:<index>`. Local record: `<record file stem>#<finding id>`. |
| `pull_request_review` attachment | Verified on a test PR in Task 24. Fallback either way: the PR review record is written after triage, and committing it fires `synchronize`. |
| Substitution timeout | 30 minutes. |
| Pre-push hook install | `npm run setup:hooks` sets `core.hooksPath=.githooks`. Explicit, listed in `CONTRIBUTING.md`; not run by `npm ci`. |
| Plugin shadowing | A committed PreToolUse hook on the `Skill` tool denies `superpowers:brainstorming` and `superpowers:writing-plans` and names the project skill to use instead. The superpowers plugin stays enabled, because stage 6 uses its `subagent-driven-development`. |
| Vendored vs trimmed skills | None is vendored as-is (V9). `brainstorming` and `push-readiness` are trimmed copies of the personal skills; `writing-plans`, `codex-review` and `conformance` are written for the repo around the Node tools. |

## Review Focus

Inputs the spec implies but its own tests would not meet, most likely first. Each names the task whose test pins it.

1. **Two machines compute different identities for the same PR.** One developer has `diff.noprefix=true`, another `diff.renames=copies`, a third `diff.algorithm=histogram` (V1). Expected: `inputIdentity` passes `--no-renames --diff-algorithm=myers --src-prefix=a/ --dst-prefix=b/ --no-textconv --no-ext-diff --binary --no-color -U0` and runs git with `-c core.quotePath=true`, so all three get the same ID. Pinned in Task 10.
2. **A PR whose only non-evidence change is empty.** A branch that adds only `.review/` files, or a PR rebased until its own diff vanished. `git patch-id` prints nothing (V1). Expected: identity is the literal `empty`, and `review-evidence` fails a `specced` or `direct` PR whose identity is `empty` with "PR has no changes outside .review/". Pinned in Tasks 10 and 15.
3. **A slot ID with a colon on Windows.** `substitute:coderabbit` as a filename fails on NTFS. Expected: the store writes `substitute-coderabbit--…json`, reads the slot from the JSON body, and never from the filename. Pinned in Task 11.
4. **A bot review on a commit that no longer exists after a force-push.** The review's `commit_id` cannot be fetched, so its identity cannot be computed. Expected: that review is not usable for coverage (never a crash), and the gate's message tells the author to request a full review (§5.5). Pinned in Task 22.
5. **A CRLF PR body, or a body edited in GitHub's web editor.** `Lane: specced\r\n` must parse; so must surrounding Markdown such as `**Lane:** specced` or a list bullet. Expected: the body parser trims `\r`, accepts the field with or without bold and bullet, and an unknown lane value fails with the allowed values listed. Pinned in Task 14.

---

## File map

| File | Task | Responsibility |
|---|---|---|
| `scripts/run-tests.mjs` (+ test), `.gitignore` | 1 | Find tests under `.claude/`; commit `.claude/` |
| `.claude/settings.json` | 2, 3 | Project hooks |
| `.claude/hooks/lane-threshold.mjs` (+ test) | 2 | Lane declaration reminder (§5.2) |
| `.claude/hooks/skill-shadow.mjs` (+ test) | 3 | Deny the plugin skills the repo replaces |
| `.claude/rules/process.md`, `AGENTS.md` | 4, 20 | Process rules; pointers; control-file list; Codex App guidance |
| `.claude/skills/{brainstorming,writing-plans,push-readiness}/SKILL.md` | 5, 18 | Repo skills |
| `.githooks/pre-push`, `scripts/hooks/pre-push.mjs` (+ test), `scripts/hooks/setup.mjs` | 6 | Warning pre-push hook and its installer |
| `.github/pull_request_template.md`, `CONTRIBUTING.md` | 7 | PR fields; prerequisites; onboarding |
| `docs/process/claude-b-inventory.md` | 8 | What claude-b kept, and where each moved rule lives |
| `scripts/review/identity.mjs` (+ test) | 10 | Input identity |
| `scripts/review/records.mjs` (+ test) | 11 | Record schema, store, chain heads |
| `scripts/review/runner.mjs`, `scripts/review/adapters/{codex,claude,gemini}.mjs` (+ tests) | 12 | Run a reviewer; classify the outcome |
| `scripts/review/review.mjs` (+ test) | 12, 13, 18, 23 | CLI: `run`, `dispose`, `conformance`, `pr-record`, `check` |
| `.claude/review/slots/*.md`, `.claude/skills/codex-review/SKILL.md`, `scripts/review/semgrep-artifact.mjs` (+ test) | 13 | Slot prompts; review skill; Semgrep on spec/plan code blocks |
| `scripts/review/pr-body.mjs` (+ test) | 14 | PR body fields |
| `scripts/ci/review-evidence.mjs` (+ test), `.github/workflows/review-evidence.yml` | 15 | The `review-evidence` check |
| `scripts/review/plan-targets.mjs` (+ test) | 17 | Typed targets; plan-review reference check |
| `scripts/review/conformance.mjs` (+ test), `.claude/skills/conformance/SKILL.md` | 18 | Conformance postconditions and record |
| `.coderabbit.yaml`, `.github/workflows/gemini-review.yml`, `scripts/review/gemini_review.py` | 20 | Bots skip `.review/`; Gemini verdict marker; identity skip |
| `scripts/review/github.mjs` (+ test), `scripts/review/severity.mjs` (+ test) | 21 | Live bot state; severity defaults |
| `scripts/review/coverage.mjs` (+ test) | 22 | Slot coverage and substitution |
| `scripts/review/pr-record.mjs` (+ test), `scripts/ci/review-gate.mjs` (+ test), `.github/workflows/review-gate.yml` | 23 | PR review record; the `review-gate` check |
| `package.json` | 6, 12 | `setup:hooks`, `review` scripts |

## PRs

| PR | Rollout step (§6) | Tasks | Label |
|---|---|---|---|
| A: repo layer | 1 | 1–7, with operator Tasks 8–9 between commit and push | `subtle-correctness` |
| B: evidence and `review-evidence` | 2 | 10–15 | `subtle-correctness` |
| C: typed targets and conformance | 3 | 17–18, then operator Task 16 (activation, after PR C merges) and Task 19 (first promotion) | `subtle-correctness` |
| D: PR review record and `review-gate` | 4 | 20–23, then operator Task 24 | `subtle-correctness` |

Task 0 is a ruling, Task 25 is Noah's onboarding (rollout step 6), and rollout step 7 is a conversation. None opens a PR. PRs B–D are grandfathered from the check they introduce only until it is required. `review-evidence` becomes required in Task 16, which runs **after PR C merges** (its specced activation PR needs PR C's conformance writer and the spec/plan records PR C's bootstrap creates). PR C still carries its own evidence (Task 18 Step 6), judged by the check while it is not yet required; from Task 16 on, PR D is judged by the required check.

---

## Task 0 (operator): Rule on the spec deviations

- [ ] **Step 1 (David):** accept or reject V2–V5 in "Verified before planning". Each accepted row becomes a one-line amendment in spec §5.5, committed with PR D (Task 20 owns the edit). A rejected row returns that part of §5.5 to design before Task 21 starts.
- [ ] **Step 2:** record the ruling and its date in this plan under V2–V5, as a commit in PR D (Task 20 Step 6 makes the spec edit in the same PR), then run the chained `plan` and `spec` re-reviews (`--supersedes`) in PR D; the plan re-review is an amendment, so it passes `--tasks T20-T25` (Task 17).

PRs A–C do not depend on Task 0 and may start before it.

---

## Phase 1: Repo layer (PR A, rollout step 1)

### Task 1: Commit `.claude/`, and find its tests

**Files:**
- modify: `scripts/run-tests.mjs`
- modify: `scripts/run-tests.test.mjs`
- modify: `.gitignore`
- modify: `eslint.config.js`
- command: `npm test`

**Interfaces:**
- Produces: `SKIP_DIRS` keeps `node_modules`, `.git`, `dist`, `.vercel`; new `SKIP_PATHS = new Set(['.claude/worktrees'])`, matched against the `/`-joined path relative to the root.

- [ ] **Step 1: Write the failing tests** in `scripts/run-tests.test.mjs`, building a temp tree:

```js
ok('finds a test under .claude/hooks', findTests(root).includes('.claude/hooks/x.test.mjs'))
ok('skips .claude/worktrees entirely', !findTests(root).some((f) => f.startsWith('.claude/worktrees/')))
ok('a directory merely named worktrees elsewhere is not skipped', findTests(root).includes('src/worktrees/y.test.mjs'))
```

- [ ] **Step 2: Run `node scripts/run-tests.test.mjs`.** Expected: FAIL on the first case.
- [ ] **Step 3: Implement** the `SKIP_PATHS` check in `findTests`' walk; update the `.claude` comment.
- [ ] **Step 4a: Edit `eslint.config.js`:** change `globalIgnores(['dist', '.vercel', '.claude'])` to `globalIgnores(['dist', '.vercel', '.claude/worktrees'])`, and update its comment. Run `npm run lint:ratchet`; expected: exit 0 (no `.claude` code exists yet).
- [ ] **Step 4: Edit `.gitignore`:** replace `.claude/` with `.claude/worktrees/` and `.claude/settings.local.json` (§5.7). Keep `scripts/__pycache__/`.
- [ ] **Step 5: Run `npm test`.** Expected: exit 0. Run `git status --porcelain --ignored .claude` in the worktree; expected: `.claude/worktrees/` listed as ignored, nothing else under `.claude/` ignored.
- [ ] **Step 6: Commit** (`build(process): commit .claude/ and run its tests`).

### Task 2: Lane-threshold hook in Node

**Files:**
- existing: `~/code/claude-config/hooks/spec_plan_threshold.sh` (source of the text; read, not copied as code)
- create: `.claude/hooks/lane-threshold.mjs`
- create: `.claude/hooks/lane-threshold.test.mjs`
- create: `.claude/settings.json`
- command: `npm test`

**Interfaces:**
- Produces: `.claude/settings.json` with `hooks.UserPromptSubmit` → `node "$CLAUDE_PROJECT_DIR/.claude/hooks/lane-threshold.mjs"`. Task 3 adds to the same file.
- Produces: `laneReminder() -> string` (the text), and a `main({stdin, stdout, env})` that drains stdin, writes `{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext": laneReminder()}}`, and exits 0.

- [ ] **Step 1: Write the failing test:**

```js
ok('emits the reminder as additionalContext', JSON.parse(out).hookSpecificOutput.additionalContext.includes('Specced'))
ok('names the lanes the PR body uses', /specced.*direct.*docs-only.*dependency/s.test(laneReminder()))
ok('says a request that changes nothing owes no declaration', /changes nothing/.test(laneReminder()))
ok('garbage stdin still emits, exit 0', runWith('garbage').code === 0)
ok('kill-switch LANE_THRESHOLD_DISABLE=1 emits nothing, exit 0', runWith('{}', { LANE_THRESHOLD_DISABLE: '1' }).out === '')
ok('a closed stdout does not throw', !throws(() => main({ stdin: '{}', stdout: closedStream() })))
```

- [ ] **Step 2: Run it.** Expected: FAIL (module not found).
- [ ] **Step 3: Implement.** The reminder text is the personal hook's substance (§5.2): Specced tested first and wins overlap; the Specced triggers; config is Specced unless literally a comment; Direct list; unsure ⇒ Specced; the hook does not classify; no declaration owed for a request that changes nothing. Add one line mapping lanes to the PR `Lane:` field. Point at `.claude/rules/process.md` § Lanes, not at claude-config. Every internal failure exits 0 with no output.
- [ ] **Step 4: Run `npm test`.** Expected: exit 0.
- [ ] **Step 5: Commit** (`feat(process): lane-threshold hook in Node`).

### Task 3: Skill-shadow guard

**Files:**
- create: `.claude/hooks/skill-shadow.mjs`
- create: `.claude/hooks/skill-shadow.test.mjs`
- modify: `.claude/settings.json`
- command: `npm test`

**Interfaces:**
- Produces: `SHADOWED = { 'superpowers:brainstorming': 'brainstorming', 'superpowers:writing-plans': 'writing-plans' }`; `decide(payload) -> null | { permissionDecision: 'deny', permissionDecisionReason: string }`. `settings.json` gains `hooks.PreToolUse` with matcher `Skill`.

- [ ] **Step 1: Write the failing test:**

```js
ok('denies superpowers:writing-plans, naming the project skill', /writing-plans/.test(decide({ tool_name: 'Skill', tool_input: { skill: 'superpowers:writing-plans' } }).permissionDecisionReason))
ok('allows the project skill', decide({ tool_name: 'Skill', tool_input: { skill: 'writing-plans' } }) === null)
ok('allows other plugin skills', decide({ tool_name: 'Skill', tool_input: { skill: 'superpowers:subagent-driven-development' } }) === null)
ok('ignores other tools', decide({ tool_name: 'Bash', tool_input: { command: 'superpowers:writing-plans' } }) === null)
ok('malformed payload: allow, exit 0', runWith('[]').code === 0 && runWith('[]').out === '')
```

- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement.** On deny, print `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":…}}`, exit 0. Any parse failure allows (the guard steers; it is not a security boundary).
- [ ] **Step 4: Run `npm test`.** Expected: exit 0.
- [ ] **Step 5: Commit** (`feat(process): route plan and brainstorm skills to the repo copies`).

### Task 4: Process rules and `AGENTS.md`

**Files:**
- create: `.claude/rules/process.md`
- modify: `AGENTS.md`
- existing: `doc-size.conf`
- command: `python3 scripts/doc-size-ratchet.py --base origin/main --head HEAD`

**Interfaces:**
- Produces: `.claude/rules/process.md` sections, by these exact headings (later tasks and skills link to them): `## Lanes`, `## Stages`, `## Review slots and dispatch`, `## What blocks`, `## Stop rule`, `## Evidence`, `## Promotion`.

- [ ] **Step 1: Write `.claude/rules/process.md`.** Content from spec §5.1 (stage table, as a numbered list), §5.2 (lane threshold and PR fields), §5.3 (slots, the depth → slot list, the dispatch table, the `completeness` third-vendor rule), §5.6 (blocking table, reclassifying, pre-existing, the stop rule), §5.5 matrix, and §5.7 promotion (one paragraph). Each section cites its spec section. No rule from claude-config that the spec does not carry.
- [ ] **Step 2: Edit `AGENTS.md`, byte-neutral or smaller.** Add `.claude/**` to the control-file list (§5.7). Replace the "Review before push" column of the depth table with one sentence pointing at `.claude/rules/process.md` § Review slots and dispatch; drop the paragraph beginning "If Codex wrote the change", whose rule moves there. Add one line under Flow: "Process: `.claude/rules/process.md`. Every agent follows it; Claude Code loads the repo skills from `.claude/skills/`."
- [ ] **Step 3: Commit** (`docs(process): process rules in .claude/rules; AGENTS.md points at them`).
- [ ] **Step 4: Run `python3 scripts/doc-size-ratchet.py --base origin/main --head HEAD`** on the commit just made (the ratchet reads committed objects, so it must run after the commit). Expected: exit 0. If it fails, trim `AGENTS.md` and `git commit --amend` after checking `git log -1` is this task's commit. CI's `doc-size-ratchet` job is the check; this is the early read.

### Task 5: Repo skills (brainstorming, writing-plans, push-readiness)

**Files:**
- existing: `~/code/claude-config/skills/brainstorming/SKILL.md`
- existing: `~/code/claude-config/skills/push-readiness/SKILL.md`
- create: `.claude/skills/brainstorming/SKILL.md`
- create: `.claude/skills/writing-plans/SKILL.md`
- create: `.claude/skills/push-readiness/SKILL.md`
- create: `scripts/review/skills.test.mjs`
- command: `npm test`

**Interfaces:**
- Produces: three skills whose frontmatter `name` equals the directory name. Task 18 extends `writing-plans` with typed targets.

- [ ] **Step 1: Write the failing test** `scripts/review/skills.test.mjs`, which walks `.claude/skills/*/SKILL.md`:

```js
ok('the three required skills exist', ['brainstorming', 'writing-plans', 'push-readiness'].every((n) => skills.some((s) => s.dir === n)))
ok('removing any one required skill fails the check', ['brainstorming', 'writing-plans', 'push-readiness'].every((n) => requiredSkillsPresent(skills.filter((s) => s.dir !== n)) === false))
ok('every skill has frontmatter name equal to its directory', skills.every((s) => s.frontmatter.name === s.dir))
ok('no skill references ~/code or claude-config', skills.every((s) => !/~\/code|claude-config|\.claude-[a-z]\b/.test(s.body)))
ok('no skill tells the agent to run bash or a .sh script', skills.every((s) => !/\bbash\b|\.sh\b/.test(s.body)))
ok('every repo-relative path a skill names exists (and the extractor found some)', (() => { const paths = skills.flatMap((s) => s.repoPaths); return paths.length > 0 && paths.every((p) => existsSync(p)) })())
```

  `repoPaths` are backticked tokens containing `/` that start with `.claude/`, `scripts/`, `docs/` or `.github/`.

- [ ] **Step 2: Run it.** Expected: FAIL on "the three required skills exist" and on "every repo-relative path a skill names exists (and the extractor found some)" (no skills yet, so no paths; the other assertions are vacuously true on an empty set, which is why those two exist).
- [ ] **Step 3: Write `brainstorming`:** the personal skill trimmed. Its terminal step invokes the repo `writing-plans`; spec review runs `npm run review -- run --slot spec --path <spec> --author <vendor>`, where `<vendor>` is the vendor of the model that wrote the doc: `anthropic` for Claude Code, `openai` for Codex, `none` when a person wrote it by hand (Task 12's `pickReviewer` turns it into the reviewer) (it names no file that a later task creates, so the Step 1 path test holds; until PR B lands, the skill says that command is not available yet and to run Codex CLI by hand). Spec files save to `docs/superpowers/specs/`.
- [ ] **Step 4: Write `writing-plans`:** the superpowers skill's structure (header, Global Constraints, Review Focus, task structure, self-review, execution handoff), plus: plans save to `docs/superpowers/plans/`; plan review runs `npm run review -- run --slot plan --path <plan> --author <vendor>` (same `--author` rule and caveat as Step 3); when the plan is already on `main` (an amendment), add `--tasks <the tasks not yet landed>`, or `--tasks none`.
- [ ] **Step 5: Write `push-readiness`:** the personal skill trimmed to git commands that run identically in PowerShell and zsh (no pipes into `grep`/`awk`; use `git` flags). Its checks: branch is not `main`; `git fetch` then ahead/behind of `origin/main`; working tree clean; every slot the depth needs has a record for the current identity (`npm run review -- check --local`, from Task 15; until then, say so in one line). Tasks 13 and 15 update these skills to name the review files once they exist.
- [ ] **Step 6: Run `npm test`.** Expected: exit 0.
- [ ] **Step 7: Commit** (`feat(process): repo brainstorming, writing-plans and push-readiness skills`).

### Task 6: Warning pre-push hook

**Files:**
- create: `.githooks/pre-push`
- create: `scripts/hooks/pre-push.mjs`
- create: `scripts/hooks/pre-push.test.mjs`
- create: `scripts/hooks/setup.mjs`
- modify: `package.json`
- command: `npm test`

**Interfaces:**
- Consumes (once PR B lands): `localCheck({cwd}) -> {ok: boolean, lines: string[]}` from `scripts/ci/review-evidence.mjs` (Task 15). Before then, the hook imports it dynamically and prints "review-evidence not available yet" if the import fails.
- Produces: `npm run setup:hooks` → `node scripts/hooks/setup.mjs`, which runs `git config core.hooksPath .githooks` and prints the value read back.

- [ ] **Step 1: Write the failing test:**

```js
ok('always exits 0, even when the check fails', (await runHook({ localCheck: () => ({ ok: false, lines: ['x'] }) })).code === 0)
ok('prints the failing lines as a warning', /WARNING.*x/s.test((await runHook({ localCheck: () => ({ ok: false, lines: ['x'] }) })).err))
ok('a throwing check still exits 0', (await runHook({ localCheck: () => { throw new Error('boom') } })).code === 0)
ok('missing check module: one line, exit 0', (await runHook({ localCheck: null })).code === 0)
```

- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement.** `.githooks/pre-push` is a POSIX `sh` shim, `exec node scripts/hooks/pre-push.mjs "$@"`, committed with mode 100755 (`git update-index --chmod=+x`). Git for Windows runs `sh` hooks. Add `"setup:hooks": "node scripts/hooks/setup.mjs"` to `package.json`.
- [ ] **Step 4: Run `npm test`.** Expected: exit 0. Run `git ls-files -s .githooks/pre-push`; expected: mode `100755`.
- [ ] **Step 5: Commit** (`feat(process): warning pre-push hook through core.hooksPath`).

### Task 7: PR template fields and `CONTRIBUTING.md`

**Files:**
- modify: `.github/pull_request_template.md`
- modify: `CONTRIBUTING.md`

**Interfaces:**
- Produces: the field lines Task 14 parses, exactly: `Lane:`, `Spec:`, `Plan:`, `Deviations:`. The `Plan:` value is `<path> <task list>`, where the task list is comma-separated `T<n>` or ranges `T<n>-T<m>`. `Deviations:` is followed by one `- <deviation id>: <justification>` line per entry, or `none`.

- [ ] **Step 1: Edit the template.** Add a `## Process` section above `## Depth` with the four fields, each with a one-line comment giving the allowed values. Extend the control-file list with `.claude/**`.
- [ ] **Step 2: Edit `CONTRIBUTING.md`.** Add `## Prerequisites` (Claude Code; Codex CLI signed in; Semgrep; Node 24; Deno 2.9.5; `gh`; a Gemini key from the Gemini account David set up, D-15) and `## First run` (`npm ci`, `npm run setup:hooks`, then start Claude Code in the repo and check that `/skills` lists `brainstorming` and `writing-plans` as project skills). Add `## Fork PRs` for maintainers: a fork's content is untrusted code, and supplying its evidence runs it locally (conformance `command` targets, `npm test`, and `.githooks/pre-push` on the evidence push), and almost any changed file can execute (imported modules, lint and build configs, lockfile dependencies, `.claude/` hooks and skills, and a `.githooks/post-checkout` on checkout itself), so read the PR's whole diff before checking it out (PR page, or `git fetch` + `git diff`), and before an install, test, lint, build, agent session or push from the checkout (spec §5.3, D-11). Link `.claude/rules/process.md`.
- [ ] **Step 3: Commit** (`docs(process): PR process fields and developer prerequisites`).

### Task 8 (operator): Unlink claude-b (D-12)

Runs after Tasks 1–7 are committed in the worktree and before PR A is pushed, so that the repo skills can be verified as the ones that load (Task 9).

- [ ] **Step 1 (agent, read-only):** list every symlink: `find ~/.claude-b -maxdepth 1 -type l -exec ls -l {} \;`. Expected: 12 links (V7). Write the list into `docs/process/claude-b-inventory.md` as a table: link, target, action (`copy-trimmed`, `copy-whole`, `drop`).
- [ ] **Step 2 (agent):** propose the trim per link. Kept layer (§5.7): secrets handling, machine safety and local guards, push approval, shell and platform rules. Removed: every personal skill whose name matches a repo skill (`brainstorming`, `writing-plans`, `codex-review`, `push-readiness`, `conformance`), and every process rule now in `.claude/rules/process.md`. For each removed rule, the inventory names where it now lives. David reviews the proposal.
- [ ] **Step 3 (David, approved):** for each link, `cp -RL <link> <link>.frozen && rm <link> && mv <link>.frozen <link>`, then apply the approved trims to the copies. `settings.json` is copied before any edit, because today it **is** claude-config's file.
- [ ] **Step 4 (read back):** `find ~/.claude-b -maxdepth 1 -type l` prints nothing; `git -C ~/code/claude-config status --porcelain` is unchanged from before Step 3.
- [ ] **Step 5:** commit the inventory to PR A (`docs(process): claude-b unlink inventory`). Restart the claude-b session.

### Task 9 (operator): Verify which skills load (macOS)

- [ ] **Step 1:** in a fresh claude-b session rooted in the PR A worktree, run `/skills`. Expected: `brainstorming`, `writing-plans`, `push-readiness` listed as project skills; no personal skill of those names.
- [ ] **Step 2:** ask the session to invoke `superpowers:writing-plans`. Expected: the Task 3 hook denies it, naming `writing-plans`.
- [ ] **Step 3:** send any prompt. Expected: the lane reminder arrives from `.claude/hooks/lane-threshold.mjs` (its text names `.claude/rules/process.md`, which the personal one does not).
- [ ] **Step 4:** record the three results in the PR A description. Then push PR A with David's approval (Codex CLI correctness review, plus an Opus or Fable completeness review, per today's `subtle-correctness` rule).

---

## Phase 2: Evidence and `review-evidence` (PR B, rollout step 2)

### Task 10: Input identity

**Files:**
- create: `scripts/review/identity.mjs`
- create: `scripts/review/identity.test.mjs`
- command: `npm test`

**Interfaces:**
- Produces:
  - `EVIDENCE_DIR = '.review'`
  - `DIFF_ARGS` (exported array, the exact flags below)
  - `mergeBase({cwd, base, head}) -> Promise<string>`
  - `inputIdentity({cwd, base, head}) -> Promise<string>`: 40-hex patch ID, or `'empty'`
  - `blobIdentity({cwd, rev, path}) -> Promise<string>`: `git rev-parse <rev>:<path>`
  - `geminiDiff({cwd, base, head}) -> Promise<Buffer>`: the single builder for Gemini's input, `git diff --no-ext-diff --no-color --src-prefix=a/ --dst-prefix=b/ <base>...<head> -- . ':(exclude).review'`. Used by `gemini-review.yml` (Task 20), the local Gemini adapter (Task 12) and `diffTooLarge` (Task 22), so all three measure the same bytes.
  - `git(args, {cwd}) -> Promise<{code, stdout: Buffer, stderr}>`: spawns `git -c core.quotePath=true -c core.autocrlf=false <args>` with `shell: false`

- [ ] **Step 1: Write the failing tests.** Each builds a scratch repo with `git init` and commits with `-c user.name=t -c user.email=t@t`:

```js
ok('same PR change -> same identity after main renames the enclosing function and shifts lines', idBefore === idAfterMerge)
ok('main edits a line adjacent to the PR line -> unchanged', idBefore === idAdjacent)
ok('PR changes one more line -> changed', idBefore !== idMore)
ok('an evidence-only commit voids nothing', idBefore === idAfterEvidenceCommit)
ok('a PR whose only change is under .review/ -> "empty"', idEvidenceOnly === 'empty')
ok('diff.noprefix=true in repo config -> same identity', idBefore === idNoPrefix)
ok('diff.renames=copies and diff.algorithm=histogram -> same identity', idBefore === idUserConfig)
ok('diff.interHunkContext=5 in repo config, two PR edits three lines apart -> same identity as with it unset', idTwoEdits === idTwoEditsInterHunk5)
ok('a binary file change has an identity, and changing its bytes changes it', idBin1 !== idBin2)
ok('an indentation-only change to an added line -> changed', idIndent4 !== idIndent8)
ok('the same two-file change in either file order -> same identity', idOrderXY === idOrderYX)
ok('blobIdentity equals git hash-object of the committed bytes', blob === hashObject)
ok('CRLF working tree with autocrlf=true does not change the identity', idBefore === idCrlfCheckout)
```

- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement.** `DIFF_ARGS = ['diff', '-U0', '--no-ext-diff', '--no-textconv', '--binary', '--no-color', '--no-renames', '--diff-algorithm=myers', '--inter-hunk-context=0', '--src-prefix=a/', '--dst-prefix=b/']`. `--inter-hunk-context=0` overrides a user's `diff.interHunkContext`, which `-U0` does not: with it set to 5, two edits three lines apart became one hunk carrying the lines between them, and the patch ID changed (measured on git 2.50.1, PR #52 Codex). `inputIdentity` runs `git <DIFF_ARGS> <merge-base> <head> -- . ':(exclude).review'`, pipes stdout into `git patch-id --verbatim` (not `--stable`, which strips whitespace, so `return True` moved from four to eight spaces kept its ID; `--verbatim` is file-order stable, measured on git 2.50.1, and cannot be combined with `--stable`), and returns the first field, or `'empty'` when patch-id prints nothing. The merge base is recomputed on every call (D-10); it is provenance only. **Known limitation (accepted by David 2026-11-02, PR #52 CodeRabbit):** the identity has no location, so the same edit moved to another identical line elsewhere in the PR keeps its identity, and its earlier reviews stay valid. Adding line numbers would break D-10 (a `main` change above the PR's lines would void its reviews). It needs a follow-up commit that moves an edit onto another identical line, deliberately or by accident. That case is an accepted exception to §2.1's guarantee that a forgotten step cannot merge: a developer who relocates an edit that way and forgets to re-review is not caught. No test pins it.
- [ ] **Step 4: Run `npm test`.** Expected: exit 0, on macOS here and on `windows-latest` in CI.
- [ ] **Step 5: Commit** (`feat(review): input identity from the PR's own diff`).

### Task 11: Records and the store

**Files:**
- create: `scripts/review/records.mjs`
- create: `scripts/review/records.test.mjs`
- command: `npm test`

**Interfaces:**
- Produces the record (`schema: 1`), written as a TypeScript type for precision; the code is plain JS:

```ts
type ReviewRecord = {
  schema: 1,
  type: 'spec' | 'plan' | 'conformance' | 'prepush' | 'substitute',
  slot: 'spec' | 'plan' | 'conformance' | 'correctness' | 'completeness' | 'substitute:coderabbit' | 'substitute:codex' | 'substitute:gemini',
  input: { kind: 'pr' | 'blob', identity: string, path?: string, mergeBase?: string, head?: string },
  reviewer: { vendor: 'openai' | 'anthropic' | 'google', model: string },
  authorVendor: 'openai' | 'anthropic' | 'google' | 'none',   // 'none': written by hand, or by Dependabot
  outcome: 'completed' | 'failed' | 'refused' | 'truncated' | 'timeout',
  verdict: 'pass' | 'fail' | null,
  findings: [{ id: string, severity: 'P0' | 'P1' | 'P2' | 'P3', file?: string, line?: number, summary: string,
               disposition?: { kind: 'fixed' | 'pre-existing' | 'reclassified-nit' | 'justified-deviation', by?: string, reason?: string, issue?: string } }],
  supersedes: string | null,          // file stem of the record this one replaces
  conformance?: { tasks: string[], deviations: string[], commands: [{ cmd: string, exit: number }] },
  createdAt: string,                  // ISO 8601
}
```

- Produces:
  - `slotFile(slot) -> string`: `:` → `-`
  - `writeRecord({cwd, record}) -> string` (path written); `readRecords({cwd}) -> Record[]` (each with `stem`)
  - `chainHeads(records) -> Record[]`: records that no other record supersedes
  - `isBlockingByDefault(finding) -> boolean`: `P0`–`P2`, or an unknown severity
  - `dispositionOk(finding, {deviations = []} = {}) -> boolean`: non-blocking; or `fixed` with `by` naming the **re-review record** that verified it (only the runner sets this, from a re-review's `inherited` assessment, Task 12); or `pre-existing` with `reason` and `issue`; or `reclassified-nit` with `reason`; or, in a `conformance` record only, `justified-deviation`, accepted when the finding's ID appears in the PR body's `Deviations:` with a non-empty justification (§5.4)
  - `inherit(oldRecord) -> Finding[]`: undisposed blocking findings, IDs prefixed `<old stem>#`, except a **gate ID** (one starting `thread:`, `cr:` or `gemini:`, which only `substitute:*` records carry, Task 22). A gate-ID finding is carried with its ID unchanged **whatever its disposition**: an undisposed one is inherited for re-assessment as usual; one already `fixed` is copied with its disposition (its `by` still names the record that verified it) and is **not** sent to the reviewer or counted in `inheritedIds`. So a finding verified by one substitute review stays verifiable at the chain head after any later one (resolves the former OPEN point 2)
  - `validateRecord(obj) -> string[]` (problems; empty when valid)

- [ ] **Step 1: Write the failing tests:**

```js
ok('substitute:coderabbit writes substitute-coderabbit--<id12>--1.json', basename(p) === `substitute-coderabbit--${id.slice(0, 12)}--1.json`)
ok('slot is read from the body, not the filename', readRecords({ cwd }).find((r) => r.stem === renamedStem).slot === 'correctness')
ok('a second record for the same slot and identity gets --2', basename(p2).endsWith('--2.json'))
ok('chainHeads drops a superseded record', chainHeads([a, b]).map((r) => r.stem).join() === b.stem)
ok('inherit carries an undisposed P1 and drops a fixed one', inherit(rec).map((f) => f.id).join() === `${rec.stem}#F1`)
ok('inherit keeps a gate ID unprefixed', inherit(subRec).map((f) => f.id).join() === 'thread:PRRT_abc')
ok('inherit copies a fixed gate-ID finding with its disposition, and still drops a fixed ordinary one', (() => { const out = inherit(subRecWithFixedGateAndFixedF1); const g = out.find((f) => f.id === 'thread:PRRT_fixed'); return g && g.disposition.kind === 'fixed' && g.disposition.by === subRecWithFixedGateAndFixedF1.stem && !out.some((f) => f.id.endsWith('#F1')) })())
ok('a justified conformance deviation listed in Deviations is acceptable', dispositionOk({ id: 'D1', severity: 'P1', disposition: { kind: 'justified-deviation' } }, { deviations: [{ id: 'D1', justification: 'plan used X; Y is simpler and tested' }] }))
ok('justified-deviation absent from Deviations is not acceptable', dispositionOk({ id: 'D1', severity: 'P1', disposition: { kind: 'justified-deviation' } }, { deviations: [] }) === false)
ok('pre-existing without an issue is not an acceptable disposition', dispositionOk({ severity: 'P1', disposition: { kind: 'pre-existing', reason: 'x' } }) === false)
ok('severity "high" is blocking by default (unparseable)', isBlockingByDefault({ severity: 'high' }))
ok('validateRecord rejects an unknown outcome, naming the field, and accepts the base fixture', validateRecord(good).length === 0 && validateRecord({ ...good, outcome: 'ok' }).some((p) => /outcome/.test(p)))
ok('records are written with LF and a trailing newline', readFileSync(p, 'utf8').endsWith('}\n') && !readFileSync(p, 'utf8').includes('\r'))
```

- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement.** `JSON.stringify(record, null, 2) + '\n'`. `readRecords` reads `.review/records/*.json` only; a file that fails `validateRecord` is returned with `invalid: problems` so the checker can fail on it by name.
- [ ] **Step 4: Run `npm test`.** Expected: exit 0.
- [ ] **Step 5: Commit** (`feat(review): record schema and evidence store`).

### Task 12: Reviewer runner and adapters

**Files:**
- create: `scripts/review/runner.mjs`
- create: `scripts/review/runner.test.mjs`
- create: `scripts/review/adapters/codex.mjs`
- create: `scripts/review/adapters/claude.mjs`
- create: `scripts/review/adapters/gemini.mjs`
- create: `scripts/review/adapters/adapters.test.mjs`
- create: `scripts/review/verdict.schema.json`
- existing: `scripts/review/gemini_review.py`
- create: `scripts/review/review.mjs`
- modify: `package.json`
- command: `npm test`

**Interfaces:**
- Consumes: `inputIdentity`, `blobIdentity` (Task 10); `writeRecord`, `inherit`, `readRecords`, `chainHeads` (Task 11).
- Produces:
  - `verdict.schema.json`: `{ verdict: 'pass' | 'fail', findings: [{ id, severity, file?, line?, summary }], inherited: [{ id, status: 'resolved' | 'open', note }] }`. `inherited` is required (possibly empty) and must name every inherited ID exactly once; a re-review that omits one is `refused`. The writer turns each `resolved` into `disposition: { kind: 'fixed', by: <new record stem> }` and carries each `open` forward undisposed.
  - each adapter exports `vendor` and `run({prompt, timeoutMs, spawnImpl?, fetchImpl?}) -> Promise<{exitCode, stdout, truncated: boolean, timedOut: boolean}>`
    - `codex`: `codex exec --sandbox read-only --output-schema <schema> -o <tmpfile> -` with the prompt on stdin
    - `claude`: `claude -p --model opus --output-format json`, prompt on stdin; `--model` overridable to `fable`. The adapter unwraps the envelope's `.result` string before `classifyOutcome` sees it; `is_error: true` → exit code 1
    - `gemini`: Node port of `gemini_review.py`'s request (same endpoint, `DEFAULT_MODEL = 'gemini-3.1-pro-preview'`, `GEMINI_API_KEY` from env, never logged). As in the Python, only a stream whose final `finishReason` is `STOP` can complete: `MAX_TOKENS` → `truncated`; a missing finish reason, a dropped stream, a non-2xx response or any other reason (`SAFETY`, …) → `failed`, whatever text arrived. Its diff comes from `geminiDiff` (Task 10); it refuses one over 400,000 bytes before any request
  - `classifyOutcome({exitCode, stdout, truncated, timedOut, inheritedIds = []}) -> {outcome, verdict, findings, inherited}`: `timeout` if timed out; else `truncated`; else `failed` on non-zero exit; else `refused` when stdout holds no JSON object matching the schema; else `completed`
  - `pickReviewer({authorVendor, slot, otherVendor?}) -> 'codex' | 'claude' | 'gemini'`: the dispatch table (§5.3); `authorVendor: 'none'` takes Codex as primary and satisfies independence with any vendor; `completeness` takes a vendor that is neither `authorVendor` nor `otherVendor` (for `'none'`, any vendor other than `otherVendor`). **`substitute:*` slots are the exception to the author-vendor rule** (§5.5 lets the author's vendor substitute, and all three vendors are needed when every bot fails): the runner neither picks nor refuses by `authorVendor` for them, `--reviewer` is required, and independence is judged by the gate's `countedVendors` rule (Task 22), not here. Every other slot refuses a `--reviewer` of the author's vendor before spawning (resolves the former OPEN point 3)
  - CLI `node scripts/review/review.mjs run --slot <slot> --author <vendor> [--reviewer <name>] [--path <spec-or-plan>] [--supersedes <stem>]`, also `npm run review -- …`. For a PR slot it builds the prompt from `.claude/review/slots/<slotfile>.md` (Task 13) plus the diff; with `--supersedes` it sends the inherited findings and asks for each one's disposition. It sends the delta between the two identities' diffs alone only when the superseded record's `outcome` is `completed` **and** it passes on no undisposed blocking finding. With an inherited undisposed finding it sends the full current input plus the delta, marked as such, because a delta that does not touch a finding cannot show it fixed (PR #52, Gemini: a dummy commit's delta let a substitute mark a bot finding resolved). For any other outcome (`failed`, `refused`, `truncated`, `timeout`) it sends the full current input, because nobody reviewed the earlier one: a retry with no edits in between would otherwise review an empty delta and pass. By induction, a completed chain head always covers the whole input (§5.3).
  - CLI `review.mjs dispose --record <stem> --finding <id> --kind pre-existing|reclassified-nit|justified-deviation --reason <text> [--issue <url>]`. It cannot set `fixed`: only a chained re-review can (§5.6).

- [ ] **Step 1: Write the failing tests:**

```js
ok('timed out -> timeout, whatever stdout says', classifyOutcome({ exitCode: 0, stdout: passJson, truncated: false, timedOut: true }).outcome === 'timeout')
ok('exit 0 with prose and no JSON -> refused', classifyOutcome({ exitCode: 0, stdout: 'I cannot review this', truncated: false, timedOut: false }).outcome === 'refused')
ok('exit 1 with zero findings -> failed, not pass', classifyOutcome({ exitCode: 1, stdout: '{"verdict":"pass","findings":[]}', truncated: false, timedOut: false }).outcome === 'failed')
ok('MAX_TOKENS -> truncated', classifyOutcome({ exitCode: 0, stdout: passJson, truncated: true, timedOut: false }).outcome === 'truncated')
ok('valid JSON -> completed with findings', classifyOutcome({ exitCode: 0, stdout: failJson, truncated: false, timedOut: false }).findings.length === 2)
ok('Claude-authored correctness -> codex', pickReviewer({ authorVendor: 'anthropic', slot: 'correctness' }) === 'codex')
ok('Codex-authored correctness -> claude', pickReviewer({ authorVendor: 'openai', slot: 'correctness' }) === 'claude')
ok('hand-written (none) correctness -> codex', pickReviewer({ authorVendor: 'none', slot: 'correctness' }) === 'codex')
ok('claude adapter unwraps .result and maps is_error to exit 1', (await claudeRun(envelopeError)).exitCode === 1 && (await claudeRun(envelopeOk)).stdout === innerJson)
ok('completeness takes the third vendor', pickReviewer({ authorVendor: 'anthropic', slot: 'completeness', otherVendor: 'openai' }) === 'gemini')
ok('--reviewer of the author vendor is refused before spawning', spawned.length === 0 && /independence/.test(err))
ok('substitute slot: --reviewer of the author vendor spawns through the real runner (stubbed spawnImpl only)', await (async () => { const sp = []; await runCli(['run', '--slot', 'substitute:codex', '--author', 'anthropic', '--reviewer', 'claude'], { spawnImpl: recordSpawn(sp, envelopeOk) }); return sp.length === 1 && /claude/.test(sp[0].cmd) })())
ok('substitute slot without --reviewer is refused, naming the flag', /--reviewer/.test(await errOfCli(['run', '--slot', 'substitute:codex', '--author', 'anthropic'])))
ok('gemini: a 400,001-byte diff makes no request', fetchCalls.length === 0)
ok('gemini: the API key never appears in stdout, stderr or the record', !all.includes('KEY123'))
ok('codex: spawned with shell:false and the prompt on stdin, not argv', spawnArgs.opts.shell === false && !spawnArgs.argv.join(' ').includes(promptMarker))
ok('run with --supersedes inherits an undisposed finding into the new record', newRec.findings.some((f) => f.id === `${old.stem}#F1`))
ok('--supersedes of a timed-out root with no edits since sends the full current diff, not the empty delta', await (async () => { const sent = []; await runCli(['run', '--slot', 'correctness', '--author', 'anthropic', '--supersedes', timedOutRoot.stem], { spawnImpl: capturePrompt(sent, envelopeOk) }); return sent.length === 1 && sent[0].includes(fullCurrentDiff) })())
ok('--supersedes of a completed record with an undisposed blocking finding sends the full current diff and the delta', await (async () => { const sent = []; await runCli(['run', '--slot', 'substitute:gemini', '--author', 'anthropic', '--reviewer', 'claude', '--supersedes', completedRootWithOpen.stem], { spawnImpl: capturePrompt(sent, envelopeOk) }); return sent.length === 1 && sent[0].includes(fullCurrentDiff) && sent[0].includes(deltaOnly) })())
ok('--supersedes of a completed record with no undisposed finding sends only the delta', await (async () => { const sent = []; await runCli(['run', '--slot', 'correctness', '--author', 'anthropic', '--supersedes', completedRoot.stem], { spawnImpl: capturePrompt(sent, envelopeOk) }); return sent.length === 1 && sent[0].includes(deltaOnly) && sent[0].includes(fullCurrentDiff) === false })())
ok('re-review marking the inherited finding resolved -> disposition fixed by the new record', newRecResolved.findings.find((f) => f.id === `${old.stem}#F1`).disposition.by === newRecResolved.stem)
ok('re-review that omits an inherited ID -> refused', classifyOutcome({ exitCode: 0, stdout: passJsonNoInherited, truncated: false, timedOut: false, inheritedIds: ['x#F1'] }).outcome === 'refused')
ok('dispose cannot set fixed', /only a re-review/.test(disposeErr))
ok('gemini: valid verdict JSON in a stream with no finish reason -> failed', geminiOutcome(streamNoFinish) === 'failed')
ok('gemini: finishReason SAFETY -> failed', geminiOutcome(streamSafety) === 'failed')
```

- [ ] **Step 2: Run them.** Expected: FAIL. Also confirm the test file's `ok` rejects a Promise: `ok('x', Promise.resolve(false))` must count as a failure (Global Constraints).
- [ ] **Step 3: Implement.** The `run` and `--supersedes` tests stub the slot prompt (a `promptFor(slot)` parameter on the runner), because the slot files arrive in Task 13. Default timeout 20 minutes, `--timeout-min` overrides. On Windows, the adapters resolve `codex.cmd`/`claude.cmd` shims through `where` and spawn the shim's target `node` script directly, so no shell is needed; when only an unresolvable shim exists, fail with a message naming the install (`npm i -g @openai/codex`). Add `"review": "node scripts/review/review.mjs"` to `package.json`.
- [ ] **Step 4: Run `npm test`.** Expected: exit 0.
- [ ] **Step 5: Commit** (`feat(review): local reviewer runner with mechanical outcomes`).

### Task 13: Slot prompts, the `codex-review` skill, Semgrep on artifacts

**Files:**
- modify: `.claude/skills/brainstorming/SKILL.md`
- modify: `.claude/skills/writing-plans/SKILL.md`
- create: `.claude/review/slots/spec.md`
- create: `.claude/review/slots/plan.md`
- create: `.claude/review/slots/conformance.md`
- create: `.claude/review/slots/correctness.md`
- create: `.claude/review/slots/completeness.md`
- create: `.claude/review/slots/substitute.md`
- create: `.claude/skills/codex-review/SKILL.md`
- create: `scripts/review/semgrep-artifact.mjs`
- create: `scripts/review/semgrep-artifact.test.mjs`
- modify: `scripts/review/skills.test.mjs`
- command: `npm test`

**Interfaces:**
- Consumes: `review.mjs run` (Task 12).
- Produces: `extractBlocks(markdown) -> [{lang, code, line}]`; `scanArtifact({path, spawnImpl?}) -> {ran: boolean, findings: [], reason?}`. `ran: false` with `reason: 'no code blocks'` is reported as UNRUN, never as a pass.

- [ ] **Step 1: Write the failing tests:**

```js
ok('extracts fenced blocks with their language and line', extractBlocks(md).map((b) => `${b.lang}:${b.line}`).join() === 'js:3,yaml:9')
ok('a doc with no code blocks -> ran:false, UNRUN', scanArtifact({ path: noCode }).ran === false)
ok('semgrep exit 1 with findings JSON -> findings returned, ran:true', r.ran && r.findings.length === 1)
ok('semgrep missing -> ran:false with the install hint', /semgrep/.test(missing.reason))
ok('every slot ID has a prompt file (substitute:* share substitute.md)', SLOTS.every((s) => existsSync(`.claude/review/slots/${s.startsWith('substitute:') ? 'substitute' : s}.md`)))
ok('every slot prompt ends by requiring the verdict JSON', slotPrompts.length > 0 && slotPrompts.every((p) => p.includes('verdict.schema.json')))
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Write the slot prompts.** Each states the question and the output contract (the JSON of `verdict.schema.json`, severity P0–P3 per `.claude/rules/process.md` § What blocks). `correctness`: does the diff do what it claims, without breaking anything. `completeness`: is anything the spec or plan promised missing, can the tests fail, what did the fixes break. `spec` and `plan`: the reviews David runs today (correctness and feasibility; for a plan, also task targets and executability). `conformance`: lists every deviation in both directions with an ID `D<n>`, and traces each stated safeguard to code or test (§5.4). `substitute.md`, one file for all three `substitute:<bot>` slots with `{{bot}}` filled in by the runner: a full review of the current identity, standing in for that bot, which also assesses the bot's inherited findings. Update the `brainstorming` and `writing-plans` skills (Task 5) to name `.claude/skills/codex-review/SKILL.md` and `scripts/review/review.mjs` now that they exist, and drop their "not available yet" caveat. `push-readiness` waits for Task 15.
- [ ] **Step 4: Write `codex-review`.** It picks the slot from the depth and stage, runs `npm run review -- run …` (always with `--author <vendor>`; for a `plan` slot on a plan already on `main`, also `--tasks <the tasks not yet landed>` or `--tasks none`, which the CLI requires, Task 17), reads the record, and on a failed or non-`completed` outcome falls back to the next reviewer in the dispatch table (§5.3). It never reports an unrun review as a pass. For spec and plan slots it runs `scanArtifact` first and records UNRUN when there is nothing to scan.
- [ ] **Step 5: Implement `semgrep-artifact.mjs`.** Write each block to a temp dir with an extension from its language, run `semgrep scan --config p/default --json --metrics=off <dir>`, map findings back to the Markdown line.
- [ ] **Step 6: Run `npm test`.** Expected: exit 0.
- [ ] **Step 7: Commit** (`feat(review): slot prompts, codex-review skill, Semgrep on artifacts`).

### Task 14: PR body fields

**Files:**
- create: `scripts/review/pr-body.mjs`
- create: `scripts/review/pr-body.test.mjs`
- command: `npm test`

**Interfaces:**
- Produces: `parseBody(body: string, {author}) -> { lane, spec, plan: {path, tasks: string[]} | null, deviations: [{id, justification}], problems: string[] }`. For `author === 'dependabot[bot]'` with no `Lane:` field, `lane` is `'dependency'` and no problem is raised. `expandTasks('T1-T3,T6') -> ['T1','T2','T3','T6']`.

- [ ] **Step 1: Write the failing tests:**

```js
ok('CRLF body parses', parseBody('Lane: specced\r\nSpec: docs/s.md\r\nPlan: docs/p.md T1-T2\r\nDeviations: none\r\n', { author: 'a' }).problems.length === 0)
ok('bold and bullet forms parse', parseBody('- **Lane:** direct\n- **Deviations:** none', { author: 'a' }).lane === 'direct')
ok('unknown lane lists the allowed values', /specced, direct, docs-only, dependency/.test(parseBody('Lane: big', { author: 'a' }).problems.join()))
ok('specced without Plan -> problem', parseBody('Lane: specced\nSpec: docs/s.md\nDeviations: none', { author: 'a' }).problems.some((p) => /Plan/.test(p)))
ok('range expands', expandTasks('T1-T3,T6').join() === 'T1,T2,T3,T6')
ok('a reversed range is a problem, not an empty list', /range/.test(parseBody('Lane: specced\nSpec: s\nPlan: p T3-T1\nDeviations: none', { author: 'a' }).problems.join()))
ok('deviation lines parse', parseBody('Lane: specced\nSpec: s\nPlan: p T1\nDeviations:\n- D1: plan used X; Y is simpler and tested', { author: 'a' }).deviations[0].id === 'D1')
ok('a deviation without a justification is a problem', parseBody('Lane: specced\nSpec: s\nPlan: p T1\nDeviations:\n- D1:', { author: 'a' }).problems.some((p) => /D1/.test(p)))
ok('dependabot body with no fields -> dependency lane', parseBody('Bumps idb …', { author: 'dependabot[bot]' }).lane === 'dependency')
ok('HTML comments from the template are ignored', parseBody('<!-- Lane: specced -->\nLane: direct\nDeviations: none', { author: 'a' }).lane === 'direct')
```

- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement.** Strip `<!-- … -->` first; match `^\s*(?:[-*]\s+)?(?:\*\*)?(Lane|Spec|Plan|Deviations):(?:\*\*)?\s*(.*)$`, case-sensitive field names.
- [ ] **Step 4: Run `npm test`.** Expected: exit 0.
- [ ] **Step 5: Commit** (`feat(review): parse the PR body's process fields`).

### Task 15: The `review-evidence` check

**Files:**
- create: `scripts/ci/review-evidence.mjs`
- create: `scripts/ci/review-evidence.test.mjs`
- create: `.github/workflows/review-evidence.yml`
- modify: `scripts/review/review.mjs`
- modify: `.claude/skills/push-readiness/SKILL.md`
- modify: `.gitignore`
- modify: `AGENTS.md`
- command: `npm test`

**Interfaces:**
- Consumes: Tasks 10, 11, 14.
- Produces:
  - `requiredSlots({lane, depth, changedDocs}) -> [{slot, input}]`, per the §5.3 table: `specced` → `spec` and `plan` for the current blobs of the linked docs, `conformance` for the declared tasks, pre-push by depth (`standard`: `correctness`; `subtle-correctness`: `correctness` and `completeness`); `docs-only` → `spec`/`plan` for each spec or plan the PR adds or changes; `direct` → pre-push by depth; `dependency` → one `correctness`.
  - `evaluate({records, required, identity, body, authorVendorOf}) -> {ok, lines: string[]}`, applying the four-part predicate (§5.3) to the chain head for each required slot and input. For `completeness`, its reviewer's vendor must differ from both the author's and the `correctness` head's reviewer.
  - `isGrandfathered({prCreatedAt, requiredSince}) -> boolean`: true only when `requiredSince` is a valid ISO time and the PR was created before it (§5.3, "opened before `review-evidence` becomes required"). `requiredSince` is the `review-evidence` key of `.github/review-activation.json`, read live from the **base branch** through the API (`GET /repos/{o}/{r}/contents/.github/review-activation.json?ref=<base.ref>`), never from the PR's tree, so a PR cannot exempt itself. It is a file on `main`, not a code constant or a repo variable: a constant would have to merge before the protection change, so PRs opened in between would lose the exemption, and repo variables may not reach workflows on fork PRs (unresolved: GitHub's variables and contexts docs do not say; a file read through the API works either way). The value is the time captured right after the protection change, so it can merge later. A missing file (404) or missing key exempts nothing, so the acceptance PRs in Task 16 are judged; any other API error, or a value that does not parse, fails the check ("could not judge"), never exempts. `review-gate.mjs` (Task 23) reads the `review-gate` key of the same file.
  - `main({env, fetchImpl, gitImpl}) -> exit code`: reads labels and body live from the API, computes the identity from `base.sha` and the head, prints one line per slot, exit 0 or 1.
  - `localCheck({cwd}) -> {ok, lines}`: the same evaluation with the lane, depth and fields read from `.review/local.json` (`{lane, depth, spec?, plan?, deviations?}`), which the pre-push hook (Task 6) and `push-readiness` call. `review.mjs check --local` prints it. With no `local.json`, it prints one line naming the command below and returns `ok: false`.
  - CLI `review.mjs init-local --lane <lane> --depth <label> [--spec <path>] [--plan "<path> <tasks>"]` writes `.review/local.json`. The file is machine-local: Task 15 adds `.review/local.json` to `.gitignore`, and `readRecords` never reads it.
- Workflow: `on: pull_request: types: [opened, synchronize, reopened, edited, labeled, unlabeled]`; `permissions: contents: read, pull-requests: read`; job and check name `review-evidence`; checkout with `fetch-depth: 0` and `persist-credentials: false`; `node scripts/ci/review-evidence.mjs`. Concurrency keyed on PR number and head SHA, `cancel-in-progress: false` (the label-gate pattern).

- [ ] **Step 1: Write the failing tests**, one per spec negative test (§5.3) and the Review Focus items:

```js
const failsWith = (r, re) => r.ok === false && re.test(r.lines.join('\n')) // a negative check names the guard that fired
ok('failed run with zero findings -> FAIL', failsWith(evaluate(fx({ outcome: 'failed', verdict: 'pass', findings: [] })), /failed/))
ok('PASS verdict with an open blocking finding -> FAIL', failsWith(evaluate(fx({ verdict: 'pass', findings: [{ id: 'F1', severity: 'P1' }] })), /F1/))
ok('subtle-correctness missing completeness -> FAIL naming the slot', /completeness/.test(evaluate(fx({ depth: 'subtle-correctness', only: ['correctness'] })).lines.join()))
ok('stale identity -> FAIL', failsWith(evaluate(fx({ recordIdentity: 'aaa', identity: 'bbb' })), /identity/))
ok('evidence-only commit voids nothing (identity from a real repo before and after)', idBefore === idAfter && evaluate(fx({ identity: idAfter, recordIdentity: idBefore })).ok)
ok('merge from main next to the PR lines voids nothing', idBefore === idAfterMainMerge)
ok('conformance task-scope edit (Plan T1-T3 -> T1-T4) -> FAIL', failsWith(evaluate(fx({ conformanceTasks: ['T1', 'T2', 'T3'], bodyTasks: 'T1-T4' })), /T4/))
ok('unfixed deviation IDs must exactly match the Deviations field', failsWith(evaluate(fx({ deviations: ['D1', 'D2'], bodyDeviations: ['D1'] })), /D2/))
ok('a justified, unfixed deviation (including a failed postcondition) passes', evaluate(fx({ deviations: ['D1'], bodyDeviations: ['D1'], d1Disposition: 'justified-deviation' })).ok)
ok('no local.json -> not ok, names init-local', /init-local/.test(localCheck({ cwd: emptyRepo }).lines.join()))
ok('reviewer vendor equals author vendor -> FAIL', failsWith(evaluate(fx({ reviewerVendor: 'anthropic', authorVendor: 'anthropic' })), /vendor/))
ok('completeness from the same vendor as correctness -> FAIL', failsWith(evaluate(fx({ depth: 'subtle-correctness', correctnessVendor: 'openai', completenessVendor: 'openai' })), /vendor/))
ok('a superseded record is not judged; its chain head is', evaluate(fx({ chain: [failedOld, passingNew] })).ok)
ok('an invalid record file fails by name', /records\/bad\.json/.test(evaluate(fx({ invalid: 'bad' })).lines.join()))
ok('identity "empty" on a direct PR -> FAIL with "no changes outside .review/"', /no changes outside/.test(evaluate(fx({ identity: 'empty', lane: 'direct' })).lines.join()))
ok('mechanical direct PR needs no record', evaluate(fx({ lane: 'direct', depth: 'mechanical', records: [] })).ok)
ok('dependency lane needs one correctness record', failsWith(evaluate(fx({ lane: 'dependency', records: [] })), /correctness/))
ok('a PR created one second before requiredSince is exempt', isGrandfathered({ prCreatedAt: '2026-11-04T23:59:59Z', requiredSince: '2026-11-05T00:00:00Z' }))
ok('a PR created one second after requiredSince is judged', isGrandfathered({ prCreatedAt: '2026-11-05T00:00:01Z', requiredSince: '2026-11-05T00:00:00Z' }) === false)
ok('unset or empty requiredSince exempts nothing', isGrandfathered({ prCreatedAt: '2020-01-01T00:00:00Z', requiredSince: undefined }) === false && isGrandfathered({ prCreatedAt: '2020-01-01T00:00:00Z', requiredSince: '' }) === false)
ok('activation file: an old PR is exempt, a new one judged, read at the base ref', (await (async () => { const calls = []; const f = activationFile({ 'review-evidence': '2026-11-05T00:00:00Z' }, calls); const oldCode = (await quiet(() => main({ env: goodEnv, fetchImpl: f(prCreatedAt('2026-11-04T23:59:59Z', noRecords)) }))).code; const newCode = (await quiet(() => main({ env: goodEnv, fetchImpl: f(prCreatedAt('2026-11-05T00:00:01Z', noRecords)) }))).code; const act = calls.filter((u) => u.includes('review-activation.json')); return oldCode === 0 && newCode === 1 && act.length > 0 && act.every((u) => u.includes('ref=main')) })()))
ok('activation file 404 -> judged, not exempt: the failure names the missing slot, not "could not judge"', await (async () => { const r = await quiet(() => main({ env: goodEnv, fetchImpl: activationFile404(prCreatedAt('2020-01-01T00:00:00Z', noRecords)) })); return r.code === 1 && /correctness/.test(r.out) && /could not judge/.test(r.out) === false })())
ok('an unparseable activation value -> exit 1 and "could not judge"', await (async () => { const r = await quiet(() => main({ env: goodEnv, fetchImpl: activationFile({ 'review-evidence': 'soon' })(prCreatedAt('2020-01-01T00:00:00Z', passingRecords)) })); return r.code === 1 && /could not judge/.test(r.out) })())
ok('activation read fails (500) after every PR-state read succeeded -> exit 1 and "could not judge", even with passing records', await (async () => { const r = await quiet(() => main({ env: goodEnv, fetchImpl: activationFails500(prCreatedAt('2020-01-01T00:00:00Z', passingRecords)) })); return r.code === 1 && /could not judge/.test(r.out) && r.calls.some((u) => u.includes('review-activation.json')) })())
ok('API error -> exit 1 "could not judge"', await (async () => { const r = await quiet(() => main({ env: goodEnv, fetchImpl: stub403 })); return r.code === 1 && /could not judge/.test(r.out) })())
```

- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement** `review-evidence.mjs` and the workflow. `authorVendorOf` reads each record's `authorVendor`; all records on one input must agree, or the check fails naming them. Add the `check --local` and `init-local` subcommands to `review.mjs`, and `.review/local.json` to `.gitignore`. Update `push-readiness` (Task 5) to run `npm run review -- check --local` and drop its "until then" line. A conformance finding passes predicate 4 with `justified-deviation` only through `dispositionOk(f, {deviations: body.deviations})`.
- [ ] **Step 4: Edit `AGENTS.md`**, byte-neutral: add `npm run review -- check --local` to the "Commands" list (what it checks: the local records in `.review/`), removing an equal number of bytes elsewhere in the same section.
- [ ] **Step 5: Run `npm test`.** Expected: exit 0.
- [ ] **Step 6: Commit** (`feat(ci): review-evidence check`). Then push PR B with David's approval, after its own pre-push reviews, written with `review.mjs` as the first real use.

### Task 16 (operator): Acceptance cases, then make `review-evidence` required

**Runs after PR C merges**, not after PR B: Step 1's task-scope case and Step 2's activation PR need PR C's conformance writer, and the activation PR reuses the spec and plan records from PR C's bootstrap (Task 18 Step 6). It stays numbered 16 so references hold.

- [ ] **Step 1:** on throwaway same-repo test PRs, run once each, and record the run URL and conclusion in PR C's thread:
  - a failed review with zero findings (expect red);
  - an evidence-only commit on a green PR (expect still green);
  - a merge from `main` that edits a line next to the PR's lines (expect still green);
  - a task-scope edit to the `Plan:` field (expect red);
  - a Dependabot PR with a maintainer-supplied `correctness` record (expect green; then confirm the branch needs a manual update, §5.3);
  - a fork PR with maintainer edits off (expect red, then follow the move-to-same-repo path in §5.3).
- [ ] **Step 2 (David, approved):** add `review-evidence` to the required checks on `main`. Read back with `gh api repos/magora-project/magora-portal/branches/main/protection/required_status_checks --jq '.contexts'` and expect 9 entries including `review-evidence`. If the session token gets a 403 (§3), David reads it back in the UI. **Immediately after** the read-back succeeds, capture the current UTC time (ISO 8601). Then a PR creates `.github/review-activation.json` as `{"review-evidence": "<that time>"}`. It changes gate behaviour and adds a control file, so it is `Lane: specced`, `subtle-correctness` (spec §5.2: any config change is specced; AGENTS.md: control files are `subtle-correctness`), with `Spec:` this spec, `Plan:` this plan `T16`, and `Deviations: none`. Its evidence: the existing `spec` and `plan` records (their blobs are unchanged), a `conformance` record for T16 (an operator task with no Files block, so no postconditions; the reviewer checks the file's key and value against this step), and `correctness` and `completeness` records. Its description says which control file it adds. The time is taken after the protection change, so every PR opened before activation is exempt; the cost is that a PR opened in the seconds between the protection change and the capture is exempt too. The file may merge minutes later: exemption depends on the value, not the merge time.
- [ ] **Step 3:** after that PR merges, list the PRs that were open at activation (`gh pr list --state open --json number,createdAt`) and re-run `review-evidence` on each one created before the captured time. A red result recorded before the file existed stays on the PR until the check runs again. With an existing run: `gh run rerun <id>` on its latest `review-evidence` run (a re-run re-reads the API, so it sees the file). With no run (a PR opened before the workflow existed): close and reopen it (`gh pr close <n>`, then `gh pr reopen <n>`), which fires `reopened`, one of the workflow's triggers; this is visible to the PR's author, so David approves each. Read back with `gh api repos/magora-project/magora-portal/commits/<head>/check-runs --jq '.check_runs[] | select(.name=="review-evidence") | .conclusion'`; expect `success` with "grandfathered" in the log.

---

## Phase 3: Typed targets and conformance (PR C, rollout step 3)

### Task 17: Typed targets and the plan-review reference check

**Files:**
- create: `scripts/review/plan-targets.mjs`
- create: `scripts/review/plan-targets.test.mjs`
- command: `npm test`

**Interfaces:**
- Produces:
  - `parsePlan(markdown) -> { tasks: [{ id: 'T<n>', title, targets: [{ type: 'existing' | 'create' | 'modify' | 'delete' | 'command', value: string, line: number }] }], problems: string[] }`. A task heading matches `^### Task (\d+)( \(operator\))?: ` — both `### Task 17: X` and `### Task 16 (operator): X`; an operator task may have no Files block, and then has `targets: []`. Conformance on a task with no targets runs no postconditions and still runs the reviewer on the task's text (Task 18). Targets are lines `- <type>: \`<value>\`` inside the task's `**Files:**` block.
  - `checkExisting({plan, exists, tasks?}) -> {problems: string[], notes: string[]}`, where `exists(path) -> boolean` answers "is this a file at the revision under review" (the CLI builds it from `git ls-tree -r --name-only <rev>`; tests pass a synthetic set, because CI checks out at depth 1). It walks the plan's tasks in order, restricted to `tasks` when given (the tasks not yet landed; plan re-reviews after a phase merges pass only the remaining ones). A path is **available** to a task if `exists(path)`, or an earlier in-scope task `create`s it, and not if an earlier in-scope task `delete`s it. Reported: each `existing` or `modify` target that is not available; each `create` target for which `exists` is true or that an earlier task creates; each untyped Files line. A `~/`-prefixed `existing` target is checked on disk locally; in CI it produces a `notes` entry, never a problem. Each result also lists the targets it considered, so a test can assert the walk was not empty.
  - `review.mjs run --slot plan --path <plan> [--tasks <list>] [--rev <sha>]` runs `checkExisting({plan, exists: <files at rev>, tasks})` first (defaults: `rev` = `git merge-base origin/main HEAD`, after `git fetch origin main`, i.e. the tree the in-scope tasks start from; `tasks` as below). The default is the merge base, not `HEAD`, because a plan is often re-reviewed on the branch that implements it: at `HEAD`, the files that branch's tasks create already exist and every one of their `create` targets would be reported. `tasks`: if the plan file does not exist at `rev` (a new plan), the default is every task. If it does (an amendment to a merged plan, e.g. a docs-only PR or PR D's chained re-review), **`--tasks` is required** and the CLI refuses without it, naming the flag: which tasks remain is a fact the author states and the reviewer sees, not something inferred from which files exist. A plan with no remaining tasks passes `--tasks none`, which checks nothing and says so in a note. The skill commands (Task 5) say this. **Every requested task ID must exist in the plan**: `resolveTasks` refuses the whole selection, before any check, review or record, naming each unknown ID, also when it is mixed with valid ones (`T17,T99`) or comes from a range (`T24-T26`). `none` is the only way to select nothing. The same `resolveTasks` validates `review.mjs conformance --tasks` (Task 18). The plan review records its problems as P1 findings in the plan record. A plan re-review after a phase has merged passes `--tasks` with the remaining tasks; the plan record stores both values.

- [ ] **Step 1: Write the failing tests:**

```js
ok('parses this plan: Task 10 has an existing-free target list ending in a command', parsePlan(thisPlan).tasks.find((t) => t.id === 'T10').targets.at(-1).type === 'command')
ok('an untyped "- Create: x" line is a problem with its line number', /line \d+/.test(parsePlan('### Task 1: X\n\n**Files:**\n- Create: `x`\n').problems.join()))
ok('a missing existing target is reported', checkExisting({ plan: planWithMissing, exists: setOf(['a.mjs']) }).problems.some((p) => /missing\.mjs/.test(p)))
ok('a create target that already exists is reported', checkExisting({ plan: planCreatingExisting, exists: setOf(['x.mjs']) }).problems.length === 1)
ok('modify of a file an earlier task creates is not reported (Task 3 modifies the settings.json Task 2 creates)', checkExisting({ plan: thisPlan, exists: setOf(filesBeforePhase1), tasks: ['T2', 'T3'] }).problems.length === 0)
ok('after Phase 1 lands, checking only T10+ reports nothing for Phase 1 files, and did consider targets', (() => { const r = checkExisting({ plan: thisPlan, exists: setOf(filesAfterPhase1), tasks: laterTasks }); return r.considered.length > 0 && r.problems.every((p) => !/\.claude\/hooks/.test(p)) })())
ok('a ~/ existing target in CI is a note, not a problem', (() => { const r = checkExisting({ plan: planWithHomeTarget, exists: () => false, ci: true }); return r.problems.length === 0 && r.notes.some((n) => n.includes('~/')) })())
ok('PR C bootstrap: T17-T25 checked at the merge base reports nothing, though T17 and T18 files exist at HEAD', checkExisting({ plan: thisPlan, exists: setOf(filesAtMergeBaseBeforePhase3), tasks: phase3to5Tasks }).problems.length === 0 && checkExisting({ plan: thisPlan, exists: setOf(filesAtHeadAfterT18), tasks: phase3to5Tasks }).problems.some((p) => /plan-targets\.mjs/.test(p)))
ok('the CLI default rev is the merge base, not HEAD', resolveRev({ rev: undefined, gitImpl: stubGit }) === stubGit.mergeBase)
ok('amendment to a merged plan without --tasks is refused, naming the flag', /--tasks/.test(resolveTasks({ tasks: undefined, planExistsAtRev: true }).error))
ok('an unknown task ID is refused, even mixed with valid ones or from a range', ['T99', 'T17,T99', 'T24-T26'].every((sel) => /T99|T26/.test(resolveTasks({ tasks: sel, planExistsAtRev: true, plan: thisPlan }).error ?? '')))
ok('--tasks none is accepted and distinct from an invalid selection', (() => { const r = resolveTasks({ tasks: 'none', planExistsAtRev: true, plan: thisPlan }); return !r.error && r.tasks.length === 0 })())
ok('a new plan (absent at rev) defaults to every task, so a create target that already exists is still reported', resolveTasks({ tasks: undefined, planExistsAtRev: false, plan: planCreatingExisting }).tasks.length === parsePlan(planCreatingExisting).tasks.length && checkExisting({ plan: planCreatingExisting, exists: setOf(['x.mjs']) }).problems.length === 1)
ok('--tasks none checks nothing and notes it', (() => { const r = checkExisting({ plan: thisPlan, exists: setOf([]), tasks: [] }); return r.problems.length === 0 && r.considered.length === 0 && r.notes.some((n) => /no remaining tasks/.test(n)) })())
ok('duplicate task IDs are a problem', /duplicate T2/.test(parsePlan(dupPlan).problems.join()))
ok('operator headings parse: T16 and T24 are found, with no targets and no problem', (() => { const r = parsePlan(thisPlan); return ['T16', 'T24'].every((id) => r.tasks.some((t) => t.id === id && t.targets.length === 0)) && !r.problems.some((p) => /T16|T24/.test(p)) })())
ok('a command target keeps its value verbatim, spaces included', parsePlan(p).tasks[0].targets[0].value === 'npm run check:migrations')
```

- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement.** This plan's own Files blocks are the reference fixture: the first test parses `docs/superpowers/plans/2026-10-30-shared-dev-process.md`.
- [ ] **Step 4: Run `npm test`.** Expected: exit 0.
- [ ] **Step 5: Commit** (`feat(review): typed plan targets and the reference check`).

### Task 18: Conformance

**Files:**
- create: `scripts/review/conformance.mjs`
- create: `scripts/review/conformance.test.mjs`
- create: `.claude/skills/conformance/SKILL.md`
- modify: `.claude/skills/writing-plans/SKILL.md`
- modify: `scripts/review/review.mjs`
- command: `npm test`

**Interfaces:**
- Consumes: `parsePlan` (Task 17); `inputIdentity`, `mergeBase` (Task 10); `writeRecord` (Task 11); the runner (Task 12).
- Produces:
  - `postconditions({tasks, cwd, base, head}) -> [{ task, target, ok, detail }]`: `create`/`modify` present at head and in the PR's diff (`git diff --name-only <merge-base> <head>`); `delete` absent at head; `command` run now by the evidence writer, exit status captured. Identical command strings across the declared tasks run once, and the result is recorded against each.
  - CLI `review.mjs conformance --plan <path> --tasks T1-T4 --author <vendor>`: validates `--tasks` with `resolveTasks` (Task 17; an unknown ID refuses before anything runs or is written); runs the postconditions; each failed postcondition is a P1 deviation finding with ID `D<n>`, numbered before the reviewer's; then runs the `conformance` slot reviewer on the declared tasks' text plus the PR's own diff; writes one `conformance` record whose `conformance.tasks`, `.deviations` (IDs of findings without a `fixed` disposition) and `.commands` are filled.
- `writing-plans` gains a "Typed targets" section: every Files line is `- <type>: \`<value>\`` with the five types (§5.4), and plan review runs `checkExisting`.
- The `conformance` skill: run after local checks and before pre-push review (§5.1 stage 8); for each deviation, fix it (then re-run with `--supersedes`) or write it into the PR's `Deviations:` field with why the plan's version isn't needed and why the built one is better (D-3).

- [ ] **Step 1: Write the failing tests:**

```js
ok('a create target absent at head -> failed postcondition', pc.find((p) => p.target.value === 'new.mjs').ok === false)
ok('a modify target unchanged in the PR diff -> failed', pc.find((p) => p.target.value === 'untouched.mjs').ok === false)
ok('a delete target still present -> failed', pc.find((p) => p.target.type === 'delete').ok === false)
ok('a command target that exits 1 is recorded with exit 1', rec.conformance.commands[0].exit === 1)
ok('a command is spawned without a shell on every platform', spawnOpts.shell === false)
ok('only the declared tasks are checked, and both were', pc.some((p) => p.task === 'T1') && pc.some((p) => p.task === 'T2') && pc.every((p) => ['T1', 'T2'].includes(p.task)))
ok('deviation IDs in the record are the unfixed findings only', rec.conformance.deviations.join() === 'D2')
ok('a re-run with --supersedes chains and inherits D2 if undisposed', chained.findings.some((f) => f.id.endsWith('#D2')))
ok('conformance on an operator task with no targets: zero postcondition runs, and the one reviewer call carries the task body and the PR diff', zeroTargetSpawns.length === 0 && zeroTargetRec.conformance.commands.length === 0 && zeroTargetReviewerCalls.length === 1 && zeroTargetReviewerCalls[0].prompt.includes('capture the current UTC time (ISO 8601)') && zeroTargetReviewerCalls[0].prompt.includes(fixtureDiffMarker))
ok('conformance with an unknown task ID writes no record and spawns nothing', unknownTaskRun.records.length === 0 && unknownTaskRun.spawns.length === 0 && /T99/.test(unknownTaskRun.err))
```

- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement.** A `command` value is split into argv with a small quote-aware splitter (no shell). On Windows, `npm` runs as `node <dir>/node_modules/npm/bin/npm-cli.js` and `npx` as `node <dir>/node_modules/npm/bin/npx-cli.js`, where `<dir>` is `dirname(process.execPath)`; arguments pass through unchanged. Tests: `npm run check:migrations` and `npx eslint "a b.js"` reach their CLI with argv `['run','check:migrations']` and `['eslint','a b.js']`.
- [ ] **Step 4: Run `npm test`.** Expected: exit 0.
- [ ] **Step 5: Commit** (`feat(review): plan conformance and its record`).
- [ ] **Step 6: Bootstrap PR C's evidence** (`review-evidence` is not yet required: Task 16 runs after PR C merges; the check still runs, and PR C must pass it). PR C is the first `specced` PR, and no chain root exists yet for the spec or this plan, so these are full reviews, not chained ones:
  - `npm run review -- init-local --lane specced --depth subtle-correctness --spec docs/superpowers/specs/2026-10-29-shared-dev-process-design.md --plan "docs/superpowers/plans/2026-10-30-shared-dev-process.md T17-T18"`
  - `npm run review -- run --slot spec --path docs/superpowers/specs/2026-10-29-shared-dev-process-design.md --author anthropic`
  - `npm run review -- run --slot plan --path docs/superpowers/plans/2026-10-30-shared-dev-process.md --tasks T17-T25 --author anthropic` (no `--rev`: the default merge base is `main` before PR C, where T17 and T18's `create` targets do not exist yet)
  - `npm run review -- conformance --plan docs/superpowers/plans/2026-10-30-shared-dev-process.md --tasks T17-T18 --author anthropic`
  - then `correctness` and `completeness`, and `npm run review -- check --local`. Expected: every line ok. Push PR C with approval. PR D reuses the spec and plan records unless Task 0 or Task 20 changed those blobs, in which case it chains from these with `--supersedes` and, for the plan, `--tasks T20-T25` (an amendment, Task 17).

### Task 19 (operator): First promotion to claude-config (D-4)

This runs in claude-config, not this repo.

- [ ] **Step 1 (agent, approved, in a claude-config branch):** write the promotion script on David's Mac, which lists every commit touching `AGENTS.md`, `.claude/**`, `scripts/review/**` or `scripts/ci/review-*` in magora since the commit recorded in claude-config's `promotions/magora-portal.last` (absent: since the merge of PR A). One item per commit and file, with the diff.
- [ ] **Step 2 (David):** accept or reject each item. The first promotion's must-have item is the conformance rule (D-3, D-4).
- [ ] **Step 3:** accepted items land as one claude-config commit whose message names the magora SHA; `promotions/magora-portal.last` is updated in the same commit. Nothing fans out to other repos (D-5).
- [ ] **Step 4:** the same script lists claude-config commits since the last promotion that touch the kept layer recorded in `docs/process/claude-b-inventory.md`. David accepts or rejects each; accepted items are copied into `~/.claude-b`'s frozen files (§5.7, "the other direction").

---

## Phase 4: PR review record and `review-gate` (PR D, rollout step 4)

Requires Task 0's ruling on V2–V5 (accepted by David 2026-11-01; recorded here by PR D, Task 20) **and the OPEN item below, resolved as a plan amendment before Task 22 starts.**

### OPEN: substitution clock and three gate points (block Task 22, and Tasks 23–24 through it)

Rounds 4 and 5 of plan review kept finding defects in the stand-in (substitute) part of the PR-stage gate, each in the previous round's fix. Round 5's three points were extracted here; round 6 showed two of them (chained verification, the substitute vendor rule) change PR B's Tasks 11 and 12, so those two are settled there now. The one left is local to Task 22's `headPushedAt` and changes nothing PRs A–C ship. **Task 22 is not settled where it touches this point**; the PR D amendment resolves it with tests and gets its own plan review first:

1. **Clock for a returning head (round 5, P2).** `headPushedAt` (Task 22) takes the earliest run for the head SHA over the whole PR. If a PR moves A → B → back to A, the clock for the current arrival of A starts at A's first arrival, so substitution can be allowed a minute after the head returns. Runs with an empty PR list (fork runs) can also come from another PR. Decide which arrival starts the wait, how that survives gate re-runs, and test a returning SHA and an unrelated empty-list run.
2. **A late Gemini verdict after substitution (PR #52, Codex App, P2).** If Gemini runs past 30 minutes, a substitute can turn the gate green, and Gemini's later issue comment triggers no gate run, so a new blocking finding in it never reaches the gate. Candidate: Gemini is `needs-substitute` on the clock only when no Gemini run for the head is queued or in progress (`prRunsFor` reads run status), with a job `timeout-minutes` below 30; or a completion-triggered gate run that reports on the current head. Test a late Gemini finding after a green substituted gate. Touches Tasks 20 and 22.
3. **Codex rewrite history (PR #52, Codex App, P2).** Clean Codex reviews overwrite one summary comment (V2), so after a force-push `codexState` sees only the new head and Task 22's ancestry check finds no rewrite. Measured 2026-11-01: GraphQL `userContentEdits` on that comment keeps the earlier bodies (PRs #43, #44, #46 each show two or three distinct `commit_sha` values). Candidate: read every reviewed SHA from the edit history, paginated, and fail closed when it cannot be read. Test a clean marker overwritten after a force-push with no full-review request. Touches Tasks 21 and 22.
4. **Verifying a `fixed` outside-diff or thread finding (PR #52, Gemini, P1).** Task 23's rule (a) accepts any later CodeRabbit review, but an incremental review does not re-read outside-diff code, and there is no thread to resolve. Candidate: for `cr:` findings, (a) needs a `@coderabbitai full review` after the fix commit and a usable review after that request which does not repeat the marker; otherwise only (b), a substitute. Task 21 Step 1 must first show whether the marker is stable across reviews. For threads the same gap is an **accepted limitation** (spec §5.6, David, 2026-11-03), not open: an incremental review need not re-read the fix, so a fix reverted after it can pass (PR #52, Gemini local pass on `50672ba`; CodeRabbit on `b746dd6`). Tying the evidence to a full-review request was tried and dropped: GitHub timestamps cannot show that a review answered a request, and `codexState` exposes only the latest marker (Codex on `f8ad742` and `18ee3ec`). A stronger mechanism, if one is wanted later, is a local re-review record with the full current input that the gate checks; it does not block Task 23. Only the `cr:` half stays open here. Touches Tasks 21 and 23.
Settled, not open: chained verification (Task 11, `inherit` copies fixed gate-ID findings) and the substitute vendor rule (Task 12, `substitute:*` slots skip the author-vendor refusal).

### Task 20: Bots skip the evidence; Gemini's verdict marker

**Files:**
- modify: `.coderabbit.yaml`
- modify: `.github/workflows/gemini-review.yml`
- modify: `scripts/review/gemini_review.py`
- modify: `AGENTS.md`
- modify: `docs/superpowers/specs/2026-10-29-shared-dev-process-design.md`
- modify: `docs/superpowers/plans/2026-10-30-shared-dev-process.md` (Task 0's ruling, recorded under V2–V5)
- existing: `scripts/review/identity.mjs`
- command: `npm test`

**Interfaces:**
- Produces: every Gemini comment ends with exactly one marker line, `<!-- gemini-review:v1 {"head":"<sha>","identity":"<id>","verdict":"no-findings"|"findings"|"could-not-run"|"skipped-same-identity","findings":[{"index":1,"severity":"P0"|"P1"}]} -->`. Task 21 parses it.

- [ ] **Step 1:** `.coderabbit.yaml` `path_filters` gains `"!.review/**"`.
- [ ] **Step 2:** `gemini-review.yml`'s diff is built by the trusted base's `scripts/review/identity.mjs` `geminiDiff` (Task 10) instead of an inline `git diff`, so it excludes `.review/` and matches the gate's size check byte for byte. Update the decision-3 comment that says "never by path": the one exclusion is the evidence directory, which no change depends on.
- [ ] **Step 3:** a new step before "Run the Gemini pass", from the trusted base checkout (sparse-checkout adds `scripts/review/identity.mjs`; add `actions/setup-node` with the `ci.yml` pin): compute the identity, list the PR's comments from `github-actions[bot]`, and if one carries a marker with the same identity and a verdict other than `could-not-run` and `skipped-same-identity`, set `skip=true`. When skipping, post a short comment with verdict `skipped-same-identity` naming the earlier comment, and do not call the model (V5).
- [ ] **Step 4:** the post step writes the marker for every outcome. `gemini_review.py` numbers each finding line it emits (`1. P1 …`), so indices are stable within one comment.
- [ ] **Step 5:** `AGENTS.md`, byte-neutral: one line, "Reviewers: skip `.review/`; findings located only there are outside the gate." Add `.coderabbit.yaml` to the control-file list in `AGENTS.md` and the PR template (§5.7: its evidence exclusion is a control; `gemini-review.yml` is already covered by `.github/**`).
- [ ] **Step 6:** amend spec §5.5 with the rows David accepted in Task 0, each a one-line change citing V2–V5.
- [ ] **Step 7:** run `python3 -m py_compile scripts/review/gemini_review.py`, `npm test` and `actionlint` if installed (else say it was not run). Expected: exit 0.
- [ ] **Step 8: Commit** (`feat(review): bots skip .review/; Gemini verdict marker and identity skip`).

### Task 21: Live bot state and severity defaults

**Files:**
- create: `scripts/review/github.mjs`
- create: `scripts/review/github.test.mjs`
- create: `scripts/review/severity.mjs`
- create: `scripts/review/severity.test.mjs`
- command: `npm test`

**Interfaces:**
- Produces (`github.mjs`), all paginated, all taking `{repo, pr, token, fetchImpl}`:
  - `listReviews() -> [{id, login, commitId, submittedAt, body, empty: boolean}]`
  - `listIssueComments() -> [{id, login, body, createdAt, updatedAt}]`
  - `listThreads() -> [{id, isResolved, resolvedBy, path, firstComment: {login, body, url, originalCommit}}]` via GraphQL `reviewThreads(first:100)` with cursor pagination. `originalCommit` is the comment's `originalCommit { oid }`, the commit the finding was reported on. Never read the comment's `commit`: GitHub re-anchors it to the newest head (PR #52 comment 4438353270: `commit_id` `baafa0b`, `original_commit_id` `f530f6d`)
  - `coderabbitCheck({sha}) -> {conclusion, title} | null`: the check run named `CodeRabbit`, app slug `coderabbitai` (V3)
  - `prRunsFor({sha}) -> [{id, event, createdAt, prNumbers: number[]}]`: workflow runs on the head SHA (`GET /actions/runs?head_sha=<sha>&event=pull_request`, paginated), the input to `headPushedAt` (Task 22). Needs `actions: read`
  - `codexState(comments) -> {commitSha, status, at} | null`: the latest `codex-review-state:v1` marker from `chatgpt-codex-connector[bot]` (V2)
  - `geminiVerdicts(comments) -> [{head, identity, verdict, findings, commentId, at}]`
  - `fullReviewRequests(comments) -> [{bot: 'coderabbit' | 'codex', at}]`: comments whose whole trimmed body is `@coderabbitai full review` or `@codex review`
  - `outsideDiffFindings({reviews, comments}) -> [{id: 'cr:<marker>', severity, path, reportedCommit}]`: CodeRabbit's outside-diff findings, read from **review bodies** (where CodeRabbit places its "Outside diff range" section) and from its issue comments, from `coderabbitai[bot]` only. `reportedCommit` is the review's `commitId`, or `null` for a finding read from an issue comment, which names no commit
- Produces (`severity.mjs`): `severityOf({login, body}) -> {label: string | null, blocking: boolean}`. Codex: the `P0`–`P3` badge; CodeRabbit: the `🔴 Critical` / `🟠 Major` / `🟡 Minor` / `🔵 Trivial` / `Nitpick` label; unparseable → `{label: null, blocking: true}` (§5.6).

- [ ] **Step 1 (read-only):** pin the formats from live data: one Codex inline comment's badge, one CodeRabbit inline comment's severity line, one CodeRabbit outside-diff finding's marker, from PRs #43, #44 and #46 (`gh api …/pulls/<n>/comments --paginate`, `…/issues/<n>/comments --paginate`). Save trimmed copies as fixtures under `scripts/review/fixtures/`, with any token-like strings removed.
- [ ] **Step 2: Write the failing tests** against those fixtures:

```js
ok('Codex P2 badge -> blocking', severityOf(codexP2).blocking && severityOf(codexP2).label === 'P2')
ok('Codex P3 -> nit', severityOf(codexP3).blocking === false)
ok('CodeRabbit Major -> blocking; Minor -> nit', severityOf(crMajor).blocking && severityOf(crMinor).blocking === false)
ok('a body with no recognizable label -> blocking', severityOf({ login: 'coderabbitai[bot]', body: 'hmm' }).blocking)
ok('codexState reads the marker, not the table', codexState(fixtureComments).commitSha === '6df86b4a8697900b3d4e1aea17dbeec237ae44e9')
ok('a marker in a comment from another login is ignored', codexState([{ ...spoof, login: 'mallory' }]) === null)
ok('empty CodeRabbit reviews are marked empty', listReviewsFrom(pr43).filter((r) => r.empty).length === 6)
ok('threads paginate past 100', (await listThreads({ fetchImpl: twoPages })).length === 101)
ok('a thread reports its original commit, not the re-anchored one (the fixture holds one thread)', await (async () => { const t = await listThreads({ fetchImpl: reanchoredThread }); return t.length === 1 && t[0].firstComment.originalCommit === 'f530f6d3f288a9ab9cd9d23f182befe33f2784d3' })())
ok('an outside-diff finding carries its review commit, or null from an issue comment (each fixture holds one finding)', (() => { const fromReview = outsideDiffFindings({ reviews: [crReviewWithOutsideDiff], comments: [] }); const fromComment = outsideDiffFindings({ reviews: [], comments: [crCommentWithOutsideDiff] }); return fromReview.length === 1 && fromReview[0].reportedCommit === crReviewWithOutsideDiff.commitId && fromComment.length === 1 && fromComment[0].reportedCommit === null })())
ok('a blocking outside-diff finding present only in a review body is found', outsideDiffFindings({ reviews: [crReviewWithOutsideDiff], comments: [] }).some((f) => f.severity && f.id.startsWith('cr:')))
ok('"@codex review please" is not a full-review request', fullReviewRequests([{ body: '@codex review please', login: 'a' }]).length === 0)
ok('GraphQL errors throw (fail closed)', /GraphQL/.test(await errOf(() => listThreads({ fetchImpl: gqlError }))))
ok('prRunsFor paginates and keeps the PR numbers of each run', (await prRunsFor({ sha, fetchImpl: twoRunPages })).length === 101 && (await prRunsFor({ sha, fetchImpl: twoRunPages }))[0].prNumbers.join() === '44')
```

- [ ] **Step 3: Run them.** Expected: FAIL.
- [ ] **Step 4: Implement.** Markers are matched only in comments from the expected login. JSON inside a marker that fails to parse yields `null` for that comment.
- [ ] **Step 5: Run `npm test`.** Expected: exit 0.
- [ ] **Step 6: Commit** (`feat(review): read bot state and severity defaults from the API`).

### Task 22: Coverage and substitution

**Files:**
- create: `scripts/review/coverage.mjs`
- create: `scripts/review/coverage.test.mjs`
- command: `npm test`

**Interfaces:**
- Consumes: Task 21's readers; `inputIdentity` (Task 10); `readRecords`, `chainHeads` (Task 11).
- Produces:
  - `REQUIRED_BOTS = { mechanical: [], standard: ['coderabbit|codex'], 'subtle-correctness': ['coderabbit', 'codex', 'gemini'] }` (§5.5; `coderabbit|codex` means one of the two)
  - `headPushedAt({runs, pr, prCreatedAt}) -> string | null`: the GitHub API exposes no push time, and a commit's committer date predates its push. The closest recorded event is the creation of the workflow runs the push triggers: GitHub creates a `pull_request` run when it receives the `opened`/`synchronize` event, before any job is queued, so a run's `createdAt` does not wait for a runner the way a check's `started_at` does. It is `max(prCreatedAt, min(createdAt))` over the runs from `prRunsFor` (Task 21) whose `prNumbers` include `pr` or is empty (a fork PR's runs carry no PR numbers). The `prCreatedAt` floor covers a SHA that was pushed, and ran workflows, before this PR existed. The set is normally not empty: every head reaches the PR through an `opened` or `synchronize` event, which creates `pull_request` runs for it. A gate run triggered by `pull_request_review` is not in the set, because `prRunsFor` reads `event=pull_request` only. If the set is empty anyway, `headPushedAt` returns `null`, and `slotState` returns `pending` with a reason naming the missing run, never `needs-substitute`. The minimum does not move when the gate re-runs, so the clock does not restart. Limitation: when GitHub delays event delivery, the clock starts late, which only lengthens the wait before substitution.
  - `slotState({bot, state, identityOf, currentIdentity, now, headPushedAt}) -> {status: 'covered' | 'needs-substitute' | 'pending', by?: string, reason: string}`, where `identityOf(sha) -> Promise<string | null>` fetches the commit if needed and returns `null` when it cannot be fetched.
    - Usable evidence per bot: CodeRabbit, a non-empty review; Codex, a non-empty review or a `completed` `codexState`; Gemini, a verdict of `no-findings` or `findings`. Empty reviews are ignored (V4).
    - **Rewrite** (applies to CodeRabbit and Codex, whose reviews are incremental; never to Gemini, whose every verdict reviews the full diff and is covered by its identity alone): some commit this bot reviewed is not an ancestor of the current head (`git merge-base --is-ancestor`, after fetching; an unfetchable commit counts as not an ancestor). Ordinary pushes, whose incremental reviews accumulate, are not rewrites.
    - `covered`: the latest usable evidence's commit has `currentIdentity`. **After a rewrite that changed the identity** (a force-push that kept the identity, such as a rebase onto a new `main`, leaves earlier coverage valid, D-10), it is covered only if a full-review request for this bot was made after the latest rewritten-away review, and usable evidence later than that request is on a commit with `currentIdentity`. With no such request, the reason names the command to post (§5.5).
    - `needs-substitute`: not covered, and either the bot is not configured (Gemini on fork, Dependabot or draft PRs), or a terminal failure is visible on the head (CodeRabbit check `conclusion` in `skipped`, `failure`, `cancelled`, `timed_out`, `action_required`; Gemini verdict `could-not-run`), or 30 minutes have passed since `max(headPushedAt, last request)` with nothing usable.
    - `pending` otherwise.
  - `substituteOk({bot, records, currentIdentity, countedVendors}) -> boolean`: a `substitute:<bot>` chain head that passes parts 1, 2 and 4 of the `review-evidence` predicate on `currentIdentity` (reuse `evaluate`'s record check from Task 15, so every finding it raised or inherited needs an acceptable disposition). Part 3's author-vendor rule is replaced by §5.5's own: the substitute's vendor is not in `countedVendors` (vendors of the bots that covered this PR and of the other substitutes). The author's vendor may substitute, which is what lets all three vendors fill the three slots when every bot fails.
  - A `substitute:<bot>` record carries, **under their gate IDs** (`thread:…`, `cr:…`, `gemini:…`), every blocking finding from that bot that has no disposition in the PR review record **or** is marked `fixed` without the verifying evidence Task 23 requires. The substitute run passes them to the reviewer as inherited findings, so its verdict's `inherited` array must assess each one (Task 12). The writer persists the result as ordinary findings in the record: each `resolved` becomes a finding with that gate ID and `disposition: { kind: 'fixed', by: <this record's stem> }`, each `open` stays undisposed. A later `substitute:<bot>` review chained with `--supersedes` inherits the open ones under the same gate IDs for re-assessment, and copies the fixed ones with their dispositions (Task 11's `inherit`), so the chain head always holds every verified gate-ID finding. The gate reads only these persisted findings; nothing else is stored. Task 23 implements the run (`review.mjs run --slot substitute:<bot>`, reading the bot's findings live through Task 21's readers).
  - **Vendors for `countedVendors`:** Codex App → `openai`; Gemini → `google`; CodeRabbit counts no vendor (its model is not disclosed), so it never excludes a substitute.
  - `diffTooLarge({cwd, base, head}) -> Promise<boolean>`: `geminiDiff(...)` (Task 10) exceeds 400,000 bytes. The gate checks it **before** coverage: an oversized PR fails with "split this PR", and no substitution can clear it (§5.5).

- [ ] **Step 1: Write the failing tests:**

```js
ok('clean Codex review seen only through the marker -> covered', (await s(codexMarkerOnly)).status === 'covered')
ok('evidence-only commit: CodeRabbit check "skipped / No files to review" on the new head, earlier review on the same identity -> covered', (await s(crSkippedOnEvidenceHead)).status === 'covered')
ok('empty reviews after a full one do not uncover it', (await s(crFullThenEmpties)).status === 'covered')
ok('rate-limited CodeRabbit with no usable review -> needs-substitute', (await s(crRateLimited)).status === 'needs-substitute')
ok('Gemini could-not-run -> needs-substitute', (await s(geminiCouldNotRun)).status === 'needs-substitute')
ok('Gemini on a draft PR -> needs-substitute immediately', (await s(geminiDraft)).status === 'needs-substitute')
ok('force-push then incremental review only, no answer to the full-review request -> not covered', ['pending', 'needs-substitute'].includes((await s(forcePushIncrementalOnly)).status))
ok('force-push, incremental review on the new identity, no request at all -> not covered, reason names the request', ['pending', 'needs-substitute'].includes((await s(forcePushNoRequest)).status) && /full review/.test((await s(forcePushNoRequest)).reason))
ok('ordinary push, incremental review on the new identity -> covered (no request needed)', (await s(ordinaryPushIncremental)).status === 'covered')
ok('substitute with a completed outcome but a new open P1 -> not ok', substituteOk({ bot: 'coderabbit', records: [subWithOpenP1], currentIdentity: id, countedVendors: [] }) === false)
ok('a 400,001-byte diff is too large, and no substitute clears the gate', (await diffTooLarge(bigRepo)) === true && (await evaluateGateLike(bigWithSubs)).ok === false)
ok('three substitutes from openai, anthropic, google on an anthropic-authored PR -> all ok', ['coderabbit', 'codex', 'gemini'].every((b) => substituteOk(threeSubsFor(b))))
ok('two substitutes from the same vendor -> the second is not ok', substituteOk(secondSameVendor) === false)
ok('Gemini after a force-push: a fresh verdict on the new identity -> covered, no request needed', (await s(geminiAfterForcePush)).status === 'covered')
ok('identity-preserving force-push (rebase onto main): earlier CodeRabbit coverage stands', (await s(crRebaseSameIdentity)).status === 'covered')
ok('geminiDiff and diffTooLarge measure the same bytes, binary and rename included', await (async () => { const n = (await geminiDiff(binRenameRepo)).length; return Number.isInteger(n) && n > 0 && n === await sizeSeenBy(diffTooLarge, binRenameRepo) })())
ok('force-push then a usable review after the request -> covered', (await s(forcePushAnswered)).status === 'covered')
ok('review on an unfetchable commit -> not usable, no throw', (await s(unfetchable)).status === 'pending' && /full review/.test((await s(unfetchable)).reason))
ok('29 minutes, nothing -> pending; 31 minutes -> needs-substitute', (await s(at29)).status === 'pending' && (await s(at31)).status === 'needs-substitute')
ok('headPushedAt is the earliest run creation for this PR, not the committer date', headPushedAt({ runs: [run(44, '2026-11-01T10:05:00Z'), run(44, '2026-11-01T10:00:00Z')], pr: 44, prCreatedAt: '2026-11-01T09:00:00Z' }) === '2026-11-01T10:00:00Z')
ok('a SHA whose runs predate the PR: the clock starts at PR creation', headPushedAt({ runs: [run(44, '2026-11-01T08:00:00Z')], pr: 44, prCreatedAt: '2026-11-01T09:00:00Z' }) === '2026-11-01T09:00:00Z')
ok('no pull_request run for the head -> null, and the slot stays pending naming the missing run', headPushedAt({ runs: [], pr: 44, prCreatedAt: '2026-11-01T09:00:00Z' }) === null && await (async () => { const r = await s(failedNoRuns); return r.status === 'pending' && /run/.test(r.reason) })())
ok('runs for another PR on the same SHA are ignored', headPushedAt({ runs: [run(12, '2026-11-01T07:00:00Z'), run(44, '2026-11-01T10:00:00Z')], pr: 44, prCreatedAt: '2026-11-01T06:00:00Z' }) === '2026-11-01T10:00:00Z')
ok('a gate re-run adds a later run and leaves the clock unchanged', headPushedAt({ runs: [run(44, '2026-11-01T10:00:00Z'), run(44, '2026-11-01T10:40:00Z')], pr: 44, prCreatedAt: '2026-11-01T09:00:00Z' }) === '2026-11-01T10:00:00Z')
ok('a commit authored two hours before its push does not start the clock early', (await s(oldCommitFreshPush)).status === 'pending')
ok('subtle-correctness: CodeRabbit and Codex covered, Gemini failed, anthropic substitute -> ok', substituteOk({ bot: 'gemini', records: [subByAnthropic], currentIdentity: id, countedVendors: ['openai'] }))
ok('standard: one of CodeRabbit or Codex is enough', requiredMet('standard', { coderabbit: 'pending', codex: 'covered' }))
ok('substitute by a vendor already counted -> not ok', substituteOk({ bot: 'gemini', records: [subByOpenai], currentIdentity: id, countedVendors: ['openai'] }) === false)
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** `identityOf` caches per SHA, and fetches a missing SHA with `git fetch --no-tags origin <sha>`; a non-zero exit returns `null`.
- [ ] **Step 4: Run `npm test`.** Expected: exit 0.
- [ ] **Step 5: Commit** (`feat(review): slot coverage and substitution for the PR-stage gate`).

### Task 23: PR review record, its writer, and `review-gate`

**Files:**
- create: `scripts/review/pr-record.mjs`
- create: `scripts/review/pr-record.test.mjs`
- create: `scripts/ci/review-gate.mjs`
- create: `scripts/ci/review-gate.test.mjs`
- create: `.github/workflows/review-gate.yml`
- modify: `scripts/review/review.mjs`
- modify: `.github/pull_request_template.md`
- modify: `.claude/rules/process.md`
- command: `npm test`

**Interfaces:**
- Consumes: Tasks 21, 22; `isGrandfathered` (Task 15).
- Produces:
  - PR review record `.review/pr/<n>.json`: `{ schema: 1, pr, slots: [{ bot, status: 'covered' | 'substituted', by: string }], findings: [{ id, source, severity, disposition }], reclassified: [{ id, reason }], writtenAt }`. `by` is a review ID, `codex-marker:<comment id>`, `gemini:<comment id>` or a record stem.
  - `blockingFindings(state) -> [{id, source, severity, raisedAt}]`: every unresolved-or-resolved thread **opened by one of the three bot logins** whose first comment is blocking by default (threads a person opens stay with branch protection's conversation resolution), minus bot-resolved threads (§5.5); every outside-diff CodeRabbit finding blocking by default; every finding in **every** usable Gemini verdict on the PR, across identities (the identity skip in Task 20 is what prevents duplicates and loops; findings are never dropped for that purpose). Findings in `substitute:*` records are judged by `substituteOk`, not here. Findings whose `path` starts with `.review/` are excluded (§5.5).
  - `evaluateGate({state, record, depth}) -> {ok, lines}`: fails first if `diffTooLarge`. Otherwise passes when every required slot is covered or has `substituteOk`, and every `blockingFindings` entry is in the record with an acceptable disposition: `pre-existing` + reason + issue; present in `reclassified` with a reason; or `fixed` + commit SHA, accepted only when that SHA is an ancestor of the head **and** either (a) the SHA is a **strict descendant** of the finding's **reported commit** with an input identity different from the reported commit's, and the finding's bot has usable evidence (a review, or for Codex its `codexState` marker, V2) on the fix commit or a descendant of it, with the current identity (for a thread, the thread is also resolved; for Gemini, that evidence is the new verdict the fix commit's changed identity triggers), or (b) the chain head of an accepted (`substituteOk`) `substitute:<bot>` chain holds a finding with this gate ID and `disposition.kind === 'fixed'` (Task 22). The **reported commit** is the thread's `firstComment.originalCommit`, the `cr:` finding's `reportedCommit`, or the Gemini verdict's `head` (Task 21). Naming the commit the bug arrived in therefore fails: the review that raised the finding is on that commit, not after it. Every ordering here is by ancestry, never by timestamps or commit dates, which the author sets. A reported commit that is `null` or cannot be fetched fails (a) closed, with a line naming the finding, so only (b) remains. A bot that re-reports the defect raises it as a **new** blocking finding (a new thread or a new Gemini index), which then needs its own disposition, so a re-review that still finds the problem cannot pass. This is the "clean re-review" of D-7. A record is required when the depth requires any slot or `blockingFindings` is non-empty (§5.5).
  - `review.mjs run --slot substitute:<bot> --author <vendor>` (extends Task 12's runner): reads the bot's live findings through Task 21's readers, selects the ones Task 22 says a substitute carries (open, or `fixed` without verifying evidence, per the PR review record), passes them as inherited findings under their gate IDs, and fills `{{bot}}` in `.claude/review/slots/substitute.md`. Its readers are injectable (`readersImpl`) so the tests below run without the network.
  - CLI `review.mjs pr-record --pr <n>`: reads live state, writes a draft record listing every slot and blocking finding, leaving dispositions for the author, then prints `evaluateGate`'s lines. `review.mjs check --pr <n>` evaluates without writing.
  - Workflow `review-gate.yml`: `on: pull_request: types: [opened, synchronize, reopened, edited, labeled, unlabeled, ready_for_review]` and `pull_request_review: types: [submitted, dismissed]`; `permissions: contents: read, pull-requests: read, checks: read, actions: read` (`actions` for `prRunsFor`); grandfathering reads the `review-gate` key of `.github/review-activation.json` at the base ref (Task 15); job and check name `review-gate`; `fetch-depth: 0`, `persist-credentials: false`; `node scripts/ci/review-gate.mjs`; concurrency keyed on PR number and head SHA, `cancel-in-progress: false`.

- [ ] **Step 1: Write the failing tests:**

```js
ok('mechanical PR with no blocking finding needs no record', (await evaluateGate({ state: mech, record: null, depth: 'mechanical' })).ok)
ok('mechanical PR with a blocking thread needs a record', (await evaluateGate({ state: mechWithP1, record: null, depth: 'mechanical' })).ok === false)
ok('a nit thread needs no entry', (await evaluateGate({ state: withNitOnly, record: slotsOnly, depth: 'standard' })).ok)
ok('a bot-resolved CodeRabbit thread passes without an entry', (await evaluateGate({ state: crResolvedByBot, record: slotsOnly, depth: 'standard' })).ok)
ok('an author-resolved blocking thread still needs an entry', (await evaluateGate({ state: authorResolvedP1, record: slotsOnly, depth: 'standard' })).ok === false)
ok('reclassified without a reason -> FAIL naming the missing reason', await (async () => { const r = await evaluateGate({ state: p1, record: reclassNoReason, depth: 'standard' }); return r.ok === false && /reason/.test(r.lines.join()) })())
ok('a new blocking finding after the record -> FAIL naming it', /thread:/.test((await evaluateGate({ state: p1Later, record: older, depth: 'standard' })).lines.join()))
ok('a finding located only in .review/ is outside the gate', (await evaluateGate({ state: findingInEvidence, record: slotsOnly, depth: 'standard' })).ok)
ok('subtle-correctness with all three bots failed and three substitutes from three vendors -> ok', (await evaluateGate({ state: allFailed, record: threeSubs, depth: 'subtle-correctness' })).ok)
ok('Gemini findings from an earlier identity still need dispositions', blockingFindings(geminiTwoIdentities).filter((f) => f.source === 'gemini').length === 3)
ok('fixed + SHA with no bot evidence after the fix -> FAIL', (await evaluateGate({ state: fixedNoReReview, record: fixedRec, depth: 'standard' })).ok === false)
ok('fixed naming the commit the Gemini finding was reported on -> FAIL naming it, though that verdict has the current identity', /gemini:/.test((await evaluateGate({ state: geminiFixedAtReported, record: fixedAtReportedRec, depth: 'standard' })).lines.join()) && (await evaluateGate({ state: geminiFixedAtReported, record: fixedAtReportedRec, depth: 'standard' })).ok === false)
ok('fixed naming an ancestor of the reported commit -> FAIL naming the thread', await (async () => { const r = await evaluateGate({ state: threadFixedBeforeReported, record: fixedBeforeReportedRec, depth: 'standard' }); return r.ok === false && /thread:/.test(r.lines.join()) })())
ok('fixed naming a later commit that leaves the identity unchanged -> FAIL naming the thread', await (async () => { const r = await evaluateGate({ state: threadFixedSameIdentity, record: fixedSameIdentityRec, depth: 'standard' }); return r.ok === false && /thread:/.test(r.lines.join()) })())
ok('fixed thread whose only later review is on a commit off the fix commit, dated after it -> FAIL naming the thread', await (async () => { const r = await evaluateGate({ state: reviewOffFixLaterDate, record: fixedRec, depth: 'standard' }); return r.ok === false && /thread:/.test(r.lines.join()) })())
ok('fixed cr: finding read from an issue comment (no reported commit) -> FAIL naming it; with an accepted substitute resolving it -> ok', await (async () => { const r = await evaluateGate({ state: crIssueCommentFixed, record: crFixedRec, depth: 'standard' }); return r.ok === false && /cr:/.test(r.lines.join()) && (await evaluateGate({ state: crIssueCommentFixed, record: crFixedWithSub, depth: 'standard' })).ok })())
ok('a human-opened thread is not a blocking finding', blockingFindings(humanThread).length === 0)
ok('bot finding -> fix -> unrelated commit -> bot fails -> substitute inherits the fixed-but-unverified finding and resolves it -> ok', (await evaluateGate({ state: fixUnrelatedThenFail, record: withSubResolving, depth: 'subtle-correctness' })).ok)
ok('Gemini finding -> fix -> Gemini could-not-run -> substitute resolves it -> ok', (await evaluateGate({ state: geminiFixedThenFailed, record: withSubResolving, depth: 'subtle-correctness' })).ok)
ok('re-review repeats the defect as a new Gemini index -> FAIL on the new ID', /gemini:.*:2/.test((await evaluateGate({ state: geminiRepeats, record: fixedFirstOnly, depth: 'subtle-correctness' })).lines.join()))
ok('fixed + SHA with a covering review after the fix and the thread resolved -> ok (fixture: the fix commit strictly descends from the reported commit and changes the identity)', (await evaluateGate({ state: fixedReReviewed, record: fixedRec, depth: 'standard' })).ok)
ok('pr-record writes every blocking finding with an empty disposition for the author', draft.findings.length === blockingFindings(stateWithTwo).length && draft.findings.length === 2 && draft.findings.every((f) => f.disposition === null))
ok('substitute run, end to end: stubbed live readers -> record -> gate ok', await (async () => { const rec = await runSubstitute({ bot: 'codex', readersImpl: liveFixedUnverified, reviewerImpl: resolvesAll }); return rec.findings.some((f) => f.id === 'thread:PRRT_1' && f.disposition.kind === 'fixed') && (await evaluateGate({ state: fixUnrelatedThenFail, record: prRecWithSub(rec), depth: 'subtle-correctness' })).ok })())
ok('substitute run carries a fixed-but-unverified finding, not a verified one', (await runSubstitute({ bot: 'codex', readersImpl: oneVerifiedOneNot, reviewerImpl: captures })).sentInherited.join() === 'thread:PRRT_2')
ok('R1 resolves G, R2 chains from R1: R2 persists G as fixed with R1 as by, never sends G to the reviewer, and the gate passes on R2', await (async () => { const r1 = await runSubstitute({ bot: 'codex', readersImpl: liveFixedUnverified, reviewerImpl: resolvesAll }); const sent = []; const r2 = await runSubstitute({ bot: 'codex', supersedes: r1.stem, readersImpl: liveAfterR1, reviewerImpl: rejectsIds(['thread:PRRT_1'], sent) }); const g = r2.findings.find((f) => f.id === 'thread:PRRT_1'); return g && g.disposition.kind === 'fixed' && g.disposition.by === r1.stem && !sent.includes('thread:PRRT_1') && (await evaluateGate({ state: fixUnrelatedThenFail, record: prRecWithSub(r1, r2), depth: 'subtle-correctness' })).ok })())
ok('second substitute review: an open finding chains under the same gate ID and resolves -> gate ok', await (async () => { const r1 = await runSubstitute({ bot: 'codex', readersImpl: liveFixedUnverified, reviewerImpl: leavesOpen }); const r2 = await runSubstitute({ bot: 'codex', supersedes: r1.stem, readersImpl: liveFixedUnverified, reviewerImpl: resolvesAll }); return r2.findings.some((f) => f.id === 'thread:PRRT_1' && f.disposition.kind === 'fixed') && (await evaluateGate({ state: fixUnrelatedThenFail, record: prRecWithSub(r1, r2), depth: 'subtle-correctness' })).ok })())
ok('substitute run fills {{bot}} in substitute.md', (await runSubstitute({ bot: 'gemini', readersImpl: none, reviewerImpl: captures })).prompt.includes('gemini') && !(await runSubstitute({ bot: 'gemini', readersImpl: none, reviewerImpl: captures })).prompt.includes('{{bot}}'))
ok('API error -> exit 1 "could not judge"', await (async () => { const r = await quiet(() => main({ env: goodEnv, fetchImpl: stub403 })); return r.code === 1 && /could not judge/.test(r.out) })())
ok('a PR created before the review-gate activation time is exempt; one created after is judged', (await quiet(() => main({ env: goodEnv, fetchImpl: activationFile({ 'review-gate': '2026-11-05T00:00:00Z' })(prCreatedAt('2026-11-04T23:59:59Z', failingState)) }))).code === 0 && await (async () => { const r = await quiet(() => main({ env: goodEnv, fetchImpl: activationFile({ 'review-gate': '2026-11-05T00:00:00Z' })(prCreatedAt('2026-11-05T00:00:01Z', failingState)) })); return r.code === 1 && /thread:/.test(r.out) })())
ok('a review-evidence key alone does not exempt from review-gate (failingState holds one undisposed blocking thread, which the judged output names)', await (async () => { const r = await quiet(() => main({ env: goodEnv, fetchImpl: activationFile({ 'review-evidence': '2026-11-05T00:00:00Z' })(prCreatedAt('2020-01-01T00:00:00Z', failingState)) })); return r.code === 1 && /thread:/.test(r.out) })())
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** The gate reads labels, body, reviews, comments, threads and the CodeRabbit check live, and reads `.review/pr/<n>.json` and `.review/records/` from the PR head checkout.
- [ ] **Step 4: Edit the template and `.claude/rules/process.md` § Evidence:** after triage, run `npm run review -- pr-record --pr <n>`, fill the dispositions, commit; the commit fires `synchronize` and the gate re-runs.
- [ ] **Step 5: Run `npm test`.** Expected: exit 0.
- [ ] **Step 6: Commit** (`feat(ci): PR review record and review-gate`). Push PR D with approval.

### Task 24 (operator): Attachment, acceptance cases, then make `review-gate` required

- [ ] **Step 1:** on a test PR, submit a review and read `gh api repos/magora-project/magora-portal/commits/<head>/check-runs --jq '.check_runs[] | select(.name=="review-gate") | [.head_sha, .conclusion] | @tsv'`. Record whether the `pull_request_review` run's check is on the PR head (§5.5). If it is not, remove `pull_request_review` from the triggers in a follow-up commit; the record commit is the trigger.
- [ ] **Step 2:** run each remaining acceptance case once (§6 step 5) and record the run URL and conclusion: a rate-limited CodeRabbit (or a `skipped` check run as its stand-in, said so), a Gemini that couldn't run (a test branch whose workflow run has the key unset), an oversized diff (expect red with "split this PR", whatever substitutes exist), a force-push followed by a full-review request, a Dependabot PR, and an evidence-only commit after a green gate (expect still green, and Gemini posts `skipped-same-identity`).
- [ ] **Step 3 (David, approved):** add `review-gate` to the required checks and read back as in Task 16; expect 10 entries. Immediately after, capture the UTC time; a PR classified and evidenced as in Task 16 Step 2 (`Plan:` this plan `T24`) adds the `review-gate` key to `.github/review-activation.json`, and also needs its PR review record `.review/pr/<n>.json` **in every case**: as a `subtle-correctness` PR it requires all three bot slots, and Task 23 requires a record whenever the depth requires any slot; after it merges, re-run `review-gate` on the PRs open at activation, as in Task 16 Step 3.
- [ ] **Fork with maintainer edits off:** not run separately for `review-gate`. The gate reads `.review/pr/<n>.json` from a tree the maintainer cannot push to, so §5.3's move-to-a-same-repo-PR path applies, and Task 16 already exercised it.

---

## Phase 5: Onboarding

### Task 25 (operator): Noah onboards on Windows (rollout step 6)

- [ ] **Step 1 (Noah):** from `CONTRIBUTING.md` alone, install the prerequisites and run First run. Report each gap as it is hit.
- [ ] **Step 2 (Noah):** in Claude Code, `/skills` lists the repo skills as project skills; `superpowers:writing-plans` is denied by the hook; a prompt receives the lane reminder.
- [ ] **Step 3 (Noah):** from a clean clone, `npm run review -- init-local --lane direct --depth standard`, then `npm run review -- run --slot correctness --author anthropic` on a one-line test branch writes a `completed` record, and `npm run review -- check --local` agrees with what CI's `review-evidence` says on the pushed PR.
- [ ] **Step 4:** each gap becomes a fix PR under this process. Then David and Noah discuss Noah's personal layer (§8.1, rollout step 7).
