# Restore rehearsal

This proves production can be restored: production data goes into a scratch project, and objects come
back from the R2 Storage backup. Run it once to establish the procedure, then again after any change to
the backup jobs. Storage object details are in `docs/runbooks/storage-backup.md`. This runbook uses its
restore convention: an rclone remote named `restore_target` whose keys reach rclone only through
`op run --env-file`, with the endpoint written on each command (never exported) and checked by a guard
in the same command. Here the guard requires the scratch ref; storage-backup.md's production restore
uses the same convention with a guard that requires the production ref.

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

(b) is restored first because `public` has foreign keys to `auth.users`. `public` also depends on
extensions (PostGIS types and functions, `pgmq`), and a `--schema=public` dump does not create them, so
production's extensions are created in the scratch project, each in the schema production has it in,
before the restore.

`--no-privileges` leaves production's GRANT statements out of the dump. It is not known whether the new
project's default privileges grant `anon` and `authenticated` access to the restored tables anyway, so
after the restore that access is revoked on everything in `public`. This proves the data restores, not
that the app would run on it.

## Before you start

1. Check the tool versions. The three Postgres tools must report 17; `node` must be installed (any current version):

   ```sh
   pg_dump --version
   pg_restore --version
   psql --version
   node --version
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

   `guard` accepts only this shape of `SCRATCH_DB_URL`, and refuses everything else:
   `postgresql://postgres.<scratch-ref>:<password>@<host>:5432/postgres`, optionally followed by
   `?sslmode=require` (or `verify-ca`, `verify-full`) and nothing more; `:5432` is required. `<host>` is
   `aws-<N>-<region>.pooler.supabase.com` or `db.<scratch-ref>.supabase.co`. The URL may contain exactly
   one `@` and no `%`, `#`, space or other query parameter, because libpq decodes `%` escapes and
   lets query parameters such as `user=` or `host=` override the parts before them. If the vault's
   password needs percent-encoding, reset the scratch project's database password to one without
   `@ / ? # %`. `guard` also refuses if any of `PGSERVICE`, `PGSERVICEFILE`, `PGOPTIONS`, `PGHOSTADDR`,
   `PGHOST`, `PGPORT`, `PGUSER` or `PGDATABASE` is set, since libpq reads them; unset them first.
   `guard_ep` accepts only the endpoint `https://<scratch-ref>.supabase.co/storage/v1/s3`.

Paste at the shell, as is:

```sh
cat > "$RESTORE_DIR/guard.sh" <<'GUARD'
guard_ref() {
  case "$1" in ""|wqxmmuwrfltpaxnuddwk) echo "REFUSED: bad scratch ref" >&2; return 1;; esac
  case "$1" in *[!abcdefghijklmnopqrstuvwxyz0123456789]*) echo "REFUSED: scratch ref has a character other than a-z 0-9" >&2; return 1;; esac
  [ "${#1}" -eq 20 ] || { echo "REFUSED: scratch ref is not 20 characters" >&2; return 1; }
}
guard() {
  case "$SCRATCH_DB_URL" in *wqxmmuwrfltpaxnuddwk*) echo "REFUSED: scratch URL names production" >&2; return 1;; esac
  guard_ref "$1" || return 1
  for _g_n in PGSERVICE PGSERVICEFILE PGOPTIONS PGHOSTADDR PGHOST PGPORT PGUSER PGDATABASE; do
    eval "_g_v=\${$_g_n-}"; [ -z "$_g_v" ] || { echo "REFUSED: $_g_n is set; unset it" >&2; return 1; }
  done
  case "$SCRATCH_DB_URL" in *[![:graph:]]*) echo "REFUSED: scratch URL has a space or control character" >&2; return 1;; esac
  case "$SCRATCH_DB_URL" in *@*@*) echo "REFUSED: scratch URL has more than one @" >&2; return 1;; esac
  case "$SCRATCH_DB_URL" in *%*|*#*) echo "REFUSED: scratch URL has a % or #" >&2; return 1;; esac
  re='^postgres(ql)?://postgres\.'"$1"'(:[^@/?#%]+)?@(db\.'"$1"'\.supabase\.co|aws-[0-9]+-[a-z]+-[a-z]+-[0-9]+\.pooler\.supabase\.com):5432/postgres(\?sslmode=(require|verify-ca|verify-full))?$'
  printf '%s\n' "$SCRATCH_DB_URL" | grep -Eq "$re" || { echo "REFUSED: scratch URL is not postgresql://postgres.$1:<password>@<scratch host>:5432/postgres[?sslmode=require]" >&2; return 1; }
}
guard_ep() {
  case "$1" in *wqxmmuwrfltpaxnuddwk*) echo "REFUSED: endpoint names production" >&2; return 1;; esac
  guard_ref "$2" || return 1
  [ "$1" = "https://$2.supabase.co/storage/v1/s3" ] || { echo "REFUSED: endpoint is not https://$2.supabase.co/storage/v1/s3" >&2; return 1; }
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

Everything in this step only reads production. Save the row-count query and the extension list query:

```sh
cat > "$RESTORE_DIR/counts.sql" <<'SQL'
select (select count(*) from public.nodes),
       (select count(*) from public.detections),
       (select count(*) from public.aci_logs),
       (select count(*) from public.species),
       (select count(*) from public.node_habitat);
