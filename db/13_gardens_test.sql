-- ============================================================================
--  Multiple-gardens test suite for 13_gardens.sql
--
--  WHAT THIS PROVES:
--    * a user may hold more than one garden, up to the ceiling, and no further
--    * leaving as the last member takes the garden and everything below it
--    * a departing sole owner hands the garden over, intact, to the
--      longest-standing member
--    * a departing non-owner changes nothing; a departing co-owner promotes
--      nobody
--    * deleting a garden you own alone erases it and everything in it
--    * deleting a SHARED garden is REFUSED, and refused without side effects
--    * only an owner can delete, and neither function can be aimed at a garden
--      you are not in
--    * deleting your LAST garden is allowed and leaves you with none
--    * the two impossible states are now impossible: an owner cannot remove
--      themselves through the policy, and an owner cannot be removed at all
--    * an owner CAN still remove an ordinary member (no regression on 02)
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

-- A blocked DELETE under RLS is not an error: the row is simply invisible, so
-- the statement succeeds having changed nothing. That silence is the thing
-- being tested, so it needs an assertion of its own.
create or replace function public.t_noop(label text, stmt text)
returns void language plpgsql security invoker as $$
declare n integer;
begin
  begin
    execute stmt;
    get diagnostics n = row_count;
    if n = 0 then perform public._record('pass', label);
    else perform public._record('FAIL', label||' — changed '||n||' row(s), expected none'); end if;
  exception when others then
    perform public._record('pass', label||' (refused outright: '||sqlerrm||')');
  end;
end $$;

