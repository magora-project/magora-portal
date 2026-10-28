# magora-portal staging, backups and secrets — design (Spec 2)

- **Date:** 2026-10-28
- **Status:** draft rev 2 (Codex round 1 applied, §10); not yet approved
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

1. Production Supabase is on Pro with daily backups, and one restore (database plus a sample of
   Storage objects from R2) has been rehearsed into a scratch project (not production) and read back.
2. Vercel Preview and local `vite dev` reach the staging project only. Proven by reading back every
   Preview-scoped env var name and value source, and by a preview request that shows the staging
   project ref. `staging.themagoraportal.org` serves `main` against staging, read back as in §5.9.
3. The migration gate (§5.5) has been shown to go red on each defect it exists to catch, before it
   is made required, and a migration has been applied to production by the after-merge job.
4. Every secret the portal uses exists in 1Password, and both maintainers have run `op run` against
   the staging vault on their own machine (macOS and Windows).
5. A simulated node has registered, signed in and uploaded against staging.
6. A phone recording made on staging has been processed by the staging listen worker (§5.7).
7. Each production login (§5.5) has been proven, as that login, to read what it needs and to be
   refused every write and every function it was not granted.
8. Every production write path reachable without a production credential that was known when
   this spec was approved has been closed. Those paths are tracked privately under `SECURITY.md`
   (the repo is public) and are not listed here.

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
- A test or gate step that writes to production (only the approved migration itself may).

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
- Service-role key holders, by where the key comes from:
  - *Vercel-managed* (`SUPABASE_SERVICE_ROLE_KEY` env var): `update-location`, `seed-guilds`,
    `rotate-node-credentials`, `range-allowlist-build`, `api/_report/db.js`, `api/_node_status/db.js`.
  - *Supabase-injected* (set by Supabase in every Edge Function, not by us): `provision-node`
    (creates node logins and `nodes` rows) and `storage-upload` (writes Storage objects).
  - *Fly.io secret*: the listen worker (below).
- `/donate` embeds The Method Project's donation form (PR #42, merged 2026-10-28). Method frames it
  only on origins listed in Magora's "Embed origins" in Method's admin.
- Paid or visible side effects: Slack (`report-cron`, `_node_status/notify`, `_pulse/notify`),
  Anthropic (`insight`, `insight-batch`, `seed-guilds`, `_report/narrate-report`), eBird,
  xeno-canto. Crons are declared in `vercel.json`.
- Pi nodes sign in with per-node credentials (a node's login UUID is its `nodes.id`; `owner_id`
  is the steward's user), register through `provision-node` (`verify_jwt = false`, checks
  `PROVISION_SECRET`) and upload through `storage-upload`. External builders' nodes pull from
  `magora-acoustic-biodiversity`'s `release` branch.
- The Fly.io app `magora-listen-worker` (in `magora-acoustic-biodiversity/worker/`) pulls the
  `audio_inference` queue from production with the service-role key (TASKS.md; migration
  `20260629_listen_phase2_queue_rpc.sql`).
- 32 migrations, first dated 2026-06-26, applied by hand from a laptop linked via
  `supabase/.temp`. **Core tables are created by no migration** (`nodes`, `detections`,
  `aci_logs`, `species` and `node_habitat` are referenced but never created; Spec 1 §9 counts
  five). Some migrations alter objects that no longer exist: `20260725` alters a policy on
  `public.users`, which `20260726` drops. The migrations alone cannot build a database.
- No two migration files share a version prefix today. `scripts/ci/check-migrations.mjs` checks
  only that new top-level `.sql` files have a rollback; it does not notice an edited old file.
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
both in a protected `main`-only GitHub environment (§5.10). The rehearsal above also restores a
sample of objects from R2 into the scratch project and checks that rows referencing them resolve.
Retention and versioning are left to the builder, but must cover at least the 7 days of database
backups.

### 5.2 Baseline migration

