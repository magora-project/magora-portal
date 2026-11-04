# Restore rehearsal

This rehearses the restore procedure and checks a sample of the result: production data goes into a
scratch project and is compared by row counts for five tables, and up to 20 sampled objects come back
from the R2 Storage backup. A pass shows the procedure works; it does not prove every row and object
is recoverable. Run it once to establish the procedure, then again after any change to
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

`--no-privileges` leaves production's GRANT and REVOKE statements out of the dump. So on scratch, every
restored function would keep PostgreSQL's default `EXECUTE` for `PUBLIC` (production's `revoke ... from
public` is not restored), and the new project's default privileges may grant `anon` and `authenticated`
access to restored tables. Row level security is enabled only in the dump's last section, after the data
is committed. So access is closed before any data is restored: step 3 first grants `USAGE` and `CREATE`
on `public` to the connecting role explicitly, so the restore does not depend on `PUBLIC`, then revokes `USAGE` on schema
`public` from `PUBLIC`, `anon` and `authenticated` (without it they cannot reach any object in `public`,
whatever its own grants), revokes the `postgres` role's default privileges in `public` from the same
three, and stops if `anon` or `authenticated` still has `USAGE` or the connecting role lacks either
`USAGE` or `CREATE`. From then on, including while a restore
is running or if it is interrupted, those roles cannot read restored tables or call restored functions.
After the restore, all privileges on every table, sequence and function in `public` are also revoked
from the same three. Grants to other roles, and objects outside `public` (including the `auth` and
`storage` rows from (b), which keep Supabase's own grants and policies), are not changed. This proves the
data restores, not that the app would run on it.

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
     'RCLONE_CONFIG_RESTORE_TARGET_LIST_VERSION=2' \
     'RCLONE_CONFIG_RESTORE_TARGET_REGION=<region>' \
     'RCLONE_CONFIG_RESTORE_TARGET_ACCESS_KEY_ID="op://Magora Project/<scratch s3 item>/<key id field>"' \
     'RCLONE_CONFIG_RESTORE_TARGET_SECRET_ACCESS_KEY="op://Magora Project/<scratch s3 item>/<secret field>"' \
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
   a mistyped bucket name is created and filled instead of failing.
4. Write the ref guard, the path encoder and the header fetcher used in §5 step 7 (the next block,
   which is unindented so it pastes as is).
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
cat > "$RESTORE_DIR/heads.sh" <<'HEADS'
# sh heads.sh <ref> <dir>, key in HEADS_KEY. Prints id|status|content-type|cache-control per sampled object.
while IFS="|" read -r id bucket name; do
  path="$(node "$2/enc.js" "$bucket/$name")"
  printf 'header = "Authorization: Bearer %s"\nheader = "apikey: %s"\n' "$HEADS_KEY" "$HEADS_KEY" |
    curl -s -K - -o /dev/null -w "$id|%{http_code}|%header{content-type}|%header{cache-control}\n" \
      "https://$1.supabase.co/storage/v1/object/authenticated/$path"
done < "$2/sample.txt"
HEADS
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

### Close `public`, create extensions, restore with (b) first, then revoke

First, before any data, grant `USAGE` and `CREATE` on schema `public` to the connecting role
explicitly (so it never depends on `PUBLIC`), close `public` to `PUBLIC`, `anon` and `authenticated`,
and check it (the check stops with `LOCKDOWN FAILED` if either role still has `USAGE`, or if the
connecting role lacks either `USAGE` or `CREATE` on `public`; the restore needs both). Then create production's extensions,
restore (b) then (a), and revoke all privileges on the tables, sequences and functions in `public` from
the same three. Every later step that reads `public` (the row counts) connects as the scratch
`postgres` role, which keeps its access. Step 5 reads objects through the Storage API with the service
role key; none of this changes anything outside schema `public`:

```sh
cat > "$RESTORE_DIR/lockdown.sql" <<'SQL'
grant usage, create on schema public to current_user;
revoke usage on schema public from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from public, anon, authenticated;
do $$ begin
  if has_schema_privilege('anon', 'public', 'USAGE') or has_schema_privilege('authenticated', 'public', 'USAGE') then
    raise exception 'LOCKDOWN FAILED: anon or authenticated still has USAGE on schema public';
  end if;
  if not has_schema_privilege(current_user, 'public', 'USAGE')
     or not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise exception 'LOCKDOWN FAILED: % lacks USAGE or CREATE on schema public', current_user;
  end if;
end $$;
SQL
cat > "$RESTORE_DIR/revoke.sql" <<'SQL'
revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
SQL
echo "== before step 1: list (a)" &&
pg_restore -l "$RESTORE_DIR/public.dump" > "$RESTORE_DIR/public.full.list" &&
grep -v -E '^[0-9]+; [0-9]+ [0-9]+ SCHEMA - public ' "$RESTORE_DIR/public.full.list" > "$RESTORE_DIR/public.list" &&
echo "== step 1 of 5: lockdown" &&
op run --env-file="$RESTORE_DIR/refs.env" -- sh -c \
  '. "$2/guard.sh" && guard "$1" && psql "$SCRATCH_DB_URL" -X -v ON_ERROR_STOP=1 -f "$2/lockdown.sql"' _ <scratch-ref> "$RESTORE_DIR" &&
echo "== step 2 of 5: extensions" &&
op run --env-file="$RESTORE_DIR/refs.env" -- sh -c \
  '. "$2/guard.sh" && guard "$1" && psql "$SCRATCH_DB_URL" -X -v ON_ERROR_STOP=1 -f "$2/extensions.sql"' _ <scratch-ref> "$RESTORE_DIR" &&
echo "== step 3 of 5: restore (b) auth and storage rows" &&
op run --env-file="$RESTORE_DIR/refs.env" -- sh -c \
  '. "$2/guard.sh" && guard "$1" && pg_restore --no-owner --no-privileges --dbname="$SCRATCH_DB_URL" "$2/supabase-data.dump"' _ <scratch-ref> "$RESTORE_DIR" &&
echo "== step 4 of 5: restore (a) public" &&
op run --env-file="$RESTORE_DIR/refs.env" -- sh -c \
  '. "$2/guard.sh" && guard "$1" && pg_restore --no-owner --no-privileges --use-list="$2/public.list" --dbname="$SCRATCH_DB_URL" "$2/public.dump"' _ <scratch-ref> "$RESTORE_DIR" &&
echo "== step 5 of 5: revoke" &&
op run --env-file="$RESTORE_DIR/refs.env" -- sh -c \
  '. "$2/guard.sh" && guard "$1" && psql "$SCRATCH_DB_URL" -X -v ON_ERROR_STOP=1 -f "$2/revoke.sql"' _ <scratch-ref> "$RESTORE_DIR" &&
echo "== all 5 steps done" ||
{ echo "RESTORE STOPPED at the last '==' line above; nothing after it ran. Follow the paragraph below this block."; false; }
```

The commands are chained with `&&`, so a failure stops the run at that step: the last `==` line
printed names it (`== before step 1` if listing (a) failed), and `RESTORE STOPPED` follows.
`pg_restore` exits non-zero on any error it skips past, so every step must run clean. That is why (a) is restored from `public.list`: the dump's own
`CREATE SCHEMA public` entry is left out (the scratch project already has `public`), which would
otherwise fail with `schema "public" already exists` on every rehearsal and stop the run before the
revoke step. The comment on `public` is still restored. The listing is written to `public.full.list`
first and filtered from that file, so a failed `pg_restore -l` (not only a failed filter or write)
stops the run before step 1, with `== before step 1: list (a)` as the last `==` line. Nothing has
been restored then, so the rule at the top applies as written: run "Clean up" step 2 only. The
scratch project is untouched and can be kept. Fix the cause (usually a missing or truncated
`public.dump`), then start again from "Before you start" step 2 (a new working directory, the
references file against the same scratch ref, the guard), then §2 in full, so the counts still
bracket the dumps, then §3.

Expected messages: `schema "..." already exists, skipping` and `extension "..." already exists, skipping`
notices from the extensions step are benign. No error is expected from any step. If the lockdown step
prints `LOCKDOWN FAILED` or fails in any way, stop before restoring anything and run "Clean up" step 2
(and step 1, since the project is suspect). If the extensions step, either restore step or the revoke step fails, David records it (text only, no
connection strings) in the Rehearsals table, the agent beside him adjusts this runbook, and you run
"Clean up" steps 1 and 2. Retry only after deleting and recreating the scratch project, with a fresh dump.

One such failure is expected now and then, and is not a runbook defect: the two dumps are taken
separately while production stays writable, so a user deleted between them leaves `public` rows
pointing at an `auth.users` row the second dump does not hold. The `== step 4 of 5` line (restoring
(a)) then fails with a foreign-key violation naming a user column (for example `user_id`, `owner_id`
or `id`). Record it and retry as above, with
fresh dumps (David, 2026-11-03: accepted rather than taking both dumps from one snapshot).

## 4. Compare row counts

Count the scratch project with the same query, then compare. Each table passes only if its scratch
count lies between the production counts taken before and after the dump in step 2, in either order
(production stays writable, so a count can fall as well as rise):

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
      lo = (v[1, i] < v[2, i]) ? v[1, i] : v[2, i]; hi = (v[1, i] < v[2, i]) ? v[2, i] : v[1, i]
      ok = (lo <= v[3, i] && v[3, i] <= hi)
      printf "%-13s before %s  scratch %s  after %s  %s\n", t[i], v[1, i], v[3, i], v[2, i], (ok ? "PASS" : "FAIL")
      if (!ok) failed = 1
    }
    exit failed + 0
  }' "$RESTORE_DIR/counts-before.txt" "$RESTORE_DIR/counts-after.txt" "$RESTORE_DIR/counts-scratch.txt"
