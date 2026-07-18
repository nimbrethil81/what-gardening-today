-- ============================================================================
--  RLS test matrix for 02_rls.sql   (Stage 1, build-order step 3)
--
--  WHAT THIS PROVES: that the access-control policies behave EXACTLY as the
--  agreed matrix says — a user sees and changes only their own garden's data,
--  shared content is read-only to users, and a request crafted for a garden you
--  don't belong to is refused.
--
--  HOW TO RUN: paste the whole file into the Supabase SQL Editor and Run.
--  It creates throwaway sign-in accounts, runs every case as the right person,
--  and ROLLS BACK — no permanent change.
--
--  HOW TO READ IT: a results grid appears, one row per check, first row a
--  summary. You want every row to read "pass" and the summary to say ALL PASSED.
--  (Results are a grid, not messages, because the web editor hides NOTICEs.)
--
--  The cast:
--    Alice — owner of the Home garden.
--    Carol — member of Home, but NOT an owner.
--    Bob   — owner of a DIFFERENT garden; no connection to Home.
--    Dave  — a spare account, used only to test adding/removing a member.
--
--  NOTE ON auth.users: to have real sign-in identities to attach memberships to,
--  this creates rows in Supabase's auth.users table with the standard seed
--  columns, then rolls them back. If a future Supabase version rejects that
--  insert, adjust the column list in the fixtures block.
-- ============================================================================

begin;

-- ---- visible-results plumbing ----------------------------------------------
create temp table _t_results (seq serial primary key, outcome text, label text);
alter table _t_results disable row level security;

-- _record writes a result row. SECURITY DEFINER + lives in public, so it can be
-- called by any simulated user (Alice/Bob/anon) yet always writes as the admin.
create or replace function public._record(p_outcome text, p_label text)
returns void language plpgsql security definer as $$
begin insert into pg_temp._t_results(outcome,label) values (p_outcome,p_label); end $$;

-- ---- throwaway sign-in accounts --------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
   confirmation_token, recovery_token, email_change_token_new, email_change)
values
  ('00000000-0000-0000-0000-000000000000','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
   'authenticated','authenticated','alice@test.local','', now(), now(), now(),
   '{"provider":"email"}','{}','','','',''),
  ('00000000-0000-0000-0000-000000000000','cccccccc-cccc-cccc-cccc-ccccccccccc1',
   'authenticated','authenticated','carol@test.local','', now(), now(), now(),
   '{"provider":"email"}','{}','','','',''),
  ('00000000-0000-0000-0000-000000000000','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
   'authenticated','authenticated','bob@test.local','', now(), now(), now(),
   '{"provider":"email"}','{}','','','',''),
  ('00000000-0000-0000-0000-000000000000','dddddddd-dddd-dddd-dddd-ddddddddddd1',
   'authenticated','authenticated','dave@test.local','', now(), now(), now(),
   '{"provider":"email"}','{}','','','','');

-- ---- shared catalogue fixtures ---------------------------------------------
insert into public.category(name,sort_order) values ('RLSTestCat',1);
insert into public.blueprint(name,legacy_code) values ('RLSTestBP','RLS_TEST_BP');
insert into public.collection(code,name) values ('GROUP_RLS_TEST','RLS test group');

-- ---- gardens + membership --------------------------------------------------
insert into public.garden(id,name,latitude,longitude) values
  ('d0d0d0d0-0000-0000-0000-000000000001','Home',   51.66,-0.60),
  ('d0d0d0d0-0000-0000-0000-000000000002','BobHome',52.00,-1.00);

insert into public.garden_member(garden_id,user_id,role) values
  ('d0d0d0d0-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1','owner'),
  ('d0d0d0d0-0000-0000-0000-000000000001','cccccccc-cccc-cccc-cccc-ccccccccccc1','member'),
  ('d0d0d0d0-0000-0000-0000-000000000002','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1','owner');

-- ---- inventory in each garden ----------------------------------------------
insert into public.garden_item(id,garden_id,blueprint_id) overriding system value
  select 5001,'d0d0d0d0-0000-0000-0000-000000000001', id from public.blueprint where legacy_code='RLS_TEST_BP';
insert into public.garden_item(id,garden_id,blueprint_id) overriding system value
  select 5002,'d0d0d0d0-0000-0000-0000-000000000002', id from public.blueprint where legacy_code='RLS_TEST_BP';

