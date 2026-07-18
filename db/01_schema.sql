-- ============================================================================
--  What Gardening Today? — v2.0 schema (Stage 1, file 1 of N)
--  DESIGN_V2.md §4. Structure only: tables, keys, constraints, indexes.
--  Access control (grants, RLS, policies) lives in 02_rls.sql.
--  Functions (create_garden, select_tasks) live in 03_functions.sql.
--  Data (migration from the spreadsheet) lives in the 04+ files.
--
--  Run this by pasting it into the Supabase SQL Editor (Project → SQL Editor →
--  New query → paste → Run). It is idempotent-friendly: every CREATE uses
--  IF NOT EXISTS where Postgres allows it, so a re-run is safe.
--
--  Design principles this file enforces (DESIGN_V2 §4.1):
--    - Surrogate keys carry no meaning. Nothing ever parses an id.
--    - Legacy codes are labels, not keys. Unique, human-readable, never parsed.
--    - Nothing curated is deleted; it is retired (retired_at tombstone).
--    - Timestamps are timestamptz; day-level reasoning happens in the garden tz.
--    - Comma-separated cells become rows (junction tables); the sole exception
--      is valid_months, a validated integer array attribute of a task.
-- ============================================================================

-- gen_random_uuid() is built in on Supabase's Postgres; this is belt-and-braces.
create extension if not exists pgcrypto;


-- ============================================================================
--  4.2  IDENTITY AND GARDENS
-- ============================================================================

-- One row per physical garden. Location drives weather only; timezone drives
-- all date arithmetic (this is what closes the BST midnight bug class).
create table if not exists public.garden (
  id         uuid primary key default gen_random_uuid(),
  name       text        not null,
  latitude   numeric     not null,
  longitude  numeric     not null,
  timezone   text        not null default 'Europe/London',
  created_at timestamptz not null default now(),

  constraint garden_name_not_blank check (btrim(name) <> ''),
  constraint garden_lat_range  check (latitude  between  -90 and  90),
  constraint garden_lon_range  check (longitude between -180 and 180)
);

-- Who belongs to which garden. A couple sharing a garden = two rows, one garden.
-- One person tending two gardens = two rows, one user. The v2.0 UI creates
-- exactly one garden per user and never shows a switcher (DESIGN_V2 §4.2, D4).
create table if not exists public.garden_member (
  garden_id uuid        not null references public.garden(id) on delete cascade,
  user_id   uuid        not null references auth.users(id)    on delete cascade,
  role      text        not null,
  added_at  timestamptz not null default now(),

  primary key (garden_id, user_id),
  constraint garden_member_role check (role in ('owner','member'))
);


-- ============================================================================
--  4.3  THE CATALOGUE  (shared, curated, read-only to users)
-- ============================================================================

-- The seven display categories, migrated from Reference_Lists. Display-only:
-- drives the "Add to My Garden" tiles and card grouping. NO matching logic
-- references it (Decision D2 / Refinement 6). sort_order drives on-screen order.
create table if not exists public.category (
  id         smallint generated always as identity primary key,
  name       text     not null unique,
  sort_order smallint not null,

  constraint category_name_not_blank check (btrim(name) <> '')
);

-- One row per real-world item type; the successor of Item_Dictionary rows.
-- legacy_code is the old prefix (PLANT_LILY_OF_THE_VALLEY): the publish
-- pipeline's matching key and a human label, never parsed by any logic.
create table if not exists public.blueprint (
  id          integer generated always as identity primary key,
  name        text        not null unique,
  legacy_code text        unique,
  retired_at  timestamptz,

  constraint blueprint_name_not_blank check (btrim(name) <> '')
);

-- Junction: one row per (blueprint, category). Replaces the comma-separated
-- Category cell. Rose under two tiles = two rows, one blueprint.
create table if not exists public.blueprint_category (
  blueprint_id integer  not null references public.blueprint(id),
  category_id  smallint not null references public.category(id),
  primary key (blueprint_id, category_id)
);

-- A named, curated set of blueprints; the successor of GROUP_* tags, now
-- first-class rows. code is authored exactly as in the workbook
-- (GROUP_SOFT_FRUIT) so publishing needs no translation table.
create table if not exists public.collection (
  id   integer generated always as identity primary key,
  code text    not null unique,
  name text,

  constraint collection_code_not_blank check (btrim(code) <> '')
);

