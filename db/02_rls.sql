-- ============================================================================
--  What Gardening Today? — v2.0 access control (Stage 1, file 2 of N)
--  DESIGN_V2.md §5. Membership helpers, Data-API grants, Row Level Security,
--  and the policies that make the agreed test matrix true.
--
--  RUN THIS AFTER 01_schema.sql, in the Supabase SQL Editor.
--
--  Two layers work together (Supabase's current model):
--    GRANTS decide whether a role can touch a table AT ALL via the Data API.
--    RLS POLICIES then decide which ROWS that role may see or change.
--  A table is invisible to the app until it is granted; a granted table with
--  RLS on still only reveals the rows a policy permits. Both are set here.
--
--  Roles (provided by Supabase):
--    anon          — a signed-out visitor. Granted NOTHING: the sign-in screen
--                    needs no data.
--    authenticated — a signed-in user. Governed entirely by the policies below.
--    service_role  — the publish pipeline (Stage 2) and admin tooling. Bypasses
--                    RLS by design; it is the ONLY writer of shared content.
-- ============================================================================


-- ============================================================================
--  MEMBERSHIP HELPERS
--  These answer "is the current user a member / an owner of garden X?".
--
--  They are SECURITY DEFINER and owned by the table owner, so they read
--  garden_member WITHOUT triggering garden_member's own RLS. That is what
--  prevents infinite recursion: a policy on garden_member that asked
--  "is the caller a member of this garden?" would otherwise query the very
--  table whose policy is being evaluated. search_path is pinned empty and every
--  name fully qualified, so the function cannot be hijacked by a caller's path.
-- ============================================================================

create or replace function public.is_garden_member(g uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.garden_member gm
    where gm.garden_id = g and gm.user_id = auth.uid()
  );
$$;

create or replace function public.is_garden_owner(g uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.garden_member gm
    where gm.garden_id = g and gm.user_id = auth.uid() and gm.role = 'owner'
  );
$$;


-- ============================================================================
--  GRANTS  (Data-API reachability)
--  Start from a clean slate for the two user-facing roles so this file is
--  deterministic however the project was created, then grant precisely.
--  service_role keeps full access (it is the publish pipeline / admin).
-- ============================================================================

revoke all on all tables in schema public from anon, authenticated;

grant usage on schema public to anon, authenticated, service_role;

-- Shared, curated catalogue + shared tasks: signed-in users may READ; only the
-- publish pipeline (service_role) may write.
grant select on
  public.category,
  public.blueprint,
  public.blueprint_category,
  public.collection,
  public.collection_member,
  public.task_target
to authenticated;

-- task holds BOTH shared rows (read) and manual rows (create/update). No delete
-- grant: manual tasks are retired via update, never hard-deleted.
grant select, insert, update on public.task to authenticated;

-- The garden itself: read + rename (rename further narrowed to owners by RLS).
grant select, update on public.garden to authenticated;

-- Membership: read co-members; add/remove narrowed to owners by RLS.
grant select, insert, delete on public.garden_member to authenticated;

-- Inventory: create/read/soft-delete. No hard delete grant (removal = update).
grant select, insert, update on public.garden_item to authenticated;

-- Completion history: read + append only. No update/delete grant at all — the
-- record is immutable by construction, not merely by policy.
grant select, insert on public.task_completion to authenticated;

-- Hidden tasks: read + hide (insert) + unhide (delete). No update.
grant select, insert, delete on public.hidden_task to authenticated;

-- The publish pipeline and admin tooling get everything.
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;


-- ============================================================================
--  ENABLE ROW LEVEL SECURITY on every table.
--  Enabled (not FORCED): the table owner and the SECURITY DEFINER helpers above
--  intentionally bypass RLS; forcing it would break the helpers and the
--  onboarding function.
-- ============================================================================
alter table public.garden            enable row level security;
alter table public.garden_member     enable row level security;
alter table public.category          enable row level security;
alter table public.blueprint         enable row level security;
alter table public.blueprint_category enable row level security;
alter table public.collection        enable row level security;
alter table public.collection_member enable row level security;
alter table public.task              enable row level security;
alter table public.task_target       enable row level security;
alter table public.garden_item       enable row level security;
alter table public.task_completion   enable row level security;
alter table public.hidden_task       enable row level security;


-- ============================================================================
--  POLICIES
--  Naming: <table>_<operation>_<who>. Each table's policies below mirror one
--  block of the agreed test matrix.
--
--  A note on how "no" is delivered, because it differs by operation:
--    - A blocked SELECT / UPDATE / DELETE returns NO ROWS (the row is invisible
--      to that user), silently. Nothing changes; no error.
--    - A blocked INSERT, or an UPDATE that would move a row somewhere the user
--      may not put it, raises an ERROR (a WITH CHECK violation).
--    - An operation with no GRANT at all (e.g. deleting a completion) is refused
--      at the grant layer with a permission error, before RLS is even consulted.
--  All three mean the same thing: the change does not happen.
-- ============================================================================

-- ---- Shared catalogue: everyone signed in reads; nobody but the pipeline writes
drop policy if exists category_select_all on public.category;
create policy category_select_all on public.category           for select to authenticated using (true);
drop policy if exists blueprint_select_all on public.blueprint;
create policy blueprint_select_all on public.blueprint          for select to authenticated using (true);
drop policy if exists blueprint_category_select_all on public.blueprint_category;
create policy blueprint_category_select_all on public.blueprint_category for select to authenticated using (true);
drop policy if exists collection_select_all on public.collection;
create policy collection_select_all on public.collection         for select to authenticated using (true);
drop policy if exists collection_member_select_all on public.collection_member;
create policy collection_member_select_all on public.collection_member  for select to authenticated using (true);
drop policy if exists task_target_select_all on public.task_target;
create policy task_target_select_all on public.task_target        for select to authenticated using (true);
-- (No insert/update/delete policies on these tables → all writes by
--  authenticated are denied. service_role bypasses RLS and does the writing.)


-- ---- task: the mixed table (shared rows garden_id null; manual rows garden_id set)
-- Read a shared task (belongs to no garden) OR a manual task in a garden I'm in.
drop policy if exists task_select_shared_or_mine on public.task;
create policy task_select_shared_or_mine on public.task
  for select to authenticated
  using (garden_id is null or public.is_garden_member(garden_id));

-- Create only a manual task, only in a garden I belong to. A shared task
-- (garden_id null) fails this check, so users can never mint shared content.
drop policy if exists task_insert_manual_mine on public.task;
create policy task_insert_manual_mine on public.task
  for insert to authenticated
  with check (garden_id is not null and public.is_garden_member(garden_id));

-- Edit/retire only a manual task in my garden, and it must STAY a manual task in
-- my garden — the WITH CHECK forbids moving it to another garden or making it
-- shared (garden_id -> null / someone else's).
drop policy if exists task_update_manual_mine on public.task;
create policy task_update_manual_mine on public.task
  for update to authenticated
  using (garden_id is not null and public.is_garden_member(garden_id))
  with check (garden_id is not null and public.is_garden_member(garden_id));
-- (No delete policy → manual tasks are retired, never hard-deleted. No grant
--  for deleting shared tasks either.)


-- ---- garden
drop policy if exists garden_select_member on public.garden;
create policy garden_select_member on public.garden
  for select to authenticated
  using (public.is_garden_member(id));

-- Rename is an owner's job. Members can read but not rename.
drop policy if exists garden_update_owner on public.garden;
create policy garden_update_owner on public.garden
  for update to authenticated
  using (public.is_garden_owner(id))
  with check (public.is_garden_owner(id));
-- (No insert policy → gardens are born only via create_garden (§5, file 03),
--  which runs with definer rights and enrols the creator as owner atomically.
--  No delete policy.)


-- ---- garden_member
drop policy if exists garden_member_select_member on public.garden_member;
create policy garden_member_select_member on public.garden_member
  for select to authenticated
  using (public.is_garden_member(garden_id));

-- Only an owner may add or remove members. (The very first membership row — the
-- creator as owner — is written by create_garden, which bypasses this.)
drop policy if exists garden_member_insert_owner on public.garden_member;
create policy garden_member_insert_owner on public.garden_member
  for insert to authenticated
  with check (public.is_garden_owner(garden_id));

drop policy if exists garden_member_delete_owner on public.garden_member;
create policy garden_member_delete_owner on public.garden_member
  for delete to authenticated
  using (public.is_garden_owner(garden_id));
-- (No update policy → role changes are not a v2 UI action.)


-- ---- garden_item  (full use within my gardens; nothing in anyone else's)
drop policy if exists garden_item_select_member on public.garden_item;
create policy garden_item_select_member on public.garden_item
  for select to authenticated
  using (public.is_garden_member(garden_id));

drop policy if exists garden_item_insert_member on public.garden_item;
create policy garden_item_insert_member on public.garden_item
  for insert to authenticated
  with check (public.is_garden_member(garden_id));

drop policy if exists garden_item_update_member on public.garden_item;
create policy garden_item_update_member on public.garden_item
  for update to authenticated
  using (public.is_garden_member(garden_id))
  with check (public.is_garden_member(garden_id));
-- (No delete policy, and no delete grant → items are marked removed, not erased.)


-- ---- task_completion  (append-only within my gardens)
drop policy if exists task_completion_select_member on public.task_completion;
create policy task_completion_select_member on public.task_completion
  for select to authenticated
  using (public.is_garden_member(garden_id));

drop policy if exists task_completion_insert_member on public.task_completion;
create policy task_completion_insert_member on public.task_completion
  for insert to authenticated
  with check (public.is_garden_member(garden_id));
-- (No update/delete policy, and no update/delete grant → history is immutable.)


-- ---- hidden_task  (hide/unhide within my gardens)
drop policy if exists hidden_task_select_member on public.hidden_task;
create policy hidden_task_select_member on public.hidden_task
  for select to authenticated
  using (public.is_garden_member(garden_id));

drop policy if exists hidden_task_insert_member on public.hidden_task;
create policy hidden_task_insert_member on public.hidden_task
  for insert to authenticated
  with check (public.is_garden_member(garden_id));

drop policy if exists hidden_task_delete_member on public.hidden_task;
create policy hidden_task_delete_member on public.hidden_task
  for delete to authenticated
  using (public.is_garden_member(garden_id));
-- (No update policy.)


-- ============================================================================
--  CONFIRMATION READOUT — RLS status and policy count per table (safe to re-run).
-- ============================================================================
select
  t.tablename as "Table",
  t.rowsecurity as "RLS on",
  (select count(*) from pg_policies p
     where p.schemaname = 'public' and p.tablename = t.tablename) as "Policies"
from pg_tables t
where t.schemaname = 'public'
order by t.tablename;
