-- ============================================================================
--  Constraint test suite for 01_schema.sql   (Stage 1, build-order step 2)
--
--  WHAT THIS PROVES: that the database actively REFUSES the malformed data the
--  old spreadsheet accepted silently, and ACCEPTS every legitimate shape.
--
--  HOW TO RUN: paste the whole file into the Supabase SQL Editor and Run.
--  It wraps everything in a transaction and ROLLS BACK at the end, so it makes
--  no permanent change and can be run as often as you like.
--
--  HOW TO READ THE RESULT: a results grid appears with one row per check. The
--  first row is a summary. You want every row to read "pass" and the summary to
--  say ALL CHECKS PASSED. (Results are shown as a grid, not as messages, because
--  the Supabase web editor does not surface NOTICE messages.)
-- ============================================================================

begin;

-- ---- visible-results plumbing ----------------------------------------------
create temp table _t_results (seq serial primary key, outcome text, label text);
alter table _t_results disable row level security;  -- defensive; temp tables are exempt anyway

create or replace function pg_temp._record(p_outcome text, p_label text)
returns void language plpgsql as $$
begin insert into pg_temp._t_results(outcome,label) values (p_outcome,p_label); end $$;

-- reject(label, sql): the statement SHOULD raise. pass if it does.
create or replace function pg_temp.reject(label text, stmt text) returns void as $$
begin
  begin
    execute stmt;
    perform pg_temp._record('FAIL', label || ' — was ACCEPTED, should have been rejected');
  exception when others then
    perform pg_temp._record('pass', label);
  end;
end $$ language plpgsql;

-- accept(label, sql): the statement SHOULD succeed. pass if it does.
create or replace function pg_temp.accept(label text, stmt text) returns void as $$
begin
  begin
    execute stmt;
    perform pg_temp._record('pass', label);
  exception when others then
    perform pg_temp._record('FAIL', label || ' — was REJECTED, should have been accepted: ' || sqlerrm);
  end;
end $$ language plpgsql;

-- ---- Fixtures: the minimum valid rows the tests build on --------------------
insert into category(name,sort_order) values ('TestCat',1);
insert into blueprint(name,legacy_code) values ('TestRose','TEST_SHRUB_ROSE');
insert into collection(code,name) values ('GROUP_TEST','Test group');
insert into garden(id,name,latitude,longitude)
  values ('aaaaaaaa-0000-0000-0000-0000000000a1','TestHomeGarden',51.66,-0.60),
         ('bbbbbbbb-0000-0000-0000-0000000000b2','TestOtherGarden',52.0,-1.0);
insert into garden_item(garden_id,blueprint_id)
  select 'aaaaaaaa-0000-0000-0000-0000000000a1', id from blueprint where legacy_code='TEST_SHRUB_ROSE';
insert into garden_item(garden_id,blueprint_id)
  select 'bbbbbbbb-0000-0000-0000-0000000000b2', id from blueprint where legacy_code='TEST_SHRUB_ROSE';

-- ============================ REJECTION TESTS ===============================
select pg_temp.reject('valid_months empty',
  $q$insert into task(name,category_id,valid_months,frequency_days)
     values ('x',(select id from category where name='TestCat'),'{}',7)$q$);

select pg_temp.reject('valid_months contains 13',
  $q$insert into task(name,category_id,valid_months,frequency_days)
     values ('x',(select id from category where name='TestCat'),'{3,13}',7)$q$);

select pg_temp.reject('valid_months contains 0',
  $q$insert into task(name,category_id,valid_months,frequency_days)
     values ('x',(select id from category where name='TestCat'),'{0,4}',7)$q$);

select pg_temp.reject('valid_months contains NULL element',
  $q$insert into task(name,category_id,valid_months,frequency_days)
     values ('x',(select id from category where name='TestCat'),array[3,null]::smallint[],7)$q$);

select pg_temp.reject('global task missing category',
  $q$insert into task(name,valid_months,frequency_days) values ('x','{3,4}',7)$q$);

select pg_temp.reject('global task missing frequency',
  $q$insert into task(name,category_id,valid_months)
     values ('x',(select id from category where name='TestCat'),'{3,4}')$q$);

select pg_temp.reject('frequency zero',
  $q$insert into task(name,category_id,valid_months,frequency_days)
     values ('x',(select id from category where name='TestCat'),'{3}',0)$q$);

select pg_temp.reject('estimated_minutes zero',
  $q$insert into task(name,category_id,valid_months,frequency_days,estimated_minutes)
     values ('x',(select id from category where name='TestCat'),'{3}',7,0)$q$);

