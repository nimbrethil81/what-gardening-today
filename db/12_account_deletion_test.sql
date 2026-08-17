-- ============================================================================
--  Account deletion test suite for 12_account_deletion.sql
--
--  WHAT THIS PROVES:
--    * a user with no garden at all deletes cleanly
--    * the last member out takes the garden with them, and everything below it
--    * a departing sole OWNER hands the garden over intact
--    * the longest-standing member is the one promoted
--    * a departing non-owner changes nothing about the garden
--    * a departing owner promotes nobody when another owner remains
--    * one user in several gardens at once gets each garden's right outcome
--    * entitlements go with the user; the email is freed for re-registration
--    * a signed-out caller is refused, and nobody can aim it at anyone else
--
--  HOW TO RUN: paste into the Supabase SQL Editor and Run. It creates throwaway
--  data, checks everything, and ROLLS BACK — no permanent change, run as often
--  as you like. Every row should say "pass".
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


-- ============================================================================
--  FIXTURES
--
--  F1  sole owner of G1 (with items, history and an entitlement) — leaves
--  F2  sole owner of G2, F3 is a member                          — F2 leaves
--  F4  owner of G3, F5 is a member                               — F5 leaves
--  F6  owner of G4, F7 is a SECOND owner                         — F7 leaves
--  F8  owner of G5, F9 joined early, F10 joined later            — F8 leaves
--  F11 no garden at all                                          — leaves
--  F12 owner of G6 (alone) AND sole owner of G7 (with F13)       — leaves
-- ============================================================================
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
   confirmation_token, recovery_token, email_change_token_new, email_change)
select
  '00000000-0000-0000-0000-000000000000',
  ('ffffffff-ffff-ffff-ffff-fffffffff' || lpad(n::text, 3, '0'))::uuid,
  'authenticated','authenticated','del-f' || n || '@test.local','',
  now(), now(), now(), '{"provider":"email"}','{}','','','',''
from generate_series(1,13) n;

insert into public.garden(id,name,latitude,longitude) values
  ('d1d1d1d1-0000-0000-0000-000000000001','DelG1',51.66,-0.60),
  ('d1d1d1d1-0000-0000-0000-000000000002','DelG2',51.66,-0.60),
  ('d1d1d1d1-0000-0000-0000-000000000003','DelG3',51.66,-0.60),
  ('d1d1d1d1-0000-0000-0000-000000000004','DelG4',51.66,-0.60),
  ('d1d1d1d1-0000-0000-0000-000000000005','DelG5',51.66,-0.60),
  ('d1d1d1d1-0000-0000-0000-000000000006','DelG6',51.66,-0.60),
  ('d1d1d1d1-0000-0000-0000-000000000007','DelG7',51.66,-0.60);

insert into public.garden_member(garden_id,user_id,role,added_at) values
  ('d1d1d1d1-0000-0000-0000-000000000001','ffffffff-ffff-ffff-ffff-fffffffff001','owner', now()),
  ('d1d1d1d1-0000-0000-0000-000000000002','ffffffff-ffff-ffff-ffff-fffffffff002','owner', now()),
  ('d1d1d1d1-0000-0000-0000-000000000002','ffffffff-ffff-ffff-ffff-fffffffff003','member',now()),
  ('d1d1d1d1-0000-0000-0000-000000000003','ffffffff-ffff-ffff-ffff-fffffffff004','owner', now()),
  ('d1d1d1d1-0000-0000-0000-000000000003','ffffffff-ffff-ffff-ffff-fffffffff005','member',now()),
  ('d1d1d1d1-0000-0000-0000-000000000004','ffffffff-ffff-ffff-ffff-fffffffff006','owner', now()),
  ('d1d1d1d1-0000-0000-0000-000000000004','ffffffff-ffff-ffff-ffff-fffffffff007','owner', now()),
  -- G5 promotion order: F10 joined a year ago, F9 joined yesterday.
  -- The LONGEST-STANDING member is F10, so F10 must be the one promoted —
  -- deliberately not the lowest user id, so the test can tell the two apart.
  ('d1d1d1d1-0000-0000-0000-000000000005','ffffffff-ffff-ffff-ffff-fffffffff008','owner', now()),
  ('d1d1d1d1-0000-0000-0000-000000000005','ffffffff-ffff-ffff-ffff-fffffffff009','member',now() - interval '1 day'),
  ('d1d1d1d1-0000-0000-0000-000000000005','ffffffff-ffff-ffff-ffff-fffffffff010','member',now() - interval '365 days'),
  ('d1d1d1d1-0000-0000-0000-000000000006','ffffffff-ffff-ffff-ffff-fffffffff012','owner', now()),
  ('d1d1d1d1-0000-0000-0000-000000000007','ffffffff-ffff-ffff-ffff-fffffffff012','owner', now()),
  ('d1d1d1d1-0000-0000-0000-000000000007','ffffffff-ffff-ffff-ffff-fffffffff013','member',now());

