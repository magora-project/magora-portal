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

`git fetch origin` (fetches the remote that holds `<base>`)

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

The depth label decides which pre-push slots need a record (`.claude/rules/process.md`, `## Review slots and dispatch`): none for `mechanical`; `correctness` for `standard`; `correctness` and `completeness`, from different models, for `subtle-correctness`. A record covers the current diff, so a commit made after a review voids it. Run:

`npm run review -- check --local`

It lists any slot that has no record for the current identity. PASS when none is missing. The command is not available yet (it ships with the review tooling); until then, report this check as NOT RUN, say which slots the depth requires, and ask the operator whether a manual review of the current head was done, by the reviewer the dispatch table in `.claude/rules/process.md` names (Codex CLI for a Claude-written change).

## Summary

Emit one block at the end:

```
PUSH READINESS - <branch>: PASS / FAIL / NOT RUN (check 5)

  Branch:          <name>
  Latest commit:   <hash> <subject>
  Working tree:    clean / dirty
  Behind / ahead:  <N> / <M> of <base>
  File set:        matches / <differences>
  Depth label:     <label>
  Review records:  complete / missing <slots> / not run
  No push occurred.
```

If a check failed, list the failing command and its raw output. Do not propose fixes; the operator decides whether to address it or push anyway.

## When handed to another CLI

If this checklist is given to Codex CLI as a prompt, prepend: "Do not modify files. Do not stage, commit or push. Do not reset, rebase, stash, clean, or check out another branch. If any expectation fails, stop and report."
