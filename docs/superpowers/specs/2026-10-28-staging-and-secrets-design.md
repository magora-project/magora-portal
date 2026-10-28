# magora-portal staging, backups and secrets — design (Spec 2)

- **Date:** 2026-10-28
- **Status:** draft rev 1, from the brainstorm with David on 2026-10-28; not yet approved
- **Plan task:** E1 of the Magora Consolidated Action Plan (the staging half of G2 that Spec 1 deferred)
- **Predecessor:** `docs/superpowers/specs/2026-10-15-repo-harness-design.md` (Spec 1, done 2026-10-28). Its §9 lists this spec's scope.
- **Successor:** Spec 3, regression suite (§9). Not designed here.

This document specifies; it implements nothing.

## 1. Why

Nothing has broken. Magora has a handful of users and intends to grow quickly, so David wants the
ways the system can break removed before growth makes each break costlier. Success means that
nothing done while building (a Vercel preview, `vite dev`, a migration, a test, an agent session)
can damage or leak production data, and that when production does go wrong there is a backup to
restore from.

**Success criteria (Spec 2 is done when all hold):**

1. Production Supabase is on Pro with daily backups, and one restore has been rehearsed into a
   scratch project (not production) and read back.
2. Vercel Preview and local `vite dev` reach the staging project only. Proven by reading back every
   Preview-scoped env var name and value source, and by a preview request that shows the staging
   project ref. `staging.themagoraportal.org` serves `main` against staging, read back as in §5.9.
6. A phone recording made on staging has been processed by the staging listen worker (§5.7).
3. The migration gate (§5.5) has been shown to go red on each defect it exists to catch, before it
   is made required, and a migration has been applied to production by the after-merge job.
4. Every secret the portal uses exists in 1Password, and both maintainers have run `op run` against
   the staging vault on their own machine (macOS and Windows).
5. A simulated node has registered, signed in and uploaded against staging.

## 2. Goals, non-goals, anti-goals

**Goals:** production backups; one shared staging database; previews and laptops on staging; a
migration gate that tests each migration on staging before production and applies it on merge;
1Password as the source of truth for every secret; a simulated node for the node-portal contract.

**Non-goals (deferred, not rejected):**
- Per-PR database branches (Supabase branching). Revisit when outside contributors arrive.
- Point-in-time recovery ($100/month per 7 days). Daily backups only.
- Real Pi nodes switchable to staging. That is a change to `magora-acoustic-biodiversity`.
- 1Password service accounts and automatic sync to Vercel/GitHub. Copies are made by hand.
- The regression suite: browser flow tests, screenshot comparison, `/api` contract tests (Spec 3).

**Anti-goals (failure even if it works):**
- Real users' emails, sign-ins or phone-recording coordinates in staging.
- A staging result trusted while staging's schema differs from production's.
- A secret value printed by an agent, written to a file in the repo, or held by a fork preview.
- Production broken by a preview, a local session or a test.

## 3. Current state (read 2026-10-28 unless noted)

- One Supabase project, `wqxmmuwrfltpaxnuddwk`, on the **Free** plan (David, 2026-10-28): no
  backups, no branching, pauses after a week idle (supabase.com/pricing, read 2026-10-28).
- Vercel is on Pro (architect charter, 2026-07-17). Production serves at
  `magora-portal.vercel.app`. The charter's `app.themagoraproject.com` does not resolve (`dig`,
  2026-10-28); `themagoraproject.com` itself is a Squarespace site, registered at Squarespace
  Domains, expiring 2026-12-30.
- `vite.config.js` proxies `/api` to `https://magora-portal.vercel.app` (production).
- Preview-scoped Vercel env (Spec 1 §3, measured 2026-10-15, names only): `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_ANON_KEY` (production project), `ANTHROPIC_API_KEY`, `EBIRD_API_KEY`,
  `PROVISION_SECRET`, `XENO_CANTO_API_KEY`. `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET` are
  production-only. **Re-measure before acting.**
