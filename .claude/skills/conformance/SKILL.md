---
name: conformance
description: Use on a Specced PR after local checks pass and before pre-push review (stage 8), to check the diff against the plan tasks the PR declares and write the conformance record. Runs the tasks' postconditions and an independent reviewer; each deviation is fixed and re-run, or justified in the PR's Deviations field.
---

# Plan Conformance

Checks that the PR does what its plan tasks say, in both directions, and writes the evidence. This is stage 8 of the repo process (`.claude/rules/process.md`, `## Stages`): it runs after local checks (stage 7) and before pre-push review (stage 9), because its fixes change the diff that pre-push review reads. The spec is `docs/superpowers/specs/2026-10-29-shared-dev-process-design.md` §5.4.

Only the Specced lane has this stage. A Direct, docs-only or dependency PR skips it.

## 1. Before you run

- The plan is committed, and the PR's `Plan:` field names it with the task IDs this PR implements (`Plan: docs/superpowers/plans/<plan>.md T17-T18`). A multi-PR plan is checked against the tasks each PR declares.
- Every change is committed. The record covers the diff at `HEAD` and the plan's blob at `HEAD`; a run is refused while the plan has uncommitted changes, or while any tracked file does when a task has a `command` target.
- Local checks pass (`npm test`, `npm run lint:ratchet`). A failing `command` target becomes a deviation.

## 2. Run it

`npm run review -- conformance --plan <plan> --tasks <ids> --author <vendor>`

- `--tasks` is required and must match the PR's `Plan:` field (`T17-T18`, `T3,T5`). An ID the plan does not have is refused before anything runs or is written.
- `--author` is the vendor of the model that wrote the change: `anthropic` for Claude Code, `openai` for Codex, `google` for Gemini, `none` for a person. The reviewer is picked from it as for any slot (`.claude/skills/codex-review/SKILL.md`, section 4, for the fallback table); add `--reviewer` to fall back.
- `--base`, `--model`, `--timeout-min` work as for `run`.

What it does, in order:

1. Reads the plan at `HEAD` and the declared tasks' typed Files lines (`writing-plans`, `## Typed targets`).
2. Checks each target: a `create` or `modify` target is a file at `HEAD` and changed by the PR; a `delete` target is not a file at `HEAD`; a `command` target is run now from the repository root, with no shell, and its exit status recorded. A command string that needs a shell is not run and fails: outside quotes only letters, digits and `_@%+=:,./-` are accepted (so `&&`, `|`, `>`, `$`, globs, `~`, braces, `!`, `#` and `\` all fail; write paths with `/`); single-quote anything else you mean literally. A command still running after the run's `--timeout-min` is killed and fails. An `existing` target is plan review's, not checked here.
3. Sends the conformance reviewer (`.claude/review/slots/conformance.md`) the declared tasks' text, the spec sections they cite (only when `.review/local.json` names the spec: run `npm run review -- init-local --spec <spec> ...` first, or the run warns and sends none), the commit messages, the postcondition results, and the PR's own diff.
4. Writes one `conformance` record under `.review/records/`. Each failed postcondition is a P1 deviation numbered by its check's position (plan problems first, then every target of the declared tasks in plan order), so `D3` stays `D3` when `D1` is fixed; the reviewer's deviations are numbered after every check. The record lists the tasks, the deviation IDs (every finding not marked fixed), each command with its exit status, and the plan it checked (its path and its blob at `HEAD`).

Exit 0 means the review completed; read the record. Any other outcome is UNRUN, never a pass: fall back to the next reviewer as `codex-review` describes.

## 3. Each deviation: fix it or justify it

For every deviation ID in the record, do one of two things (D-3):

- **Fix it.** Change the code (or the plan, through a re-reviewed amendment), commit, and re-run with the stem of the chain head:

  `npm run review -- conformance --plan <plan> --tasks <ids> --author <vendor> --supersedes <stem>`

  The postconditions run again from scratch. Every other deviation not yet fixed is inherited, a P3 or one you justified earlier included, and the reviewer marks each fixed or still open. A run without `--supersedes` is refused while the chain head lists any deviation.

- **Justify it.** Keep it, and say why in the PR description's `Deviations:` field, one line per ID: why the plan's version isn't needed and why the built version is better. Copy each ID verbatim from the chain head's `conformance.deviations`: `D2` on a first run, or `conformance--<id12>--<n>#D2` once a re-review has inherited it.

  ```
  Deviations:
  - D2: the plan's retry loop is not needed because X; the built version does Y, which is better because Z.
  - conformance--0123456789ab--2#D5: the plan named a new module; extending the existing one avoids a second parser.
  ```

  Then record the disposition with the same ID: `npm run review -- dispose --record <stem> --finding <id> --kind justified-deviation --reason "see Deviations"`. Write `Deviations: none` when there is none.

review-evidence passes the conformance record only when its plan is the `Plan:` field's path at that path's blob in the PR head, its task IDs equal the `Plan:` field's, and its deviation IDs equal the `Deviations:` field's exactly. Changing the plan (an amendment, or a merge from `main` that changes it) or pointing `Plan:` at another plan voids the record: run conformance again. Once a re-review marks a justified deviation fixed, take it out of the `Deviations:` field. A P3 deviation is a deviation too: fix it or list it, and a re-review reassesses it like any other. There is no third way: `dispose` refuses `pre-existing` and `reclassified-nit` on a conformance record.

Locally, `npm run review -- init-local` with `--plan "<plan> <ids>"` and one `--deviation "<id>: why"` per justified ID (the ID as the record lists it), then `npm run review -- check --local`, judges the records as CI will.

## Rules

- Do not edit `.review/` records or the plan's committed text to make a deviation disappear. An amendment to the plan is re-reviewed.
- Run conformance again after any fix it prompted, before pre-push review: pre-push review reads the post-conformance diff.
