# Project Specification: "What Gardening Today?"

_This document describes the **v2.0** architecture, in which the live database is Supabase (PostgreSQL) and access is governed by Row-Level Security. It is the single authoritative reference for the system as built. `docs/DESIGN_V2.md` is retained as the point-in-time record of the migration design and rationale; where the two differ, this document is correct._

## 1. VISION & STRATEGY

The "What Gardening Today?" app eliminates cognitive overload and decision paralysis for enthusiastic novice gardeners. Instead of navigating complex canvas designers, tracking layouts, or reading encyclopedias, the entire application behaviour is driven by a single core interface interaction: tapping a button to answer, "What gardening should I do today?"

### Core Principles
* **Action-Oriented:** Delivers immediate, hyper-localized, and time-appropriate tasks.
* **Novice-Friendly:** Strips away technical botanical jargon in favour of bite-sized, actionable guidance.
* **Low-Cost, Open Infrastructure:** Runs on free tiers of open, standard technologies (PostgreSQL, static hosting). The data is held in standard SQL rather than a proprietary store, so the curated content — the genuine asset — is never trapped in a format only one vendor can read.

---

## 2. COMPONENT ARCHITECTURE

The system is a Progressive Web App (PWA) backed by a hosted PostgreSQL database. There are two distinct planes: the **runtime** (what a user's app talks to) and the **content pipeline** (how curated horticultural data reaches the runtime).

### Runtime

* **Database (Supabase / PostgreSQL):** The live relational store and the home of the application's core logic. It holds every table (§3) and the two functions that do the real work: `select_tasks` (the one matching engine) and `create_garden` (first-run provisioning). Access is not mediated by a bespoke API server; instead the database itself enforces who may see and change what, through Row-Level Security.
* **Access model (Row-Level Security):** Every table has RLS enabled. A signed-in user may read the shared catalogue (categories, blueprints, collections, global tasks) but may only read and write the rows belonging to a garden they are a member of. The `weather_cache` table is reachable only by the service role, never by a user. This replaces the v1 arrangement where a single Apps Script deployment was the only thing standing between the client and an otherwise wide-open sheet.
* **Daily view (`today` Edge Function):** One server-side function, called with a garden id, returns the day's weather and filtered task list in a single payload. It exists because two things must happen server-side: the OpenWeather API key must never reach the browser, and the garden's coordinates must be read from the database rather than trusted from the client. It fetches weather through a short-lived shared cache, calls `select_tasks`, and returns `{ weather, tasks }`. If anything about weather fails it still returns the tasks — just unfiltered by weather — and marks the weather unavailable. It replaces the v1 `get_all` / `get_tasks` / `get_weather` routes.
* **Authentication (Supabase Auth):** Sign-in is by email — a one-time code or magic link, no passwords. Public sign-up is disabled: an account exists only when its email has been added from the dashboard, which is the "guest list" that keeps the app private. A user's identity is what RLS keys off to decide which garden's data they may touch.
* **Frontend (GitHub Pages Static Host):** Vanilla HTML5, CSS3, and JavaScript (`index.html`, `style.css`, `app.js`) with a Service Worker (`sw.js`) and Web App Manifest (`manifest.json`) to run as a standalone iOS/Android PWA. It talks to Supabase directly via the `supabase-js` client for ordinary reads and writes, and calls the `today` function for the daily view. PWA icon and favicon assets live under `assets/icons/`.

### Content pipeline

The curated horticultural content is still authored in a **Google Sheet**, which remains the editing surface because it is a comfortable place to write and review hundreds of blueprints and tasks. The Sheet is no longer the runtime database; it is the source from which the runtime is published.

* **Data Audit (Apps Script, `Audit.gs`):** A read-only integrity check over the authored content, exposed as a **Garden Data → Run Audit** menu. It exists because this data fails silently — a task targeting something that does not exist raises no error, it simply never appears — and the audit turns that class of silent failure into a visible list. It never modifies data.
* **Publish (Apps Script, `Publish.gs`):** Pushes the audited Sheet content into the Postgres catalogue and task tables (categories, blueprints, collections and their memberships, tasks and their targets), reconciling the live database to match the Sheet. Retirement is handled by stamping `retired_at`, never by deleting rows a completion might reference.

The frontend never touches the Sheet, and users never touch the pipeline. Authoring and verification steps are documented in `docs/DATABASE_WORKFLOW.md`.

---

## 3. DATABASE SCHEMA (PostgreSQL)

Every table lives in the `public` schema with RLS enabled. Keys are real database keys (integer identities and UUIDs), and relationships are real foreign keys. This is the single most important change from v1: **relationships between items are declared as rows and columns, never inferred from the text of an identifier.** The "smart key" antipattern that caused the v1 matching defects is not merely discouraged now — it is structurally impossible, because nothing at runtime parses an id to decide what it relates to.

Legacy v1 identifiers survive only as parity columns (`legacy_code` on blueprints, tasks and collections; `legacy_asset_id` on garden items). They let a migrated row be traced back to its Sheet origin and are never read by the matching logic.

### The targeting model

A task applies to a garden item through exactly one of two kinds of target:

1. **A specific blueprint** — "this task is for Tomato." (`task_target.blueprint_id`)
2. **A collection** — "this task is for every item in this named set," e.g. `GROUP_SOFT_FRUIT` or `GROUP_SHRUB_GENERIC`. (`task_target.collection_id`)

There is no third "category" kind. In v1 a task could target a bare category prefix (e.g. `LAWN`), which swept in every item under that prefix — including specialist types the task might harm. That tier was **removed** in the migration: its safe tasks were re-homed into explicit "whole category" collections (`GROUP_ALL_BEDS`, `GROUP_SHRUB_GENERIC`, `GROUP_TREE_GENERIC`, `GROUP_HERBS`, `GROUP_HAND_TOOLS`), and its unsafe ones were retired. "Applies to all shrubs" is therefore a curated, inspectable set of blueprint rows, not a spelling coincidence. Prefixes were used **once**, during migration, to seed those collections' membership; from then on membership is explicit rows in `collection_member`.

A `task_target` row is constrained to reference exactly one of `blueprint_id` or `collection_id` — never both, never neither.

### Identity & access

**`garden`** — one row per physical garden.
* `id` (uuid, PK), `name`, `latitude`, `longitude`, `timezone` (default `Europe/London`), `created_at`.
* Coordinates and timezone are the garden's own; the daily view reads them here rather than from the device, so the answer is correct even when the user opens the app away from home.

**`garden_member`** — who may access a garden, and in what role.
* `garden_id` (uuid → `garden`), `user_id` (uuid → `auth.users`), `role` (`owner` | `member`), `added_at`. PK (`garden_id`, `user_id`).
* This table is the linchpin of the access model. RLS on every per-garden table asks "is the current user a member of this garden?" by consulting it. It is also what makes multi-user support structural rather than aspirational (§5E).

### Catalogue (global blueprints)

**`category`** — the display groupings.
* `id` (smallint, PK), `name` (unique), `sort_order`.
* The seven values: Lawn, Beds, Trees & shrubs, Plants & flowers, Veg & herbs, Garden structures, Tools.

**`blueprint`** — the global catalogue of item types, one row per real-world item.
* `id` (integer, PK), `name` (unique), `legacy_code` (parity), `retired_at`.
* **One blueprint per real-world item** — the same plant never appears twice. Where an item legitimately belongs under more than one tile, that is expressed by multiple `blueprint_category` rows, not a duplicate blueprint.

**`blueprint_category`** — which tiles a blueprint appears under (many-to-many).
* `blueprint_id`, `category_id`. PK (both). Rose appearing under both "Plants & flowers" and "Trees & shrubs" is two rows here.

**`collection`** — a named, explicitly-membered set of blueprints that tasks can target.
* `id` (integer, PK), `code` (unique, e.g. `GROUP_SOFT_FRUIT`), `name`.
* Collections carry both the old semantic groups (soft fruit, brassicas, tender bulbs) and the "whole category" sets that replaced the bare-category tier.

**`collection_member`** — membership of a collection (many-to-many).
* `collection_id`, `blueprint_id`. PK (both).

### Tasks (the global engine)

**`task`** — the rules and care instructions.
* `id` (integer, PK), `legacy_code` (parity, e.g. `TASK_0123`), `garden_id` (null for global/shared tasks; set only for future garden-specific manual tasks), `garden_item_id` (reserved for future manual tasks), `name`, `instruction`, `category_id` (→ `category`, for display), `valid_months` (`smallint[]`, the months the task may occur), `frequency_days` (cooldown; null only permitted for manual one-offs), `suppress_if_raining`, `suppress_if_temp_below` (°C), `suppress_if_wind_above` (mph — the task is **hidden when wind exceeds** this, the correct direction), `estimated_minutes`, `retired_at`, `created_at`.
* Constraints enforce what were previously conventions: a shared task must be categorised and must have a cooldown; `valid_months` must be non-empty and every element in 1–12; `estimated_minutes` and `frequency_days` must be positive. A malformed task is a rejected write, not a silent runtime anomaly.
* **Category-tier safety rule (still in force, now structural).** A task targeting a collection must be correct for *every* member of that collection. The difference from v1 is that "every member" is now an explicit, inspectable list, so the blast radius of a task is always knowable.

**`task_target`** — what each task applies to.
* `id` (PK), `task_id` (→ `task`), `collection_id` (nullable), `blueprint_id` (nullable), with a check that exactly one of the two is set. A task may have several targets (several rows).

### Per-garden state

**`garden_item`** — the items actually present in a garden (replaces v1 `User_Profile`).
* `id` (integer, PK), `garden_id`, `blueprint_id` (→ `blueprint`), `friendly_name` (optional user reference), `legacy_asset_id` (parity), `legacy_category` (the category tile the item was added under; used to group the inventory display), `added_at`, `removed_at` (soft delete — a removed item keeps its row but generates no tasks and is hidden from the list).

**`task_completion`** — append-only record of completed tasks (replaces v1 `Task_Log`).
* `id` (PK), `garden_id`, `task_id` (→ `task`), `completed_at` (timestamptz), `notes`.
* Completion is what drives cooldown: a task reappears only once `completed_at + frequency_days` has passed. Because the timestamp is a real `timestamptz`, the v1 British-Summer-Time date bug cannot recur.

**`hidden_task`** — tasks the user has chosen never to see, reversibly (replaces v1 `Hidden_Tasks`).
* `garden_id`, `task_id` (→ `task`), `hidden_at`. PK (`garden_id`, `task_id`), which makes hiding idempotent by construction. Checked first in `select_tasks`, so a hidden task is excluded before any other filter is evaluated.

### Infrastructure

**`weather_cache`** — a short-lived, shared cache of current weather by rounded location.
* `rounded_lat`, `rounded_lon` (PK), `temp_c`, `is_raining`, `wind_mph`, `description`, `icon`, `fetched_at`.
* Coordinates are rounded (to ~0.1°) so nearby gardens share one reading and one API call. A row is reused while it is fresh (see `docs/CONFIG_ITEMS.md` for the freshness window and rounding). RLS grants no user access at all; only the `today` function, running as the service role, reads and writes it.

---

## 4. DATA ACCESS & FUNCTIONS

There is no bespoke REST API. The client reaches the backend three ways: the `today` function for the daily view, direct RLS-governed table operations for everything else, and two database functions for the operations that need server-side logic.

### The `today` Edge Function
* **Input:** the caller's session (as the `Authorization` header) and a JSON body `{ garden_id }`. An optional `month` may be supplied; when omitted, the month is computed in the garden's own timezone.
* **Does:** verifies the caller is a member of the garden (by reading the garden row under RLS); reads the garden's coordinates; gets current weather via `weather_cache`, falling back to a live OpenWeather call (key held as a function secret) that it then caches; calls `select_tasks` with the month and weather; returns `{ weather, tasks }`.
* **Degrades gracefully:** any weather failure yields `weather.available = false` and an unfiltered task list, never an error screen.

### Direct table operations (via `supabase-js`, under RLS)
* **Read the catalogue** — `category`, `blueprint`, `blueprint_category` — to populate the "Add to My Garden" picker. Readable by any signed-in user.
* **Read inventory** — active `garden_item` rows (those with no `removed_at`) for the current garden, joined to `blueprint` for the display name.
* **Add an item** — insert a `garden_item` row (garden, blueprint, optional friendly name, and the chosen tile recorded in `legacy_category`).
* **Remove an item** — set `removed_at` (soft delete).
* **Complete a task** — insert a `task_completion` row.
* **Hide / unhide a task** — insert / delete a `hidden_task` row.
* **Manage hidden tasks** — read the garden's `hidden_task` rows joined to `task` for live names and categories, powering the settings list.

Every one of these is permitted only for a garden the user belongs to; RLS refuses anything else regardless of what the client asks for.

### Database functions
* **`create_garden(p_name, p_latitude, p_longitude, p_timezone = 'Europe/London')` → uuid.** First-run provisioning: creates the garden and records the caller as its `owner` in one step, then returns the new id. The only way a garden is ever born.
* **`select_tasks(p_garden_id, p_month, p_temp, p_is_raining, p_wind_mph)` → set of due tasks.** The single matching engine. For the given garden it: confirms membership; excludes hidden tasks; matches tasks whose targets (blueprint or collection) cover the garden's items; applies the season filter against `valid_months`; applies cooldown using `task_completion` and `frequency_days`; and applies weather suppression — rain, low temperature, and high wind — skipping any axis whose reading is unknown (`null`), so unknown weather never suppresses. Returns `task_id`, `legacy_code`, `name`, `instruction`, `category`, `estimated_minutes`, `frequency_days`. It runs `security definer` with a pinned, empty `search_path`, and it is the *only* place matching logic lives — there is no second copy to drift out of sync.
* **`keepalive()`** — an operational function used only by the scheduled free-tier keep-alive ping (§5E). It returns a trivial value and touches no user data; it is not part of any user-facing flow.

### Sign-in flow
* The client requests a one-time email (`signInWithOtp`, with account auto-creation disabled). Depending on the email template, the message carries a 6-digit code (entered via `verifyOtp`) and/or a magic link (which returns to the app and establishes the session on arrival). The app supports both; which one is delivered is a dashboard setting (`docs/CONFIG_ITEMS.md`).

---

## 5. ARCHITECTURAL PRINCIPLES & KNOWN LIMITATIONS

### A. Data Architecture

* **Blueprints, not instances.** The catalogue holds only generic, universally applicable data. A user's specific garden lives in `garden_item` and the other per-garden tables.
* **One blueprint per real-world item.** Where an item belongs in two places, that is a second `blueprint_category` (or `collection_member`) row, never a duplicate blueprint.
* **Relationships are declared, not derived.** Groupings, families, and shared care needs are rows in `collection` / `collection_member` and `task_target`. Nothing at runtime infers a relationship from the internal structure of an identifier. This was the root cause of the v1 matching defects and is now enforced by the schema itself.
* **The database owns the rules.** Matching, cooldown, season and weather suppression live in `select_tasks`, and integrity lives in table constraints. The frontend renders; it does not re-implement the rules.

### B. Separation of Concerns

* **Database (Postgres + RLS):** storage, access control, and the matching/provisioning functions.
* **Edge Function (`today`):** the one piece of server-side glue — the secure weather proxy and the daily-payload assembler.
* **Frontend (PWA):** authentication UI, state, view rendering. UI design elements never come from the data layer.

### C. Development & Error Handling

* **Fail gracefully.** If an external resource fails, the app disables the affected part and shows a clear, friendly message rather than crashing — the `today` function's weather fallback is the canonical example.
* **Iterative commits.** GitHub changes represent single, testable features or fixes, to keep rollback straightforward.
* **Service-worker cache versioning.** `sw.js` uses a network-first strategy and a versioned `CACHE_NAME`. Every deploy that changes a cached frontend file must bump the version string (e.g. `gardening-v4` → `gardening-v5`); this clears stale caches on activation so fixes actually reach installed PWAs. The service worker only ever caches our own same-origin files — Supabase, OpenWeather and postcode calls always go to the network, never cached.

### D. AI Collaboration Workflow

1. **Primary workspace continuity.** The current conversation is the primary workspace across design discussions, bug fixes, and feature additions. A new conversation is not recommended as routine practice — only when (a) context is clearly being lost, (b) a largely independent workstream is starting, or (c) the developer asks. If one is recommended, the reason is given first.
2. **Design before implementation.** Finalise the design, then recommend the most appropriate model and reasoning effort. Implementation continues in the current conversation regardless of that recommendation, unless a workflow exception applies.
3. **Complete files, not snippets.** Every changed file is delivered in full, unless a diff is specifically requested.
4. **Documentation review.** After a change, review whether `SPEC.md` and `CHANGELOG.md` should be updated; explain what should change and confirm before editing either.
5. **Plain-English communication.** Design choices are explained in terms of what the developer would see or experience; test steps are written as actions a non-developer could follow.
6. **Content authoring.** Blueprints and tasks are authored in the Sheet and published to Postgres via the pipeline (§2), following `docs/DATABASE_WORKFLOW.md`.
7. **Quality assurance.** Run the audit (**Garden Data → Run Audit**) before publishing after any content change. Structural correctness is the audit's job; horticultural correctness is covered separately by the editorial review in `docs/DATABASE_WORKFLOW.md`, applied by hand.

### E. Known Limitations

Documented so they aren't lost between sessions.

**Resolved by v2.0** (recorded here so the history is clear; see CHANGELOG 2.0):
* The v1 hardcoded-weather problem and the widget-vs-filter disagreement are gone — weather is taken at the garden's own stored coordinates, and the widget and the filter are fed from the same reading.
* Wind suppression is corrected: a task is hidden when wind is *above* its threshold.
* The two drifted data-fetch paths are gone — there is one daily call (`today`), re-run on return to the Today view, so weather-suppressed tasks cannot briefly reappear.
* The British-Summer-Time completion-date bug is gone — day maths is timezone-aware and completions are stored as `timestamptz`.
* Legacy two-digit asset-id suffixes are moot — display names come from the joined blueprint, not from parsing an id.

**Carried forward:**
* **`task_completion` grows unbounded.** No archiving yet. Harmless at current scale; revisit before it affects response times.
* **Fuchsia and Heather remain catalogued as generic plants.** Both are woody but are grown in pots where generic plant care (watering, feeding) is what they need; moving them would trade that for shrub tasks of little relevance. A deliberate cataloguing exception.
* **Content gaps.** Some blueprints have no tasks and no fallback: the structures `Planter box`, `Pergola`, `Cold frame`, `Arch`, `Pond`, and `Lavender`. A user adding one currently sees nothing for it. This is a content gap, not an engine fault — the matcher offers no way to detect it, so new blueprints must be checked by hand. (There is also a historical duplicate `legacy_code` `TASK_0262` from the Sheet to renumber at source; it has no runtime effect, as tasks key on their real `id`.)

**New in v2.0:**
* **Built-in email reaches only the owner's address, and is rate-limited.** Supabase's default email will not reliably deliver to other people and sends only a couple per hour. Inviting friends is therefore gated behind configuring custom email (e.g. an SMTP provider). Single-user operation is unaffected.
* **The free tier pauses after ~7 idle days** — mitigated by a scheduled keep-alive: a GitHub Action pings a `keepalive()` function twice a week (Mondays and Thursdays), keeping the longest quiet gap to four days. Without that ping the database would pause during quiet spells. Cadence and mechanism are recorded in `docs/CONFIG_ITEMS.md`.
* **Sign-in links and installed PWAs (iOS).** A magic *link* opened from a home-screen-installed app can open in the browser instead of the app. Using the emailed *code* avoids this; the app supports both.
* **Multi-user is structural but not yet operational.** Gardens, membership, and RLS already support more than one user and more than one garden; what is missing is the operational plumbing (custom email, an invite flow, a garden switcher). See §6.

---

## 6. DEVELOPMENT ROADMAP

* **Phase 1 (COMPLETE):** Operational single-button PWA returning basic daily tasks.
* **Phase 2 (COMPLETE):** Stateful interactivity — completion writes and cooldown suppression.
* **Phase 2.1 (COMPLETE):** Dynamic inventory management — the "My Garden" tab, picker, and soft-delete flow.
* **Phase 3 (COMPLETE):** Environmental integration — weather-filtered tasks via a secure weather proxy.
* **Phase 3.1 (COMPLETE):** Task dismissal — swipe-to-hide with undo, and a settings screen to restore hidden tasks.
* **Phase 4 (COMPLETE):** Cross-platform scale. The database has been migrated from Google Sheets to Supabase PostgreSQL; the matching engine is now the `select_tasks` database function; email authentication and per-garden Row-Level Security are in place; the frontend has sign-in and first-run garden setup; and the production app went live on the new stack on 2026-07-17, with a scheduled keep-alive keeping the free-tier database warm. Two small operational tidies trail behind it: confirming the old weather key was never committed publicly (rotating only if it was), and retiring the now-unused Apps Script *runtime* deployment (the content-publish pipeline stays). A native rewrite (Flutter / SwiftUI) was considered and is **not** being pursued — the PWA remains the delivery vehicle.
* **On the horizon (post-cutover):** custom email so friends can be invited; an invite flow and a garden switcher to make multi-user real; surfacing `estimated_minutes` in the UI; and the pre-existing hide-swipe placement/direction improvement (tracked separately from the v2.0 work).
