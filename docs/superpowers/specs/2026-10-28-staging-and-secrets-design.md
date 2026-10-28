# magora-portal staging, backups and secrets — design (Spec 2)

- **Date:** 2026-10-28
- **Status:** draft rev 6 (migration gate extracted to Spec 2b; review rounds 1–5 in §10); not yet approved
- **Plan task:** E1 of the Magora Consolidated Action Plan (the staging half of G2 that Spec 1 deferred)
- **Predecessor:** `docs/superpowers/specs/2026-10-15-repo-harness-design.md` (Spec 1, done 2026-10-28). Its §9 lists this spec's scope.
- **Successors:** Spec 2b, the automated migration gate
  (`docs/superpowers/specs/2026-10-28-migration-gate-design.md`), and Spec 3, the regression suite
  (§9). Neither is designed here.

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
   Preview-scoped env var's name and its 1Password item reference (never its value; the
   reference is recorded beside each copy), by a preview request that shows the staging
   project ref, and on a maintainer's machine by a `vite dev` session whose browser Supabase
   requests and proxied `/api` requests both reach staging (read from the network log).
   `staging.themagoraportal.org` serves `main` against staging, read back as in §5.9.
3. The interim migration procedure (§5.5) is a runbook in `docs/` and has been rehearsed end to
   end, with a scratch project standing in for production.
4. Every secret the portal uses exists in 1Password: a names-only inventory in `docs/` matches the
   names listed by Vercel, GitHub, Fly.io and Supabase secrets, and both maintainers have run
   `op run` against the staging vault on their own machine (macOS and Windows).
5. A simulated node has registered, signed in and performed every write in the node contract
   inventory (§5.6) against staging.
6. A phone recording made on staging has been processed by the staging listen worker (§5.7),
   with the evidence captured before the next refresh erases it.
7. The refresh login (§5.10) has been proven, as that login, to read every copied table in full
   and to hold no write privilege of any kind (§5.10 lists what the check covers).
8. Every production write path reachable without a production credential that was known when
   this spec was approved has been closed. Those paths are tracked privately under `SECURITY.md`
   (the repo is public) and are not listed here. The private advisory holds the inventory as of
   approval and, for each path, the evidence that an unauthenticated request no longer changes
   production; this criterion is met when every entry has that evidence.
9. The baseline proof (§5.2) passes with an allowlist that names no object in `public`.

## 2. Goals, non-goals, anti-goals

**Goals:** production backups; one shared staging database; previews and laptops on staging; an
interim migration procedure that tests each migration on staging before production; 1Password as
the source of truth for every secret; a simulated node for the node-portal contract.

**Non-goals (deferred, not rejected):**
- The automated migration gate and GitHub-applied production migrations (Spec 2b).
- Per-PR database branches (Supabase branching). Revisit when outside contributors arrive.
- Point-in-time recovery ($100/month per 7 days). Daily backups only.
- Real Pi nodes switchable to staging. That is a change to `magora-acoustic-biodiversity`; its
  `detect.py` has the production database address built in.
- 1Password service accounts and automatic sync to Vercel/GitHub. Copies are made by hand.
- The regression suite: browser flow tests, screenshot comparison, `/api` contract tests (Spec 3).

**Anti-goals (failure even if it works):**
- Real users' emails, sign-ins or phone-recording coordinates in staging. Maintainers' own
  staging accounts and recordings are the exception (§5.3, §5.7).
- A staging result trusted while staging's schema differs from production's.
- A secret value printed by an agent, written to a file in the repo, or held by a fork preview.
- Production broken by a preview, a local session or a test.
- A test that writes to production.

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
- The Supabase CLI deploys to the **linked** project (recorded in `supabase/.temp/`) unless
  `--project-ref` is given; `supabase/config.toml`'s `project_id` names the local stack only.
  Maintainers' laptops are linked to production.
- Tests: 11 `*.test.mjs` files (server helpers and CI scripts); none for `src/`.
- 1Password: Business plan (trial, 2 members), one vault "Magora Project", empty.

## 4. Decisions taken in the brainstorm (David, 2026-10-28)

