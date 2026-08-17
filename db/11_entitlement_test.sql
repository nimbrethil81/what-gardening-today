-- ============================================================================
--  Entitlement + inventory guard test suite for 11_entitlement.sql
--
--  WHAT THIS PROVES:
--    * dormant means dormant — with no packs, nothing changes
--    * a pack item is refused to a non-owner and allowed to an owner
--    * an EXPIRED entitlement stops granting, a perpetual one never does
--    * retiring a pack RELEASES its items rather than stranding them
--    * "grants the right to add, not the right to see" — a non-entitled
--      co-member keeps full sight of a pack item already in the garden
--    * nobody can grant themselves an entitlement or read anyone else's
--    * the 200-item ceiling binds, and removed items don't count towards it
--
--  HOW TO RUN: paste into the Supabase SQL Editor and Run. It creates throwaway
--  data, checks everything, and ROLLS BACK — no permanent change, run as often
--  as you like. Read the results grid: every row should say "pass" and the
--  summary should read ALL CHECKS PASSED.
--
--  REVISION (2026-08-17): the signed-out check in §F previously asked whether an
--  anonymous visitor SEES zero entitlement rows. It doesn't — it is refused the
--  table outright, because anon holds no SELECT grant and privileges are checked
--  before any row policy. That is a stronger refusal than an empty result, so
--  the check now expects a refusal. A test defect, not a schema defect: no
--  change was made to 11_entitlement.sql.
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

create or replace function public.t_true(label text, q text)
returns void language plpgsql security invoker as $$
declare b boolean;
begin
  begin execute q into b;
    if b then perform public._record('pass', label);
    else perform public._record('FAIL', label||' — expected true, got false'); end if;
  exception when others then
    perform public._record('FAIL', label||' — errored: '||sqlerrm);
  end;
end $$;

create or replace function public.t_false(label text, q text)
returns void language plpgsql security invoker as $$
declare b boolean;
begin
  begin execute q into b;
    if not b then perform public._record('pass', label);
    else perform public._record('FAIL', label||' — expected false, got true'); end if;
  exception when others then
    perform public._record('FAIL', label||' — errored: '||sqlerrm);
  end;
end $$;

grant execute on function
  public.t_count(text,text,bigint), public.t_ok(text,text),
  public.t_blocked(text,text), public.t_true(text,text),
  public.t_false(text,text), public._record(text,text)
to anon, authenticated;


-- ============================================================================
--  FIXTURES
--    ALICE  — owns the pack
--    BOB    — owns nothing, but co-tends Alice's garden
--    CAROL  — owns nothing, no shared garden (for the privacy checks)
-- ============================================================================
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
   confirmation_token, recovery_token, email_change_token_new, email_change)
values
  ('00000000-0000-0000-0000-000000000000','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1',
   'authenticated','authenticated','ent-alice@test.local','', now(), now(), now(),
   '{"provider":"email"}','{}','','','',''),
  ('00000000-0000-0000-0000-000000000000','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2',
   'authenticated','authenticated','ent-bob@test.local','', now(), now(), now(),
   '{"provider":"email"}','{}','','','',''),
  ('00000000-0000-0000-0000-000000000000','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee3',
   'authenticated','authenticated','ent-carol@test.local','', now(), now(), now(),
   '{"provider":"email"}','{}','','','','');

-- Two blueprints: one destined for a pack, one left core.
insert into public.blueprint(name, legacy_code) values
  ('EntTestPacked','ENT_TEST_PACKED'),
  ('EntTestCore',  'ENT_TEST_CORE');

-- Two gardens. The shared one exercises the add-vs-see principle; the second
-- is a clean slate for the ceiling test.
insert into public.garden(id,name,latitude,longitude) values
  ('e0e0e0e0-0000-0000-0000-000000000001','EntShared', 51.66,-0.60),
  ('e0e0e0e0-0000-0000-0000-000000000002','EntCapTest',51.66,-0.60);

insert into public.garden_member(garden_id,user_id,role) values
  ('e0e0e0e0-0000-0000-0000-000000000001','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1','owner'),
  ('e0e0e0e0-0000-0000-0000-000000000001','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2','member'),
  ('e0e0e0e0-0000-0000-0000-000000000002','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1','owner');


-- ============================================================================
--  A. DORMANT MEANS DORMANT
--     No products exist yet, so every blueprint is core and nothing is refused.
-- ============================================================================
reset role; set request.jwt.claims = '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2"}'; set role authenticated;

select public.t_true('with no packs, a blueprint is addable',
  'select public.can_add_blueprint((select id from public.blueprint where legacy_code=''ENT_TEST_PACKED''))');