-- Junction: one row per (collection, blueprint). Replaces the comma-separated
-- Groups cell. Code/prefix namespace collisions are impossible by construction:
-- collections and blueprints live in different tables.
create table if not exists public.collection_member (
  collection_id integer not null references public.collection(id),
  blueprint_id  integer not null references public.blueprint(id),
  primary key (collection_id, blueprint_id)
);


-- ============================================================================
--  4.4  TASKS
-- ============================================================================

-- The successor of Master_Task_Matrix rows, plus the dormant manual-task
-- capability (D9). garden_id null = a global curated task (all of v2.0's
-- content); garden_id set = a private manual task belonging to one garden.
--
-- NOTE: the composite foreign key (garden_item_id, garden_id) -> garden_item is
-- added *after* garden_item is defined, at the foot of this file, because the
-- two tables reference each other.
create table if not exists public.task (
  id                    integer generated always as identity primary key,
  legacy_code           text unique,               -- TASK_0123; null for future manual tasks
  garden_id             uuid references public.garden(id) on delete cascade,
  garden_item_id        integer,                   -- composite FK added below
  name                  text        not null,
  instruction           text,
  category_id           smallint references public.category(id),
  valid_months          smallint[]  not null,
  frequency_days        integer,                   -- cooldown; null = one-off (manual only)
  suppress_if_raining   boolean     not null default false,
  suppress_if_temp_below numeric,                  -- °C
  suppress_if_wind_above numeric,                  -- mph; task HIDDEN when wind exceeds this
  estimated_minutes     integer,
  retired_at            timestamptz,
  created_at            timestamptz not null default now(),

  constraint task_name_not_blank check (btrim(name) <> ''),

  -- valid_months: non-empty, no NULL elements, every element in 1..12.
  -- Malformed months become a rejected write, not an audit finding.
  constraint task_valid_months_shape check (
    cardinality(valid_months) >= 1
    and array_position(valid_months, null) is null
    and 1  <= all(valid_months)
    and 12 >= all(valid_months)
  ),

  -- A global (shared) task must be categorised and must have a cooldown.
  -- Manual tasks may be uncategorised and may be one-off (null frequency).
  constraint task_global_has_category  check (garden_id is not null or category_id    is not null),
  constraint task_global_has_frequency check (garden_id is not null or frequency_days is not null),
  constraint task_frequency_positive   check (frequency_days is null or frequency_days >= 1),
  constraint task_estimated_minutes_positive check (estimated_minutes is null or estimated_minutes >= 1),

  -- Defensive (beyond §4, flagged in chat): a garden-item pointer only makes
  -- sense on a garden-scoped task. Stops a global task carrying a stray item id
  -- that the MATCH SIMPLE composite FK would not otherwise catch.
  constraint task_item_needs_garden check (garden_item_id is null or garden_id is not null)
);

-- Which audiences a global task applies to. One row per target; a task may have
-- several (something the single Target_Asset_ID cell could never express).
-- Exactly one of collection_id / blueprint_id is set per row.
create table if not exists public.task_target (
  id            integer generated always as identity primary key,
  task_id       integer not null references public.task(id) on delete cascade,
  collection_id integer references public.collection(id),
  blueprint_id  integer references public.blueprint(id),

  constraint task_target_exactly_one check (
    (collection_id is not null)::int + (blueprint_id is not null)::int = 1
  )
);

-- A task targets any given collection or blueprint at most once.
create unique index if not exists task_target_uq_collection
  on public.task_target (task_id, collection_id) where collection_id is not null;
create unique index if not exists task_target_uq_blueprint
  on public.task_target (task_id, blueprint_id)  where blueprint_id  is not null;


-- ============================================================================
--  4.5  PER-GARDEN STATE
-- ============================================================================

-- The successor of User_Profile rows. The defining change of the redesign: an
-- item IS a foreign key to its blueprint, not a constructed string. The UNIQUE
-- (id, garden_id) pair exists solely to support the manual-task composite FK on
-- the task table.
create table if not exists public.garden_item (
  id              integer     generated always as identity,
  garden_id       uuid        not null references public.garden(id) on delete cascade,
  blueprint_id    integer     not null references public.blueprint(id),
  friendly_name   text,
  legacy_asset_id text,                 -- old PLANT_X_1179 string; parity-check only
  legacy_category text,                 -- the tile the user added it under; carried, never read by v2
  added_at        timestamptz not null default now(),
  removed_at      timestamptz,          -- soft delete; replaces Is_Active

  primary key (id),
  unique (id, garden_id)
);