- The browser writes to Supabase directly with the anon key under RLS (listen sessions, queue,
  journal follows). Sign-in is email OTP and OAuth (`src/components/AuthModal.jsx`).
- Server functions using the service-role key: `update-location`, `seed-guilds`,
  `rotate-node-credentials`, `range-allowlist-build`, `api/_report/db.js`, `api/_node_status/db.js`.
- Paid or visible side effects: Slack (`report-cron`, `_node_status/notify`, `_pulse/notify`),
  Anthropic (`insight`, `insight-batch`, `seed-guilds`, `_report/narrate-report`), eBird,
  xeno-canto. Crons are declared in `vercel.json`.
- Pi nodes sign in with per-node credentials, register through `provision-node`
  (`verify_jwt = false`, checks `PROVISION_SECRET`) and upload through `storage-upload`. External
  builders' nodes pull from `magora-acoustic-biodiversity`'s `release` branch.
- The Fly.io app `magora-listen-worker` (in `magora-acoustic-biodiversity/worker/`) pulls the
  `audio_inference` queue from production with the service-role key (TASKS.md; migration
  `20260629_listen_phase2_queue_rpc.sql`).
- 32 migrations, first dated 2026-06-26, applied by hand from a laptop linked via
  `supabase/.temp`. **Core tables (`nodes`, `detections`, `aci_logs` at least) are created by no
  migration**; Spec 1 §9 counts five such tables. The migrations alone cannot build a database.
- Tests: 11 `*.test.mjs` files (server helpers and CI scripts); none for `src/`.
- 1Password: Business plan (trial, 2 members), one vault "Magora Project", empty.

## 4. Decisions taken in the brainstorm (David, 2026-10-28)

| # | Decision | Rejected or deferred |
|---|---|---|
| E-1 | Upgrade Supabase to **Pro** for daily backups and no pausing. | Free plan with a second free project (no backups). PITR (deferred). |
| E-2 | **One shared staging project**, always on. | Per-PR Supabase branches (deferred until contributors). |
| E-3 | Staging data: **bird data copied from production; user data synthetic.** | A full production copy; all-synthetic data. |
| E-4 | **Simulated node** in this repo exercises the node-portal contract against staging. | Real Pis switchable to staging (other repo, later spec). |
| E-5 | **GitHub applies migrations to production on merge**, after the gate in §5.5. | Applying by hand from a laptop. |
| E-6 | The gate in §5.5 as described, including a read-only production check. | — |
| E-7 | **Two vaults:** "Magora Project" holds production; a new "Magora Staging" holds staging. Both maintainers have both. Values copied to Vercel/GitHub/Supabase by hand. | One vault; 1Password service account sync (deferred). |
| E-8 | Staging gets a separate Slack channel and its own Anthropic, eBird and xeno-canto keys (the keys are my call, §5.4). | Previews using production Slack and keys; switching features off in previews. |
| E-10 | Production migrations wait for a maintainer's approval click; on any failure the job stops and alerts, with no automatic rollback. | Fully automatic on merge; automatic rollback. |
| E-11 | A staging copy of the listen worker, so phone recordings can be tested on staging. | Listen inference off on staging. |
| E-12 | `staging.themagoraportal.org` for staging; `themagoraportal.org` for production, cut over later. | Vercel preview URLs only. |
| E-13 | Storage objects are backed up nightly to Cloudflare R2 (§5.1). | A documented database-only restore. |
| E-9 | Regression testing is Spec 3, after this. | Folding it into Spec 2. |

## 5. Components

### 5.1 Backups (E-1)

Upgrade the production project's organization to Pro. Confirm daily backups appear in the
dashboard. Rehearse one restore: download the newest backup (or `pg_dump` if the dashboard
download is not available on the plan), restore it into a scratch project, compare row counts of
the core tables with production, delete the scratch project. Record the procedure as a runbook in
`docs/`.