-- ---- one shared task, one manual task per garden ---------------------------
insert into public.task(id,legacy_code,name,category_id,valid_months,frequency_days) overriding system value
  select 6001,'RLS_SHARED','Shared task',(select id from public.category where name='RLSTestCat'),'{1,2,3,4,5,6,7,8,9,10,11,12}',7;
insert into public.task(id,garden_id,name,valid_months) overriding system value
  values (6002,'d0d0d0d0-0000-0000-0000-000000000001','Alice manual task','{1,2,3,4,5,6,7,8,9,10,11,12}');
insert into public.task(id,garden_id,name,valid_months) overriding system value
  values (6003,'d0d0d0d0-0000-0000-0000-000000000002','Bob manual task','{1,2,3,4,5,6,7,8,9,10,11,12}');

-- ---- a completion + a hidden task in each garden ---------------------------
insert into public.task_completion(garden_id,task_id) values
  ('d0d0d0d0-0000-0000-0000-000000000001',6001),
  ('d0d0d0d0-0000-0000-0000-000000000002',6001);
insert into public.hidden_task(garden_id,task_id) values
  ('d0d0d0d0-0000-0000-0000-000000000001',6001),
  ('d0d0d0d0-0000-0000-0000-000000000002',6001);

-- ============================================================================
--  ASSERTION HELPERS (SECURITY INVOKER: the assertion query runs as the
--  simulated user, so RLS is evaluated for them; result recording goes through
--  public._record which writes as the admin).
-- ============================================================================
create or replace function public.t_count(label text, q text, expected bigint)
returns void language plpgsql security invoker as $$
declare n bigint;
begin
  begin execute q into n;
    if n = expected then perform public._record('pass', label || ' (saw '||n||')');
    else perform public._record('FAIL', label||' — expected '||expected||', saw '||n); end if;
  exception when others then
    perform public._record('FAIL', label||' — expected '||expected||' but errored: '||sqlerrm);
  end;
end $$;

create or replace function public.t_no_read(label text, q text)
returns void language plpgsql security invoker as $$
declare n bigint;
begin
  begin execute q into n;
    if n = 0 then perform public._record('pass', label||' (saw nothing)');
    else perform public._record('FAIL', label||' — expected nothing, saw '||n); end if;
  exception when others then
    perform public._record('pass', label||' (read refused)');
  end;
end $$;

create or replace function public.t_ok(label text, stmt text)
returns void language plpgsql security invoker as $$
declare n bigint;
begin
  begin execute stmt; get diagnostics n = row_count;
    if n >= 1 then perform public._record('pass', label||' ('||n||' row)');
    else perform public._record('FAIL', label||' — succeeded but changed 0 rows'); end if;
  exception when others then
    perform public._record('FAIL', label||' — errored, expected success: '||sqlerrm);
  end;
end $$;

create or replace function public.t_blocked(label text, stmt text)
returns void language plpgsql security invoker as $$
begin
  begin execute stmt;
    perform public._record('FAIL', label||' — was ACCEPTED, expected a block');
  exception when others then
    perform public._record('pass', label);
  end;
end $$;

create or replace function public.t_noop(label text, stmt text)
returns void language plpgsql security invoker as $$
declare n bigint;
begin
  begin execute stmt; get diagnostics n = row_count;
    if n = 0 then perform public._record('pass', label||' (nothing changed)');
    else perform public._record('FAIL', label||' — changed '||n||' row(s), expected 0'); end if;
  exception when others then
    perform public._record('FAIL', label||' — errored, expected a silent no-op: '||sqlerrm);
  end;
end $$;

grant execute on function
  public.t_count(text,text,bigint), public.t_no_read(text,text),
  public.t_ok(text,text), public.t_blocked(text,text), public.t_noop(text,text),
  public._record(text,text)
to anon, authenticated;

-- ============================================================================
--  SHARED CONTENT
-- ============================================================================
reset role; set request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1"}'; set role authenticated;
select public.t_count ('Alice reads the catalogue',            'select count(*) from public.category where name=''RLSTestCat''', 1);
select public.t_count ('Alice reads shared tasks',             'select count(*) from public.task where garden_id is null and id=6001', 1);
select public.t_blocked('Alice cannot create a blueprint',     'insert into public.blueprint(name,legacy_code) values (''Nope'',''RLS_NOPE'')');
select public.t_blocked('Alice cannot create a collection',    'insert into public.collection(code) values (''GROUP_NOPE'')');
select public.t_blocked('Alice cannot edit a shared blueprint','update public.blueprint set name=''Hacked'' where legacy_code=''RLS_TEST_BP''');

