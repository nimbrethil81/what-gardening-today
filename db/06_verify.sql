-- ============================================================================
--  Stage 1 migration, file 6 of 6: VERIFY  (build-order step 6)
--  Read-only. Run this in the Supabase SQL Editor AFTER 05_transform.sql to
--  confirm your own database matches. It shows three grids: a row-count summary,
--  the coverage report (items that would receive no task), and the retirement
--  roll-call. Nothing is changed.
-- ============================================================================

-- ---------- 1. ROW-COUNT SUMMARY --------------------------------------------
select 'category'           as "Table", count(*) as "Rows" from public.category
union all select 'blueprint',            count(*) from public.blueprint
union all select 'blueprint_category',   count(*) from public.blueprint_category
union all select 'collection',           count(*) from public.collection
union all select 'collection_member',    count(*) from public.collection_member
union all select 'task (incl tombstones)', count(*) from public.task
union all select 'task_target',          count(*) from public.task_target
union all select 'garden',               count(*) from public.garden
union all select 'garden_item',          count(*) from public.garden_item
union all select 'task_completion',      count(*) from public.task_completion
union all select 'hidden_task',          count(*) from public.hidden_task
union all select 'tasks retired',        count(*) from public.task where retired_at is not null
order by 1;

-- ---------- 2. COVERAGE: blueprints that would receive NO task ---------------
-- A blueprint is "covered" if a non-retired task targets it directly, or targets
-- a collection it belongs to. Anything listed here would show nothing if added
-- to a garden — expected for items whose tasks haven't been authored yet.
with covered as (
  select distinct b.id
  from public.blueprint b
  join public.task_target tt on tt.blueprint_id = b.id
  join public.task t on t.id = tt.task_id and t.retired_at is null
  union
  select distinct cm.blueprint_id
  from public.collection_member cm
  join public.task_target tt on tt.collection_id = cm.collection_id
  join public.task t on t.id = tt.task_id and t.retired_at is null
)
select b.legacy_code as "Uncovered blueprint", b.name as "Name"
from public.blueprint b
where b.id not in (select id from covered)
order by b.legacy_code;

-- ---------- 3. RETIREMENT ROLL-CALL -----------------------------------------
-- The 12 tasks that should be retired: 7 review decisions + 5 tombstones.
select legacy_code as "Retired task", left(name, 50) as "Name"
from public.task
where retired_at is not null
order by legacy_code;
