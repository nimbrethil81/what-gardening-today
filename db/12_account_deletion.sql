-- ============================================================================
--  What Gardening Today? — account deletion (file 12)
--
--  Required by Apple (an account created in-app must be deletable in-app) and
--  by UK GDPR regardless of any app store. Also simply the right thing: a
--  person who wants to leave should be able to, without emailing anyone.
--
--  RUN THIS AFTER 11_entitlement.sql, in the Supabase SQL Editor.
--
--  ---------------------------------------------------------------------
--  WHAT THE SCHEMA ALREADY GETS RIGHT, because it shapes everything below:
--
--  task_completion and hidden_task are keyed on the GARDEN, not the user.
--  There is no "who did this" column anywhere. So a garden's history belongs
--  to the garden, and the ugliest question in account deletion — do we erase
--  one person's completions and thereby resurrect tasks their partner had
--  already done? — simply does not arise. Nothing has to be anonymised,
--  because nothing was ever attributed.
--
--  What IS attached to a user is small: their auth.users row (email and
--  sign-in identity), their garden_member rows, and their entitlement rows.
--  The last two already cascade.
--  ---------------------------------------------------------------------
--
--  THE PROBLEM THIS FILE ACTUALLY SOLVES: gardens do not cascade from users,
--  and must not — a garden can have several members, and one leaving must not
--  destroy the others' data. But that leaves an ORPHAN: delete the last member
--  and the garden survives with nobody in it. Unreachable, because every policy
--  requires membership, yet still holding a location, an inventory, years of
--  history and its activity record. Data that should have been erased, sitting
--  there forever. Clearing that up is the substance of this file; everything
--  else is arithmetic.
--
--  THE THREE OUTCOMES, decided in design:
--    * Last member leaves  -> the garden is deleted, and cascades take the
--                             items, manual tasks, completions, hidden tasks
--                             and activity rows with it.
--    * Sole OWNER leaves,
--      others remain       -> the garden is HANDED OVER. The longest-standing
--                             remaining member becomes owner. They open the app
--                             next morning to everything exactly as it was,
--                             except they can now manage members themselves.
--    * A non-owner leaves,
--      or another owner
--      remains             -> nothing happens to the garden at all. The
--                             membership row goes with the user.
--
--  IMMEDIATE, NOT DEFERRED. No thirty-day grace period, for a reason specific
--  to this project: the deferred version needs something to run a month later
--  and actually finish the job, and the only scheduler here is a twice-weekly
--  GitHub Action that has already been observed to stop silently. A deletion
--  that quietly never happens is worse than no grace period at all.
--
--  RE-REGISTRATION WORKS. The hard delete below removes the auth.users row and
--  cascades the stored Google identity, sessions and refresh tokens. Google
--  keeps no account record with us — it simply returns the same identifier next
--  time, and Supabase mints a brand-new user. Same email, new user id, empty
--  slate, straight into onboarding. NB: do NOT use Supabase's SOFT delete
--  anywhere, which keeps the row and would leave the email permanently taken.
-- ============================================================================


-- ============================================================================
--  1. THE FUNCTION
--
--     IT TAKES NO ARGUMENTS. That is the security design, not an omission:
--     with nothing to pass, there is nothing to tamper with, and the function
--     cannot be aimed at another person's account however it is called. It
--     always and only deletes auth.uid().
--
--     SECURITY DEFINER because deleting from auth.users needs rights an
--     ordinary signed-in user does not have. search_path is pinned empty with
--     every name fully qualified, so a caller's path cannot hijack it — the
--     same posture as is_garden_member.
--
--     ONE TRANSACTION. A function body is atomic: either every garden is
--     resolved AND the user is deleted, or nothing changes. There is no state
--     in which somebody is half-deleted.
--
--     THE GARDEN LIST IS SNAPSHOTTED FIRST, into an array, rather than iterated
--     straight from a cursor. The loop deletes gardens, which deletes
--     garden_member rows — modifying the very set being walked. Taking the list
--     up front makes that safe by construction rather than by trusting cursor
--     semantics.
-- ============================================================================
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user      uuid := auth.uid();
  v_gardens   uuid[];
  v_garden    uuid;
  v_new_owner uuid;