| # | Decision | Rejected or deferred |
|---|---|---|
| E-1 | Upgrade Supabase to **Pro** for daily backups and no pausing. | Free plan with a second free project (no backups). PITR (deferred). |
| E-2 | **One shared staging project**, always on. | Per-PR Supabase branches (deferred until contributors). |
| E-3 | Staging data: **bird data copied from production; user data synthetic.** | A full production copy; all-synthetic data. |
| E-4 | **Simulated node** in this repo exercises the node-portal contract against staging. | Real Pis switchable to staging (other repo, later spec). |
| E-5 | **GitHub applies migrations to production on merge**, after a gate. **Moved to Spec 2b.** | Applying by hand from a laptop (kept only as the interim, §5.5). |
| E-6 | The gate includes a read-only production check. **Moved to Spec 2b.** | — |
| E-7 | **Two vaults:** "Magora Project" holds production; a new "Magora Staging" holds staging. Both maintainers have both. Values copied to Vercel/GitHub/Supabase by hand. | One vault; 1Password service account sync (deferred). |
| E-8 | Staging gets a separate Slack channel and its own Anthropic, eBird and xeno-canto keys (the keys are my call, §5.4). | Previews using production Slack and keys; switching features off in previews. |
| E-10 | Production migrations wait for a maintainer's approval click; on any failure the job stops and alerts, with no automatic rollback. **Moved to Spec 2b.** | Fully automatic on merge; automatic rollback. |
| E-11 | A staging copy of the listen worker, so phone recordings can be tested on staging. | Listen inference off on staging. |
| E-12 | `staging.themagoraportal.org` for staging; `themagoraportal.org` for production, cut over later. | Vercel preview URLs only. |
| E-13 | Storage objects are backed up nightly to Cloudflare R2 (§5.1). | A documented database-only restore. |
| E-9 | Regression testing is Spec 3, after this. | Folding it into Spec 2. |
| E-14 | The migration gate is extracted into Spec 2b (David, 2026-10-28, after review round 4). | Further revisions of the gate inside this spec. |

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
(David, 2026-10-28). The job holds a Storage credential (open decision 4, §8) and a write-only
R2 credential, both in a protected `main`-only GitHub environment (§5.10). The rehearsal above
also restores a sample of objects from R2 into the scratch project and checks that rows
referencing them resolve. Retention and versioning are left to the builder, but must cover at
least the 7 days of database backups.

### 5.2 Baseline migration

Today's schema is not enough to replay history: `20260725` alters a policy on `public.users`,
which no longer exists, and later migrations refer to policy and constraint names as they stood
then. So the baseline is a **reconstructed pre-history schema**: the schema as it stood just
before `20260626`, including objects later migrations alter or drop (`public.users` and its
policies) under their historical names. Staging is built from it (§5.3); Spec 2b will also use it.

- **Derivation.** Start from production's schema-only dump, remove what the 32 migrations create,
  and restore what they alter or drop to its earlier form, reading each migration to see what it
  expects. Iterate until the proof below passes.
- **Proof.** On a fresh Supabase Postgres (the local `supabase start` stack, started from a
  workspace whose migrations folder holds exactly the baseline and the 32 files, or a scratch
  project; it supplies `auth`, `storage`, extensions and roles), with the roles of §5.10 created
  first, apply the baseline then all 32 migrations in order. The resulting schema must equal
  production's by the schema comparison the refresh uses (§5.3). Any difference that cannot be
  removed (for example, objects Supabase itself owns) goes in a reviewed allowlist file under
  `supabase/migrations/checks/`, each line with its reason. The allowlist may name no object in
  `public`.
- **Production is never given the baseline DDL.** Recording it in production's migration ledger
  belongs to Spec 2b. Until then nothing applies it to production, and it sorts before every
  existing file, so no one applying a later migration by hand can pick it up by accident if they
  apply files by name.
- **File and rollback.** The baseline sorts before `20260626_*`. Its rollback file is a
  documented no-op, since rolling back the baseline means dropping the database.

### 5.3 Staging project and data (E-2, E-3)

