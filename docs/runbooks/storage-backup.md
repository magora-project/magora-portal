# Storage backup and restore

## What the job copies

`.github/workflows/storage-backup.yml` runs every night at 07:30 UTC (and on manual dispatch, `main` only).
It lists every Supabase Storage bucket and copies each one into the R2 bucket `magora-storage-backup`
under `nightly/<YYYY-MM-DD>/<bucket>/` (UTC date). Unchanged objects are server-side copied from the
newest earlier dated prefix (`--copy-dest`), so each dated prefix is a complete copy. The job ends with
`rclone check` per bucket; any failure fails the job. The job never deletes anything.

## Retention and lock

- R2 bucket lock on prefix `nightly/`: 8 days. An object younger than 8 days cannot be overwritten or deleted.
- Lifecycle rule: objects under `nightly/` are deleted after 14 days.
- Today's copy goes to a new dated prefix, so the lock never blocks the job. A same-day re-run
  writes identical content to the same prefix and compares against the previous day.

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

## Restoring objects

Restore with a remote named `restore-target`. Never reuse the backup job's `supabase` remote.
Configure it only through environment variables, in a shell where the keys are already set
(the keys come from the vault; do not paste them into the command line or a file):

```sh
export RCLONE_CONFIG_RESTORE_TARGET_TYPE=s3
export RCLONE_CONFIG_RESTORE_TARGET_PROVIDER=Other
export RCLONE_CONFIG_RESTORE_TARGET_ENDPOINT='https://<ref>.supabase.co/storage/v1/s3'
export RCLONE_CONFIG_RESTORE_TARGET_REGION='<region>'
# RCLONE_CONFIG_RESTORE_TARGET_ACCESS_KEY_ID and ..._SECRET_ACCESS_KEY: set from the vault

export RCLONE_CONFIG_R2_TYPE=s3
export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
export RCLONE_CONFIG_R2_ENDPOINT='https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com'
# RCLONE_CONFIG_R2_ACCESS_KEY_ID and ..._SECRET_ACCESS_KEY: set from the vault
```

### Before running anything: confirm the ref

1. Read the `<ref>` in the endpoint aloud, character by character.
2. Match it against the scratch project's ref in the Supabase dashboard.
3. If they differ, stop. Do not run the copy.

### Rehearsal (targets the scratch ref)

Replace `<ref>` with the scratch project's ref, pick a date `<YYYY-MM-DD>` and a `<bucket>`, then:

```sh
rclone copy "r2:magora-storage-backup/nightly/<YYYY-MM-DD>/<bucket>" "restore-target:<bucket>" --checksum
rclone check "r2:magora-storage-backup/nightly/<YYYY-MM-DD>/<bucket>" "restore-target:<bucket>" --checksum
```

The destination bucket must already exist in the target project. Use `rclone copy`, never `rclone sync`.

### Real restore into production

David approves this restore. Record the approval (who, when, which date and buckets) before starting.

Run the steps above with `<ref>` set to the production project ref, after the aloud read-and-match
against the production project in the dashboard. The commands are otherwise identical:

```sh
rclone copy "r2:magora-storage-backup/nightly/<YYYY-MM-DD>/<bucket>" "restore-target:<bucket>" --checksum
rclone check "r2:magora-storage-backup/nightly/<YYYY-MM-DD>/<bucket>" "restore-target:<bucket>" --checksum
```
