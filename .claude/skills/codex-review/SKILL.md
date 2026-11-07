---
name: codex-review
description: Use to run a local independent review (spec, plan, correctness, completeness, or a bot substitute; conformance has its own skill) and write its evidence record. Picks the slot and reviewer, falls back on failure, never reports an unrun review as a pass.
---

# Local Review

Runs one review slot through `scripts/review/review.mjs` and reads the record it writes. Dispatch, independence and what counts as a review are in `.claude/rules/process.md` under `## Review slots and dispatch`; what blocks is under `## What blocks`. The slot prompts are in `.claude/review/slots/`.

## 1. Pick the slot

| Stage / depth | Slot | Input |
|---|---|---|
| Spec review (stage 3) | `spec` | the spec file |
| Plan review (stage 5) | `plan` | the plan file |
| Plan conformance (stage 8) | `conformance`, through its own command (see below) | the PR's diff and the declared plan tasks |
| Pre-push, `standard` | `correctness` | the PR's diff |
| Pre-push, `subtle-correctness` | `correctness`, then `completeness` | the PR's diff |
| A bot did not or could not review (PR stage) | `substitute:coderabbit`, `substitute:codex` or `substitute:gemini` | the PR's diff |
| `mechanical` | none | |

Conformance records are written by `npm run review -- conformance`, which runs the plan's postconditions and fills the record's conformance block (tasks, deviations, commands, and the plan it checked); review-evidence fails a conformance record without that block, so `run --slot conformance` refuses. Follow `.claude/skills/conformance/SKILL.md` for that stage. Sections 4 and 5 below (reading the record, fallback, re-review) apply to it too.

A review is of one input. `spec` and `plan` cover one file's blob at `HEAD` (commit it first); the rest cover the PR's own diff against its merge base at `HEAD`, so commit before you run. Any later edit voids the record.

## 2. Scan a spec or plan first

For a `spec` or `plan` slot, run Semgrep over the document's code blocks before the reviewer:

`node scripts/review/semgrep-artifact.mjs <path>`

Exit 0: it ran, no findings. Exit 1: it ran and found something; print lines are `file:line: severity rule: message` and each is a finding to fix. Exit 2: **UNRUN** (Semgrep not installed, the document has no scannable code blocks, or Semgrep reported errors and scanned only part of it); the reason is printed, and any finding lines printed with it are still findings to fix. Record the scan as UNRUN in the PR, never as a pass, and carry on to the reviewer. (To install: `pipx install semgrep` or `brew install semgrep`.)

## 3. Run the reviewer

`npm run review -- run --slot <slot> --author <vendor> [--path <doc>]`

- `--author` is always required: the vendor of the model that wrote the change, `anthropic` for Claude Code, `openai` for Codex, `google` for Gemini, `none` for a person. The command picks an independent reviewer from it (Claude-written goes to Codex; Codex-written goes to Claude, Opus unless `--model fable`). `completeness` needs a completed `correctness` record for the same input and uses the third vendor.
- `--path <doc>` is required for `spec` and `plan` and refused for the other slots.
- A substitute slot is not picked by author: add `--reviewer codex|claude|gemini` naming a vendor not already counted on the PR.
- `--base <ref>` sets the diff base (default `origin/main` when it exists, else `main`). `--timeout-min <n>` overrides the 20-minute default.
- A `plan` run also runs the typed reference check (`writing-plans`, `## Typed targets`). For a plan already on `main` (an amendment), name the tasks not yet landed with `--tasks <ids>`, or `--tasks none`; `--rev <sha>` sets the revision they start from (default: the merge base with `origin/main`, after `git fetch origin main`).

Exit 0 means the outcome was `completed`. Exit 1 is any other outcome or a usage error. The run prints `outcome:` and the record path under `.review/records/`; read that record. Its `outcome` and `verdict` fields are the answer, not your impression of the console output.

## 4. Read the record

- `outcome: completed` with `verdict: pass` and no undisposed P0-P2 finding: reviewed.
- `completed` with findings: fix P0-P2 findings (a P3 is a nit and needs nothing), commit the fix as a new commit, and re-review (below).
- Any other outcome (`failed`, `refused`, `truncated`, `timeout`): nobody reviewed the input. It is **not** a pass and the review is UNRUN. Fall back to the next reviewer in the table below and run the same command again with `--reviewer`.

| Written by | Primary | Fallback |
|---|---|---|
| Claude (Anthropic) | Codex CLI | `--reviewer gemini` |
| Codex (OpenAI) | `--reviewer claude` (Opus; `--model fable` for Fable) | `--reviewer gemini` |

If the fallback also does not complete, stop and report the slot as UNRUN with each outcome. Never describe an unrun review as passed, and an empty reviewer reply is an unrun review.

## 5. After fixes: re-review

A fix voids the record that found the problem. Re-run the same slot with the stem of the chain head (the record's file name without `.json`):

`npm run review -- run --slot <slot> --author <vendor> [--path <doc>] --supersedes <stem>`

A run without `--supersedes` is refused while a record of the same slot (and path) that this branch added still carries an open blocking finding, whatever that record's outcome, and review-evidence fails the slot on such a record even when another chain passes. The new record inherits every undisposed finding. What it reviews: only the delta (for a spec or plan, the change between the two blobs) when the earlier record completed with nothing left open; the full input plus the delta when an inherited blocking finding is still open; the full input alone when the earlier record never completed, or, for a PR slot, when the merge base has moved since (a merge from `main` would otherwise mix main's changes into the delta). Its verdict marks each inherited finding resolved or open. Apply `## Stop rule` in `.claude/rules/process.md` if the new findings keep landing in your own fixes.

## 6. Dispose a finding without a fix

`npm run review -- dispose --record <stem> --finding <id> --kind <kind> --reason "<why>" [--issue <url>]`

- `pre-existing`: the defect is present on the base revision under the same reachable conditions. Needs `--issue <url>` tracking it.
- `reclassified-nit`: a blocking finding the author judges to be a nit; the one-line reason is shown to the merging maintainer.
- `justified-deviation`: a conformance deviation that stays, with its justification (conformance records only).

On a conformance record only `justified-deviation` is allowed: a deviation is fixed or justified (`.claude/skills/conformance/SKILL.md`). A disposition writes a new record that supersedes the old one; it never edits a record. `fixed` cannot be set by hand: only a re-review (`--supersedes`) sets it.

## Rules

- Never post or claim approval from a review you ran on your own change with your own vendor; the independence check refuses it and you do not work around it.
- Do not edit `.review/` records by hand.
