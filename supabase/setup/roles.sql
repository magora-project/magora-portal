-- The staging refresh's login (Spec 2 plan Task 9, spec §5.10). Applied by `postgres` to every
-- database the refresh reads or writes: production, staging and the local stacks. Idempotent.
--
-- The role has no password here. An operator sets it per database through `op run`; it is never
-- written to a file.
--
-- This file grants NOTHING on any object, so applying it changes no ACL and the baseline proof
-- (Task 12) still matches a production snapshot taken before the role existed. Read access arrives
-- in Task 15b's grants migration. Privileges held only through PUBLIC cannot be revoked from one
-- role; the privilege check (Task 11) inventories them.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'magora_refresh') then
    create role magora_refresh login noinherit bypassrls;
  end if;
end
$$;

-- Re-assert the attributes on every run, so a database where the role already existed with other
-- attributes is brought back to exactly these. Supabase's supautils refuses NOSUPERUSER and
-- NOREPLICATION from `postgres` ("Only roles with the SUPERUSER attribute may alter roles with the
-- SUPERUSER attribute"), so those two are checked instead of set.
alter role magora_refresh login noinherit bypassrls nocreatedb nocreaterole;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'magora_refresh' and (rolsuper or rolreplication)) then
    raise exception 'magora_refresh has SUPERUSER or REPLICATION; remove it before applying roles.sql';
  end if;
end
$$;

-- A session default, not a boundary (the login can SET it off). The privilege check is the boundary.
alter role magora_refresh set default_transaction_read_only = on;