Today's schema is not enough to replay history: `20260725` alters a policy on `public.users`,
which no longer exists, and later migrations refer to policy and constraint names as they stood
then. So the baseline is a **reconstructed pre-history schema**: the schema as it stood just
before `20260626`, including objects later migrations alter or drop (`public.users` and its
policies) under their historical names.

- **Derivation.** Start from production's schema-only dump, remove what the 32 migrations create,
  and restore what they alter or drop to its earlier form, reading each migration to see what it
  expects. Iterate until the proof below passes.
- **Proof.** On a fresh Supabase Postgres (the local `supabase start` stack, or a scratch
  project; it supplies `auth`, `storage`, extensions and roles), apply the baseline then all 32
  migrations in order. The resulting schema must equal production's by the comparison the gate
  uses (§5.5). Any difference that cannot be removed (for example, objects Supabase itself owns)
  goes in a reviewed allowlist file beside the comparison script, each line with its reason.
- **Production is never given the baseline DDL.** A separate, approved one-off step checks that
  production's schema matches the proof's result and then inserts the baseline's ledger row only.
- **Ledger convention** (applies to every migration, §5.5): `version` is the filename's prefix
  before the first `_`; `name` is the rest of the stem; `statements` holds the file's full text,
  and the SHA-256 of that text is what the immutability check (§5.5) compares.
- **File and rollback.** The baseline sorts before `20260626_*`. Its rollback file is a
  documented no-op, since rolling back the baseline means dropping the database.

### 5.3 Staging project and data (E-2, E-3)

- A second Supabase project in the same Pro organization, built from the baseline plus all
  migrations on `main`. Same region as production.
- **Every table in `public` is classified** in a checked-in table manifest as *copied*,
  *transformed*, *synthetic* or *excluded*. The refresh refuses to run while any table in the
  rebuilt schema is missing from the manifest, so a new table forces a classification. The
  starting classification, to be completed against the baseline:
  - *Copied as is:* `detections`, `aci_logs`, `species`, `range_allowlist`, `ref_species_traits`,
    `node_habitat`, `pulses`, `pulse_weights`, `pulse_narratives`, `node_reports`,
    `node_status_events`.
  - *Transformed:* `nodes`. Every column is kept as is (including `location` and the
    `species_whitelist` JSONB column) except `owner_id`, which is remapped (below).
  - *Synthetic:* `listeners`, `node_follows`, `listener_follows`, `journal_follows`,
    `listen_sessions`.
  - *Excluded:* `mobile_detections` (user ID plus precise coordinates).
- **Identities.** Node IDs are kept, so nothing that references a node is remapped. Each node
  gets a staging-only login with the **same UUID** as its production login, a synthetic email
  and a new credential. Each distinct production `owner_id` maps to one new synthetic steward;
  the mapping exists only in the refresh's memory and is not written anywhere.
- **Refresh order.** (1) Read production in one repeatable-read snapshot (or `pg_dump
  --snapshot`) so the copied tables agree with each other. (2) Rebuild staging's schema. (3)
  Create synthetic users and node logins in `auth` first. (4) Load tables in foreign-key order
  with user triggers off (`session_replication_role = replica`), then turn them back on. (5)
  Seed the synthetic tables. (6) Integrity check: every foreign key validates, and each copied
  table's row count equals the snapshot's.
- **Storage audio:** only named nights, chosen when refreshing.
- The refresh runs after every production migration (§5.5) and on demand, from `main` only. It
  reads production only with the refresh login and must never hold write access to production.
  It refuses to write to the production project ref. It ends by storing a snapshot of staging's
  loaded data inside the staging project, so a gate run can **reset** staging (rebuild the
  schema, reload that snapshot) without any production credential.
