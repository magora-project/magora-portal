# Process rules

The repo's single process document, distilled from `docs/superpowers/specs/2026-10-29-shared-dev-process-design.md`.
Every agent and contributor follows it. If this file and the spec disagree, the spec wins; fix this file.
The checks and tooling named here are enforced as each ships (spec §6); do not hunt for tooling that does not exist yet.

## Lanes

(spec §5.2) Test **Specced** first. It wins any overlap.

- **Specced:** any change that alters behaviour, touches more than one module, adds a capability, or goes near migrations, auth, money or PII. Also any config change, unless the change is literally a comment.
- **Direct:** docs-only changes, a comment, a rename, a revert, or a one-line or single-file mechanical edit.
- **When unsure,** the lane is Specced.

The PR-body `Lane:` value `docs-only` is a different, narrower sense from Direct's "docs-only changes": it means a PR that only adds or changes a spec or plan, and it has its own evidence rules.

PR body fields that CI parses (CI checks they are present and well formed, not whether the lane was right):

- **Lane:** `specced`, `direct`, `docs-only` (only adds or changes a spec or plan), or `dependency` (Dependabot).
- **Spec:** a path. Required for `specced`.
- **Plan:** a path plus the covered task IDs. Required for `specced`.
- **Deviations:** one entry per unfixed deviation ID from the conformance record, with its justification.

## Stages

(spec §5.1) Every change moves through these stages, in order.

1. **Lane:** Specced or Direct. Evidence: PR body fields; `review-evidence`.
2. **Brainstorm, then spec.** Local, repo skill.
3. **Spec review:** Semgrep, then a reviewer per the dispatch table. Evidence: spec record.
4. **Plan**, with typed task targets. Local, repo skill.
5. **Plan review:** typed reference check, Semgrep, a reviewer. Evidence: plan record.
6. **Implement:** subagent-driven, with per-task review by depth.
7. **Local checks,** then CI. Evidence: the existing required CI checks.
8. **Plan conformance.** It runs before pre-push review, because its fixes change the diff. Evidence: conformance record.
9. **Pre-push review,** by depth label, of the post-conformance diff. Evidence: pre-push record(s).
10. **Push,** with the developer's approval. The Node pre-push hook warns; CI is the gate.
11. **PR:** template fields and depth label. Evidence: `label-gate` and `review-evidence`.
12. **CI:** the existing required checks.
13. **Bot reviews,** triage, then the PR review record. Evidence: `review-gate`.
14. **Merge:** squash, by the author (a maintainer, for fork and Dependabot PRs). Enforced by branch protection.

## Review slots and dispatch

(spec §5.3, §5.5)

Slots are fixed IDs, each with a canonical prompt file in `.claude/`: `spec`, `plan`, `conformance`, `correctness`, `completeness`, `substitute:<bot>` (`substitute:coderabbit`, `substitute:codex`, `substitute:gemini`). An execution outcome is one of `completed`, `failed`, `refused`, `truncated`, `timeout`. Only `completed` with a recognized, non-empty result counts; an empty reviewer reply is an unrun review, not a pass.

**Pre-push slots by depth:**

- `mechanical`: no pre-push record.
- `standard`: a `correctness` record.
- `subtle-correctness`: a `correctness` record and a `completeness` record, from different models. `completeness` asks: is anything promised missing, can the tests fail, what did the fixes break.

**Dispatch.** The reviewer's vendor must differ from the vendor that wrote the change.

| Written by | Primary | Fallback |
|---|---|---|
| Claude (Anthropic) | Codex CLI (OpenAI) | Gemini, local (Google) |
| Codex (OpenAI) | Opus or Fable (Anthropic) | Gemini, local (Google) |

On `subtle-correctness`, `completeness` uses whichever of the three vendors is neither the author nor the `correctness` reviewer.

**PR-stage matrix (bots).**

| Depth | Required slots |
|---|---|
| `mechanical` | none |
| `standard` | one of CodeRabbit or the Codex GitHub App |
| `subtle-correctness` | CodeRabbit, the Codex GitHub App, and Gemini |

**Records needed by lane.**

| Lane / author | Spec | Plan | Conformance | Pre-push | PR review |
|---|---|---|---|---|---|
| `specced` | for the current blob of the linked spec | likewise | for the declared tasks | by depth | per §5.5 |
| `docs-only` | each spec added or changed | each plan added or changed | none | none | per §5.5 |
| `direct` | none | none | none | by depth | per §5.5 |
| `dependency` (maintainer supplies) | none | none | none | one `correctness` | per §5.5 |
| Fork PR (maintainer supplies) | as its lane requires | as its lane requires | as its lane requires | as its lane requires | per §5.5 |

A record covers a review-input identity: for a PR, the patch-id of its own diff against its current merge base, excluding `.review`; for a spec or plan, its git blob hash. A fix commit voids the record that found the problem; the re-review writes a new record that names the one it supersedes, covers the new identity, inherits every undisposed finding, and reviews only the delta (the two identities, or the two blobs for a spec or plan). Its question is "did the fixes break anything, and is anything blocking still open?" Two exceptions send the full current input instead of the delta alone: when the superseded record's outcome was not `completed` (nobody reviewed the earlier input), and, alongside the delta, when the re-review inherits an undisposed blocking finding (a delta that does not touch a finding cannot show it fixed).