-- The successor of Task_Log. Append-only by policy AND by RLS (no update/delete
-- granted). completed_at is a full timestamp; the "day" it belongs to is derived
-- in the garden's timezone by select_tasks.
create table if not exists public.task_completion (
  id           bigint      generated always as identity primary key,
  garden_id    uuid        not null references public.garden(id) on delete cascade,
  task_id      integer     not null references public.task(id),
  completed_at timestamptz not null default now(),
  notes        text
);

-- The successor of Hidden_Tasks, now per garden. The composite primary key makes
-- hiding idempotent BY CONSTRUCTION rather than by a duplicate-scan loop.
create table if not exists public.hidden_task (
  garden_id uuid        not null references public.garden(id) on delete cascade,
  task_id   integer     not null references public.task(id),
  hidden_at timestamptz not null default now(),
  primary key (garden_id, task_id)
);


-- ============================================================================
--  DEFERRED COMPOSITE FOREIGN KEY
--  task.(garden_item_id, garden_id) -> garden_item.(id, garden_id)
--  Guarantees a manual task's attached item belongs to the SAME garden: a
--  cross-garden dangle is unrepresentable. MATCH SIMPLE (the default) means the
--  FK is simply not enforced when garden_item_id is null (a global or
--  unattached task), which is exactly what we want.
-- ============================================================================
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'task_item_same_garden_fk'
  ) then
    alter table public.task
      add constraint task_item_same_garden_fk
      foreign key (garden_item_id, garden_id)
      references public.garden_item (id, garden_id)
      on delete set null;
  end if;
end $$;


-- ============================================================================
--  PERFORMANCE INDEXES
--  select_tasks (§4.6) walks: active garden items -> their blueprints ->
--  targets that hit those blueprints (directly or via a collection) -> season,
--  hidden, cooldown, weather. These indexes support that walk.
-- ============================================================================
create index if not exists idx_garden_member_user        on public.garden_member (user_id);
create index if not exists idx_blueprint_category_cat     on public.blueprint_category (category_id);
create index if not exists idx_collection_member_bp       on public.collection_member (blueprint_id);
create index if not exists idx_task_target_collection     on public.task_target (collection_id);
create index if not exists idx_task_target_blueprint      on public.task_target (blueprint_id);
create index if not exists idx_task_garden                on public.task (garden_id);
create index if not exists idx_garden_item_garden_active  on public.garden_item (garden_id) where removed_at is null;
create index if not exists idx_garden_item_blueprint      on public.garden_item (blueprint_id);
create index if not exists idx_task_completion_lookup     on public.task_completion (garden_id, task_id, completed_at desc);
create index if not exists idx_hidden_task_garden         on public.hidden_task (garden_id);


-- ============================================================================
--  TABLE COMMENTS (documentation that travels with the database)
-- ============================================================================
comment on table public.garden          is 'One row per physical garden. Location drives weather; timezone drives date arithmetic.';
comment on table public.garden_member   is 'Many-to-many users<->gardens with roles. v2.0 UI exposes exactly one garden per user.';
comment on table public.category        is 'The seven display categories. Display-only: no matching logic references it (D2).';
comment on table public.blueprint       is 'One row per real-world item type. legacy_code is a label, never parsed.';
comment on table public.collection      is 'A named curated set of blueprints; successor of GROUP_* tags.';
comment on table public.task            is 'Curated global tasks (garden_id null) and dormant manual tasks (garden_id set).';
comment on table public.task_target     is 'Which blueprints/collections a global task applies to. Exactly one target per row.';
comment on table public.garden_item     is 'A garden''s inventory. An item is a foreign key to its blueprint, not a string.';
comment on table public.task_completion is 'Append-only completion history. Day resolved in the garden timezone.';
comment on table public.hidden_task     is 'Per-garden task suppression. Idempotent by primary key.';

comment on column public.task.suppress_if_wind_above is
  'mph. Task is HIDDEN when wind exceeds this (corrected semantics vs 1.x Requires_Wind_Above).';
comment on column public.garden_item.legacy_category is
  'The category tile the user originally added this item under. Carried for parity; not read by v2 logic.';


-- ============================================================================
--  CONFIRMATION READOUT — lists what this file created (safe to re-run).
--  The web SQL Editor shows this as a grid, so "Success. No rows returned"
--  becomes a table of the 12 tables with their column and constraint counts.
-- ============================================================================
select
  t.table_name as "Table",
  (select count(*) from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = t.table_name) as "Columns",
  (select count(*) from information_schema.table_constraints tc
     where tc.table_schema = 'public' and tc.table_name = t.table_name) as "Constraints"
from information_schema.tables t
where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
order by t.table_name;
