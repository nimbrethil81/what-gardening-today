-- ============================================================================
--  What Gardening Today? — v2.0 weather cache (Stage 3, file 7)
--  DESIGN_V2.md §6. A short-lived, shared cache of current weather keyed by
--  rounded coordinates, so the `today` Edge Function keeps OpenWeather usage
--  polite as the user count grows: nearby gardens share one fetch, and repeated
--  opens within the freshness window reuse the last reading instead of calling
--  the weather API again.
--
--  RUN THIS AFTER 01_schema.sql .. 06_verify.sql, in the Supabase SQL Editor
--  (Project -> SQL Editor -> New query -> paste -> Run). Idempotent-friendly.
--
--  WHO TOUCHES THIS TABLE: only the `today` Edge Function, using the service
--  role (which bypasses RLS). Signed-in users are granted nothing here and have
--  no policy, so they can neither read nor write it — weather reaches them only
--  through the function, never by reading this table directly. Weather is not
--  secret, but writes must stay with the function so the cache cannot be poisoned.
--
--  SIZE: one row per distinct rounded location, upserted in place. With a single
--  UK garden this table holds a single row; it never grows unbounded, so no
--  expiry/clean-up job is needed. Freshness (the ~30-minute window) is enforced
--  by the function at read time, not by deleting rows.
-- ============================================================================

create table if not exists public.weather_cache (
  rounded_lat numeric     not null,   -- garden latitude rounded to ~0.1 deg
  rounded_lon numeric     not null,   -- garden longitude rounded to ~0.1 deg
  temp_c      numeric,                -- rounded degrees Celsius (widget + filter)
  is_raining  boolean,                -- raining now or recent rain (rain filter)
  wind_mph    numeric,                -- rounded mph (wind filter)
  description text,                   -- e.g. "light rain" (widget only)
  icon        text,                   -- OpenWeather icon code, e.g. "10d" (widget)
  fetched_at  timestamptz not null default now(),

  primary key (rounded_lat, rounded_lon),
  constraint weather_cache_lat_range check (rounded_lat between  -90 and  90),
  constraint weather_cache_lon_range check (rounded_lon between -180 and 180)
);

comment on table public.weather_cache is
  'Short-lived shared weather readings keyed by rounded coordinates (~0.1 deg). '
  'Written and read ONLY by the today Edge Function (service role). Not user-accessible.';


-- ----------------------------------------------------------------------------
--  ACCESS: nobody but the service role.
--  Explicit revoke + RLS-enabled-with-no-policies means a signed-in (or anon)
--  user has no path to any row. The service role bypasses RLS and does all the
--  work. This matches the Stage 1 posture of explicit, per-table grants.
-- ----------------------------------------------------------------------------
revoke all on public.weather_cache from anon, authenticated;
grant  all on public.weather_cache to   service_role;

alter table public.weather_cache enable row level security;
-- (Deliberately NO policies for anon/authenticated -> they can touch nothing.)


-- ============================================================================
--  CONFIRMATION READOUT — shows the table exists, RLS is on, and (importantly)
--  that it carries ZERO user policies. Safe to re-run.
-- ============================================================================
select
  'weather_cache' as "Table",
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'weather_cache')      as "Columns",
  (select rowsecurity from pg_tables
     where schemaname = 'public' and tablename = 'weather_cache')          as "RLS on",
  (select count(*) from pg_policies
     where schemaname = 'public' and tablename = 'weather_cache')          as "Policies (want 0)";