**Substitution.** A bot slot is filled by a local full review of the current identity, by a vendor not already counted on the PR, recorded as `substitute:<bot>`; it inherits that bot's undisposed blocking findings. It applies when the bot is not configured for the PR (Gemini is not configured on fork, Dependabot and draft PRs), after a terminal failure (read only from CodeRabbit's commit-status description such as "Review rate limited" or "Review skipped", an empty review, or the Gemini job's conclusion or its `could-not-run` verdict marker; review bodies are never parsed), or after the timeout with no review (30 minutes after the head commit's push or a full-review request). When all three bots fail on `subtle-correctness`, each of the three vendors fills one slot. A diff over Gemini's 400,000-byte limit means the PR is split.

**After a rewrite that changes the identity,** ask for a full review: `@coderabbitai full review` and `@codex review`. An incremental review alone does not restore coverage.

The bots are told to skip the `.review/` evidence directory once plan Task 20 ships (the Codex App has no path filter, so that task adds the guidance to `AGENTS.md`); a finding located only there is outside the gate, whichever bot raised it.

## What blocks

(spec §5.6) Bot severity labels set the defaults; the author makes the final call.

| Category | Covers | Default for | Disposition |
|---|---|---|---|
| **Blocking** | Correctness, security, data loss, or a broken spec or plan promise | Codex P0-P2; CodeRabbit Critical and Major; every Gemini finding; local-record findings P0-P2; anything unparseable | A fix (verified by the chained re-review), or pre-existing |
| **Nit** | Wording, naming, style, "consider also", theoretical edge cases | Codex P3; CodeRabbit Minor, Nitpick and Trivial; local P3 | None needed |

**Reclassifying** a finding from blocking to nit needs a recorded one-line reason, which the merging maintainer can see. A nit the author thinks matters can simply be fixed.

**A fixed bot finding** names its fix commit, which must be in the head's history. The gate accepts it when the fix commit comes strictly after the commit the finding was reported on, changes the input identity from that commit's, and the same bot has usable coverage evidence on the fix commit or a later one with the current identity (a thread must also be resolved); or when an accepted substitute verified the fix. Commits are ordered by ancestry, never by dates. So the review that raised a finding never verifies its own fix, and a fix made by amending or rebasing the reported commit needs a substitute: make fixes in a new commit (plan Task 23).

**Accepted limitations** (spec §5.6, David, 2026-11-03): an incremental bot review need not re-read a fix, so a fix that a later commit reverts can still pass; and a lockfile cannot be split, so a PR whose diff is over Gemini's limit only because of it cannot pass the gate, and a maintainer merges it by an override outside the gate.

**Pre-existing** applies only when the defect is present on the base revision under the same reachable conditions, and the record gives the reason and the issue that tracks it. An unchanged line that this PR newly makes reachable is this PR's regression, not pre-existing.

The PR review record is required whenever the PR has at least one required slot or any finding that blocks by default; a `mechanical` PR with no such finding needs none. It lists each required slot with the review ID it relies on, each default-blocking finding with its stable ID and disposition, and each reclassification with its reason. Nits appear only if reclassified from blocking. `review-gate` passes when every required slot is covered or substituted, and every finding that blocks by default on the PR appears in the record with an acceptable disposition. A bot review arriving after the record with a new blocking finding fails the gate until the record is updated; a nit does not.

## Stop rule

(spec §5.6, discipline: no check enforces it) After two rounds in a row where every new finding sits in the previous round's own fixes, stop patching and restructure. By round three, change the reviewer's question as well as the model.

## Evidence

(spec §5.3) Records are committed to the PR in one evidence directory, `.review/`. PR comments, and checks posted with a personal token, are ruled out. Each record states its type and slot ID, the input identity it covers, the reviewer's model and vendor, the vendor that wrote the change, the outcome, the verdict, each default-blocking finding with a stable ID and disposition, and the record it supersedes. Conformance records also carry the covered task IDs, the deviation IDs, and each `command` target with its exit status.

**Fork PRs** (D-11): if the author allows maintainer edits, the maintainer pushes the evidence commit to the fork branch; otherwise the maintainer moves the change onto a same-repo branch, opens a new PR there, and regenerates the evidence. Either way a fork's content is untrusted code, and supplying its evidence runs it: `command` targets, tests, lint and build configs, dependencies installed by `npm ci`, the `.claude/` settings, hooks and skills an agent session loads, and `.githooks/` hooks, including `post-checkout` on checkout itself. So the maintainer reads the PR's **whole** diff before checking the branch out (on the PR page, or `git fetch` then `git diff`, which run none of it), and before any install, test, lint, build, agent session or push from that checkout.

`review-evidence` passes a record only when all four hold:

1. The outcome is `completed`, with a recognized, non-empty result.
2. The input identity matches the current one. For conformance, the task IDs match the Plan field and the unfixed deviation IDs exactly match the Deviations field.
3. The slot ID is the required one, and the vendor meets the independence rule.
4. Every recorded finding has an acceptable disposition, whatever the verdict.

## Promotion

(spec §5.7) The repo carries the process: `AGENTS.md` plus the committed `.claude/` (settings, Node hooks, skills, slot prompt files, and these rules). `.claude/**` is a control file. A script on David's Mac lists every change to the process files since the last promoted magora commit; David accepts or rejects each item, and accepted items land in claude-config as a commit naming the magora commit they came from. The same reviewed step carries claude-config changes into claude-b's frozen layer, as reviewed commits on the clone's `claude-b-frozen` branch, each accepted item cherry-picked on its own (never a branch merge, so a rejected commit never comes along), and accepted only together with any commit it depends on. An applied item must not undo the freeze; it is checked after each item (plan Task 19), and on a failure the branch is reset and the item rejected. David sets the cadence; the first promotion follows right after conformance ships (D-4). Noah and later developers change the process only through magora PRs, which are `subtle-correctness`.
