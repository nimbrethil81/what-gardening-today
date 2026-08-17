-- ============================================================================
--  What Gardening Today? — daily activity record (file 10)
--
--  ONE QUESTION, ANSWERED FOREVER: do people come back?
--
--  `task_completion` already records what a garden DID. What it cannot show is
--  the open that produced nothing — the user who looked, found no job they
--  fancied, and drifted away. That silence is precisely the churn signal, and
--  it is the one number that cannot be reconstructed after the fact. Every day
--  this file is not installed is a day of baseline that does not exist.
--
--  WHAT IT RECORDS: one row per garden per day, with a count of opens. Nothing
--  about which tasks were shown, nothing about the user, no times of day. The
--  coarsest record that still answers the question.
--
--  RUN THIS AFTER 09_browse_groups.sql, in the Supabase SQL Editor
--  (Project -> SQL Editor -> New query -> paste -> Run). Idempotent-friendly:
--  safe to run as often as you like.
--
--  WHO TOUCHES THIS TABLE: only the `today` Edge Function, using the service
--  role. Signed-in users are granted nothing here and have no policy, so they
--  can neither read nor write it — exactly the posture weather_cache takes
--  (file 07). A user cannot inflate their own activity, and cannot read anyone
--  else's.
--
--  SIZE: two small columns plus a count, one row per garden per day, so a
--  garden opened every single day of a year contributes 365 rows (~100 bytes
--  each). A thousand active gardens is roughly 20 MB a year against a 500 MB
--  free-tier database, and it adds nothing to Supabase's MAU billing, which
--  counts authenticated users rather than rows. If it ever mattered, rows older
--  than two years would collapse into a monthly summary; that pruning job is
--  deliberately NOT built, because at present it would be solving a problem
--  that does not exist.
--
--  DELETION: the garden_id foreign key cascades. Deleting a garden erases its
--  activity history along with everything else, which is the correct answer for
--  a deletion request even though it costs us the history. Deletion means
--  deletion.
--
--  NOT CONTAMINATED BY THE KEEP-ALIVE: the twice-weekly GitHub Action calls
--  keepalive() (file 08), never `today`, so scheduled pings never appear here
--  as phantom activity.
-- ============================================================================


-- ============================================================================
--  1. THE TABLE
--
--     `day` is a DATE resolved in the garden's OWN timezone, not UTC and not
--     the device's. This is the same discipline select_tasks applies when it
--     computes cooldown, and for the same reason: an open at 23:30 on a British
--     Summer Time evening belongs to that evening, not to tomorrow.
--
--     `opens` distinguishes a glance from a habit at no extra storage cost —
--     it is a column on a row that exists either way.
-- ============================================================================
create table if not exists public.garden_day (
  garden_id uuid    not null references public.garden(id) on delete cascade,
  day       date    not null,
  opens     integer not null default 1,

  primary key (garden_id, day),
  constraint garden_day_opens_positive check (opens >= 1)
);

comment on table public.garden_day is
  'One row per garden per day the app was opened, with a count of opens. Day is '
  'resolved in the garden timezone. Written ONLY by the today Edge Function '
  '(service role). Not user-accessible. Exists to answer: do people come back?';
comment on column public.garden_day.day is
  'Calendar day in the GARDEN''s timezone, not UTC — same rule as select_tasks cooldown.';
comment on column public.garden_day.opens is
  'Times the daily view was served for this garden on this day. 1 = a glance, 3+ = a habit.';

-- The primary key already serves "history for one garden". This index serves
-- the other direction — "how many gardens were active on day X" — which is the
-- query every retention question actually starts from.
create index if not exists idx_garden_day_day on public.garden_day (day);


-- ============================================================================
--  2. THE RECORDING FUNCTION
--
--     The timezone lookup lives HERE rather than in the Edge Function, so the
--     rule for "which day is it in this garden?" is written once, in SQL, next
--     to the only other place that asks it. A second implementation in
--     TypeScript would be a second thing to keep correct.
--
--     SECURITY INVOKER, deliberately. The caller is the service role, which
--     bypasses RLS anyway, so DEFINER would buy nothing — and INVOKER means
--     that if execute permission were ever loosened by accident, the insert
--     would STILL be refused for lack of a table grant. Two independent
--     protections, neither relying on the other.
--
--     SILENT ON AN UNKNOWN GARDEN: returns without raising. This function is
--     bookkeeping, and bookkeeping must never be able to break the daily view.
-- ============================================================================
create or replace function public.record_garden_day(p_garden_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tz  text;
  v_day date;
begin
  select g.timezone into v_tz
  from public.garden g
  where g.id = p_garden_id;

  -- No such garden (or not visible to the caller): record nothing, raise nothing.
  if v_tz is null then
    return;
  end if;

  v_day := (now() at time zone v_tz)::date;

  insert into public.garden_day (garden_id, day, opens)
  values (p_garden_id, v_day, 1)
  on conflict (garden_id, day) do update
    set opens = garden_day.opens + 1;
end;
$$;

comment on function public.record_garden_day(uuid) is
  'Records one app-open for a garden, on the calendar day in that garden''s own '
  'timezone. Called by the today Edge Function as the service role. Never raises.';


-- ============================================================================
--  3. ACCESS: nobody but the service role.
--
--     File 09 learned this the hard way with a 42501: a newly created table
--     inherits no privileges, and RLS is a filter applied ON TOP of ordinary
--     SQL privileges rather than a replacement for them. A policy without a
--     grant is a lock fitted to a bricked-up door. Both layers are set here.
--
--     RLS is enabled with NO policies at all, which is what denies every
--     signed-in and signed-out user. The service role bypasses RLS by design
--     and does all the work — the same arrangement as weather_cache.
--
--     Functions are granted EXECUTE to PUBLIC by default, so the revoke below
--     is not decorative: without it, any signed-in user could call the
--     recording function directly.
-- ============================================================================
revoke all on public.garden_day from anon, authenticated;

alter table public.garden_day enable row level security;
-- (No policies, by design. Nothing to drop, nothing to create.)

grant select, insert, update, delete on public.garden_day to service_role;

revoke execute on function public.record_garden_day(uuid) from public;
revoke execute on function public.record_garden_day(uuid) from anon, authenticated;
grant  execute on function public.record_garden_day(uuid) to service_role;


-- ============================================================================
--  4. CONFIRMATION READOUT
--     The web SQL Editor shows this as a grid, so "Success. No rows returned"
--     becomes something you can actually read. On a first run every count is
--     zero and both dates are blank — that is the correct result, not a fault.
-- ============================================================================
select
  (select count(*)                  from public.garden_day) as "Rows recorded",
  (select count(distinct garden_id) from public.garden_day) as "Gardens seen",
  (select min(day)                  from public.garden_day) as "First day",
  (select max(day)                  from public.garden_day) as "Latest day",
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'garden_day')
                                                            as "Policies (expect 0)";