- A second Supabase project in the same Pro organization, built from the baseline plus all
  migrations on `main`. Same region as production. Created by David on 2026-10-28: name
  `magora-staging`, project ref `mujiqtvwtsbaakfcsjkp`, Micro compute, sign-ups off, empty
  (nothing linked, migrated or deployed). Scripts that write staging name this ref explicitly
  and refuse any other.
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
- **Identities, per refresh.**
  - *Maintainers' accounts* are created once, through the admin API on the first refresh, and
    **kept** from then on with stable UUIDs; their profile rows are re-seeded by upsert.
  - *Every other auth user* (synthetic stewards and node logins from the previous refresh, and
    anything a preview created) is **deleted** at the start of each refresh.
  - *Node logins* are then re-created with the **same UUID** as each node's production login, a
    synthetic email and a new credential. Node IDs are therefore stable across refreshes, and
    nothing that references a node is remapped.
  - *Stewards:* each distinct production `owner_id` maps to one new synthetic steward, created
    fresh each refresh. The mapping exists only in the refresh's memory and is not written
    anywhere.
- **Refresh order.** (1) Read production in one repeatable-read snapshot (or `pg_dump
  --snapshot`) so the copied tables agree with each other. (2) Delete every Storage object owned by
  a user about to be deleted (Supabase refuses to delete a user who owns objects), then delete
  auth users as above. (3)
  Drop and rebuild the app schemas: the §5.10 roles exist first (they are cluster-level and
  survive), then the baseline and `main`'s migrations are applied. (4) **Drift check:** compare
  staging's rebuilt schema with production's (refresh login, catalog read); stop and alert on any
  difference beyond the §5.2 allowlist, since a staging result on a drifted staging proves
  nothing. (5) Create node logins and stewards. (6) Truncate the tables a migration seeds, then
  load tables in foreign-key order with user triggers off (`session_replication_role =
  replica`), then turn them back on. (7) Seed the synthetic tables. (8) Integrity check: every
  foreign key validates, and each copied table's row count equals the snapshot's. (9) Smoke: the
  simulated node (§5.6) against staging, and each `/api` route the main pages call, against
  `staging.themagoraportal.org` through the automation-bypass secret.
- **What a refresh resets.** Everything this repo's migrations and data create: the app schemas,
  including the Storage bucket rows and `storage.objects` policies the migrations insert and the
  `audio_inference` queue (its messages are discarded); auth users as above; Storage objects
  outside the copied nights. It does not touch the `ops` schema (§5.4), which no migration
  creates. Work done on staging (a maintainer's test recording, a preview's rows) does not
  survive a refresh; evidence for a success criterion is captured before the next one.
- **Storage audio:** only named nights, chosen when refreshing.
- **When it runs.** Nightly, on demand, and as step 3 of the interim migration procedure (§5.5),
  from `main` only, in the `staging-sync` environment (§5.10). Runs share one GitHub concurrency
  group without cancelling a running refresh; a newer pending run replacing an older pending one
  is harmless, because every refresh rebuilds staging from scratch to the newest `main`. It reads
  production only with the refresh login, must never hold write access to production, and
  refuses to write to the production project ref. No PR job touches staging.
