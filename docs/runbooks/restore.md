# Restore rehearsal

This proves production can be restored: production data goes into a scratch project, and objects come
back from the R2 Storage backup. Run it once to establish the procedure, then again after any change to
the backup jobs. Storage object details are in `docs/runbooks/storage-backup.md`; this runbook uses its
`restore-target` convention (endpoint written on the command line, never exported) and defines no other.

It needs a POSIX shell (macOS, Linux, or Git Bash or WSL on Windows).

Production's project ref is `wqxmmuwrfltpaxnuddwk`. The scratch project has a different ref.

## Rules

- Secrets are used only through `op run` and `op inject`. Never `op read` or `op item get`, and never
  paste a secret into a command line, file or chat. Env files in this runbook hold `op://` references only.
- Connection strings are `op://` references resolved by `op run`. Quote any reference that contains the
  space in "Magora Project" (or use the vault ID instead).
- Production is reached through the Supavisor pooler, session mode, port 5432, username `postgres.<ref>`.
  The scratch project is reached the same way with its own ref.
- `pg_dump`, `pg_restore` and `psql` must be major version 17, matching the server.
- The dumps hold production data. They live in a `mktemp -d` directory and are deleted at the end.
- **On any stop or error, run "Clean up" step 2 now**, before anything else. Once anything has been restored
  into the scratch project, run "Clean up" steps 1 and 2: the scratch project then holds production
  `auth.users`, so delete it too.

## What this rehearsal proves

A whole-database restore into a new Supabase project aborts on the Supabase-managed schemas (`auth`,
`storage`, `extensions`, `realtime`, publications, event triggers), which the new project already has. So
two scoped dumps are taken:

- (a) the `public` schema, structure and data;
- (b) data only for `auth.users`, `storage.buckets` and `storage.objects`.

(b) is restored first because `public` has foreign keys to `auth.users`. `--no-privileges` drops the
`anon` and `authenticated` GRANTs, so this proves the data restores, not that the app would run on it.

## Before you start

1. Check the tool versions. All must report 17:

   ```sh
   pg_dump --version
   pg_restore --version
   psql --version
   ```

   If not, stop and install PostgreSQL 17 client tools.
2. Make the working directory, and write its path in your notes now, so you can delete it if the shell dies:

   ```sh
   RESTORE_DIR="$(mktemp -d)"
   echo "$RESTORE_DIR"
   ```

3. Create the scratch project (step 1) and note its ref. Then write the references file. It holds
   `op://` references only. The vault items are created by the operator; the item and field names below
   are placeholders to replace:

   ```sh
   printf '%s\n' \
     'PROD_DB_URL="op://Magora Project/<prod db item>/<field>"' \
     'SCRATCH_DB_URL="op://Magora Project/<scratch db item>/<field>"' \
     'SCRATCH_SERVICE_KEY="op://Magora Project/<scratch api item>/<service role field>"' \
     > "$RESTORE_DIR/refs.env"
   printf '%s\n' \
     'RCLONE_CONFIG_RESTORE_TARGET_TYPE=s3' \
     'RCLONE_CONFIG_RESTORE_TARGET_PROVIDER=Other' \
     'RCLONE_CONFIG_RESTORE_TARGET_REGION=<region>' \
     'RCLONE_CONFIG_RESTORE_TARGET_ACCESS_KEY_ID="op://Magora Project/<scratch s3 item>/<key id field>"' \
     'RCLONE_CONFIG_RESTORE_TARGET_SECRET_ACCESS_KEY="op://Magora Project/<scratch s3 item>/<secret field>"' \
     'RCLONE_CONFIG_R2_TYPE=s3' \
     'RCLONE_CONFIG_R2_PROVIDER=Cloudflare' \
     'RCLONE_CONFIG_R2_ENDPOINT="op://Magora Project/<r2 item>/<account endpoint field>"' \
     'RCLONE_CONFIG_R2_ACCESS_KEY_ID="op://Magora Project/<r2 item>/<key id field>"' \
     'RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="op://Magora Project/<r2 item>/<secret field>"' \
     > "$RESTORE_DIR/rclone.env"
   ```

   Do not add a `RESTORE_TARGET_ENDPOINT` line; the endpoint is written on each command.
4. Write the ref guard and the path encoder (the next block, which is unindented so it pastes as is).
   Every command that touches the scratch project calls the guard first, and it refuses to run if the
   target is production or is not the ref you pass. If any command prints `REFUSED`, stop and run
   "Clean up" step 2 (and step 1 if anything was restored).

Paste at the shell, as is:

```sh
cat > "$RESTORE_DIR/guard.sh" <<'GUARD'
guard() {
  case "$SCRATCH_DB_URL" in *wqxmmuwrfltpaxnuddwk*) echo "REFUSED: scratch URL names production" >&2; return 1;; esac
  case "$1" in ""|wqxmmuwrfltpaxnuddwk) echo "REFUSED: bad scratch ref" >&2; return 1;; esac
  case "$SCRATCH_DB_URL" in *"//postgres.$1:"*) ;; *) echo "REFUSED: scratch URL username is not postgres.$1" >&2; return 1;; esac
}
guard_ep() {
  case "$1" in *wqxmmuwrfltpaxnuddwk*) echo "REFUSED: endpoint names production" >&2; return 1;; esac
  case "$2" in ""|wqxmmuwrfltpaxnuddwk) echo "REFUSED: bad scratch ref" >&2; return 1;; esac
  case "$1" in "https://$2.supabase.co/"*) ;; *) echo "REFUSED: endpoint is not the scratch ref $2" >&2; return 1;; esac
}
GUARD
cat > "$RESTORE_DIR/enc.js" <<'ENC'
process.stdout.write(process.argv[2].split("/").map(encodeURIComponent).join("/"));
ENC
```

## 1. Create the scratch project

Create `magora-restore-scratch` in the same Supabase organization, same region and Postgres major version
as production. Note its ref (below, `<scratch-ref>`). Put its pooler connection string, service role key and
Storage S3 keys in the vault items referenced above.

## 2. Dump production

(a) the `public` schema, then (b) the data of the three Supabase-owned tables:

```sh
op run --env-file="$RESTORE_DIR/refs.env" -- sh -c \
  'pg_dump --format=custom --no-owner --no-privileges --schema=public --file="$1/public.dump" "$PROD_DB_URL"' _ "$RESTORE_DIR"
op run --env-file="$RESTORE_DIR/refs.env" -- sh -c \
  'pg_dump --format=custom --data-only --table=auth.users --table=storage.buckets --table=storage.objects --file="$1/supabase-data.dump" "$PROD_DB_URL"' _ "$RESTORE_DIR"
ls -l "$RESTORE_DIR"/*.dump
```

## 3. Restore into the scratch project

### Before running anything: confirm the ref

1. Read the ref in the scratch connection string's username aloud, character by character:

   ```sh
   op run --env-file="$RESTORE_DIR/refs.env" -- sh -c 'printf "%s\n" "${SCRATCH_DB_URL#*//}" | cut -d@ -f1 | cut -d: -f1'
   ```

2. Match it against the ref of `magora-restore-scratch` in the Supabase dashboard.
3. It must not be `wqxmmuwrfltpaxnuddwk`. If it differs from the dashboard or equals production's, stop and
   run "Clean up" step 2.

The restore commands take only `SCRATCH_DB_URL`, never the production URL. Its username must carry the
scratch ref, and the guard enforces that in the same command.

### Restore, (b) first

```sh
op run --env-file="$RESTORE_DIR/refs.env" -- sh -c \
  '. "$2/guard.sh" && guard "$1" && pg_restore --no-owner --no-privileges --dbname="$SCRATCH_DB_URL" "$2/supabase-data.dump"' _ <scratch-ref> "$RESTORE_DIR"
op run --env-file="$RESTORE_DIR/refs.env" -- sh -c \
  '. "$2/guard.sh" && guard "$1" && pg_restore --no-owner --no-privileges --dbname="$SCRATCH_DB_URL" "$2/public.dump"' _ <scratch-ref> "$RESTORE_DIR"
```

Expected errors: `schema "public" already exists` on (a) is benign. No other error is expected. If
the restore reports any other error, David records it (text only, no connection strings) in the
Rehearsals table, the agent beside him adjusts this runbook, and you run "Clean up" step 2. Retry only
after deleting and recreating the scratch project, with a fresh dump.

## 4. Compare row counts

Take both counts within the same hour. One statement, saved once:

```sh
cat > "$RESTORE_DIR/counts.sql" <<'SQL'
select (select count(*) from public.nodes)        as nodes,
       (select count(*) from public.detections)   as detections,
       (select count(*) from public.aci_logs)     as aci_logs,
       (select count(*) from public.species)      as species,
       (select count(*) from public.node_habitat) as node_habitat;
SQL
op run --env-file="$RESTORE_DIR/refs.env" -- sh -c 'psql "$PROD_DB_URL" -X -f "$1/counts.sql"' _ "$RESTORE_DIR"
op run --env-file="$RESTORE_DIR/refs.env" -- sh -c '. "$2/guard.sh" && guard "$1" && psql "$SCRATCH_DB_URL" -X -f "$2/counts.sql"' _ <scratch-ref> "$RESTORE_DIR"
```

Equality is expected, give or take rows production wrote after the dump started. Record every difference.
An unexplained difference (scratch higher than production, or a missing table) is a failed rehearsal;
record it and run "Clean up" step 2.

## 5. Restore 20 objects from R2

The data restore brought back the `storage.buckets` and `storage.objects` rows, not the bytes.

1. Find the newest dated prefix in R2 (`nightly/<latest>/`, the greatest date under
   `r2:<R2_BUCKET>/nightly/`), listing with the same `op run` wrapper as below:

   ```sh
   op run --env-file="$RESTORE_DIR/rclone.env" -- rclone lsf "r2:<R2_BUCKET>/nightly/" --dirs-only
   ```