-- Returns the text outcome of leave_garden so the THREE cases can be told apart
-- rather than merely observed to have "worked".
create or replace function public.t_says(label text, q text, expected text)
returns void language plpgsql security invoker as $$
declare s text;
begin
  begin execute q into s;
    if s = expected then perform public._record('pass', label||' (said '''||s||''')');
    else perform public._record('FAIL', label||' — expected '''||expected||''', said '''||coalesce(s,'<null>')||''''); end if;
  exception when others then
    perform public._record('FAIL', label||' — expected '''||expected||''' but errored: '||sqlerrm);
  end;
end $$;

grant execute on function
  public.t_count(text,text,bigint), public.t_ok(text,text),
  public.t_blocked(text,text), public.t_noop(text,text),
  public.t_says(text,text,text), public._record(text,text)
to anon, authenticated;


-- ============================================================================
--  FIXTURES
--
--  GA  U1 alone                              — U1 LEAVES (garden must go)
--  GB  U2 owner, U3 member                   — U2 LEAVES (hand over to U3)
--  GC  U4 owner, U5 member                   — U5 LEAVES (nothing changes)
--  GD  U6 owner, U7 ALSO owner               — U7 LEAVES (promote nobody)
--  GE  U8 owner, U9 recent, U10 long-standing— U8 LEAVES (U10 gets it)
--  GF  U11 alone                             — U11 DELETES it
--  GG  U12 owner, U13 member                 — U12 tries to DELETE (refused)
--  GH  U16 owner, U17 member                 — U16 REMOVES U17 (still allowed)
--
--  U14 no gardens — the ceiling test
--  U15 no gardens — the "a second garden is the whole point" test
--  U18 no gardens — a stranger, for the aiming-at-someone-else tests
-- ============================================================================
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
   confirmation_token, recovery_token, email_change_token_new, email_change)
select
  '00000000-0000-0000-0000-000000000000',
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeee' || lpad(n::text, 3, '0'))::uuid,
  'authenticated','authenticated','gdn-u' || n || '@test.local','',
  now(), now(), now(), '{"provider":"email"}','{}','','','',''
from generate_series(1,18) n;

insert into public.garden(id,name,latitude,longitude) values
  ('e1e1e1e1-0000-0000-0000-000000000001','GdnA',51.66,-0.60),
  ('e1e1e1e1-0000-0000-0000-000000000002','GdnB',51.66,-0.60),
  ('e1e1e1e1-0000-0000-0000-000000000003','GdnC',51.66,-0.60),
  ('e1e1e1e1-0000-0000-0000-000000000004','GdnD',51.66,-0.60),
  ('e1e1e1e1-0000-0000-0000-000000000005','GdnE',51.66,-0.60),
  ('e1e1e1e1-0000-0000-0000-000000000006','GdnF',51.66,-0.60),
  ('e1e1e1e1-0000-0000-0000-000000000007','GdnG',51.66,-0.60),
  ('e1e1e1e1-0000-0000-0000-000000000008','GdnH',51.66,-0.60);

insert into public.garden_member(garden_id,user_id,role,added_at) values
  ('e1e1e1e1-0000-0000-0000-000000000001','eeeeeeee-eeee-eeee-eeee-eeeeeeeee001','owner', now()),
  ('e1e1e1e1-0000-0000-0000-000000000002','eeeeeeee-eeee-eeee-eeee-eeeeeeeee002','owner', now()),
  ('e1e1e1e1-0000-0000-0000-000000000002','eeeeeeee-eeee-eeee-eeee-eeeeeeeee003','member',now()),
  ('e1e1e1e1-0000-0000-0000-000000000003','eeeeeeee-eeee-eeee-eeee-eeeeeeeee004','owner', now()),
  ('e1e1e1e1-0000-0000-0000-000000000003','eeeeeeee-eeee-eeee-eeee-eeeeeeeee005','member',now()),
  ('e1e1e1e1-0000-0000-0000-000000000004','eeeeeeee-eeee-eeee-eeee-eeeeeeeee006','owner', now()),
  ('e1e1e1e1-0000-0000-0000-000000000004','eeeeeeee-eeee-eeee-eeee-eeeeeeeee007','owner', now()),
  -- GE promotion order: U10 joined a year ago, U9 joined yesterday. The
  -- LONGEST-STANDING member is U10, so U10 must get it — deliberately NOT the
  -- lowest user id, so a wrong tie-break would show up here.
  ('e1e1e1e1-0000-0000-0000-000000000005','eeeeeeee-eeee-eeee-eeee-eeeeeeeee008','owner', now()),
  ('e1e1e1e1-0000-0000-0000-000000000005','eeeeeeee-eeee-eeee-eeee-eeeeeeeee009','member',now() - interval '1 day'),
  ('e1e1e1e1-0000-0000-0000-000000000005','eeeeeeee-eeee-eeee-eeee-eeeeeeeee010','member',now() - interval '365 days'),
  ('e1e1e1e1-0000-0000-0000-000000000006','eeeeeeee-eeee-eeee-eeee-eeeeeeeee011','owner', now()),
  ('e1e1e1e1-0000-0000-0000-000000000007','eeeeeeee-eeee-eeee-eeee-eeeeeeeee012','owner', now()),
  ('e1e1e1e1-0000-0000-0000-000000000007','eeeeeeee-eeee-eeee-eeee-eeeeeeeee013','member',now()),
  ('e1e1e1e1-0000-0000-0000-000000000008','eeeeeeee-eeee-eeee-eeee-eeeeeeeee016','owner', now()),
  ('e1e1e1e1-0000-0000-0000-000000000008','eeeeeeee-eeee-eeee-eeee-eeeeeeeee017','member',now());

-- Give GA and GF a full life, so "everything below it goes" can be proved
-- rather than assumed — once down the leave path, once down the delete path.
insert into public.blueprint(name, legacy_code) values ('GdnTestPlant','GDN_TEST_PLANT');

insert into public.garden_item(garden_id,blueprint_id)
  select g, id from public.blueprint, unnest(array[
    'e1e1e1e1-0000-0000-0000-000000000001'::uuid,
    'e1e1e1e1-0000-0000-0000-000000000006'::uuid]) g
  where legacy_code='GDN_TEST_PLANT';

insert into public.task(legacy_code,name,garden_id,valid_months,frequency_days) values
  (null,'Gdn test manual task A','e1e1e1e1-0000-0000-0000-000000000001','{1,2,3}',30),
  (null,'Gdn test manual task F','e1e1e1e1-0000-0000-0000-000000000006','{1,2,3}',30);

insert into public.task_completion(garden_id,task_id)
  select t.garden_id, t.id from public.task t
  where t.name in ('Gdn test manual task A','Gdn test manual task F');

insert into public.hidden_task(garden_id,task_id)
  select t.garden_id, t.id from public.task t
  where t.name in ('Gdn test manual task A','Gdn test manual task F');

insert into public.garden_day(garden_id,day,opens) values
  ('e1e1e1e1-0000-0000-0000-000000000001', current_date, 3),
  ('e1e1e1e1-0000-0000-0000-000000000006', current_date, 2);


-- ============================================================================
--  A. NEITHER FUNCTION CAN BE AIMED AT ANOTHER PERSON
--     leave_garden takes a GARDEN, never a user: there is no argument that
--     names who is being removed, so there is nothing to tamper with.
-- ============================================================================
reset role;
select public.t_count('leave_garden takes exactly one argument, and it is not a person',
  'select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname=''public'' and p.proname=''leave_garden'' and p.pronargs=1', 1);
select public.t_count('delete_garden likewise',
  'select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname=''public'' and p.proname=''delete_garden'' and p.pronargs=1', 1);

set request.jwt.claims = '{}'; set role anon;
select public.t_blocked('a signed-out caller cannot leave a garden',
  'select public.leave_garden(''e1e1e1e1-0000-0000-0000-000000000001'')');
select public.t_blocked('a signed-out caller cannot delete a garden',
  'select public.delete_garden(''e1e1e1e1-0000-0000-0000-000000000001'')');

reset role; set request.jwt.claims = '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeee018"}'; set role authenticated;
select public.t_blocked('a stranger cannot leave a garden he is not in',
  'select public.leave_garden(''e1e1e1e1-0000-0000-0000-000000000002'')');
select public.t_blocked('a stranger cannot delete a garden he is not in',
  'select public.delete_garden(''e1e1e1e1-0000-0000-0000-000000000002'')');

reset role; set request.jwt.claims = '{}';
select public.t_count('and that garden is entirely untouched',
  'select count(*) from public.garden where id=''e1e1e1e1-0000-0000-0000-000000000002''', 1);


