## Depth (exactly one; a maintainer applies the matching label)

- [ ] `mechanical` — docs, renames, formatting; nothing beyond CI
- [ ] `standard` — ordinary change; Codex CLI correctness review before push
- [ ] `subtle-correctness` — migrations, `api/` auth paths, control files, concurrency; Codex plus an Anthropic complement review before push

## What changed

<!-- 1-3 bullets: what and why -->

## Test evidence

<!-- Commands you ran and what they printed (npm test, npm run lint:ratchet, npm run build, …) -->

## Migrations

- [ ] No migration in this PR
- [ ] Each new `supabase/migrations/<stem>.sql` has `supabase/migrations/rollbacks/<stem>.rollback.sql`
- [ ] Expand/contract: nothing a running deploy reads is dropped or renamed in the same PR

## Control files

This PR changes control files (`.github/**`, `scripts/run-tests.mjs`, `scripts/ci/**`, `.github/lint-baseline.json`, `scripts/ci/migrations-grandfathered.txt`, `eslint.config.js`, `AGENTS.md`, `package.json`, `scripts/review/**`, `scripts/doc-size-ratchet.py`, `doc-size.conf`): **yes / no**

<!-- If yes, say which and why. The merging maintainer reads every control-file change on fork and Dependabot PRs. -->
