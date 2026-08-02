# Runbook — `PROVISION_SECRET` rotation & cutover

**Written:** 2026-08-01. **Status: ✅ COMPLETE — rotation performed 2026-08-02.**
**Severity (at discovery):** the `PROVISION_SECRET` value was compromised — publicly readable.

> **Outcome.** The leaked secret is dead: a direct call to `provision-node` with the old value now
> returns `401`, and the new value returns `400` (gate passes, fields missing). The old bundle is
> still served at its immutable URL — that is expected and harmless now that its secret is worthless.
> Registration verified working end-to-end against live production after rotation, 7/7 checks
> including the forged-`owner_id` test. Orphan cleanup done: 12/12 removed. Final state: 3 nodes,
> 3 node auth users (1:1), 13 total auth users, 0 unowned nodes. Detection and ACI counts both grew
> across the window, confirming node ingest was never affected (nodes authenticate with their own
> GoTrue credentials, not this secret). Kept as the incident record — the steps below are what ran.

## What happened

The RegisterNode wizard called the `provision-node` Edge Function directly from the browser,
passing the gate secret as `import.meta.env.VITE_PROVISION_SECRET`. The `VITE_` prefix is Vite's
opt-in marker meaning *inline this into the client bundle*, so the 64-character secret shipped in
plaintext inside `/assets/index-*.js`.

Verified on the live deployment before the fix:

```
$ curl -s https://magora-portal.vercel.app/ | grep -o '/assets/[A-Za-z0-9._-]*\.js'
/assets/index-C-oWqh6v.js
$ # the 64-char value from .env was present in that file
EXPOSED in /assets/index-C-oWqh6v.js (971495 bytes)
```

`provision-node` is deployed with gateway JWT verification **off** (`supabase/config.toml`), so that
secret was the *only* gate on an endpoint that creates `auth.users` rows and `nodes` rows without
limit. It also accepted a caller-supplied `owner_id` without verifying it, so a holder of the secret
could mint nodes owned by **another person's account**.

Same class as the `20260725` RLS finding: the protection's *name* implied a gate the mechanism
didn't provide.

## Exploitation audit — none found

Run 2026-08-01 against prod:

| day | orphan node auth users | any sign-in |
|---|---|---|
| 2026-06-13 | 2 | 2026-06-18 |
| 2026-06-18 | 9 | never |
| 2026-07-08 | 1 | never |

15 `node-*@magora.internal` auth users vs 3 `nodes` rows → 12 orphans, all clustered on three
development days, newest **2026-07-08**, three weeks before discovery. Consistent with
provision-node's rollback path failing to delete the auth user on a failed `nodes` insert during
development. No creation activity since. **No evidence of exploitation.**

## Code already merged (no prod effect until deployed)

- **`api/register-node.js`** (new) — server-side wrapper. Verifies the caller's Supabase session
  against GoTrue, derives `owner_id` from the verified token (ignores any body value), rate-limits
  to 5 nodes per account per 7 days, and calls `provision-node` with `PROVISION_SECRET` read from
  the server environment. Deliberately does not use `SUPABASE_SERVICE_ROLE_KEY` (Production-only —
  depending on it would break Preview).
- **`src/pages/RegisterNode.jsx`** — now calls `/api/register-node` with
  `Authorization: Bearer <session.access_token>`; no longer sends `owner_id` or any secret.
- **`.env`** — `VITE_PROVISION_SECRET` renamed to `PROVISION_SECRET` (value unchanged; rotated below).

Verified post-change: production build contains the secret in **no** file under `dist/`, while the
anon key is still present as expected (positive control).

## Cutover — order matters

Rotating before the wrapper is deployed breaks registration with nothing to fall back to. Deploy
first. Registration is unavailable between steps 3 and 4; with two nodes and no external builders
that window is acceptable.

1. **Generate a new secret** (64 hex chars, matching current format):
   ```bash
   openssl rand -hex 32
   ```

2. **Deploy the wrapper** — merge to `main` and let Vercel build, or `vercel --prod`.
   At this point `PROVISION_SECRET` is not yet set on Vercel, so `/api/register-node` returns
   *"Registration is not configured"*. Expected.

3. **Set the new secret on Supabase** (the Edge Function's own secret store — separate from Vercel):
   ```bash
   supabase secrets set PROVISION_SECRET=<new-value> --project-ref wqxmmuwrfltpaxnuddwk
   ```
   Registration is now down: the old bundle's secret no longer matches.

4. **Set the new secret on Vercel** (Production **and** Preview, server-side name — no `VITE_`):
   ```bash
   vercel env add PROVISION_SECRET production
   vercel env add PROVISION_SECRET preview
   ```

5. **Remove the leaked variable from Vercel** so it can never be re-inlined:
   ```bash
   vercel env rm VITE_PROVISION_SECRET production
   vercel env rm VITE_PROVISION_SECRET preview
   ```

6. **Redeploy** so the functions pick up the new environment (`vercel --prod`).

7. **Update local `.env`** — replace the `PROVISION_SECRET` value with the new one.

## Verification — all passed 2026-08-02

Automated against the live production endpoint with a throwaway steward account (created, used,
and deleted within the run):

- [x] `GET /api/register-node` → `405`.
- [x] `POST` with no token → `401`.
- [x] `POST` with a garbage token → `401`.
- [x] `POST` with a valid token but no fields → `400`.
- [x] Registration succeeds for a signed-in steward → `200` with `node_id` / `email` / `password`.
- [x] **Forged `owner_id` in the body → node created owned by the _caller_.** The decisive test:
      ownership is not spoofable.
- [x] Direct call to `provision-node` with the **old** secret → `401`. With the new secret → `400`.
- [x] Live production bundle contains the secret in no file; anon key still present (positive
      control proving the check detects an inlined value).
- [x] Test node, its node auth user, and the throwaway steward all deleted; DB returned to its
      exact pre-test state.

Re-run any time with `TARGET=https://magora-portal.vercel.app node test-register-node.mjs`
(harness kept out of the repo — it needs the service-role key to create and clean up its fixtures).

## Follow-ups

- **Orphan cleanup — ✅ done 2026-08-02.** All 12 dormant `node-*@magora.internal` auth users
  removed. Executed via the GoTrue admin API rather than the SQL in
  `scripts/cleanup-orphan-node-users.sql`, because the admin API also clears the auth-internal rows
  (identities, sessions) that a raw `delete from auth.users` leaves to FK cascade. The SQL is kept
  as the reviewable statement of intent and the audit predicate. The runner re-derived the orphan
  list independently and aborted unless it found exactly 12 with zero authored rows.
- **Charter rule to add:** never give a secret a `VITE_` prefix. In Vite that prefix *means* public.
  This is the second name-implies-a-gate failure after `20260725`; the rule should be explicit.
- **Vault reconcile** — `✅ Where We Are` still asserts the Pis write via `service_role`. Phase 0
  disproved this (per-node GoTrue users + `auth.uid() = node_id` ingest policies). Correct it.
