-- Node banner photo — let a node's owner put a real photograph of the place at the top of its
-- page, replacing the habitat-emoji placeholder.
--
-- Context: the NodePage banner has always been a placeholder. The page read
-- `profile_image_url || image_url || banner_url` off `nodes`, and NONE of those columns have ever
-- existed — three dead reads that always fell through to the emoji gradient. This adds the one
-- column that was missing.
--
-- SCOPE / boundaries:
--   * PLACE data only. `banner_path` is a Storage path for a photo of the place, hung off the node
--     row. No person data: the uploader is authorized via nodes.owner_id but is never recorded here.
--   * Owners get exactly ONE new capability: set or clear their node's photo. Deliberately a
--     SECURITY DEFINER RPC rather than a general `for update` policy on `public.nodes` — an UPDATE
--     policy would also expose name, location, habitat_type, elevation, species_whitelist and
--     is_active to client writes, which is a far larger surface than "change the picture" and is
--     not what this slice is for. Mirrors set_node_report / upsert_pulse / set_*_insight: the base
--     table stays non-client-writable and every write goes through a narrow, checked function.
--   * The bucket is PUBLIC-read, like listener-avatars: a node's banner is shown to every visitor
--     of a public page, so there is nothing to gate. Writes stay owner-scoped.
--
-- WRITE-ONLY migration: reviewed and applied manually. Do not auto-apply.

-- ── nodes.banner_path ────────────────────────────────────────────────────────
-- Storage path within the node-banners bucket ("{owner_uid}/{filename}"), or null for none.
-- Stored as a PATH, not a URL: the public URL is derived at render time, so moving buckets or
-- switching to signed URLs later does not require rewriting stored rows.
alter table public.nodes add column if not exists banner_path text;

-- ── Storage bucket ───────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('node-banners', 'node-banners', true)
on conflict (id) do nothing;

-- Uploads land in the uploader's own {uid}/ folder (the storage-upload Edge Function enforces
-- this server-side and is the only path clients use today, because this project's Storage version
-- cannot validate the kid'd JWTs). These policies keep the invariant true at the database level
-- too, so the direct-upload path is already correct when Storage is upgraded and the function
-- workaround is removed.
create policy "upload own node banner" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'node-banners'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Re-uploading a banner upserts to the same path, which is an UPDATE on the storage object —
-- without this, a second save of the same node's photo fails RLS (the trap hit by listener avatars).
create policy "update own node banner" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'node-banners'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'node-banners'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "delete own node banner" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'node-banners'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── set_node_banner RPC (owner-checked, the only write path) ─────────────────
-- SECURITY DEFINER so it can write a base table that has no client UPDATE policy; the ownership
-- check is done explicitly against auth.uid() rather than inherited from RLS. Pass p_path = null
-- to clear the photo and fall back to the habitat placeholder.
create or replace function public.set_node_banner(
  p_node_id uuid,
  p_path    text
)
returns public.nodes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  result  public.nodes;
begin
  -- A definer function bypasses RLS, so authorization is explicit and fails closed.
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select owner_id into v_owner from public.nodes where id = p_node_id;
  if not found then
    raise exception 'node not found';
  end if;
  -- Covers the unowned case too: owner_id null is never equal to a non-null auth.uid().
  if v_owner is distinct from auth.uid() then
    raise exception 'only the node owner can change its photo';
  end if;

  -- Keep the stored value a path, never a URL, and require it to sit in the caller's own folder —
  -- so a crafted call cannot point a node at another user's uploaded file.
  if p_path is not null and p_path !~ ('^' || auth.uid()::text || '/[A-Za-z0-9._-]+$') then
    raise exception 'invalid banner path';
  end if;

  update public.nodes set banner_path = p_path where id = p_node_id
  returning * into result;

  return result;
end;
$$;

grant execute on function public.set_node_banner(uuid, text) to authenticated;
