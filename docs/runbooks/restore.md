# Restore rehearsal

This proves production can be restored: a database dump goes into a scratch project, and objects come
back from the R2 Storage backup. Run it once to establish the procedure, then again after any change to
the backup jobs. Storage object restore details are in `docs/runbooks/storage-backup.md`; this runbook
reuses its `restore-target` remote and does not define another.

Production's project ref is `wqxmmuwrfltpaxnuddwk`. The scratch project has a different ref.

## Rules

- Secrets are used only through `op run` and `op inject`. Never `op read` or `op item get`, and never
  paste a connection string into a command line, file or chat.
- Connection strings are `op://Magora Project/<item>/<field>` references, resolved by `op run`.
- Production is reached through the Supavisor pooler, session mode, port 5432, username `postgres.<ref>`.
  The scratch project is reached the same way with its own ref.
- `pg_dump` and `pg_restore` must be major version 17, matching the server.
- The dump holds production data. It lives in a `mktemp -d` directory and is deleted at the end.

## Before you start

1. Check the tool versions. Both must report 17:

   ```sh
   pg_dump --version
   pg_restore --version
   ```

   If not, stop and install PostgreSQL 17 client tools.
2. Have two vault items in "Magora Project", each with a pooler connection string field
   (`postgres.<ref>@<pooler host>:5432/postgres`, session mode):
   one for production (`PROD_DB_URL`) and one for the scratch project (`SCRATCH_DB_URL`, added in step 1).
   Reference them as `op://Magora Project/<item>/<field>`.
3. Make the working directory and keep its path in the shell:

   ```sh
   RESTORE_DIR="$(mktemp -d)"
   echo "$RESTORE_DIR"
   ```

## 1. Create the scratch project

Create `magora-restore-scratch` in the same Supabase organization. Choose the same region and Postgres
major version as production. Note its ref. Add its pooler connection string to the vault item for
`SCRATCH_DB_URL`.

## 2. Dump production

The `op run` environment file below holds only references, no values. Create `$RESTORE_DIR/refs.env`
(inside the temp directory, deleted at the end):

```sh
printf '%s\n' \
  'PROD_DB_URL=op://Magora Project/<prod item>/<field>' \
  'SCRATCH_DB_URL=op://Magora Project/<scratch item>/<field>' \
  > "$RESTORE_DIR/refs.env"
```

Dump:

```sh
op run --env-file="$RESTORE_DIR/refs.env" -- sh -c \
  'pg_dump --format=custom --no-owner --no-privileges --file="$1/prod.dump" "$PROD_DB_URL"' _ "$RESTORE_DIR"
ls -l "$RESTORE_DIR/prod.dump"
```

## 3. Restore into the scratch project

### Before running anything: confirm the ref

1. Read the ref in the scratch connection string's username (`postgres.<ref>`) aloud, character by
   character. Print it without the password:

   ```sh
   op run --env-file="$RESTORE_DIR/refs.env" -- sh -c 'printf "%s\n" "${SCRATCH_DB_URL#*//}" | cut -d: -f1'
   ```

2. Match it against the ref of `magora-restore-scratch` in the Supabase dashboard.
3. It must not be `wqxmmuwrfltpaxnuddwk`. If it differs from the dashboard ref, or equals production's,
   stop. Do not run the restore.

The restore command takes only `SCRATCH_DB_URL`, and that URL's username must carry the scratch ref. The
production URL is never passed to it.

### Restore

```sh
op run --env-file="$RESTORE_DIR/refs.env" -- sh -c \
  'pg_restore --no-owner --no-privileges --exit-on-error --dbname="$SCRATCH_DB_URL" "$1/prod.dump"' _ "$RESTORE_DIR"
```

If it stops on an error, record the error text (no connection strings) in the Rehearsals table, and fix
or note it before retrying on a freshly reset scratch database.

## 4. Compare row counts

Take both counts within the same hour. Save this single statement as `$RESTORE_DIR/counts.sql`:

```sh
cat > "$RESTORE_DIR/counts.sql" <<'SQL'
select (select count(*) from public.nodes)        as nodes,
       (select count(*) from public.detections)   as detections,
       (select count(*) from public.aci_logs)     as aci_logs,
       (select count(*) from public.species)      as species,
       (select count(*) from public.node_habitat) as node_habitat;
SQL
```

Run it on both sides:

```sh
op run --env-file="$RESTORE_DIR/refs.env" -- sh -c 'psql "$PROD_DB_URL"    -X -f "$1/counts.sql"' _ "$RESTORE_DIR"
op run --env-file="$RESTORE_DIR/refs.env" -- sh -c 'psql "$SCRATCH_DB_URL" -X -f "$1/counts.sql"' _ "$RESTORE_DIR"
```

Equality is expected, give or take rows production wrote after the dump started. Record every difference
in the Rehearsals table; an unexplained difference (scratch higher than production, or a table missing)
is a failed rehearsal.

## 5. Restore 20 objects from R2

The dump restored the `storage.objects` rows but not the bytes. Pick the newest dated prefix in R2
(`nightly/<latest>/`; list `r2:magora-storage-backup/nightly/` and take the greatest date).

1. Choose 20 objects from the scratch project's `storage.objects`, across the buckets:

   ```sh
   op run --env-file="$RESTORE_DIR/refs.env" -- sh -c \
     'psql "$SCRATCH_DB_URL" -X -At -F "|" -c "select bucket_id, name from storage.objects order by random() limit 20"' \
     > "$RESTORE_DIR/sample.txt"
   wc -l "$RESTORE_DIR/sample.txt"
   ```

2. Create the matching buckets in the scratch project (dashboard, same names and public/private setting).
   They must exist before the copy.
3. Configure the `restore-target` and `r2` remotes exactly as in `docs/runbooks/storage-backup.md`
   ("Restoring objects"), with `<ref>` set to the scratch ref and the keys from the vault. The aloud
   read-and-match of that runbook applies here too; the endpoint ref must be the scratch ref.
4. For each bucket in the sample, write that bucket's object names to a file and copy only those:

   ```sh
   rclone copy "r2:magora-storage-backup/nightly/<latest>/<bucket>" "restore-target:<bucket>" \
     --files-from "$RESTORE_DIR/<bucket>.files" --checksum
   ```

   Use `rclone copy`, never `rclone sync`.
5. Check each of the 20 resolves to a downloadable object:

   ```sh
   rclone check "r2:magora-storage-backup/nightly/<latest>/<bucket>" "restore-target:<bucket>" \
     --files-from "$RESTORE_DIR/<bucket>.files" --checksum
   ```

   Also download two of them through the scratch project's Storage API or dashboard and open them.
   The result is the count of the 20 that resolved.

## 6. Clean up

1. Delete the scratch project in the Supabase dashboard (and its vault item, or the stale connection
   string field).
2. Delete the dump and temp files, and confirm:

   ```sh
   rm -rf "$RESTORE_DIR"
   ls "$RESTORE_DIR" 2>&1
   unset RESTORE_DIR
   ```

3. Unset the `RCLONE_CONFIG_*` variables or close the shell.

## Daily backups

The first daily backup appeared in the Supabase dashboard on: `<YYYY-MM-DD, filled in by the operator>`

## Rehearsals

| Date | Who | Counts (prod / scratch: nodes, detections, aci_logs, species, node_habitat) | Objects resolved (of 20) | Result |
|---|---|---|---|---|
|  |  |  |  |  |