reset role; set request.jwt.claims = '{}'; set role anon;
select public.t_no_read('Signed-out visitor sees no catalogue','select count(*) from public.category');
select public.t_no_read('Signed-out visitor sees no tasks',    'select count(*) from public.task');

reset role;
set role service_role;
select public.t_ok('Publish pipeline can add a blueprint',     'insert into public.blueprint(name,legacy_code) values (''PipelineBP'',''RLS_PIPE_BP'')');
select public.t_ok('Publish pipeline can edit a shared task',  'update public.task set instruction=''edited'' where id=6001');

-- ============================================================================
--  TASK — the mixed table
-- ============================================================================
reset role; set request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1"}'; set role authenticated;
select public.t_count  ('Alice reads her own manual task',        'select count(*) from public.task where id=6002', 1);
select public.t_no_read('Alice cannot see Bob''s manual task',    'select count(*) from public.task where id=6003');
select public.t_ok     ('Alice creates a manual task in her garden',
  'insert into public.task(garden_id,name,valid_months) values (''d0d0d0d0-0000-0000-0000-000000000001'',''new'',''{6}'')');
select public.t_blocked('Alice cannot create a task in Bob''s garden',
  'insert into public.task(garden_id,name,valid_months) values (''d0d0d0d0-0000-0000-0000-000000000002'',''bad'',''{6}'')');
select public.t_blocked('Alice cannot mint a shared task',
  'insert into public.task(name,category_id,valid_months,frequency_days) values (''bad'',(select id from public.category where name=''RLSTestCat''),''{6}'',7)');
select public.t_ok     ('Alice edits her own manual task',        'update public.task set name=''renamed'' where id=6002');
select public.t_noop   ('Alice editing Bob''s manual task changes nothing','update public.task set name=''x'' where id=6003');
select public.t_noop   ('Alice editing a shared task changes nothing',     'update public.task set name=''x'' where id=6001');
select public.t_blocked('Alice cannot move her task into Bob''s garden',
  'update public.task set garden_id=''d0d0d0d0-0000-0000-0000-000000000002'' where id=6002');
select public.t_blocked('Alice cannot delete a task',             'delete from public.task where id=6002');

reset role; set request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1"}'; set role authenticated;
select public.t_no_read('Bob cannot see Alice''s manual task',    'select count(*) from public.task where id=6002');

-- ============================================================================
--  GARDEN
-- ============================================================================
reset role; set request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1"}'; set role authenticated;
select public.t_count  ('Alice reads her garden',                'select count(*) from public.garden where id=''d0d0d0d0-0000-0000-0000-000000000001''', 1);
select public.t_no_read('Alice cannot see Bob''s garden',        'select count(*) from public.garden where id=''d0d0d0d0-0000-0000-0000-000000000002''');
select public.t_ok     ('Alice (owner) renames her garden',      'update public.garden set name=''Home2'' where id=''d0d0d0d0-0000-0000-0000-000000000001''');
select public.t_noop   ('Alice renaming Bob''s garden changes nothing','update public.garden set name=''x'' where id=''d0d0d0d0-0000-0000-0000-000000000002''');
select public.t_blocked('Alice cannot insert a garden directly',
  'insert into public.garden(name,latitude,longitude) values (''Sneaky'',51,0)');
select public.t_blocked('Alice cannot delete her garden',        'delete from public.garden where id=''d0d0d0d0-0000-0000-0000-000000000001''');

reset role; set request.jwt.claims = '{"sub":"cccccccc-cccc-cccc-cccc-ccccccccccc1"}'; set role authenticated;
select public.t_noop   ('Carol (member) renaming the garden changes nothing','update public.garden set name=''Carols'' where id=''d0d0d0d0-0000-0000-0000-000000000001''');

-- ============================================================================
--  GARDEN MEMBERSHIP
-- ============================================================================
reset role; set request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1"}'; set role authenticated;
select public.t_count  ('Alice sees Home''s members',            'select count(*) from public.garden_member where garden_id=''d0d0d0d0-0000-0000-0000-000000000001''', 2);
select public.t_ok     ('Alice (owner) adds a member',
  'insert into public.garden_member(garden_id,user_id,role) values (''d0d0d0d0-0000-0000-0000-000000000001'',''dddddddd-dddd-dddd-dddd-ddddddddddd1'',''member'')');
