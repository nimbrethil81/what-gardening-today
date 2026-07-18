-- ============================================================================
--  Stage 1 migration, file 5 of 6: TRANSFORM  (build-order step 5)
--  Turns the staging tables into the live v2 tables, applying every decision
--  from the category-tier review. Run AFTER 04_staging.sql.
--
--  Re-runnable: it clears the v2 data tables first, so running it twice gives
--  the same result. (auth.users and any garden_member rows are NOT touched.)
--
--  Decisions encoded here (from the review):
--    * Categories in SPEC.md order.
--    * 19 category-tier tasks re-homed to collections; 7 retired.
--    * 5 new collections: GROUP_ALL_BEDS, GROUP_SHRUB_GENERIC,
--      GROUP_TREE_GENERIC, GROUP_HERBS, GROUP_HAND_TOOLS.
--    * 5 tombstones (0050, 0051, 0064, 0082, 0083) recreated as retired tasks
--      so completion history keeps a valid reference and IDs can't be reused.
-- ============================================================================

-- Clear v2 data (children first via CASCADE). Curated + per-garden alike.
truncate
  public.task_target, public.collection_member, public.blueprint_category,
  public.hidden_task, public.task_completion, public.garden_item,
  public.task, public.collection, public.blueprint, public.category,
  public.garden
restart identity cascade;


-- ============================================================================
--  1. CATEGORY  (SPEC.md order)
-- ============================================================================
insert into public.category (name, sort_order) values
  ('Lawn',1), ('Beds',2), ('Trees & shrubs',3), ('Plants & flowers',4),
  ('Veg & herbs',5), ('Garden structures',6), ('Tools',7);


-- ============================================================================
--  2. BLUEPRINT  (one per Item_Dictionary row)
-- ============================================================================
insert into public.blueprint (name, legacy_code)
select btrim(d.suggested_name), btrim(d.prefix)
from staging.item_dictionary d
where btrim(d.prefix) <> '';


-- ============================================================================
--  3. BLUEPRINT_CATEGORY  (split the comma-separated Category cell)
-- ============================================================================
insert into public.blueprint_category (blueprint_id, category_id)
select distinct b.id, c.id
from staging.item_dictionary d
join public.blueprint b on b.legacy_code = btrim(d.prefix)
cross join lateral unnest(string_to_array(d.category, ',')) as raw(nm)
join public.category c on c.name = btrim(raw.nm)
where btrim(raw.nm) <> '';


-- ============================================================================
--  4. COLLECTION  (5 existing groups + 5 new from the review)
-- ============================================================================
insert into public.collection (code, name) values
  ('GROUP_GRASS_LAWN',     'Grass lawns'),
  ('GROUP_CULTIVATED_BED', 'Cultivated beds'),
  ('GROUP_TENDER_BULB',    'Tender bulbs'),
  ('GROUP_BRASSICA',       'Brassicas'),
  ('GROUP_SOFT_FRUIT',     'Soft fruit'),
  -- new, from the category-tier review:
  ('GROUP_ALL_BEDS',       'All beds (weeding)'),
  ('GROUP_SHRUB_GENERIC',  'All shrubs (generic care)'),
  ('GROUP_TREE_GENERIC',   'All trees (generic care)'),
  ('GROUP_HERBS',          'All herbs'),
  ('GROUP_HAND_TOOLS',     'Hand tools');


-- ============================================================================
--  5. COLLECTION_MEMBER
-- ============================================================================
-- 5a. Existing groups, exactly as declared in the Groups cell.
insert into public.collection_member (collection_id, blueprint_id)
select distinct col.id, b.id
from staging.item_dictionary d
cross join lateral unnest(string_to_array(d.groups, ',')) as raw(code)
join public.collection col on col.code = btrim(raw.code)
join public.blueprint b on b.legacy_code = btrim(d.prefix)
where btrim(raw.code) <> '';

