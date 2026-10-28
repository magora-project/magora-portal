# magora-portal Staging, Backups and Secrets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Magora production backups, a staging Supabase project that is rebuilt from the repo and refilled from production's bird data, previews and laptops that reach staging only, 1Password as the source of every secret, and a simulated node, so that nothing done while building can damage or leak production.

**Architecture:** Node `.mjs` scripts (the repo's existing idiom) do all database work through `pg`. One module decides which Supabase project a URL points at, and every script that writes refuses anything but staging's ref. Three `main`-only GitHub workflows (`storage-backup`, `staging-refresh`, `staging-deploy`) hold the new credentials in protected environments. No PR job touches them. Steps that change Supabase, Vercel, Cloudflare, Fly.io, 1Password or GitHub settings are **operator steps**: David performs or approves each one, and the plan says what to read back.

**Tech Stack:** Node 24 ESM, `pg` 8.x and `pg-copy-streams` 7.x (new devDependencies), `@supabase/supabase-js` (already a dependency), Supabase CLI ≥ 2.118, Docker (for `supabase start`), GitHub Actions, Vercel CLI ≥ 58, rclone, 1Password CLI `op`, `flyctl`.

**Spec:** `docs/superpowers/specs/2026-10-28-staging-and-secrets-design.md` (rev 7, approved). Read it before any task. §N below refers to the spec's sections.

## Global Constraints

- **Agents never push, merge, change repo settings, change Supabase/Vercel/Cloudflare/Fly.io/1Password settings, or rotate a secret without David's explicit approval, one approval per action** (§6). Each **operator step** below is one such action.
- **The repo is public.** No spec, plan, issue, PR body, commit message or comment describes a production vulnerability before it is fixed (§6). Task 7's work happens only inside the private advisory.
- Project refs, verbatim: production `wqxmmuwrfltpaxnuddwk`, staging `mujiqtvwtsbaakfcsjkp` (§5.3). Writers fall into three classes, each with its own invariant:
  - **Staging writers:** the refresh, the Edge Function deploy, `apply-migrations.mjs --file`, and the simulated node. Every database URL, Supabase API URL and site origin is validated against staging **before the first side effect**, and nothing turns that off (§5.3, §5.6). They get Supabase clients only from `scripts/staging/clients.mjs`, which validates first.
  - **Local fixtures:** itests and the baseline proof. They accept only `localhost`/`127.0.0.1` on the ports the test's own stack printed.
  - **Operator setup:** `scripts/db/apply-setup.mjs` only (Task 13). It writes a fixed table of (file, target) pairs, only from a TTY after the operator types the ref back, never from a workflow. No staging writer imports it, and it imports no staging writer.
- Secrets: agents use `op run` and `op inject` only, never `op read`, `op item get` or anything that prints a value (§5.8). Scripts never log a connection string, key or token. They log the project ref only.
- Local env files hold `op://` references only (§5.4). No secret values on disk.
- macOS and Windows: every script a maintainer runs works on both (§6). The workflows run on `ubuntu-latest`.
- GitHub-hosted runners have no IPv6, so CI connects to Supabase Postgres through the shared pooler (Supavisor, session mode, port 5432). The username there is `<role>.<project-ref>` (Supabase "Connecting to Postgres" docs).
- Depth labels: every PR in this plan that touches `supabase/migrations/`, an `api/` auth path or a control file is `subtle-correctness` (§6, AGENTS.md). The new workflows, `package.json` and `AGENTS.md` are control files.
- Every Action is pinned by full SHA with its tag in a comment, and uses the pins already in `.github/workflows/ci.yml`: `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1`, `actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0`. Any other Action is pinned at the time it is added.
- Jobs that hold an environment secret check out `main` only and run no PR code. Their environments allow deployments from `main` only (§5.10).
- Tests follow the repo's style: a `*.test.mjs` file with a local `ok(name, cond)` counter, exiting non-zero on any failure, found by `npm test`. Tests that need a running database are `*.itest.mjs`, run by the new `npm run test:db` against a local `supabase start` stack. `npm test` never finds them.
- `npm run lint:ratchet` stays green. New files add no ESLint findings.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; PR bodies end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

## Verified before planning (2026-10-28)

These facts were read while planning. Each one settles an item the spec told the plan to check. Re-measure before relying on one in a later week.

| Spec item | Finding | Source |
|---|---|---|
| §8 #4: read-only Storage key | **None exists.** "S3 access keys provide full access to all S3 operations across all buckets and bypass RLS policies." Decision 4 stands: the backup job uses the full S3 keys. | supabase.com/docs/guides/storage/s3/authentication |
| §5.1: write-only R2 credential | **Cloudflare R2 has no write-only token.** The token levels are Admin Read & Write, Admin Read only, Object Read & Write and Object Read only. R2 does have **bucket locks**, which stop deletion and overwrite for a set period. See Decision R2 below. | developers.cloudflare.com/r2/api/tokens, …/r2/buckets/bucket-locks |
| §5.1: backup download | Pro keeps 7 days of daily backups. A dashboard download is not documented, so the rehearsal uses `pg_dump` (the spec's fallback). | supabase.com/docs/guides/platform/backups |
| §5.10: `BYPASSRLS` for a custom role | **Unconfirmed.** A 2022 Supabase notice lists `bypassrls` among attributes "that can't be changed", then says `postgres` will get privileges to manage it. Task 13 tests it on staging. | supabase.com/changelog/9314-security-patch-notice |
| §5.9: custom environment, targeted deploy | Pro includes one custom environment per project. Branch tracking is optional, a domain can be attached, and `vercel deploy --target=staging` deploys the local checkout. Whether Standard Protection covers a custom-environment domain is **not documented**, so Task 21 reads it back. | vercel.com/docs/deployments/environments, …/deployment-protection |
| §5.3: bypass secret | Header `x-vercel-protection-bypass`. One secret bypasses protection "on all deployments in a project". | vercel.com/docs/…/protection-bypass-automation |
| §5.4: `functions deploy --project-ref` | The flag exists, but the docs do not say it overrides a linked project. Task 14 therefore deploys from a temporary directory that has **no link at all**. | supabase.com/docs/reference/cli/supabase-functions-deploy |
| §5.6: node contract | Read from `magora-acoustic-biodiversity` `origin/release` @ `5a6cd4f` (2026-08-04). `firmware/detect.py` is byte-identical on `main`. The Pi signs in by password, reads its own `nodes.species_whitelist` with the **anon** key, and inserts `detections` and `aci_logs` with its JWT. It does **not** call `provision-node`, any `/api` route, any RPC or Storage. Registration is the portal wizard's call: `api/register-node.js` → `provision-node` with header `x-provision-secret`. Task 1 records the full inventory. | `firmware/detect.py:32-140,289-322`; `supabase/functions/provision-node/index.ts:21-118` |
| §5.7: worker target | It is configured by environment, not hard-coded: `inference_worker.py:25-26` reads `os.environ["SUPABASE_URL"]` and `["SUPABASE_SERVICE_ROLE_KEY"]`. `fly.toml` holds no Supabase value. **No change to the other repo is needed.** | `worker/inference_worker.py`, `worker/fly.toml` |
| §5.8: do nodes hold the service-role key? | No. Nodes hold the anon key and their own password only. | `firmware/detect.py:33-36` |

### Decision R2 (decided by David, 2026-10-28: option 1)

David also accepted Task 15b's exception (2026-10-28), and chose the full endpoint fixtures for the exposure check (Task 22b).

The spec asks for a "write-only R2 credential" (§5.1, §5.10). Cloudflare offers no such token. Options:

1. **Recommended:** an Object Read & Write token scoped to the one backup bucket, plus a **bucket lock** on the `nightly/` prefix with 8-day retention, plus a 14-day lifecycle delete. The token can then add objects but cannot delete or overwrite anything younger than 8 days. That keeps what write-only was meant to protect, which is the last 7 days of backups. Each night is copied to `nightly/<YYYY-MM-DD>/`. Objects that are unchanged since the previous night are copied server-side inside R2 (`rclone --copy-dest`), so Supabase is not downloaded in full every night.
2. An Object Read & Write token with no lock. A leaked token could delete every backup.
3. Drop R2 and keep database-only backups. This reverses E-13.

Task 4 implements option 1.

## Review Focus

These are inputs the spec implies but its own tests would not meet, most likely to bite first. Each line names the task whose test pins it.

1. **A database URL through the Supavisor pooler.** There the project ref sits in the username (`postgres.wqxmmuwrfltpaxnuddwk@aws-0-us-west-1.pooler.supabase.com`), not the host. A guard that reads only the host would let a production URL through. Expected: the ref is read from the username or the host, a URL with no readable ref is refused, and a URL whose two places disagree is refused. Pinned in Task 2.
2. **A copied table that gains a column referencing `auth.users`.** A later migration adds, say, `pulses.created_by`, and real user IDs leak into staging. Expected: the refresh refuses to copy any *copied* table that has a foreign key to `auth.users` or a column named `*user_id`/`owner_id`, until the manifest marks it *transformed*. Pinned in Task 15.
3. **More auth users than one page of the admin API** (default 50 per page). The refresh would delete only the first page and leave preview-created users behind. Expected: it paginates to the end, then re-lists and asserts that only the kept users remain. Pinned in Task 17.
4. **Copied text containing tabs, newlines or backslashes** (species names, narratives, report JSON). Expected: a byte-identical round trip, including through the `nodes` owner remap, which edits a COPY text-format line. Pinned in Task 18.
5. **A maintainer on Windows.** On Windows, `spawn('supabase')` finds no `supabase.exe` without a shell, and a `.cmd` shim cannot run without one. `op run --env-file` paths use backslashes, and a CRLF env file can leave `\r` on a value. Expected:
   - The deploy script resolves a native `supabase.exe` (the Scoop install provides one) and never uses a shell. It refuses a `.cmd`-only install with a message naming the supported install.
   - Secrets are set through the Management API, not argv.
   - The env-reference check and dev proxy behave the same on both systems.

   Pinned in Task 14 (`resolveExecutable`, `setFunctionSecrets`), Task 6 (CRLF env file) and the Windows leg of `ci.yml`, which already runs `npm test`.

---

## File map

| File | Task | Responsibility |
|---|---|---|
| `docs/staging/node-contract.md` | 1 | What a node does, from the `release` branch |
| `scripts/lib/targets.mjs` (+ `.test.mjs`) | 2 | Project-ref parsing; `assertStaging` |
| `.github/workflows/storage-backup.yml`, `docs/runbooks/storage-backup.md` | 4 | Nightly Storage → R2 |
| `docs/runbooks/restore.md` | 5 | Restore rehearsal procedure and its record |
| `docs/runbooks/secrets-inventory.md`, `scripts/secrets/inventory-check.mjs` (+ test), `env/staging.env`, `scripts/secrets/env-refs.test.mjs` | 6 | 1Password inventory and its checks; local env references |
| `AGENTS.md` | 6, 26 | `op` rule; "to production" wording |
| `scripts/db/pg.mjs`, `scripts/db/apply-migrations.mjs` (+ test) | 8 | Connections; applying SQL files in order |
| `supabase/setup/roles.sql` | 9 | The refresh login, the same name in every database |
| `scripts/db/schema-snapshot.mjs` (+ test, + itest), `supabase/migrations/checks/schema-allowlist.txt` | 10 | Catalog snapshot, diff, allowlist |
| `scripts/db/privilege-check.mjs` (+ test, + itest), `supabase/migrations/checks/refresh-execute-allowlist.txt` | 11 | Success criterion 7 |
| `scripts/db/apply-setup.mjs` (+ test) | 13 | Operator setup: the only script that writes production or scratch |
| `supabase/migrations/20261029_refresh_login_grants.sql` (+ rollback) | 15b | The refresh login's grants |
| `scripts/staging/clients.mjs` | 2 | Guarded Supabase clients; `validateTargets` |
| `scripts/staging/lease.mjs` (+ test) | 20 | Staging lease admission, claim, release |
| `supabase/setup/rehearsal-fixture.sql`, `env/maintainer.env` | 26, 14 | Rehearsal source fixture; personal Supabase token reference |
| `supabase/staging/exposure-manifest.json`, `scripts/staging/exposure/*.mjs` (+ test, + itest) | 22b | Exposure check: every anon endpoint classified and checked |
| `supabase/migrations/20260625_baseline_prehistory.sql`, `supabase/migrations/rollbacks/20260625_baseline_prehistory.rollback.sql`, `scripts/db/baseline-proof.mjs`, `scripts/db/baseline-secrets.test.mjs` | 12 | The reconstructed baseline and its proof |
| `supabase/setup/staging-ops.sql`, `supabase/setup/public-schema-defaults.sql` | 13, 16 | Staging-only `ops` schema; `public` default grants |
| `scripts/staging/deploy-functions.mjs` (+ test) | 14 | Edge Functions to staging; record the SHA |
| `supabase/staging/table-manifest.json`, `scripts/staging/manifest.mjs` (+ test) | 15 | Table classification and the user-column guard |
| `scripts/staging/refresh/{index,reset,identities,copy,synthetic,integrity,smoke}.mjs` (+ tests, + itest) | 16–18, 22 | The refresh |
| `scripts/staging/simulated-node.mjs` (+ test) | 19 | The node contract against staging |
| `.github/workflows/staging-refresh.yml` | 20 | Nightly and on-demand refresh |
| `.github/workflows/staging-deploy.yml` | 21 | `main` → the Vercel `staging` environment |
| `scripts/dev/proxy-config.mjs` (+ test), `vite.config.js` | 23 | Dev proxy → staging with the bypass header |
| `package.json` | 6, 8, 23 | Dependencies; `test:db`, `dev` scripts |
| `docs/runbooks/staging.md` | 13, 14, 20, 24 | Setting up and operating staging |
| `docs/runbooks/interim-migrations.md` | 26 | §5.5 |

## PRs

| PR | Tasks | Label |
|---|---|---|
| A: node contract, target guard, secrets inventory, `op` rule | 1, 2, 6 | `subtle-correctness` (AGENTS.md, `package.json`) |
| B: storage backup and restore runbook | 4, 5 | `subtle-correctness` (workflow) |
| C: database tooling and baseline | 8–12 | `subtle-correctness` (migration) |
| D: staging setup, grants migration, refresh, simulated node | 13–15b, 16–20 | `subtle-correctness` (migration, workflow) |
| E: staging deploy, smoke, exposure check | 21, 22, 22b | `subtle-correctness` (workflow) |
| F: previews and local dev | 23 | `subtle-correctness` (`package.json`, `vite.config.js`) |
| G: interim migration runbook | 26 | `subtle-correctness` (AGENTS.md) |

Tasks 3, 7, 24 and 25 are operator work and open no PR in this repo. Task 7's fixes go through the advisory's private fork.

---

## Phase 1: Rollout step 1 (backups), with 1Password and the private fixes in parallel

### Task 1: Node contract inventory

**Files:**
- Create: `docs/staging/node-contract.md`

**Interfaces:**
- Produces: the list of calls Task 19 implements, one row per call. Each row gives the method, the path, the auth (`anon`, `node-jwt` or `provision-secret`), the table or function, the payload fields, and the source `file:line` at a named SHA.

- [ ] **Step 1: Re-read the source at a pinned SHA.** Run `git -C ../magora-acoustic-biodiversity log -1 --format='%H %cI' origin/release` and record the SHA. If it is no longer `5a6cd4f133ebd86c74a9b4f953a7b85e241f3640`, diff `firmware/detect.py` between the two SHAs and update the rows to match.
- [ ] **Step 2: Write the doc** with these rows:
  - `POST /auth/v1/token?grant_type=password` (anon apikey; body `email`, `password`)
  - `GET /rest/v1/nodes?id=eq.<id>&select=species_whitelist` (**anon** key as bearer)
  - `POST /rest/v1/detections` (node JWT; fields `node_id, species_name, raw_label, confidence, detected_at, location, is_dawn_chorus, minutes_from_sunrise, dawn_chorus_window, phenological_week, season`; `Prefer: return=minimal`)
  - `POST /rest/v1/aci_logs` (node JWT; fields `node_id, recorded_at, aci_score, time_category, dawn_chorus, duration_secs`)
  - the re-sign-in on 401
  - registration through the portal: `POST /functions/v1/provision-node`, header `x-provision-secret`, body `name, hardware_type, lat, lon, elevation_m, elevation_unit, habitat_type, species_whitelist, owner_id`, which returns `{node_id, email, password}`.

  Add a "Not in the contract" list: no Storage, no RPC, no `/api`, no heartbeat, no location write. Add a "Known gap" line: `detect.py:32` hard-codes production's URL, which keeps real Pis out of scope (§2).
- [ ] **Step 3: Commit.**

```bash
git add docs/staging/node-contract.md
git commit -m "docs(staging): node contract inventory from magora-acoustic-biodiversity release"
```

### Task 2: Project-ref guard

**Files:**
- Create: `scripts/lib/targets.mjs`, `scripts/lib/targets.test.mjs`

**Interfaces:**
- Produces:
  - `PRODUCTION_REF = 'wqxmmuwrfltpaxnuddwk'`, `STAGING_REF = 'mujiqtvwtsbaakfcsjkp'`
  - `refFromSupabaseUrl(url: string) -> string | null`: `https://<ref>.supabase.co` → `<ref>`
  - `refFromDbUrl(url: string) -> string | null`: reads the ref from the username (`<role>.<ref>`) or the host (`db.<ref>.supabase.co`). If both are present and differ it throws `Error('ambiguous project ref')`.
  - `assertStaging(url: string, kind: 'db' | 'api') -> void`: throws unless the ref is exactly `STAGING_REF`. The error message names the ref it found, never the URL.
  - `STAGING_SITE_ORIGIN = 'https://staging.themagoraportal.org'` and `assertStagingSite(url) -> void`: throws unless `new URL(url).origin` equals it exactly.
- Also creates `scripts/staging/clients.mjs`, with tests in the same file's test:
  - `stagingAdmin({url, serviceRoleKey, fetch?}) -> SupabaseClient`: calls `assertStaging(url, 'api')`, then `createClient`.
  - `localAdmin({url, serviceRoleKey, allowedPorts})`: for itests.
  - `validateTargets(env) -> void`: asserts every staging-side variable the refresh will use (`STAGING_DB_URL`, `STAGING_SUPABASE_URL`, and the site origin) before anything else runs.

- [ ] **Step 1: Write the failing test**

```js
ok('api: staging ref', refFromSupabaseUrl('https://mujiqtvwtsbaakfcsjkp.supabase.co') === STAGING_REF)
ok('db: pooler username carries the ref',
  refFromDbUrl('postgresql://postgres.wqxmmuwrfltpaxnuddwk:pw@aws-0-us-west-1.pooler.supabase.com:5432/postgres') === PRODUCTION_REF)
ok('db: direct host carries the ref', refFromDbUrl('postgresql://postgres:pw@db.mujiqtvwtsbaakfcsjkp.supabase.co:5432/postgres') === STAGING_REF)
ok('db: username and host disagree -> throws', throws(() => refFromDbUrl('postgresql://postgres.mujiqtvwtsbaakfcsjkp:pw@db.wqxmmuwrfltpaxnuddwk.supabase.co/postgres')))
ok('assertStaging refuses production (pooler form)', throws(() => assertStaging('postgresql://postgres.wqxmmuwrfltpaxnuddwk:pw@aws-0-us-west-1.pooler.supabase.com:5432/postgres', 'db')))
ok('assertStaging refuses a URL with no ref', throws(() => assertStaging('postgresql://postgres:pw@localhost:54322/postgres', 'db')))
ok('assertStaging refuses a lookalike ref', throws(() => assertStaging('https://mujiqtvwtsbaakfcsjkpx.supabase.co', 'api')))
ok('error message never contains the password', messageOf(() => assertStaging('postgresql://postgres.wqxmmuwrfltpaxnuddwk:s3cret@h/postgres', 'db')).includes('s3cret') === false)
ok('assertStaging accepts staging', !throws(() => assertStaging('https://mujiqtvwtsbaakfcsjkp.supabase.co', 'api')))
ok('site: lookalike origin refused', throws(() => assertStagingSite('https://staging.themagoraportal.org.evil.example/')))
ok('stagingAdmin with production URL makes zero requests', (() => {
  const calls = []; const f = (...a) => { calls.push(a); return Promise.resolve(new Response('{}')) }
  return throws(() => stagingAdmin({ url: 'https://wqxmmuwrfltpaxnuddwk.supabase.co', serviceRoleKey: 'x', fetch: f })) && calls.length === 0
})())
```

- [ ] **Step 2: Run `node scripts/lib/targets.test.mjs`.** Expected: FAIL (module not found).
- [ ] **Step 3: Implement** with `new URL()`. A ref is exactly 20 lowercase letters, matched whole.
- [ ] **Step 4: Run it again.** Expected: every case passes and the exit code is 0.
- [ ] **Step 5: Commit** (`feat(staging): project-ref guard for every staging writer`).

### Task 3 (operator): Production on Pro, daily backups visible

- [ ] **Step 1 (David):** upgrade the organization that owns `wqxmmuwrfltpaxnuddwk` to Pro.
- [ ] **Step 2 (David, the next day):** Database → Backups lists at least one daily backup. Record the date and the time it was read in `docs/runbooks/restore.md` (Task 5).

### Task 4: Nightly Storage backup to R2

Implements Decision R2, option 1.

**Files:**
- Create: `.github/workflows/storage-backup.yml`, `docs/runbooks/storage-backup.md`

**Interfaces:**
- Consumes: the GitHub environment `backup` (`main` only, no required reviewer, decision 4), which holds `SUPABASE_S3_ACCESS_KEY_ID`, `SUPABASE_S3_SECRET_ACCESS_KEY`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID` and `R2_BUCKET`. The Supabase S3 endpoint is `https://wqxmmuwrfltpaxnuddwk.supabase.co/storage/v1/s3`, region per the dashboard.

- [ ] **Step 1 (operator, David):**
  - Create the R2 bucket `magora-storage-backup`.
  - Add a bucket lock rule on prefix `nightly/` with 8-day retention, and a lifecycle rule that deletes `nightly/` objects after 14 days.
  - Create an Object Read & Write token scoped to that bucket.
  - Create the Supabase S3 access keys.
  - Enter all of them in the "Magora Project" vault first, then copy them into the `backup` environment. Set the environment's deployment branches to `main` only.
  - Read back: `gh api repos/{owner}/{repo}/environments/backup` shows the branch policy, and `gh secret list --env backup` shows the six names.
- [ ] **Step 2: Write the workflow.**
  - Triggers: `schedule: '30 7 * * *'` and `workflow_dispatch`.
  - `permissions: contents: read`; `environment: backup`; `concurrency: {group: storage-backup, cancel-in-progress: false}`.
  - A first step fails unless `github.ref == 'refs/heads/main'`. Checkout is not needed.
  - Install rclone from the Ubuntu package (pinned version printed).
  - Configure both remotes through `RCLONE_CONFIG_*` environment variables, never a config file written with values.
  - For each bucket that `rclone lsd supabase:` lists, run `rclone copy supabase:<bucket> r2:$R2_BUCKET/nightly/$(date -u +%F)/<bucket> --copy-dest r2:$R2_BUCKET/nightly/<previous date>/<bucket> --checksum`. Take the previous date from the newest existing `nightly/` prefix. On the first night there is none, so omit `--copy-dest`.
  - Finish with `rclone check` between source and destination for each bucket. A failure fails the job.
- [ ] **Step 3: Test before merge.** `actionlint` is clean. Read the YAML to confirm there is no `pull_request` trigger, `persist-credentials` is not used, and no `${{ secrets.* }}` appears in a `run:` line (secrets reach steps through `env:` only).
- [ ] **Step 4: Runbook.** Write `docs/runbooks/storage-backup.md`: what the job copies, where it goes, the retention and the lock. Restoring an object uses a remote named `restore-target`, never the backup job's `supabase` remote. Its endpoint is written out in full in the command (`https://<ref>.supabase.co/storage/v1/s3`), and the runbook has the operator read the ref aloud and match it against the scratch project before running anything. The rehearsal (Task 5) targets the scratch ref. A real restore into production is a separate section that starts with "David approves this restore", and its command is otherwise identical.
- [ ] **Step 5: Commit.** After merge, the first run is an operator step: David triggers `workflow_dispatch` and reads the job's `rclone check` output.

### Task 5: Restore rehearsal

**Files:**
- Create: `docs/runbooks/restore.md`

- [ ] **Step 1: Write the runbook.** It covers:
  1. Create a scratch project `magora-restore-scratch` in the same org.
  2. `pg_dump --format=custom --no-owner --no-privileges` of production through the pooler, with `op run`. `pg_dump` must be 17, matching the server major.
  3. `pg_restore` into the scratch project.
  4. Row counts of the core tables (`nodes, detections, aci_logs, species, node_habitat`) on both sides, taken the same hour. Equality is expected, give or take rows production wrote in between, and any difference is recorded.
  5. Restore 20 objects from R2 `nightly/<latest>/` into the scratch project's matching buckets. For each, the `storage.objects` row (restored with the dump) resolves to a downloadable object.
  6. Delete the scratch project.
  7. A "Rehearsals" table with date, who, the counts and the result.
- [ ] **Step 2 (operator, David with an agent beside him):** run it once and fill in the table. This is success criterion 1.
- [ ] **Step 3: Commit.**

### Task 6: 1Password inventory, env references, the `op` rule

**Files:**
- Create: `docs/runbooks/secrets-inventory.md`, `scripts/secrets/inventory-check.mjs`, `scripts/secrets/inventory-check.test.mjs`, `env/staging.env`, `scripts/secrets/env-refs.test.mjs`
- Modify: `AGENTS.md` (add the `op` rule under a new `## Secrets` heading)

**Interfaces:**
- Produces:
  - The inventory doc's table, with columns `Name | Environment (production/staging) | 1Password reference | Copies | Injected?`. "Copies" is a `;`-separated list drawn from `vercel:production`, `vercel:preview`, `vercel:staging`, `github:<env>`, `fly:<app>` and `supabase-fn:<ref>`.
  - `parseInventory(markdown) -> Row[]`
  - `compareNames(rows, listings: {store: string, names: string[]}[]) -> string[]`: problems, both a name missing from a store and a name in a store with no inventory row.
  - `listStoreNames(store) -> string[]`: shells out to the CLIs below and keeps names only.

- [ ] **Step 1: Write the failing tests.**
  - In `inventory-check.test.mjs`: a row whose Copies include `vercel:preview`, with `vercel:preview` lacking the name → one problem naming both. An extra name in `github:staging-sync` → one problem. Injected rows (`SUPABASE_URL` in `supabase-fn:*`) are not expected in any listing.
  - In `env-refs.test.mjs`, against `env/staging.env`: every non-comment line matches `^[A-Z][A-Z0-9_]*=op://Magora Staging/[^/]+/[A-Z][A-Z0-9_]*$`. No line references `Magora Project`. A CRLF copy of the file parses to the same values with no `\r`. The file contains the names `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VERCEL_AUTOMATION_BYPASS_SECRET`.
- [ ] **Step 2: Run both.** Expected: FAIL.
- [ ] **Step 3: Implement.** `listStoreNames` uses these commands, parses JSON, and keeps only the name field:
  - `gh secret list --env <env> --json name`
  - `fly secrets list -a <app> --json`
  - `supabase secrets list --project-ref <ref> -o json`
  - `vercel env ls <target> --format json`. If this CLI version has no JSON output, parse the NAME column of the table output.

  It never prints the raw output. The Supabase listing includes value digests, so drop that field before anything is logged.
- [ ] **Step 4: Run both.** Expected: PASS.
- [ ] **Step 5: AGENTS.md.** Add under `## Secrets`: "Agents use `op run` and `op inject` only, never `op read`, `op item get` or anything else that prints a secret value. Local env files hold `op://` references only (`env/*.env`); run commands through `op run --env-file=env/staging.env -- <cmd>`."
- [ ] **Step 6 (operator, David and Noah):**
  - Create the "Magora Staging" vault. Enter every production value into "Magora Project", one item per service, with fields named after the env var.
  - Fill in the inventory doc's rows.
  - Run `op run --env-file=env/staging.env -- node -e "process.exit(process.env.VITE_SUPABASE_URL ? 0 : 1)"` on macOS (David) and Windows (Noah). Record each exit code, never a value. This is criterion 4's second half. The staging items exist from Task 13 onward, so this sub-step can wait for it.
- [ ] **Step 7:** Run `node scripts/secrets/inventory-check.mjs` with `op` signed in and the four CLIs logged in. Expected: `0 problems`. This is criterion 4's first half. It is re-run after Tasks 20, 21, 23 and 25, because each adds names.
- [ ] **Step 8: Commit** (PR A).

### Task 7 (operator, private): Close the write paths behind criterion 8

- [ ] **Step 1 (David's approval):** file a private security advisory per `SECURITY.md` that lists every production write path reachable without a production credential, as of 2026-10-28. The handoff note for this session names where to start. Nothing about the paths goes in this repo's public files.
- [ ] **Step 2:** fix each path in the advisory's temporary private fork, with a test, reviewed per AGENTS.md (`subtle-correctness`).
- [ ] **Step 3:** after the fixes merge and deploy, record in the advisory, for each path, an unauthenticated request and its response showing production unchanged. Criterion 8 is met when every entry has that evidence.
- [ ] **Ordering constraint:** Task 12's baseline makes production's pre-history schema public. Before the baseline PR is opened, read the baseline for any object that discloses an unfixed advisory entry. If one does, that fix merges first.

---

## Phase 2: Rollout step 2 (baseline)

### Task 8: Connections and ordered apply

**Files:**
- Create: `scripts/db/pg.mjs`, `scripts/db/apply-migrations.mjs`, `scripts/db/apply-migrations.test.mjs`
- Modify: `package.json` (devDependencies `pg@^8.23`, `pg-copy-streams@^7.0`; script `"test:db": "node scripts/run-tests.mjs --pattern itest"`, or a small `scripts/db/run-itests.mjs` if `run-tests.mjs` cannot take a pattern without changing its control-file contract. Prefer the separate runner.)

**Interfaces:**
- Produces:
  - `connect(envName: string, {readOnly?: boolean, writeTarget?: 'staging' | 'local'}) -> Promise<pg.Client>`. It reads the URL from `process.env[envName]`. With `writeTarget: 'staging'` it calls `assertStaging` first. With `writeTarget: 'local'` it accepts only `localhost`/`127.0.0.1`. With `readOnly` it runs `SET default_transaction_read_only = on`. A connection error is rethrown as `Error('connect failed: <ref or "local">: <pg error code>')`, with no URL.
  - `listMigrationFiles(dir) -> string[]`: top-level `*.sql`, byte-order sorted, `rollbacks/` and `checks/` excluded.
  - `applyFiles(client, paths, {onEach?}) -> Promise<void>`: each file in its own transaction. It stops at the first error and reports the file name and the Postgres error position.

- [ ] **Step 1: Write the failing test.** `listMigrationFiles` on a temp tree containing `20260625_baseline_prehistory.sql`, `20260626_a.sql`, `rollbacks/20260626_a.rollback.sql`, `checks/schema-allowlist.txt` and `README.md` returns exactly the two `.sql` files, baseline first.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run it.** Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 9: The refresh login role

**Files:**
- Create: `supabase/setup/roles.sql`

**Interfaces:**
- Produces: role `magora_refresh`, created by `postgres` as `LOGIN NOINHERIT BYPASSRLS` with no password. The password is set per database by an operator through `op run`, never in a file. The script is idempotent (`DO $$ … IF NOT EXISTS … $$`) and runs `ALTER ROLE magora_refresh SET default_transaction_read_only = on`.
  - It grants nothing on tables, so applying it changes no table ACL, and the baseline proof (Task 12) still matches a production snapshot taken before the role existed.
  - Read access arrives in Task 15b's grants migration.
  - Privileges the role holds only through `PUBLIC` (the default `EXECUTE` on functions, `USAGE` and `CREATE` on schemas, `CONNECT` and `TEMP` on the database) cannot be revoked from one role. Task 11 inventories them, and each is either allowlisted with its reason or, if it lets this login write, reported privately per `SECURITY.md`.

- [ ] **Step 1: Write the file.**
- [ ] **Step 2: Apply it to a fresh `supabase start` stack, then run the privilege check (Task 11).** Expected: it passes once Task 11 exists. Until then, `\du magora_refresh` shows `Bypass RLS` and no other attribute besides login.
- [ ] **Step 3: If the local stack refuses `BYPASSRLS`,** stop and record the error. Task 13 Step 2 decides the alternative with David.
- [ ] **Step 4: Commit.**

### Task 10: Schema snapshot, diff, allowlist

**Files:**
- Create: `scripts/db/schema-snapshot.mjs`, `scripts/db/schema-snapshot.test.mjs`, `scripts/db/schema-snapshot.itest.mjs`, `supabase/migrations/checks/schema-allowlist.txt`

The snapshot reads catalogs only, so the refresh login (which holds `SELECT` on copied tables only) can take one. That is why the plan writes its own tool instead of using `pg_dump --schema-only`: `pg_dump` locks every table it dumps and so needs `SELECT` on each one.

**Interfaces:**
- Produces:
  - `snapshotSchema(client) -> Promise<Snapshot>`, where `Snapshot` is `Record<string, string>`, keyed `<kind>:<qualified name>` and valued by a canonical definition. It covers:
    - in `public`, for tables:
      - every table column (`attnum` order, type, default, not-null, identity) and column ACL (`attacl`)
      - constraint (`pg_get_constraintdef`), index (`pg_get_indexdef`), view (`pg_get_viewdef`), trigger (`pg_get_triggerdef`), policy (the `pg_policies` row)
      - sequence, enum and composite type
      - table ACL (`relacl`, grantees sorted), owner, `relrowsecurity`, `relforcerowsecurity`
    - in `public`, for functions: `pg_get_functiondef`, `proacl`, owner, `prosecdef`, and `proconfig` (search_path)
    - in `public`, for the schema itself: its ACL and owner, and its default privileges (`pg_default_acl`)
    - triggers on `auth.users`
    - policies on `storage.objects`
    - publication membership (`pg_publication_tables`)
    - `pgmq` queues, read as the catalog presence of the `pgmq.q_<name>` table, so no data read is needed
    - installed extensions (name and schema; version is a separate key)
    - rows of `storage.buckets` (`id, public, file_size_limit, allowed_mime_types`). This is the one item that is data, not catalog: it needs `SELECT` on `storage.buckets`, granted in Task 15b's grants migration. If `postgres` cannot grant that (the table is owned by `supabase_storage_admin`), the snapshot records `buckets:unreadable`, and that key is allowlisted with that reason, after David agrees.
  - `diffSnapshots(a, b) -> {key: string, a?: string, b?: string}[]`
  - `parseAllowlist(text) -> {keys: Set<string>, errors: string[]}`. Each line is `<key>  # <reason>`. A line without a reason is an error, and **a key whose qualified name is in schema `public` is an error** (criterion 9).
  - CLI: `node scripts/db/schema-snapshot.mjs snapshot --db-url-env NAME --out FILE` and `… compare A.json B.json --allowlist supabase/migrations/checks/schema-allowlist.txt`. Compare exits 0 only with no difference outside the allowlist. It prints keys, and prints definitions only for objects in `public`, `storage` and `auth`.

- [ ] **Step 1: Write the failing unit test.**
  - Two snapshots that differ in one policy → one diff naming the key.
  - Grantee order in ACLs does not create a diff.
  - `parseAllowlist('table:public.x  # because\n')` returns an error mentioning `public`.
  - A line with no `#` reason → error.
  - An allowlisted key is removed from the diff.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement** the pure functions, then the catalog queries.
- [ ] **Step 4: Run the unit test.** Expected: PASS.
- [ ] **Step 5: Write the itest, which sabotages each property.** On a local stack with `roles.sql` applied, connected as `postgres`, take a snapshot. (Task 15b proves that a snapshot taken as `magora_refresh` equals one taken as `postgres`, once the grants exist.) Then make one change at a time, snapshot again, assert that the diff is exactly the expected key, and undo the change:
  - add a policy
  - `GRANT UPDATE (col)` to `anon`
  - `ALTER FUNCTION … SECURITY DEFINER`
  - `ALTER FUNCTION … SET search_path = public`
  - `ALTER FUNCTION … OWNER TO` another role
  - `ALTER TABLE … FORCE ROW LEVEL SECURITY`
  - `GRANT CREATE ON SCHEMA public TO anon`
  - `ALTER DEFAULT PRIVILEGES … GRANT SELECT ON TABLES TO anon`
  - add a table to `supabase_realtime`
  - add a trigger on `auth.users`

  After each undo, the diff is empty.
- [ ] **Step 6: Run `npm run test:db`.** Expected: PASS.
- [ ] **Step 7: Commit.**

### Task 11: Privilege check (criterion 7)

**Files:**
- Create: `scripts/db/privilege-check.mjs`, `scripts/db/privilege-check.test.mjs`, `scripts/db/privilege-check.itest.mjs`

**Interfaces:**
- Produces:
  - `collectPrivileges(client) -> Promise<Facts>`, run while connected **as `magora_refresh`**.
  - `judge(facts, {executeAllowlist: string[], copiedTables: string[]}) -> string[]`: the violations.
  - `positiveCheck(client, copiedTables, expectedCounts) -> string[]`
  - CLI: `--db-url-env NAME [--counts FILE]`. It exits non-zero on any violation.

  Facts come from `has_table_privilege`, `has_column_privilege`, `has_sequence_privilege`, `has_function_privilege`, `has_schema_privilege` and `has_database_privilege`, evaluated for `current_user` across every schema; plus `pg_roles` attributes, `pg_auth_members`, and ownership in `pg_class`, `pg_proc`, `pg_namespace` and `pg_type`.

  `judge` reports, exactly per §5.10:
  - any INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER on any table, at table or column level
  - UPDATE or USAGE on any sequence
  - EXECUTE on any function outside `executeAllowlist`
  - CREATE on any schema or on the database
  - any owned object
  - any role membership
  - any attribute other than `rolcanlogin` and `rolbypassrls`

- [ ] **Step 1: Write the failing unit test.** One case per violation class above, each built as a minimal `Facts` and asserted to produce exactly one violation that names the object. A clean `Facts` gives `[]`.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement.** The `executeAllowlist` lives in `supabase/migrations/checks/refresh-execute-allowlist.txt`, a reviewed file where every line is `<schema>.<function>(<args>)  # <reason>`, or `<schema>.*  # <reason>` for `pg_catalog` and `information_schema` only.
  The allowlist's real contents are derived in Task 15b Step 4, once the full schema and grants exist. Here it holds only the `pg_catalog.*` and `information_schema.*` lines.
- [ ] **Step 4: Run it.** Expected: PASS.
- [ ] **Step 5: Write the itest, which sabotages the check.**
  The fixture is self-contained, so this task does not wait for the baseline:
  - Start a bare local stack, apply `roles.sql`, then run `create table public.t(id int primary key, owner uuid)` and `grant select on public.t to magora_refresh`.
  - Run the check once. Its `EXECUTE` violations on this bare stack (extension functions callable through `PUBLIC`) become the fixture's allowlist. Every further step must add **exactly one** new violation.
  - `GRANT INSERT ON public.t TO magora_refresh`: it fails naming that grant. Revoke it.
  - `GRANT UPDATE (one column) …`: it fails. Revoke it.
  - `GRANT authenticated TO magora_refresh`: it fails on membership. Revoke it.
- [ ] **Step 6: Run `npm run test:db`.** Expected: PASS. Every sabotage is caught.
- [ ] **Step 7: Commit.**

### Task 12: The baseline and its proof

**Files:**
- Create:
  - `supabase/migrations/20260625_baseline_prehistory.sql`
  - `supabase/migrations/rollbacks/20260625_baseline_prehistory.rollback.sql`: a comment-only no-op, which says rolling back the baseline means dropping the database (§5.2)
  - `scripts/db/baseline-proof.mjs`
  - `scripts/db/baseline-secrets.test.mjs`

**Interfaces:**
- Consumes: `listMigrationFiles` and `applyFiles` (Task 8), `snapshotSchema`/`compare` (Task 10), `supabase/setup/roles.sql` (Task 9).
- Produces: `baseline-proof.mjs --prod-snapshot FILE`. It:
  1. makes a temp workspace with `supabase/config.toml` (copied) and an **empty** `supabase/migrations/`
  2. runs `supabase start` there
  3. applies `roles.sql`, then the baseline, then **exactly the 32 files dated up to `20260727`**, via `applyFiles`, with `connect(…, {writeTarget: 'local'})`. Later migrations, the grants migration included, are excluded so the result matches the production snapshot taken in Step 1.
  4. snapshots the result and compares it with `FILE` under the allowlist
  5. runs `supabase stop --no-backup`

  It prints the comparison and exits with its code.

- [ ] **Step 1 (operator, David):** `op run -- node scripts/db/schema-snapshot.mjs snapshot --db-url-env PROD_DB_URL --out "$(mktemp -d)/prod.json"`. Hand the file's path to the agent. It is schema only.
- [ ] **Step 2: Write the failing secrets test.** `baseline-secrets.test.mjs` fails if the baseline contains any of:
  - `eyJ` followed by 20 or more base64url characters (a JWT)
  - `sk-`, `xoxb-` or `hooks.slack.com`
  - `service_role` inside a string literal
  - a production or staging ref inside a URL

  It runs against the real file once it exists. Before that it fails on "file not found". Expected now: FAIL.
- [ ] **Step 3: Derive the baseline** per §5.2.
  - Start from production's schema-only dump: David runs `pg_dump --schema-only --schema=public` through `op run` and hands over the path.
  - Remove every object the 32 migrations create.
  - Restore what they alter or drop to its earlier form. For example, `public.users` and its policies under their 2026-07-25 names, which `20260725` alters and `20260726` drops. Read each migration for what it expects.
  - The baseline grants **nothing** to `magora_refresh`. It must reproduce production's history, and production's history has no such grants. The grants come in Task 15b's grants migration, which sorts after every existing file.
- [ ] **Step 4: Run the proof** with `node scripts/db/baseline-proof.mjs --prod-snapshot <path>`. Iterate on the baseline until it exits 0. The only allowlist lines allowed are Supabase-owned objects, and the parser rejects `public` ones (criterion 9). Expected final output: `0 differences outside allowlist (N allowlisted)`.
- [ ] **Step 5: Run the secrets test.** Expected: PASS.
- [ ] **Step 6: Run `npm run check:migrations`.** Expected: PASS. The baseline has its rollback, and it is not added to the grandfather list.
- [ ] **Step 7: Run the Task 7 ordering check** on the baseline text. Record "no unfixed advisory entry disclosed" privately in the advisory, not in the PR.
- [ ] **Step 8: Commit and open PR C** (`subtle-correctness`). Attach the proof output and the allowlist, each line with its reason. The PR body says production is never given this file (§5.2).

---

## Phase 3: Rollout step 3 (the staging project and its first refresh)

### Task 13 (operator, with scripts): Setup entry point; staging and production setup

**Files:**
- Create:
  - `supabase/setup/staging-ops.sql`
  - `scripts/db/apply-setup.mjs` (+ `.test.mjs`)
  - `docs/runbooks/staging.md` (setup section)

**Interfaces:**
- Produces:
  - Schema `ops` on staging only, holding table `ops.edge_deploys(sha text not null, deployed_at timestamptz not null default now(), deployed_by text not null)`. `anon`, `authenticated` and `service_role` have no privileges on it. No migration creates it (§5.4).
  - `apply-setup.mjs --target staging|production|scratch [--ref <ref>] --file <name>`, the operator-setup class (Global Constraints).
    - **Allowed pairs**, from a fixed table. `--file` is a name in that table, never a path.
      - staging: `roles.sql`, `staging-ops.sql`
      - production: `roles.sql`, `20261029_refresh_login_grants.sql`
      - scratch: `roles.sql`, `rehearsal-fixture.sql`, and each file `listMigrationFiles` returns in the current checkout, the baseline included (Task 26's rehearsal source)
    - **URL variable per target:** `STAGING_DB_URL`, `PROD_SETUP_DB_URL` or `SCRATCH_SETUP_DB_URL`.
    - **Ref checks:** the ref read from the URL must equal the target's ref. For scratch, it must equal `--ref`, which must be neither production's nor staging's.
    - **Before writing,** it prints the ref and the file name, and requires the operator to type the ref back on stdin. It refuses without a TTY.
    - **Before a production write,** it also requires the operator to type the date of the newest daily backup shown in the dashboard (§5.5 step 2).

- [ ] **Step 1: Write the files.** Then write `apply-setup.test.mjs`:
  - (`staging-ops.sql`, production) is refused.
  - A `--file ../x.sql` is refused.
  - A production URL with `--target staging` is refused before connecting.
  - A wrong typed-back ref aborts.
  - Scratch with `--ref` equal to production's or staging's is refused.
  - `staging-ops.sql` on scratch is refused.

  Run it: FAIL, then implement, then PASS. Write the runbook's setup section, listing each operator action below with its read-back. Commit with PR D.
- [ ] **Step 2 (operator, David approves; run through `op run`):** `apply-setup.mjs --target staging --file roles.sql`. If `BYPASSRLS` is refused, stop and bring these options to David (§5.10):
  - (a) a `FOR SELECT TO magora_refresh USING (true)` policy on each copied table, created by a migration
  - (b) Supabase support enabling the attribute
  - (c) a SECURITY DEFINER export function owned by `postgres`, which the privilege check's `executeAllowlist` would then have to name
- [ ] **Step 3 (operator, David approves each of the two production writes):**
  - Run `apply-setup.mjs --target production --file roles.sql`, then `--file 20261029_refresh_login_grants.sql`, from the production vault, after PR D merges. Before the second, David has approved Task 15b's exception and confirmed that day's daily backup.
  - Set the login's password with `op run` from a new "Magora Project" item `supabase-refresh-login`.
  - Run `privilege-check.mjs` as that login against production. Expected: 0 violations. Run the positive part with counts David took as `postgres` the same hour. This is criterion 7. It must pass before Task 20 hands the login to the workflow.
- [ ] **Step 4 (operator):** `apply-setup.mjs --target staging --file staging-ops.sql`. The refresh's rebuild applies the grants migration to staging along with every other migration.
- [ ] **Step 5 (operator, David):** on staging Auth, confirm sign-ups are off, then read back with `curl` to `/auth/v1/signup` using the staging anon key. Expected: a refusal (the response code is recorded). Make Noah a member of the Supabase organization (§5.3).
- [ ] **Step 6: Commit.**

### Task 14: Edge Function deploy to staging

**Files:**
- Create: `scripts/staging/deploy-functions.mjs`, `scripts/staging/deploy-functions.test.mjs`

**Interfaces:**
- Produces:
  - `planDeploy({functionsDir, ref, sha}) -> {cwd: string, commands: string[][]}`. It is pure. `commands` holds one `['supabase','functions','deploy',<name>,'--project-ref',ref]` per directory under `supabase/functions/`. `cwd` is a fresh temp directory into which `supabase/functions/` and `supabase/config.toml` are copied, and **no `supabase/.temp/`**, so no linked project exists.
  - `resolveExecutable(name, {platform, pathEnv, pathExt}) -> string`: searches `PATH`, trying `PATHEXT` extensions on win32. It returns an absolute path or throws.
  - `spawnCli(cmd: string[], cwd) -> number`: spawns the resolved executable with `shell: false` on every platform, so no argument is ever re-parsed by a shell.
  - `resolveExecutable` on win32 accepts only a native `.exe`, and throws on a `.cmd`/`.bat`-only install with a message naming the Scoop install.
  - `setFunctionSecrets(names: string[], ref, {fetch?})`: run as `op run --env-file=env/staging.env --env-file=env/maintainer.env -- …`. `env/maintainer.env` holds exactly one line, `SUPABASE_ACCESS_TOKEN=op://Private/supabase-cli/SUPABASE_ACCESS_TOKEN`, each maintainer's own token. Task 6's env-ref test gains a case: `maintainer.env` has exactly that one name, from the `Private` vault. `staging.env` stays `Magora Staging`-only. If this `op` version rejects two `--env-file` flags, nest two `op run` calls.
    - It calls `assertStaging` on `https://<ref>.supabase.co`, reads each `process.env[name]`, and refuses an empty one.
    - It sends `POST https://api.supabase.com/v1/projects/<ref>/secrets` with JSON body `[{name, value}]`. The value travels only in the HTTPS request body: never argv, never a file, never a parent shell's expansion, so the same command works in zsh and PowerShell.
    - It prints names and the response status only.

    This is the `secrets` subcommand of the same CLI.
  - CLI with two subcommands: `secrets <NAME…>` (calls `setFunctionSecrets`) and `deploy`. Both refuse unless `ref === STAGING_REF`. `deploy` also refuses unless the working tree is clean and `HEAD` is an ancestor of `origin/main` (`git merge-base --is-ancestor`). After every deploy succeeds, it inserts `(sha, deployed_by = os.userInfo().username)` into `ops.edge_deploys` through `connect('STAGING_DB_URL', {writeTarget: 'staging'})`.

- [ ] **Step 1: Write the failing test.**
  - `planDeploy` with the production ref throws.
  - With staging, it returns one command per function directory (`provision-node`, `storage-upload`), each carrying `--project-ref mujiqtvwtsbaakfcsjkp`.
  - `cwd` contains no `.temp` directory.
  - `resolveExecutable('supabase', {platform: 'win32', pathEnv: 'C:\\a;C:\\b', pathExt: '.EXE;.CMD'})` with a fake `existsSync` holding `C:\b\supabase.EXE` returns that path. With only `C:\a\supabase.CMD` present, it throws.
  - `spawnCli`'s options always carry `shell: false`.
  - `setFunctionSecrets(['PROVISION_SECRET'], STAGING_REF, {fetch})`:
    - with the variable unset, it throws and `fetch` was never called
    - with it set, `fetch` was called once, with the value in the body and nowhere in the URL
    - with the production ref, it throws and makes zero calls
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run it.** Expected: PASS.
- [ ] **Step 5: Commit** with PR D. The runbook gains the "redeploy when `supabase/functions/` or `supabase/config.toml` changes on `main`" rule (§5.4). The first deploy is an operator step, run in Task 20 Step 4 after PR D merges, because the CLI's guard requires `HEAD` on `origin/main`.

### Task 15: Table manifest and the user-column guard

**Files:**
- Create: `supabase/staging/table-manifest.json`, `scripts/staging/manifest.mjs`, `scripts/staging/manifest.test.mjs`

**Interfaces:**
- Produces:
  - The manifest: `{ "<table>": {"class": "copied" | "transformed" | "synthetic" | "excluded", "remap"?: {"owner_id": "steward"}} }`. It starts from §5.3's list and adds every other `public` table the baseline and migrations create, each classified, with a reason field for *excluded*.
  - `checkManifest(manifest, tables: string[]) -> string[]`: problems for a table missing from the manifest, or a manifest entry naming no table.
  - `checkUserColumns(manifest, fks: {table, column, refTable}[], columns: {table, column}[]) -> string[]`. A *copied* table with a foreign key to `auth.users`, or with a column named `owner_id`, `user_id` or `*_user_id`, is a problem. A *transformed* table must name every such column in `remap`.
  - `loadOrder(manifest, fks) -> string[]`: copied and transformed tables in foreign-key order. A cycle throws.

- [ ] **Step 1: Write the failing test.**
  - A new table absent from the manifest → a problem naming it.
  - `pulses` copied with an added `created_by uuid references auth.users` → a problem.
  - `nodes` transformed with `remap.owner_id` → no problem.
  - `loadOrder` puts `nodes` before `detections` when `detections.node_id → nodes.id`.
  - A two-table cycle throws.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement** the functions, and complete the manifest against the Task 12 schema. Read the foreign keys and columns from that schema's snapshot (Task 10 output), not from memory.
  - The manifest covers every table in `public` **that is not an extension member** (`pg_depend.deptype = 'e'`, for example PostGIS's `spatial_ref_sys`).
  - `checkManifest` ignores extension members, and refuses a manifest entry that names one.
  - Add a test case: an extension-member table listed in the manifest is a problem.
- [ ] **Step 4: Run it.** Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 15b: The refresh login's grants migration

This is a spec exception, for David to approve. The migration changes production ACLs before staging can test it: the first refresh needs the grants, so §5.5's staging step cannot run first. That is §5.11 step 2's bootstrap argument, but this migration, unlike the baseline, does write production. The plan's mitigations are a local forward, rollback and forward cycle, the privilege check, and backup confirmation before applying. **David approves this exception before Step 5.**

**Files:**
- Create: `supabase/migrations/20261029_refresh_login_grants.sql`, `supabase/migrations/rollbacks/20261029_refresh_login_grants.rollback.sql`
- Modify:
  - `supabase/migrations/checks/refresh-execute-allowlist.txt`
  - `AGENTS.md` (Migrations: "A migration that creates a table classified *copied* or *transformed* in `supabase/staging/table-manifest.json` grants `SELECT` on it to `magora_refresh`.")

**Interfaces:**
- Consumes: the manifest (Task 15), `roles.sql`, the snapshot and privilege check.
- Produces: `GRANT SELECT` to `magora_refresh` on every *copied* and *transformed* table, and on `storage.buckets` (see Task 10 if refused). The rollback revokes exactly these grants.

- [ ] **Step 1: Write both files.** Add a manifest test: every *copied* or *transformed* table appears in the grants migration's `GRANT SELECT` list, parsed from the file.
- [ ] **Step 2: Local cycle.** On a local stack running roles, the baseline, all migrations and this one: apply the rollback, re-apply the migration, and snapshot as `postgres` before and after. Expected: an identical snapshot.
- [ ] **Step 3: Check the restricted-login snapshot.** On the same stack, a snapshot taken as `magora_refresh` equals one taken as `postgres`.
- [ ] **Step 4: Derive the real `EXECUTE` allowlist.** On the same stack, run the privilege check as `magora_refresh` with only the `pg_catalog`/`information_schema` lines.
  - For each `EXECUTE` violation, read the function. Allowlist it, with its reason, only if it cannot write.
  - A writing `SECURITY DEFINER` function callable through `PUBLIC` is **not** allowlisted. It goes to the private advisory (Task 7), and production's privilege check (Task 13 Step 3) stays red until that fix is applied.
  - Non-`EXECUTE` privileges reached through `PUBLIC` (`USAGE`/`CREATE` on schemas, `TEMP` on the database) are handled the same way: `USAGE` is not in §5.10's forbidden list. `CREATE` on `public` is revoked from `PUBLIC` by Supabase's defaults; if it is present, it goes to the advisory. `TEMP` is not a write to production data, and is recorded in the allowlist file's header as accepted, for David to confirm.
  - Expected after this step: the check passes locally.
- [ ] **Step 5: Commit** with PR D. The production application is Task 13 Step 3.

### Task 16: Refresh: reset and rebuild with drift check

**Files:**
- Create: `scripts/staging/refresh/reset.mjs`, `supabase/setup/public-schema-defaults.sql`, `scripts/staging/refresh/refresh.itest.mjs` (extended by Tasks 17 and 18)

**Interfaces:**
- Consumes: `connect`, `applyFiles`, `listMigrationFiles`, `snapshotSchema`, `diffSnapshots`, `parseAllowlist`.
- Produces:
  - `emptyStorage(admin: SupabaseClient) -> Promise<number>`: removes every object in every bucket, paginating `list` until empty, and returns the count.
  - `resetAppSchemas(client) -> Promise<void>`, in one transaction:
    1. drop every non-extension-member object in `public` (excluded via `pg_depend.deptype = 'e'`): views, then tables `CASCADE`, then functions, types and sequences
    2. drop every policy on `storage.objects`
    3. delete every `storage.buckets` row
    4. `pgmq.drop_queue('audio_inference')` if it exists
    5. drop every trigger on `auth.users` whose function lives in `public`
    6. apply `public-schema-defaults.sql`
  - `rebuild(client, migrationsDir) -> Promise<void>`: `applyFiles` over `listMigrationFiles`.
  - `driftCheck(prodReader, staging, allowlist) -> string[]`

  `public-schema-defaults.sql` holds `public`'s grants and default privileges, copied from production's `\dn+ public` and `\ddp` output. The drift check is what proves it right.

- [ ] **Step 1: Write the failing itest.** On the local stack:
  1. Build once (roles, baseline, migrations).
  2. Snapshot it as A.
  3. Insert a row into a copied table, add a policy on `storage.objects`, create a bucket and upload one object.
  4. Run `emptyStorage`, `resetAppSchemas` and `rebuild`.
  5. Snapshot it as B.

  Expected: `diffSnapshots(A, B)` is empty, the row is gone, and the object count is 0. If PostGIS is installed, `select count(*) from spatial_ref_sys` is unchanged (extension data survives; Task 18's truncate set comes from the manifest, which excludes extension members).
- [ ] **Step 2: Run `npm run test:db`.** Expected: FAIL.
- [ ] **Step 3: Implement.** Every exported function that writes takes a client created with `writeTarget` `staging` or `local`, and asserts this at entry from a property `connect` sets on the client. A production reader cannot be passed in.
- [ ] **Step 4: Run it.** Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 17: Refresh: identities

**Files:**
- Create: `scripts/staging/refresh/identities.mjs`, `scripts/staging/refresh/identities.test.mjs`

**Interfaces:**
- Produces:
  - `listAllUsers(admin) -> Promise<User[]>`: pages `auth.admin.listUsers({page, perPage: 1000})` until a short page.
  - `resetIdentities(admin, keepEmails: string[]) -> Promise<Map<email, uuid>>`, the one entry point for §5.3 step 2's user handling. It:
    1. deletes every user whose email is not in `keepEmails`
    2. creates any missing maintainer with `email_confirm: true`, keeping existing maintainers' UUIDs
    3. re-lists and throws unless the set of users equals exactly the maintainers

    It is built from `deleteNonMaintainers(admin, keepEmails) -> {deleted}` and `ensureMaintainers(admin, emails) -> Map<email, uuid>`.
  - `createNodeLogins(admin, nodeIds: string[]) -> Promise<void>`: per node, `createUser({id: nodeId, email: 'node-<id>@staging.invalid', password: <random 32 bytes, discarded>})`.
  - `createStewards(admin, prodOwnerIds: string[]) -> Promise<Map<prodOwnerId, newUuid>>`: one synthetic steward per distinct owner, with email `steward-<n>@staging.invalid`. The map is returned in memory only.
  - `createSmokeSteward(admin, password) -> Promise<uuid>`: one extra synthetic steward, `smoke-steward@staging.invalid`, with the password from `STAGING_SMOKE_STEWARD_PASSWORD`. The smoke signs in as this user to register a node through `/api/register-node` (Task 19, `api` mode).

  Maintainer emails come from env `STAGING_MAINTAINER_EMAILS` (comma-separated), a secret in `staging-sync`.

- [ ] **Step 1: Write the failing test** against a fake `admin` object, recording calls.
  - `listAllUsers` over a fake holding 2,345 users returns all 2,345, in three pages.
  - `resetIdentities` from **zero** users creates both maintainers and passes its postcondition.
  - From 2,345 users that include one maintainer, it deletes the rest, creates the other maintainer, keeps the existing maintainer's UUID, and passes.
  - It throws if the fake "forgets" one deletion.
  - `createStewards(['a','a','b'])` returns a map of size 2.
  - No function writes its map or emails to stdout. Capture `console.log` and assert it received no email and no UUID.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run it.** Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 18: Refresh: snapshot copy, load, synthetic data, integrity

**Files:**
- Create:
  - `scripts/staging/refresh/copy.mjs`, with `copy.test.mjs`
  - `scripts/staging/refresh/synthetic.mjs`
  - `scripts/staging/refresh/integrity.mjs`
  - `scripts/staging/refresh/index.mjs`: the orchestrator CLI

**Interfaces:**
- Produces:
  - `remapLine(line: string, columnIndex: number, map: Map<string,string>) -> string`. It works on one COPY text-format line: it splits on literal `\t` (an escaped tab is `\\t` in text format, so it is never a separator) and replaces the field at `columnIndex` when it is in `map`. A non-null value missing from the map throws.
  - `copyTables(prodClient, stagingClient, order, manifest, ownerMap) -> Promise<Map<table, rowCount>>`.
    - The production side is one `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` transaction in which every table is read, counts first (§5.3 step 1).
    - The staging side is one transaction. It sets `session_replication_role = replica` and truncates **every table in the manifest, of every class**, in one `TRUNCATE` statement. The tables were rebuilt moments earlier, so this clears only the rows migrations seed, and a single statement over the whole set satisfies `TRUNCATE`'s rule that referencing tables be truncated together. It then streams `COPY (SELECT <cols>) TO STDOUT` into `COPY … FROM STDIN`, passing `nodes` through `remapLine`. It resets the role at the end.
  - `seedSynthetic(stagingClient, {maintainers, stewards}) -> Promise<void>`: deterministic rows in `listeners` (one per maintainer and per steward), `node_follows`, `listener_follows`, `journal_follows` and `listen_sessions`. The volume is a few rows each (§7).
  - `checkIntegrity(stagingClient, expectedCounts) -> string[]`. For every foreign key in `public` it runs an anti-join count, which must be 0. Every copied table's count must equal the snapshot's.
  - `index.mjs` runs §5.3's order:
    1. read production in one snapshot
    2. empty Storage, then `resetIdentities`
    3. reset and rebuild
    4. drift check (stop and alert)
    5. create node logins and stewards
    6. load
    7. seed
    8. check integrity
    8b. the exposure check (Task 22b; wired in PR E, once the staging site exists)
    9. run the smoke (Task 22) unless `--no-smoke`

    Before step 1, it calls `validateTargets(process.env)` (Task 2), and every Supabase client comes from `stagingAdmin`, so a wrong target fails before any side effect. Step 5 is, in order: `createNodeLogins`, `createStewards`, `createSmokeSteward`. The smoke steward is created with `email_confirm: true`, and its `listeners` profile is part of step 7's seed.

    Flags: `--audio-nights YYYY-MM-DD,…` (default none) copies those nights' node audio objects. Per Task 1 nodes upload none, so this applies to whichever bucket §5.3 means. If none exists, the flag is accepted and does nothing, and the runbook says so. `--source-db-url-env` (default `PROD_REFRESH_DB_URL`) lets Task 26 point the source at a scratch project. The production privilege check runs first, every time (§5.10). On any failure, it posts the step name, not the error text, to `STAGING_SLACK_WEBHOOK_URL`.

- [ ] **Step 1: Write the failing unit test** for `remapLine`:
  - A line with an escaped tab `a\\tb` in one field and the owner UUID in field 3: only field 3 changes, and the escaped tab survives byte-for-byte.
  - `\N` (null) in the owner field stays `\N`.
  - An owner absent from the map throws.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement** `copy.mjs`, `synthetic.mjs`, `integrity.mjs` and `index.mjs`.
- [ ] **Step 4: Extend the itest.** Use **two complete local Supabase stacks**, each started from its own temp workspace whose `config.toml` sets a distinct `project_id` and a distinct port block (source on the defaults, target offset by 1000). Each therefore has its own `auth`, `storage`, extensions and publication.
  - Build both. Seed the source with rows containing a tab, a newline, a backslash and a non-ASCII species name, and with nodes owned by three users created through the source's admin API.
  - Run steps 2–8 against the target, using the target's admin client.
  - Expected:
    - `checkIntegrity` returns `[]`
    - every *copied* table is byte-identical (`md5(string_agg(t::text, '' order by <pk>))` on both sides)
    - `nodes` is identical on every column except `owner_id`
    - the target's `owner_id` values are exactly the three new stewards, and two source nodes sharing an owner map to one steward

  `writeTarget: 'local'` accepts the target's port only.
- [ ] **Step 5: Run `npm test` and `npm run test:db`.** Expected: PASS.
- [ ] **Step 6: Commit.**

### Task 19: Simulated node

**Files:**
- Create: `scripts/staging/simulated-node.mjs`, `scripts/staging/simulated-node.test.mjs`

**Interfaces:**
- Consumes: `docs/staging/node-contract.md` (Task 1), `assertStaging`.
- Produces:
  - `buildDetection(nodeId, now) -> object` and `buildAciLog(nodeId, now) -> object`, with exactly the contract's fields.
  - `run({supabaseUrl, anonKey, register}) -> Promise<{nodeId, checks: string[]}>`. `register` is one of two modes:
    - `{via: 'api', siteUrl, bypassSecret, stewardEmail, stewardPassword}`, the path the wizard takes. `assertStagingSite(siteUrl)` runs before any request, and every request uses `redirect: 'error'`, so neither the JWT nor the bypass secret can follow a redirect elsewhere. It signs the synthetic steward in by password on staging Auth, then `POST {siteUrl}/api/register-node` with that JWT and the bypass header. This exercises `api/register-node.js`'s caller check and owner derivation. It is used once the staging site exists (the smoke, Task 22).
    - `{via: 'function', provisionSecret, ownerId}`, which calls `provision-node` directly. It is used before the site exists (Task 19 Step 5).

    It then:
    1. registers in the chosen mode
    2. signs in by password
    3. reads its whitelist with the anon key
    4. inserts one detection and one ACI log with its JWT
    5. reads each back by `node_id` and `detected_at`/`recorded_at` with its JWT
    6. forces a 401 by using an expired token, re-signs in, and retries once

    It throws on the first failed check.
  - CLI: reads its inputs from the env (`op run`, or the refresh workflow). It calls `assertStaging(supabaseUrl, 'api')` before any request, with no flag to skip it.

- [ ] **Step 1: Write the failing test.**
  - `buildDetection`'s keys equal the contract list exactly. It is sorted and compared with a constant copied from the contract doc.
  - `run` with a production URL rejects **before** any `fetch`: the injected fake `fetch` records zero calls.
  - `run` in `api` mode with `siteUrl` `https://staging.themagoraportal.org.evil.example` or `https://magora-portal.vercel.app` rejects with zero calls.
  - Every `fetch` the script makes passes `redirect: 'error'`, asserted on the recorded calls.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement.** `fetch` is injectable for the test.
- [ ] **Step 4: Run it.** Expected: PASS.
- [ ] **Step 5 (operator, in Task 20 Step 5's sequence):** run it against staging through `op run`, in `function` mode, owned by a maintainer's staging UUID. Expected: every check is listed as passed. This is criterion 5's evidence and goes in `docs/runbooks/staging.md`.
- [ ] **Step 6: Commit.**

### Task 20: Refresh workflow and first run

**Files:**
- Create: `.github/workflows/staging-refresh.yml`

**Interfaces:**
- Consumes: environment `staging-sync` (`main` only), holding:
  - `PROD_REFRESH_DB_URL`: the refresh login via the pooler
  - `STAGING_DB_URL`: the staging owner via the pooler
  - `STAGING_SUPABASE_URL`, `STAGING_SERVICE_ROLE_KEY`, `STAGING_ANON_KEY`, `STAGING_PROVISION_SECRET`
  - `STAGING_SLACK_WEBHOOK_URL`, `STAGING_MAINTAINER_EMAILS`, `STAGING_SMOKE_STEWARD_PASSWORD`
  - `PROD_SUPABASE_URL`, `PROD_ANON_KEY`. Both are public values, stored as environment variables rather than secrets, and used for the exposure check's source-side anon reads (Task 22b).

  The refresh and the exposure check take their source as three inputs: `--source-db-url-env`, `--source-api-url-env` and `--source-anon-key-env` (defaults `PROD_REFRESH_DB_URL`, `PROD_SUPABASE_URL`, `PROD_ANON_KEY`). Before any read, `index.mjs` checks that the database ref and the API ref name the same project, and that it is not staging.
  - `VERCEL_AUTOMATION_BYPASS_SECRET`

- [ ] **Step 1: Write the workflow.**
  - Triggers: `schedule: '0 9 * * *'` and `workflow_dispatch` with inputs `audio_nights` and `holder` (both optional strings).
  - `permissions: contents: read`; `concurrency: {group: staging-refresh, cancel-in-progress: false}`.
  - Two jobs implement the lease (§5.5; described with Task 26):
    - `admit` has no environment. It checks out `main` (pinned `actions/checkout`, `persist-credentials: false`), then runs `node scripts/staging/lease.mjs admit` with `EVENT=${{ github.event_name }}`, `HELD=${{ vars.STAGING_HELD_BY }}` and `HOLDER=${{ inputs.holder }}` passed through `env:`, and outputs `admitted`.
    - `refresh` has `needs: admit`, `if: needs.admit.outputs.admitted == 'true'` and `environment: staging-sync`.
  - The `refresh` job's first step fails unless `github.ref == 'refs/heads/main'`.
  - Checkout with `ref: main`, `fetch-depth: 0` (the smoke's SHA check needs history) and `persist-credentials: false`.
  - `npm ci`, then `node scripts/staging/refresh/index.mjs --audio-nights "$AUDIO_NIGHTS"`, with every secret passed through `env:`. Until Task 22 lands it runs with `--no-smoke`.
- [ ] **Step 1b: Write `scripts/staging/lease.mjs` and `lease.test.mjs`** (interfaces in Task 26's lease paragraph):
  - the four `admit` cases
  - `claim` refusing an already-held lease
  - `release` refusing the wrong login, with `gh` injected as a fake

  Run it: FAIL, implement, PASS.
- [ ] **Step 2: Lint.** `actionlint` is clean. Read the YAML for any `pull_request` trigger (there must be none) and for `${{ secrets.* }}` inside a `run:` line (there must be none).
- [ ] **Step 3 (operator, David):**
  - Create the `staging-sync` environment, set to `main` only.
  - Enter each value in its vault first, then copy it in.
  - Read back the branch policy and `gh secret list --env staging-sync`.
  - Re-run `inventory-check.mjs`.
- [ ] **Step 4: Commit and open PR D.**
- [ ] **Step 5 (operator, after PR D merges, in this order):**
  1. Task 13 Steps 2–4 (staging roles, the production role and grants, the privilege check, staging `ops`).
  2. Pull `main`, then run `op run --env-file=env/staging.env --env-file=env/maintainer.env -- node scripts/staging/deploy-functions.mjs secrets PROVISION_SECRET`, then the same `op run` prefix with `deploy-functions.mjs deploy`. Use Task 14's nested `op run` fallback if this `op` version rejects two `--env-file` flags. Read back `supabase functions list --project-ref mujiqtvwtsbaakfcsjkp` from the CLI's link-free temp directory: two functions, `verify_jwt` false on both. Also read back the `ops.edge_deploys` row.
  3. David runs `workflow_dispatch`. Expected: steps 1–8 pass, including the drift check. This completes rollout step 3.
  4. Task 19 Step 5.

---

## Phase 4: Rollout step 4 (staging deployment and domain)

### Task 21: Staging environment, domain and deploy workflow

**Files:**
- Create: `.github/workflows/staging-deploy.yml`

- [ ] **Step 1 (operator, David): confirm the mechanism (§5.9).**
  - Create the Vercel custom environment `staging` **with no branch tracking**.
  - Set its env vars from the staging vault. The list is every name read by `process.env.*` under `api/` (re-run `grep -rhoE "process\.env\.[A-Z_]+" api | sort -u` first). On 2026-10-28 that was `ANTHROPIC_API_KEY`, `CRON_SECRET`, `EBIRD_API_KEY`, `PROVISION_SECRET`, `SLACK_WEBHOOK_URL`, `SUPABASE_SERVICE_ROLE_KEY` (staging's), `VITE_SUPABASE_ANON_KEY`, `VITE_SUPABASE_URL` and `XENO_CANTO_API_KEY`. Record each 1Password reference in the variable's comment field, or in the inventory doc if the CLI has no comment field.
  - Run one manual `vercel deploy --target=staging` from a clean `main` checkout.
  - Read back that the deployment is listed under `staging`, and that Production's latest deployment is unchanged.
  - If the custom environment cannot be created without a branch, or the targeted deploy does not land in it, stop and bring the alternatives back to David (§5.9).
- [ ] **Step 2 (operator, David):**
  - Add the Cloudflare DNS-only CNAME `staging.themagoraportal.org` pointing at Vercel's target, and attach the domain to the `staging` environment.
  - Record whether production deployments are protected (§5.3).
  - Check protection with plain `curl` without the bypass header. Expected: `https://staging.themagoraportal.org/` returns 401 or 403. If it does not, switch protection to cover all non-production deployments, re-check, and record the setting.
  - Register in staging Supabase Auth: the site URL `https://staging.themagoraportal.org`, plus redirect URLs for it and for the preview pattern `https://magora-portal-*-<team>.vercel.app/**`.
  - Register each OAuth provider's callback for the staging project.
  - Add Method's embed origin `https://staging.themagoraportal.org`.
- [ ] **Step 3: Write the workflow.**
  - Trigger: `push: branches: [main]`.
  - `permissions: contents: read`; `environment: staging-deploy`, set to `main` only, holding `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` and `STAGING_SLACK_WEBHOOK_URL`; `concurrency: {group: staging-deploy, cancel-in-progress: true}`.
  - Steps: checkout with `persist-credentials: false`, then one command, `npx --yes vercel@58.9.0 deploy --target=staging --yes --token "$VERCEL_TOKEN"`, with `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` set in `env:`. Vercel builds remotely with the `staging` environment's own variables. There is **no `vercel pull` and no `--prebuilt`**, because `pull` writes resolved values to `.vercel/.env.*` on the runner.
  - `if: failure()` posts to the staging Slack webhook.
  - Production's deploy stays on the Git integration and does not depend on this job.
- [ ] **Step 4: Lint** with `actionlint` and read the YAML as in Task 20 Step 2.
- [ ] **Step 5: Read back after merge (operator).** One `main` SHA appears in two deployments, Production and staging (`vercel ls`, matching on the git SHA in each deployment's meta). `dig +short staging.themagoraportal.org` resolves to Vercel. `curl -vI` shows a valid certificate. The Supabase ref check comes in Task 22.
- [ ] **Step 6: Commit** (PR E, together with Task 22).

### Task 22: Smoke, exposure check, full refresh

**Files:**
- Create: `scripts/staging/refresh/smoke.mjs`, `scripts/staging/refresh/smoke.test.mjs`

**Interfaces:**
- Produces:
  - `edgeDeployIsCurrent(recordedSha, newestTouchSha, isAncestor) -> boolean`: true if `newestTouchSha` is an ancestor of, or equal to, `recordedSha`. `newestTouchSha` = `git log -1 --format=%H origin/main -- supabase/functions supabase/config.toml`.
  - `ROUTES`: a constant with one entry per `/api` route the main pages call (`insight`, `xeno-canto`, `regional-species`, `inat-nearby`, `report-ondemand`, `pulse-ondemand`, `narrative-ondemand`).
    - Each entry is `{method, path, body?, expectStatus: 200, expectKey}`.
    - The implementer fills it by reading each handler and the page that calls it. The request is the smallest one the page itself sends, built against a node that the refresh copied. `expectKey` is a top-level key the handler returns on success.
  - `checkRoute(entry, response) -> string | null`: a problem unless the status equals `expectStatus` and the parsed JSON has `expectKey`.
  - `smoke(env) -> Promise<string[]>`. It:
    - runs the simulated node in `api` mode, which covers `/api/register-node`
    - runs the edge-deploy SHA check
    - runs every `ROUTES` entry against `https://staging.themagoraportal.org` with header `x-vercel-protection-bypass`
    - checks the served bundle: `GET /`, then find the JS asset and search it. It must contain `mujiqtvwtsbaakfcsjkp` and not `wqxmmuwrfltpaxnuddwk`.
  - The exposure check is Task 22b. It runs as refresh step 8b, after integrity and before the smoke, so no smoke rows exist when it reads.

- [ ] **Step 1: Write the failing test.**
  - `edgeDeployIsCurrent` is false when `functions/` changed after the recorded SHA, and true when equal or later.
  - `checkRoute` flags 400, 404, 405, 401 and 500, and a 200 whose JSON lacks `expectKey`. It passes a 200 that has `expectKey`.
  - Every `ROUTES` entry has `method`, `path`, `expectStatus` and `expectKey`.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement**, and wire `smoke` into `index.mjs` step 9. Remove `--no-smoke` from the workflow.
- [ ] **Step 4: Run it.** Expected: PASS.
- [ ] **Step 5 (operator, after merge):**
  - Run the full refresh. Expected: steps 1–9 pass, including 8b (Task 22b). This completes rollout step 4.
  - Also `curl` production's served bundle for production's ref, to complete criterion 2's last clause.

### Task 22b: Exposure check (§5.3), with full endpoint fixtures

The check answers one question: **can an anonymous caller see anything on staging that they could not see on production?** It covers every endpoint anon can read, and it reads production as anon only, plus one lookup through the read-only refresh login. It never calls an anon-executable function that writes. Whether such functions should be anon-callable is the private advisory's question (Task 7), not this check's.

**Files:**
- Create:
  - `supabase/staging/exposure-manifest.json`
  - `scripts/staging/exposure/{endpoints,subset,fixtures,run}.mjs`, with `exposure.test.mjs` and `exposure.itest.mjs`

**Interfaces:**
- Consumes: `stagingAdmin`, `connect`, the table manifest, `schema-snapshot.mjs`, and the two-stack itest fixture (Task 18).
- Produces:
  - **`listAnonEndpoints(stagingClient) -> {relations: {name, columns: string[]}[], functions: string[]}`.** It reads the staging catalog and is re-derived on every run, never typed by hand.
    - Relations: every `public` relation where `has_any_column_privilege('anon', oid, 'SELECT')`. This includes column-only grants. For each, `columns` lists the columns where `has_column_privilege('anon', oid, attnum, 'SELECT')`.
    - Functions: every `public` function where `has_function_privilege('anon', oid, 'EXECUTE')`, keyed by its **qualified signature**: `n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'`, for example `public.journal_follower_count(uuid)`. This is not `regprocedure`, whose text drops the schema depending on `search_path`. A new overload is therefore a new key. The bare `proname` is kept separately for the RPC request path.
    - Manifest entries for relations record their readable `columns`. A change in the readable column set is a coverage failure.
  - **`checkCoverage(endpoints, manifest) -> string[]`.** Every endpoint must have exactly one manifest entry, and every entry must name a live endpoint. A new anon endpoint therefore fails the check until someone classifies it, the same way the table manifest forces a classification (§5.3).
  - **The exposure manifest:** `{ "<key>": {kind, …} }`. A relation's key is `schema.name`, and a function's key is its qualified signature, exactly as `listAnonEndpoints` produces it. The `kind` values are:
    - **`subset`** applies to *copied* tables, and to views that read only copied tables. Fields: `pk: string[]`.
    - **`nodes`** applies to `public.nodes`, the one *transformed* table with real data. Fields: `pk`, plus `ownerDerived: string[]`, the columns whose value comes from the owner (at least `owner_id`).
    - **`fixture`** applies to *synthetic* and *excluded* tables, and to views that read any of them. Fields: `cases: Case[]`.
    - **`rpc-read`** applies to an anon-executable function that only reads. Fields: `cases: Case[]`, each with the arguments and the expected result.
    - **`not-a-read`** applies to an anon-executable function that writes. Fields: `reason`. It is never called. The reason says only "writes; outside this check".
  - **A relation `Case`** is `{name, seed, seedState, probe, expect}`:
    - `seed`: `{table, row}[]`, which may include dependency rows in other tables (for example a session plus its captures). Rows are inserted through the staging owner connection, with ids from the fixed namespace `00000000-e1b0-4000-8000-xxxxxxxxxxxx`.
    - `seedState`: `{table, id, equals: {col: value}}[]`. Checked through the owner connection **after** insert, so a trigger that rewrote a row (for example the range gate recomputing `range_status`) makes the case fail as `fixture invalid`, never as a false pass.
    - `probe`: `{endpoint, filter: {col: value}}`, the PostgREST filter that selects this case's result rows on the endpoint. For `public_journal_followers` that is `{node_id, listener_id}`; for a view it is the view's own key.
    - `expect`: `{rows: number, equals?: {col: value}, columns?: string[], roundedTo?: {col, places}[]}`. For example, `public_listen_sessions` expects `{rows: 1, equals: {capture_count: 1}, roundedTo: [{col: 'lat', places: 3}, {col: 'lon', places: 3}]}`, and a hidden case expects `{rows: 0}`.
  - **An RPC `Case`** is `{name, seed, args: object, expectResult: JSON}`, compared by deep equality after a `POST /rest/v1/rpc/<name>` with the anon key. Pure functions found by the coverage check (`range_cell_key`, `range_week`, `is_plausible`, `range_status_of`, if anon can execute them) get one or two exact-value cases each, with values computed from the function's definition.
  - Seeded rows are deleted in a `finally` block. The next refresh would remove any left behind anyway.
  - **`keyFilter(pk: string[], tuples: any[][]) -> string`.** For a single-column key it returns `<pk>=in.(…)`. For a composite key it returns `or=(and(a.eq.x,b.eq.y),…)`, so tuples are preserved and components never cross-match. Values are quoted per PostgREST's reserved-character rules.
  - **`subsetCheck(table, entry, stagingAnon, sourceAnon, sourceReader) -> string[]`.** It pages through every staging anon-visible key using keyset pagination over the full `pk` (`order=a,b` with a tuple `or` predicate past the last seen key, pages of 1,000). It asks the source's anon API for those keys in batches of 50 tuples via `keyFilter`. Missing keys are looked up through the reader with a parameterized full-key query, `where (a, b) in (select * from unnest($1::<type>[], $2::<type>[]))`. For each key the source does not return:
    - The refresh login (`sourceReader`, `BYPASSRLS`, read-only) reads that key from the source: production normally, the scratch project in Task 26.
    - **If the row exists, production hides it from anon. That is a failure: staging exposes more.**
    - If the row is gone, it was deleted since the snapshot. That is counted, not failed.

    Failure messages name the table and the number of keys, never key values.
  - **`nodesCheck(...)`** runs the subset check on `id`. Then, for every staging-visible node, it compares the anon-visible column set and values against production's anon response for the same id, excluding `ownerDerived` columns. This catches a policy whose outcome depends on the owner, where a synthetic steward could make a real node location visible.
  - **`fixtureCheck(entry, stagingOwner, stagingAnon) -> string[]`.** For each relation case, it:
    1. inserts `seed`
    2. verifies `seedState` (otherwise it fails as `fixture invalid`)
    3. runs `probe` as anon through PostgREST
    4. asserts `expect` over the probe's result rows:
       - `rows`: the exact row count, where 0 means hidden
       - `equals`: every result row has those values
       - `columns`: the returned column set is exactly those
       - `roundedTo`: each named column has at most that many decimal places, and differs from the precise seeded value

    For each RPC case, it inserts `seed`, calls the function with `args`, and deep-compares the result with `expectResult`. Seeded keys are never matched against results directly. Only `probe` and `expect` decide the outcome.
  - **`run(env) -> {pass: boolean, table: Row[]}`** (`run.mjs`, called by refresh step 8b, and runnable alone through `op run`), in order:
    1. An unauthenticated `GET https://staging.themagoraportal.org/` returns 401 or 403.
    2. `POST /auth/v1/signup` on staging is refused.
    3. `checkCoverage` passes.
    4. Every manifest entry passes its check.
    5. No synthetic table holds an email address outside `@staging.invalid`.

    It prints a pass/fail row per endpoint, with no row data.

**The starting fixture cases.** In this table, "visible" is shorthand for a case whose `probe` selects the expected result row and whose `expect.rows` is that row count. "Hidden" is a case with `expect: {rows: 0}`. These were read from the migrations on 2026-10-28. Re-read each policy and view when filling in the manifest, and treat the policy as the authority if it differs from this list.

| Endpoint | Starting cases |
|---|---|
| `listeners` (policy `using (true)` to public) | `visible`: two synthetic profiles. `columns`: the anon column set equals production's OpenAPI column set for `listeners`. |
| `listen_sessions`, `mobile_detections`, `node_follows`, `listener_follows`, `journal_follows` (owner-only `to authenticated` policies) | `hidden`: one seeded row each, owned by a fixture user. |
| `public_mobile_detections` (status `complete`, `published`, `range_status <> 'quarantined'`; coordinates rounded to 3 places) | `visible`: complete, published and plausible. `roundedTo` lat/lon at 3 places. `hidden`: one row each that is unpublished, quarantined, and pending. |
| `public_listen_sessions` (session `published`, and `capture_count > 0` counting complete captures) | `visible`: published with one complete capture (`count` 1). `roundedTo` lat/lon at 3 places. `hidden`: unpublished with captures; published with only pending captures. |
| `public_journal_followers` (`follows_public = true`) | `visible`: a follower with `follows_public` true. `hidden`: one with it false. |
| `journal_follower_count`, `listener_follower_count`, `node_follower_count` (`rpc-read`) | Seed two followers of a fixture subject. The expected result is the count the function's own definition returns for them (2 if it counts every follower; otherwise per its filter). |
| Every other anon-executable function | `not-a-read`, unless reading its body shows it only reads. In that case it becomes `rpc-read`, with a case. |
| Copied tables (`detections`, `aci_logs`, `species`, …) and any view over them only | `subset` |
| `nodes` | `nodes` |

Anything `listAnonEndpoints` finds beyond these rows gets a manifest entry while this task is being built. The coverage check enforces that.

- [ ] **Step 1: Write the failing unit tests** (`exposure.test.mjs`, with fake clients):
  - `checkCoverage`:
    - an endpoint without an entry is a problem, and an entry for a missing endpoint is a problem
    - a relation whose readable columns differ from its entry is a problem
    - two overloads of one function name need two entries
  - `keyFilter(['a','b'], [[1,2],[2,1]])` returns a filter that matches `(1,2)` and `(2,1)` but not `(1,1)`. Test it by evaluating the generated predicate against those three tuples with a small in-test evaluator.
  - `subsetCheck` over a composite-key fake, where staging has `(1,2)` and the source has `(1,1)` and `(2,2)`, reports `(1,2)` as missing.
  - A relation case whose `seedState` does not hold after insert fails as `fixture invalid`.
  - `subsetCheck`, when production anon omits a key:
    - the fake `prodReader` finds the row → a failure naming the table and "1 key"
    - the fake `prodReader` does not find it → no failure, and `deleted: 1`
  - The failure text never contains a key value.
  - `nodesCheck`: a node whose `location` differs between staging-anon and production-anon fails. One that differs only in `owner_id` passes.
  - `fixtureCheck`:
    - a case expecting `{rows: 0}` whose probe returns a row fails
    - a session-plus-capture case expecting `{rows: 1, equals: {capture_count: 1}}` passes when the probe returns only the session row
    - a `roundedTo` case returning the precise seeded value fails
    - an RPC case whose result differs from `expectResult` fails
    - seeded rows are deleted even when the assertion throws (the fake records the delete)
  - `checkCoverage` matches a manifest key `public.f(uuid)` against a discovered `public.f(uuid)`, and treats `public.f(uuid, integer)` as a separate, missing key.
  - The manifest file validates: every entry has a known `kind` with its required fields, and every `fixture` entry has at least one case.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Write the sabotage itest** (`exposure.itest.mjs`, using the two-stack fixture from Task 18; source stands in for production, target for staging). First, a clean run over the fixture manifest passes. Then, one at a time, each sabotage below is applied **to the target only**, must make the check fail on exactly that endpoint, and is undone:
  1. **Subset, the controlled case.** Create `public.exposure_probe(id uuid primary key, shown bool)` on both stacks, with RLS on and policy `for select to anon using (shown)`. Seed one shown and one hidden row on both, and give it a `subset` entry. Then replace the target's policy with `using (true)`.
  2. **Nodes.** Change the target's `nodes` select policy so that anon sees one node the source hides. (The itest seeds such a node, for example `is_active = false`, if the baseline's policy filters on it. Otherwise it adds a controlled filter on both stacks first, the same way as case 1.)
  3. **A hidden fixture.** Add `for select to anon using (true)` on the target's `listen_sessions`.
  4. **A view filter.** Recreate the target's `public_mobile_detections` without `published = true`.
  5. **Rounding.** Recreate the target's `public_listen_sessions` with unrounded `lat`.
  6. **An RPC read.** Replace the target's `journal_follower_count` with one that returns its result + 1.
  7. **Coverage, a table.** Grant `SELECT` on a new table to anon on the target, with no manifest entry.
  8. **Coverage, a column-only grant.** `GRANT SELECT (id) ON` another new table `TO anon`.
  9. **Coverage, an overload.** Create `journal_follower_count(uuid, int)` on the target and grant it to anon.
- [ ] **Step 4: Run `npm test` and `npm run test:db`.** Expected: the unit tests pass, the clean itest run passes, and all nine sabotages are caught.
- [ ] **Step 5: Implement and fill the manifest** against the full schema. Wire `run` into `index.mjs` as step 8b. A failure stops the refresh before the smoke and alerts the staging channel with the endpoint names. Re-run Step 4.
- [ ] **Step 6: Commit** with PR E.
- [ ] **Step 7 (operator, after merge):** run the full refresh (Task 22 Step 5). Step 8b's table is criterion 2's exposure evidence: record it in `docs/runbooks/staging.md`.

---

## Phase 5: Rollout step 5 (previews and local development)

### Task 23: Previews and `vite dev` to staging

**Files:**
- Create: `scripts/dev/proxy-config.mjs`, `scripts/dev/proxy-config.test.mjs`
- Modify:
  - `vite.config.js:7-15`
  - `package.json`: `"dev": "op run --env-file=env/staging.env -- vite"`, and `"dev:no-op": "vite"` kept for contributors without 1Password, documented as proxying to staging without the bypass, which therefore fails closed
  - `env/staging.env`

**Interfaces:**
- Produces: `devProxy(env: Record<string,string|undefined>) -> {'/api': ProxyOptions}`. The target is `https://staging.themagoraportal.org`, with `changeOrigin: true` and `secure: true`. When `env.VERCEL_AUTOMATION_BYPASS_SECRET` is set, it adds `headers: {'x-vercel-protection-bypass': <value>}`. It never targets `magora-portal.vercel.app`.

- [ ] **Step 1: Write the failing test.**
  - The target is the staging host.
  - The header is present only when the env var is set.
  - `JSON.stringify(devProxy({}))` does not contain `magora-portal.vercel.app`.
  - A value with a trailing `\r` (from a CRLF env file) is trimmed.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement**, and have `vite.config.js` call `devProxy(process.env)`. Keep the existing comment, updated: the proxy goes to staging.
- [ ] **Step 4: Run it.** Expected: PASS. `npm run build` passes with no env vars.
- [ ] **Step 5 (operator, David): switch Preview.**
  - Re-measure first: `vercel env ls preview`, names only.
  - Replace every Preview value with its staging counterpart from the staging vault, recording each reference.
  - Preview gets the same name list as Task 21 Step 1, every value staging's, `SUPABASE_SERVICE_ROLE_KEY` included (staging's key).
  - Read back the names and their references against the inventory doc.
  - Open a PR's preview and confirm its served bundle holds the staging ref (smoke helper, run by hand).
- [ ] **Step 6 (operator, David on macOS, Noah on Windows):**
  - Run `npm run dev`, sign in with a maintainer email OTP, and open the dashboard.
  - In the browser network log, confirm that every `*.supabase.co` request goes to `mujiqtvwtsbaakfcsjkp`, and that `/api/*` responses come from staging. Their `x-vercel-id`/deployment host must be the staging deployment.
  - Record a screenshot cropped to the hostnames only. This is criterion 2's local half.
- [ ] **Step 7: Commit and open PR F.**

---

## Phase 6–8: Rollout steps 6–8

### Task 24 (operator): Staging listen worker

No change to `magora-acoustic-biodiversity` is needed (see the verified facts above).

- [ ] **Step 1 (David):** `fly apps create magora-listen-worker-staging`. From `magora-acoustic-biodiversity/worker/`, run `fly secrets set -a magora-listen-worker-staging SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=…` through `op run` against the staging vault. Then `fly deploy -a magora-listen-worker-staging` with the same Dockerfile.
  - 🔴 **Pass `-a` on every command.** `fly.toml` names the production app, so a bare `fly secrets set` from that directory writes production's secrets.
- [ ] **Step 2:** read back that `fly secrets list -a magora-listen-worker-staging` shows the two names, and `fly secrets list -a magora-listen-worker` is unchanged (compare digests, before and after).
- [ ] **Step 3 (David):** make a phone recording on `staging.themagoraportal.org`. Confirm that its `mobile_detections` row reaches `complete` and that the staging worker's log shows the job. Record both in `docs/runbooks/staging.md` before the next nightly refresh. This is criterion 6.
- [ ] **Step 4:** add the app to the inventory doc and re-run `inventory-check.mjs`.

### Task 25 (operator): Secret rotation

- [ ] **Step 1:** list every value whose old copy sat in Preview, taken from Task 23 Step 5's re-measure.
- [ ] **Step 2 (David):** rotate `PROVISION_SECRET` per `docs/tasks/provision-secret-rotation-runbook.md`, and each listed value. The vault is updated first, then each copy.
- [ ] **Step 3 (David):** rotate the production service-role key only after checking its dependents:
  - the Vercel functions in §3 and the production listen worker need the new key
  - Edge Functions receive it from Supabase
  - nodes do not hold it (verified above)

  Update the production worker's Fly secret and Vercel Production in the same session.
- [ ] **Step 4:** for each rotated value, read back a fingerprint, never validity alone and never any part of the value. Use the store's own digest where it shows one (`supabase secrets list`, `fly secrets list`). Otherwise use the first 12 hex characters of `sha256(value)`, computed inside `op run` by a one-line Node script and compared with the same computation over the vault item. Re-run `inventory-check.mjs`.

### Task 26: Interim migration runbook and rehearsal

**Files:**
- Create: `docs/runbooks/interim-migrations.md`
- Modify: `AGENTS.md` (Migrations: "Never apply a migration **to production** until its PR is green at its final head")

**The staging lease** (built in Task 20, in PR D, so it is on `main` before this runbook is rehearsed). Disabling the workflow would also block the refreshes the session itself needs, and it does not stop a run already in progress. Instead, the session holds a lease in the repository Actions variable `STAGING_HELD_BY`, which is not a secret.
- `staging-refresh.yml`'s `admit` job gates its `refresh` job, so no step that writes runs unless admitted.
- `admit({event, held, holder}) -> boolean`:
  - a schedule while held → false
  - a schedule while unheld → true
  - a dispatch while held → true only if `holder === held`
  - a dispatch while unheld → true
- `scripts/staging/lease.mjs` also exports `claim(login)` and `release(login)`, which call `gh variable`:
  - `claim` refuses if the variable is already set, sets it, and reads it back to confirm that it holds `login`.
  - `release` refuses unless the variable holds `login`.

- [ ] **Step 1: Write the runbook** following §5.5, with exact commands.
  - Claim staging in the maintainers' channel. Then run `node scripts/staging/lease.mjs claim <github-login>`.
  - Drain: wait until `gh run list --workflow staging-refresh.yml --json status --jq '[.[] | select(.status != "completed")] | length'` prints `0`. That covers queued, waiting, pending and in-progress runs.
  - `gh workflow run staging-refresh.yml -f holder=<login>`, and wait for green.
  - Apply the PR's migration, its rollback, then the migration again, through `op run --env-file=env/staging.env -- node scripts/db/apply-migrations.mjs --db-url-env STAGING_DB_URL --file <path>`. That entry point refuses non-staging refs through `writeTarget: 'staging'`.
  - Run the simulated node.
  - End with `gh workflow run staging-refresh.yml -f holder=<login>`. Once it is green, run `node scripts/staging/lease.mjs release <login>`.
  - After merge, confirm that day's daily backup exists, apply to production by the current method, and run a refresh.
  - One session at a time: a set variable means staging is taken.
- [ ] **Step 2: Add the code.**
  - Add the `--file` entry point to `apply-migrations.mjs`, plus a test that `--db-url-env` pointing at the production ref is refused before connecting.
  - Before rehearsing (Step 4), confirm on `main` that a dispatch with `-f holder=<login>` while held runs the `refresh` job, and that one with another login skips it.
- [ ] **Step 3: Edit AGENTS.md.**
- [ ] **Step 4 (operator): rehearse the runbook end to end,** with a scratch project standing in for production. Record the result in the runbook. This is criterion 3.
  The scratch source is built from the repo, not from a production copy. That way its schema and ACLs match production's by construction (the drift check proves it), and no production data is held.

  `SCRATCH_DB_URL` below is the scratch project's `magora_refresh` login via the pooler. `SCRATCH_SETUP_DB_URL` is its `postgres` login. `SCRATCH_SUPABASE_URL` and `SCRATCH_ANON_KEY` are its API URL and anon key. Every refresh in steps 1–3 runs locally, with the staging-sync values from the staging vault, as:

`op run --env-file=env/staging.env -- node scripts/staging/refresh/index.mjs --source-db-url-env SCRATCH_DB_URL --source-api-url-env SCRATCH_SUPABASE_URL --source-anon-key-env SCRATCH_ANON_KEY`

The source check confirms that all three name the scratch ref. Only the cleanup in step 4 omits the three `--source-*` flags.

  1. **Make the scratch source.**
     - Create `magora-rehearsal-scratch` and claim the lease.
     - With `apply-setup.mjs --target scratch --ref <scratch-ref>`, apply `roles.sql`, then each file `listMigrationFiles` returns on `main`, once each, in order. That list starts with the baseline and includes the grants migration. Every scratch command in this step passes `--ref <scratch-ref>`.
     - Set the scratch login's password.
     - Apply `supabase/setup/rehearsal-fixture.sql` the same way. It is a fixed file (written in this task) that inserts one auth user, the steward, and two nodes, so the refresh has something to copy and remap. The simulated node is not used against scratch, because it refuses every ref but staging's.
     - Run the privilege check against `SCRATCH_DB_URL`. Expected: pass.
  2. **Pre-merge state.**
     - On a local branch `rehearsal/probe` (never pushed), add `create table public.rehearsal_probe(id int)`, its rollback, and a manifest entry `"rehearsal_probe": {"class": "excluded", "reason": "rehearsal"}`. An excluded table needs no grant.
     - Refresh from a `main` checkout. Expected: green, including the drift check, which proves the scratch source equals the rebuilt staging.
     - Run the test session against staging from the `rehearsal/probe` checkout: apply, roll back, apply, then the simulated node.
     - End with a refresh from `main`. It drops the probe and stays green.
  3. **Post-merge state, simulated without merging.**
     - Apply the probe to the scratch source with `apply-setup.mjs --target scratch --ref <scratch-ref> --file 20261101_rehearsal_probe.sql`. (Scratch's allowed files are whatever `listMigrationFiles` returns in the current checkout, so this runs from the `rehearsal/probe` checkout.)
     - Refresh **from the `rehearsal/probe` checkout**. Expected: drift check green, with the probe on both sides.
  4. **Clean up.**
     - Delete the scratch project and the local branch.
     - Run a refresh from `main` against real production, with no `--source-db-url-env`, so staging is back to normal.
     - Release the lease.
- [ ] **Step 5: Commit and open PR G.**

---

## Success criteria → where each is proven

| # | Proven by |
|---|---|
| 1 | Task 3 Step 2, Task 5 Step 2 |
| 2 | Task 23 Steps 5–6, Task 21 Step 5, Task 22 Step 5, Task 22b Step 7 |
| 3 | Task 26 Step 4 |
| 4 | Task 6 Steps 6–7 |
| 5 | Task 19 Step 5 |
| 6 | Task 24 Step 3 |
| 7 | Task 13 Step 3; re-run at every refresh (Task 18) |
| 8 | Task 7 Step 3 (private) |
| 9 | Task 10 (`parseAllowlist` rejects `public`), Task 12 Step 4 |