- **Who can reach staging.** Staging's anon key ships in the staging bundle, so its API is as
  public as production's. The guarantee is therefore: staging exposes to an anonymous caller no
  more than production already does, and holds nothing private. RLS is identical (same
  migrations); copied tables carry the same policies they have in production. Sign-ups are off
  on staging Auth. Staging and Preview deployments sit behind Vercel deployment protection.
  Verified with plain HTTP requests (not the browser): an unauthenticated request to the
  staging site is refused, a sign-up through staging Auth is refused, and an anon read returns
  only what the same read returns from production. Rev 1 justified real node locations by
  "staging is reachable only by maintainers"; that premise does not hold for the API, and the
  locations are acceptable only because production's own policies decide who sees them.
- **Signing in on staging.** Supabase's built-in mailer sends only to the organization's team
  members, at about two messages an hour. Maintainers sign in to staging by email OTP with their
  own addresses (they are team members; their accounts are not real users' data). Synthetic users
  and the simulated node never receive mail: scripts sign them in through the admin API or a
  password. Custom SMTP is not added in this spec. OAuth providers need staging redirect URLs
  registered with each provider.

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
- Moving env vars to staging does not stop a preview or laptop from calling production's public
  endpoints directly. Success criterion 8 covers the production endpoints that would let that
  write.

### 5.5 Migration gate (E-5, E-6)

One new required check, `migration-gate`, runs on **every** PR and always reports:

- PR touches nothing under `supabase/migrations/`: it checks only that production's ledger holds
  every migration on the PR's base (below, *ledger current*) and succeeds.
- PR from a fork touching migrations: it fails with a message. A maintainer reviews the fork's
  change and re-opens it as a same-repo branch; re-running the fork's job never helps, because a
  fork run gets no secrets.
- PR from a same-repo branch touching migrations: the steps below.

**Pre-merge steps.** Every job that changes staging (gate runs, refreshes, staging deploys of
migrations) shares one GitHub concurrency group, so they queue and never interleave.

1. **Reset staging** from the last refresh's snapshot (§5.3): schema rebuilt from the baseline
   plus every migration on the PR's base, data reloaded. Every run starts here, so an earlier
   failed or abandoned run leaves nothing behind. PR jobs never read production data.
2. **Drift check.** Compare production's schema (PR login, catalog only) with staging's, which is
   now the baseline plus every migration on the PR's base. Fail if they differ beyond the §5.2
   allowlist. A difference means production has drifted from the repo, and no staging result
   counts until a maintainer resolves it.
3. **Apply, undo, re-apply** the PR's new migrations on staging, using each paired rollback file,
   then compare the schema after the undo with the schema from step 2.
4. **Old code on new schema.** Using the migrated staging: run the simulated node (§5.6), and build
   the production code (below) with staging's public env values and load its main pages.
5. **Leave staging clean:** run the rollback files, so previews keep seeing production's schema.
   Not relied upon; step 1 of the next run resets anyway.

The gate's result records the PR head SHA, the production SHA it tested, the Edge Function
versions deployed on staging, and the SHA-256 of every new migration file.

**Which code is "in production."** The PR job reads the newest successful Production deployment
of `main` from GitHub's Deployments API (Vercel posts these; the job's `GITHUB_TOKEN` can read
them, so no Vercel token is needed in a PR job) and takes its commit SHA. It builds that SHA
itself with staging's `VITE_` values, since Vite bakes the Supabase URL into the bundle, and
serves it inside the job. Edge Functions and the listen worker deploy on their own schedules;
the gate exercises whatever staging currently runs and records which versions those were.

**Ledger current, and deploy ordering.** A merge to `main` also starts Vercel's production
deploy, which races the production migration. So:
- A PR that adds a migration may contain no app code (`src/`, `api/`, `shared/`,
  `supabase/functions/`); the gate fails it otherwise. The schema lands first, the code that uses
  it in a later PR (expand/contract, AGENTS.md, made mechanical).
