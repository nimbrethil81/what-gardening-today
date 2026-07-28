-- ============================================================================
--  09_browse_groups.sql — picker browse headings + botanical names
--
--  Additive and re-runnable. Adds the data behind the redesigned
--  "Add to my garden" picker:
--
--    * browse_group               — the headings pills are clustered under
--    * blueprint.browse_group_id  — which heading a blueprint sits under
--    * blueprint.botanical_name   — optional Latin name, displayed only when set
--
--  DISPLAY-ONLY, like category (Decision D2). Nothing in the matching engine
--  reads any of this; select_tasks is untouched by this file. A browse group
--  is NOT a collection and can never be a task target — the two live in
--  different tables precisely so a browsing change can never alter which
--  tasks a garden item receives.
--
--  Safe to run on the live database: it adds a table and two nullable
--  columns, and writes no blueprint rows. Every existing blueprint keeps
--  browse_group_id = null until the workbook assigns one, which the picker
--  renders under an "Other" heading rather than hiding.
--
--  ---------------------------------------------------------------------
--  REVISED 27 Jul 2026, after the first publish attempt failed with:
--    HTTP 403 / 42501 "permission denied for table browse_group"
--
--  Two corrections, both in this file:
--
--   1. TABLE PRIVILEGES WERE MISSING (§4, new). Enabling RLS and writing a
--      policy is not sufficient on its own. RLS is a filter applied on top of
--      ordinary SQL privileges, so without a GRANT the request is refused
--      before any policy is consulted. The pre-existing tables carry their
--      grants from 01_schema.sql; a newly created table inherits nothing and
--      must grant its own. This would have blocked the app's own reads at
--      Phase 2 as well as the publish pipeline's writes.
--
--   2. THE SEED NO LONGER OVERWRITES SORT ORDERS (§5). It was written as
--      "on conflict do update", which made sense when this file was the only
--      thing that had ever populated the table. The workbook's Browse_Groups
--      tab is now the source of truth and the publish pipeline maintains it,
--      so re-running this file must not quietly reset an order set there.
--      Bootstrap on first run, no-op thereafter.
--  ---------------------------------------------------------------------
-- ============================================================================


-- ============================================================================
--  1. THE BROWSE GROUP TABLE
--     Declared centrally so a typo in the workbook is a publish-time error
--     rather than a stray heading appearing on screen. Same pattern as the
--     Collections tab declaring valid GROUP_* codes.
-- ============================================================================
create table if not exists public.browse_group (
  id         smallint generated always as identity primary key,
  name       text     not null unique,
  sort_order smallint not null,

  constraint browse_group_name_not_blank check (btrim(name) <> '')
);

comment on table public.browse_group is
  'Display-only headings for the "Add to my garden" picker. Never referenced by matching logic.';
comment on column public.browse_group.sort_order is
  'On-screen order of headings. Seeded in gaps of ten so a new heading can be slotted between two others without renumbering.';


-- ============================================================================
--  2. THE TWO NEW BLUEPRINT COLUMNS
--     Both nullable. A blueprint with neither is exactly as valid as it was
--     before this migration ran.
--
--     No grants are needed here: privileges on blueprint are held at table
--     level, and a table-level grant covers columns added later.
-- ============================================================================
alter table public.blueprint
  add column if not exists browse_group_id smallint references public.browse_group(id),
  add column if not exists botanical_name  text;

comment on column public.blueprint.browse_group_id is
  'Which picker heading this blueprint appears under. Null = shown under "Other". Display-only.';
comment on column public.blueprint.botanical_name is
  'Optional Latin name, shown in brackets beside the common name. Authored only where the common name is ambiguous; null for most blueprints.';

-- A blank-but-present botanical name would render as empty brackets, so it is
-- rejected outright. ALTER TABLE has no "add constraint if not exists", hence
-- the guard — this keeps the file re-runnable.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.blueprint'::regclass
      and conname  = 'blueprint_botanical_name_not_blank'
  ) then
    alter table public.blueprint
      add constraint blueprint_botanical_name_not_blank
      check (botanical_name is null or btrim(botanical_name) <> '');
  end if;
end $$;

create index if not exists blueprint_browse_group_idx
  on public.blueprint (browse_group_id);