begin
  if v_user is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  select array_agg(gm.garden_id) into v_gardens
  from public.garden_member gm
  where gm.user_id = v_user;

  foreach v_garden in array coalesce(v_gardens, '{}'::uuid[])
  loop
    if not exists (
      select 1 from public.garden_member gm2
      where gm2.garden_id = v_garden and gm2.user_id <> v_user
    ) then
      -- LAST ONE OUT. The garden goes, and the cascades defined in 01_schema
      -- and 10_activity take everything below it: items, manual tasks,
      -- completions, hidden tasks, activity rows.
      delete from public.garden where id = v_garden;

    elsif not exists (
      select 1 from public.garden_member gm3
      where gm3.garden_id = v_garden
        and gm3.user_id <> v_user
        and gm3.role = 'owner'
    ) then
      -- THE ONLY OWNER IS LEAVING, but others still tend this garden. Hand it
      -- over rather than destroying their data to satisfy someone else's
      -- request. Longest-standing member first; user_id breaks a tie so the
      -- choice is deterministic and a re-run would pick the same person.
      select gm4.user_id into v_new_owner
      from public.garden_member gm4
      where gm4.garden_id = v_garden and gm4.user_id <> v_user
      order by gm4.added_at, gm4.user_id
      limit 1;

      update public.garden_member
         set role = 'owner'
       where garden_id = v_garden and user_id = v_new_owner;
    end if;
    -- Remaining case: another owner is still here. Nothing to do — the
    -- departing membership row goes with the user delete below.
  end loop;

  -- Cascades garden_member and entitlement (public schema), and identities,
  -- sessions and refresh tokens (auth schema). A hard delete, deliberately:
  -- a soft delete would keep the email permanently taken.
  delete from auth.users where id = v_user;
end;
$$;

comment on function public.delete_my_account() is
  'Deletes the CALLING user. Gardens they were the last member of are deleted; '
  'gardens where they were the only owner are handed to the longest-standing '
  'remaining member. Takes no arguments so it cannot be aimed at anyone else. '
  'Immediate and irreversible.';


-- ============================================================================
--  2. ACCESS
--     Functions are EXECUTE-to-PUBLIC by default, so the revokes matter.
--     anon must not hold it: there is nothing for a signed-out caller to
--     delete, and the function would raise anyway.
-- ============================================================================
revoke execute on function public.delete_my_account() from public;
revoke execute on function public.delete_my_account() from anon;
grant  execute on function public.delete_my_account() to authenticated;


-- ============================================================================
--  3. CONFIRMATION READOUT — THE FOREIGN-KEY AUDIT
--
--     This is the part worth reading. Deletion only works while every table
--     pointing at auth.users or garden says CASCADE (or SET NULL). Add a table
--     later that forgets, and account deletion starts failing with an obscure
--     constraint error at the worst possible moment — the one moment a user is
--     least inclined to be patient.
--
--     Every row should read 'ok'. Anything marked REVIEW would block a deletion.
-- ============================================================================
select
  tgt.relname                              as "Points at",
  src.relname                              as "Table",
  c.conname                                as "Constraint",
  case c.confdeltype
    when 'c' then 'CASCADE'  when 'n' then 'SET NULL'
    when 'a' then 'NO ACTION' when 'r' then 'RESTRICT'
    when 'd' then 'SET DEFAULT'
  end                                      as "On delete",
  case when c.confdeltype in ('c','n')
    then 'ok' else 'REVIEW — would block deletion' end as "Verdict"
from pg_constraint c
join pg_class     src on src.oid = c.conrelid
join pg_class     tgt on tgt.oid = c.confrelid
join pg_namespace tn  on tn.oid  = tgt.relnamespace
where c.contype = 'f'
  and (   (tn.nspname = 'auth'   and tgt.relname = 'users')
       or (tn.nspname = 'public' and tgt.relname = 'garden'))
order by tgt.relname, src.relname;
