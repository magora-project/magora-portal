# AGENTS.md: magora-portal

For agents and contributors (Claude Code via `CLAUDE.md`, Codex CLI directly). Design: `docs/superpowers/specs/2026-10-15-repo-harness-design.md`.

## Commands

- `npm ci`: install
- `npm test`: every `*.test.mjs` (fails if none found)
- `npm run lint:ratchet`: ESLint; fails if a rule's finding count exceeds `.github/lint-baseline.json`. If a count falls, lower the baseline in the same PR.
- `npm run build`: production build (no env vars)
- `npm run check:migrations`: each new migration has a rollback
- `npm run check:deno`: type-check and lint the Edge Functions (needs Deno 2.9.5)

## Flow

- Trunk: branch from and PR to `main`. No long-lived branches.
- Squash merge only. Maintainers merge own PRs once required checks are green; no approval needed. A maintainer reviews then merges fork/Dependabot PRs.
- Resolve each review thread before merge, after reading bot findings.
- **Agents never push, merge, or change repo settings without their operator's explicit approval.**

## Depth labels (exactly one per PR)

| Label | Use for | Review before push |
|---|---|---|
| `mechanical` | docs, renames, formatting | nothing beyond CI |
| `standard` | ordinary changes | Codex CLI, correctness question |
| `subtle-correctness` | **any PR that touches `supabase/migrations/`, an `api/` auth path, or a control file**; concurrency; anything subtle | Codex CLI on correctness, plus a Fable or Opus subagent on completeness, executability, whether tests can fail, and what the fixes broke |

If Codex wrote it, route its review to an Anthropic model. An empty reviewer reply is an unrun review, not a pass. This review layer is discipline; required CI checks are the control.

Dependabot PRs are labelled `standard` (spec §5.2), even Actions bumps editing `.github/**`; for those, the merging maintainer's control-file read replaces the depth rule.

## Control files

`.github/**`, `scripts/run-tests.mjs`, `scripts/ci/**`, `.github/lint-baseline.json`,
`scripts/ci/migrations-grandfathered.txt`, `eslint.config.js`, `AGENTS.md`, `package.json`,
`scripts/review/**`, `scripts/doc-size-ratchet.py`, `doc-size.conf`.
A PR can weaken a check by editing these. Say so in the PR description when you change one. On fork and Dependabot PRs the merging maintainer reads each control-file change before merging.

## Migrations

- A PR that adds a migration is `subtle-correctness`.
- Each new `supabase/migrations/<stem>.sql` needs `supabase/migrations/rollbacks/<stem>.rollback.sql`. CI enforces it.
- Expand/contract anything a running deploy reads: add first, switch readers, remove later.
- Never apply a migration before its PR is green at its final head.

## Production warnings (until the staging spec lands)

- `vite dev` proxies `/api` to production; every Vercel preview uses production Supabase.
- **Never authorize a Vercel deployment for a fork PR.** It would run fork code with Preview secrets against production. Review fork PRs from CI and diff only.

## Secrets

Agents use `op run` and `op inject` only, never `op read`, `op item get` or anything else that prints a secret value. Local env files hold `op://` references only (`env/*.env`); run commands through `op run --env-file=env/staging.env -- <cmd>`.
