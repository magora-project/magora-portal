-- nodes.owner_id is meant to link a node to its human steward, but its FK pointed
-- at the legacy (empty) public.users table, so it could never hold a real account
-- id. Repoint it at auth.users so a node can be owned by the same identity that
-- owns a listener profile (Option B: listeners.id = auth.uid()). This lets a
-- Listener's nodes surface on their field journal (nodes.owner_id = listeners.id).
alter table public.nodes drop constraint if exists nodes_owner_id_fkey;

alter table public.nodes
  add constraint nodes_owner_id_fkey
  foreign key (owner_id) references auth.users(id) on delete set null;