SQL
cat > "$RESTORE_DIR/list-extensions.sql" <<'SQL'
select case when n.nspname like 'pg\_%' then '' else format('create schema if not exists %I; ', n.nspname) end
       || format('create extension if not exists %I with schema %I;', e.extname, n.nspname)
from pg_extension e join pg_namespace n on n.oid = e.extnamespace
order by e.oid;
SQL
```

Count production's rows immediately before the dump, list its extensions (one line each, in creation
order so dependencies come first; the schema is created first because `create extension ... with schema`
requires it to exist, except a reserved `pg_` schema such as `pg_catalog`, which always exists and
cannot be named in `create schema`), take (a) the `public` schema and (b) the data of the three Supabase-owned
tables, then count again immediately after:

```sh
op run --env-file="$RESTORE_DIR/refs.env" -- sh -c \
  'psql "$PROD_DB_URL" -X -At -F "|" -v ON_ERROR_STOP=1 -f "$1/counts.sql"' _ "$RESTORE_DIR" > "$RESTORE_DIR/counts-before.txt"
op run --env-file="$RESTORE_DIR/refs.env" -- sh -c \
  'psql "$PROD_DB_URL" -X -At -v ON_ERROR_STOP=1 -f "$1/list-extensions.sql"' _ "$RESTORE_DIR" > "$RESTORE_DIR/extensions.sql"
op run --env-file="$RESTORE_DIR/refs.env" -- sh -c \
  'pg_dump --format=custom --no-owner --no-privileges --schema=public --file="$1/public.dump" "$PROD_DB_URL"' _ "$RESTORE_DIR"
op run --env-file="$RESTORE_DIR/refs.env" -- sh -c \
  'pg_dump --format=custom --data-only --table=auth.users --table=storage.buckets --table=storage.objects --file="$1/supabase-data.dump" "$PROD_DB_URL"' _ "$RESTORE_DIR"
op run --env-file="$RESTORE_DIR/refs.env" -- sh -c \
  'psql "$PROD_DB_URL" -X -At -F "|" -v ON_ERROR_STOP=1 -f "$1/counts.sql"' _ "$RESTORE_DIR" > "$RESTORE_DIR/counts-after.txt"
