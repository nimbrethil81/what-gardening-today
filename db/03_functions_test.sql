-- ============================================================================
--  Function tests for 03_functions.sql   (Stage 1, build-order step 4)
--
--  WHAT THIS PROVES: that create_garden makes a garden AND its owner in one
--  step, and that select_tasks returns exactly the right tasks — matched,
--  in season, off cooldown, not hidden, weather-filtered — and REFUSES a garden
--  the caller doesn't belong to.
--
--  HOW TO RUN: paste into the Supabase SQL Editor and Run. Creates throwaway
--  data, checks everything, ROLLS BACK. Read the results grid: every row should
--  say "pass" and the summary "ALL CHECKS PASSED".
-- ============================================================================

begin;

-- ---- visible-results plumbing ----------------------------------------------
create temp table _t_results (seq serial primary key, outcome text, label text);
alter table _t_results disable row level security;

create or replace function public._record(p_outcome text, p_label text)
returns void language plpgsql security definer as $$
begin insert into pg_temp._t_results(outcome,label) values (p_outcome,p_label); end $$;

create or replace function public.t_count(label text, q text, expected bigint)
returns void language plpgsql security invoker as $$
declare n bigint;
begin
  begin execute q into n;
    if n = expected then perform public._record('pass', label||' (saw '||n||')');
    else perform public._record('FAIL', label||' — expected '||expected||', saw '||n); end if;
  exception when others then
    perform public._record('FAIL', label||' — expected '||expected||' but errored: '||sqlerrm);
  end;
end $$;

create or replace function public.t_ok(label text, stmt text)
returns void language plpgsql security invoker as $$
begin
  begin execute stmt; perform public._record('pass', label);
  exception when others then perform public._record('FAIL', label||' — errored: '||sqlerrm); end;
end $$;

create or replace function public.t_blocked(label text, stmt text)
returns void language plpgsql security invoker as $$
begin
  begin execute stmt; perform public._record('FAIL', label||' — was ACCEPTED, expected refusal');
  exception when others then perform public._record('pass', label); end;
end $$;

grant execute on function
  public.t_count(text,text,bigint), public.t_ok(text,text),
  public.t_blocked(text,text), public._record(text,text)
to anon, authenticated;

-- ---- sign-in accounts ------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
   confirmation_token, recovery_token, email_change_token_new, email_change)
values
  ('00000000-0000-0000-0000-000000000000','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
   'authenticated','authenticated','alice@test.local','', now(), now(), now(),
   '{"provider":"email"}','{}','','','',''),
  ('00000000-0000-0000-0000-000000000000','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
   'authenticated','authenticated','bob@test.local','', now(), now(), now(),
   '{"provider":"email"}','{}','','','','');

-- ---- catalogue fixtures ----------------------------------------------------
insert into public.category(name,sort_order) values ('FnTestCat',1);
insert into public.blueprint(name,legacy_code) values
  ('FnRose','FN_ROSE'),('FnStrawberry','FN_STRAW'),('FnLavender','FN_LAV');
insert into public.collection(code,name) values ('GROUP_FN_SOFT','Fn soft fruit');
insert into public.collection_member(collection_id,blueprint_id)
  select (select id from public.collection where code='GROUP_FN_SOFT'),
         (select id from public.blueprint where legacy_code='FN_STRAW');

-- ---- Alice's garden (inserted directly for controlled select_tasks fixtures)
insert into public.garden(id,name,latitude,longitude,timezone) values
  ('d0d0d0d0-0000-0000-0000-0000000000f1','FnGarden',51.66,-0.60,'Europe/London'),
  ('d0d0d0d0-0000-0000-0000-0000000000f2','BobFnGarden',52,-1,'Europe/London');
insert into public.garden_member(garden_id,user_id,role) values
  ('d0d0d0d0-0000-0000-0000-0000000000f1','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1','owner'),
  ('d0d0d0d0-0000-0000-0000-0000000000f2','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1','owner');

