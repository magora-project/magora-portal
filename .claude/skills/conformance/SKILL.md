---
name: conformance
description: Use on a Specced PR after local checks pass and before pre-push review (stage 8), to check the diff against the plan tasks the PR declares and write the conformance record. Runs the tasks' postconditions and an independent reviewer; each deviation is fixed and re-run, or justified in the PR's Deviations field.
---

# Plan Conformance

Checks that the PR does what its plan tasks say, in both directions, and writes the evidence. This is stage 8 of the repo process (`.claude/rules/process.md`, `## Stages`): it runs after local checks (stage 7) and before pre-push review (stage 9), because its fixes change the diff that pre-push review reads. The spec is `docs/superpowers/specs/2026-10-29-shared-dev-process-design.md` §5.4.

Only the Specced lane has this stage. A Direct, docs-only or dependency PR skips it.

## 1. Before you run

- The plan is committed, and the PR's `Plan:` field names it with the task IDs this PR implements (`Plan: docs/superpowers/plans/<plan>.md T17-T18`). A multi-PR plan is checked against the tasks each PR declares.
- Every change is committed. The record covers the diff at `HEAD`; a run with uncommitted changes to tracked files is refused when a task has a `command` target.
- Local checks pass (`npm test`, `npm run lint:ratchet`). A failing `command` target becomes a deviation.

## 2. Run it

`npm run review -- conformance --plan <plan> --tasks <ids> --author <vendor>`

- `--tasks` is required and must match the PR's `Plan:` field (`T17-T18`, `T3,T5`). An ID the plan does not have is refused before anything runs or is written.
- `--author` is the vendor of the model that wrote the change: `anthropic` for Claude Code, `openai` for Codex, `google` for Gemini, `none` for a person. The reviewer is picked from it as for any slot (`.claude/skills/codex-review/SKILL.md`, section 4, for the fallback table); add `--reviewer` to fall back.
- `--base`, `--model`, `--timeout-min` work as for `run`.

What it does, in order:

1. Reads the plan at `HEAD` and the declared tasks' typed Files lines (`writing-plans`, `## Typed targets`).
2. Checks each target: a `create` or `modify` target is a file at `HEAD` and changed by the PR; a `delete` target is not a file at `HEAD`; a `command` target is run now from the repository root, with no shell, and its exit status recorded. A command string that needs a shell (`&&`, `|`, `>`, `$`) is not run and fails. An `existing` target is plan review's, not checked here.
3. Sends the conformance reviewer (`.claude/review/slots/conformance.md`) the declared tasks' text, the spec sections they cite, the commit messages, the postcondition results, and the PR's own diff.
4. Writes one `conformance` record under `.review/records/`. Each failed postcondition is a P1 deviation `D1`, `D2`, ...; the reviewer's deviations follow them. The record lists the tasks, the deviation IDs (every finding not marked fixed) and each command with its exit status.

Exit 0 means the review completed; read the record. Any other outcome is UNRUN, never a pass: fall back to the next reviewer as `codex-review` describes.

## 3. Each deviation: fix it or justify it

For every deviation ID in the record, do one of two things (D-3):

- **Fix it.** Change the code (or the plan, through a re-reviewed amendment), commit, and re-run with the stem of the chain head:

  `npm run review -- conformance --plan <plan> --tasks <ids> --author <vendor> --supersedes <stem>`

  The postconditions run again from scratch. The reviewer reassesses each deviation it inherits, including one you justified earlier, and marks it fixed or still open. A run without `--supersedes` is refused while the chain head has an open deviation.

- **Justify it.** Keep it, and say why in the PR description's `Deviations:` field, one line per ID: why the plan's version isn't needed and why the built version is better.

  ```
  Deviations:
  - D2: the plan's retry loop is not needed because X; the built version does Y, which is better because Z.
  ```

  Then record the disposition: `npm run review -- dispose --record <stem> --finding D2 --kind justified-deviation --reason "see Deviations"`. Write `Deviations: none` when there is none.

review-evidence passes the conformance record only when its task IDs equal the `Plan:` field's and its deviation IDs equal the `Deviations:` field's exactly. Once a re-review marks a justified deviation fixed, take it out of the `Deviations:` field. A P3 deviation is listed too, though it blocks nothing.

Locally, `npm run review -- init-local` with `--plan "<plan> <ids>"` and one `--deviation "D<n>: why"` per justified ID, then `npm run review -- check --local`, judges the records as CI will.

## Rules

- Do not edit `.review/` records or the plan's committed text to make a deviation disappear. An amendment to the plan is re-reviewed.
- Run conformance again after any fix it prompted, before pre-push review: pre-push review reads the post-conformance diff.
