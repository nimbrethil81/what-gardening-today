-- ============================================================================
--  What Gardening Today? — multiple gardens per user (file 13)
--
--  RUN THIS AFTER 12_account_deletion.sql, in the Supabase SQL Editor
--  (Project -> SQL Editor -> New query -> paste -> Run). Idempotent-friendly.
--
--  ---------------------------------------------------------------------
--  WHAT WAS ALREADY TRUE, because it decides what this file does and does not
--  need to touch:
--
--  garden_member has always been many-to-many, every per-garden table keys on
--  garden_id, and every policy asks is_garden_member(garden_id). So READING and
--  SWITCHING between several gardens needed no database change whatsoever, and
--  none is made here. create_garden was written PERMISSIVE about a second
--  garden on purpose (03_functions.sql says so in its header), so CREATING one
--  needed no change either.
--
--  Two things were genuinely impossible, and they are what this file adds:
--
--    DELETING a garden. `garden` is granted SELECT and UPDATE only — there is
--    no delete grant and no delete policy, and 02_rls_test.sql asserts
--    "Alice cannot delete her garden" as a PASSING test. That was correct while
--    a user had exactly one garden (deleting it would have stranded them), and
--    it stays correct now: deletion happens through a function that can enforce
--    the rules, not through a loosened policy that cannot.
--
--    LEAVING a garden. garden_member's delete policy requires is_garden_owner,
--    so an ordinary member could not remove their own membership row — exactly
--    the person who would want to. The obvious fix, letting anyone delete their
--    own row, is the WRONG one: it re-opens the orphan hole that file 12 exists
--    to close. So leaving also goes through a function.
--  ---------------------------------------------------------------------
--
--  THE RULES, and they are deliberately the SAME rules delete_my_account (file
--  12) already applies, so the two paths out of a garden cannot disagree:
--
--    * Last member out  -> the garden is deleted, and the cascades defined in
--                          01_schema and 10_activity take the items, manual
--                          tasks, completions, hidden tasks and activity with
--                          it. Deletion means deletion.
--    * Sole OWNER out,
--      others remain    -> the garden is HANDED OVER to the longest-standing
--                          remaining member (user_id breaks a tie, so a re-run
--                          picks the same person).
--    * Anyone else out  -> nothing happens to the garden.
--
--  AND ONE NEW RULE, agreed in design: DELETING a garden is REFUSED while
--  anybody else is still a member. Destroying someone else's plants, history
--  and years of ticked-off jobs should require an explicit act against that
--  person (remove them, or leave it yourself), never a single tap aimed at
--  something you think of as "mine". The owner can still remove members first
--  and then delete — which is the same outcome reached deliberately instead of
--  by accident.
--
--  THIS FILE ALSO CLOSES A HOLE THAT IS REACHABLE TODAY. app.js and config.js
--  are public files served with a published anon key, so the Data API is
--  reachable directly whatever the UI offers. The current garden_member delete
--  policy lets an OWNER delete ANY row in their garden — including their own —
--  which produces either a garden with nobody in it (file 12's orphan, by
--  another route) or, worse, a garden with members and NO OWNER. That second
--  state has no exit at all: there is no update policy on garden_member, so
--  nobody can ever be promoted. Section 4 makes both unrepresentable.
-- ============================================================================