-- ============================================================================
--  B. MORE THAN ONE GARDEN — the feature itself
-- ============================================================================
reset role; set request.jwt.claims = '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeee015"}'; set role authenticated;
select public.t_ok('a user creates a first garden',
  'select public.create_garden(''U15 Home'', 51.66, -0.60)');
select public.t_ok('and a SECOND one, which is the whole point',
  'select public.create_garden(''U15 Mums garden'', 52.20, -1.10)');

reset role; set request.jwt.claims = '{}';
select public.t_count('she now belongs to two gardens',
  'select count(*) from public.garden_member where user_id=''eeeeeeee-eeee-eeee-eeee-eeeeeeeee015''', 2);
select public.t_count('and owns both of them',
  'select count(*) from public.garden_member
    where user_id=''eeeeeeee-eeee-eeee-eeee-eeeeeeeee015'' and role=''owner''', 2);


-- ============================================================================
--  C. THE CEILING — high enough to be invisible, low enough to bound the cost
-- ============================================================================
reset role; set request.jwt.claims = '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeee014"}'; set role authenticated;
select public.t_ok('ten gardens are fine',
  'do $x$ begin
     for i in 1..10 loop
       perform public.create_garden(''Ceiling ''||i, 51.66, -0.60);
     end loop;
   end $x$');
select public.t_blocked('an eleventh is refused',
  'select public.create_garden(''Ceiling 11'', 51.66, -0.60)');

reset role; set request.jwt.claims = '{}';
select public.t_count('so he holds exactly ten',
  'select count(*) from public.garden_member where user_id=''eeeeeeee-eeee-eeee-eeee-eeeeeeeee014''', 10);


-- ============================================================================
--  D. LAST ONE OUT — leaving takes the garden and everything below it
-- ============================================================================
reset role; set request.jwt.claims = '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeee001"}'; set role authenticated;
select public.t_says('the only member leaves GdnA',
  'select public.leave_garden(''e1e1e1e1-0000-0000-0000-000000000001'')', 'garden_deleted');

reset role; set request.jwt.claims = '{}';
select public.t_count('the garden is gone',
  'select count(*) from public.garden where id=''e1e1e1e1-0000-0000-0000-000000000001''', 0);
select public.t_count('its items are gone',
  'select count(*) from public.garden_item where garden_id=''e1e1e1e1-0000-0000-0000-000000000001''', 0);