**Storage objects (E-13).** Supabase database backups and `pg_dump` do not include Storage object
bytes (audio, avatars, banners), so a database restore alone would bring back rows pointing at
missing files. A nightly job copies every production Storage bucket to a Cloudflare R2 bucket
(David, 2026-10-28). The job holds a read-only Storage credential and a write-only R2 credential,
both in a protected `main`-only GitHub environment. The rehearsal above also restores a sample of
objects from R2 into the scratch project and checks that rows referencing them resolve. Retention
and versioning are left to the builder, but must cover at least the 7 days of database backups.

### 5.2 Baseline migration

Capture production's current schema (schema only, no data) as one migration that sorts before
`20260626_*` and creates every object no existing migration creates: tables, views, functions,
RLS policies, storage buckets and policies, extensions, queues. It must be idempotent against
production (production already has these objects; recording it as applied there must not
re-create them). Proof: an empty Postgres built from the baseline plus all 32 migrations has the
same schema as production, by the same comparison the gate uses (§5.5 step 1). Its rollback file
is a documented no-op for production, since rolling back the baseline means dropping the database.

### 5.3 Staging project and data (E-2, E-3)

- A second Supabase project in the same Pro organization, built from the baseline plus all
  migrations. Same region as production.
- **Copied from production:** `detections`, `aci_logs`, species and reference tables
  (`range_allowlist`, `ref_species_traits`, species whitelist), `pulses`, `pulse_weights`,
  `pulse_narratives`, `node_reports`, `node_status_events`.
- **Nodes:** copied with real locations (David accepted, staging is reachable only by maintainers),
  re-owned to synthetic users, and given staging-only credentials.
- **Synthetic:** `auth.users`, `listeners`, all follow tables, `listen_sessions`.
- **Not copied:** `mobile_detections` (user ID plus precise coordinates).
- **Storage audio:** only named nights, chosen when refreshing.
- A refresh script rebuilds staging from scratch (schema, then copy, then synthetic seed). It runs
  after every production migration (§5.5 step 6) and on demand. It reads production with the
  read-only login and must never hold write access to production.
- Auth on staging: email OTP works with Supabase's built-in mailer; OAuth providers need staging
  redirect URLs registered with each provider.

### 5.4 Previews and local development (E-7, E-8)

- Vercel Preview env vars point at staging: Supabase URL and keys, a staging `CRON_SECRET`, a staging
  `PROVISION_SECRET`, the staging Slack webhook, and separate staging Anthropic, eBird and
  xeno-canto keys (my call: cheap, and previews then behave like production without switch-off
  code).
- `vite.config.js` proxy target changes from production to a staging target (a staging deployment
  URL or `vercel dev`; builder's call).
- `.envrc`/local env files contain `op://` references only, run through `op run`. No secret values
  on disk.
- Fork previews remain unauthorized (Spec 1 §2.2) until a re-measure shows Preview holds staging
  values only; this spec does not lift that rule.

### 5.5 Migration gate (E-5, E-6)

A new required CI check on any PR touching `supabase/migrations/`, plus an after-merge job:

1. **Drift check.** Dump production's schema (read-only login) and staging's schema; fail if they
   differ. A staging result on a drifted staging proves nothing.
2. **Apply, undo, re-apply** the PR's new migrations on staging, using each paired rollback file.
3. **Data check.** Staging's copied tables catch new constraints that real bird data violates. For
   constraints on synthetic tables, run read-only `would this hold` queries against production.
4. **Old code on new schema.** Run the simulated node (§5.6) and a minimal page-load check using the
   code currently deployed to production, against migrated staging.
5. **On merge to `main`:** the job waits for a maintainer's approval (GitHub environment with a
   required reviewer, David, 2026-10-28), then takes an on-demand backup (or `pg_dump`), applies
   the migration to production, and reruns step 4 against production. **On any failure it stops
   and alerts** (Slack, production channel) and changes nothing further: no automatic rollback
   (David, 2026-10-28). A maintainer chooses between the rollback file and restoring the backup.
6. **Refresh staging** from production (§5.3) so step 1 holds for the next PR.