select public.t_ok('with no packs, Bob can add the (future) pack item',
  'insert into public.garden_item(garden_id,blueprint_id)
     select ''e0e0e0e0-0000-0000-0000-000000000001'',
            id from public.blueprint where legacy_code=''ENT_TEST_PACKED''');

-- Clear that row so the later checks start clean.
reset role;
delete from public.garden_item
 where garden_id='e0e0e0e0-0000-0000-0000-000000000001';


-- ============================================================================
--  B. A PACK NOW EXISTS
-- ============================================================================
insert into public.product(code,name,kind)
  values ('PACK_ENT_TEST','Entitlement test pack','pack');
insert into public.pack_member(product_id,blueprint_id)
  select (select id from public.product  where code='PACK_ENT_TEST'),
         (select id from public.blueprint where legacy_code='ENT_TEST_PACKED');

-- A feature product must not be able to hold blueprints.
insert into public.product(code,name,kind)
  values ('FEATURE_ENT_TEST','Entitlement test feature','feature');

select public.t_blocked('a FEATURE product cannot contain blueprints',
  'insert into public.pack_member(product_id,blueprint_id)
     select (select id from public.product  where code=''FEATURE_ENT_TEST''),
            (select id from public.blueprint where legacy_code=''ENT_TEST_CORE'')');

-- ---- Bob owns nothing -------------------------------------------------------
reset role; set request.jwt.claims = '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2"}'; set role authenticated;

select public.t_false('un-entitled user cannot add a pack item',
  'select public.can_add_blueprint((select id from public.blueprint where legacy_code=''ENT_TEST_PACKED''))');
select public.t_blocked('the insert is actually refused, not just advised against',
  'insert into public.garden_item(garden_id,blueprint_id)
     select ''e0e0e0e0-0000-0000-0000-000000000001'',
            id from public.blueprint where legacy_code=''ENT_TEST_PACKED''');
select public.t_true('a CORE item is still addable by anyone',
  'select public.can_add_blueprint((select id from public.blueprint where legacy_code=''ENT_TEST_CORE''))');
select public.t_ok('and the core insert succeeds',
  'insert into public.garden_item(garden_id,blueprint_id)
     select ''e0e0e0e0-0000-0000-0000-000000000001'',
            id from public.blueprint where legacy_code=''ENT_TEST_CORE''');

-- ---- Alice buys the pack (perpetual) ---------------------------------------
reset role;
insert into public.entitlement(user_id,product_id,source)
  values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1',
          (select id from public.product where code='PACK_ENT_TEST'),'purchase');

set request.jwt.claims = '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1"}'; set role authenticated;

select public.t_true('entitled user can add the pack item',
  'select public.can_add_blueprint((select id from public.blueprint where legacy_code=''ENT_TEST_PACKED''))');
select public.t_ok('and the insert succeeds',
  'insert into public.garden_item(garden_id,blueprint_id)
     select ''e0e0e0e0-0000-0000-0000-000000000001'',
            id from public.blueprint where legacy_code=''ENT_TEST_PACKED''');


-- ============================================================================
--  C. GRANTS THE RIGHT TO ADD, NOT THE RIGHT TO SEE
--     Bob owns nothing. Alice's pack item is now in the garden they share.
--     Bob must see it, and must still be unable to add another.
-- ============================================================================
reset role; set request.jwt.claims = '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2"}'; set role authenticated;

