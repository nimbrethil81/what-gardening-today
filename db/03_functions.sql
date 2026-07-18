-- ============================================================================
--  What Gardening Today? — v2.0 functions (Stage 1, file 3 of N)
--  DESIGN_V2.md §4.6 (select_tasks) and §5 (create_garden).
--
--  RUN THIS AFTER 02_rls.sql, in the Supabase SQL Editor.
--  Safe to re-run: both use CREATE OR REPLACE.
-- ============================================================================


-- ============================================================================
--  create_garden(name, latitude, longitude [, timezone])
--
--  The ONLY sanctioned way a garden comes into existence. It creates the garden
--  AND enrols the caller as its owner in one atomic step, so a garden can never
--  exist without an owner (which is why direct INSERTs into garden are blocked
--  by RLS — see 02_rls.sql). Returns the new garden's id.
--
--  SECURITY DEFINER so it may perform those two writes on the caller's behalf;
--  auth.uid() still resolves to the real signed-in caller inside it.
--
--  PERMISSIVE about a second garden, by decision: it does NOT check whether the
--  caller already owns one. The v2.0 UI simply never offers a "new garden"
--  button, so in practice each user gets exactly one. When the multi-garden
--  feature arrives this needs no change; if a one-garden-per-user guard is ever
--  wanted, it would be added right here.
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
  v_uid    uuid := auth.uid();
  v_garden uuid;
begin
  if v_uid is null then
    raise exception 'You must be signed in to create a garden'
      using errcode = '42501';
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


-- ============================================================================
--  select_tasks(garden, [month], [temp_c], [is_raining], [wind_mph])
--
--  The matching engine — the heir to the three-tier matcher. Given a garden and
--  the current conditions, it returns the tasks that are relevant RIGHT NOW.
--
--  A task appears when ALL of these hold:
--    1. MATCH   — a curated task whose target (a blueprint, or a collection the
--                 blueprint belongs to) hits an ACTIVE item in this garden; OR a
--                 manual task belonging to this garden (attached item, if any,
--                 must be active). NB there is no category-tier match in v2.
--    2. SEASON  — the month is listed in the task's valid_months.
--    3. OFF COOLDOWN — no completion within the last frequency_days, counted in
--                 WHOLE DAYS in the garden's own timezone. A one-off task (null
--                 frequency) is suppressed forever once completed.
--    4. NOT HIDDEN — the user hasn't hidden it in this garden.
--    5. WEATHER OK — not suppressed by supplied conditions. Each weather axis is
--                 only applied when its reading is provided; a null reading means
--                 "unknown", and unknown never suppresses. Wind suppresses when
--                 it is ABOVE the threshold (too windy to do the job) — the
--                 corrected sense versus the live app.
--
--  SECURITY DEFINER with an explicit membership guard: asking for a garden you
--  do not belong to is REFUSED outright (not silently returned empty), so the
--  boundary is testable. auth.uid() resolves to the real caller inside.
--
--  month defaults to the current month in the garden's timezone; the weather
--  arguments default to null (unknown) so a plain select_tasks(garden) returns
--  everything in season and off cooldown, unfiltered by weather.
-- ============================================================================
create or replace function public.select_tasks(
  p_garden_id  uuid,
  p_month      integer default null,
  p_temp       numeric default null,
  p_is_raining boolean default null,
  p_wind_mph   numeric default null
)
returns table (
  task_id           integer,
  legacy_code       text,
  name              text,
  instruction       text,
  category          text,
  estimated_minutes integer,
  frequency_days    integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz    text;
  v_today date;
  v_month integer;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in' using errcode = '42501';
  end if;

  if not public.is_garden_member(p_garden_id) then
    raise exception 'You are not a member of this garden' using errcode = '42501';
  end if;

  select g.timezone into v_tz from public.garden g where g.id = p_garden_id;
  if v_tz is null then
    raise exception 'Garden not found' using errcode = 'P0002';
  end if;

  v_today := (now() at time zone v_tz)::date;
  v_month := coalesce(p_month, extract(month from v_today)::integer);

  return query
  with active_bp as (
    select distinct gi.blueprint_id
    from public.garden_item gi
    where gi.garden_id = p_garden_id
      and gi.removed_at is null
  ),
  -- curated (global) tasks whose target hits an active item's blueprint,
  -- directly or via a collection that blueprint belongs to
  matched_global as (
    select distinct tt.task_id as tid
    from public.task_target tt
    where tt.blueprint_id in (select ab.blueprint_id from active_bp ab)
       or tt.collection_id in (
            select cm.collection_id
            from public.collection_member cm
            where cm.blueprint_id in (select ab.blueprint_id from active_bp ab)
          )
  ),
  -- manual tasks belonging to this garden (dormant feature); an attached item
  -- must still be active
  matched_manual as (
    select mt.id as tid
    from public.task mt
    where mt.garden_id = p_garden_id
      and mt.retired_at is null
      and (
        mt.garden_item_id is null
        or exists (
          select 1 from public.garden_item gi2
          where gi2.id = mt.garden_item_id and gi2.removed_at is null
        )
      )
  ),
  candidate as (
    select tid from matched_global
    union
    select tid from matched_manual
  ),
  -- most recent completion date (in garden tz) per task in this garden
  last_done as (
    select tc.task_id as tid,
           max((tc.completed_at at time zone v_tz)::date) as last_date
    from public.task_completion tc
    where tc.garden_id = p_garden_id
    group by tc.task_id
  )
  select
    t.id,
    t.legacy_code,
    t.name,
    t.instruction,
    c.name,
    t.estimated_minutes,
    t.frequency_days
  from public.task t
  join candidate cand on cand.tid = t.id
  left join public.category c on c.id = t.category_id
  left join last_done ld on ld.tid = t.id
  where t.retired_at is null
    -- season
    and v_month = any (t.valid_months)
    -- not hidden in this garden
    and not exists (
      select 1 from public.hidden_task h
      where h.garden_id = p_garden_id and h.task_id = t.id
    )
    -- off cooldown (whole days, garden tz). One-off (null freq): any completion
    -- suppresses forever, so it's included only while never completed.
    and (
      ld.last_date is null
      or (t.frequency_days is not null and (v_today - ld.last_date) >= t.frequency_days)
    )
    -- weather: each axis applies only when its reading is known
    and not (coalesce(t.suppress_if_raining, false) and coalesce(p_is_raining, false))
    and not (t.suppress_if_temp_below is not null and p_temp     is not null and p_temp     <  t.suppress_if_temp_below)
    and not (t.suppress_if_wind_above is not null and p_wind_mph is not null and p_wind_mph >  t.suppress_if_wind_above)
  order by c.sort_order nulls last, t.name;
end;
$$;

grant execute on function public.select_tasks(uuid,integer,numeric,boolean,numeric) to authenticated;