**How migrations are applied (staging and production).** Never `supabase db push`,
`migration repair` or `db pull` (architect charter, "Supabase branch-behind-remote migrations": they
corrupt the remote ledger). The job applies each new file with `supabase db query` (or `psql`) and
writes its row into `supabase_migrations.schema_migrations` itself, in one transaction where the
DDL allows. "New" means present in the repo and absent from the ledger. Precondition, done once
in this spec: read production's ledger, reconcile it against all 32 files (several were applied
by hand or through the dashboard, per TASKS.md), and record the baseline (§5.2) as applied.

**Deploy ordering (builder's call, recorded here).** A merge to `main` also starts Vercel's
production deploy, which races step 5. So a PR that adds a migration may contain no app code
(`src/`, `api/`, `shared/`, `supabase/functions/`); CI fails it otherwise. That is expand/contract
(AGENTS.md) made mechanical: the schema lands first, the code that uses it in a later PR. Old code
on new schema is then the only combination production ever sees, and step 4 tests exactly that.

**Production login scopes (builder's call, recorded here).** Three separate logins:
- *PR jobs* (steps 1 and 3): catalog read only (for the schema dump) plus `EXECUTE` on check
  functions that return a yes/no or a count, never rows. A PR workflow runs the PR's own YAML
  (Spec 1 §2.1), so this login must be safe to leak.
- *Refresh* (§5.3): `SELECT` on the copied tables only, never `auth`, `listeners`,
  `mobile_detections` or follow tables. Used only by workflows on `main`.
- *Migrate* (step 5): DDL owner. A GitHub environment secret limited to `main`.

**Data-check queries (builder's call, recorded here).** A migration that adds or tightens a
constraint on a table staging does not copy ships a paired check under
`supabase/migrations/checks/<stem>.check.sql`: a query that returns a count of production rows
that would violate the constraint. The gate runs it through the PR login's check-function path
and fails on a non-zero count. CI cannot tell reliably whether a check is needed, so a missing
check is a review item, not a CI failure.

Rules: one migration PR merges at a time (staging is shared). The production migration login is a
GitHub environment secret, readable only by the after-merge job, with environment protection. The
existing `migrations` check (rollback presence) stays. A fork PR never runs steps 1–4 (no secrets);
a maintainer re-runs them from a branch in the main repo.

### 5.6 Simulated node (E-4)

A script in this repo that does what a Pi does, against staging only. **The contract is whatever
the `release` branch of `magora-acoustic-biodiversity` does**, not what this spec guesses: the
plan's first task reads that repo (public) and writes down every endpoint, auth step, table,
bucket and payload a node uses. From the portal side, registration is `provision-node`
(`PROVISION_SECRET`); detections and `aci_logs` appear to be direct PostgREST inserts under the
"nodes insert own …" policies (migration `20260725`); `storage-upload` accepts only
`listener-avatars`, `temp-audio` and `node-banners`, so node audio (if any) goes elsewhere. The
script performs the full sequence (register, sign in, write, read back). It refuses to run against the production project ref.
It is the shared core of gate step 4 and the first test Spec 3 builds on.

### 5.7 Listen worker (staging copy)

David tests phone recordings and wants them on staging (he has found their accuracy poor). A
second Fly.io app, `magora-listen-worker-staging`, runs the same worker image as production
with staging's Supabase URL and service-role key, and pulls staging's `audio_inference` queue.
Production's worker keeps pulling from production only. The worker code lives in
`magora-acoustic-biodiversity/worker/`; the plan first confirms that its Supabase target comes
from environment variables, and if it is hard-coded that change is a PR in that repo.
Improving phone-recording accuracy is **not** in this spec; staging is where that work will be
tested. Staging phone detections are synthetic-user rows, so `mobile_detections` stays uncopied.

### 5.8 1Password (E-7)

- Vaults: "Magora Project" (production) and "Magora Staging". One item per service and
  environment, with fields named after the env var (`SUPABASE_SERVICE_ROLE_KEY`, …).
- Every value now in Vercel, GitHub and Supabase function secrets is entered into the vault first;
  the vault is the source of truth and copies are updated from it.
- `AGENTS.md` gains a rule: agents use `op run` and `op inject` only, never `op read`,
  `op item get` or anything else that prints a value.
- Rotation at cutover: `PROVISION_SECRET` (previews held it), plus every value whose old copy sat in
  Preview. The service-role key is rotated only after checking what depends on it (the listen worker
  does; nodes are believed not to — verify).

### 5.9 Staging domain

- `staging.themagoraportal.org` serves the latest `main` built with staging's env vars: a stable
  address for staging that does not depend on a PR being open. `themagoraportal.org` is reserved
  for production; moving production off `magora-portal.vercel.app` is **not** in this spec.
- The domain is registered on Cloudflare (David, 2026-10-28). The staging record is a DNS-only
  (unproxied) CNAME to Vercel's target, so Vercel issues and renews the certificate.
- Mechanism (builder's call, constrained): it must not reintroduce a long-lived branch (Spec 1
  D-2, trunk flow). A Vercel custom environment on the Pro plan is the expected mechanism; the
  plan first confirms it can serve `main` with its own env vars and domain, and if it cannot,
  brings the alternatives back to David before choosing one.
- What the staging address needs registered elsewhere:
  - Supabase Auth (staging project): site URL and redirect URLs for `staging.themagoraportal.org`
    and the Vercel preview URL pattern.
  - Each OAuth provider used in `AuthModal.jsx`: the staging project's callback URL.
  - Method's embed origins for Magora: `https://staging.themagoraportal.org`, so `/donate` works
    on staging. This is a Method admin setting, so a maintainer makes it.
- Read-back: DNS resolves to Vercel, the certificate is valid, and a request to staging shows the
  staging Supabase project ref, not production's.

## 6. Constraints

- Production stays up throughout; no step may need downtime.
- Expand/contract (AGENTS.md) for anything a running deploy reads.
- `subtle-correctness` for every PR in this spec that touches migrations, auth paths or control
  files; the new workflow files are control files.
- macOS and Windows: every script and `op` usage must run on both maintainers' machines.
- Agents never push, merge, change repo settings, change Supabase/Vercel/1Password settings, or
  rotate a secret without the operator's explicit approval.

## 7. Left to the builder

Script languages and file layout; the schema-diff tool; how the gate obtains the code currently
in production; the staging proxy target; synthetic data shapes and volume; which nights' audio to
copy by default; rollout order beyond "backups first, previews switched only after staging passes
the drift check".

## 8. Open decisions for David and Noah

1. ~~Staging listen worker~~ — resolved: yes (§5.7).
2. ~~Staging domain~~ — resolved (David, 2026-10-28): `themagoraportal.org` (registered on
   Cloudflare) is the production site and `staging.themagoraportal.org` the staging site. The
   production cutover from `magora-portal.vercel.app` happens later, not in this spec; staging's
   domain is set up in this spec (§5.9).
3. ~~Staging keys~~ — resolved as my call: create them (§5.4).

## 9. Out of scope

Spec 3, regression suite: browser flow tests, screenshot comparison against `main`, `/api` contract
tests, built on this spec's staging and simulated node. Also everything listed as a non-goal in §2.

## 10. Review log

| Round | Reviewer | Result | Disposition |
|---|---|---|---|
| 0 | Builder check: Opus subagent, fresh context, read-only on the repo, on rev 1 | 8 questions | 1 answered from the repo (the node contract comes from `magora-acoustic-biodiversity`'s `release` branch; corrected the `storage-upload` claim, §5.6). 4 settled as my calls and marked: migrations applied file by file with a hand-written ledger row, never `db push` (the charter forbids it); migration PRs carry no app code; three production logins; author-written data-check queries (§5.5). 3 went to David: on production failure, stop and alert; a required approval before production migrations; a staging listen worker, plus the domain (§5.5, §5.7, §5.9). |
| — | Semgrep (`semgrep-artifact-scan.sh`) on rev 1 | UNRUN | No fenced code blocks, so there was nothing to scan (exit 1). |
