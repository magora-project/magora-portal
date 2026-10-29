# Storage backup and restore

## What the job copies

`.github/workflows/storage-backup.yml` runs every night at 07:30 UTC (and on manual dispatch, `main` only).
It lists every Supabase Storage bucket and copies each one into the R2 bucket
under `nightly/<YYYY-MM-DD>/<bucket>/` (UTC date). The R2 bucket name is held in the `R2_BUCKET` secret and is `magora-storage-backup`; below it is written `<R2_BUCKET>`. Unchanged objects are server-side copied from the
newest earlier dated prefix (`--copy-dest`). The job ends with
`rclone check --one-way` per bucket (source objects must exist and match in R2; extra objects in R2 are ignored); any failure fails the job. The job never deletes anything.
Only when every bucket's copy and check passed does the job write a completion marker,
`complete/<YYYY-MM-DD>` (holding the run id), named for the prefix it wrote. A prefix with a marker is a
complete copy; a prefix without one may be partial. The marker is outside `nightly/`, so no restore copies
it, and it is not under the lock or the lifecycle rule. Markers outlive their prefixes, so a restore
needs both, and uses a date less than 13 days old: every object in `nightly/<date>/` was written on or
after that date, the lifecycle rule deletes it 14 days after it was written, and the extra day is margin
for the restore. Both restore pickers apply this filter.
An object uploaded between a bucket's copy and its check is missing from R2, so that night's check fails loudly; the next night copies it.

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

