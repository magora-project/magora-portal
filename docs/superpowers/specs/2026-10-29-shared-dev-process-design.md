# magora-portal shared development process — design (Spec 3)

- **Date:** 2026-10-29
- **Status:** approved rev 5 (David, 2026-10-29). Rev 5 applies Codex round 4. On approval David
  also settled the open items on accounts and the trial period (D-15, D-16; §8). Rev 6 (2026-11-03)
  amends §5.7 with David's Task 8 rulings on how claude-b is unlinked; a 2026-11-04 addition to
  §5.7 requires the reverse promotion not to undo the freeze. Review history: §10.
- **Builds on:** Spec 1 (`2026-10-15-repo-harness-design.md`): CI, depth labels, Layer 1 / Layer 2
  review.
- **Reverses one Spec 1 decision:** pre-push review was "discipline, not a control". Here a skipped
  step blocks the merge (D-1).
- **Process map:** https://claude.ai/artifact/QSBKEVoeewx3haLaRiH4Gu

This document specifies; it implements nothing.

## 1. Why

magora-portal is being set up to scale beyond two developers.

Today, the process that actually runs on David's sessions lives in his personal
`~/code/claude-config`, not in the repo. That covers:

- deciding when a change needs a spec;
- spec and plan review;
- pre-push review tooling;
- push-readiness;
- worktree gates.

A developer who clones the repo gets `AGENTS.md`, the PR template and CI. Pre-push review is
"discipline", and nothing checks that it happened.

The goal is one process every developer runs, on Windows or Mac, with Claude Code as the main coding
agent. Skipping a step blocks the PR, and the developers change the process together through magora
PRs.

## 2. Goals, non-goals, anti-goals

**Goals**

1. One process for every developer, defined in the repo, from idea to merge (§5).
2. Spec, plan and pre-push reviews run locally through the developer's own Claude. Each leaves
   evidence, and a required CI check verifies it (§5.3).
3. **Plan conformance:** before push, a PR that implements a plan is compared with it. Every
   deviation is fixed or justified (§5.4).
4. **PR-stage review on GitHub:** the reviews run on GitHub Apps and Actions, under David's
   adversarial review matrix. A required check verifies the author's record of that review against
   live GitHub state (§5.5).