select public.t_ok     ('Alice (owner) removes a member',
  'delete from public.garden_member where garden_id=''d0d0d0d0-0000-0000-0000-000000000001'' and user_id=''dddddddd-dddd-dddd-dddd-ddddddddddd1''');

reset role; set request.jwt.claims = '{"sub":"cccccccc-cccc-cccc-cccc-ccccccccccc1"}'; set role authenticated;
select public.t_blocked('Carol (member) cannot add a member',
  'insert into public.garden_member(garden_id,user_id,role) values (''d0d0d0d0-0000-0000-0000-000000000001'',''dddddddd-dddd-dddd-dddd-ddddddddddd1'',''member'')');

reset role; set request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1"}'; set role authenticated;
select public.t_no_read('Bob cannot see Home''s members',        'select count(*) from public.garden_member where garden_id=''d0d0d0d0-0000-0000-0000-000000000001''');
select public.t_blocked('Bob cannot add himself to Home',
  'insert into public.garden_member(garden_id,user_id,role) values (''d0d0d0d0-0000-0000-0000-000000000001'',''bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'',''member'')');

-- ============================================================================
--  INVENTORY, COMPLETIONS, HIDDEN TASKS
-- ============================================================================
reset role; set request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1"}'; set role authenticated;
select public.t_count  ('Alice reads her inventory',             'select count(*) from public.garden_item where garden_id=''d0d0d0d0-0000-0000-0000-000000000001''', 1);
select public.t_no_read('Alice cannot see Bob''s inventory',     'select count(*) from public.garden_item where garden_id=''d0d0d0d0-0000-0000-0000-000000000002''');
select public.t_ok     ('Alice adds an item to her garden',
  'insert into public.garden_item(garden_id,blueprint_id) select ''d0d0d0d0-0000-0000-0000-000000000001'', id from public.blueprint where legacy_code=''RLS_TEST_BP''');
select public.t_blocked('Alice cannot add an item to Bob''s garden',
  'insert into public.garden_item(garden_id,blueprint_id) select ''d0d0d0d0-0000-0000-0000-000000000002'', id from public.blueprint where legacy_code=''RLS_TEST_BP''');
select public.t_ok     ('Alice soft-removes her own item',       'update public.garden_item set removed_at=now() where id=5001');
select public.t_blocked('Alice cannot hard-delete an item',      'delete from public.garden_item where id=5001');

select public.t_ok     ('Alice logs a completion in her garden',
  'insert into public.task_completion(garden_id,task_id) values (''d0d0d0d0-0000-0000-0000-000000000001'',6001)');
select public.t_blocked('Alice cannot log a completion in Bob''s garden',
  'insert into public.task_completion(garden_id,task_id) values (''d0d0d0d0-0000-0000-0000-000000000002'',6001)');
select public.t_blocked('Alice cannot edit a past completion',   'update public.task_completion set notes=''x'' where garden_id=''d0d0d0d0-0000-0000-0000-000000000001''');
select public.t_blocked('Alice cannot delete a past completion', 'delete from public.task_completion where garden_id=''d0d0d0d0-0000-0000-0000-000000000001''');
select public.t_count  ('Alice reads her completions',           'select count(*) from public.task_completion where garden_id=''d0d0d0d0-0000-0000-0000-000000000001''', 2);
select public.t_no_read('Alice cannot see Bob''s completions',   'select count(*) from public.task_completion where garden_id=''d0d0d0d0-0000-0000-0000-000000000002''');

select public.t_ok     ('Alice unhides a task in her garden',    'delete from public.hidden_task where garden_id=''d0d0d0d0-0000-0000-0000-000000000001'' and task_id=6001');
select public.t_ok     ('Alice hides a task in her garden',
  'insert into public.hidden_task(garden_id,task_id) values (''d0d0d0d0-0000-0000-0000-000000000001'',6001)');
select public.t_blocked('Alice cannot hide a task in Bob''s garden',
  'insert into public.hidden_task(garden_id,task_id) values (''d0d0d0d0-0000-0000-0000-000000000002'',6001)');
select public.t_noop   ('Alice unhiding in Bob''s garden changes nothing',
  'delete from public.hidden_task where garden_id=''d0d0d0d0-0000-0000-0000-000000000002'' and task_id=6001');

-- ============================ VISIBLE RESULTS ===============================
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
