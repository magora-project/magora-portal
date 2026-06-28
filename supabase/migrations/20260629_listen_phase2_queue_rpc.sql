-- Listen feature — Phase 2: queue-access RPCs for the inference worker
--
-- The Fly.io worker authenticates with the service role key and pulls jobs over
-- HTTPS (PostgREST), so it never needs a direct Postgres connection or the DB
-- password. pgmq's own functions live in the `pgmq` schema (not exposed to the
-- API), so we wrap read/delete/archive in SECURITY DEFINER functions and grant
-- execute to the service_role only.

-- Pull up to p_qty jobs, hiding them for p_vt seconds (visibility timeout) so a
-- second worker won't grab the same job while this one is processing it.
create or replace function public.read_audio_jobs(p_qty int default 1, p_vt int default 60)
returns table (msg_id bigint, read_ct int, enqueued_at timestamptz, vt timestamptz, message jsonb)
language sql
security definer
set search_path = public, pgmq
as $$
  select r.msg_id, r.read_ct, r.enqueued_at, r.vt, r.message
  from pgmq.read('audio_inference', p_vt, p_qty) r;
$$;

-- Remove a successfully processed job from the queue.
create or replace function public.delete_audio_job(p_msg_id bigint)
returns boolean
language sql
security definer
set search_path = public, pgmq
as $$
  select pgmq.delete('audio_inference', p_msg_id);
$$;

-- Move a poison job (repeatedly failing) to the archive instead of looping forever.
create or replace function public.archive_audio_job(p_msg_id bigint)
returns boolean
language sql
security definer
set search_path = public, pgmq
as $$
  select pgmq.archive('audio_inference', p_msg_id);
$$;

-- Lock these down to the worker (service_role) only.
revoke execute on function public.read_audio_jobs(int, int) from public, anon, authenticated;
revoke execute on function public.delete_audio_job(bigint)  from public, anon, authenticated;
revoke execute on function public.archive_audio_job(bigint) from public, anon, authenticated;
grant  execute on function public.read_audio_jobs(int, int) to service_role;
grant  execute on function public.delete_audio_job(bigint)  to service_role;
grant  execute on function public.archive_audio_job(bigint) to service_role;