- **Who can reach staging.** Staging's anon key ships in the staging bundle, so its API is as
  public as production's. The guarantee is therefore: staging exposes to an anonymous caller no
  more than production already does, and holds nothing private. RLS is identical (same
  migrations); copied tables carry the same policies they have in production. Sign-ups are off
  on staging Auth. Staging and Preview deployments sit behind Vercel deployment protection;
  scripts and the local `vite dev` proxy pass it with Vercel's automation-bypass secret (§5.10).
  That secret is valid on **every** deployment in the Vercel project, production included
  (Vercel's documentation); it unlocks protection only, never env values, and the plan confirms
  whether production deployments are protected at all. Verified with plain HTTP requests (not
  the browser): an unauthenticated request to the staging site is refused, a sign-up through
  staging Auth is refused, and an anon read returns only what the same read returns from
  production. Rev 1 justified real node locations by "staging is reachable only by maintainers";
  that premise does not hold for the API, and the locations are acceptable only because
  production's own policies decide who sees them.
- **Signing in on staging.** Supabase's built-in mailer sends only to the organization's team
  members, at about two messages an hour. Maintainers sign in to staging by email OTP with their
  own addresses, so each maintainer must be a member of the Supabase organization. Synthetic
  users and the simulated node never receive mail: scripts sign them in through the admin API or
  a password. Custom SMTP is not added in this spec. OAuth providers need staging redirect URLs
  registered with each provider.

### 5.4 Previews and local development (E-7, E-8)

- Vercel Preview env vars point at staging: Supabase URL and keys, a staging `CRON_SECRET`, a staging
  `PROVISION_SECRET`, the staging Slack webhook, and separate staging Anthropic, eBird and
  xeno-canto keys (my call: cheap, and previews then behave like production without switch-off
  code).
- `vite.config.js` proxy target changes from production to `staging.themagoraportal.org`,
  sending the automation-bypass secret from the environment.
- Local env files contain `op://` references only and are used through `op run --env-file`
  (which works on macOS and Windows; direnv's `.envrc` does not run on Windows). No secret
  values on disk.
- **Edge Functions on staging.** Because maintainers' laptops are linked to production (§3), a
  plain `supabase functions deploy` targets production. A script deploys the Edge Functions to
  staging with `--project-ref` set to staging's ref and refuses production's ref. After a
  successful deploy it records the deployed git SHA in a row of a staging-only `ops` table
  (created by the staging setup, never by a migration). A maintainer runs it (through `op run`)
  once when staging is created, after setting staging's function secrets (`PROVISION_SECRET`),
  and whenever `supabase/functions/` or `supabase/config.toml` (which sets each function's
  `verify_jwt`) changes on `main`. The refresh smoke (§5.3 step 9) fails if that recorded SHA is
  older than the newest `main` commit touching either path, so a forgotten deploy shows up. Not automated, because a Supabase access token can reach every
  project the account can, production included.
- Fork previews remain unauthorized (Spec 1 §2.2) until a re-measure shows Preview holds staging
  values only; this spec does not lift that rule.
- Moving env vars to staging does not stop a preview or laptop from calling production's public
  endpoints directly. Success criterion 8 covers the production endpoints that would let that
  write.

### 5.5 Migrations until Spec 2b (interim procedure)

The automated gate is Spec 2b. Until it lands, a migration reaches production by this procedure,
written as a runbook in `docs/`. It is today's practice (applied by hand from a laptop) with
staging and a backup added.

1. **Before merge**, a maintainer starts a test session: they post in the maintainers' channel
   that staging is theirs, pause the nightly refresh workflow, and run a refresh, which must pass
   its drift check, so staging starts equal to production. They then apply the PR's migration to
   staging, then its rollback file, then the migration again, with staging's ref explicit (never
   through the laptop's link), and run the simulated node against staging. They end the session
   by running a refresh (which drops the test migration) and re-enabling the nightly workflow.
   One session at a time, so one migration never passes because another is still applied.
2. **After merge**, they take a backup (`pg_dump` to the private R2 bucket, read back, or confirm
   that day's daily backup exists), then apply the migration to production by the current method.
3. They run the refresh (§5.3), whose drift check confirms production and the repo agree.

Rules that hold meanwhile: a PR that adds a migration stays `subtle-correctness` and keeps its
rollback file (AGENTS.md); agents never apply a migration to production. **AGENTS.md** changes
"Never apply a migration until its PR is green at its final head" to say *to production*, since
step 1 applies to staging before merge.

### 5.6 Simulated node (E-4)

A script in this repo that does what a Pi does, against staging only. **The contract is whatever
the `release` branch of `magora-acoustic-biodiversity` does** (and the node image, which is built
from that repo's `main`), not what this spec guesses: the plan's first task reads that repo
(public) and writes down every endpoint, auth step, table, bucket and payload a node uses. From
the portal side, registration is `provision-node` (`PROVISION_SECRET`); detections and `aci_logs`
appear to be direct PostgREST inserts under the "nodes insert own …" policies (migration
`20260725`); `storage-upload` accepts only `listener-avatars`, `temp-audio` and `node-banners`, so
node audio (if any) goes elsewhere. The script performs the full sequence: register (with
staging's `PROVISION_SECRET`), sign in, then **every write in that contract inventory** (each
table insert and each upload a node makes), then reads each back. It refuses to run against the
production project ref, and nothing turns that refusal off. It runs in the refresh smoke (§5.3
step 9) and in step 1 of the interim procedure (§5.5), and is the first test Spec 2b and Spec 3
build on.

### 5.7 Listen worker (staging copy)

David tests phone recordings and wants them on staging (he has found their accuracy poor). A
second Fly.io app, `magora-listen-worker-staging`, runs the same worker image as production
with staging's Supabase URL and service-role key, and pulls staging's `audio_inference` queue.
Production's worker keeps pulling from production only. The worker code lives in
`magora-acoustic-biodiversity/worker/`; the plan first confirms that its Supabase target comes
from environment variables, and if it is hard-coded that change is a PR in that repo.
Improving phone-recording accuracy is **not** in this spec; staging is where that work will be
tested. A phone recording on staging stores the recorder's real high-accuracy location
(`src/lib/listen.js`) under their own account. Maintainers may do this (David, 2026-10-28): it is
their own data, readable only by them under the same owner-only policy as production. No other
user's recordings reach staging, so `mobile_detections` stays uncopied.

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
| Refresh login (production, read-only): `SELECT` on copied and transformed tables, catalog read | Environment `staging-sync`, `main` only | Refresh workflow |
| Staging database owner, staging service-role key, staging `PROVISION_SECRET`, staging Slack webhook | Environment `staging-sync`; also the staging vault | Refresh workflow; maintainers (interim procedure, Edge Function deploys) |
| Vercel automation-bypass secret (valid on every deployment in the project, §5.3) | Environment `staging-sync`; also the staging vault, for `vite dev` | Refresh workflow; maintainers' laptops |
| Storage read and R2 write (nightly backups) | Environment `backup`, `main` only; the Storage credential is open decision 4 (§8) | Nightly backup job |
| Vercel token (staging deploy) | Environment `staging-deploy`, `main` only | Staging deploy workflow |

Jobs that hold an environment secret check out `main` only and never run code from a PR. No PR
job holds any credential this spec adds.

**Roles.** The refresh login is a dedicated role. It exists under the **same name** in
production, staging and any local stack, created by one setup script **before** any migration is
replayed, so a migration may grant to it. A table classified *copied* (§5.3) needs its
`GRANT SELECT` to the refresh login in the migration that creates it; the refresh fails on a
copied table it cannot read. The refresh login must read every row of the copied tables, and RLS
policies written for `anon, authenticated` match no other role, so it is expected to need
`BYPASSRLS`; the plan confirms the platform lets `postgres` grant it, and if not brings the
alternatives to David.

**Privilege check (success criterion 7).** Connects as the refresh login and reads the catalog,
attempting no write. It shows: no `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES` or
`TRIGGER` on any table, at table **or column** level; no `UPDATE` or `USAGE` on any sequence; no
`EXECUTE` on any function in **any** schema outside a reviewed allowlist (a SQL login is not
limited to the schemas PostgREST exposes); no `CREATE` on any schema or on the database; owns no
object; no role memberships; no role attributes beyond `LOGIN` and `BYPASSRLS`. A positive part
reads each copied table and compares its row count with a count taken by a maintainer. It runs
before the refresh workflow first receives the login, and at the start of every refresh. Any
grant it finds that lets this or another role write production unexpectedly is reported
privately per `SECURITY.md`, not in this spec.

### 5.11 Rollout order

1. Backups and the restore rehearsal (§5.1). 1Password entry (§5.8) and the private fixes behind
   success criterion 8 can proceed in parallel from the start.
2. The baseline PR merges, `subtle-correctness`, with the §5.2 proof attached. It is accepted on
   that proof; the interim procedure's staging test (§5.5) cannot apply, since staging does not
   exist yet. Applying nothing to production, it needs no backup or production step either.
3. Staging project: setup script (roles, `ops` schema), Edge Functions deployed (§5.4), first
   refresh (§5.3) with steps 1–8 passing, including the drift check. The smoke (step 9) waits
   for step 4.
4. Staging deployment and domain (§5.9), then a full refresh with the smoke passing.
5. Previews and local development switch to staging (§5.4).
6. Staging listen worker (§5.7).
7. Secret rotation (§5.8).
8. The interim migration runbook (§5.5) is rehearsed, with a scratch project standing in for
   production.

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

Script languages and file layout; the schema-diff tool; synthetic data shapes and volume; which
nights' audio to copy by default; how the refresh drops and rebuilds staging (never against the
production ref), within §5.3's definition.

## 8. Open decisions for David and Noah

1. ~~Staging listen worker~~ — resolved: yes (§5.7).
2. ~~Staging domain~~ — resolved (David, 2026-10-28): `themagoraportal.org` (registered on
   Cloudflare) is the production site and `staging.themagoraportal.org` the staging site. The
   production cutover from `magora-portal.vercel.app` happens later, not in this spec; staging's
   domain is set up in this spec (§5.9).
3. ~~Staging keys~~ — resolved as my call: create them (§5.4).
4. **Open: the nightly Storage backup's credential (§5.1).** Supabase Storage has no read-only
   key that I know of (to verify in the plan): the choices are the service-role key or Storage's
   S3 access keys, both able to write. Either one, held in a `main`-only environment with no
   required reviewer (a nightly job cannot wait for a click), is a production-writing credential
   used unattended. My recommendation: S3 access keys in the `backup` environment, accepted as
   such, with the job checking out `main` only. The alternative is no automated Storage backup.

For David's review (not new decisions, but changes to what he approved in rev 1): real node
locations on staging now rest on production's policies, not on staging being private (§5.3); the
automated gate (E-5, E-6, E-10) moved to Spec 2b, and migrations meanwhile follow the interim
procedure (§5.5); staging Edge Functions are deployed by hand, not by CI (§5.4); the bypass
secret also unlocks production deployments, if those are protected (§5.3).

## 9. Out of scope

Spec 2b, the automated migration gate. Spec 3, regression suite: browser flow tests, screenshot
comparison against `main`, `/api` contract tests, built on this spec's staging and simulated node.
Also everything listed as a non-goal in §2.

## 10. Review log

| Round | Reviewer | Result | Disposition |
|---|---|---|---|
| 0 | Builder check: Opus subagent, fresh context, read-only on the repo, on rev 1 | 8 questions | 1 answered from the repo (the node contract comes from `magora-acoustic-biodiversity`'s `release` branch; corrected the `storage-upload` claim, §5.6). 4 settled as my calls and marked: migrations applied file by file with a hand-written ledger row, never `db push` (the charter forbids it); migration PRs carry no app code; three production logins; author-written data-check queries (§5.5). 3 went to David: on production failure, stop and alert; a required approval before production migrations; a staging listen worker, plus the domain (§5.5, §5.7, §5.9). |
| — | Semgrep (`semgrep-artifact-scan.sh`) on rev 1 and later revisions | UNRUN | No fenced code blocks, so there was nothing to scan (exit 1). |
| 1 | Codex CLI, read-only at `f449784`, on rev 1 | REWORK, 19 findings | #1 (no Method embed) stale: PR #42 added it; §3 now records it. #16 (Storage) already handled by E-13. The other 17 applied as builder calls in rev 2: service-role inventory by source (#2, §3); real table manifest, `species_whitelist` as a `nodes` column, `node_habitat` copied (#3, §5.3); staging sign-in arrangement (#4, §5.3); reconstructed pre-history baseline, ledger-only production record (#5, §5.2); identity mapping and load order (#6, §5.3); reset per run from a refresh snapshot (#7, §5.3, §5.5); data checks moved after merge, no PR SQL against production (#8, §5.5); *ledger current* blocks merges until applied (#9, §5.5); production SHA from GitHub Deployments, staging build of it (#10, §5.5); targeted staging deploy per `main` push (#11, §5.9); effective-privilege proof per login (#12, §5.10); credentials table with protected environments (#13, §5.10); a production write path reachable without credentials, tracked privately (#14, success criterion 8); staging exposure restated and verified (#15, §5.3); always-reporting check, fork handling, AGENTS.md wording (#17, §5.5); immutable migrations with hashes (#18, §5.5); read-only production verification, simulator staging-only (#19, §5.5, §5.6). |
| 2 | Codex CLI, read-only at `725e7e8`, on rev 2, prompt carrying round 1's dispositions | REWORK, 10 findings | All applied in rev 3; #2 and #5–#8 were defects in rev 2's own fixes. #1 (staging phone recordings store the recorder's real location) went to David: maintainers' own recordings allowed (§2, §5.7). Builder calls: *production current* as a secret-free GitHub Deployment record, so fork and Dependabot PRs can be checked, written only after verification and refresh (#2, #7, §5.5); reset guarantees schema and copied data only, other writers not suspended (#3, §5.3); pre-migration `pg_dump` to R2, read back (#4, §5.5); privilege check by catalog, on read-only logins only, on every gate and production apply, with `PUBLIC`-execute default revoked (#5, #6, §5.10); a lease lock in staging instead of a GitHub concurrency group (#8, §5.5); migration PRs limited to an allowlist of paths (#9, §5.5); local `vite dev` proof and private evidence for criterion 8 (#10, §1). Codex confirmed the baseline approach and the AGENTS.md wording change. |
| 3 | Completeness pass: Fable subagent, fresh context, read-only, on rev 3 (`af63ed3`); fitness and executability, a different question from Codex's. Fable is an Anthropic model, so this gives a fresh context, not model diversity | REWORK, 19 findings | Second consecutive round whose findings traced mainly to the previous round's fixes, all in §5.5, so I stopped and offered three options. David chose option 1: pre-merge gate on a throwaway stack in the runner, staging written only from `main` (§5.3, §5.5). That removed #1 (lease lock in the reset schema) and #4 (reset against Storage, queue and seed statements), along with round 2's #3 and #8. The rest were applied in rev 4 (`edb25d6`); those concerning the gate now live in Spec 2b's starting design. Applied to what remains here: hand-deployed staging Edge Functions (#7, §5.4); bypass secret (#6, §5.3, §5.10); Storage backup credential as open decision 4 (#11, §8); rollout order (#14, §5.11); success-criterion definitions (#16, §1); `op run --env-file`, pre-created maintainer accounts (#17); same-named roles and `BYPASSRLS` for refresh (#8, §5.10). New success criterion 9 (Fable Q1). |
| 4 | Codex CLI, read-only at `edb25d6`, on rev 4, prompt naming where earlier reviewers were wrong | REWORK, 13 findings | Third consecutive round led by the previous round's fixes, again in the gate. I stopped and offered three options; David chose to extract the gate into Spec 2b (E-14). Gate findings #1–#4, #6–#9 and the default-privilege note stay **open** in Spec 2b §3. Applied here in rev 5: bypass secret valid on every deployment, acknowledged (#5, §5.3, §5.10); staging `PROVISION_SECRET` assigned (#10, §5.10); per-refresh identity rules (#11, §5.3); staging Edge Function SHA recorded and checked (#12, §5.4); CLI targeting described correctly (#13, §3, §5.4); roles created before replay (#7, §5.2, §5.10); `supabase start` workspace holds exactly the baseline and 32 files (#6, §5.2); privilege check widened (#3, §5.10); rollout reordered so the domain precedes previews (#9, §5.11). |
| 5 | Codex CLI, read-only at `501ff28`, on rev 5, gate findings excluded | REWORK, 4 findings, all P2; no safety finding | All applied in rev 6: an exclusive test session that starts and ends with a refresh (#1, §5.5); bootstrap order, baseline accepted on its proof, smoke after the domain (#2, §5.11); `config.toml` counts as an Edge Function deploy input (#3, §5.4); Storage objects owned by a user deleted before the user (#4, §5.3). |
| 6 | Codex CLI, read-only, on the rev 5 → rev 6 diff (`501ff28..d0c682a`) with the full file read, asked whether each fix closes its finding and what the fixes broke | PASS, no findings | Each of the four fixes closes its finding; no new contradiction or unexecutable step. A diff-scoped confirmation, not a full-artifact review; rounds 1–5 were full-artifact. |
