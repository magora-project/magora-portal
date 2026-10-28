# Storage backup and restore

## What the job copies

`.github/workflows/storage-backup.yml` runs every night at 07:30 UTC (and on manual dispatch, `main` only).
It lists every Supabase Storage bucket and copies each one into the R2 bucket
under `nightly/<YYYY-MM-DD>/<bucket>/` (UTC date). The R2 bucket name is held in the `R2_BUCKET` secret and is `magora-storage-backup`; below it is written `<R2_BUCKET>`. Unchanged objects are server-side copied from the
newest earlier dated prefix (`--copy-dest`), so each dated prefix is a complete copy. The job ends with
`rclone check --one-way` per bucket (source objects must exist and match in R2; extra objects in R2 are ignored); any failure fails the job. The job never deletes anything.

## Retention and lock

- R2 bucket lock on prefix `nightly/`: 8 days. An object younger than 8 days cannot be overwritten or deleted.
- Lifecycle rule: objects under `nightly/` are deleted after 14 days.
- Today's copy goes to a new dated prefix, so the first run of a day is never blocked by the lock.
  A same-day re-run writes to the same prefix. `rclone copy --checksum` skips objects that already match,
  so unchanged objects are fine. An object that changed in Supabase since the first run cannot be
  overwritten while it is under the lock, and that bucket's copy fails (the job fails). That is
  expected; the changed object is picked up in the next night's prefix.

## Operator setup (once)

Create the bucket, the lock and lifecycle rules, an Object Read & Write token scoped to the bucket, and
Supabase S3 access keys. Enter them in the "Magora Project" vault first, then in the `backup` GitHub
environment (deployment branches: `main` only):

- secrets: `SUPABASE_S3_ACCESS_KEY_ID`, `SUPABASE_S3_SECRET_ACCESS_KEY`, `R2_ACCESS_KEY_ID`,
  `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`, `R2_BUCKET`
- variable (not a secret): `SUPABASE_S3_REGION`, set from the Supabase dashboard (Storage, S3 connection)

Read back: `gh api repos/{owner}/{repo}/environments/backup` shows the branch policy, and
`gh secret list --env backup` shows the six names.

After the workflow merges, trigger it once with `workflow_dispatch` and read the `rclone check` output.

First-dispatch checksum note: the job uses `--checksum`. Before the first dispatch, run
`rclone md5sum supabase:<bucket>` for each bucket and look for blank hashes. An object without an MD5
is compared by size only. If any appear, David decides whether those buckets drop `--checksum`.

## Restoring objects

Restore with a remote named `restore-target`. Never reuse the backup job's `supabase` remote.
The remote is configured only through environment variables, and the endpoint is written on the
same line as every command that uses it, so nothing stays exported in the shell afterwards. Set the
keys (from the vault; never paste them into a command line or file) and the R2 remote once per shell:

```sh
export RCLONE_CONFIG_RESTORE_TARGET_TYPE=s3
export RCLONE_CONFIG_RESTORE_TARGET_PROVIDER=Other
export RCLONE_CONFIG_RESTORE_TARGET_REGION='<region>'
# RCLONE_CONFIG_RESTORE_TARGET_ACCESS_KEY_ID and ..._SECRET_ACCESS_KEY: set from the vault
export RCLONE_CONFIG_R2_TYPE=s3
export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
export RCLONE_CONFIG_R2_ENDPOINT='https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com'
# RCLONE_CONFIG_R2_ACCESS_KEY_ID and ..._SECRET_ACCESS_KEY: set from the vault
```

Do not export `RCLONE_CONFIG_RESTORE_TARGET_ENDPOINT`. The destination bucket must already exist in
the target project. Use `rclone copy`, never `rclone sync`.

### Before running anything: confirm the ref

1. Read the ref in the endpoint aloud, character by character.
2. Match it against the project's ref in the Supabase dashboard (the scratch project for the rehearsal,
   production for a real restore).
3. If they differ, stop. Do not run the copy.

### Rehearsal (targets the scratch ref)

Replace `<scratch-ref>` with the scratch project's ref, pick `<YYYY-MM-DD>` and `<bucket>`:

```sh
RCLONE_CONFIG_RESTORE_TARGET_ENDPOINT='https://<scratch-ref>.supabase.co/storage/v1/s3' rclone copy "r2:<R2_BUCKET>/nightly/<YYYY-MM-DD>/<bucket>" "restore-target:<bucket>" --checksum
RCLONE_CONFIG_RESTORE_TARGET_ENDPOINT='https://<scratch-ref>.supabase.co/storage/v1/s3' rclone check "r2:<R2_BUCKET>/nightly/<YYYY-MM-DD>/<bucket>" "restore-target:<bucket>" --checksum --one-way
```

### Real restore into production

David approves this restore. Record the approval (who, when, which date and buckets) before starting.
Read the production ref aloud and match it against the production project in the dashboard, then:

```sh
RCLONE_CONFIG_RESTORE_TARGET_ENDPOINT='https://<production ref = wqxmmuwrfltpaxnuddwk>.supabase.co/storage/v1/s3' rclone copy "r2:<R2_BUCKET>/nightly/<YYYY-MM-DD>/<bucket>" "restore-target:<bucket>" --checksum
RCLONE_CONFIG_RESTORE_TARGET_ENDPOINT='https://<production ref = wqxmmuwrfltpaxnuddwk>.supabase.co/storage/v1/s3' rclone check "r2:<R2_BUCKET>/nightly/<YYYY-MM-DD>/<bucket>" "restore-target:<bucket>" --checksum --one-way
```

Replace the whole `<production ref = ...>` placeholder with the bare ref before running.
