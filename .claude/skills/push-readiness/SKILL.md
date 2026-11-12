---
name: push-readiness
description: Mechanical check of the checkout before asking to push a feature branch. Use when the user says "is this branch ready to push?", "check before pushing", or similar, and proactively before asking for push approval on a multi-commit branch. Reports state; stops on first FAIL; never fixes.
---

# Push Readiness

A mechanical checklist answering one question: is the checkout in a clean state to ask for push approval? It does not judge design (code review), run the tests (`npm test`), or watch CI. Run those first, this last. The review stages it points at are in `.claude/rules/process.md`, `## Stages` 8 and 9.

This skill reports and changes nothing. It never pushes, rebases, merges, stashes, checks out another branch, stages, commits, or installs anything. A push needs the operator's explicit approval (`AGENTS.md`), whatever this reports.

## Inputs

Capture, or ask for, before running. Do not guess.

- Expected branch name.
- Base ref `<base>` (default `origin/main`).
- Expected file set: the files this branch should touch.
- The PR's depth label (`mechanical`, `standard`, `subtle-correctness`), because it decides which review records are required.

## Checks

Run each command by itself. Report the command, its raw output, PASS or FAIL, and the reason. Stop at the first FAIL.

### 1. Branch

`git branch --show-current`

PASS when it equals the expected branch and is not `main`.

### 2. Working tree

`git status --short`

PASS when the output is empty. Dirty means uncommitted edits or untracked files; surface them, do not stash.

`git diff --cached --name-only`

PASS when the output is empty.

### 3. Sync with the base

`git fetch <remote>`, where `<remote>` is the remote part of `<base>`: `origin` for `origin/main`, `upstream` for `upstream/main`. Fetching any other remote leaves `<base>` stale, and the checks below then compare against an old base.

`git rev-list --left-right --count <base>...HEAD`

The output is two numbers, behind then ahead, separated by whitespace (do not match on exact whitespace). PASS when behind is 0 and ahead is at least 1. If behind is above 0 the base has moved: surface it and let the operator choose rebase or merge; do not do either.

`git merge-base --is-ancestor <base> HEAD`

PASS when the exit status is 0.

### 4. Diff matches intent

`git diff --name-only <base>...HEAD`

PASS when the list equals the expected file set, with nothing extra and nothing missing.

`git diff --stat <base>...HEAD`

Read it for anything unexpected: control files (listed in `AGENTS.md`) that the PR description does not mention, a `supabase/migrations/` file on a branch not labelled `subtle-correctness`, or a stray lock file.

`git log --oneline <base>..HEAD`

PASS when every commit is one you expect.

### 5. Review records

The lane and depth label decide which pre-push slots need a record (`.claude/rules/process.md`, `## Review slots and dispatch`, the records table): none for the `docs-only` lane; one `correctness` for the `dependency` lane; otherwise by depth: none for `mechanical`, `correctness` for `standard`, `correctness` and `completeness`, from different models, for `subtle-correctness`. A record covers a review-input identity, the patch-id of the branch's diff against its merge base, excluding `.review/`. A commit that changes that identity voids the record; a commit that only adds or changes evidence under `.review/` does not. Run:

`npm run review -- check --local`

It applies the same rules as CI's `review-evidence` check (`scripts/ci/review-evidence.mjs`) to the records in `.review/records/`, with the lane, depth, Spec, Plan and Deviations taken from the machine-local `.review/local.json`, and prints one `ok` or `FAIL` line per required slot. PASS when it exits 0. If it reports that `local.json` is missing or invalid, report FAIL and give the operator the command it names (`npm run review -- init-local --lane <lane> --depth <label> ...`); do not write the file yourself. Otherwise report each `FAIL` line by slot name: `correctness` is by the dispatch table's reviewer in `.claude/rules/process.md` (Codex CLI for a Claude-written change); `completeness`, at `subtle-correctness`, is by a vendor that is neither the author nor the `correctness` reviewer. One review never covers both slots.

## Summary

Emit one block at the end:

```
PUSH READINESS - <branch>: PASS / FAIL

  Branch:          <name>
  Latest commit:   <hash> <subject>
  Working tree:    clean / dirty
  Behind / ahead:  <N> / <M> of <base>
  File set:        matches / <differences>
  Depth label:     <label>
  Review records:  complete / FAIL <slots>
  No push occurred.
```

If a check failed, list the failing command and its raw output. Do not propose fixes; the operator decides whether to address it or push anyway.

## When handed to another CLI

If this checklist is given to Codex CLI as a prompt, prepend: "Do not modify files. Do not stage, commit or push. Do not reset, rebase, stash, clean, or check out another branch. If any expectation fails, stop and report."
