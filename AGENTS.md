# AGENTS.md — magora-portal

Instructions for every agent and contributor working in this repo (Claude Code reads this through
`CLAUDE.md`; Codex CLI reads it directly). Design: `docs/superpowers/specs/2026-10-15-repo-harness-design.md`.

## Commands

- `npm ci` — install
- `npm test` — every `*.test.mjs` (fails if none are found)
- `npm run lint:ratchet` — ESLint; fails if any rule's finding count rises above `.github/lint-baseline.json`. If a count falls, lower the baseline in the same PR.
- `npm run build` — production build (needs no env vars)
- `npm run check:migrations` — every new migration has a rollback
- `npm run check:deno` — type-check and lint the Edge Functions (needs Deno 2.9.5)

## Flow

- Trunk: branch from `main`, open a PR to `main`. No long-lived branches.
- Squash merge only. A maintainer merges their own PR once the required checks are green; no approval is required. Fork and Dependabot PRs are merged by a maintainer, who reviews them first.
- Every review thread must be resolved before merge. Read bot findings before resolving them.
- **Agents never push, merge, or change repo settings without their operator's explicit approval.**

## Depth labels (exactly one per PR)

| Label | Use for | Review before push |
|---|---|---|
| `mechanical` | docs, renames, formatting | nothing beyond CI |
| `standard` | ordinary changes | Codex CLI, correctness question |
| `subtle-correctness` | **any PR that touches `supabase/migrations/`, an `api/` auth path, or a control file**; concurrency; anything subtle | Codex CLI on correctness, plus a Fable or Opus subagent on completeness, executability, whether the tests can fail, and what the fixes broke |

If Codex wrote the change, route its review to an Anthropic model instead. An empty reviewer reply is an unrun review, not a pass. This review layer is discipline; the required CI checks are the control.

Dependabot PRs arrive labelled `standard` (spec §5.2), including GitHub Actions bumps that edit `.github/**`; for those, the merging maintainer's control-file read (below) replaces the depth rule.

## Control files

`.github/**`, `scripts/run-tests.mjs`, `scripts/ci/**`, `.github/lint-baseline.json`,
`scripts/ci/migrations-grandfathered.txt`, `eslint.config.js`, `AGENTS.md`, `package.json`,
`scripts/review/**`, `scripts/doc-size-ratchet.py`, `doc-size.conf`.
A PR can weaken a check by editing these. Say so in the PR description when you change one. On fork
and Dependabot PRs, the merging maintainer reads every control-file change before merging.

## Migrations

- A PR that adds a migration is `subtle-correctness`.
- Every new `supabase/migrations/<stem>.sql` needs `supabase/migrations/rollbacks/<stem>.rollback.sql`. CI enforces this.
- Expand/contract for anything a running deploy reads: add first, switch readers, remove later.
- Never apply a migration until its PR is green at its final head.

## Production warnings (until the staging spec lands)

- `vite dev` proxies `/api` to production, and every Vercel preview uses the production Supabase project.
- **Never authorize a Vercel deployment for a fork PR.** Its preview would run fork code with Preview secrets against production. Review fork PRs from CI and the diff only.