-- Garden contains a rose and a strawberry (NOT a lavender)
insert into public.garden_item(garden_id,blueprint_id)
  select 'd0d0d0d0-0000-0000-0000-0000000000f1', id from public.blueprint where legacy_code in ('FN_ROSE','FN_STRAW');

-- ---- tasks (all target the rose unless noted; June-friendly) ---------------
-- helper category id
-- T_BP: rose blueprint target → should appear
insert into public.task(id,legacy_code,name,category_id,valid_months,frequency_days) overriding system value
  values (7001,'FN_T_BP','Rose task',(select id from public.category where name='FnTestCat'),'{1,2,3,4,5,6,7,8,9,10,11,12}',30);
insert into public.task_target(task_id,blueprint_id)
  select 7001,(select id from public.blueprint where legacy_code='FN_ROSE');

-- T_COL: collection target (soft fruit → strawberry) → should appear
insert into public.task(id,legacy_code,name,category_id,valid_months,frequency_days) overriding system value
  values (7002,'FN_T_COL','Soft fruit task',(select id from public.category where name='FnTestCat'),'{1,2,3,4,5,6,7,8,9,10,11,12}',30);
insert into public.task_target(task_id,collection_id)
  select 7002,(select id from public.collection where code='GROUP_FN_SOFT');

-- T_OTHER: lavender blueprint target, garden has no lavender → should NOT appear
insert into public.task(id,legacy_code,name,category_id,valid_months,frequency_days) overriding system value
  values (7003,'FN_T_OTHER','Lavender task',(select id from public.category where name='FnTestCat'),'{1,2,3,4,5,6,7,8,9,10,11,12}',30);
insert into public.task_target(task_id,blueprint_id)
  select 7003,(select id from public.blueprint where legacy_code='FN_LAV');

-- T_SEASON: rose, December only → absent in June
insert into public.task(id,legacy_code,name,category_id,valid_months,frequency_days) overriding system value
  values (7004,'FN_T_SEASON','Winter rose task',(select id from public.category where name='FnTestCat'),'{12}',30);
insert into public.task_target(task_id,blueprint_id) select 7004,(select id from public.blueprint where legacy_code='FN_ROSE');

-- T_CD_RECENT: rose, freq 7, completed 3 days ago → on cooldown → absent
insert into public.task(id,legacy_code,name,category_id,valid_months,frequency_days) overriding system value
  values (7005,'FN_T_CD_RECENT','Recently done',(select id from public.category where name='FnTestCat'),'{1,2,3,4,5,6,7,8,9,10,11,12}',7);
insert into public.task_target(task_id,blueprint_id) select 7005,(select id from public.blueprint where legacy_code='FN_ROSE');
insert into public.task_completion(garden_id,task_id,completed_at)
  values ('d0d0d0d0-0000-0000-0000-0000000000f1',7005, now() - interval '3 days');

-- T_CD_OLD: rose, freq 7, completed 10 days ago → off cooldown → present
insert into public.task(id,legacy_code,name,category_id,valid_months,frequency_days) overriding system value
  values (7006,'FN_T_CD_OLD','Done long ago',(select id from public.category where name='FnTestCat'),'{1,2,3,4,5,6,7,8,9,10,11,12}',7);
insert into public.task_target(task_id,blueprint_id) select 7006,(select id from public.blueprint where legacy_code='FN_ROSE');
insert into public.task_completion(garden_id,task_id,completed_at)
  values ('d0d0d0d0-0000-0000-0000-0000000000f1',7006, now() - interval '10 days');

-- T_HIDDEN: rose, hidden → absent
insert into public.task(id,legacy_code,name,category_id,valid_months,frequency_days) overriding system value
  values (7007,'FN_T_HIDDEN','Hidden task',(select id from public.category where name='FnTestCat'),'{1,2,3,4,5,6,7,8,9,10,11,12}',30);
insert into public.task_target(task_id,blueprint_id) select 7007,(select id from public.blueprint where legacy_code='FN_ROSE');
insert into public.hidden_task(garden_id,task_id) values ('d0d0d0d0-0000-0000-0000-0000000000f1',7007);