2. Check the buckets exist in the scratch project. They came from dump (b); none are created by hand:

   ```sh
   op run --env-file="$RESTORE_DIR/refs.env" -- sh -c '. "$2/guard.sh" && guard "$1" && psql "$SCRATCH_DB_URL" -X -c "select id from storage.buckets order by id"' _ <scratch-ref> "$RESTORE_DIR"
   ```

   If a bucket named in the sample (step 3 below) is missing, stop and run "Clean up" step 2.
3. Record 20 rows (`id|bucket_id|name`) from `storage.objects`, only objects created before the latest
   nightly date (`<latest>`), so the R2 copy contains them:

   ```sh
   op run --env-file="$RESTORE_DIR/refs.env" -- sh -c \
     '. "$3/guard.sh" && guard "$1" && psql "$SCRATCH_DB_URL" -X -At -F "|" -c "select id, bucket_id, name from storage.objects where created_at < $2::date order by random() limit 20"' \
     _ <scratch-ref> "'<latest>'" "$RESTORE_DIR" > "$RESTORE_DIR/sample.txt"
   wc -l "$RESTORE_DIR/sample.txt"
   ```

   Expect 20 lines. Turn it into per-bucket file lists:

   ```sh
   awk -F'|' -v d="$RESTORE_DIR" '{print $3 > (d "/" $2 ".files")}' "$RESTORE_DIR/sample.txt"
   ```

4. Read the `<scratch-ref>` in the endpoint aloud and match it against the dashboard, as in step 3. Then,
   for each bucket in the sample, copy only its listed objects. The guard runs in the same command and refuses
   if the endpoint names production or lacks the scratch ref you typed:

   ```sh
   EP='https://<scratch-ref>.supabase.co/storage/v1/s3'; . "$RESTORE_DIR/guard.sh" && guard_ep "$EP" <scratch-ref> && RCLONE_CONFIG_RESTORE_TARGET_ENDPOINT="$EP" op run --env-file="$RESTORE_DIR/rclone.env" -- rclone copy "r2:<R2_BUCKET>/nightly/<latest>/<bucket>" "restore-target:<bucket>" --files-from "$RESTORE_DIR/<bucket>.files" --checksum
   EP='https://<scratch-ref>.supabase.co/storage/v1/s3'; . "$RESTORE_DIR/guard.sh" && guard_ep "$EP" <scratch-ref> && RCLONE_CONFIG_RESTORE_TARGET_ENDPOINT="$EP" op run --env-file="$RESTORE_DIR/rclone.env" -- rclone check "r2:<R2_BUCKET>/nightly/<latest>/<bucket>" "restore-target:<bucket>" --files-from "$RESTORE_DIR/<bucket>.files" --checksum --one-way
   ```

   Use `rclone copy`, never `rclone sync`.
5. An upload through Supabase S3 can upsert the `storage.objects` row, so check the rows are the ones
   restored from the dump. The same 20 ids must still exist; expected result: `20`:

   ```sh
   IDS="$(cut -d'|' -f1 "$RESTORE_DIR/sample.txt" | sed "s/.*/'&'/" | paste -sd, -)"
   op run --env-file="$RESTORE_DIR/refs.env" -- sh -c \
     '. "$3/guard.sh" && guard "$1" && psql "$SCRATCH_DB_URL" -X -At -c "select count(*) from storage.objects where id in ($2)"' _ <scratch-ref> "$IDS" "$RESTORE_DIR"
   ```

6. Download each of the 20 through the Storage API with the scratch service-role key and count the HTTP
   200s; expected result: `20`. Each path segment is percent-encoded (names with spaces, `#`, `?` or `%`
   are real and stay in the sample). The key goes to curl as the `Authorization` and `apikey` headers on
   stdin (`-K -`), never on a command line:

   ```sh
   op run --env-file="$RESTORE_DIR/refs.env" -- sh -c '
     . "$2/guard.sh" && guard "$1" || exit 1
     while IFS="|" read -r id bucket name; do
       path="$(node "$2/enc.js" "$bucket/$name")"
       printf "header = \"Authorization: Bearer %s\"\nheader = \"apikey: %s\"\n" "$SCRATCH_SERVICE_KEY" "$SCRATCH_SERVICE_KEY" |
         curl -s -K - -o /dev/null -w "%{http_code}\n" "https://$1.supabase.co/storage/v1/object/authenticated/$path"
     done < "$2/sample.txt" | grep -c "^200$"' _ <scratch-ref> "$RESTORE_DIR"
   ```

   Anything other than `20` is a failed rehearsal: record which objects failed and run "Clean up" steps 1 and 2.

## 6. Clean up

1. Delete the scratch project in the Supabase dashboard, and remove its vault items.
2. Delete the dumps and temp files, and confirm:

   ```sh
   rm -rf "$RESTORE_DIR"
   ls "$RESTORE_DIR" 2>&1
   ```

## Daily backups

The first daily backup appeared in the Supabase dashboard on: `<YYYY-MM-DD, filled in by the operator>`

## Rehearsals

| Date | Who | Counts (prod / scratch: nodes, detections, aci_logs, species, node_habitat) | Objects resolved (of 20) | Result |
|---|---|---|---|---|
|  |  |  |  |  |