-- ============================================================================
--  3. ROW LEVEL SECURITY
--     Mirrors the category table: signed-in users read it, nobody but the
--     publish pipeline writes it. service_role bypasses RLS, so the pipeline
--     needs no policy of its own; the absence of insert/update/delete
--     policies is what denies everyone else.
-- ============================================================================
alter table public.browse_group enable row level security;

drop policy if exists browse_group_read on public.browse_group;
create policy browse_group_read
  on public.browse_group
  for select
  to authenticated
  using (true);


-- ============================================================================
--  4. TABLE PRIVILEGES
--
--     RLS decides WHICH ROWS a role may see. Privileges decide whether the
--     role may touch the table at all, and they are checked first. A policy
--     without a grant is a lock fitted to a door that is bricked up: the
--     request fails with 42501 and the policy never runs.
--
--     Deliberately minimal, and deliberately matching the design:
--
--       authenticated — SELECT only. The picker reads headings; nothing in
--                       the app ever writes one. Writes are refused by the
--                       absence of a grant AND the absence of a policy.
--
--       service_role  — SELECT, INSERT, UPDATE. This is the publish pipeline,
--                       the sole authorised writer to the curated catalogue.
--                       DELETE is withheld on purpose: browse groups are
--                       upsert-only, following the collection precedent, and
--                       deleting one that a blueprint still points at would
--                       break the foreign key. Remove a heading by clearing
--                       its use in the workbook, not by deleting the row.
--
--       anon          — nothing. A signed-out visitor sees no catalogue, as
--                       02_rls_test.sql asserts for every other curated table.
--
--     Identity columns need no separate sequence grant: unlike serial, an
--     IDENTITY column's sequence is advanced internally by the insert.
-- ============================================================================
grant select                 on public.browse_group to authenticated;
grant select, insert, update on public.browse_group to service_role;


-- ============================================================================
--  5. BOOTSTRAP THE HEADINGS
--     Sentence case, matching the category names ('Trees & shrubs').
--
--     ON CONFLICT DO NOTHING, not DO UPDATE: the workbook's Browse_Groups tab
--     is the source of truth from here on, and the publish pipeline upserts
--     from it on every run. Re-running this file must never silently reset an
--     order that was authored there. To change the display order, edit
--     Sort_Order in the workbook and publish.
--
--     The list is deliberately global rather than per-category: a heading is
--     just a label, and the picker shows whichever headings the blueprints
--     under the tapped tile actually use.
-- ============================================================================
insert into public.browse_group (name, sort_order) values
  ('Trees',               10),
  ('Shrubs',              20),
  ('Roses',               30),
  ('Hedging',             40),
  ('Perennials',          50),
  ('Annuals & bedding',   60),
  ('Bulbs & tubers',      70),
  ('Climbers',            80),
  ('Ferns & foliage',     90),
  ('Ornamental grasses', 100),
  ('Vegetables',         110),
  ('Herbs',              120),
  ('Fruit',              130)
on conflict (name) do nothing;


-- ============================================================================
--  CONFIRMATION READOUT
--  The Supabase web editor shows only the final statement's grid, so this is
--  one query. It reports both halves of what this file does: the headings and
--  how many blueprints sit under each, and the privileges that were missing
--  the first time round.
--
--  Expect the two privilege rows to read 1 and 3. If either is 0, the grants
--  in §4 did not apply and the publish will fail with 42501 again.
-- ============================================================================
select "Order", "Browse group", "Count"
from (
  select
    g.sort_order::int as "Order",
    g.name            as "Browse group",
    count(b.id)       as "Count"
  from public.browse_group g
  left join public.blueprint b
    on b.browse_group_id = g.id
   and b.retired_at is null
  group by g.id, g.sort_order, g.name

  union all

  select
    9000,
    '(no group yet — picker shows these under "Other")',
    count(*)
  from public.blueprint
  where browse_group_id is null
    and retired_at is null

  union all

  select
    9100,
    'privileges: authenticated (expect 1 — SELECT)',
    count(*)
  from information_schema.role_table_grants
  where table_schema   = 'public'
    and table_name     = 'browse_group'
    and grantee        = 'authenticated'
    and privilege_type = 'SELECT'

  union all

  select
    9200,
    'privileges: service_role (expect 3 — SELECT, INSERT, UPDATE)',
    count(*)
  from information_schema.role_table_grants
  where table_schema   = 'public'
    and table_name     = 'browse_group'
    and grantee        = 'service_role'
    and privilege_type in ('SELECT', 'INSERT', 'UPDATE')
) r
order by "Order";