ls -l "$RESTORE_DIR"/*.dump
cat "$RESTORE_DIR/counts-before.txt" "$RESTORE_DIR/counts-after.txt" "$RESTORE_DIR/extensions.sql"
```

Expect one line of five numbers in each counts file, and one line per production extension, of the
form `create schema if not exists <schema>; create extension if not exists <extension> with schema <schema>;`
(for a `pg_` schema, the `create extension` part only).
Check that `postgis` and `pgmq` appear.

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

### Extensions, then the restore with (b) first, then revoke

Create production's extensions, restore (b) then (a), and revoke `anon` and `authenticated` access to
`public`. The Storage API in step 5 uses the service role key, which these revokes do not touch:

```sh
cat > "$RESTORE_DIR/revoke.sql" <<'SQL'
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
SQL
op run --env-file="$RESTORE_DIR/refs.env" -- sh -c \
  '. "$2/guard.sh" && guard "$1" && psql "$SCRATCH_DB_URL" -X -v ON_ERROR_STOP=1 -f "$2/extensions.sql"' _ <scratch-ref> "$RESTORE_DIR"
op run --env-file="$RESTORE_DIR/refs.env" -- sh -c \
  '. "$2/guard.sh" && guard "$1" && pg_restore --no-owner --no-privileges --dbname="$SCRATCH_DB_URL" "$2/supabase-data.dump"' _ <scratch-ref> "$RESTORE_DIR"
op run --env-file="$RESTORE_DIR/refs.env" -- sh -c \
  '. "$2/guard.sh" && guard "$1" && pg_restore --no-owner --no-privileges --dbname="$SCRATCH_DB_URL" "$2/public.dump"' _ <scratch-ref> "$RESTORE_DIR"
op run --env-file="$RESTORE_DIR/refs.env" -- sh -c \
  '. "$2/guard.sh" && guard "$1" && psql "$SCRATCH_DB_URL" -X -v ON_ERROR_STOP=1 -f "$2/revoke.sql"' _ <scratch-ref> "$RESTORE_DIR"
```

Expected messages: `schema "..." already exists, skipping` and `extension "..." already exists, skipping`
notices from the extensions step, and
`schema "public" already exists` on (a), are benign. No other error is expected. If the extensions
step or the revoke step fails, or the restore reports any other error, David records it (text only, no
connection strings) in the Rehearsals table, the agent beside him adjusts this runbook, and you run
"Clean up" steps 1 and 2. Retry only after deleting and recreating the scratch project, with a fresh dump.

## 4. Compare row counts

Count the scratch project with the same query, then compare. Each table passes only if
before <= scratch <= after, using the production counts taken around the dump in step 2:

```sh
op run --env-file="$RESTORE_DIR/refs.env" -- sh -c \
  '. "$2/guard.sh" && guard "$1" && psql "$SCRATCH_DB_URL" -X -At -F "|" -v ON_ERROR_STOP=1 -f "$2/counts.sql"' _ <scratch-ref> "$RESTORE_DIR" > "$RESTORE_DIR/counts-scratch.txt"
awk -F'|' '
  FNR == 1 { f++ }
  { lines++; if ($0 !~ /^[0-9]+[|][0-9]+[|][0-9]+[|][0-9]+[|][0-9]+$/) bad = 1; for (i = 1; i <= 5; i++) v[f, i] = $i + 0 }
  END {
    if (f != 3 || lines != 3 || bad) { print "FAIL: each counts file must hold one line of five numbers"; exit 1 }
    split("nodes detections aci_logs species node_habitat", t, " ")
    for (i = 1; i <= 5; i++) {
      ok = (v[1, i] <= v[3, i] && v[3, i] <= v[2, i])
      printf "%-13s before %s  scratch %s  after %s  %s\n", t[i], v[1, i], v[3, i], v[2, i], (ok ? "PASS" : "FAIL")
      if (!ok) failed = 1
    }
    exit failed + 0
  }' "$RESTORE_DIR/counts-before.txt" "$RESTORE_DIR/counts-after.txt" "$RESTORE_DIR/counts-scratch.txt"
```

Record the three numbers for every table. Any `FAIL` line (a table outside its before/after range, an
empty or malformed counts file, or a failed count) is a failed rehearsal: record it and run "Clean up"
steps 1 and 2.

## 5. Restore 20 objects from R2

The data restore brought back the `storage.buckets` and `storage.objects` rows, not the bytes.

1. Pick `<latest>`: the newest date whose `storage-backup` run succeeded, never just the newest prefix.
   A prefix is a complete copy only for a night whose run succeeded; a failed night leaves a partial
   one. List the successful runs' UTC dates, then the prefixes, and take the newest date that appears
   in both:

   ```sh
   gh run list --workflow storage-backup.yml --branch main --status success --limit 20 --json createdAt --jq '.[].createdAt[0:10]'
   op run --env-file="$RESTORE_DIR/rclone.env" -- rclone lsf "r2:<R2_BUCKET>/nightly/" --dirs-only
   ```

2. Check the buckets exist in the scratch project. They came from dump (b); none are created by hand:

   ```sh
   op run --env-file="$RESTORE_DIR/refs.env" -- sh -c '. "$2/guard.sh" && guard "$1" && psql "$SCRATCH_DB_URL" -X -c "select id from storage.buckets order by id"' _ <scratch-ref> "$RESTORE_DIR"
   ```

   If a bucket named in the sample (step 3 below) is missing, stop and run "Clean up" steps 1 and 2.
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
   EP='https://<scratch-ref>.supabase.co/storage/v1/s3'; . "$RESTORE_DIR/guard.sh" && guard_ep "$EP" <scratch-ref> && RCLONE_CONFIG_RESTORE_TARGET_ENDPOINT="$EP" op run --env-file="$RESTORE_DIR/rclone.env" -- rclone copy "r2:<R2_BUCKET>/nightly/<latest>/<bucket>" "restore_target:<bucket>" --files-from-raw "$RESTORE_DIR/<bucket>.files" --checksum
   EP='https://<scratch-ref>.supabase.co/storage/v1/s3'; . "$RESTORE_DIR/guard.sh" && guard_ep "$EP" <scratch-ref> && RCLONE_CONFIG_RESTORE_TARGET_ENDPOINT="$EP" op run --env-file="$RESTORE_DIR/rclone.env" -- rclone check "r2:<R2_BUCKET>/nightly/<latest>/<bucket>" "restore_target:<bucket>" --files-from-raw "$RESTORE_DIR/<bucket>.files" --checksum --one-way
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

| Date | Who | Counts (before / scratch / after: nodes, detections, aci_logs, species, node_habitat) | Objects resolved (of 20) | Result |
|---|---|---|---|---|
|  |  |  |  |  |
