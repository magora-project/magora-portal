---
name: writing-plans
description: Use when you have a reviewed spec for a multi-step task, before touching code. Writes the implementation plan and runs plan review.
---

# Writing Plans

## Overview

Write the plan for an engineer who has not seen this codebase or this spec. They write idiomatic code once they know the exact interface and the exact test, and they will make a reasonable choice wherever the plan leaves one open. What they cannot know is what you decided: which files, which names and signatures, which values from the spec, which tests prove each task. Document those. DRY. YAGNI. TDD. Frequent commits.

This is stage 4 and 5 of the repo process (`.claude/rules/process.md`, `## Stages`). A Specced change needs a reviewed spec first; if there is none, use `brainstorming`.

**Announce at start:** "I'm using the writing-plans skill to create the implementation plan."

**Save plans to:** `docs/superpowers/plans/` as `YYYY-MM-DD-<feature-name>.md`.

## Scope Check

If the spec covers several independent subsystems, suggest separate plans, one per subsystem. Each plan should produce working, testable software on its own.

## File Structure

Before defining tasks, map which files are created or modified and what each is responsible for. One clear responsibility per file; files that change together live together; follow the existing patterns. This locks in the decomposition, and each task should produce self-contained changes.

## Task Right-Sizing

A task is the smallest unit that carries its own test cycle and is worth a fresh reviewer's gate. Fold setup, configuration and documentation into the task whose deliverable needs them. Split only where a reviewer could reject one task and approve its neighbour. Each task ends with an independently testable deliverable.

## Step Granularity

Each step is one action with a checkable result: write the failing test; run it and see it fail; implement; run it and see it pass; commit.

## Plan Document Header

Every plan starts with:

```markdown
# [Feature Name] Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task, with a fresh reviewer on each task by depth (`.claude/rules/process.md`, stage 6). Use superpowers:executing-plans only if the user explicitly asks for in-session execution; keep the per-task reviewer and name the departure in the PR description. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** [One sentence]

**Architecture:** [2-3 sentences about the approach]

**Tech Stack:** [Key technologies]

**Spec:** [path to the spec this plan implements; executors read both]

## Global Constraints

[The spec's project-wide requirements, one line each, exact values copied verbatim from the spec. Every task implicitly includes this section.]

## Review Focus

[Up to five input classes or failure modes the spec implies but no task's tests exercise, that are most likely to bite a person using this software. One line each, naming the input or condition and the behaviour a reasonable person would expect, most likely first. The spec's silence on an input is not permission for it to break the program. Then add the test that pins each line to the task that owns the code.]

---
```

## Task Structure

````markdown
### Task N: [Component Name]

**Files:**
- existing: `exact/path/read/only.mjs`
- create: `exact/path/to/file.mjs`
- create: `exact/path/to/file.test.mjs`
- modify: `exact/path/to/existing.mjs`
- delete: `exact/path/to/removed.mjs`
- command: `npm test`

**Interfaces:**
- Consumes: [what this task uses from earlier tasks, exact signatures]
- Produces: [what later tasks rely on: exact names, parameter and return types. An implementer sees only their own task; this block is how they learn neighbouring names.]

- [ ] **Step 1: Write the failing test** (name and assertions, as code, with the spec's exact values)
- [ ] **Step 2: Run it** (`npm test`). Expected: FAIL, and why
- [ ] **Step 3: Implement `name(params) -> result` in `exact/path/to/file.mjs`** (one line of approach where the signature and test leave a choice)
- [ ] **Step 4: Run it.** Expected: PASS
- [ ] **Step 5: Commit** (`feat(scope): message`)
````

Every Files line is typed (spec §5.4): `existing` (read, not changed), `create`, `modify`, `delete`, or `command` (a command whose exit status conformance records). A test file is a `create` or `modify` target like any other. Keep only the types a task uses.

## What a Step Contains

A step is done when the implementer can write exactly one reasonable thing from it. Unambiguous, not complete.

- **Test step:** the test's name and its assertions as code, with the spec's exact values.
- **Code step:** the exact signature, the file, and the values the spec pins. The implementer writes the body; a body appears only for an algorithm the signature and tests do not determine, or for copy the spec fixes.
- **Verification step:** the command and the output that means it passed.
- **Reference to another task:** that task's Interfaces block says what to use; do not repeat its code.

A plan longer than the code it describes has written the code instead. Lines that decide nothing ("TBD", "handle edge cases", "add validation", "write tests for the above", a type no task defines) are the opposite failure.

## Self-Review

Run this yourself against the spec; it is not a subagent dispatch.

1. **Spec coverage:** point to a task for each requirement; list gaps and add tasks.
2. **Step scan:** every step lets the implementer write exactly one reasonable thing, and carries no more than that.
3. **Type consistency:** names and signatures in later tasks match earlier ones.
4. **Review Focus:** each listed failure mode has a test in the task that owns the code. An empty section means you checked and found none.
5. **Proportion:** a plan several times longer than its spec is a transcript. Replace bodies with signatures, test names and assertions.

Fix issues inline.

## Plan Review

Saving the plan commits it; then review it. Plan review is three checks (`.claude/rules/process.md` stage 5): the typed reference check, Semgrep, and a reviewer. Dispatch and what counts as a review are in `.claude/rules/process.md` under `## Review slots and dispatch`. Run Semgrep over the plan, then:

`npm run review -- run --slot plan --path <plan> --author <vendor>`

`<vendor>` is the vendor of the model that wrote the plan: `anthropic` for Claude Code, `openai` for Codex, `none` when a person wrote it by hand. If the plan is already on `main` (an amendment), add `--tasks <the tasks not yet landed>`, or `--tasks none` when none remain. The command runs the typed reference check first, then the reviewer.

The command is not available yet (it ships with the review tooling). Until it lands, do all three by hand:

1. **Typed reference check:** at the merge base (`git merge-base origin/main HEAD`, after `git fetch origin main`), walking the in-scope tasks in order, each `existing` and `modify` target is a file there or is created by an earlier task, and is not deleted by one; no `create` target is already a file there or created by an earlier task; no Files line is untyped. Each problem is a P1 finding.
2. **Semgrep** over the plan. If it cannot run (not installed, or no code blocks), record that check as UNRUN, never as a pass.
3. **Reviewer:** the one the dispatch table names (Codex CLI for a Claude-written document), by hand on the plan, with an adversarial prompt covering missing tasks, wrong ordering, tests that cannot fail, and rollback.

Note in the PR that the review was manual, and which of the three ran.

An empty reviewer reply is an unrun review, not a pass. Editing the plan changes its blob and voids the record, so review again after any fix. After two rounds where the new findings all sit in the previous round's fixes, apply `## Stop rule`. What blocks is in `## What blocks`.

Do not edit a committed plan to tick off progress; track checkboxes in your session. Only an amendment edits it, and an amendment is re-reviewed.

## Execution Handoff

After saving, self-reviewing and reviewing, link the plan and ask the user to confirm it captures what they want.

Execution is subagent-driven (`.claude/rules/process.md`, `## Stages`, stage 6): a fresh subagent implements each task, a fresh reviewer checks it by depth before the next, then a whole-branch review. Use `superpowers:subagent-driven-development`. Per-task review follows `.claude/rules/process.md`, `## Review slots and dispatch`.

If the user asks to implement the tasks in this session instead (`superpowers:executing-plans`), say that this departs from stage 6, keep a fresh reviewer on each task by depth before the next task starts, and name the departure in the PR description.
