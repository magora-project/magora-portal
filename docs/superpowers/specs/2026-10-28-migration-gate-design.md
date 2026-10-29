# magora-portal migration gate — design (Spec 2b)

- **Date:** 2026-10-28
- **Status:** extracted, not yet designed in this form. Nothing here is built or in effect.
- **Extracted from:** Spec 2 (`docs/superpowers/specs/2026-10-28-staging-and-secrets-design.md`)
  at rev 4, commit `edb25d6`, by David's choice on 2026-10-28 after four review rounds kept
  finding defects in the gate's own fixes.
- **Depends on:** Spec 2 done (staging project, baseline migration, refresh, simulated node).

This document specifies; it implements nothing. Until it is designed, approved and built,
migrations reach production by Spec 2's interim procedure (Spec 2 §5.5).

## 1. What this spec must deliver

The owner decisions from Spec 2 §4 carry over unchanged:

- **E-5:** GitHub applies migrations to production on merge, after a gate. Not by hand from a
  laptop.
- **E-6:** the gate includes a read-only production check.
- **E-10:** production migrations wait for a maintainer's approval click; on any failure the job
  stops and alerts, with no automatic rollback.
- **Rev 4 choice (David, 2026-10-28):** the pre-merge gate runs on a throwaway Supabase stack in
  the CI runner, and the shared staging project is written only from `main`. Before merge a
  migration meets synthetic data only; real data meets it in a read-only data check after merge
  and approval.

## 2. Starting design

The starting point is Spec 2 rev 4's §5.5 (migration gate), the PR and migrate logins, privilege
check and default privileges in its §5.10, and steps 3, 5 and 6 of its §5.11. Read them with
`git show edb25d6:docs/superpowers/specs/2026-10-28-staging-and-secrets-design.md`. Spec 2's §10
review log records how that design got there (rounds 1–3).

## 3. Open findings (none resolved)

Codex reviewed rev 4 on 2026-10-28 (round 4, output kept at
`~/.local/state/claude-close-task/magora-spec2-codex-round4.out`). These findings concern the
gate and stay **open** until this spec's own review closes them. Acceptance: a Codex review and a
review by a different model of this spec's full design, each answering every finding below.

1. **P1:** "production current" evaluated over the PR's merge result fails every migration PR,
   because the PR's own migration is not yet applied. It must compare against the base and treat
   additions and authorized deletions separately.
2. **P1:** the exit for an unappliable migration still fails the drift check, because the base
   that pre-merge step 1 builds contains the migration. Needs a recovery path through build,
   drift, immutability, hash check and ledger reconciliation.
3. **P1:** the privilege check misses column-level grants, sequences, ownership, schema and
   database `CREATE`, role attributes, functions outside exposed schemas (a SQL login is not
   limited to PostgREST's schemas), and a positive bound on what the catalog-only login can read.
4. **P1:** driving production pages in a browser is not read-only: pages send background POSTs
   (`src/lib/nodeHero.js:87`). Production verification needs an audited read-only method.
5. **P1 (gate part):** rollout steps depend on things built later; the data-check red proof needs
   the production environment, migrate credential and a recovery path in place first.
6. **P2:** `supabase start` applies the workspace's migrations and seed itself, so the controlled
   baseline-then-base replay must start from a workspace whose migration set is chosen.
7. **P2:** read-only role counterparts are created after the migrations that grant to them.
   Roles must exist before replay.
8. **P2:** the pre-merge page checks serve no `/api`, but pages call relative `/api` URLs
   (`src/lib/nodeHero.js:90`, `src/pages/RegisterNode.jsx:65`). Define their responses.
9. **P2:** the Edge Function revision the gate tests is not tied to what production runs; a
   Vercel deployment record says nothing about Supabase functions.
10. **P3:** default privileges must remove the global `PUBLIC` default on functions, not only a
    schema-scoped one, and account for existing per-schema grants.

Findings that concern staging rather than the gate (Codex round 4 #5, #10, #11, #12, #13) were
applied in Spec 2 rev 5.