5. Everything a developer runs works on Windows and macOS.
6. **The repo is canonical for `claude-b`** (David's account, used only for magora). Changes reach
   `~/code/claude-config` only through a promotion step David reviews (§5.7).

**Non-goals**

- Stopping a maintainer who deliberately fakes evidence. The design catches forgetting, not
  cheating (§2.1).
- Running local reviews in CI.
- Changing Spec 2.
- Sharing David's whole personal config.

**Anti-goals** (failure even if everything technically works)

- **Reviews that descend into minutiae.** That includes re-review loops over wording, and repeated
  whole-branch passes that rediscover old problems.
- **A gate that can block forever.** No PR may reach a state that nothing the author or a
  maintainer does can clear.
- **A gate that passes vacuously.** No check may pass while the review it stands for never ran, ran
  and failed, or left a blocking finding open.
- **A process that only works on David's Mac.**
- **Automatic fan-out of process changes to David's other repos.**
- **Machinery out of proportion to a two-maintainer repo.** Prefer an explicit local step plus a
  simple check over inferring state from bot prose.

### 2.1 Trust boundary

- **What Spec 1 §2.1 already accepts:** a same-repo PR can edit the workflow that checks it, and
  evidence can be written by hand. Both remain accepted.
- **What this design guarantees:** an honest developer who forgets a step cannot merge.
- **No gating status is ever posted with a personal credential.** The new checks are GitHub Actions
  jobs triggered by `pull_request` and `pull_request_review` events, and each job's own pass or fail
  is the check.

## 3. Current state (read 2026-10-29)

**Repo files and workflows**

- `AGENTS.md` (size-ratcheted) and `.github/pull_request_template.md`.
- `ci.yml`: lint and test on Ubuntu and Windows, plus build, deno and migrations.
- `label-gate.yml`.
- `gemini-review.yml` is advisory:
  - It runs only on same-repo, non-Dependabot, non-draft `subtle-correctness` PRs.
  - It diffs `git diff "$BASE_SHA...$HEAD_SHA"`, with no pathspec.
  - `gemini_review.py` refuses diffs over 400,000 bytes.
  - It reports only P0/P1 findings or `NO FINDINGS`, in one PR comment posted with
    `GITHUB_TOKEN`. When the reviewer cannot run, the comment says "Gemini review could not run"
    instead.
- `semgrep.yml`, `osv-scan.yml` and `doc-size-ratchet.yml`.
- `.coderabbit.yaml` `path_filters` excludes `package-lock.json`, `dist/**` and `src/generated/**`.
- `.gitignore` excludes all of `.claude/`.

**Branch protection on `main`**

- There are 8 required checks.
- Spec 1 §5.7 also requires the branch to be up to date and conversations to be resolved. The
  session's token got a 403 when trying to read those settings back.

**Review bots**

- **CodeRabbit:**
  - Reviews each push incrementally; each review's `commit_id` is that push's head.
  - Does a full review on request.
  - Resolves its own threads once they are addressed.
- **Codex GitHub App:**
  - Reviews new commits, and re-reviews after an `@codex review` nudge (plan V6).
  - Never resolves its threads.

**claude-b**

- `~/.claude-b/` holds 12 symlinks (V7, enumerated 2026-11-01). Eleven point into
  `~/code/claude-config`: `CLAUDE.md`, `settings.json`, `hooks`, `skills`, `scripts`, `agents`,
  `commands`, `plugins`, `output-styles`, `reflections` and `.mcp.json`. `plans` points to
  `~/code/claude-memory/plans/claude-b`.
- In Claude Code, personal skills take precedence over same-named project skills. Plugin skills are
  namespaced and coexist with them.
- All personal hooks are bash or Python.
- The push-review marker gate is scoped to another repo. No pre-push hook is installed here.

## 4. Decisions (David, 2026-10-29)

| # | Decision |
|---|---|
| D-1 | A skipped step blocks the PR from merging. |
| D-2 | Spec, plan and pre-push reviews run **locally**, and CI checks their **evidence**. PR-stage reviews run on GitHub under David's adversarial review matrix. |
| D-3 | **Plan conformance:** when a build differs from its plan, the PR either changes the code to match, or justifies the difference. The justification says why the plan's version isn't needed, and why the built version is better. |
| D-4 | The conformance rule applies to all of David's repos, through promotion (§5.7). |
| D-5 | The magora repo is canonical for `claude-b`. Changes move into `~/code/claude-config` only through an update David reviews item by item. Nothing fans out automatically. |
| D-6 | `claude-b` is used only for magora-portal, permanently. |
| D-7 | Bot findings are addressed when every thread is resolved and the reviewer has a clean re-review. A re-review that fails only on nits can be declined. |
| D-8 | The nit bar in §5.6. |
| D-9 | Developers use Windows or Mac, with Claude Code as the main coding agent. |
| D-10 | **Reviews bind to the PR's own changes.** Bringing in `main` keeps them valid, unless that changes the PR's own diff. |
| D-11 | **Dependabot and fork PRs:** the merging maintainer supplies the local reviews and records them. |
| D-12 | **Unlink claude-b entirely, before any trial.** Each symlink becomes a frozen copy trimmed to the non-process layer. Process rules move into the repo. |
| D-13 | **PR-stage gate:** when triage is done, the author commits a PR review record, and `review-gate` checks it against live GitHub state. There is no scheduled sweep, and nothing is inferred from bot prose. |
| D-14 | **The ledger holds blocking findings only.** The PR review record lists only findings that are blocking by default, plus any the author reclassified. Nits need no entry and no reply. |
| D-15 | **Accounts.** David's Magora Codex account is the Codex account whose GitHub App reviews both David's and Noah's work. David has the Gemini account set up for both developers. |
| D-16 | **No trial period.** `review-evidence` and `review-gate` become required as soon as each one ships, once its acceptance cases pass (§6). |

## 5. The process

### 5.1 End to end

| # | Stage | Runs where | Evidence / enforcement |
|---|---|---|---|
| 1 | **Lane:** Specced or Direct (§5.2) | Developer's Claude | PR body fields; `review-evidence` |
| 2 | **Brainstorm → spec** | Local, repo skill | — |
| 3 | **Spec review:** Semgrep, then a reviewer per the dispatch table (§5.3) | Local | Spec record |
| 4 | **Plan**, with typed task targets (§5.4) | Local, repo skill | — |
| 5 | **Plan review:** typed reference check, Semgrep, a reviewer | Local | Plan record |
| 6 | **Implement:** subagent-driven, with per-task review by depth | Local | — |
| 7 | **Local checks** | Local, then CI | Existing required CI checks |
| 8 | **Plan conformance** (§5.4). It runs before pre-push review, because its fixes change the diff. | Local | Conformance record |
| 9 | **Pre-push review**, by depth label, of the post-conformance diff | Local | Pre-push record(s) |
| 10 | **Push**, with the developer's approval | Local | The Node pre-push hook warns; CI is the gate |
| 11 | **PR:** template fields and depth label | GitHub | `label-gate` (existing) and `review-evidence` (new) |
| 12 | **CI** | GitHub | Existing required checks |
| 13 | **Bot reviews**, triage, then the PR review record (§5.5) | GitHub, then local | `review-gate` (new) |
| 14 | **Merge:** squash, by the author (a maintainer, for fork and Dependabot PRs) | GitHub | Branch protection |

### 5.2 Lane threshold and PR fields

The Specced/Direct rule moves from David's personal hook into the repo's rules (§5.7). Its substance
is unchanged:

- **Specced** is tested first and wins any overlap. It covers any change that alters behaviour,
  touches more than one module, adds a capability, or goes near migrations, auth, money or PII. It
  also covers any config change, unless the change is literally a comment.
- **Direct** covers docs-only changes, a comment, a rename, a revert, or a one-line or single-file
  mechanical edit.
- **When unsure,** the lane is Specced.

**PR body fields** that CI parses:

- **Lane:** `specced`, `direct`, `docs-only` (only adds or changes a spec or plan), or `dependency`
  (Dependabot).
- **Spec:** a path. Required for `specced`.
- **Plan:** a path plus the covered task IDs. Required for `specced`.
- **Deviations:** one entry per unfixed deviation ID from the conformance record, with its
  justification.

CI checks that the fields are present and well formed. It does not judge whether the lane was right.

### 5.3 Local review evidence

**Review-input identity** has one definition, used everywhere:

- **For a PR's changes:** the hash of the PR's own diff against its **current** merge base.
  - The identity is `git patch-id --verbatim` of
    `git diff -U0 --no-ext-diff --binary --no-color <merge-base> <head> -- . ':(exclude).review'`
    (the exact flags are in the plan, Task 10). Patch IDs ignore line numbers; `--verbatim` keeps
    whitespace, so an indentation-only change counts as a change. `-U0` drops context lines, so a change to `main` next to or above the
    PR's lines does not change the identity. The PR's own added and removed lines still do.
  - It is read from git objects, never working-tree bytes, so Windows and macOS agree.
  - It excludes the evidence directory. That is the only exclusion.
  - Known limitation (accepted 2026-11-02): it carries no location, so the same edit moved to another
    identical line keeps its identity. Line numbers would break D-10. This is an accepted exception
    to §2.1's forgotten-step guarantee. See plan Task 10.
  - The merge base stored in a record is provenance only. Bringing in `main` recomputes the
    identity, and records stay valid while it is unchanged (D-10).
- **For a spec or plan:** the git blob hash of the document.

**Slots** are fixed IDs. Each one has a canonical prompt file in `.claude/`:

- `spec`
- `plan`
- `conformance`
- `correctness`
- `completeness`
- `substitute:<bot>`

**Record contents.** Each record states:

- its type and slot ID;
- the input identity it covers;
- the reviewer's model and vendor, and the vendor that wrote the reviewed change;
- the execution outcome: `completed`, `failed`, `refused`, `truncated` or `timeout`;
- the verdict;
- the findings that block by default, each with a stable ID and a disposition (§5.6);
- the record it supersedes, if any;
- for conformance records, also the covered task IDs, the deviation IDs, and each `command` target
  with its exit status as run by the evidence writer.

**Re-review chaining.**

- **Why it's needed:** a fix commit that changes the identity voids the record that found the
  problem.
- **How it works:** the re-review writes a new record. That record names the one it supersedes,
  covers the new identity, and inherits every finding the old record left undisposed.
- **Scope of the re-review:** the delta between the two identities, or the two blobs for a spec or
  plan. The question is "did the fixes break anything, and is anything blocking still open?". A
  typo fix to a spec is therefore a small re-review, not a full one.
- **Delta only after a completed review:** the delta is sent only when the superseded record's
  outcome is `completed`. Otherwise nobody reviewed the earlier input, so the re-review gets the
  full current input. An empty reply or a timeout stays an unrun review, never a pass.
- **Full input while a finding is open:** a re-review that inherits an undisposed blocking finding
  gets the full current input as well as the delta. A delta that does not touch a finding cannot
  show it fixed.

**Where records live:** committed to the PR, in one evidence directory.

- PR comments, and checks posted with a personal token, are ruled out (§2.1).
- **Fork PRs (D-11):**
  - If the author allows maintainer edits, the maintainer pushes the evidence commit to the fork
    branch.
  - Otherwise, the maintainer moves the change onto a same-repo branch, opens a new PR there, and
    regenerates the evidence for it.
  - Either way, a fork's content is untrusted code. Supplying its evidence runs that code on the
    maintainer's machine: conformance runs the plan's `command` targets, `npm test` runs its
    tests, and a push from the checkout runs its `.githooks/pre-push`. Almost any changed file
    can execute: modules the tests import, `eslint.config.js` and `vite.config.js`, dependencies
    `package-lock.json` pulls in on `npm ci`, and the `.claude/` settings, hooks and skills an
    agent session loads, and with `core.hooksPath=.githooks` a fork's `post-checkout` hook runs
    on checkout itself. So the maintainer reads the PR's **whole** diff before checking the
    branch out (on the PR page, or `git fetch` then `git diff`, which run none of it), and
    before any install, test, lint, build, agent session or push from that checkout.
    (PR #52 Gemini and Codex, ruled by David 2026-11-03.)
- **Dependabot (D-11):** the maintainer's push stops Dependabot from rebasing the PR. With
  "up to date" required, the maintainer updates the branch by hand.

**Which records a PR needs:**

| Lane / author | Spec | Plan | Conformance | Pre-push | PR review |
|---|---|---|---|---|---|
| `specced` | for the current blob of the linked spec, wherever it was introduced | likewise | for the declared tasks | by depth | §5.5 |
| `docs-only` | each spec added or changed | each plan added or changed | — | — | §5.5 |
| `direct` | — | — | — | by depth | §5.5 |
| `dependency`, supplied by the maintainer | — | — | — | one `correctness` | §5.5 |
| Fork PR, supplied by the maintainer | as its lane requires | as its lane requires | as its lane requires | as its lane requires | §5.5 |

**Pre-push slots by depth:**

- `mechanical` needs no pre-push record.
- `standard` needs a `correctness` record.
- `subtle-correctness` needs a `correctness` record and a `completeness` record, from different
  models.

**Dispatch table.** The reviewer's vendor must differ from the vendor that wrote the change.

| Written by | Primary | Fallback |
|---|---|---|
| Claude (Anthropic) | Codex CLI (OpenAI) | Gemini, local (Google) |
| Codex (OpenAI) | Opus or Fable (Anthropic) | Gemini, local (Google) |

On `subtle-correctness`, `completeness` uses whichever of the three vendors is neither the author
nor the `correctness` reviewer.

**`review-evidence` acceptance predicate.** It passes a record only when all four hold:

1. The outcome is `completed`, with a recognized, non-empty result. Any other outcome fails,
   whatever the finding count.
2. The input identity matches the current one. For conformance records, the task IDs must also match
   the Plan field, and the unfixed deviation IDs must exactly match the Deviations field.
3. The slot ID is the required one, and the vendor meets the independence rule.
4. Every recorded finding has an acceptable disposition, **whatever the verdict.**

**When `review-evidence` runs:** on `pull_request` events `opened`, `synchronize`, `reopened`,
`edited`, `labeled` and `unlabeled`.

**Negative tests** cover each of these cases:

- a failed run with zero findings;
- a PASS that still has an open blocking finding;
- a missing second slot;
- a stale identity;
- an evidence-only commit, which must void nothing;
- a merge from `main` that changes lines next to the PR's lines, which must void nothing;
- a task-scope edit;
- a reviewer vendor that matches the author's.

**Grandfathering:** PRs opened before `review-evidence` becomes required are exempt, including the
Spec 2 PRs now in flight.

### 5.4 Plan conformance (D-3)

**Typed targets.** Each plan task lists its targets, each typed as `existing`, `create`, `modify`,
`delete` or `command`. This extends the Files block that writing-plans already produces.

- **Plan review** validates the `existing` targets.
- **Conformance** checks the declared tasks' postconditions:
  - `create` and `modify` targets are present and changed;
  - `delete` targets are gone;
  - each `command` target has been run by the evidence writer, with its exit status recorded.

**Model part.**

- **Reviewer:** chosen from the dispatch table, by who implemented the change. It receives the
  declared tasks and the PR's own diff.
- **What it lists:** every deviation, in both directions, each with an ID.
- **Safeguards:** it traces each safeguard the plan states to the code or test that implements it.

**Disposition.** Each deviation is either:

- fixed with a commit, after which the conformance re-review chains as in §5.3; or
- justified in the Deviations field, saying why the plan's version isn't needed and why the built
  version is better.

**Multi-PR plans:** each PR is checked against the task IDs it declares.

### 5.5 PR-stage review (D-2, D-7, D-13, D-14)

**Matrix.** My call, adapted from `claude-config/rules/review.md` and `rules/core.md` § Reviewer
dispatch:

| Depth | Required slots |
|---|---|
| `mechanical` | none |
| `standard` | one of CodeRabbit or the Codex GitHub App |
| `subtle-correctness` | CodeRabbit, the Codex GitHub App, and Gemini |

**Bots don't review the evidence.**

- The evidence directory is added to `.coderabbit.yaml` `path_filters`.
- Gemini's diff gets the pathspec `':!<evidence-dir>'`.
- The Codex App has no path filter, so review guidance telling it to skip the evidence directory is
  added to `AGENTS.md` (plan Task 20).
- Any finding located only in the evidence directory is outside the gate, whichever bot raised it.
  That last rule is what guarantees no loop.

Committing a record therefore never produces new findings to record.

**Coverage of a slot.** A slot is covered when the bot's **latest usable** review has a `commit_id`
whose input identity equals the current one.

- **Usable** means the review is non-empty, and its run did not end in a terminal failure (below). A
  failed review never establishes coverage. It is a ground for substitution.
- **Incremental reviews:** these accumulate, so the latest usable one matching the current identity
  is enough.
- **After a rewrite that changes the identity:** the author asks for a full review.
  - CodeRabbit: `@coderabbitai full review`.
  - Codex App: `@codex review`.
- **Coverage after the request:** coverage then needs a usable review from that bot, submitted after
  the request and on a commit with a post-rewrite identity. Later incremental reviews accumulate on
  top of it. An incremental review alone, with no usable review answering the request, does not
  restore coverage.
- **What the gate reads:** only the request's timestamp and the reviews' timestamps,
  `commit_id`s and emptiness. It never reads the bot's prose.

**Substitution.**

- **When it applies:**
  - **Immediately,** when the bot isn't configured for this PR. Gemini is not configured on fork,
    Dependabot and draft PRs.
  - **After a terminal failure.** The gate reads failure only from:
    - CodeRabbit's commit-status description, for example "Review rate limited" or
      "Review skipped: …";
    - an empty review;
    - the Gemini job's conclusion, or the verdict marker in its comment (`could-not-run`).

    Review bodies are never parsed.
  - **After a bounded timeout** with no review. The builder sets it; the suggestion is 30 minutes.
- **What fills the slot:** a local full review of the current identity, by a vendor not already
  counted on this PR. It is recorded as a `substitute:<bot>` record and inherits that bot's
  undisposed blocking findings.
- **Vendors:** when all three bots fail on `subtle-correctness`, each of the three vendors fills one
  slot.
- **Diff too large:** a diff over Gemini's 400,000-byte limit, local or not, means the PR is split.
  The spec does not chunk diffs.

**The PR review record.**

- **When it's required:** whenever the PR has at least one required slot, or any finding that blocks
  by default. A `mechanical` PR with no such finding needs none.
- **What it lists:**
  - each required slot, and the review ID it relies on;
  - each finding that blocks by default, with its stable ID and disposition;
  - each reclassification to nit, with its reason (D-14).
- **What counts as a stable ID:** a thread's ID, CodeRabbit's `cr-comment` marker for findings
  outside the diff, and Gemini's finding index via a verdict marker added to its comment.
- **Nits:** they appear only if reclassified from blocking.

**`review-gate`** is a GitHub Actions job.

- **Triggers:** `pull_request` events `opened`, `synchronize`, `reopened`, `edited`, `labeled`,
  `unlabeled` and `ready_for_review`, plus `pull_request_review`.
- **Before the gate is made required:** verify that a `pull_request_review` run's check attaches to the
  PR head. If it doesn't, the author re-commits the record after new reviews, which fires
  `synchronize`.
- **What it reads, all live from the API:** labels, body fields, reviews and their `commit_id`s,
  threads, review-body markers, Gemini's verdict marker, and the records.
- **It passes when:**
  - the diff is within Gemini's 400,000-byte limit. It checks this first: an oversized PR fails
    with "split this PR", whatever substitutes exist;
  - every required slot is covered or substituted;
  - every finding that blocks by default on the PR appears in the record with an acceptable
    disposition.
- **Threads:** conversation resolution is still required by branch protection.
  - A thread the author resolves needs no reply unless the finding blocks by default.
  - Bot-resolved threads (CodeRabbit's "addressed in <sha>") pass as they are.
- **A bot review that arrives after the record** with a new blocking finding fails the gate until the
  record is updated. A nit doesn't. Because the bots never review the evidence directory, this
  cannot loop.
  - **Not yet met for a late Gemini verdict.** Gemini posts an issue comment, which triggers no gate
    run, so a blocking finding in a verdict that lands after the gate has passed is not seen until
    the next run. Plan OPEN point 2 settles this, with tests, before `review-gate` is made required.
  - **The same gap delays a clean Codex review.** Its `codex-review-state:v1` marker is also an issue
    comment, so a gate that is waiting for Codex coverage stays red until the next PR event. This
    fails closed; until OPEN point 2 settles it, the author re-runs `review-gate` after the marker
    appears.

### 5.6 What blocks, and what can be declined (D-7, D-8, D-14)

Bot severity labels set the defaults, and the author makes the final call.

| Category | Covers | Default for | Disposition |
|---|---|---|---|
| **Blocking** | Correctness, security, data loss, or a broken spec or plan promise | Codex P0–P2; CodeRabbit Critical and Major; every Gemini finding (it emits only P0/P1); anything unparseable | A fix (verified by the chained re-review), or pre-existing (below) |
| **Nit** | Wording, naming, style, "consider also", theoretical edge cases | Codex P3; CodeRabbit Minor, Nitpick and Trivial | None needed (D-14) |

**Reclassifying.** Moving a finding from blocking to nit needs a recorded one-line reason, which the
merging maintainer can see. A nit the author thinks matters can simply be fixed.

**A fixed bot finding.** The record names the fix commit, which must be in the head's history. The
gate then accepts it when either:

- the fix commit comes strictly after the commit the finding was reported on and changes the
  input identity from that commit's, and usable coverage evidence from the same bot (§5.5) sits on
  the fix commit or a later one with the current identity (a thread must also be resolved); or
- an accepted substitute verified the fix.

So the review that raised a finding can never verify its own fix. The gate orders commits by
ancestry, never by dates, which the author sets. A finding whose reported commit is unknown can be
verified only by a substitute.

**Accepted limitation (David, 2026-11-03).** An incremental bot review need not re-read a fix, so a
fix that a later commit reverts can still pass. The gate cannot tell a review that answered a
full-review request from one that merely came after it, and Codex exposes only its latest review
marker. This review layer is discipline, not the control (AGENTS.md), so the limitation is
accepted rather than worked around.

**Accepted limitation (David, 2026-11-03): an unsplittable diff.** The 400,000-byte limit (§5.5)
applies to every PR, and a lockfile cannot be split. `package-lock.json` is 292,316 bytes, and the
largest of the last 40 Dependabot diffs on `main` is 47,349 bytes, so only a near-total lockfile
rewrite can cross the limit. Such a PR cannot pass the gate, and a maintainer merges it by an
override outside the gate. (PR #52 Gemini.)

**Pre-existing** applies only when:

- the defect is present on the base revision under the same reachable conditions; and
- the record gives the reason and the issue that tracks it.

An unchanged line that this PR newly makes reachable counts as this PR's regression, not as
pre-existing.

**Stop rule (discipline).** After two rounds in a row where every new finding sits in the previous
round's own fixes, stop patching and restructure. By round three, change the reviewer's question as
well as the model.

### 5.7 Canonical home, unlink and promotion (D-4, D-5, D-6, D-12)

**The repo carries the process.**

- **Where it lives:** `AGENTS.md`, plus a committed `.claude/` holding:
  - settings and Node hooks;
  - skills: brainstorming, writing-plans, codex-review, push-readiness and conformance;
  - the slot prompt files (§5.3);
  - rule files for the process rules that `AGENTS.md`'s size cap can't hold.
- **Which skills run:** repo instructions invoke the repo skills by their project names. The builder
  decides how to keep the superpowers plugin's same-purpose skills from being invoked instead.
  Onboarding on both operating systems verifies which source actually loaded.
- **`.gitignore`:** stop ignoring `.claude/` as a whole. Keep ignoring only machine-local state:
  `.claude/worktrees/` and `.claude/settings.local.json`.
- **Control files:** `.claude/**` and the evidence-directory exclusions in `.coderabbit.yaml` and
  `gemini-review.yml` join the control-file list.

**Unlink claude-b (D-12).** This is rollout step 1.

- **Freeze through a clone, not copies (rev 6).** Copying each link cannot freeze claude-b: the
  kept hooks, scripts and rules call `~/code/claude-config` by absolute path, so a copy would keep
  running live claude-config. Instead, `~/.claude-b-config` is a clone of claude-config on the local
  branch `claude-b-frozen`, with every runtime path rewritten to point into the clone. The
  `~/.claude-b` symlinks stay symlinks, now pointing into the clone.
- **Trim to the layer that isn't process:**
  - secrets handling;
  - machine safety and local guards;
  - push approval;
  - shell and platform rules;
  - personal working discipline: model routing and verify-against-source (rev 6).
- **One exception: `plans` stays linked** to `~/code/claude-memory/plans/claude-b` (rev 6). It is
  storage, not process: it is how approved plans survive a crashed session.
- **Remove overlaps.** Personal skills that share a name with a repo skill are removed from
  claude-b.
- **Record the inventory.** The rollout PR records what was kept, and where each moved process rule
  now lives in the repo (`docs/process/claude-b-inventory.md`).

**Promotion: magora → claude-config.**

- **Input:** a script on David's Mac lists every change to the process files (`AGENTS.md`,
  `.claude/**` and the review scripts) since the last promoted magora commit.
- **Review:** David accepts or rejects each item.
- **Landing:** accepted items land as a claude-config commit that names the magora commit they came
  from.
- **The other direction:** the same reviewed step carries claude-config changes into claude-b's
  frozen layer, as a reviewed merge into the clone's `claude-b-frozen` branch (rev 6). It is
  all or nothing: David reviews every claude-config commit since the last promotion and accepts
  or rejects the range as a whole, so no accepted change depends on a rejected commit. A merge
  conflict, which edits to a file the freeze trimmed will cause, is resolved by David keeping the
  trim, and in no other way. There is no one-off exclusion: to keep a change out of claude-b,
  David makes it a freeze trim (a reviewed change to `docs/process/claude-b-inventory.md`), or
  rejects the range; live claude-config is never edited for claude-b. The result must not undo
  the freeze: no runtime file reads live
  claude-config, nothing the freeze removed is back (a personal skill sharing a repo skill's
  name, a dropped hook wiring, a dropped `CLAUDE.md` entry), and every wired hook still runs.
  The promotion script checks this on the final result; on a failure it resets the branch to
  its pre-merge commit and the range is rejected. Plan Task 19
  defines the checks. (Added 2026-11-04 for PR #56's CodeRabbit finding and push-gate review.)
- **Accepted limitation (David, 2026-11-04):** trimming, at the freeze or by keeping a trim in a
  conflict, can leave a kept file calling trimmed content. The checks catch a kept file that
  names a trimmed skill or path, other than the known dangling pointers the inventory lists;
  they cannot catch a call no harmless hook run reaches. David's review of the range is the
  mitigation.
- **Cadence:** set by David.
- **First promotion:** right after conformance ships (D-4).

**Noah and later developers** run the repo layer on their own accounts. They change it through
magora PRs, which are `subtle-correctness` because `.claude/**` and `AGENTS.md` are control files.

### 5.8 Windows

- **Node for everything a developer runs.** That covers:
  - the hooks;
  - the evidence writer;
  - the conformance check;
  - the PR review record writer;
  - the pre-push hook;
  - local Gemini, a Node port of `gemini_review.py`'s request.
- **The only exception** is the promotion script, which runs only on David's Mac.
- **The pre-push hook** is a shim that calls Node, through `core.hooksPath` pointed at a committed
  hooks directory. It warns and never blocks.
- **Prerequisites,** listed in `CONTRIBUTING.md`:
  - Claude Code;
  - the Codex CLI, signed in;
  - Semgrep;
  - Node 24 (`.nvmrc`, V8);
  - Deno 2.9.5;
  - `gh`;
  - a Gemini key, from the Gemini account David set up for both developers (D-15).

## 6. Rollout

1. **Unlink claude-b** (§5.7), then add the repo layer:
   - `.gitignore` and the committed `.claude/`;
   - Node hooks and the process rules;
   - PR template fields and `CONTRIBUTING.md`.
2. **Evidence writer, slot prompts and `review-evidence`.**
3. **Typed task targets and conformance,** then the first promotion to claude-config.
4. **PR review record writer, evidence exclusions for the bots, Gemini verdict marker and
   `review-gate`.**
5. **Make each check required as soon as it ships (D-16).** There is no trial period. David approves
   each branch-protection change, and it is read back. Before a check is made required, it must have
   passed and failed correctly on test PRs, and each of its acceptance cases must have run once. The
   cases are:
     - a failed review with zero findings;
     - an evidence-only commit;
     - a merge from `main` next to the PR's lines;
     - a task-scope edit;
     - a rate-limited CodeRabbit;
     - a Gemini that couldn't run;
     - a Dependabot PR;
     - a fork with maintainer edits off;
     - a force-push followed by a full-review request.
6. **Noah onboards on Windows** from `CONTRIBUTING.md` alone, and the gaps he hits are fixed.
7. **Next step: talk with Noah about his personal layer** (§8, item 1).

## 7. Left to the builder

- The evidence directory and record schema (within §5.3).
- The stable finding IDs used for each bot.
- Whether `pull_request_review` checks attach to the PR head, and the fallback if they don't.
- The substitution timeout.
- How the pre-push hook is installed.
- How plugin skills are kept from shadowing the repo skills.
- Which personal skill overrides are vendored as-is, and which are trimmed.

## 8. Open decisions for David and Noah

1. **Noah's personal layer:** whether Noah keeps one like claude-b's. This is the next step to
   discuss with Noah (§6 step 7).

Settled on approval: accounts (D-15) and no trial period (D-16).

## 9. Out of scope

- Staging, backups and secrets (Spec 2).
- Running local reviews in CI.
- A `dev` branch with promotion to `main`. David raised it and dropped it on 2026-10-29.
- Changing David's other repos directly.

## 10. Review log

| Round | Reviewer | Result | Disposition |
|---|---|---|---|
| 1 | Builder check: fresh Opus subagent, read-only, rev 1 | 5 questions, 2 minor | Q1, Q2 and Q5 became D-10, D-11 and D-12 (David). Q3 and Q4 are settled in §5.5 and §5.4. The minor ones led to grandfathering, and to ruling out personal-token checks. |
| 1 | Semgrep (`semgrep-artifact-scan.sh`), rev 1 | UNRUN: no code blocks to scan | — |
| 1 | Codex CLI, read-only, rev 1, correctness and feasibility | REWORK: 7 P1, 5 P2, 1 P3 | Applied in rev 2. Round 2 found 8 addressed and 5 partly addressed. |
| 2 | Codex CLI, read-only, rev 2: closure of round 1, and what the fixes broke | REWORK: 5 P1, 4 P2 | This was the second self-inflicted round, so the gate was restructured as D-13 (David). The rest were applied in rev 3. |
| 3 | Fable subagent, read-only, rev 3. Changed model and question: completeness, executability, what rev 3 broke, proportion | REWORK: 3 P1, 6 P2, 3 P3, plus one proportion cut | All applied in rev 4. P1-1: bots exclude the evidence directory. P1-2: coverage by the latest review's identity, and full review by the author's request. P1-3: a record is required whenever a blocking finding exists. P2-1: bot-resolved threads pass. P2-2: immediate substitution when a bot isn't configured, and a split when the diff is oversize. P2-3: conformance runs before pre-push review. P2-4: `-U0` identity, and re-review chaining. P2-5: slot IDs with prompt files. P2-6: failure is read from statuses only. The P3s are §5.3, §5.4 and the triggers. Proportion became D-14 (David). |
| 4 | Codex CLI, read-only, rev 4, scoped: did rev 4 close round 3, and what did it break | REWORK: 1 new P1, 2 new P2. Of round 3's items, 4 partial; the rest addressed. | All applied in rev 5. New P1: a failed review never establishes coverage. P2: the identity uses `git patch-id --stable`, which ignores line numbers. P2: coverage after a rewrite needs a usable review answering the full-review request. Partial items: Codex App skips the evidence directory via `AGENTS.md`, findings there are outside the gate, and the Gemini failure signal is its job conclusion or verdict marker. **Rev 5's changes have not been re-reviewed.** |
| — | Rev 6 amendment (David's Task 8 rulings, 2026-11-03; `docs/process/claude-b-inventory.md`) | §5.7 only: frozen clone instead of frozen copies; `plans` stays linked; model routing and verify-against-source join the kept layer; the reverse promotion is a reviewed merge into `claude-b-frozen`; 2026-11-04 addition (PR #56, CodeRabbit and push-gate review): the reverse promotion is all or nothing per range of claude-config commits, and the merge must not undo the freeze, checked after it (plan Task 19 Step 5), with reset and rejection on failure | **Not yet reviewed.** |