-- 5b. New "whole category" collections: every blueprint whose top-level prefix
--     matches. These faithfully reproduce the old category-tier reach for tasks
--     that are genuinely universal within their category.
insert into public.collection_member (collection_id, blueprint_id)
select col.id, b.id
from public.blueprint b
join public.collection col
  on (col.code = 'GROUP_ALL_BEDS'      and split_part(b.legacy_code,'_',1) = 'BED')
  or (col.code = 'GROUP_SHRUB_GENERIC' and split_part(b.legacy_code,'_',1) = 'SHRUB')
  or (col.code = 'GROUP_TREE_GENERIC'  and split_part(b.legacy_code,'_',1) = 'TREE')
  or (col.code = 'GROUP_HERBS'         and split_part(b.legacy_code,'_',1) = 'HERB');

-- 5c. Hand tools: the explicit subset that actually gets rust/oil care
--     (power tools and non-applicable items excluded — see review decision B).
insert into public.collection_member (collection_id, blueprint_id)
select col.id, b.id
from public.blueprint b
join public.collection col on col.code = 'GROUP_HAND_TOOLS'
where b.legacy_code in (
  'TOOL_TROWEL','TOOL_GARDEN_FORK','TOOL_SPADE','TOOL_HOE',
  'TOOL_SECATEURS','TOOL_SHEARS','TOOL_LOPPERS','TOOL_LEAF_RAKE'
);


-- ============================================================================
--  6. TASK  (612 curated tasks + 5 tombstones)
--  retired_at is set for the 7 review-retirements now; tombstones are inserted
--  already-retired below.
-- ============================================================================
insert into public.task
  (legacy_code, name, instruction, category_id, valid_months, frequency_days,
   suppress_if_raining, suppress_if_temp_below, suppress_if_wind_above,
   estimated_minutes, garden_id, retired_at)
select
  btrim(m.task_id),
  m.name,
  nullif(m.instruction, ''),
  c.id,
  string_to_array(replace(m.valid_months, ' ', ''), ',')::smallint[],
  nullif(m.frequency_days, '')::integer,
  (btrim(m.suppress_if_raining) = 'TRUE'),
  nullif(m.suppress_if_temp_below, '')::numeric,
  nullif(m.requires_wind_above, '')::numeric,
  nullif(m.estimated_minutes, '')::integer,
  null,  -- global (curated) task
  case when btrim(m.task_id) in
    -- the 7 review-retirements (Re-edge Borders + the six Plant tasks)
    ('TASK_0027','TASK_0042','TASK_0043','TASK_0044','TASK_0047','TASK_0052','TASK_0053')
    then now() else null end
from staging.master_task_matrix m
join public.category c on c.name = btrim(m.category)
where btrim(m.task_id) <> '';

-- Tombstones: recreated so their Task_Log completions keep a valid reference and
-- their IDs can never be reused. Global rows need a category + frequency, so we
-- give them a nominal one; they are retired and never surface in the app.
insert into public.task
  (legacy_code, name, category_id, valid_months, frequency_days, garden_id, retired_at)
values
  ('TASK_0050','(retired) Cut Back Perennials',
     (select id from public.category where name='Plants & flowers'), '{1}', 365, null, now()),
  ('TASK_0051','(retired) Divide Perennials',
     (select id from public.category where name='Plants & flowers'), '{1}', 365, null, now()),
  ('TASK_0064','(retired) Clean Spray Bottles and Sprayers',
     (select id from public.category where name='Tools'), '{1}', 365, null, now()),
  ('TASK_0082','(retired) task 0082 — name not recovered',
     (select id from public.category where name='Tools'), '{1}', 365, null, now()),
  ('TASK_0083','(retired) task 0083 — name not recovered',
     (select id from public.category where name='Tools'), '{1}', 365, null, now());


-- ============================================================================
--  7. TASK_TARGET  (one target per non-retired task)
--  Retired tasks get NO target (they never match anything).
-- ============================================================================
-- 7a. Blueprint-targeted tasks (target is a specific item prefix).
insert into public.task_target (task_id, blueprint_id)
select t.id, b.id
from staging.master_task_matrix m
join public.task t on t.legacy_code = btrim(m.task_id)
join public.blueprint b on b.legacy_code = btrim(m.target)
-- (the join to blueprint already excludes bare categories and GROUP_ targets;
--  the explicit filters below are belt-and-braces)
where t.retired_at is null
  and btrim(m.target) not like 'GROUP_%'
  and btrim(m.target) not in ('LAWN','BED','TREE','SHRUB','PLANT','VEG','HERB','STRUCT','TOOL');