- Every PR's `migration-gate` fails while production's ledger lacks any migration present on the
  PR's base. With branch protection requiring branches to be up to date before merge (a repo
  setting, changed with the operator's approval), no PR can merge between a migration's merge
  and its successful production apply, and none can merge while a failed apply is unresolved.
  This keeps E-10: the approval click and stop-on-failure are unchanged; they just hold the queue.

**Migration files are immutable once merged.** The existing `migrations` check (rollback
presence) stays and gains: a PR may not modify, rename or delete an existing
`supabase/migrations/*.sql` (rollback files and `checks/` excepted), and no two files may share a
version prefix. The production job additionally compares each file already in the ledger with
the SHA-256 of its recorded `statements`, and stops on a mismatch.

**On merge to `main`** (an after-merge job in a protected `main`-only environment, §5.10):

1. Wait for a maintainer's approval (GitHub environment with a required reviewer, David,
   2026-10-28).
2. Check that the merged migration files hash to the values the gate recorded; stop otherwise.
3. **Data check (E-6's read-only production check).** For each new migration with a paired
   `supabase/migrations/checks/<stem>.check.sql`, run it in a `READ ONLY` transaction with the
   migrate login; it returns a count of production rows that would violate the new constraint.
   Stop on a non-zero count. These queries are reviewed in the PR and run only here, after
   merge and approval, so no PR job can run SQL against private production data. A constraint
   on a copied table is already caught by step 3 of the pre-merge gate. CI cannot tell whether a
   check is needed, so a missing check is a review item.
4. Take an on-demand backup (or `pg_dump`).
5. Apply each new migration, in one transaction per file where the DDL allows, writing its
   ledger row in the same transaction.
6. **Read-only production verification.** Re-run the drift check (production now equals the
   baseline plus every migration on `main`), load the production site's main pages with GET
   requests, and run anon reads of the tables the node path and the pages read. The simulated
   node never runs against production (§5.6).
7. Refresh staging (§5.3).

**On any failure it stops and alerts** (Slack, production channel) and changes nothing further:
no automatic rollback (David, 2026-10-28). A maintainer chooses between the rollback file and
restoring the backup. Until it is resolved, *ledger current* keeps every PR red.

**How migrations are applied (staging and production).** Never `supabase db push`,
`migration repair` or `db pull` (architect charter, "Supabase branch-behind-remote migrations": they
corrupt the remote ledger). The job applies each file with `supabase db query` (or `psql`) and
writes its ledger row itself (§5.2 convention). "New" means present in the repo and absent from
the ledger. Precondition, done once in this spec: read production's ledger, reconcile it against
all 32 files (several were applied by hand or through the dashboard, per TASKS.md), and record
the baseline as applied (§5.2).

**AGENTS.md** changes "Never apply a migration until its PR is green at its final head" to say
*to production*; the gate applying a PR's migrations to staging before merge is the point.

### 5.6 Simulated node (E-4)

A script in this repo that does what a Pi does, against staging only. **The contract is whatever
the `release` branch of `magora-acoustic-biodiversity` does**, not what this spec guesses: the
plan's first task reads that repo (public) and writes down every endpoint, auth step, table,
bucket and payload a node uses. From the portal side, registration is `provision-node`
(`PROVISION_SECRET`); detections and `aci_logs` appear to be direct PostgREST inserts under the
"nodes insert own …" policies (migration `20260725`); `storage-upload` accepts only
`listener-avatars`, `temp-audio` and `node-banners`, so node audio (if any) goes elsewhere. The
script performs the full sequence (register, sign in, write, read back). It refuses to run
against the production project ref, and nothing turns that refusal off: production is verified
read-only instead (§5.5 after-merge step 6). It is the shared core of gate step 4 and the first
test Spec 3 builds on.

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
- Every value now in Vercel, GitHub, Fly.io and Supabase function secrets is entered into the
  vault first; the vault is the source of truth and copies are updated from it. Supabase-injected
  values (§3) are recorded as such, not copied.
- `AGENTS.md` gains a rule: agents use `op run` and `op inject` only, never `op read`,
  `op item get` or anything else that prints a value.
- Rotation at cutover: `PROVISION_SECRET` (previews held it), plus every value whose old copy sat in
  Preview. The service-role key is rotated only after checking what depends on it (the listen
  worker and the Vercel functions in §3 do; Edge Functions receive the new key from Supabase;
  nodes are believed not to — verify).

### 5.9 Staging domain

- `staging.themagoraportal.org` serves the latest `main` built with staging's env vars: a stable
  address for staging that does not depend on a PR being open. `themagoraportal.org` is reserved
  for production; moving production off `magora-portal.vercel.app` is **not** in this spec.
- The domain is registered on Cloudflare (David, 2026-10-28). The staging record is a DNS-only
  (unproxied) CNAME to Vercel's target, so Vercel issues and renews the certificate.
- Mechanism: a Vercel custom environment (`staging`, Pro plan) with its own env vars and domain.
  It must not reintroduce a long-lived branch (Spec 1 D-2, trunk flow), so it does not track a
  branch. Instead a workflow on every push to `main` runs a targeted deploy of that SHA to the
  `staging` environment, holding a Vercel token in a protected `main`-only environment (§5.10).
  Production's deploy stays on Vercel's Git integration, so the two are independent: a failed
  staging deploy alerts the staging Slack channel and never blocks production. The plan first
  confirms on this project that custom environments and targeted deploys work this way; if not,
  it brings the alternatives back to David before choosing one.
- What the staging address needs registered elsewhere:
  - Supabase Auth (staging project): site URL and redirect URLs for `staging.themagoraportal.org`
    and the Vercel preview URL pattern.
  - Each OAuth provider used in `AuthModal.jsx`: the staging project's callback URL.
  - Method's embed origins for Magora: `https://staging.themagoraportal.org`, so `/donate` works
    on staging (§3). This is a Method admin setting, so a maintainer makes it.
- Read-back: one `main` SHA has produced two deployments, production and staging; DNS resolves
  to Vercel; the certificate is valid; a request to staging shows the staging Supabase project
  ref and a request to production shows production's.

### 5.10 Credentials and where they live

Only same-repo branches get secrets (Spec 1 §2.1); a PR job runs the PR's own YAML, so anything a
PR job can read must be safe for a maintainer's branch to read. A workflow `if:` is not a
boundary. Hence:

| Credential | Store | Readable by |
|---|---|---|
| PR login (production): catalog read plus `SELECT` on the migration ledger, nothing else | Repository secret | Every same-repo PR job |
| Staging database owner and staging keys | Repository secret | Every same-repo PR job (staging holds nothing private, §5.3) |
| Refresh login (production): `SELECT` on copied and transformed tables | Environment `production-read`, deployments from `main` only | Refresh workflow |
| Migrate login (production): DDL owner | Environment `production-migrate`, `main` only, required reviewer | After-merge job |
| Storage read and R2 write (backups) | Environment `backup`, `main` only | Nightly backup job |
| Vercel token (staging deploy) | Environment `staging-deploy`, `main` only | Staging deploy workflow |

Jobs that hold an environment secret check out `main` only and never run code from a PR.

**Effective privileges, proven (success criterion 7).** Table grants alone do not make a login
read-only: functions are executable by `PUBLIC` unless revoked, roles inherit from their
memberships, and RLS policies written for `anon, authenticated` match no other role, so a reader
can silently see zero rows. Each production login is a dedicated role with no memberships and no
`BYPASSRLS` unless the plan shows it is needed. Before a workflow receives one, a test connects
**as that login** and shows: each allowed read returns the row count production has; a write to
every table is refused; `EXECUTE` on every function in exposed schemas is refused except the
listed ones. Any `PUBLIC` grant that test finds on a writing function is a production fix,
reported privately per `SECURITY.md`, not in this spec.

## 6. Constraints

- Production stays up throughout; no step may need downtime.
- Expand/contract (AGENTS.md) for anything a running deploy reads.
- `subtle-correctness` for every PR in this spec that touches migrations, auth paths or control
  files; the new workflow files are control files.
- macOS and Windows: every script and `op` usage must run on both maintainers' machines.
- Agents never push, merge, change repo settings, change Supabase/Vercel/1Password settings, or
  rotate a secret without the operator's explicit approval.
- The repo is public: no production vulnerability is described in a spec, plan, issue or PR body
  before it is fixed.

## 7. Left to the builder

Script languages and file layout; the schema-diff tool; the staging proxy target; synthetic data
shapes and volume; which nights' audio to copy by default; how the staging schema is rebuilt
(never against the production ref); rollout order beyond "backups first, previews switched only
after staging passes the drift check".

## 8. Open decisions for David and Noah

1. ~~Staging listen worker~~ — resolved: yes (§5.7).
2. ~~Staging domain~~ — resolved (David, 2026-10-28): `themagoraportal.org` (registered on
   Cloudflare) is the production site and `staging.themagoraportal.org` the staging site. The
   production cutover from `magora-portal.vercel.app` happens later, not in this spec; staging's
   domain is set up in this spec (§5.9).
3. ~~Staging keys~~ — resolved as my call: create them (§5.4).

For David's review of rev 2 (not new decisions, but changes to what he approved): real node
locations on staging now rest on production's policies, not on staging being private (§5.3);
every PR's check goes red while a merged migration awaits its approval click (§5.5); the data
check moved from the PR job to after merge and approval (§5.5).

## 9. Out of scope

Spec 3, regression suite: browser flow tests, screenshot comparison against `main`, `/api` contract
tests, built on this spec's staging and simulated node. Also everything listed as a non-goal in §2.

## 10. Review log

| Round | Reviewer | Result | Disposition |
|---|---|---|---|
| 0 | Builder check: Opus subagent, fresh context, read-only on the repo, on rev 1 | 8 questions | 1 answered from the repo (the node contract comes from `magora-acoustic-biodiversity`'s `release` branch; corrected the `storage-upload` claim, §5.6). 4 settled as my calls and marked: migrations applied file by file with a hand-written ledger row, never `db push` (the charter forbids it); migration PRs carry no app code; three production logins; author-written data-check queries (§5.5). 3 went to David: on production failure, stop and alert; a required approval before production migrations; a staging listen worker, plus the domain (§5.5, §5.7, §5.9). |
| — | Semgrep (`semgrep-artifact-scan.sh`) on rev 1 | UNRUN | No fenced code blocks, so there was nothing to scan (exit 1). |
| 1 | Codex CLI, read-only at `f449784`, on rev 1 | REWORK, 19 findings | #1 (no Method embed) stale: PR #42 added it; §3 now records it. #16 (Storage) already handled by E-13. The other 17 applied as builder calls in rev 2: service-role inventory by source (#2, §3); real table manifest, `species_whitelist` as a `nodes` column, `node_habitat` copied (#3, §5.3); staging sign-in arrangement (#4, §5.3); reconstructed pre-history baseline, ledger-only production record (#5, §5.2); identity mapping and load order (#6, §5.3); serialized staging, reset per run from a refresh snapshot (#7, §5.3, §5.5); data checks moved after merge, no PR SQL against production (#8, §5.5); *ledger current* blocks merges until applied (#9, §5.5); production SHA from GitHub Deployments, staging build of it (#10, §5.5); targeted staging deploy per `main` push (#11, §5.9); effective-privilege proof per login (#12, §5.10); credentials table with protected environments (#13, §5.10); a production write path reachable without credentials, tracked privately (#14, success criterion 8); staging exposure restated and verified (#15, §5.3); always-reporting check, fork handling, AGENTS.md wording (#17, §5.5); immutable migrations with hashes (#18, §5.5); read-only production verification, simulator staging-only (#19, §5.5, §5.6). |