select public.t_count('un-entitled co-member SEES the pack item in the shared garden',
  'select count(*) from public.garden_item gi
     join public.blueprint b on b.id=gi.blueprint_id
    where gi.garden_id=''e0e0e0e0-0000-0000-0000-000000000001''
      and b.legacy_code=''ENT_TEST_PACKED'' and gi.removed_at is null', 1);
select public.t_blocked('but still cannot add one himself',
  'insert into public.garden_item(garden_id,blueprint_id)
     select ''e0e0e0e0-0000-0000-0000-000000000001'',
            id from public.blueprint where legacy_code=''ENT_TEST_PACKED''');


-- ============================================================================
--  D. EXPIRY
-- ============================================================================
reset role;
update public.entitlement
   set expires_at = now() - interval '1 day'
 where user_id='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1';

set request.jwt.claims = '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1"}'; set role authenticated;
select public.t_false('an EXPIRED entitlement no longer grants',
  'select public.can_add_blueprint((select id from public.blueprint where legacy_code=''ENT_TEST_PACKED''))');
select public.t_count('but the item she already added is untouched',
  'select count(*) from public.garden_item gi
     join public.blueprint b on b.id=gi.blueprint_id
    where gi.garden_id=''e0e0e0e0-0000-0000-0000-000000000001''
      and b.legacy_code=''ENT_TEST_PACKED'' and gi.removed_at is null', 1);

reset role;
update public.entitlement
   set expires_at = now() + interval '365 days'
 where user_id='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1';
set request.jwt.claims = '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1"}'; set role authenticated;
select public.t_true('a future expiry date grants normally',
  'select public.can_add_blueprint((select id from public.blueprint where legacy_code=''ENT_TEST_PACKED''))');


-- ============================================================================
--  E. RETIRING A PACK RELEASES ITS CONTENTS
--     The deliberate failure direction: a withdrawn product must never leave a
--     plant permanently un-addable, because that would put its care advice out
--     of reach too.
-- ============================================================================
reset role;
update public.product set retired_at = now() where code='PACK_ENT_TEST';

set request.jwt.claims = '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2"}'; set role authenticated;
select public.t_true('retiring the pack makes its item core again (un-entitled Bob)',
  'select public.can_add_blueprint((select id from public.blueprint where legacy_code=''ENT_TEST_PACKED''))');
select public.t_ok('and Bob can now actually add it',
  'insert into public.garden_item(garden_id,blueprint_id)
     select ''e0e0e0e0-0000-0000-0000-000000000001'',
            id from public.blueprint where legacy_code=''ENT_TEST_PACKED''');

reset role;
update public.product set retired_at = null where code='PACK_ENT_TEST';


-- ============================================================================
--  F. NOBODY GRANTS THEMSELVES ANYTHING
--
--     Note the asymmetry in the last two checks, which is deliberate and worth
--     understanding: a SIGNED-IN user may read the entitlement table and is
--     filtered by policy to their own rows, whereas a SIGNED-OUT visitor is
--     refused the table outright. anon holds no SELECT grant at all, and
--     privileges are checked BEFORE any row policy is consulted — so the
--     refusal happens a layer earlier, and is stronger than an empty result.
-- ============================================================================
set request.jwt.claims = '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2"}'; set role authenticated;

select public.t_blocked('a user cannot grant himself an entitlement',
  'insert into public.entitlement(user_id,product_id)
     values (''eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2'',
             (select id from public.product where code=''PACK_ENT_TEST''))');
select public.t_blocked('a user cannot extend an existing entitlement',
  'update public.entitlement set expires_at = null');
select public.t_blocked('a user cannot delete an entitlement',
  'delete from public.entitlement');
select public.t_count('a user sees NONE of Alice''s entitlements',
  'select count(*) from public.entitlement', 0);

set request.jwt.claims = '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1"}'; set role authenticated;
select public.t_count('but Alice sees her own',
  'select count(*) from public.entitlement', 1);

reset role; set request.jwt.claims = '{}'; set role anon;
select public.t_blocked('a signed-out visitor is refused the entitlement table outright',
  'select count(*) from public.entitlement');


-- ============================================================================
--  G. THE INVENTORY CEILING
--     Filled as the service role (which the guard skips), then probed as the
--     user — so the test measures the guard, not the seeding.
-- ============================================================================
reset role;
insert into public.garden_item(garden_id,blueprint_id)
  select 'e0e0e0e0-0000-0000-0000-000000000002',
         (select id from public.blueprint where legacy_code='ENT_TEST_CORE')
  from generate_series(1,199);

set request.jwt.claims = '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1"}'; set role authenticated;
select public.t_ok('the 200th item is allowed',
  'insert into public.garden_item(garden_id,blueprint_id)
     select ''e0e0e0e0-0000-0000-0000-000000000002'',
            id from public.blueprint where legacy_code=''ENT_TEST_CORE''');
select public.t_blocked('the 201st is refused',
  'insert into public.garden_item(garden_id,blueprint_id)
     select ''e0e0e0e0-0000-0000-0000-000000000002'',
            id from public.blueprint where legacy_code=''ENT_TEST_CORE''');

-- Removing one must free a slot: a soft-deleted item is not "in" the garden.
select public.t_ok('remove one item (soft delete)',
  'update public.garden_item set removed_at = now()
    where id = (select min(id) from public.garden_item
                 where garden_id=''e0e0e0e0-0000-0000-0000-000000000002''
                   and removed_at is null)');
select public.t_ok('a removed item frees a slot',
  'insert into public.garden_item(garden_id,blueprint_id)
     select ''e0e0e0e0-0000-0000-0000-000000000002'',
            id from public.blueprint where legacy_code=''ENT_TEST_CORE''');

select public.t_count('the other garden is unaffected by the full one',
  'select count(*) from public.garden_item
    where garden_id=''e0e0e0e0-0000-0000-0000-000000000001'' and removed_at is null', 3);


-- ============================================================================
--  H. ADVICE IS NEVER GATED
--     select_tasks takes no entitlement argument and asks no entitlement
--     question. This check simply confirms it still runs and is unaffected.
-- ============================================================================
select public.t_ok('select_tasks still runs for a garden holding pack items',
  'select count(*) from public.select_tasks(''e0e0e0e0-0000-0000-0000-000000000001'')');


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