-- T_RAIN: rose, suppress when raining
insert into public.task(id,legacy_code,name,category_id,valid_months,frequency_days,suppress_if_raining) overriding system value
  values (7008,'FN_T_RAIN','Rain-sensitive',(select id from public.category where name='FnTestCat'),'{1,2,3,4,5,6,7,8,9,10,11,12}',30,true);
insert into public.task_target(task_id,blueprint_id) select 7008,(select id from public.blueprint where legacy_code='FN_ROSE');

-- T_TEMP: rose, suppress when temp below 10
insert into public.task(id,legacy_code,name,category_id,valid_months,frequency_days,suppress_if_temp_below) overriding system value
  values (7009,'FN_T_TEMP','Cold-sensitive',(select id from public.category where name='FnTestCat'),'{1,2,3,4,5,6,7,8,9,10,11,12}',30,10);
insert into public.task_target(task_id,blueprint_id) select 7009,(select id from public.blueprint where legacy_code='FN_ROSE');

-- T_WIND: rose, suppress when wind above 20 (corrected sense)
insert into public.task(id,legacy_code,name,category_id,valid_months,frequency_days,suppress_if_wind_above) overriding system value
  values (7010,'FN_T_WIND','Wind-sensitive',(select id from public.category where name='FnTestCat'),'{1,2,3,4,5,6,7,8,9,10,11,12}',30,20);
insert into public.task_target(task_id,blueprint_id) select 7010,(select id from public.blueprint where legacy_code='FN_ROSE');

-- T_ONCE: a manual one-off (null frequency) in the garden, already completed → absent forever
insert into public.task(id,garden_id,legacy_code,name,valid_months,frequency_days) overriding system value
  values (7011,'d0d0d0d0-0000-0000-0000-0000000000f1','FN_T_ONCE','One-off done','{1,2,3,4,5,6,7,8,9,10,11,12}',null);
insert into public.task_completion(garden_id,task_id,completed_at)
  values ('d0d0d0d0-0000-0000-0000-0000000000f1',7011, now() - interval '2 days');


-- ============================================================================
--  create_garden
-- ============================================================================
reset role; set request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1"}'; set role authenticated;

select public.t_ok('create_garden runs for a signed-in user',
  'select public.create_garden(''My New Garden'',51.5,-0.1)');
select public.t_count('create_garden made the garden',
  'select count(*) from public.garden where name=''My New Garden''', 1);
select public.t_count('create_garden made the caller its OWNER',
  'select count(*) from public.garden_member gm join public.garden g on g.id=gm.garden_id
     where g.name=''My New Garden'' and gm.user_id=''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'' and gm.role=''owner''', 1);
select public.t_ok('create_garden is permissive about a second garden',
  'select public.create_garden(''My Second Garden'',51.5,-0.1)');
select public.t_count('caller now owns two gardens',
  'select count(*) from public.garden_member where user_id=''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'' and role=''owner''', 3);
  -- 3 = FnGarden (fixture) + the two just created

reset role; set request.jwt.claims = '{}'; set role anon;
select public.t_blocked('a signed-out visitor cannot create a garden',
  'select public.create_garden(''Anon Garden'',51,0)');

-- ============================================================================
--  select_tasks — matching, season, cooldown, hidden
-- ============================================================================
reset role; set request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1"}'; set role authenticated;

select public.t_count('rose (blueprint target) appears',
  'select count(*) from public.select_tasks(''d0d0d0d0-0000-0000-0000-0000000000f1'',6) where legacy_code=''FN_T_BP''', 1);
select public.t_count('soft-fruit (collection target) appears',
  'select count(*) from public.select_tasks(''d0d0d0d0-0000-0000-0000-0000000000f1'',6) where legacy_code=''FN_T_COL''', 1);
select public.t_count('lavender task (no matching item) is absent',
  'select count(*) from public.select_tasks(''d0d0d0d0-0000-0000-0000-0000000000f1'',6) where legacy_code=''FN_T_OTHER''', 0);
select public.t_count('out-of-season task is absent in June',
  'select count(*) from public.select_tasks(''d0d0d0d0-0000-0000-0000-0000000000f1'',6) where legacy_code=''FN_T_SEASON''', 0);