-- Give G1 a full life: an item, a completion, a hidden task, a manual task and
-- some activity — so "the garden goes, and everything below it" can be proved
-- rather than assumed.
insert into public.blueprint(name, legacy_code) values ('DelTestPlant','DEL_TEST_PLANT');

insert into public.garden_item(garden_id,blueprint_id)
  select 'd1d1d1d1-0000-0000-0000-000000000001',
         id from public.blueprint where legacy_code='DEL_TEST_PLANT';

insert into public.task(legacy_code,name,garden_id,valid_months,frequency_days)
  values (null,'Del test manual task','d1d1d1d1-0000-0000-0000-000000000001','{1,2,3}',30);

insert into public.task_completion(garden_id,task_id)
  select 'd1d1d1d1-0000-0000-0000-000000000001',
         id from public.task where name='Del test manual task';

insert into public.hidden_task(garden_id,task_id)
  select 'd1d1d1d1-0000-0000-0000-000000000001',
         id from public.task where name='Del test manual task';

insert into public.garden_day(garden_id,day,opens) values
  ('d1d1d1d1-0000-0000-0000-000000000001', current_date,     3),
  ('d1d1d1d1-0000-0000-0000-000000000001', current_date - 1, 1);

-- And an entitlement, to prove ownership goes with the person.
insert into public.product(code,name,kind)
  values ('PACK_DEL_TEST','Deletion test pack','pack');
insert into public.entitlement(user_id,product_id,source)
  values ('ffffffff-ffff-ffff-ffff-fffffffff001',
          (select id from public.product where code='PACK_DEL_TEST'),'test');


-- ============================================================================
--  A. THE FUNCTION CANNOT BE AIMED AT ANYONE ELSE
-- ============================================================================
reset role;
select public.t_count('delete_my_account takes NO arguments, so it has no target to tamper with',
  'select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname=''public'' and p.proname=''delete_my_account'' and p.pronargs=0', 1);

set request.jwt.claims = '{}'; set role anon;
select public.t_blocked('a signed-out caller cannot run it',
  'select public.delete_my_account()');


-- ============================================================================
--  B. LAST ONE OUT — the garden and everything below it goes
-- ============================================================================
reset role; set request.jwt.claims = '{"sub":"ffffffff-ffff-ffff-ffff-fffffffff001"}'; set role authenticated;
select public.t_ok('sole owner deletes her account', 'select public.delete_my_account()');

reset role; set request.jwt.claims = '{}';
select public.t_count('the user row is gone',
  'select count(*) from auth.users where id=''ffffffff-ffff-ffff-ffff-fffffffff001''', 0);
select public.t_count('the garden is gone',
  'select count(*) from public.garden where id=''d1d1d1d1-0000-0000-0000-000000000001''', 0);
select public.t_count('its items are gone',
  'select count(*) from public.garden_item where garden_id=''d1d1d1d1-0000-0000-0000-000000000001''', 0);
select public.t_count('its completion history is gone',
  'select count(*) from public.task_completion where garden_id=''d1d1d1d1-0000-0000-0000-000000000001''', 0);
select public.t_count('its hidden tasks are gone',
  'select count(*) from public.hidden_task where garden_id=''d1d1d1d1-0000-0000-0000-000000000001''', 0);
