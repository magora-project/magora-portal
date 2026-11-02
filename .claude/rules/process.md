# Process rules

The repo's single process document, distilled from `docs/superpowers/specs/2026-10-29-shared-dev-process-design.md`.
Every agent and contributor follows it. If this file and the spec disagree, the spec wins; fix this file.

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
14. **Merge:** squash, by the author. Enforced by branch protection.

## Review slots and dispatch

(spec §5.3, §5.5)

Slots are fixed IDs, each with a canonical prompt file in `.claude/`: `spec`, `plan`, `conformance`, `correctness`, `completeness`, `substitute:<bot>` (`substitute:coderabbit`, `substitute:codex`, `substitute:gemini`). An execution outcome is one of `completed`, `failed`, `refused`, `truncated`, `timeout`. Only `completed` with a recognized, non-empty result counts; an empty reviewer reply is an unrun review, not a pass.

**Pre-push slots by depth:**

- `mechanical`: no pre-push record.
- `standard`: a `correctness` record.
- `subtle-correctness`: a `correctness` record and a `completeness` record, from different models.

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
| `specced` | for the current blob of the linked spec | likewise | for the declared tasks | by depth | required |
| `docs-only` | each spec added or changed | each plan added or changed | none | none | required |
| `direct` | none | none | none | by depth | required |
| `dependency` (maintainer supplies) | none | none | none | one `correctness` | required |
| Fork PR (maintainer supplies) | as its lane requires | as its lane requires | as its lane requires | as its lane requires | required |

A record covers a review-input identity: for a PR, the patch-id of its own diff against its current merge base, excluding `.review`; for a spec or plan, its git blob hash. A fix commit voids the record that found the problem; the re-review writes a new record that names the one it supersedes, covers the new identity, inherits every undisposed finding, and reviews only the delta.

**Substitution.** A bot slot is filled by a local full review, by a vendor not already counted on the PR, recorded as `substitute:<bot>`, when the bot is not configured for the PR (Gemini is not configured on fork, Dependabot and draft PRs), after a terminal failure (CodeRabbit's status description such as "Review rate limited" or "Review skipped", an empty review, or Gemini's `could-not-run` marker), or after the timeout with no review (30 minutes after the head commit or full-review request). A diff over Gemini's 400,000-byte limit means the PR is split.

**After a rewrite that changes the identity,** ask for a full review: `@coderabbitai full review` and `@codex review`. An incremental review alone does not restore coverage.

The bots never review the `.review/` evidence directory; a finding located only there is outside the gate.

## What blocks

(spec §5.6) Bot severity labels set the defaults; the author makes the final call.

| Category | Covers | Default for | Disposition |
|---|---|---|---|
| **Blocking** | Correctness, security, data loss, or a broken spec or plan promise | Codex P0-P2; CodeRabbit Critical and Major; every Gemini finding; local-record findings P0-P2; anything unparseable | A fix (verified by the chained re-review), or pre-existing |
| **Nit** | Wording, naming, style, "consider also", theoretical edge cases | Codex P3; CodeRabbit Minor, Nitpick and Trivial; local P3 | None needed |

**Reclassifying** a finding from blocking to nit needs a recorded one-line reason, which the merging maintainer can see. A nit the author thinks matters can simply be fixed.

**Pre-existing** applies only when the defect is present on the base revision under the same reachable conditions, and the record gives the reason and the issue that tracks it. An unchanged line that this PR newly makes reachable is this PR's regression, not pre-existing.

The PR review record lists each required slot with the review ID it relies on, each default-blocking finding with its stable ID and disposition, and each reclassification with its reason. Nits appear only if reclassified from blocking. `review-gate` fails a PR whose blocking finding is missing from the record.

## Stop rule

(spec §5.6) After two rounds in a row where every new finding sits in the previous round's own fixes, stop patching and restructure. By round three, change the reviewer's question as well as the model.

## Evidence

(spec §5.3) Records are committed to the PR in one evidence directory, `.review/`. PR comments and checks posted with a personal token are ruled out. Each record states its type and slot ID, the input identity it covers, the reviewer's model and vendor, the vendor that wrote the change, the outcome, the verdict, each default-blocking finding with a stable ID and disposition, and the record it supersedes. Conformance records also carry the covered task IDs, the deviation IDs, and each `command` target with its exit status.

`review-evidence` passes a record only when all four hold:

1. The outcome is `completed`, with a recognized, non-empty result.
2. The input identity matches the current one. For conformance, the task IDs match the Plan field and the unfixed deviation IDs exactly match the Deviations field.
3. The slot ID is the required one, and the vendor meets the independence rule.
4. Every recorded finding has an acceptable disposition, whatever the verdict.

## Promotion

(spec §5.7) The repo carries the process: `AGENTS.md` plus the committed `.claude/` (settings, Node hooks, skills, slot prompt files, and these rules). `.claude/**` is a control file. A script on David's Mac lists every change to the process files since the last promoted magora commit; David accepts or rejects each item, and accepted items land in claude-config as a commit naming the magora commit they came from. Noah and later developers change the process only through magora PRs, which are `subtle-correctness`.
