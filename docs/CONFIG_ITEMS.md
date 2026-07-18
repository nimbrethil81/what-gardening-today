# Configuration items — What Gardening Today?

A living register of values and design choices that are currently fixed in code or
in the Supabase dashboard, but that we might reasonably want to revisit later. The
point is so that when a number or a behaviour needs changing, we know *what* it is,
*where* it lives, and *why* it was set the way it was — without re-deriving it.

This file is a convenience index, **not** an authoritative spec. `SPEC.md` remains
the source of truth for architecture and schema; this just gathers the dials in one
place. It is expected to grow as v2 is built out.

_Last updated: Stage 3, ahead of the frontend build._

---

## Product / behaviour settings

| # | Item | Current setting | Where it lives | Why / trade-off |
|---|------|-----------------|----------------|-----------------|
| 1 | Weather cache freshness | 30 minutes | `today` Edge Function — `CACHE_TTL_MINUTES` | How long a weather reading is reused before a fresh call. Longer = fewer API calls, but the widget and the task filtering go staler. Not near any API limit today, so 30 min favours freshness. |
| 2 | Weather cache location grouping | ~0.1° (≈11 km), i.e. 1 decimal place | `today` Edge Function — `COORD_ROUNDING_DP` | How coarsely nearby gardens share one weather fetch. Finer = more per-spot accuracy, more calls; coarser = fewer calls, neighbours may share slightly-off weather. Weather rules are coarse, so 0.1° is ample. |
| 3 | Sign-in delivery | Emailed 6-digit code (not a tap-link) | Supabase Auth email template + the sign-in screen | Code typed into the app signs you in *in the app*, avoiding the installed-PWA "wrong window" problem with tap-links. Can switch to a link, or send both. |
| 4 | "Email not invited" message | Friendly / specific ("not on the guest list") | Sign-in screen copy | Clear for a small circle of known friends. The neutral alternative gives away less about who has an account. |
| 5 | Location entry — primary method | Postcode (via postcodes.io); "use my current location" offered as the secondary option | Garden-setup screen | Postcode always works with no permission prompt. Either method is plenty precise given the 0.1° weather rounding. |
| 6 | Location confirmation | On — shows e.g. "📍 Amersham, Buckinghamshire" after a location resolves | Garden-setup screen | Reassures the user the location landed on the right area before they commit. |
| 7 | Inventory grouping source | `garden_item.legacy_category` (the tile the item was added under) | Frontend inventory read; also written on every new add | Keeps grouping identical to today for migrated items, and uniform for new ones. NB this reads a column the Stage 1 schema comments as "never read by v2" — a conscious repurposing to record in the SPEC rewrite. |
| 8 | Garden timezone | `Europe/London` | `create_garden` default; `garden.timezone` | The app is UK-only and fixed-location. Would only matter if a non-UK garden were ever created. |
| 9 | Post-write refresh model | Re-fetch the affected view after each write (complete / hide / add / remove) | Frontend | Screen always reflects the true database state; avoids UI/DB drift. Optimistic instant-updates could be layered on later for extra snappiness. |

## Operational / platform notes

| # | Item | Current setting | Where it lives | Why / trade-off |
|---|------|-----------------|----------------|-----------------|
| 10 | Free-tier keep-alive | Implemented: twice-weekly ping (Mon & Thu) | GitHub Action `keepalive.yml` → `keepalive()` RPC | Supabase free-tier projects pause after ~7 days with no database activity; Mon/Thu keeps the longest gap at 4 days. Change the `cron` line in the workflow to adjust cadence. |
| 11 | Service-worker cache version | `CACHE_NAME` string in `sw.js` | `sw.js` | Must be bumped on any deploy that changes a cached file, or installed PWAs won't pick up the update. |
| 12 | Allowed browser origins (function) | `https://nimbrethil81.github.io` (+ localhost for testing) | `today` Edge Function — `ALLOWED_ORIGINS` | The origins permitted to call the function. Add an entry if the app is ever served from another address. |
| 13 | OpenWeather endpoint | 2.5 "current weather", metric units | `today` Edge Function | Matches the proven 1.x call. OpenWeather has been steering new usage toward newer endpoints; worth a check if the key is ever re-issued on a new plan. |
| 14 | Supabase env-var names (function) | Legacy `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` (auto-provided) | `today` Edge Function | These legacy names are slated to deprecate at the end of 2026 in favour of the publishable/secret-key scheme — a small future swap. |