select public.t_count('its manual task is gone',
  'select count(*) from public.task where garden_id=''d1d1d1d1-0000-0000-0000-000000000001''', 0);
select public.t_count('its activity record is gone (no orphan left behind)',
  'select count(*) from public.garden_day where garden_id=''d1d1d1d1-0000-0000-0000-000000000001''', 0);
select public.t_count('her entitlement is gone',
  'select count(*) from public.entitlement where user_id=''ffffffff-ffff-ffff-ffff-fffffffff001''', 0);
select public.t_count('her membership row is gone',
  'select count(*) from public.garden_member where user_id=''ffffffff-ffff-ffff-ffff-fffffffff001''', 0);

-- The whole point of a HARD delete: the email is free again.
select public.t_ok('the same email can register a brand-new account',
  'insert into auth.users
     (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change_token_new, email_change)
   values (''00000000-0000-0000-0000-000000000000'',
           ''ffffffff-ffff-ffff-ffff-ffffffffff99'',
           ''authenticated'',''authenticated'',''del-f1@test.local'','''',
           now(), now(), now(), ''{"provider":"email"}'',''{}'','''','''','''','''')');
select public.t_count('and it is a genuinely new person, not the old one restored',
  'select count(*) from public.garden_member where user_id=''ffffffff-ffff-ffff-ffff-ffffffffff99''', 0);


-- ============================================================================
--  C. HAND IT OVER — sole owner leaves, a member remains
-- ============================================================================
set request.jwt.claims = '{"sub":"ffffffff-ffff-ffff-ffff-fffffffff002"}'; set role authenticated;
select public.t_ok('the sole owner deletes his account', 'select public.delete_my_account()');

reset role; set request.jwt.claims = '{}';
select public.t_count('the garden SURVIVES',
  'select count(*) from public.garden where id=''d1d1d1d1-0000-0000-0000-000000000002''', 1);
select public.t_count('the remaining member is now the owner',
  'select count(*) from public.garden_member
    where garden_id=''d1d1d1d1-0000-0000-0000-000000000002''
      and user_id=''ffffffff-ffff-ffff-ffff-fffffffff003'' and role=''owner''', 1);
select public.t_count('and is the only member left',
  'select count(*) from public.garden_member where garden_id=''d1d1d1d1-0000-0000-0000-000000000002''', 1);


-- ============================================================================
--  D. A NON-OWNER LEAVES — nothing about the garden changes
-- ============================================================================
set request.jwt.claims = '{"sub":"ffffffff-ffff-ffff-ffff-fffffffff005"}'; set role authenticated;
select public.t_ok('a member deletes his account', 'select public.delete_my_account()');

reset role; set request.jwt.claims = '{}';
select public.t_count('the garden survives',
  'select count(*) from public.garden where id=''d1d1d1d1-0000-0000-0000-000000000003''', 1);
select public.t_count('the owner is untouched and still the owner',
  'select count(*) from public.garden_member
    where garden_id=''d1d1d1d1-0000-0000-0000-000000000003''
      and user_id=''ffffffff-ffff-ffff-ffff-fffffffff004'' and role=''owner''', 1);
select public.t_count('only his membership row went',
  'select count(*) from public.garden_member where garden_id=''d1d1d1d1-0000-0000-0000-000000000003''', 1);


-- ============================================================================
--  E. ONE OF TWO OWNERS LEAVES — nobody is promoted
-- ============================================================================
set request.jwt.claims = '{"sub":"ffffffff-ffff-ffff-ffff-fffffffff007"}'; set role authenticated;
select public.t_ok('a co-owner deletes his account', 'select public.delete_my_account()');

reset role; set request.jwt.claims = '{}';
select public.t_count('the other owner is still simply the owner',
  'select count(*) from public.garden_member
    where garden_id=''d1d1d1d1-0000-0000-0000-000000000004''
      and user_id=''ffffffff-ffff-ffff-ffff-fffffffff006'' and role=''owner''', 1);
select public.t_count('and no phantom extra member appeared',
  'select count(*) from public.garden_member where garden_id=''d1d1d1d1-0000-0000-0000-000000000004''', 1);


-- ============================================================================
--  F. THE LONGEST-STANDING MEMBER IS THE ONE PROMOTED
--     F10 joined a year ago; F9 joined yesterday. F10 must get it — and note
--     F10 is NOT the lowest user id, so a wrong tie-break would show up here.
-- ============================================================================
set request.jwt.claims = '{"sub":"ffffffff-ffff-ffff-ffff-fffffffff008"}'; set role authenticated;
select public.t_ok('the owner of a three-person garden leaves', 'select public.delete_my_account()');

reset role; set request.jwt.claims = '{}';
select public.t_count('the LONGEST-STANDING member became owner',
  'select count(*) from public.garden_member
    where garden_id=''d1d1d1d1-0000-0000-0000-000000000005''
      and user_id=''ffffffff-ffff-ffff-ffff-fffffffff010'' and role=''owner''', 1);
select public.t_count('the newer member stayed a member',
  'select count(*) from public.garden_member
    where garden_id=''d1d1d1d1-0000-0000-0000-000000000005''
      and user_id=''ffffffff-ffff-ffff-ffff-fffffffff009'' and role=''member''', 1);
select public.t_count('exactly one owner exists afterwards',
  'select count(*) from public.garden_member
    where garden_id=''d1d1d1d1-0000-0000-0000-000000000005'' and role=''owner''', 1);


-- ============================================================================
--  G. NO GARDEN AT ALL — signed up, never onboarded
-- ============================================================================
set request.jwt.claims = '{"sub":"ffffffff-ffff-ffff-ffff-fffffffff011"}'; set role authenticated;
select public.t_ok('a user with no garden deletes cleanly', 'select public.delete_my_account()');

reset role; set request.jwt.claims = '{}';
select public.t_count('and is gone',
  'select count(*) from auth.users where id=''ffffffff-ffff-ffff-ffff-fffffffff011''', 0);


-- ============================================================================
--  H. TWO GARDENS, TWO DIFFERENT OUTCOMES, ONE DELETION
--     The mother-in-law case: F12 keeps her own garden alone (G6) and also
--     owns a garden she shares with F13 (G7). One must go; one must be handed on.
-- ============================================================================
set request.jwt.claims = '{"sub":"ffffffff-ffff-ffff-ffff-fffffffff012"}'; set role authenticated;
select public.t_ok('a user with two gardens deletes her account',
  'select public.delete_my_account()');

reset role; set request.jwt.claims = '{}';
select public.t_count('the garden she tended alone is gone',
  'select count(*) from public.garden where id=''d1d1d1d1-0000-0000-0000-000000000006''', 0);
select public.t_count('the shared garden survives',
  'select count(*) from public.garden where id=''d1d1d1d1-0000-0000-0000-000000000007''', 1);
select public.t_count('and its remaining member now owns it',
  'select count(*) from public.garden_member
    where garden_id=''d1d1d1d1-0000-0000-0000-000000000007''
      and user_id=''ffffffff-ffff-ffff-ffff-fffffffff013'' and role=''owner''', 1);


-- ============================================================================
--  I. NO GARDEN IS LEFT WITH NOBODY IN IT
--     The single check that matters most: after all of the above, every garden
--     in the database still has at least one member. An unreachable garden is
--     data we failed to erase.
-- ============================================================================
select public.t_count('no orphaned gardens anywhere in the database',
  'select count(*) from public.garden g
    where not exists (select 1 from public.garden_member gm where gm.garden_id = g.id)', 0);


-- ============================ VISIBLE RESULTS ===============================
reset role; set request.jwt.claims = '{}';

select outcome as "Result", label as "Check" from (
  select 0 as ord,
    case when (select count(*) from _t_results where outcome='FAIL')=0
      then '=== ALL ' || (select count(*) from _t_results)::text || ' CHECKS PASSED ==='
      else '=== ' || (select count(*) from _t_results where outcome='FAIL')::text
           || ' OF ' || (select count(*) from _t_results)::text || ' CHECKS FAILED ===' end as outcome,
    '' as label
  union all
  select seq as ord, outcome, label from _t_results
) x order by ord;

rollback;
