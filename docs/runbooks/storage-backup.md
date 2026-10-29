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

In the vault's R2 item, also store the account endpoint, `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`,
as its own field. The restore procedures read it as `<account endpoint field>`.

Read back: `gh api repos/{owner}/{repo}/environments/backup` shows the branch policy, and
`gh secret list --env backup` shows the six names.

After the workflow merges, run the checksum probe below, then trigger the workflow once with
`workflow_dispatch` and read the `rclone check` output.

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
any command prints `REFUSED` or fails, stop and run step 6. The one exception is step 5a's
`rclone check`; step 5a says what to check instead.

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
     'RCLONE_CONFIG_RESTORE_TARGET_NO_CHECK_BUCKET=true' \
     'RCLONE_CONFIG_R2_TYPE=s3' \
     'RCLONE_CONFIG_R2_PROVIDER=Cloudflare' \
     'RCLONE_CONFIG_R2_ENDPOINT="op://Magora Project/<r2 item>/<account endpoint field>"' \
     'RCLONE_CONFIG_R2_ACCESS_KEY_ID="op://Magora Project/<r2 item>/<key id field>"' \
     'RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="op://Magora Project/<r2 item>/<secret field>"' \
     > "$RESTORE_DIR/rclone.env"
   ```

   Do not add a `RESTORE_TARGET_ENDPOINT` line; the endpoint is written on each command. Keep the
   `NO_CHECK_BUCKET` line: without it, `rclone copy` creates a destination bucket that does not exist, so
   a mistyped bucket name is created in production and filled instead of failing.
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

5. For each bucket to restore, find what needs restoring, have David review it, then copy and check only
   those objects. Replace every `<production ref>` placeholder with the bare ref, typed.

   a. Confirm the bucket exists in production. A missing bucket does not make the comparison fail: rclone
      treats it as empty, reports every object as `+`, and downloads the whole backup first. Stop if
      this does not print `lsf exit 0` and then `bucket exists`:

      ```sh
      EP='https://<production ref>.supabase.co/storage/v1/s3'; . "$RESTORE_DIR/guard.sh" && guard_prod_ep "$EP" <production ref> && RCLONE_CONFIG_RESTORE_TARGET_ENDPOINT="$EP" op run --env-file="$RESTORE_DIR/rclone.env" -- rclone lsf --dirs-only "restore_target:" > "$RESTORE_DIR/buckets.txt"; echo "lsf exit $?"
      grep -qx '<bucket>/' "$RESTORE_DIR/buckets.txt" && echo "bucket exists" || echo "REFUSED: production has no bucket <bucket>"
      ```

      Then compare the backup with production by content. This writes one line per backed-up object to
      `<bucket>.combined`: `=` identical, `+` missing in production, `*` present but different, `!` could
      not be read. The first command deletes any `<bucket>.combined` left by an earlier run. The check exits
      non-zero whenever anything is not identical, so its exit status is not the test here. The listing
      must print `lsf exit 0`. Stop if anything prints `REFUSED`, if the listing exit is not 0, or if the
      two counts at the end differ (then the comparison did not cover every object):

      ```sh
      rm -f "$RESTORE_DIR/<bucket>.combined" "$RESTORE_DIR/<bucket>.src"
      EP='https://<production ref>.supabase.co/storage/v1/s3'; . "$RESTORE_DIR/guard.sh" && guard_prod_ep "$EP" <production ref> && RCLONE_CONFIG_RESTORE_TARGET_ENDPOINT="$EP" op run --env-file="$RESTORE_DIR/rclone.env" -- rclone check "r2:<R2_BUCKET>/nightly/<YYYY-MM-DD>/<bucket>" "restore_target:<bucket>" --download --one-way --combined "$RESTORE_DIR/<bucket>.combined"; echo "check exit $?"
      op run --env-file="$RESTORE_DIR/rclone.env" -- rclone lsf -R --files-only "r2:<R2_BUCKET>/nightly/<YYYY-MM-DD>/<bucket>" > "$RESTORE_DIR/<bucket>.src"; echo "lsf exit $?"
      wc -l < "$RESTORE_DIR/<bucket>.src"
      wc -l < "$RESTORE_DIR/<bucket>.combined"
      ```

   b. Split the objects that are not identical into a restore list (`+` and `*`) and an error list (`!`),
      and show both. `sed` exits 0 when it matches nothing, so an empty list is not a failure:

      ```sh
      sed -n 's/^[+*] //p' "$RESTORE_DIR/<bucket>.combined" > "$RESTORE_DIR/<bucket>.files"
      sed -n 's/^! //p' "$RESTORE_DIR/<bucket>.combined" > "$RESTORE_DIR/<bucket>.errors"
      cat "$RESTORE_DIR/<bucket>.files"; echo "restore list: $(wc -l < "$RESTORE_DIR/<bucket>.files")"
      cat "$RESTORE_DIR/<bucket>.errors"; echo "error list: $(wc -l < "$RESTORE_DIR/<bucket>.errors")"
      ```

      This runbook never restores a `!` object: `!` means a read failed on either side, a permission or
      network error reads the same as lost bytes, and restoring a healthy object reverts it. If the error
      list is not empty, run step a and this step b once more, which rebuilds both lists; a transient error
      clears. If the rebuilt error list is still not empty, copy it (printed above) into your notes, because
      step 6 deletes `<bucket>.errors`, then stop and run step 6. David investigates those
      paths by hand and decides any restore of them outside this procedure. An object whose bytes are lost
      in production can appear here, because reading it from production fails.

      If both lists are empty, the bucket needs no restore; skip to the next bucket. Otherwise David
      reviews every line of `<bucket>.files`. A `+` object may have been deleted on purpose after
      `<YYYY-MM-DD>`, and a `*` object may have been changed on purpose after it; restoring either undoes
      that change. David deletes those paths from `<bucket>.files` and records which paths were kept and
      that David approved them.
   c. Copy only the listed objects, then check them by content. The check must exit 0:

      ```sh
      EP='https://<production ref>.supabase.co/storage/v1/s3'; . "$RESTORE_DIR/guard.sh" && guard_prod_ep "$EP" <production ref> && RCLONE_CONFIG_RESTORE_TARGET_ENDPOINT="$EP" op run --env-file="$RESTORE_DIR/rclone.env" -- rclone copy "r2:<R2_BUCKET>/nightly/<YYYY-MM-DD>/<bucket>" "restore_target:<bucket>" --files-from-raw "$RESTORE_DIR/<bucket>.files" --checksum --ignore-times
      EP='https://<production ref>.supabase.co/storage/v1/s3'; . "$RESTORE_DIR/guard.sh" && guard_prod_ep "$EP" <production ref> && RCLONE_CONFIG_RESTORE_TARGET_ENDPOINT="$EP" op run --env-file="$RESTORE_DIR/rclone.env" -- rclone check "r2:<R2_BUCKET>/nightly/<YYYY-MM-DD>/<bucket>" "restore_target:<bucket>" --files-from-raw "$RESTORE_DIR/<bucket>.files" --download --one-way
      ```

   Why this shape: production's `storage.objects` can hold a row for an object whose bytes are gone (the
   live row, or one a database restore put back), and Supabase's S3 API answers listings and HEAD
   requests from those rows, not from the stored bytes. So a size or hash comparison can report a lost
   object as present, and a plain `rclone copy` would skip it; only a content comparison (`--download`)
   tells them apart. Such an object shows as `*` if production returns the wrong bytes, and as `!` if the
   read fails, in which case step b stops and leaves it to David. `--ignore-times` uploads unconditionally (rclone decides this before any size or
   checksum comparison), but over a whole bucket it would rewrite every live object and revert any that
   changed after `<YYYY-MM-DD>`. The reviewed list limits it to the objects that need restoring. Cost:
   step a downloads up to the whole bucket from both R2 and production (a full bucket's worth of Supabase
   egress); step c downloads only the listed objects. A path containing a newline breaks the list
   format; if step b shows a line that is not a whole path, stop.

6. Clean up, and confirm:

   ```sh
   rm -rf "$RESTORE_DIR"
   ls "$RESTORE_DIR" 2>&1
   ```