First-dispatch checksum note: the job uses `--checksum`, and an object without an MD5 is compared by
size only. Before the first dispatch, count each bucket's objects without an MD5. This only reads
production (`rclone lsf` and `rclone md5sum`). It uses its own remote, `backup_probe` (never
`restore_target` or the job's `supabase`), the Supabase S3 keys through `op run --env-file`, and the
production endpoint written on the command. Replace the placeholders with the region and the vault
item and fields that hold the Supabase S3 keys:

```sh
PROBE_DIR="$(mktemp -d)"
printf '%s\n' \
  'RCLONE_CONFIG_BACKUP_PROBE_TYPE=s3' \
  'RCLONE_CONFIG_BACKUP_PROBE_PROVIDER=Other' \
  'RCLONE_CONFIG_BACKUP_PROBE_REGION=<SUPABASE_S3_REGION>' \
  'RCLONE_CONFIG_BACKUP_PROBE_ACCESS_KEY_ID="op://Magora Project/<supabase s3 item>/<key id field>"' \
  'RCLONE_CONFIG_BACKUP_PROBE_SECRET_ACCESS_KEY="op://Magora Project/<supabase s3 item>/<secret field>"' \
  > "$PROBE_DIR/probe.env"
RCLONE_CONFIG_BACKUP_PROBE_ENDPOINT='https://wqxmmuwrfltpaxnuddwk.supabase.co/storage/v1/s3' op run --env-file="$PROBE_DIR/probe.env" -- sh -c '
  buckets="$(rclone lsf --dirs-only backup_probe:)" || exit 1
  [ -n "$buckets" ] || { echo "no buckets listed" >&2; exit 1; }
  printf "%s\n" "$buckets" | sed "s:/\$::" | while IFS= read -r b; do
    sums="$(rclone md5sum "backup_probe:$b" </dev/null)" || { echo "$b: md5sum FAILED"; continue; }
    [ -n "$sums" ] || { echo "$b: empty"; continue; }
    printf "%s: %s objects, %s without an MD5\n" "$b" "$(printf "%s\n" "$sums" | grep -c .)" "$(printf "%s\n" "$sums" | grep -Evc "^[0-9a-f]{32}  ")"
  done'
rm -rf "$PROBE_DIR"
```

If any bucket shows objects without an MD5, or `md5sum FAILED`, David decides whether those buckets drop
`--checksum`.

## Restoring objects into production

The rehearsal, which copies objects into a scratch project, is `docs/runbooks/restore.md` §5 and is not
repeated here. This section is the real restore into production.

David approves this restore. Record the approval (who, when, which date and buckets) before starting.

It uses the same convention as `docs/runbooks/restore.md`:

- The rclone remote is named `restore_target` (an underscore, not a hyphen: rclone reads
  `RCLONE_CONFIG_RESTORE_TARGET_*` only for a remote name without hyphens). Never reuse the backup
  job's `supabase` remote.
- Its keys reach rclone only through `op run --env-file`, from a file of `op://` references. Never
  `op read`, never `export` a key, never paste one into a command line or file.
- Its endpoint is written on each command, never exported, and a guard in the same command checks it.
  **This guard requires the production ref**: it refuses unless you type `wqxmmuwrfltpaxnuddwk` and the
  endpoint is exactly `https://wqxmmuwrfltpaxnuddwk.supabase.co/storage/v1/s3`. It is the only guard in
  these runbooks that allows production, because this is the only procedure that writes to it.

The destination bucket must already exist in production. Use `rclone copy`, never `rclone sync`. If
any command prints `REFUSED` or fails, stop and run step 6.

1. Make the working directory and write its path in your notes, then write the references file. It
   holds `op://` references only; replace the placeholders with the vault items and fields:

   ```sh
   RESTORE_DIR="$(mktemp -d)"
   echo "$RESTORE_DIR"
   printf '%s\n' \
     'RCLONE_CONFIG_RESTORE_TARGET_TYPE=s3' \
     'RCLONE_CONFIG_RESTORE_TARGET_PROVIDER=Other' \
     'RCLONE_CONFIG_RESTORE_TARGET_REGION=<SUPABASE_S3_REGION>' \
     'RCLONE_CONFIG_RESTORE_TARGET_ACCESS_KEY_ID="op://Magora Project/<supabase s3 item>/<key id field>"' \
     'RCLONE_CONFIG_RESTORE_TARGET_SECRET_ACCESS_KEY="op://Magora Project/<supabase s3 item>/<secret field>"' \
     'RCLONE_CONFIG_R2_TYPE=s3' \
     'RCLONE_CONFIG_R2_PROVIDER=Cloudflare' \
     'RCLONE_CONFIG_R2_ENDPOINT="op://Magora Project/<r2 item>/<account endpoint field>"' \
     'RCLONE_CONFIG_R2_ACCESS_KEY_ID="op://Magora Project/<r2 item>/<key id field>"' \
     'RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="op://Magora Project/<r2 item>/<secret field>"' \
     > "$RESTORE_DIR/rclone.env"
   ```

   Do not add a `RESTORE_TARGET_ENDPOINT` line; the endpoint is written on each command.
2. Write the production guard (the next block, which is unindented so it pastes as is).

Paste at the shell, as is:

```sh
cat > "$RESTORE_DIR/guard.sh" <<'GUARD'
guard_prod_ep() {
  [ "$2" = wqxmmuwrfltpaxnuddwk ] || { echo "REFUSED: this is the production restore; type the production ref" >&2; return 1; }
  [ "$1" = "https://wqxmmuwrfltpaxnuddwk.supabase.co/storage/v1/s3" ] || { echo "REFUSED: endpoint is not https://wqxmmuwrfltpaxnuddwk.supabase.co/storage/v1/s3" >&2; return 1; }
}
GUARD
```

3. Confirm the ref: read the production ref aloud, character by character, and match it against the
   production project in the Supabase dashboard. If they differ, stop. Do not run the copy.
4. Pick `<YYYY-MM-DD>`: a date that has a completion marker `complete/<date>` and a matching
   `nightly/<date>/` prefix, never just the newest prefix. The job writes the marker only after every
   bucket's copy and check passed, under the date of the prefix it actually wrote; a failed night leaves
   a partial prefix and no marker. Markers never expire, but the lifecycle rule deletes `nightly/`
   objects after 14 days, so the list keeps only dates less than 13 days old (UTC calendar days) and
   leaves a day's margin for the restore itself. This lists the marked dates that have a prefix and are
   less than 13 days old, oldest first; pick one of them. If nothing prints (it then exits non-zero),
   there is no usable complete backup: stop.

   ```sh
   op run --env-file="$RESTORE_DIR/rclone.env" -- sh -c '
     dn() { y=$((1${1%%-*} - 10000)); m=${1#*-}; m=$((1${m%-*} - 100)); d=$((1${1##*-} - 100))
       if [ "$m" -le 2 ]; then y=$((y - 1)); fi; e=$((y / 400)); o=$((y - e * 400))
       echo $((e * 146097 + o * 365 + o / 4 - o / 100 + (153 * ((m + 9) % 12) + 2) / 5 + d - 1 - 719468)); }
     re="[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])"
     today="$(date -u +%Y-%m-%d)" || exit 1
     printf "%s\n" "$today" | grep -Eqx "$re" || exit 1
     t=$(dn "$today")
     marks="$(rclone lsf --files-only "r2:$1/complete/")" || exit 1
     dirs="$(rclone lsf --dirs-only "r2:$1/nightly/")" || exit 1
     out="$(printf "%s\n" "$marks" | grep -Ex "$re" | sort | while IFS= read -r d; do
       a=$((t - $(dn "$d")))
       if [ "$a" -ge 0 ] && [ "$a" -lt 13 ] && printf "%s\n" "$dirs" | grep -qx "$d/"; then echo "$d"; fi
     done)"
     [ -n "$out" ] || { echo "no complete backup less than 13 days old" >&2; exit 1; }
     printf "%s\n" "$out"' _ "<R2_BUCKET>"
   ```

5. For each bucket to restore, copy and then check. Replace both `<production ref>` placeholders on each
   line with the bare ref, typed:

   ```sh
   EP='https://<production ref>.supabase.co/storage/v1/s3'; . "$RESTORE_DIR/guard.sh" && guard_prod_ep "$EP" <production ref> && RCLONE_CONFIG_RESTORE_TARGET_ENDPOINT="$EP" op run --env-file="$RESTORE_DIR/rclone.env" -- rclone copy "r2:<R2_BUCKET>/nightly/<YYYY-MM-DD>/<bucket>" "restore_target:<bucket>" --checksum
   EP='https://<production ref>.supabase.co/storage/v1/s3'; . "$RESTORE_DIR/guard.sh" && guard_prod_ep "$EP" <production ref> && RCLONE_CONFIG_RESTORE_TARGET_ENDPOINT="$EP" op run --env-file="$RESTORE_DIR/rclone.env" -- rclone check "r2:<R2_BUCKET>/nightly/<YYYY-MM-DD>/<bucket>" "restore_target:<bucket>" --checksum --one-way
   ```

6. Clean up, and confirm:

   ```sh
   rm -rf "$RESTORE_DIR"
   ls "$RESTORE_DIR" 2>&1
   ```