select public.t_count('its completion history is gone',
  'select count(*) from public.task_completion where garden_id=''e1e1e1e1-0000-0000-0000-000000000001''', 0);
select public.t_count('its hidden tasks are gone',
  'select count(*) from public.hidden_task where garden_id=''e1e1e1e1-0000-0000-0000-000000000001''', 0);
select public.t_count('its manual task is gone',
  'select count(*) from public.task where garden_id=''e1e1e1e1-0000-0000-0000-000000000001''', 0);
select public.t_count('its activity record is gone (no orphan left behind)',
  'select count(*) from public.garden_day where garden_id=''e1e1e1e1-0000-0000-0000-000000000001''', 0);
select public.t_count('and the person still exists — they left a garden, not the app',
  'select count(*) from auth.users where id=''eeeeeeee-eeee-eeee-eeee-eeeeeeeee001''', 1);


-- ============================================================================
--  E. HAND IT OVER — the sole owner leaves, a member remains
-- ============================================================================
reset role; set request.jwt.claims = '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeee002"}'; set role authenticated;
select public.t_says('the sole owner leaves GdnB',
  'select public.leave_garden(''e1e1e1e1-0000-0000-0000-000000000002'')', 'handed_over');

reset role; set request.jwt.claims = '{}';
select public.t_count('the garden SURVIVES',
  'select count(*) from public.garden where id=''e1e1e1e1-0000-0000-0000-000000000002''', 1);
select public.t_count('the remaining member is now the owner',
  'select count(*) from public.garden_member
    where garden_id=''e1e1e1e1-0000-0000-0000-000000000002''
      and user_id=''eeeeeeee-eeee-eeee-eeee-eeeeeeeee003'' and role=''owner''', 1);
select public.t_count('and is the only member left',
  'select count(*) from public.garden_member where garden_id=''e1e1e1e1-0000-0000-0000-000000000002''', 1);


-- ============================================================================
--  F. A NON-OWNER LEAVES — nothing about the garden changes
-- ============================================================================
reset role; set request.jwt.claims = '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeee005"}'; set role authenticated;
select public.t_says('a member leaves GdnC',
  'select public.leave_garden(''e1e1e1e1-0000-0000-0000-000000000003'')', 'left');

reset role; set request.jwt.claims = '{}';
select public.t_count('the garden survives',
  'select count(*) from public.garden where id=''e1e1e1e1-0000-0000-0000-000000000003''', 1);
select public.t_count('the owner is untouched and still the owner',
  'select count(*) from public.garden_member
    where garden_id=''e1e1e1e1-0000-0000-0000-000000000003''
      and user_id=''eeeeeeee-eeee-eeee-eeee-eeeeeeeee004'' and role=''owner''', 1);
select public.t_count('only his membership row went',
  'select count(*) from public.garden_member where garden_id=''e1e1e1e1-0000-0000-0000-000000000003''', 1);


-- ============================================================================
--  G. ONE OF TWO OWNERS LEAVES — nobody is promoted
-- ============================================================================
reset role; set request.jwt.claims = '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeee007"}'; set role authenticated;
select public.t_says('a co-owner leaves GdnD',
  'select public.leave_garden(''e1e1e1e1-0000-0000-0000-000000000004'')', 'left');

reset role; set request.jwt.claims = '{}';
select public.t_count('the other owner is still simply the owner',
  'select count(*) from public.garden_member
    where garden_id=''e1e1e1e1-0000-0000-0000-000000000004''
      and user_id=''eeeeeeee-eeee-eeee-eeee-eeeeeeeee006'' and role=''owner''', 1);
select public.t_count('and no phantom extra member appeared',
  'select count(*) from public.garden_member where garden_id=''e1e1e1e1-0000-0000-0000-000000000004''', 1);


-- ============================================================================
--  H. THE LONGEST-STANDING MEMBER IS THE ONE PROMOTED
--     U10 joined a year ago; U9 joined yesterday. U10 must get it — and U10 is
--     NOT the lowest remaining user id, so a wrong tie-break shows up here.
--     Identical rule to delete_my_account (file 12), tested identically.
-- ============================================================================
reset role; set request.jwt.claims = '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeee008"}'; set role authenticated;
select public.t_says('the owner of a three-person garden leaves',
  'select public.leave_garden(''e1e1e1e1-0000-0000-0000-000000000005'')', 'handed_over');