select pg_temp.reject('duplicate blueprint legacy_code',
  $q$insert into blueprint(name,legacy_code) values ('Another','TEST_SHRUB_ROSE')$q$);

select pg_temp.reject('duplicate category name',
  $q$insert into category(name,sort_order) values ('TestCat',9)$q$);

select pg_temp.reject('garden latitude out of range',
  $q$insert into garden(name,latitude,longitude) values ('bad',999,0)$q$);

select pg_temp.reject('blank garden name',
  $q$insert into garden(name,latitude,longitude) values ('   ',51,0)$q$);

-- task_target: exactly-one-target rule
insert into task(id,name,category_id,valid_months,frequency_days) overriding system value
  values (900000,'target-test',(select id from category where name='TestCat'),'{3}',7);

select pg_temp.reject('task_target with BOTH collection and blueprint',
  $q$insert into task_target(task_id,collection_id,blueprint_id)
     values (900000,(select id from collection where code='GROUP_TEST'),
                    (select id from blueprint where legacy_code='TEST_SHRUB_ROSE'))$q$);

select pg_temp.reject('task_target with NEITHER',
  $q$insert into task_target(task_id) values (900000)$q$);

select pg_temp.reject('manual task attached to item in a DIFFERENT garden',
  $q$insert into task(garden_id,garden_item_id,name,valid_months)
     select 'aaaaaaaa-0000-0000-0000-0000000000a1', gi.id, 'net the plum','{6}'
     from garden_item gi join garden g on g.id=gi.garden_id where g.name='TestOtherGarden'$q$);

select pg_temp.reject('global task carrying a stray garden_item_id',
  $q$insert into task(name,category_id,valid_months,frequency_days,garden_item_id)
     values ('x',(select id from category where name='TestCat'),'{3}',7,
             (select id from garden_item limit 1))$q$);

-- ============================ ACCEPTANCE TESTS ==============================
select pg_temp.accept('valid global task (months 3,4,5; rain-suppressed)',
  $q$insert into task(legacy_code,name,category_id,valid_months,frequency_days,suppress_if_raining)
     values ('TEST_OK1','Spring feed',(select id from category where name='TestCat'),'{3,4,5}',30,true)$q$);

select pg_temp.accept('task_target -> collection only',
  $q$insert into task_target(task_id,collection_id)
     values (900000,(select id from collection where code='GROUP_TEST'))$q$);

select pg_temp.accept('task_target -> blueprint only',
  $q$insert into task_target(task_id,blueprint_id)
     values (900000,(select id from blueprint where legacy_code='TEST_SHRUB_ROSE'))$q$);

select pg_temp.accept('manual one-off task in own garden (no category/frequency)',
  $q$insert into task(garden_id,name,valid_months)
     values ('aaaaaaaa-0000-0000-0000-0000000000a1','restain fence','{6,7}')$q$);

select pg_temp.accept('manual task attached to item in the SAME garden',
  $q$insert into task(garden_id,garden_item_id,name,valid_months)
     select 'aaaaaaaa-0000-0000-0000-0000000000a1', gi.id, 'prune the rose','{2}'
     from garden_item gi join garden g on g.id=gi.garden_id where g.name='TestHomeGarden'$q$);

select pg_temp.accept('hide a task (idempotent via ON CONFLICT)',
  $q$insert into hidden_task(garden_id,task_id) values ('aaaaaaaa-0000-0000-0000-0000000000a1',900000)
     on conflict (garden_id,task_id) do nothing$q$);
select pg_temp.accept('hide the SAME task again — still fine',
  $q$insert into hidden_task(garden_id,task_id) values ('aaaaaaaa-0000-0000-0000-0000000000a1',900000)
     on conflict (garden_id,task_id) do nothing$q$);

-- ============================ VISIBLE RESULTS ===============================
select outcome as "Result", label as "Check" from (
  select 0 as ord,
    case when (select count(*) from pg_temp._t_results where outcome='FAIL')=0
      then '=== ALL ' || (select count(*) from pg_temp._t_results)::text || ' CHECKS PASSED ==='
      else '=== ' || (select count(*) from pg_temp._t_results where outcome='FAIL')::text
           || ' OF ' || (select count(*) from pg_temp._t_results)::text || ' CHECKS FAILED ===' end as outcome,
    '' as label
  union all
  select seq as ord, outcome, label from pg_temp._t_results
) x order by ord;

rollback;