```

Record the three numbers for every table. Any `FAIL` line (a table outside its before/after range, an
empty or malformed counts file, or a failed count) is a failed rehearsal: record it and run "Clean up"
steps 1 and 2. The range is a bound from two endpoints, not the dump's snapshot: if rows were both
added and deleted while the dump ran, a correct dump can fall just outside it. A `FAIL` by a few rows
on a busy table is then most likely that, so record it and rehearse again with fresh dumps before
treating it as a restore defect.

## 5. Restore up to 20 objects from R2

The data restore brought back the `storage.buckets` and `storage.objects` rows, not the bytes.

1. Pick `<latest>`: the newest date that has a completion marker `complete/<date>` and a matching
   `nightly/<date>/` prefix, never just the newest prefix. The job writes the marker only after every
   bucket's copy and check passed, under the date of the prefix it actually wrote. A night whose copy or
   check failed can leave a partial prefix and no marker. A night whose final marker write failed
   leaves a complete prefix with no marker; it is still not used, because without the marker the
   prefix cannot be told apart from a partial one. Markers never expire, but the lifecycle rule deletes `nightly/`
   objects after 14 days, so the list keeps only dates less than 13 days old (UTC calendar days) and
   leaves a day's margin for the restore itself. This lists the marked dates that have a prefix and are
   less than 13 days old, oldest first; take the last line. If nothing prints (it then exits non-zero),
   there is no usable complete backup: stop and run "Clean up" steps 1 and 2 (§3 has already restored
   production data into the scratch project).

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

2. Check the buckets exist in the scratch project. They came from dump (b); none are created by hand:

   ```sh
   op run --env-file="$RESTORE_DIR/refs.env" -- sh -c '. "$2/guard.sh" && guard "$1" && psql "$SCRATCH_DB_URL" -X -c "select id from storage.buckets order by id"' _ <scratch-ref> "$RESTORE_DIR"
   ```

   If a bucket named in the sample (step 3 below) is missing, stop and run "Clean up" steps 1 and 2.
3. Record up to 20 rows (`id|bucket_id|name`) from `storage.objects`, only objects created before the
   latest nightly date (`<latest>`), so the R2 copy contains them:

   ```sh
   op run --env-file="$RESTORE_DIR/refs.env" -- sh -c \
     '. "$3/guard.sh" && guard "$1" && psql "$SCRATCH_DB_URL" -X -At -F "|" -v ON_ERROR_STOP=1 -c "select id, bucket_id, name from storage.objects where created_at < $2::date order by random() limit 20"' \
     _ <scratch-ref> "'<latest>'" "$RESTORE_DIR" > "$RESTORE_DIR/sample.txt"; echo "sample exit $?"
   op run --env-file="$RESTORE_DIR/refs.env" -- sh -c \
     '. "$3/guard.sh" && guard "$1" && psql "$SCRATCH_DB_URL" -X -At -v ON_ERROR_STOP=1 -c "select least(count(*), 20) from storage.objects where created_at < $2::date"' \
     _ <scratch-ref> "'<latest>'" "$RESTORE_DIR"; echo "count exit $?"
   wc -l < "$RESTORE_DIR/sample.txt"
   ```

   Both exits must be `0`, and the line count must equal the number the second command prints (the
   restored dump's eligible objects, capped at 20). That number is N, the sample size the later steps
   check against; write it in your notes. (Production held only 9 objects on 2026-11-03, so N below
   20 is normal.) A non-zero exit or a mismatch is a failed rehearsal. N of `0` means no object would be
   read back, so the rehearsal cannot pass either; if the count is genuinely `0` (every object is
   newer than `<latest>`), retry after the next marked night. In each case record it and run "Clean
   up" steps 1 and 2. Turn the sample into
   per-bucket file lists:

   ```sh
   awk -F'|' -v d="$RESTORE_DIR" '{print $3 > (d "/" $2 ".files")}' "$RESTORE_DIR/sample.txt"
   ```

   Then rehearse the production comparison (`docs/runbooks/storage-backup.md`, "Restoring objects into
   production", steps 5a and 5b) on the sampled objects, so it has run before an incident needs it. The
   commands are the production ones with the scratch guard, the `<latest>` date, and
   `--files-from-raw` to keep the download to the sample. The restore and error lists are written to
   `.restore` and `.errors`, so they do not overwrite the sample's `.files`. For each bucket in the
   sample:

   ```sh
   rm -f "$RESTORE_DIR/<bucket>.combined" "$RESTORE_DIR/<bucket>.src"
   EP='https://<scratch-ref>.supabase.co/storage/v1/s3'; . "$RESTORE_DIR/guard.sh" && guard_ep "$EP" <scratch-ref> && RCLONE_CONFIG_RESTORE_TARGET_ENDPOINT="$EP" op run --env-file="$RESTORE_DIR/rclone.env" -- rclone check "r2:<R2_BUCKET>/nightly/<latest>/<bucket>" "restore_target:<bucket>" --files-from-raw "$RESTORE_DIR/<bucket>.files" --download --one-way --combined "$RESTORE_DIR/<bucket>.combined"; echo "check exit $?"
   op run --env-file="$RESTORE_DIR/rclone.env" -- rclone lsf -R --files-only "r2:<R2_BUCKET>/nightly/<latest>/<bucket>" --files-from-raw "$RESTORE_DIR/<bucket>.files" > "$RESTORE_DIR/<bucket>.src"; echo "lsf exit $?"
   wc -l < "$RESTORE_DIR/<bucket>.files"; wc -l < "$RESTORE_DIR/<bucket>.src"; wc -l < "$RESTORE_DIR/<bucket>.combined"
   sed -n 's/^[+*] //p' "$RESTORE_DIR/<bucket>.combined" > "$RESTORE_DIR/<bucket>.restore"
   sed -n 's/^! //p' "$RESTORE_DIR/<bucket>.combined" > "$RESTORE_DIR/<bucket>.errors"
   cut -c1 "$RESTORE_DIR/<bucket>.combined" | sort | uniq -c
   ```

   The check exits non-zero here, as in production. Expect `lsf exit 0`, three equal counts, and no `=`
   line: the rows were restored but the bytes were not. Record how many objects came out as `*`, `+`
   and `!` in the Rehearsals table; which symbol Supabase gives an object that has a row but no bytes
   has not been observed before. A `REFUSED`, a listing exit other than 0, unequal counts, or any `=`
   line is a failed rehearsal: record it and run "Clean up" steps 1 and 2.
   One cause of unequal counts (`.src` shorter than `.files`) is not a backup defect: an object moved
   or renamed after that night's copy ran keeps its `created_at`, so step 3 samples its new path, while
   the copy holds it under the old one. If the missing objects are such moves, record that and
   rehearse again after the next marked night, which copies the new path.

4. Read the `<scratch-ref>` in the endpoint aloud and match it against the dashboard, as in step 3. Then,
   for each bucket in the sample, copy only its listed objects. The guard runs in the same command and refuses
   if the endpoint names production or lacks the scratch ref you typed:

   ```sh
   EP='https://<scratch-ref>.supabase.co/storage/v1/s3'; . "$RESTORE_DIR/guard.sh" && guard_ep "$EP" <scratch-ref> && RCLONE_CONFIG_RESTORE_TARGET_ENDPOINT="$EP" op run --env-file="$RESTORE_DIR/rclone.env" -- rclone copy "r2:<R2_BUCKET>/nightly/<latest>/<bucket>" "restore_target:<bucket>" --files-from-raw "$RESTORE_DIR/<bucket>.files" --checksum --ignore-times
   EP='https://<scratch-ref>.supabase.co/storage/v1/s3'; . "$RESTORE_DIR/guard.sh" && guard_ep "$EP" <scratch-ref> && RCLONE_CONFIG_RESTORE_TARGET_ENDPOINT="$EP" op run --env-file="$RESTORE_DIR/rclone.env" -- rclone check "r2:<R2_BUCKET>/nightly/<latest>/<bucket>" "restore_target:<bucket>" --files-from-raw "$RESTORE_DIR/<bucket>.files" --download --one-way
   ```

   Use `rclone copy`, never `rclone sync`. The data restore already put each object's size and ETag in
   `storage.objects`, and Supabase's S3 API answers listings and HEAD requests from those rows, not from
   the stored bytes. So without `--ignore-times`, `rclone copy` would see a matching object and skip the
   upload, and a hash-based `rclone check` would pass with the bytes missing. `--ignore-times` uploads
   every listed object unconditionally (rclone decides this before any size or checksum comparison), and
   `rclone check --download` reads the content of each object from both sides and compares it, so it
   never trusts the destination's metadata.

   Then run step 3's comparison block again for each bucket. Now every line must be `=`: this shows
   the production comparison reports a restored object as identical. Any other line is a failed
   rehearsal: record it and run "Clean up" steps 1 and 2.
5. An upload through Supabase S3 can upsert the `storage.objects` row, so check the rows are the ones
   restored from the dump. The same N ids must still exist; expected result: N:

   ```sh
   IDS="$(cut -d'|' -f1 "$RESTORE_DIR/sample.txt" | sed "s/.*/'&'/" | paste -sd, -)"
   op run --env-file="$RESTORE_DIR/refs.env" -- sh -c \
     '. "$3/guard.sh" && guard "$1" && psql "$SCRATCH_DB_URL" -X -At -c "select count(*) from storage.objects where id in ($2)"' _ <scratch-ref> "$IDS" "$RESTORE_DIR"
   ```

6. Download each of the N through the Storage API with the scratch service-role key and count the HTTP
   200s; expected result: N. Each path segment is percent-encoded (names with spaces, `#`, `?` or `%`
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

   Anything other than N is a failed rehearsal: record which objects failed and run "Clean up" steps 1 and 2.
