## Process

<!-- Lane: specced | direct | docs-only | dependency. Rules: .claude/rules/process.md (Lanes). docs-only = the PR only adds or changes a spec or plan (narrower than Direct's docs-only changes); dependency = Dependabot -->
Lane:

<!-- Spec: repo path of the approved spec; required when the lane is specced, otherwise "none" -->
Spec:

<!-- Plan: <path> <task list>; required when the lane is specced, otherwise "none". Task list is comma-separated T<n> or ranges T<n>-T<m>, e.g. docs/superpowers/plans/x.md T1-T3, T5 -->
Plan:

<!-- Deviations: one "- <id>: <justification>" line per unfixed conformance deviation, or "none" -->
Deviations:

## Depth (exactly one; a maintainer applies the matching label)

- [ ] `mechanical` — docs, renames, formatting; nothing beyond CI
- [ ] `standard` — ordinary change; review before push per `.claude/rules/process.md` § Review slots and dispatch
- [ ] `subtle-correctness` — migrations, `api/` auth paths, control files, concurrency; review before push per `.claude/rules/process.md` § Review slots and dispatch

## What changed

<!-- 1-3 bullets: what and why -->

## Test evidence

<!-- Commands you ran and what they printed (npm test, npm run lint:ratchet, npm run build, …) -->

## Migrations

- [ ] No migration in this PR
- [ ] Each new `supabase/migrations/<stem>.sql` has `supabase/migrations/rollbacks/<stem>.rollback.sql`
- [ ] Expand/contract: nothing a running deploy reads is dropped or renamed in the same PR

## Control files

This PR changes control files (`.github/**`, `.claude/**`, `scripts/run-tests.mjs`, `scripts/ci/**`, `.github/lint-baseline.json`, `scripts/ci/migrations-grandfathered.txt`, `eslint.config.js`, `AGENTS.md`, `package.json`, `scripts/review/**`, `scripts/doc-size-ratchet.py`, `doc-size.conf`): **yes / no**

<!-- If yes, say which and why. The merging maintainer reads every control-file change on fork and Dependabot PRs. -->
