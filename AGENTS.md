# AGENTS.md: magora-portal

For agents and contributors (Claude Code via `CLAUDE.md`, Codex directly). Design: `docs/superpowers/specs/2026-10-15-repo-harness-design.md`.

## Commands

- `npm ci`: install
- `npm test`: all `*.test.mjs`, fails if none
- `npm run lint:ratchet`: ESLint; fails if a rule's count exceeds `.github/lint-baseline.json`. If one falls, lower it in the same PR
- `npm run build`: prod build, no env vars
- `npm run check:migrations`: new migrations have rollbacks
- `npm run check:deno`: type-check, lint Edge Functions (Deno 2.9.5)
- `npm run review -- check --local`: `.review/` records

## Flow

- Trunk: branch from and PR to `main`. No long-lived branches.
- Squash merge only. Maintainers merge own PRs once required checks pass, no approval. A maintainer reviews then merges fork/Dependabot PRs.
- Resolve each review thread before merge, after reading bot findings.
- **Agents never push, merge, or change repo settings without their operator's explicit approval.**
- Every agent follows `.claude/rules/process.md`; Claude Code loads skills from `.claude/skills/`.

## Depth labels (exactly one per PR)

| Label | Use for |
|---|---|
| `mechanical` | docs, renames, formatting |
| `standard` | ordinary changes |
| `subtle-correctness` | **any PR that touches `supabase/migrations/`, an `api/` auth path, or a control file**; concurrency; anything subtle |

Review before push: `.claude/rules/process.md` § Review slots and dispatch. This review layer is discipline; the required CI checks are the control.
Reviewers: skip `.review/`; findings located only there are outside the gate.

Dependabot PRs are labelled `standard` (spec §5.2), even Actions bumps editing `.github/**`; for those, the maintainer's control-file read replaces the depth rule.

## Control files

`.github/**`, `scripts/run-tests.mjs`, `scripts/ci/**`, `.github/lint-baseline.json`,
`scripts/ci/migrations-grandfathered.txt`, `eslint.config.js`, `AGENTS.md`, `package.json`,
`scripts/review/**`, `.claude/**`, `scripts/doc-size-ratchet.py`, `doc-size.conf`, `.coderabbit.yaml`.
A PR can weaken a check by editing these; name any you change in the PR description. The merging maintainer reads each such change first on fork/Dependabot PRs.

## Migrations

- A PR that adds a migration is `subtle-correctness`.
- Each new `supabase/migrations/<stem>.sql` needs `supabase/migrations/rollbacks/<stem>.rollback.sql`. CI enforces it.
- Expand/contract anything a running deploy reads: add first, switch readers, remove later.
- Never apply a migration before its PR is green at its final head.

## Production warnings (until the staging spec lands)

- `vite dev` proxies `/api` to production; every Vercel preview uses production Supabase.
- **Never authorize a Vercel deployment for a fork PR.** It runs fork code with Preview secrets against production. Review fork PRs from CI and diff only.

## Secrets

Agents use `op run` and `op inject` only, never `op read`, `op item get` or anything that prints a secret. Env files hold `op://` references only (`env/*.env`); run `op run --env-file=env/staging.env -- <cmd>`.
