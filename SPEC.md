# Project Specification: "What Gardening Today?"

_This document describes the **v2.0** architecture, in which the live database is Supabase (PostgreSQL) and access is governed by Row-Level Security. It is the single authoritative reference for the system as built. `docs/DESIGN_V2.md` is retained as the point-in-time record of the migration design and rationale; where the two differ, this document is correct._

## Contents

1. [VISION & STRATEGY](#1-vision--strategy)
2. [COMPONENT ARCHITECTURE](#2-component-architecture)
3. [DATABASE SCHEMA (PostgreSQL)](#3-database-schema-postgresql)
4. [DATA ACCESS & FUNCTIONS](#4-data-access--functions)
5. [ARCHITECTURAL PRINCIPLES & KNOWN LIMITATIONS](#5-architectural-principles--known-limitations)
6. [DEVELOPMENT ROADMAP](#6-development-roadmap)

---

## 1. VISION & STRATEGY

The "What Gardening Today?" app eliminates cognitive overload and decision paralysis for enthusiastic novice gardeners. Instead of navigating complex canvas designers, tracking layouts, or reading encyclopedias, the entire application behaviour is driven by a single core interface interaction: tapping a button to answer, "What gardening should I do today?"

### Core Principles
* **Action-Oriented:** Delivers immediate, hyper-localized, and time-appropriate tasks.
* **Novice-Friendly:** Strips away technical botanical jargon in favour of bite-sized, actionable guidance.
* **Low-Cost, Open Infrastructure:** Runs on free tiers of open, standard technologies (PostgreSQL, static hosting). The data is held in standard SQL rather than a proprietary store, so the curated content — the genuine asset — is never trapped in a format only one vendor can read.
* **Horticultural advice is never gated.** Whatever is in a garden, the app answers fully for it. A free tier that withheld care instructions for a plant somebody is actually growing would be both a product failure and a safety one, because a novice cannot second-guess what they are told. Anything sold is convenience, ambience or record-keeping — never the answer to "what should I do today?"

---

## 2. COMPONENT ARCHITECTURE

The system is a Progressive Web App (PWA) backed by a hosted PostgreSQL database. There are two distinct planes: the **runtime** (what a user's app talks to) and the **content pipeline** (how curated horticultural data reaches the runtime).

### Runtime

* **Database (Supabase / PostgreSQL):** The live relational store and the home of the application's core logic. It holds every table (§3) and the functions that do the real work: `select_tasks` (the one matching engine), `create_garden` (provisioning), and the pair that resolve a garden's fate when somebody leaves or deletes it. Access is not mediated by a bespoke API server; instead the database itself enforces who may see and change what, through Row-Level Security.
* **Access model (Row-Level Security):** Every table has RLS enabled. A signed-in user may read the shared catalogue (categories, blueprints, collections, global tasks) but may only read and write the rows belonging to a garden they are a member of. The `weather_cache` table is reachable only by the service role, never by a user. This replaces the v1 arrangement where a single Apps Script deployment was the only thing standing between the client and an otherwise wide-open sheet.
* **Daily view (`today` Edge Function):** One server-side function, called with a garden id, returns the day's weather and filtered task list in a single payload. It exists because two things must happen server-side: the OpenWeather API key must never reach the browser, and the garden's coordinates must be read from the database rather than trusted from the client. It fetches weather through a short-lived shared cache, calls `select_tasks`, and returns `{ weather, tasks }`. If anything about weather fails it still returns the tasks — just unfiltered by weather — and marks the weather unavailable. It replaces the v1 `get_all` / `get_tasks` / `get_weather` routes.
* **Authentication (Supabase Auth):** Sign-in is via Google (OAuth) as the primary method, with a passwordless email code kept as a fallback; there are no passwords. Public sign-up is disabled: an account exists only when its email has been added from the dashboard, which is the "guest list" that keeps the app private — and it applies to every method, so a Google sign-in from an un-added email is refused. A user's identity is what RLS keys off to decide which garden's data they may touch.
* **Frontend (GitHub Pages Static Host):** Vanilla HTML5, CSS3, and JavaScript (`index.html`, `style.css`, `app.js`) with a Service Worker (`sw.js`) and Web App Manifest (`manifest.json`) to run as a standalone iOS/Android PWA. It talks to Supabase directly via the `supabase-js` client for ordinary reads and writes, and calls the `today` function for the daily view. PWA icon and favicon assets live under `assets/icons/`.

### Content pipeline

The curated horticultural content is still authored in a **Google Sheet**, which remains the editing surface because it is a comfortable place to write and review hundreds of blueprints and tasks. The Sheet is no longer the runtime database; it is the source from which the runtime is published.

* **Data Audit (Apps Script, `Audit.gs`):** A read-only integrity check over the authored content, exposed as a **Garden Data → Run Audit** menu. It exists because this data fails silently — a task targeting something that does not exist raises no error, it simply never appears — and the audit turns that class of silent failure into a visible list. It never modifies data, and judges everything from the workbook alone. It is also the project's single menu builder: the review and publish menu items are declared here, and their handlers resolve at click time from the other files.
* **Review programme (Apps Script, `Review.gs`, `TimingReview.gs` and `InteractionReview.gs`):** The two automated halves of the human content reviews — assembling the packet a reviewer works from, and transcribing back the findings the developer accepts. `Review.gs` holds the editorial review (correctness, safety, collection blast radius) and the shared applier; `TimingReview.gs` holds the timing review, a narrower pass asking only whether a long-cooldown task's window opens in a month the job can reliably be done; `InteractionReview.gs` holds the interaction review, which judges not one task but what a user sees when several individually correct tasks arrive in the same month in the same garden. All three are review *modes* over one applier rather than three implementations, so the authoring rules are enforced once and each mode declares only what differs — its decisions tab, its marker column, and the fields it is allowed to write. None of them reviews or decides anything: nothing reaches the task matrix that has not been ticked by hand, and a dry run shows every before-and-after first.
* **Publish (Apps Script, `Publish.gs`):** Pushes the audited Sheet content into the Postgres catalogue and task tables (categories, browse groups, blueprints, collections and their memberships, tasks and their targets), reconciling the live database to match the Sheet. Retirement is handled by stamping `retired_at`, never by deleting rows a completion might reference. Its post-publish report also carries the two integrity questions that can only be answered against live data — whether a retired blueprint is still in somebody's garden, and whether an item somebody owns receives no tasks — aggregated to blueprint level so no garden, user or personal reference is ever named.

* **Maintenance utility (Apps Script, `Normalise.gs`):** rewrites `Valid_Months` into the canonical season order across the whole matrix (`docs/DATABASE_WORKFLOW.md` §9), using the same shared implementation as the audit and the applier. It is the **third** thing that can write to the task matrix, and the only one that writes without a human ticking each row — which is a deliberate exception to the "apply nothing automatically" rule rather than an erosion of it. That rule governs *judgements*, and this is not one: the only value it can put in a cell is a reordering of the months already there, and matching treats the list as a set, so the months a task fires in provably cannot change. It runs dry first, verifies what landed rather than assuming, and records every before-and-after in `Review_Log`. Any future utility wanting the same licence should have to make the same argument.

The review programme's bookkeeping columns and tabs are deliberately invisible to the pipeline: `Publish.gs` reads the task matrix by fixed column index 0–11 and the item dictionary by index 0–5, so the three review-state columns beyond those points cannot reach the database or affect a user, and the tabs the programmes declare their own units on — review passes, and the plausible gardens the interaction review is run against — are read by nothing else. The safest bookmark is one the pipeline cannot see.

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
* This table is the linchpin of the access model. RLS on every per-garden table asks "is the current user a member of this garden?" by consulting it.
* Being many-to-many, it carries both halves of "more than one": **one person tending several gardens** is several rows and one user — operational since 2.12, and the reason `create_garden` was written permissive about a second garden long before there was a switcher — and **several people sharing one garden** is several rows and one garden, which is structural but awaits an invite flow (§5E).
* **Its delete policy is the guard on two impossible states.** An owner may remove an ordinary member, but may not remove themselves (that is `leave_garden`'s job, because leaving has to decide the garden's fate in the same breath) and may not remove an owner row at all. Without those two clauses the Data API can produce a garden with nobody in it, or — with no exit whatsoever, since nothing promotes anybody outside the two functions that hand a garden over — a garden with members and no owner.

### Catalogue (global blueprints)

**`category`** — the display groupings.
* `id` (smallint, PK), `name` (unique), `sort_order`.
* The seven values: Lawn, Beds, Trees & shrubs, Plants & flowers, Veg & herbs, Garden structures, Tools.

**`browse_group`** — the headings the picker clusters blueprints under.
* `id` (smallint, PK), `name` (unique), `sort_order`.
* **Display-only, and deliberately not a collection.** A browse group decides where a blueprint appears on the "Add to My Garden" screen and nothing else. It is unreachable from `select_tasks` and can never be a task target — the two concepts live in separate tables precisely so that reorganising how the catalogue is *browsed* can never alter what a garden item *receives* (§2a of `docs/DATABASE_WORKFLOW.md`).
* `sort_order` is authored in gaps of ten, so a new heading can be slotted between two existing ones without renumbering.
* Upsert-only, following the `collection` precedent: publishing never deletes one, because a blueprint may still reference it.

**`blueprint`** — the global catalogue of item types, one row per real-world item.
* `id` (integer, PK), `name` (unique), `legacy_code` (parity), `browse_group_id` (nullable → `browse_group`), `botanical_name` (nullable), `retired_at`.
* **One blueprint per real-world item** — the same plant never appears twice. Where an item legitimately belongs under more than one tile, that is expressed by multiple `blueprint_category` rows, not a duplicate blueprint.
* `browse_group_id` null is normal and safe: the picker shows those blueprints under an "Other" heading rather than hiding them, and a category where nothing has been assigned renders as a plain unheaded list.
* `botanical_name` is authored only where the common name is genuinely ambiguous — Geranium, Bluebell, Laurel — and is null for most rows. A blank-but-present value is rejected by a check constraint, since it would render as empty brackets.

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

**`garden_day`** — one row per garden per day the app was opened, with a count of opens.
* `garden_id`, `day` (date), `opens` (integer). PK (`garden_id`, `day`).
* `task_completion` records what a garden *did*; this records that somebody *looked*. The difference is the whole point: an open that produced no completion is the churn signal, and it is the one measurement that cannot be taken retrospectively — which is why the table exists before anything depends on it.
* `day` is resolved in the **garden's own timezone**, not UTC, by `record_garden_day()` — the same rule `select_tasks` applies to cooldown, so an open late on a summer evening belongs to that evening.
* Written only by the `today` function as the service role. Like `weather_cache`, RLS is enabled with **no policies at all** and no user grant, so a user can neither read it nor inflate their own activity. The scheduled keep-alive calls `keepalive()`, never `today`, so pings never appear here as phantom activity.
* Deleting a garden cascades its rows away. Growth is bounded at 365 rows per garden per year and adds nothing to Supabase's MAU billing, which counts users rather than rows.

### Entitlement (dormant)

Installed empty and inert: no products exist, no entitlements exist, every blueprint is core, and the picker behaves exactly as it did before. It is here because retrofitting it later would mean one migration touching every blueprint, the picker and the add path at once, whereas installing it dormant costs nothing and changes nothing.

**`product`** — the things that can be owned.
* `id` (PK), `code` (unique, authored, e.g. `PACK_HOUSE_PLANTS`), `name`, `kind` (`pack` | `feature`), `retired_at`, `created_at`.
* A `pack` unlocks a set of blueprints; a `feature` unlocks an app capability. One table because they share the same ownership plumbing. Retired, never deleted. Prices are **not** held here: the App Store and Play Console are the merchants of record.
* Carries a redundant `UNIQUE (id, kind)` for the same reason `garden_item` carries `UNIQUE (id, garden_id)` — to let another table point at "this row, *and* this fact about it".

**`pack_member`** — which blueprints each pack contains.
* `product_id`, `product_kind` (pinned to `pack` by check constraint), `blueprint_id`. PK (`product_id`, `blueprint_id`).
* A composite foreign key `(product_id, product_kind)` → `product (id, kind)` makes a `feature` product with blueprint members **unrepresentable**, not merely discouraged.
* A blueprint may appear in several packs; owning any one of them is enough. **A blueprint in no live pack is core**, which is why installing this table required no migration — silence means free.
* Deliberately *not* a `pack_id` column on `blueprint`: a column would force one pack per plant forever, and two representations of the same fact could drift apart. Same shape as `collection_member`.

**`entitlement`** — who owns what.
* `user_id` (→ `auth.users`), `product_id` (→ `product`), `granted_at`, `expires_at` (nullable), `source` (`purchase` | `gift` | `founder` | `test`), `note`. PK (`user_id`, `product_id`), which makes granting idempotent by construction.
* **On the user, not the garden.** Somebody who tends their own garden and a relative's is one person who bought one thing; garden-based entitlement would charge them twice, and they are the most engaged kind of user there is.
* `expires_at` null is perpetual (a one-off purchase — preferred for a seasonal product, because there is nothing to churn in November); a date is a subscription period, or a revocation when set to the past. Revoking never deletes the row.
* Holds current state, not purchase history: renewals and refunds live with the store, which keeps the receipts. Cascades on user deletion.
* A user may read **their own rows only**; `anon` holds no grant at all, so a signed-out caller is refused the table one layer earlier than any policy. Nobody at any level may insert, update or delete — self-granting is impossible at the privilege layer, before a policy is consulted.

---

## 4. DATA ACCESS & FUNCTIONS

There is no bespoke REST API. The client reaches the backend three ways: the `today` function for the daily view, direct RLS-governed table operations for everything else, and two database functions for the operations that need server-side logic.

### The `today` Edge Function
* **Input:** the caller's session (as the `Authorization` header) and a JSON body `{ garden_id }`. An optional `month` may be supplied; when omitted, the month is computed in the garden's own timezone.
* **Does:** verifies the caller is a member of the garden (by reading the garden row under RLS); reads the garden's coordinates; records the open in `garden_day`; gets current weather via `weather_cache`, falling back to a live OpenWeather call (key held as a function secret) that it then caches; calls `select_tasks` with the month and weather; returns `{ weather, tasks }`.
* **Records the open deliberately positioned:** *after* the membership check, so probing another garden's id can never register as activity, and *before* the weather and task work, so an open still counts on a day when OpenWeather is down. The call is wrapped so that no failure of it can ever reach the caller — bookkeeping must not be able to cost somebody their daily view.
* **Degrades gracefully:** any weather failure yields `weather.available = false` and an unfiltered task list, never an error screen.

### Direct table operations (via `supabase-js`, under RLS)
* **Read your gardens** — `garden` ordered oldest-first, plus `garden_member` for your role in each and how many other people are in them. Two reads rather than one join, because the ordering has to be stable (alphabetical would reshuffle the switcher on every rename) and because the membership count is what decides whether deleting a garden is offered, refused, or replaced by leaving. RLS scopes both to gardens you belong to.
* **Rename or relocate a garden** — update `name`, `latitude`, `longitude` on `garden`. Owner-only by policy. A blocked update under RLS changes nothing *silently* rather than raising, so the client re-reads and confirms the change landed instead of reporting a success it has not seen.
* **Read the catalogue** — `category`, `blueprint`, `blueprint_category`, `browse_group` — to populate the "Add to My Garden" picker. Readable by any signed-in user. The picker clusters pills under their browse-group headings in `sort_order`, and shows a blueprint's `botanical_name` inline where one is set.
* **Read inventory** — active `garden_item` rows (those with no `removed_at`) for the current garden, joined to `blueprint` for the display name.
* **Add an item** — insert a `garden_item` row (garden, blueprint, optional friendly name, and the chosen tile recorded in `legacy_category`).
* **Remove an item** — set `removed_at` (soft delete).
* **Complete a task** — insert a `task_completion` row.
* **Hide / unhide a task** — insert / delete a `hidden_task` row.
* **Manage hidden tasks** — read the garden's `hidden_task` rows joined to `task` for live names and categories, powering the settings list.
* **Read what you own** — `entitlement`, `product` and `pack_member`. Entitlement returns your own rows only; the other two are readable by any signed-in user so the picker can tell which items belong to a pack. All three are read-only to users.
* **Leave or delete a garden** — calls to `leave_garden()` / `delete_garden()` (below), after which the client re-routes to whichever garden remains, or to the setup screen if none does.
* **Delete your account** — a call to `delete_my_account()` (below), after which the client clears the stored session locally and reloads.

Every one of these is permitted only for a garden the user belongs to; RLS refuses anything else regardless of what the client asks for.

**Adding an item passes through a database trigger** (`garden_item_guard`, fired `BEFORE INSERT` on `garden_item`) which enforces two unrelated things at the one moment they both apply: a ceiling of 200 active items per garden, and pack entitlement. It lives in the database rather than the frontend because `app.js` and `config.js` are public files served with a published key, so a check that lives only in the browser is decorative. It is skipped when `auth.uid()` is null — the service role, the publish pipeline, an admin fix — and it fires on insert only, so a future "restore a removed item" feature (an update) would need an update branch adding.

The 200 ceiling is **not a paywall**, deliberately. A cap that binds pushes users to leave things out of their inventory to stay under it, and the app is then advising on a garden it can no longer see properly — degrading the recommendations in order to sell a subscription. It is an abuse and performance guard, set far above any real garden and invisible in the UI. The dial is recorded in `docs/CONFIG_ITEMS.md`.

### Database functions
* **`create_garden(p_name, p_latitude, p_longitude, p_timezone = 'Europe/London')` → uuid.** Provisioning: creates the garden and records the caller as its `owner` in one step, then returns the new id. The only way a garden is ever born — which is why direct inserts into `garden` are refused by RLS. It has always been permissive about a second garden by decision; since 2.12 a **ceiling of ten gardens per user** bounds it, counted over membership rather than ownership so it cannot be walked around once sharing exists. Like the 200-item guard it is an abuse guard and not a paywall, set far above any honest use. The dial is recorded in `docs/CONFIG_ITEMS.md`.
* **`select_tasks(p_garden_id, p_month, p_temp, p_is_raining, p_wind_mph)` → set of due tasks.** The single matching engine. For the given garden it: confirms membership; excludes hidden tasks; matches tasks whose targets (blueprint or collection) cover the garden's items; applies the season filter against `valid_months`; applies cooldown using `task_completion` and `frequency_days`; and applies weather suppression — rain, low temperature, and high wind — skipping any axis whose reading is unknown (`null`), so unknown weather never suppresses. Returns `task_id`, `legacy_code`, `name`, `instruction`, `category`, `estimated_minutes`, `frequency_days`. It runs `security definer` with a pinned, empty `search_path`, and it is the *only* place matching logic lives — there is no second copy to drift out of sync.
* **`keepalive()`** — an operational function used only by the scheduled free-tier keep-alive ping (§5E). It returns a trivial value and touches no user data; it is not part of any user-facing flow.
* **`record_garden_day(p_garden_id)`** — records one app-open against the garden, on the calendar day in that garden's own timezone. Called by `today` as the service role; execute is revoked from users. Returns silently on an unknown garden and never raises, because it must not be able to break the daily view.
* **`has_entitlement(p_code)` → boolean.** Does the **caller** hold a live entitlement to this product code? For paid features. A retired product grants nothing, and an expiry in the past grants nothing.
* **`can_add_blueprint(p_blueprint_id)` → boolean.** May the **caller** add this blueprint? True when it is in no live pack, or when they hold a live entitlement to a live pack containing it. Note the retirement rule: **only live packs gate**, so withdrawing a pack from sale *releases* its blueprints back to core rather than stranding them somewhere nobody can reach — the deliberate failure direction, because a stranded plant would put its care advice out of reach too. Asked only when adding; never when reading, matching or advising.
* **`leave_garden(p_garden_id)` → text.** Removes the **caller** from one garden, and resolves what that means for the garden in the same transaction: last member out deletes it and everything below it; a departing sole owner hands it to the longest-standing remaining member (ties broken by user id, so the outcome is deterministic); anybody else simply goes. Returns `garden_deleted` | `handed_over` | `left`. These are character-for-character the rules `delete_my_account` applies, so the two ways out of a garden cannot disagree. **It takes a garden, never a person** — there is no form of it that names who is being removed, so it cannot be aimed at anyone else. Removing *somebody else* is an owner's action and goes through the ordinary `garden_member` policy instead, where the row-level rules can be read in one place.
* **`delete_garden(p_garden_id)`.** Destroys one garden and everything in it, immediately and irreversibly. **Owner only, and refused while anybody else is a member** — a non-owner has no notification channel and would simply find years of their own history gone, so destroying it must require an explicit act against that person first (remove them, or leave it to them). This makes deleting a *garden* stricter than deleting an *account*, which hands shared gardens on; both err in the same direction. **Deleting your last garden is permitted and deliberately unchecked**: zero gardens is a real, handled state — it is where every new user starts — and refusing would build a trap whose only exit was deleting the whole account.
* **`delete_my_account()`.** Deletes the calling user, immediately and irreversibly. Gardens they were the last member of are deleted, cascading items, manual tasks, completions, hidden tasks and activity rows; a garden where they were the **only owner but others remain** is handed to the longest-standing remaining member (ties broken by user id, so the outcome is deterministic); a garden with another owner is left untouched. Then the `auth.users` row is deleted, cascading membership, entitlements, and the auth schema's own identities, sessions and refresh tokens.
  * **It takes no arguments**, which is the security design rather than an omission: with nothing to pass there is nothing to tamper with, and it cannot be aimed at anyone else.
  * **One transaction**, so there is no state in which somebody is half-deleted.
  * **A hard delete, never a soft one.** A soft delete would keep the row and leave the email permanently taken; as built, signing up again with the same email works and produces a genuinely new user with an empty slate.
  * The client must clear the session locally afterwards: the stored token stays technically valid for up to an hour, and an app holding one looks signed in but shows nothing — which reads as "broken", not "signed out".

### Sign-in flow
* **Primary — Google (OAuth).** The client calls `signInWithOAuth({ provider: 'google' })`; the browser completes the Google flow and returns to the app, where `onAuthStateChange` picks up the session. Because the flow is initiated from inside the app, it returns cleanly into an installed iOS PWA (unlike an emailed link, which opens in Safari). Only the basic email/profile scopes are requested, so no Google verification/assessment is required.
* **Fallback — emailed code.** Reachable via "Use email instead": the client requests a one-time email (`signInWithOtp`, with account auto-creation disabled); the message carries a 6-digit code (entered via `verifyOtp`) and/or a magic link. Kept functional but dormant while the app is single-user (built-in email only reliably reaches the owner's own address — see §5E).
* Both methods honour the same invite-only gate; a sign-in from an email that isn't on the guest list is refused regardless of provider.

---

## 5. ARCHITECTURAL PRINCIPLES & KNOWN LIMITATIONS

### A. Data Architecture

* **Blueprints, not instances.** The catalogue holds only generic, universally applicable data. A user's specific garden lives in `garden_item` and the other per-garden tables.
* **One blueprint per real-world item.** Where an item belongs in two places, that is a second `blueprint_category` (or `collection_member`) row, never a duplicate blueprint.
* **Relationships are declared, not derived.** Groupings, families, and shared care needs are rows in `collection` / `collection_member` and `task_target`. Nothing at runtime infers a relationship from the internal structure of an identifier. This was the root cause of the v1 matching defects and is now enforced by the schema itself.
* **The database owns the rules.** Matching, cooldown, season and weather suppression live in `select_tasks`, and integrity lives in table constraints. The frontend renders; it does not re-implement the rules.
* **Entitlement grants the right to *add*, not the right to *see*.** Once an item is in a garden it belongs to the garden: every member sees it, every member gets its tasks, and nothing takes that away — not a lapsed subscription, not a refund, not the entitled member leaving. Only the act of *adding* a pack item asks whether the caller is entitled. This is why the check is a trigger on inserting a `garden_item` and appears nowhere in `select_tasks`, and why two people looking at the same garden can never see different plants.
* **Deleting a person must not delete other people's data.** A garden with members left standing survives its owner's departure and is handed on. Erasure means removing what is the departing person's, not destroying a shared record somebody else still relies on.
* **Nor must deleting a *garden*.** The same principle one level down: a shared garden cannot be deleted at all while anybody else is in it. The owner may remove them first — which is an explicit act, against a named person, that the other party's own data survives — or leave and let them keep it. The destructive path is never the one-tap path when somebody else pays for it.
* **A state with no way out is a design fault, not an edge case.** A garden with members and no owner could never regain one, because nothing in the schema promotes anybody outside the two functions that hand a garden over. States like that are closed off in the policy, declaratively, rather than avoided by the UI — the anon key is published, so "the app never does that" is not a control.

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
7. **Quality assurance.** Run the audit (**Garden Data → Run Audit**) before publishing after any content change. Structural correctness is the audit's job. Horticultural correctness is covered separately by the human review passes documented in `docs/DATABASE_WORKFLOW.md` §7 — the editorial review (is this advice right, and safe for every member of the collection it reaches?), the timing review (does this window open in a month the job can reliably be done?), and the interaction review (what happens when several individually correct tasks arrive in the same month?). All three assemble their material by script and transcribe accepted findings back by script; the judgement in between is always the developer's, and no programme applies anything that has not been ticked by hand one row at a time.

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
* **Multi-user is structural but not yet operational.** Gardens, membership and RLS support more than one user *and* more than one garden. Since 2.12 the multi-*garden* half is operational — one person may hold several gardens and switch between them. The multi-*user* half still is not: what remains missing is custom email and an invite flow, and because adding a member requires knowing their user id with no email lookup, sharing a garden with another person is not reachable from the app. See §6.

**New in 2.11:**
* **No automated backups on the free tier, and account deletion is irreversible.** There is no grace period and nothing to restore from. Curated content is safe — it regenerates from the workbook, which is a genuine architectural strength — but a user's garden, inventory and history are not. This is an argument for revisiting the paid tier before strangers arrive rather than before friends do.
* **Account deletion depends on cascade rules staying correct.** It works only while every table referencing `auth.users` or `garden` declares `ON DELETE CASCADE` (or `SET NULL`). A future table that forgets would make deletion fail with an obscure constraint error at the worst possible moment. The confirmation readout in `db/12_account_deletion.sql` lists every such link and flags anything that would block it — worth re-running after any schema change.
* **Nobody is told when a garden changes hands.** If a departing owner's garden is handed on, the new owner discovers it by noticing they can now manage members. There is no notification mechanism to tell them otherwise. Acceptable while the user base is friends and family; worth revisiting alongside an invite flow.
* **Behavioural data is now recorded, and the privacy notice must say so before public launch.** `garden_day` holds no personal data in itself, but it is a record of a user's activity and belongs in a privacy notice. Registration with the ICO as a data controller is a separate pre-launch requirement.
* **The `garden_item` guard fires on insert only.** Both the 200-item ceiling and the entitlement check would be bypassed by a future "restore a removed item" feature, which is an update rather than an insert. Recorded at the point in the code where it would need fixing.

**New in 2.12:**
* **A removed member is not told, and cannot be added back from inside the app.** With no invite flow there is no way to re-add anybody, so removing somebody from a garden is effectively permanent. The confirmation wording says so. Same shape as the un-notified handover above, and it resolves at the same time — alongside an invite flow.
* **The garden switcher is a live read, so it needs the network.** Offline, the garden you are in still works from the service-worker cache, but the list of your others cannot be fetched. Acceptable: switching is not something you do at the bottom of the garden with no signal.
* **The last-used garden is remembered per device, not per account.** Switching on a phone does not move a tablet. Storing it server-side would mean a write on every switch to save a tap, and it degrades safely — with browser storage blocked you simply always open your oldest garden.
* **Garden names are not unique and are not validated beyond being non-blank.** Two gardens called "Home" are allowed, with a warning on the form; the name lives on the garden, which can be shared, so "unique per user" is not a rule the database can express. Names are user-typed and now appear in five places, so `escapeHtml` is load-bearing rather than defensive.
* **A garden's timezone still cannot be changed**, although its location now can. `garden.timezone` drives every piece of date arithmetic in `select_tasks` and `record_garden_day`; moving a garden abroad needs more thought than a postcode box.

---

## 6. DEVELOPMENT ROADMAP

* **Phase 1 (COMPLETE):** Operational single-button PWA returning basic daily tasks.
* **Phase 2 (COMPLETE):** Stateful interactivity — completion writes and cooldown suppression.
* **Phase 2.1 (COMPLETE):** Dynamic inventory management — the "My Garden" tab, picker, and soft-delete flow.
* **Phase 3 (COMPLETE):** Environmental integration — weather-filtered tasks via a secure weather proxy.
* **Phase 3.1 (COMPLETE):** Task dismissal — swipe-to-hide with undo, and a settings screen to restore hidden tasks.
* **Phase 4 (COMPLETE):** Cross-platform scale. The database has been migrated from Google Sheets to Supabase PostgreSQL; the matching engine is now the `select_tasks` database function; email authentication and per-garden Row-Level Security are in place; the frontend has sign-in and first-run garden setup; and the production app went live on the new stack on 2026-07-17, with a scheduled keep-alive keeping the free-tier database warm. Two small operational tidies trail behind it: confirming the old weather key was never committed publicly (rotating only if it was), and retiring the now-unused Apps Script *runtime* deployment (the content-publish pipeline stays). A native rewrite (Flutter / SwiftUI) was considered and is **not** being pursued — the PWA remains the delivery vehicle.
* **Phase 4.1 (COMPLETE):** Catalogue browsing. The "Add to My Garden" picker groups its pills under headings authored in the workbook, carries a catalogue-wide search that spans every category, and shows a botanical name inline for the handful of blueprints whose common name is ambiguous. Backed by a new `browse_group` table and two nullable `blueprint` columns, all display-only and unreachable from the matching engine.
* **Phase 4.2 (COMPLETE):** Retiring the v1 user-data checks. The `User_Profile`, `Task_Log` and `Hidden_Tasks` tabs are archived and read by nothing; the three audit checks over them are gone, which also removed the audit's last dependency on the v1 `Code.gs` runtime file. The two questions worth keeping are now asked of the live database in the post-publish report.
* **Phase 4.3 (COMPLETE):** The timing review — a second, narrower content review programme, and the refactor that made room for it. The applier that transcribes accepted findings back into the workbook became mode-driven rather than single-purpose: a mode declares which decisions tab it reads, which marker column it stamps, which fields it may write and which verdicts it accepts, and everything else — staging, validation, the same-cell guard, orphan simulation, the log — is shared. The timing mode may write only `Valid_Months` and `Frequency_Days`, so a timing pass cannot stray into rewriting instructions; anything it notices outside that scope is recorded and handed to the editorial programme. `Master_Task_Matrix` gained two more review-state columns (`Timing_Reviewed`, and `Interaction_Reviewed` reserved for the pass that has not yet been automated), both inert to publishing. The audit gained a check the workbook had always needed and never had: `Valid_Months` written out of ascending order, which the applier has always refused but nothing previously reported. *(The ascending rule itself was later found to be wrong, and replaced by season order in Phase 4.7.)*
* **Phase 4.4 (COMPLETE):** The interaction review — the last of the three content review programmes to be automated, and the one both the workflow document and the original design had assumed could not be. Its unit is a garden in a month rather than a row, which is why it needed a shape the other two did not: the gardens are declared on their own tab, and the twenty-run programme is recorded as a grid of dates derived from the log rather than as a per-row marker. Assembling "every live task that could fire for these blueprints in October" turned out to be the editorial packet's own reaching logic plus a month filter, so the last hand-assembled pass in the workflow is gone. The packet also does the arithmetic the prompt used to ask a reviewer for — the month's total workload, including anything whose cooldown lets it recur within the month — because a load judgement is worthless if the number under it is wrong. `Master_Task_Matrix` column O went from reserved to live; the audit gained a check reporting what proportion of the matrix the declared gardens can reach at all, which is the number that says whether the programme needs another garden rather than more runs.
* **Phase 4.5 (COMPLETE):** Foundations for opening up. Three pieces of groundwork that share one property — each is far cheaper to install now than to retrofit later. A daily activity record (`garden_day`) answers the only question that cannot be asked retrospectively: do people come back? A dormant entitlement structure (`product`, `pack_member`, `entitlement`) gives ownership somewhere to live without changing any behaviour, alongside a 200-item guard that is explicitly not a paywall. And account deletion, required in-app by Apple and by UK GDPR regardless of any store, which turned out to be less about deleting a person than about not orphaning a garden when the last member leaves. The freemium shape was settled at the same time and deliberately not built: notifications stay free because they are the retention mechanism, the Home Screen widget is the paid iOS feature, content packs are preferred to subscriptions because a one-off purchase has nothing to churn in November, and any subscription would be annual and sold in spring. Nothing is for sale, no paywall exists, and none of it is visible to a user.
* **Phase 4.6 (COMPLETE):** Multiple gardens per user. One person tending their own garden and a relative's can now hold both and switch between them. Most of it was already true and merely not offered — `garden_member` was drawn many-to-many, every per-garden table keys on the garden, and `create_garden` was written permissive about a second garden on purpose — so reading, switching and creating needed no database change at all. What was genuinely impossible was *leaving* a garden (the membership delete policy required ownership, excluding exactly the person who would want it) and *deleting* one (no delete grant, and `02_rls_test.sql` asserts the refusal as a passing test). Both became `SECURITY DEFINER` functions rather than loosened policies, reusing `delete_my_account`'s handover rules verbatim so the two ways out of a garden cannot disagree, and taking a garden id rather than a person so neither can be aimed at anybody else. Deleting a *shared* garden is refused outright. The work also closed two states the Data API could already produce — a garden with nobody in it, and a garden with members and no owner, which had no exit — and fixed two latent frontend defects: a default-garden query with no `ORDER BY`, and destructive buttons that had been rendering as bright blue calls-to-action because a later stylesheet rule outranked the muted one. Renaming and relocating a garden shipped alongside, the latter curing a defect in its own right: a mistyped postcode was previously permanent, and location drives which tasks appear. Sharing a garden with another *user* is deliberately still not built.
* **Phase 4.7 (COMPLETE):** `Valid_Months` season order, and two audit checks corrected. A content-pipeline release with no runtime component: nothing the app does changes, and no published data changes meaning. It began as a question about fifty audit warnings and ended by correcting the rule that produced them. The authoring convention for `Valid_Months` is now **season order** — start at the month the window opens — replacing an ascending-order rule that was actively destructive on any window crossing the new year: it wanted `11,12,1,2` rewritten as `1,2,11,12`, which reads as a January job and would have made the timing review worse on precisely the rows it exists to protect. For windows that do not cross the year the two rules are identical, so the matrix was largely untouched. Two audit findings were also wrong rather than merely imprecise. The ordering finding claimed such a row could not be edited through a review, a downstream consequence nobody had traced through the downstream code and which was never true. And the whole-matrix cooldown check — an open item carried since Phase 4.3 — measured the gap from one window *closing* to the next *opening*, when a diligent user completes the job as a window *opens*, producing seven false positives out of thirty-three; it also conflated a genuine fault (a sub-annual cooldown that strands a window) with a working-as-designed case (an annual task offering several entry points into one yearly cycle). It now simulates a user rather than doing month arithmetic. The timing review packet gained a script-computed `Window_Opens` column so the reviewer is told a task's opening month rather than inferring it from the first number in a list — the phrase it previously relied on had no correct reading for any window crossing the new year. `Normalise.gs` was added to apply the reordering mechanically, and is the first thing permitted to write to the task matrix without a row-by-row tick, on the grounds that a provably behaviour-neutral reordering is not a judgement.
* **On the horizon (post-cutover):** custom email so friends can be invited; an invite flow — with the member list, the email-based lookup and the re-add path that go with it — to make multi-*user* real, now that multi-*garden* is done; surfacing `estimated_minutes` in the UI; and the pre-existing hide-swipe placement/direction improvement (tracked separately from the v2.0 work).
* **Opening the doors (considered, sequenced).** Growth is currently limited by provisioning, not awareness: public sign-up is off and an account exists only once its email is added by hand. Nothing done to attract people works until that changes. The sequence that follows from it: turn on public sign-up (Google-only is the cheapest opening, since it sidesteps the custom-email requirement entirely); publish a privacy notice and register with the ICO; then generate static seasonal pages from the published task matrix, which is the one growth mechanism that compounds while nothing is being done to it. A Google Play listing via a Trusted Web Activity is feasible and cheap; the Apple App Store is not, because a PWA in a wrapper fails Guideline 4.2 and clearing it needs a native UI rebuild plus genuinely native features — the Home Screen widget being the strongest candidate. Store listings convert demand created elsewhere; they do not create it.
* **`Reveal_If_Wind_Above` (considered, not scheduled).** Every weather column in the schema *hides* a task; there is no way to make one appear because of the weather, and two v1-era rows tried. A storm-damage check, a wind-rock check, or "bring the pots in" all want the opposite behaviour: show this task *because* it is windy. Adding a reveal-above threshold alongside the existing suppression would make them viable. It is a schema change plus a `select_tasks` change, and it is deliberately framed as restoring the v1 intent rather than inheriting the v1 bug — the v1 column meant "show when above" by accident, which is why `Requires_Wind_Above` now carries a misleading name (`docs/DATABASE_WORKFLOW.md` §9). Not scheduled; recorded here so the reasoning is not rediscovered from scratch.