reset role; set request.jwt.claims = '{}';
select public.t_count('the LONGEST-STANDING member became owner',
  'select count(*) from public.garden_member
    where garden_id=''e1e1e1e1-0000-0000-0000-000000000005''
      and user_id=''eeeeeeee-eeee-eeee-eeee-eeeeeeeee010'' and role=''owner''', 1);
select public.t_count('the newer member stayed a member',
  'select count(*) from public.garden_member
    where garden_id=''e1e1e1e1-0000-0000-0000-000000000005''
      and user_id=''eeeeeeee-eeee-eeee-eeee-eeeeeeeee009'' and role=''member''', 1);
select public.t_count('exactly one owner exists afterwards',
  'select count(*) from public.garden_member
    where garden_id=''e1e1e1e1-0000-0000-0000-000000000005'' and role=''owner''', 1);


-- ============================================================================
--  I. DELETING A GARDEN YOU OWN ALONE
-- ============================================================================
reset role; set request.jwt.claims = '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeee011"}'; set role authenticated;
select public.t_ok('the sole owner deletes GdnF',
  'select public.delete_garden(''e1e1e1e1-0000-0000-0000-000000000006'')');

reset role; set request.jwt.claims = '{}';
select public.t_count('the garden is gone',
  'select count(*) from public.garden where id=''e1e1e1e1-0000-0000-0000-000000000006''', 0);
select public.t_count('its items are gone',
  'select count(*) from public.garden_item where garden_id=''e1e1e1e1-0000-0000-0000-000000000006''', 0);
select public.t_count('its history is gone',
  'select count(*) from public.task_completion where garden_id=''e1e1e1e1-0000-0000-0000-000000000006''', 0);
select public.t_count('its activity record is gone',
  'select count(*) from public.garden_day where garden_id=''e1e1e1e1-0000-0000-0000-000000000006''', 0);
select public.t_count('its membership row went with it',
  'select count(*) from public.garden_member where garden_id=''e1e1e1e1-0000-0000-0000-000000000006''', 0);
select public.t_count('and its owner now has NO gardens, which is a real state',
  'select count(*) from public.garden_member where user_id=''eeeeeeee-eeee-eeee-eeee-eeeeeeeee011''', 0);
select public.t_count('the person still exists and can set one up again',
  'select count(*) from auth.users where id=''eeeeeeee-eeee-eeee-eeee-eeeeeeeee011''', 1);


-- ============================================================================
--  J. DELETING A SHARED GARDEN IS REFUSED
--     The rule that stops one tap erasing somebody else's years of history.
-- ============================================================================
reset role; set request.jwt.claims = '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeee012"}'; set role authenticated;
select public.t_blocked('the owner of a SHARED garden cannot delete it',
  'select public.delete_garden(''e1e1e1e1-0000-0000-0000-000000000007'')');

reset role; set request.jwt.claims = '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeee013"}'; set role authenticated;
select public.t_blocked('and a mere member certainly cannot',
  'select public.delete_garden(''e1e1e1e1-0000-0000-0000-000000000007'')');

reset role; set request.jwt.claims = '{}';
select public.t_count('the garden is untouched',
  'select count(*) from public.garden where id=''e1e1e1e1-0000-0000-0000-000000000007''', 1);
select public.t_count('and so is its membership — a refusal has no side effects',
  'select count(*) from public.garden_member where garden_id=''e1e1e1e1-0000-0000-0000-000000000007''', 2);

-- The sanctioned route: remove the other member, then delete. Same end state,
-- reached deliberately.
reset role; set request.jwt.claims = '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeee012"}'; set role authenticated;
select public.t_ok('the owner removes the other member first',
  'delete from public.garden_member
    where garden_id=''e1e1e1e1-0000-0000-0000-000000000007''
      and user_id=''eeeeeeee-eeee-eeee-eeee-eeeeeeeee013''');
select public.t_count('who really is gone, not merely reported gone',
  'select count(*) from public.garden_member
    where garden_id=''e1e1e1e1-0000-0000-0000-000000000007''', 1);