-- 7b. Collection-targeted tasks that already used a GROUP_ tag in the workbook.
insert into public.task_target (task_id, collection_id)
select t.id, col.id
from staging.master_task_matrix m
join public.task t on t.legacy_code = btrim(m.task_id)
join public.collection col on col.code = btrim(m.target)
where t.retired_at is null
  and btrim(m.target) like 'GROUP_%';

-- 7c. The 19 re-homed category-tier tasks -> their assigned collection (review).
insert into public.task_target (task_id, collection_id)
select t.id, col.id
from (values
  ('TASK_0011','GROUP_GRASS_LAWN'), ('TASK_0012','GROUP_GRASS_LAWN'),
  ('TASK_0013','GROUP_GRASS_LAWN'), ('TASK_0014','GROUP_GRASS_LAWN'),
  ('TASK_0015','GROUP_GRASS_LAWN'), ('TASK_0016','GROUP_GRASS_LAWN'),
  ('TASK_0017','GROUP_GRASS_LAWN'),
  ('TASK_0018','GROUP_ALL_BEDS'),   ('TASK_0019','GROUP_ALL_BEDS'),
  ('TASK_0020','GROUP_ALL_BEDS'),
  ('TASK_0066','GROUP_HAND_TOOLS'),
  ('TASK_0077','GROUP_TREE_GENERIC'), ('TASK_0078','GROUP_TREE_GENERIC'),
  ('TASK_0079','GROUP_TREE_GENERIC'),
  ('TASK_0087','GROUP_HERBS'),
  ('TASK_0540','GROUP_SHRUB_GENERIC'), ('TASK_0541','GROUP_SHRUB_GENERIC'),
  ('TASK_0542','GROUP_SHRUB_GENERIC'), ('TASK_0543','GROUP_SHRUB_GENERIC')
) as rehome(code, coll)
join public.task t on t.legacy_code = rehome.code
join public.collection col on col.code = rehome.coll
where t.retired_at is null;


-- ============================================================================
--  8. GARDEN  (Dan's single garden — fixed id so re-runs are stable)
--  No garden_member is created here: no sign-in account exists yet. The garden
--  is linked to Dan's account when he first signs in (Stage 3). Until then it is
--  reachable only via the dashboard (admin), which is expected.
-- ============================================================================
insert into public.garden (id, name, latitude, longitude, timezone)
values ('a0000000-0000-0000-0000-000000000001', 'My Garden', 51.66, -0.60, 'Europe/London');


-- ============================================================================
--  9. GARDEN_ITEM  (active User_Profile rows; legacy_category carried, not read)
-- ============================================================================
insert into public.garden_item
  (garden_id, blueprint_id, friendly_name, legacy_asset_id, legacy_category)
select
  'a0000000-0000-0000-0000-000000000001',
  b.id,
  nullif(btrim(u.friendly_name), ''),
  btrim(u.asset_id),
  nullif(btrim(u.category), '')
from staging.user_profile u
join public.blueprint b
  on b.legacy_code = regexp_replace(btrim(u.asset_id), '_\d{4}$', '')
where upper(btrim(u.is_active)) = 'TRUE';


-- ============================================================================
--  10. TASK_COMPLETION  (date-only -> midday in the garden's timezone, §8)
-- ============================================================================
insert into public.task_completion (garden_id, task_id, completed_at, notes)
select
  'a0000000-0000-0000-0000-000000000001',
  t.id,
  (btrim(l.date_completed)::date + time '12:00') at time zone 'Europe/London',
  nullif(btrim(l.notes), '')
from staging.task_log l
join public.task t on t.legacy_code = btrim(l.task_id);


-- ============================================================================
--  11. HIDDEN_TASK
-- ============================================================================
insert into public.hidden_task (garden_id, task_id, hidden_at)
select
  'a0000000-0000-0000-0000-000000000001',
  t.id,
  (btrim(h.date_hidden)::date + time '12:00') at time zone 'Europe/London'
from staging.hidden_tasks h
join public.task t on t.legacy_code = btrim(h.task_id);