7. Check the restored objects are served with production's `Content-Type` and `Cache-Control`. The
   backup and restore copies run without `-M`, so rclone carries the content type but not other
   metadata; this was accepted on 2026-11-03, when every production object had Supabase's default
   `max-age=3600` and no custom metadata (PR #46). This step shows whether a restore still serves the
   same headers. Supabase can change headers when it serves an object (for example, it serves
   `text/html` as `text/plain`), so the stored metadata is not compared: the same request is made to
   both projects and the served headers are compared. The production requests are reads (GET) with
   production's service-role key. That key is in its own env file, `prod-read.env`, used only by the
   first command below, so no other command in this runbook resolves it.

   If the two projects run different Storage versions, a header difference may come from the version
   and not the restore. Record both versions in the Rehearsals row (the endpoint needs no key):

   ```sh
   curl -s https://wqxmmuwrfltpaxnuddwk.supabase.co/storage/v1/version; echo " production"
   curl -s https://<scratch-ref>.supabase.co/storage/v1/version; echo " scratch"
   ```

   If they differ, still run the step, but attribute a header difference to the restore only after
   the version difference is ruled out.

   `heads.sh` was written in "Before you start" step 4.

   ```sh
   printf '%s\n' 'PROD_SERVICE_KEY="op://Magora Project/supabase/SUPABASE_SERVICE_ROLE_KEY"' > "$RESTORE_DIR/prod-read.env"
   op run --env-file="$RESTORE_DIR/prod-read.env" -- sh -c \
     'HEADS_KEY="$PROD_SERVICE_KEY" sh "$1/heads.sh" wqxmmuwrfltpaxnuddwk "$1"' _ "$RESTORE_DIR" \
     > "$RESTORE_DIR/heads-prod.raw"; echo "prod exit $?"
   op run --env-file="$RESTORE_DIR/refs.env" -- sh -c \
     '. "$2/guard.sh" && guard "$1" && HEADS_KEY="$SCRATCH_SERVICE_KEY" sh "$2/heads.sh" "$1" "$2"' _ <scratch-ref> "$RESTORE_DIR" \
     > "$RESTORE_DIR/heads-scratch.raw"; echo "scratch exit $?"
   LC_ALL=C sort "$RESTORE_DIR/heads-prod.raw" > "$RESTORE_DIR/heads-prod.txt"
   LC_ALL=C sort "$RESTORE_DIR/heads-scratch.raw" > "$RESTORE_DIR/heads-scratch.txt"
   wc -l < "$RESTORE_DIR/heads-prod.txt"; wc -l < "$RESTORE_DIR/heads-scratch.txt"
   printf 'non-200: %s\n' "$(cut -d'|' -f2 "$RESTORE_DIR/heads-prod.txt" "$RESTORE_DIR/heads-scratch.txt" | grep -cvx 200)"
   cut -d'|' -f1-3 "$RESTORE_DIR/heads-prod.txt" > "$RESTORE_DIR/types-prod.txt"
   cut -d'|' -f1-3 "$RESTORE_DIR/heads-scratch.txt" > "$RESTORE_DIR/types-scratch.txt"
   diff "$RESTORE_DIR/types-prod.txt" "$RESTORE_DIR/types-scratch.txt"; echo "type diff exit $?"
   diff "$RESTORE_DIR/heads-prod.txt" "$RESTORE_DIR/heads-scratch.txt"; echo "full diff exit $?"
   ```

   The exits only show each loop ran: curl reports an HTTP error as a status, not an exit code, so the
   status count is the check. curl's `%header{}` needs curl 7.84 or later. Expect `prod exit 0`,
   `scratch exit 0`, two counts of N, `non-200: 0`, and `type diff exit 0`. Record the result,
   both Storage versions and any `full diff` lines in the Rehearsals table's Result column.

   A `REFUSED`, a `non-200` other than `0`, or a `type diff` line (status or `Content-Type`) is a
   failed rehearsal: record it and run "Clean up" steps 1 and 2. An object changed or deleted in
   production since `<latest>` also differs, so first list the sampled ids' production `updated_at`
   (a read; `IDS` is rebuilt as in step 5 in case the shell was restarted) and look at the differing ones:

   ```sh
   IDS="$(cut -d'|' -f1 "$RESTORE_DIR/sample.txt" | sed "s/.*/'&'/" | paste -sd, -)"
   op run --env-file="$RESTORE_DIR/refs.env" -- sh -c \
     'psql "$PROD_DB_URL" -X -At -c "select id, updated_at from storage.objects where id in ($1)"' _ "$IDS"
   ```

   `<latest>` is a date, and the backup ran some time during that day, so compare with the time the
   completion marker was written instead. Every bucket had been copied by then:

   ```sh
   op run --env-file="$RESTORE_DIR/rclone.env" -- rclone lsjson "r2:<R2_BUCKET>/complete/<latest>" | grep -o '"ModTime":"[^"]*"'
   ```

   An id missing here, or with an `updated_at` later than that time, is not a restore defect: record
   it and rehearse again after the next marked night. Any other difference counts as a defect, even
   one whose `updated_at` falls during the run itself. A `full diff` line that differs only in
   `Cache-Control` is not a failed rehearsal, but it means a restore serves a different cache header:
   record it and reopen the `-M` decision (`docs/runbooks/storage-backup.md`, "What the job copies").

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

| Date | Who | Counts (before / scratch / after: nodes, detections, aci_logs, species, node_habitat) | Pre-copy comparison (`*` / `+` / `!`) | Objects resolved / N (e.g. 9/9) | Result |
|---|---|---|---|---|---|
|  |  |  |  |  |  |