select public.t_ok('and NOW the delete is allowed',
  'select public.delete_garden(''e1e1e1e1-0000-0000-0000-000000000007'')');

reset role; set request.jwt.claims = '{}';
select public.t_count('the garden is gone',
  'select count(*) from public.garden where id=''e1e1e1e1-0000-0000-0000-000000000007''', 0);


-- ============================================================================
--  K. THE TWO STATES THAT MUST BE IMPOSSIBLE
--
--     Both were reachable through the Data API before file 13, whatever the UI
--     offered. The published anon key means "the UI never does this" is not a
--     control.
-- ============================================================================
reset role; set request.jwt.claims = '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeee016"}'; set role authenticated;

select public.t_noop('an owner cannot delete her OWN membership row (that is leave_garden''s job)',
  'delete from public.garden_member
    where garden_id=''e1e1e1e1-0000-0000-0000-000000000008''
      and user_id=''eeeeeeee-eeee-eeee-eeee-eeeeeeeee016''');

-- No regression on 02_rls_test.sql: removing an ordinary member still works.
select public.t_ok('but she CAN still remove an ordinary member',
  'delete from public.garden_member
    where garden_id=''e1e1e1e1-0000-0000-0000-000000000008''
      and user_id=''eeeeeeee-eeee-eeee-eeee-eeeeeeeee017''');

reset role; set request.jwt.claims = '{}';
select public.t_count('so she is the only one left in it',
  'select count(*) from public.garden_member
    where garden_id=''e1e1e1e1-0000-0000-0000-000000000008''', 1);
select public.t_count('and still its owner',
  'select count(*) from public.garden_member
    where garden_id=''e1e1e1e1-0000-0000-0000-000000000008''
      and user_id=''eeeeeeee-eeee-eeee-eeee-eeeeeeeee016'' and role=''owner''', 1);

-- The same guard from the other side. GdnD has exactly one owner (U6) after
-- section G, and he must not be able to walk out through the policy either.
reset role; set request.jwt.claims = '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeee006"}'; set role authenticated;
select public.t_noop('the last owner cannot remove himself and strand the garden',
  'delete from public.garden_member
    where garden_id=''e1e1e1e1-0000-0000-0000-000000000004''
      and user_id=''eeeeeeee-eeee-eeee-eeee-eeeeeeeee006''');

-- GdnE after section H: U10 is the owner, U9 an ordinary member. A member has
-- no delete rights over anybody, including herself.
reset role; set request.jwt.claims = '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeee009"}'; set role authenticated;
select public.t_noop('a member cannot remove the OWNER of the garden she is in',
  'delete from public.garden_member
    where garden_id=''e1e1e1e1-0000-0000-0000-000000000005''
      and user_id=''eeeeeeee-eeee-eeee-eeee-eeeeeeeee010''');
select public.t_noop('nor can she remove her own row (leaving is leave_garden''s job)',
  'delete from public.garden_member
    where garden_id=''e1e1e1e1-0000-0000-0000-000000000005''
      and user_id=''eeeeeeee-eeee-eeee-eeee-eeeeeeeee009''');

-- ...and the sanctioned route still works for her.
select public.t_says('but she CAN leave properly',
  'select public.leave_garden(''e1e1e1e1-0000-0000-0000-000000000005'')', 'left');

reset role; set request.jwt.claims = '{}';
select public.t_count('leaving the owner alone in her garden',
  'select count(*) from public.garden_member
    where garden_id=''e1e1e1e1-0000-0000-0000-000000000005''', 1);


-- ============================================================================
--  L. THE TWO INVARIANTS, checked against everything the suite just did
--
--     No garden may be left with nobody in it (unreachable data we failed to
--     erase), and no garden may be left with nobody able to manage it (a state
--     with no exit, because nothing promotes anybody outside these functions).
-- ============================================================================
reset role; set request.jwt.claims = '{}';
select public.t_count('no orphaned gardens anywhere in the database',
  'select count(*) from public.garden g
    where not exists (select 1 from public.garden_member gm where gm.garden_id = g.id)', 0);
select public.t_count('no owner-less gardens anywhere in the database',
  'select count(*) from public.garden g
    where not exists (select 1 from public.garden_member gm
                      where gm.garden_id = g.id and gm.role = ''owner'')', 0);


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