select public.t_count('out-of-season task IS present in December',
  'select count(*) from public.select_tasks(''d0d0d0d0-0000-0000-0000-0000000000f1'',12) where legacy_code=''FN_T_SEASON''', 1);
select public.t_count('recently-completed task is on cooldown (absent)',
  'select count(*) from public.select_tasks(''d0d0d0d0-0000-0000-0000-0000000000f1'',6) where legacy_code=''FN_T_CD_RECENT''', 0);
select public.t_count('long-ago-completed task is off cooldown (present)',
  'select count(*) from public.select_tasks(''d0d0d0d0-0000-0000-0000-0000000000f1'',6) where legacy_code=''FN_T_CD_OLD''', 1);
select public.t_count('hidden task is absent',
  'select count(*) from public.select_tasks(''d0d0d0d0-0000-0000-0000-0000000000f1'',6) where legacy_code=''FN_T_HIDDEN''', 0);
select public.t_count('completed one-off task is absent forever',
  'select count(*) from public.select_tasks(''d0d0d0d0-0000-0000-0000-0000000000f1'',6) where legacy_code=''FN_T_ONCE''', 0);

-- ============================================================================
--  select_tasks — weather (each axis applied only when its reading is known)
-- ============================================================================
-- rain
select public.t_count('rain task present when NOT raining',
  'select count(*) from public.select_tasks(''d0d0d0d0-0000-0000-0000-0000000000f1'',6,15,false,5) where legacy_code=''FN_T_RAIN''', 1);
select public.t_count('rain task ABSENT when raining',
  'select count(*) from public.select_tasks(''d0d0d0d0-0000-0000-0000-0000000000f1'',6,15,true,5) where legacy_code=''FN_T_RAIN''', 0);
select public.t_count('rain task present when weather unknown',
  'select count(*) from public.select_tasks(''d0d0d0d0-0000-0000-0000-0000000000f1'',6) where legacy_code=''FN_T_RAIN''', 1);
-- temp
select public.t_count('cold task present when warm (15C)',
  'select count(*) from public.select_tasks(''d0d0d0d0-0000-0000-0000-0000000000f1'',6,15,false,5) where legacy_code=''FN_T_TEMP''', 1);
select public.t_count('cold task ABSENT when cold (5C)',
  'select count(*) from public.select_tasks(''d0d0d0d0-0000-0000-0000-0000000000f1'',6,5,false,5) where legacy_code=''FN_T_TEMP''', 0);
select public.t_count('cold task present when temperature unknown',
  'select count(*) from public.select_tasks(''d0d0d0d0-0000-0000-0000-0000000000f1'',6,null,false,5) where legacy_code=''FN_T_TEMP''', 1);
-- wind (corrected: too windy hides)
select public.t_count('wind task present when calm (5mph)',
  'select count(*) from public.select_tasks(''d0d0d0d0-0000-0000-0000-0000000000f1'',6,15,false,5) where legacy_code=''FN_T_WIND''', 1);
select public.t_count('wind task ABSENT when too windy (30mph)',
  'select count(*) from public.select_tasks(''d0d0d0d0-0000-0000-0000-0000000000f1'',6,15,false,30) where legacy_code=''FN_T_WIND''', 0);
select public.t_count('wind task present when wind unknown',
  'select count(*) from public.select_tasks(''d0d0d0d0-0000-0000-0000-0000000000f1'',6,15,false,null) where legacy_code=''FN_T_WIND''', 1);

-- ============================================================================
--  select_tasks — the refusal
-- ============================================================================
select public.t_blocked('Alice is refused select_tasks for Bob''s garden',
  'select * from public.select_tasks(''d0d0d0d0-0000-0000-0000-0000000000f2'',6)');

reset role; set request.jwt.claims = '{}'; set role anon;
select public.t_blocked('a signed-out visitor is refused select_tasks',
  'select * from public.select_tasks(''d0d0d0d0-0000-0000-0000-0000000000f1'',6)');

-- ============================================================================
--  VISIBLE RESULTS
-- ============================================================================
reset role;
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