-- ============================================================================
--  1. create_garden — UNCHANGED except for a ceiling.
--
--     This supersedes the definition in 03_functions.sql. Everything about it
--     is the same: same signature (so the existing grant survives the replace),
--     same atomic create-and-enrol, same return value. The only addition is the
--     guard below, and it exists for the same reason as the 200-item ceiling in
--     11_entitlement.sql: garden count is a user-controlled input to cost, and
--     nothing else bounds it now that the UI offers a "new garden" button.
--
--     TEN, and invisible until absurd. The real case this feature was built for
--     is two (your own garden and a relative's); a keen allotmenteer might reach
--     four or five. Ten is far above any honest use and far below anything that
--     would matter. It is NOT a paywall and must never become one — see the
--     note in 11_entitlement.sql §5(a) on why a cap that binds makes the app
--     worse at the thing it is for.
--
--     Counted over MEMBERSHIP, not ownership: ten gardens you can see, however
--     you came to be in them. Counting only the ones you own would let the cap
--     be walked around the moment sharing exists.
-- ============================================================================
create or replace function public.create_garden(
  p_name      text,
  p_latitude  numeric,
  p_longitude numeric,
  p_timezone  text default 'Europe/London'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- The one dial. Recorded in docs/CONFIG_ITEMS.md.
  v_max_gardens constant integer := 10;
  v_uid    uuid := auth.uid();
  v_count  integer;
  v_garden uuid;
begin
  if v_uid is null then
    raise exception 'You must be signed in to create a garden'
      using errcode = '42501';
  end if;

  select count(*) into v_count
  from public.garden_member gm
  where gm.user_id = v_uid;

  if v_count >= v_max_gardens then
    raise exception 'You already have the maximum of % gardens.', v_max_gardens
      using errcode = '54000';
  end if;

  insert into public.garden (name, latitude, longitude, timezone)
  values (p_name, p_latitude, p_longitude, coalesce(p_timezone, 'Europe/London'))
  returning id into v_garden;

  insert into public.garden_member (garden_id, user_id, role)
  values (v_garden, v_uid, 'owner');

  return v_garden;
end;
$$;

grant execute on function public.create_garden(text,numeric,numeric,text) to authenticated;

comment on function public.create_garden(text,numeric,numeric,text) is
  'Creates a garden and enrols the caller as its owner, atomically. The only way '
  'a garden is born. Refuses beyond 10 gardens per user (abuse guard, not a paywall).';


-- ============================================================================
--  2. leave_garden(garden) — remove YOURSELF from one garden.
--
--     THE ARGUMENT IS THE GARDEN, NOT THE PERSON. There is deliberately no
--     "remove user X from garden Y" form of this function: it always and only
--     removes auth.uid(), so it cannot be aimed at anybody else however it is
--     called. Removing SOMEONE ELSE is an owner's action and goes through the
--     ordinary policy in §4, where the row-level rules can be read in one place.
--
--     SECURITY DEFINER because it must delete a garden_member row that §4
--     deliberately forbids the caller to touch, and may need to promote another
--     member — an update garden_member has no policy for at all. search_path is
--     pinned empty with every name fully qualified, so a caller's path cannot
--     hijack it: the same posture as is_garden_member and delete_my_account.
--
--     ONE TRANSACTION. A function body is atomic, so there is no state in which
--     somebody has half-left.
--
--     RETURNS WHAT HAPPENED, as text, because the three outcomes are genuinely
--     different from the user's point of view and the app should be able to say
--     which one it was without working it out again from a second query:
--       'garden_deleted' — you were the last one; it is gone
--       'handed_over'    — you were the only owner; someone else has it now
--       'left'           — you are simply no longer a member
-- ============================================================================
create or replace function public.leave_garden(p_garden_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_new_owner uuid;
begin
  if v_uid is null then
    raise exception 'You must be signed in' using errcode = '42501';
  end if;

  -- Refused outright rather than silently doing nothing, so the boundary is
  -- testable — the same choice select_tasks makes (03_functions.sql).
  if not public.is_garden_member(p_garden_id) then
    raise exception 'You are not a member of this garden' using errcode = '42501';
  end if;

  -- LAST ONE OUT. The garden goes, and the cascades take everything below it.
  -- Note this deletes the caller's own garden_member row too, via the cascade.
  if not exists (
    select 1 from public.garden_member gm
    where gm.garden_id = p_garden_id and gm.user_id <> v_uid
  ) then
    delete from public.garden where id = p_garden_id;
    return 'garden_deleted';
  end if;

  -- THE ONLY OWNER IS LEAVING, but others still tend this garden. Hand it over
  -- rather than stranding them in a garden nobody can manage. Longest-standing
  -- member first; user_id breaks a tie so the choice is deterministic. This is
  -- character-for-character the rule delete_my_account applies (file 12).
  if not exists (
    select 1 from public.garden_member gm
    where gm.garden_id = p_garden_id
      and gm.user_id <> v_uid
      and gm.role = 'owner'
  ) and public.is_garden_owner(p_garden_id) then

    select gm.user_id into v_new_owner
    from public.garden_member gm
    where gm.garden_id = p_garden_id and gm.user_id <> v_uid
    order by gm.added_at, gm.user_id
    limit 1;

    update public.garden_member
       set role = 'owner'
     where garden_id = p_garden_id and user_id = v_new_owner;

    delete from public.garden_member
     where garden_id = p_garden_id and user_id = v_uid;

    return 'handed_over';
  end if;

  -- Everyone else: another owner remains, or you were never one. Just go.
  delete from public.garden_member
   where garden_id = p_garden_id and user_id = v_uid;

  return 'left';
end;
$$;

comment on function public.leave_garden(uuid) is
  'Removes the CALLER from one garden. Last member out deletes the garden; a '
  'departing sole owner hands it to the longest-standing remaining member. Takes '
  'only a garden id, so it cannot be aimed at another person. Returns '
  'garden_deleted | handed_over | left.';


-- ============================================================================
--  3. delete_garden(garden) — destroy one garden and everything in it.
--
--     OWNER ONLY, and REFUSED WHILE SHARED. The second rule is the interesting
--     one. A member who is not the owner has no notification channel and no
--     warning: they would simply open the app one morning to find years of
--     their own history gone, erased by somebody else's single tap. So while
--     anyone else is a member this raises, and the message says what to do
--     instead. The owner can remove the other members (§4) and then delete —
--     the same end state, reached deliberately.
--
--     Note this makes deleting a GARDEN stricter than deleting an ACCOUNT,
--     which hands shared gardens over rather than destroying them. Both err in
--     the same direction: never destroy data on behalf of someone who did not
--     ask.
--
--     A HARD DELETE, matching file 12 and the position 10_activity.sql states
--     outright: deletion means deletion. There is no tombstone and no undo.
--
--     THE LAST GARDEN MAY BE DELETED, and this deliberately does not check.
--     Zero gardens is already a real, handled state — route() in app.js sends a
--     signed-in user with no gardens to the setup screen, which is where every
--     new user starts. Refusing here would build a trap whose only exit was
--     deleting the whole account, which is far more destructive than what was
--     asked for.
-- ============================================================================
create or replace function public.delete_garden(p_garden_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_others integer;
begin
  if v_uid is null then
    raise exception 'You must be signed in' using errcode = '42501';
  end if;

  -- Not an owner (or not a member, or no such garden): all the same answer.
  if not public.is_garden_owner(p_garden_id) then
    raise exception 'Only the owner of a garden can delete it' using errcode = '42501';
  end if;

  select count(*) into v_others
  from public.garden_member gm
  where gm.garden_id = p_garden_id and gm.user_id <> v_uid;

  if v_others > 0 then
    raise exception
      'This garden is shared with % other %. Remove them first, or leave it yourself.',
      v_others, case when v_others = 1 then 'person' else 'people' end
      using errcode = '42501';
  end if;

  -- Cascades take garden_member, garden_item, manual tasks, task_completion,
  -- hidden_task and garden_day. The foreign-key audit at the foot of file 12
  -- is what proves that list stays complete as tables are added.
  delete from public.garden where id = p_garden_id;
end;
$$;

comment on function public.delete_garden(uuid) is
  'Deletes one garden and everything in it. Owner only, and REFUSED while anyone '
  'else is a member. Immediate and irreversible. Deleting your last garden is '
  'allowed — it returns you to the setup screen, where every new user starts.';


-- ============================================================================
--  4. THE TIGHTENED MEMBERSHIP POLICY
--
--     Replaces garden_member_delete_owner from 02_rls.sql. It still says what
--     it always said — only an owner may remove somebody — and adds the two
--     guards that make the impossible states in this file's header actually
--     impossible, declaratively, where they can be read rather than inferred:
--
--       user_id <> auth.uid()  — you cannot remove YOURSELF this way. Leaving
--                                is leave_garden's job, because leaving is the
--                                case that has to decide between deleting the
--                                garden and handing it over. A bare delete of
--                                your own row does neither.
--
--       role <> 'owner'        — an owner row cannot be deleted by this path at
--                                all. With one owner per garden (nothing in the
--                                schema promotes anybody except the two
--                                functions that hand a garden over) this is
--                                simply "the owner cannot be removed", which is
--                                what stops a garden being left with members
--                                and no way to ever have an owner again.
--
--     Both functions above are SECURITY DEFINER and so bypass this policy —
--     which is the point. Every legitimate self-removal goes through code that
--     resolves the garden's fate in the same transaction.
--
--     NO REGRESSION: 02_rls_test.sql's "Alice (owner) removes a member" removes
--     a different user whose role is 'member', and still passes.
-- ============================================================================
drop policy if exists garden_member_delete_owner on public.garden_member;
create policy garden_member_delete_owner on public.garden_member
  for delete to authenticated
  using (
    public.is_garden_owner(garden_id)
    and user_id <> auth.uid()   -- self-removal belongs to leave_garden()
    and role    <> 'owner'      -- an owner is never removed by someone else
  );


-- ============================================================================
--  5. ACCESS
--     Functions are EXECUTE-to-PUBLIC by default, so the revokes are not
--     decorative. anon must hold neither: there is nothing for a signed-out
--     caller to leave or delete, and both would raise anyway.
-- ============================================================================
revoke execute on function public.leave_garden(uuid)  from public;
revoke execute on function public.leave_garden(uuid)  from anon;
revoke execute on function public.delete_garden(uuid) from public;
revoke execute on function public.delete_garden(uuid) from anon;

grant execute on function public.leave_garden(uuid)  to authenticated;
grant execute on function public.delete_garden(uuid) to authenticated;

-- No new table grants. `garden` still has SELECT and UPDATE only: deletion goes
-- through delete_garden(), never through a delete grant. That is deliberate —
-- a grant would let the Data API delete a garden with no rules applied at all.


-- ============================================================================
--  6. CONFIRMATION READOUT
--
--     "Gardens with no members" is the number that matters, and it should be
--     zero forever. It is the same check file 12's test suite ends on, run here
--     against live data: an orphaned garden is data we failed to erase, sitting
--     in a table no policy can reach.
--
--     "Gardens with no owner" should likewise be zero. Before this file it was
--     a state the API could produce; after it, it cannot.
-- ============================================================================
select
  (select count(*) from public.garden)                          as "Gardens",
  (select count(*) from public.garden_member)                   as "Memberships",
  (select coalesce(max(n),0) from (
     select count(*) as n from public.garden_member group by user_id) s)
                                                                as "Most gardens held by one user",
  (select count(*) from public.garden g
     where not exists (select 1 from public.garden_member gm
                       where gm.garden_id = g.id))              as "Orphaned gardens (want 0)",
  (select count(*) from public.garden g
     where not exists (select 1 from public.garden_member gm
                       where gm.garden_id = g.id and gm.role = 'owner'))
                                                                as "Owner-less gardens (want 0)",
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('leave_garden','delete_garden'))
                                                                as "New functions (want 2)";
