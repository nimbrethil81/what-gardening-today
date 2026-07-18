// ============================================================================
//  today — the single daily route for "What Gardening Today?" v2.0
//  DESIGN_V2.md §6. Replaces the 1.x get_all / get_tasks pair.
//
//  In one round trip, for the garden the caller asks about, this function:
//    1. Confirms the caller is signed in AND a member of that garden. Membership
//       is proven by READING the garden row as the user: Row Level Security
//       returns a row only to members, so "no row" means "not allowed".
//    2. Looks up the garden's own coordinates + timezone SERVER-SIDE. The client
//       never supplies coordinates, so this can't be used as a free weather proxy
//       for arbitrary locations.
//    3. Gets current weather through a short-lived shared cache (weather_cache,
//       keyed by rounded coordinates). On a cache miss it calls OpenWeather with
//       the key held as a function secret — never in client code or the repo —
//       derives the values the app needs, and stores them for the next caller.
//    4. Calls select_tasks (the one matching engine) with the month in the
//       garden's timezone and the weather values.
//    5. Returns { weather, tasks } in a single payload.
//
//  GRACEFUL DEGRADATION: if anything about weather fails, the function still
//  returns the tasks — just unfiltered by weather — and marks the weather
//  "available: false" so the widget shows its unavailable state. This mirrors
//  the 1.x failsafe exactly.
//
//  AUTH: JWT verification is left ON (the default). Only a signed-in caller
//  reaches this handler. Do NOT deploy with --no-verify-jwt.
//
//  ENVIRONMENT (auto-provided by Supabase, except the last which you set):
//    SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY  (auto)
//    OPENWEATHER_API_KEY                                         (secrets set)
//  NB: the three auto-provided legacy names are slated to deprecate at the end
//  of 2026 in favour of the publishable/secret-key scheme; a small future swap.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Browser origins allowed to call this function. Live and dev GitHub Pages share
// the SAME origin (paths don't matter for CORS), so one entry covers both; add a
// localhost entry if you ever test the frontend from your machine.
const ALLOWED_ORIGINS = [
  "https://nimbrethil81.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
];

const CACHE_TTL_MINUTES = 30;   // how long a cached reading stays fresh
const COORD_ROUNDING_DP = 1;    // decimal places: 1 dp ~= 0.1 deg ~= 11 km

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function roundTo(n: number, dp: number): number {
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get("Origin"));
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  // --- CORS preflight -------------------------------------------------------
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST")   return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Not signed in" }, 401);

  // --- Request body ---------------------------------------------------------
  let payload: { garden_id?: string; month?: number | null };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  const gardenId = payload?.garden_id;
  if (!gardenId) return json({ error: "garden_id is required" }, 400);
  // month is optional; when omitted, select_tasks computes it in the garden's tz.
  const month = typeof payload?.month === "number" ? payload.month : null;

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const OPENWEATHER_API_KEY = Deno.env.get("OPENWEATHER_API_KEY");

  // Client A — acts AS the signed-in user: RLS and the select_tasks membership
  // guard both apply to everything it does.
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  // Client B — service role, used ONLY for the weather cache (users can't touch it).
  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  // --- 1 & 2. Membership check + coordinates, in one read -------------------
  // RLS returns this row only to a member of the garden, so a null result is a
  // non-member (or a non-existent garden): either way, not allowed.
  const { data: garden, error: gardenErr } = await userClient
    .from("garden")
    .select("latitude, longitude, timezone")
    .eq("id", gardenId)
    .maybeSingle();

  if (gardenErr) return json({ error: "Could not read garden" }, 500);
  if (!garden)   return json({ error: "You are not a member of this garden" }, 403);

  // --- 3. Weather via the short-lived shared cache --------------------------
  const latR = roundTo(Number(garden.latitude),  COORD_ROUNDING_DP);
  const lonR = roundTo(Number(garden.longitude), COORD_ROUNDING_DP);

  let weather: {
    available: boolean;
    temp_c: number | null;
    description: string | null;
    icon: string | null;
    is_raining: boolean | null;
    wind_mph: number | null;
  } = { available: false, temp_c: null, description: null, icon: null, is_raining: null, wind_mph: null };

  try {
    // 3a. Fresh cache row?
    const freshCutoff = new Date(Date.now() - CACHE_TTL_MINUTES * 60_000).toISOString();
    const { data: cached } = await adminClient
      .from("weather_cache")
      .select("temp_c, is_raining, wind_mph, description, icon")
      .eq("rounded_lat", latR)
      .eq("rounded_lon", lonR)
      .gte("fetched_at", freshCutoff)
      .maybeSingle();

    if (cached) {
      weather = { available: true, ...cached };
    } else if (OPENWEATHER_API_KEY) {
      // 3b. Cache miss -> fetch, derive, store for the next caller.
      const url =
        `https://api.openweathermap.org/data/2.5/weather?lat=${garden.latitude}` +
        `&lon=${garden.longitude}&appid=${OPENWEATHER_API_KEY}&units=metric`;
      const res = await fetch(url);
      if (res.ok) {
        const w = await res.json();
        const temp_c = w.main ? Math.round(w.main.temp) : null;
        const wind_mph =
          w.wind && typeof w.wind.speed === "number"
            ? Math.round(w.wind.speed * 2.23694)   // OpenWeather metric wind is m/s
            : null;
        const rainingNow =
          Array.isArray(w.weather) &&
          w.weather.some((x: { main?: string }) => x.main === "Rain" || x.main === "Drizzle");
        const recentRain = w.rain && ((w.rain["1h"] > 0) || (w.rain["3h"] > 0));
        const is_raining = Boolean(rainingNow || recentRain);
        const first = Array.isArray(w.weather) && w.weather[0] ? w.weather[0] : null;
        const description = first ? first.description : null;
        const icon = first ? first.icon : null;

        weather = { available: true, temp_c, description, icon, is_raining, wind_mph };

        await adminClient.from("weather_cache").upsert(
          { rounded_lat: latR, rounded_lon: lonR, temp_c, is_raining, wind_mph, description, icon, fetched_at: new Date().toISOString() },
          { onConflict: "rounded_lat,rounded_lon" },
        );
      }
    }
  } catch (_e) {
    // Any weather failure: leave weather unavailable and fall through. Tasks are
    // still selected below, just without weather suppression.
  }

  // --- 4. Match tasks -------------------------------------------------------
  // Weather values are passed only when available. A null on any axis means
  // "unknown", and select_tasks never suppresses on an unknown axis.
  const { data: tasks, error: tasksErr } = await userClient.rpc("select_tasks", {
    p_garden_id: gardenId,
    p_month: month,
    p_temp: weather.available ? weather.temp_c : null,
    p_is_raining: weather.available ? weather.is_raining : null,
    p_wind_mph: weather.available ? weather.wind_mph : null,
  });

  if (tasksErr) {
    // Membership was already confirmed, so a failure here is genuinely unexpected.
    return json({ error: "Could not select tasks", detail: tasksErr.message }, 500);
  }

  // --- 5. One payload -------------------------------------------------------
  return json({ weather, tasks: tasks ?? [] });
});
