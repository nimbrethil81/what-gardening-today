# "What Gardening Today?" — v2.0 Design Document

**Status:** Stages 1 (foundations) and 2 (publish pipeline) built and verified against real data — see §13 and §14; Stages 3–4 pending implementation
**Date:** 14 July 2026 (Stage 1 record added 16 July 2026; Stage 2 record added 16 July 2026)
**Relationship to other documents:** `SPEC.md` remains the authoritative description of the *live* 1.x application until v2.0 cutover, at which point it is rewritten to describe v2.0 and this document becomes historical. `docs/DATABASE_WORKFLOW.md` survives largely intact (see §7). This document is the seed for the implementation workstream.

---

## 1. Purpose and scope

v2.0 migrates the application from Google Sheets + Apps Script to a hosted PostgreSQL database (Supabase), and in doing so delivers the two things the current architecture cannot: **multiple users with real authentication**, and **data integrity enforced by the platform rather than by discipline**.

**In scope:**

* The relational schema described in §4, replacing string-encoded relationships with foreign keys and constraints.
* Magic-link sign-in, invite-only.
* Per-garden data isolation enforced by Row Level Security.
* Per-garden weather (location set by each user at first sign-in).
* Migration of all existing curated content and Dan's garden history, losslessly.
* Retention of Google Sheets as the content-authoring workbench, with an explicit publish step.
* Structural fixes to four standing 1.x limitations that this architecture resolves as a by-product: inverted wind suppression, the UTC/BST date-stamping bug, the dual fetch-path drift, and the hardcoded garden location.

**Out of scope** (deliberately — see §12): any UI redesign, manual-task UI, multi-garden or shared-garden UI, additional sign-in providers, app-store packaging, paywall/entitlements, non-UK gardening content, and displaying `Estimated_Minutes`.

The user-visible promise of v2.0: **the app looks and behaves as it does today**, except that you sign in once, the weather is your garden's weather, and a handful of long-standing quirks disappear.

---

## 2. Decisions record

Decisions made in the design conversation, recorded so the implementation never has to re-litigate them:

| # | Decision | Rationale (one line) |
|---|---|---|
| D1 | Full v2.0 migration, not token-based sharing on Sheets | Hand-rolled per-route security repeats the "integrity by discipline" failure class; the work would be discarded at Phase 4 anyway |
| D2 | Targeting is **nothing-until-deliberately-included** — the automatic category tier is abolished | Coverage gaps are mechanically detectable; wrong automatic inheritance (the moss-lawn/weedkiller class) is only detectable by human judgment. Make the catchable failure the default risk |
| D3 | **Magic-link email sign-in** at launch; social providers addable later without rework | No passwords to manage, no provider consoles to maintain, no ecosystem lock-in; providers are additive front doors to the same email-anchored account |
| D4 | Users ↔ gardens is a full **many-to-many with roles** in the schema; the v2.0 UI exposes exactly one garden per user | Supports both "household shares a garden" and "I also tend my parents' garden" later at zero schema cost |
| D5 | Garden location is set **by the user at first sign-in**, via a "use my current location" button or a postcode box | Self-service future-proofs onboarding; postcode fallback covers set-up away from the garden |
| D6 | Completions and hides are **per garden**, not per user or per item | The task list is the garden's shared to-do list; matches current UX |
| D7 | Platform is **Supabase (PostgreSQL)** | Only zero-cost option with a real relational database, platform-enforced row security, built-in auth, and a shallow exit (it is plain Postgres underneath) |
| D8 | Sheets remains the **authoring workbench**; content reaches the live database via an explicit publish step | Preserves the batched-AI authoring workflow, the audit, and the editorial review |
| D9 | Tasks gain an optional garden scope from day one (schema for future **manual tasks**) | One nullable column now avoids duplicating the completion/cooldown machinery later |
| D10 | **No paywall schema** is built | Postgres makes it a trivial later addition; the expensive half (entitlements/payments) is shaped by unknowable future platform choices |

### Refinements introduced by this document

These follow from the decisions above but were not individually discussed; each is flagged here for review rather than buried in the schema:

1. **Tasks may target a blueprint directly, as well as a collection** (§4.4). The design conversation said "everything becomes a collection." Taken literally, that means ~200 singleton collections ("the set containing only Raspberry"), each needing creation and maintenance. A direct blueprint target is the same thing — an explicit, exact reference to a deliberately chosen audience — without the bookkeeping. Decision D2 was about abolishing *automatic inheritance*, and this preserves that fully: nothing receives a task it was not explicitly given.
2. **A blank frequency means a one-off task** (§4.4). Curated tasks always have a cooldown; a future manual task with no frequency disappears permanently once completed. Falls out of the cooldown logic for free.
3. **Retirement applies to blueprints as well as tasks** (§4.1). Merging duplicate blueprints — which has already happened once — becomes a tombstone operation instead of a deletion, preserving history by construction.
4. **Invite-only is enforced by disabling public sign-ups** (§5). Dan invites each friend by email from the Supabase dashboard; there is no sign-up form to abuse.
5. **One daily route** (§6). A single `today` call replaces the `get_all`/`get_tasks` pair, eliminating the drift limitation by making divergence impossible rather than forbidden.
6. **Category becomes display-only** (§4.3). With the category matching tier abolished (D2), the seven categories exist purely to drive UI tiles and card grouping — completing the "three columns, three jobs" separation begun in 1.3.

---

## 3. Target architecture

Four components, three of which already exist in some form:

* **Frontend** — the existing vanilla HTML/CSS/JS PWA on GitHub Pages, with its fetch layer swapped from the Apps Script URL to the Supabase client library (`supabase-js`, loaded from CDN; fully compatible with the no-framework approach). Gains a sign-in screen and a first-run garden-setup screen. Everything else — tabs, cards, swipe-to-hide, My Garden — is unchanged.
* **Supabase** — one project providing: the PostgreSQL database (§4) with Row Level Security (§5); authentication (magic-link email); and one Edge Function, `today`, which holds the OpenWeather API key as a platform secret and serves the combined daily payload (§6).
* **Google Sheets** — demoted from live database to **authoring workbench**. The `Item_Dictionary`, `Master_Task_Matrix` and `Reference_Lists` tabs, the semicolon import process, `Audit.gs`, and the editorial review all continue exactly as documented in `docs/DATABASE_WORKFLOW.md`. A new **Garden Data → Publish to app** menu item pushes curated content to Postgres (§7). The user-data tabs (`User_Profile`, `Task_Log`, `Hidden_Tasks`) are migrated once and then frozen as historical records.
* **OpenWeather** — unchanged as the weather source, but its key now lives only in the Edge Function's secret store: never in a repository, never in client-visible code.

The Apps Script *web app deployment* is decommissioned at cutover (§10). Apps Script itself survives as the host of the audit and publish tooling attached to the workbook.

**The single-source-of-logic principle carries over.** Task matching is implemented exactly once, as a PostgreSQL function (§4.6). The `today` Edge Function calls it; nothing else reimplements it. This is the v2.0 form of the rule adopted after the 1.3 bug existed twice in two copy-pasted routes.

---

## 4. Schema

### 4.1 Conventions

* **Surrogate keys carry no meaning.** Every table's primary key is a database-generated number or UUID that no software ever parses. The smart-key antipattern is eliminated structurally, not just by policy.
* **Legacy codes are labels, not keys.** The old identifiers (`TASK_0123`, `PLANT_LILY_OF_THE_VALLEY`) survive in `legacy_code` columns — unique, human-readable, used by the publish pipeline for matching workbook rows to database rows, and used by humans in conversation. Nothing matches, joins, or infers by parsing them.
* **Nothing curated is ever deleted; it is retired.** Tasks and blueprints carry a nullable `retired_at` timestamp. Retired rows are invisible to the app but keep every historical reference valid. The entire `RETIRED_TASK_IDS` mechanism — the constant, the audit suppression, the reissue check — becomes a schema property and ceases to exist as code.
* **Timestamps are stored with timezone** (`timestamptz`). Day-level reasoning ("was this completed today?", cooldown arithmetic) is computed in the garden's own timezone. The BST midnight bug class is closed permanently.
* **Comma-separated cells become rows.** Multi-category membership and collection membership are junction tables. The one exception is `valid_months`, which is an attribute of a task rather than a relationship, stored as a validated integer array.

### 4.2 Identity and gardens

**`garden`** — one row per physical garden.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | generated |
| `name` | text, required | e.g. "Home", "Mum & Dad's" |
| `latitude`, `longitude` | numeric, required | set at onboarding (§9); drives weather only |
| `timezone` | text, required | default `Europe/London`; drives date arithmetic |
| `created_at` | timestamptz | |

**`garden_member`** — who belongs to which garden. PK (`garden_id`, `user_id`).

| Column | Type | Notes |
|---|---|---|
| `garden_id` | uuid, FK → garden | |
| `user_id` | uuid, FK → auth.users | Supabase-managed identity |
| `role` | text, required | `owner` or `member`; owners can rename the garden and manage membership; both roles do everything day-to-day |
| `added_at` | timestamptz | |

Users themselves live in Supabase's managed `auth.users` table (email, sign-in state). No separate profile table is created in v2.0 — nothing in the UI displays member names — and adding one later is a trivial Postgres change if a shared-garden UI ever wants "completed by Dan".

One user in one garden = one row. A couple sharing a garden = two rows, one garden. One person tending two gardens = two rows, one user. The v2.0 UI creates exactly one garden per user at onboarding and never shows a switcher; both expansion directions are pure UI work later.

### 4.3 The catalogue (shared, curated, read-only to users)

**`category`** — the seven display categories, migrated from `Reference_Lists`. Display-only: drives the "Add to My Garden" tiles and task-card grouping. **No matching logic references it** (Decision D2 / Refinement 6).

| Column | Type |
|---|---|
| `id` | smallint, PK |
| `name` | text, unique, required |
| `sort_order` | smallint |

**`blueprint`** — one row per real-world item type; the successor of `Item_Dictionary` rows.

| Column | Type | Notes |
|---|---|---|
| `id` | integer identity, PK | |
| `name` | text, unique, required | the picker label ("Lily of the Valley") |
| `legacy_code` | text, unique | the old prefix (`PLANT_LILY_OF_THE_VALLEY`); publish-pipeline matching key and human label; never parsed |
| `retired_at` | timestamptz, nullable | tombstone for merged/withdrawn blueprints |

The near-duplicate-name check (`normaliseName` in Audit.gs) deliberately stays a *report*, not a constraint — it is loose by design and needs a human eye.

**`blueprint_category`** — junction; one row per (blueprint, category) membership. Replaces the comma-separated `Category` cell. Rose under two tiles = two rows, one blueprint.

**`collection`** — a named, curated set of blueprints; the successor of `GROUP_*` tags, now first-class rows.

| Column | Type | Notes |
|---|---|---|
| `id` | integer identity, PK | |
| `code` | text, unique, required | authored exactly as in the workbook (`GROUP_SOFT_FRUIT`), so publishing needs no translation table |
| `name` | text | human description ("Soft fruit") |

**`collection_member`** — junction; one row per (collection, blueprint). Replaces the comma-separated `Groups` cell. Namespace collisions between collection codes and blueprint codes are impossible by construction — they live in different tables — though the workbook keeps the `GROUP_` convention for human clarity.

The former *category-tier* task audiences (generic shrub care, generic tool care, the general `PLANT` care set, etc.) become ordinary collections with **explicitly enumerated membership**, created during migration under Dan's review (§8, step 4). Nothing joins a collection by virtue of what it is called or which category tile it sits under.

### 4.4 Tasks

**`task`** — the successor of `Master_Task_Matrix` rows, plus the dormant manual-task capability (D9).

| Column | Type | Notes |
|---|---|---|
| `id` | integer identity, PK | |
| `legacy_code` | text, unique, nullable | `TASK_0123` for migrated/curated tasks; null for future manual tasks |
| `garden_id` | uuid, FK → garden, **nullable** | **null = global curated task** (all of v2.0's content); set = a private manual task belonging to one garden |
| `garden_item_id` | integer, nullable | optional attachment of a manual task to one specific item ("net the Victoria plum"); a composite foreign key on (`garden_item_id`, `garden_id`) guarantees the item belongs to the same garden — a cross-garden dangle is unrepresentable |
| `name` | text, required | |
| `instruction` | text | |
| `category_id` | FK → category, nullable | required for global tasks (checked); manual tasks may be uncategorised and would display under a "My tasks" heading |
| `valid_months` | smallint[], required | constrained: non-empty, every element 1–12. Malformed `Valid_Months` becomes a rejected write, not an audit finding |
| `frequency_days` | integer, nullable | cooldown in days; required for global tasks (checked). **Null = one-off** (Refinement 2): any completion suppresses it forever |
| `suppress_if_raining` | boolean, required, default false | a real boolean; the `"TRUE"`-as-text failure class becomes untypeable |
| `suppress_if_temp_below` | numeric, nullable | °C |
| `suppress_if_wind_above` | numeric, nullable | mph. **Renamed from `Requires_Wind_Above` with corrected semantics**: the task is *hidden* when wind exceeds the threshold. Existing thresholds migrate as-is, because they were authored with this intent; only the engine was inverted |
| `estimated_minutes` | integer, nullable | ports over; still not displayed (unchanged from 1.x) |
| `retired_at` | timestamptz, nullable | tombstone |
| `created_at` | timestamptz | |

**`task_target`** — which audiences a global task applies to. One row per target; a task may have several (something the single `Target_Asset_ID` cell could never express — one task text, two collections, no duplication).

| Column | Type | Notes |
|---|---|---|
| `task_id` | FK → task | |
| `collection_id` | FK → collection, nullable | exactly one of these |
| `blueprint_id` | FK → blueprint, nullable | two is set per row (database CHECK) |

A misspelled target is now a rejected write — the "target matches nothing" audit ERROR, the phantom `FRUIT_*` family, and the plausible-but-inert `VEG_FRUIT` partial prefix all become impossible rather than detected. The one target rule the database cannot express ("every global task must have at least one target") remains a **publish-time gate** (§7), the direct heir of that audit check.

Manual tasks use no targets: a garden-scoped task either attaches to one item via `garden_item_id` or, with both null-ish, applies to the garden generally ("re-stain the fence").

### 4.5 Per-garden state

**`garden_item`** — the successor of `User_Profile` rows. The defining change of the whole redesign: an item **is a foreign key to its blueprint**, not a constructed string. `getCorePrefix()`, the `_NNNN` suffix, the legacy two-digit-suffix limitation, and the "garden item has no blueprint" audit ERROR all cease to exist.

| Column | Type | Notes |
|---|---|---|
| `id` | integer identity, PK | plus a unique (`id`, `garden_id`) pair to support the manual-task composite FK |
| `garden_id` | uuid, FK → garden, required | |
| `blueprint_id` | FK → blueprint, required | cannot reference a non-existent blueprint, by construction |
| `friendly_name` | text, nullable | "Front lawn" |
| `legacy_asset_id` | text, nullable | the old `PLANT_X_1179` string, kept for migration parity-checking only |
| `added_at` | timestamptz | |
| `removed_at` | timestamptz, nullable | soft delete; replaces `Is_Active` |

**`task_completion`** — the successor of `Task_Log`. Append-only by policy (and by RLS: no update/delete granted).

| Column | Type | Notes |
|---|---|---|
| `id` | bigint identity, PK | |
| `garden_id` | uuid, FK → garden, required | completions are per garden (D6) |
| `task_id` | FK → task, required | valid forever, because tasks are retired, never deleted |
| `completed_at` | timestamptz, required, default now | full timestamp; the "day" it belongs to is derived in the garden's timezone |
| `notes` | text | |

**`hidden_task`** — the successor of `Hidden_Tasks`, now per garden. PK (`garden_id`, `task_id`) — which makes hiding idempotent *by construction* rather than by a duplicate-scan loop.

| Column | Type |
|---|---|
| `garden_id` | uuid, FK → garden |
| `task_id` | FK → task |
| `hidden_at` | timestamptz |

Hiding is a fact about the garden, shared by all its members (D6 corollary): "this task is irrelevant here."

### 4.6 The matching rule (successor of three-tier matching)

Implemented once, as a PostgreSQL function — `select_tasks(garden, month, temperature, is_raining, wind_mph)` — called by the `today` Edge Function and by nothing else. In plain English, a task appears for a garden when **all** of the following hold:

1. **Not retired.**
2. **In scope:** either it is a global task whose targets include (directly, or via a collection containing) the blueprint of at least one active item in the garden; or it is a manual task belonging to this garden (and, if attached to a specific item, that item is still active).
3. **In season:** the current month (in the garden's timezone) is in `valid_months`.
4. **Not hidden** for this garden.
5. **Off cooldown:** no completion for this (garden, task) within the last `frequency_days`; a null frequency means any completion ever suppresses it permanently.
6. **Not weather-suppressed:** not raining if the task is rain-suppressed; temperature not below its threshold; **wind not above its threshold** (corrected semantics).

Matching remains what 1.3 made it: **exact equality against explicitly declared references** — now with the declarations enforced by foreign keys instead of spelling.

### 4.7 What became of each old mechanism

| 1.x mechanism | v2.0 fate |
|---|---|
| Asset-ID prefixes and `_NNNN` suffixes | Gone. Items reference blueprints by key; old prefixes survive as inert `legacy_code` labels |
| Category matching tier | **Abolished (D2).** Former category-tier audiences become explicit collections with reviewed membership |
| `GROUP_*` tags in a comma-separated cell | `collection` + `collection_member` tables; workbook authoring convention unchanged |
| Multi-category comma-separated cell | `blueprint_category` junction table |
| `Target_Asset_ID` (one string, three meanings) | `task_target` rows: explicit FK to a collection or a blueprint; multi-target now possible |
| `RETIRED_TASK_IDS` constant + audit checks | `retired_at` tombstones; reissue and orphaned references are unrepresentable |
| `Is_Active` flag | `removed_at` timestamp |
| Date-string `Date_Completed` (UTC bug) | `timestamptz`, day-math in garden timezone |
| Audit structural ERRORs (bad months, text booleans, dangling references, duplicate keys, instance suffixes in targets) | Database types and constraints; rejected at write time |
| Audit judgment checks (coverage gaps, category-tier safety REVIEW, near-duplicate names) | SQL report views + the publish gate (§7); human review unchanged in spirit |
| `get_all` / `get_tasks` parallel routes | One `today` route (§6) |

---

## 5. Access control

**Sign-up is disabled.** Dan invites each friend by email from the Supabase dashboard; the invite email doubles as their first magic link. Return visits use magic-link sign-in; sessions persist on the device for weeks or months, so signing in is a rare event. Social providers (Google, Apple) can be added later without any schema or data change — they are alternative front doors to the same email-anchored account.

**Row Level Security is the enforcement mechanism** — declared once per table, enforced by the database for every query from every client forever. No route can forget to filter. The policy matrix:

| Table | Signed-in users can… | Writes come from… |
|---|---|---|
| `category`, `blueprint`, `blueprint_category`, `collection`, `collection_member`, `task_target` | read everything | publish pipeline only (service role) |
| `task` (global rows, `garden_id` null) | read | publish pipeline only |
| `task` (manual rows, `garden_id` set) | read/create/update/retire **only in gardens they belong to** | garden members |
| `garden` | read/update only gardens they belong to (rename: owners) | created via the onboarding function |
| `garden_member` | read memberships of their own gardens | owners add/remove members; onboarding adds the creator |
| `garden_item` | full create/read/soft-delete within their gardens | garden members |
| `task_completion` | read and **insert only** within their gardens (append-only) | garden members |
| `hidden_task` | read/insert/delete within their gardens | garden members |

Two implementation cautions, recorded now so they are treated with respect later:

* **The `task` table mixes global read-only rows and per-garden writable rows.** Its policies are the most intricate in the design (read: `garden_id` is null *or* mine; write: `garden_id` is set *and* mine; global rows never writable). This gets a dedicated test matrix at implementation: every combination of (global/manual row) × (my garden/other garden) × (select/insert/update).
* **Garden creation is atomic.** Creating a garden and enrolling its creator as owner must happen together, so onboarding calls a single small database function (`create_garden(name, lat, lon)`) rather than two raw inserts — otherwise the RLS rules for "who may insert a membership" become circular.

**Operator visibility, stated plainly:** Dan, as the project owner, can see all data in all gardens via the dashboard — the same position he is in today with the spreadsheet. Friends should be told this in one honest sentence when invited.

---

## 6. Weather and the daily route

One Edge Function, **`today`**, replaces both `get_all` and `get_tasks`:

1. Authenticates the caller and verifies membership of the requested garden.
2. Looks up the garden's coordinates **server-side** (the client never supplies coordinates, so the function cannot be used as a free general-purpose weather proxy).
3. Fetches current weather from OpenWeather — key held as a function secret — through a small cache table keyed by rounded coordinates, ~30-minute expiry, keeping API usage polite as the user count grows.
4. Calls `select_tasks` with the month (in the garden's timezone) and the weather values.
5. Returns weather + matched tasks in one payload. On weather failure, it degrades exactly as today's failsafe does: tasks are returned unfiltered by weather, and the widget shows an unavailable state.

Inventory and the picker catalogue are fetched by the frontend directly through the Supabase client (RLS-governed) — they are plain reads with no logic, so they do not belong inside the function.

Because there is only one route that evaluates tasks, the 1.x limitation where weather-suppressed tasks reappeared on tab-switch cannot recur: tab switches re-call `today`.

**Expected behaviour changes at cutover** (deliberate, to be verified rather than "fixed"):

* Tasks with wind thresholds now **hide in wind** instead of appearing only in wind.
* Completion dates are always correct in local time, including the BST midnight window.
* The weather shown and the weather filtering tasks are, for the first time, guaranteed to be the same weather — the garden's.
* Signing in is required once per device.

---

## 7. Authoring and the publish pipeline

Nothing about how content is *written* changes: `Item_Dictionary` and `Master_Task_Matrix` in the workbook, the batched-AI prompts, the semicolon import, `Audit.gs`, and the editorial review continue per `docs/DATABASE_WORKFLOW.md`. What changes is that the workbook is no longer live — content reaches users only when published.

**Garden Data → Publish to app** (new Apps Script menu item, alongside Run Audit):

1. **Pre-publish gate** — runs the audit; refuses to publish on any ERROR. Adds the two checks that guard the new schema's one unenforceable rule and its chosen risk: *every task must have at least one resolvable target* (the heir of "target matches nothing"), and a **coverage report** listing any blueprint that no task reaches directly or via any collection (the heir of "item receives no tasks" — and, under nothing-until-deliberately-included, the safety net D2 depends on).
2. **Push** — writes to Postgres over Supabase's REST API using the service-role key, held in Apps Script's Script Properties (never in code, never in the repo; the workbook itself must remain unshared). Blueprints, collections and tasks are **upserted by `legacy_code`**; junction tables (`blueprint_category`, `collection_member`, `task_target`) are reconciled to mirror the workbook exactly. Curated rows absent from the workbook are **retired, never deleted**.
3. **Post-publish report** — row counts and the coverage report against the live database, written to a report tab, mirroring today's audit-report habit.

The workflow discipline this preserves is the point: authoring stays where bulk editing is pleasant, and the database stays where integrity is enforced.

---

## 8. Migration plan

Run against Dan's real data, with the spreadsheet untouched throughout — it remains the source of truth until parity is verified, so the rollback plan at every step is "do nothing."

1. **Categories:** `Reference_Lists` display categories → `category`. (The prefix column of `Reference_Lists` retires with the prefixes themselves.)
2. **Blueprints:** each `Item_Dictionary` row → one `blueprint` (prefix → `legacy_code`); comma-separated categories → `blueprint_category` rows.
3. **Collections:** every `GROUP_*` tag in use → one `collection`; the `Groups` cells → `collection_member` rows.
4. **Category-tier conversion — the one step requiring judgment.** Each task currently targeting a bare category prefix (the generic `PLANT` set, the generic shrub set `TASK_0540`–`0543`, the generic `TOOL` tier, and any others surfaced by the audit's REVIEW list) is retargeted at a new named collection (e.g. `GROUP_SHRUB_GENERIC_CARE`), whose membership is seeded from the current category members and **reviewed by Dan blueprint-by-blueprint before migration proceeds**. This is decision D2 being executed: every inclusion becomes deliberate exactly once, here. The 1.3/1.4 history (Lavender excluded from feeding; moss lawns excluded from mowing) is the template for the review. **(Executed in Stage 1 — the review's final dispositions for all 26 category-tier tasks are recorded in §13.)**
5. **Tasks:** `Master_Task_Matrix` rows → `task` (ID → `legacy_code`; months parsed to arrays; text booleans normalised to real ones; `Requires_Wind_Above` values → `suppress_if_wind_above` unchanged); `Target_Asset_ID` → `task_target` rows (specific prefixes → blueprint targets; `GROUP_*` → collection targets; category prefixes → the step-4 collections).
6. **Tombstones:** `TASK_0050`, `TASK_0051`, `TASK_0064` are recreated as retired task rows (names from the changelog, `retired_at` set), so their `Task_Log` completions migrate with intact references. `RETIRED_TASK_IDS` then retires from `Audit.gs`. **(Stage 1 found two further orphans — `TASK_0082` and `TASK_0083` — with completions in `Task_Log` but no matrix row and no place on the retired list; both are tombstoned too, with placeholder names. See §13.)**
7. **Dan's garden:** one `garden` row (Amersham coordinates, `Europe/London`); `User_Profile` rows → `garden_item` via the prefix → blueprint lookup, active and inactive alike (`Is_Active = FALSE` → `removed_at` set), old IDs kept in `legacy_asset_id`.
8. **History:** `Task_Log` → `task_completion` (date-only values converted to midday in the garden's timezone — cooldown arithmetic only ever needs day resolution, and midday keeps every date unambiguous); `Hidden_Tasks` → `hidden_task`.
9. **Verification:** row-count reconciliation for every mapping; the coverage report clean (or its findings knowingly accepted); and a **parity check** — the old app and a test harness against `select_tasks` are asked for the same day's tasks for Dan's garden, and the lists must match except for the documented deliberate differences (§6). Only after parity passes does cutover (§10, stage 3) proceed.

---

## 9. Onboarding and frontend changes

**Sign-in screen** (new): an email box and a "Send me a sign-in link" button; a signed-out visitor sees nothing else. Tapping the emailed link lands them in the app with a long-lived session.

**First-run garden setup** (new, shown only when the signed-in user belongs to no garden): garden name, plus location by either a **"Use my current location"** button (browser geolocation — one tap if they're at the garden) or a **postcode box** (resolved to coordinates via the free, key-less postcodes.io service). Creates the garden via `create_garden` and proceeds straight into the normal app. The plain-English framing on screen should make clear it wants *the garden's* location.

**Fetch layer:** the Apps Script URL and its query-string routes are replaced by supabase-js calls — `today` for the daily view; direct table reads for inventory and the picker; inserts/updates for add/remove item, complete, hide, unhide. Property-name normalisation at the fetch boundary is retained as a principle, though Postgres's consistent casing removes most of its work.

**Unchanged:** every screen, tab, card, gesture and flow the user already knows.

**Deployment mechanics:** `CACHE_NAME` bumps as usual; given the scale of the change, the release notes should warn that installed PWAs may need removing and re-adding to the home screen once. After cutover is verified, the Apps Script **web app deployment is disabled** — closing, permanently, the "anyone with the URL" exposure — and the OpenWeather key is **rotated**, retiring the copy that lived in Code.gs.

---

## 10. Delivery plan

Four stages, each independently testable, with the live 1.x app untouched until stage 3's final step:

* **Stage 1 — Foundations. (COMPLETE — see §13.)** Supabase project; full schema with constraints; RLS policies; `select_tasks`; `create_garden`; migration scripts run against Dan's real data; §8 verification through the parity check. *Acceptance: the new database answers "what should Dan do today?" identically to the live app (modulo documented differences), and the RLS test matrix passes.* **Met: parity holds across all twelve months with no over-matching, and the RLS matrix (49 checks) passes.**
* **Stage 2 — Publish pipeline. (COMPLETE — see §14.)** The Publish to app menu, gates and reports; `docs/DATABASE_WORKFLOW.md` updated; one real content edit round-tripped workbook → live database. *Acceptance: Dan can author and publish a task change end-to-end without touching the database directly.* **Met: the workbook was reconciled to encode the Stage 1 hand-migration decisions, published to reproduce the as-built database, verified idempotent (zero junction churn on re-run), and a real content edit was round-tripped workbook → live database.**
* **Stage 3 — Frontend and cutover.** Sign-in, onboarding, fetch-layer swap, `today` function; a parallel-running test period with Dan using the v2 frontend daily against real data; then cutover — DNS-free, since it's just the frontend deploy — followed by decommissioning the Apps Script web app and rotating the weather key. **v2.0 is declared here.** *Acceptance: two weeks (or Dan's satisfaction) of daily real-world use with no regressions.*
* **Stage 4 — Friends.** Invitations sent; each friend onboards self-service; first real multi-garden weather and content-coverage feedback. *Acceptance: at least one friend using the app with zero manual data intervention from Dan.*

**Standing 1.x bugs:** the wind inversion, BST stamping, dual-path drift, exposed API key and hardcoded coordinates are all *structurally* resolved by v2.0 and are not fixed twice. If stage 3 slips badly (months, not weeks), the wind inversion alone is worth a small interim 1.x fix, since it actively misfilters tasks today; that is a scheduling call to make then, not now.

**Versioning:** stages 1–2 produce no user-facing release; the CHANGELOG entry for 2.0 lands at stage 3 cutover, per the existing MAJOR-version convention.

---

## 11. Risks and mitigations

* **Free-tier project pausing.** Supabase free-tier projects pause after roughly a week of inactivity. Daily use prevents it; a dormant winter might not. Mitigation: a weekly keep-alive ping from a free scheduled GitHub Action. Current free-tier terms to be re-verified at stage 1 — they change.
* **Magic-link email delivery.** Supabase's built-in email service is heavily rate-limited and intended for development. For a handful of friends signing in rarely it may suffice, but configuring a free-tier SMTP sender is the durable fix; assess at stage 3 and treat the built-in service as a fallback, not the plan.
* **The mixed `task` table's RLS policies** are the design's most delicate security element; mitigated by the dedicated test matrix (§5) written before the policies, not after.
* **A silent divergence between workbook and database** (publish forgotten after authoring). Mitigated by habit plus the post-publish report; if it ever bites, a "last published" indicator in the app's settings screen is a small later addition.
* **Platform learning curve.** Real, but bounded: the schema is plain SQL, the frontend calls a well-documented client library, and the exit route (standard Postgres dump to any host) caps the downside of every Supabase-specific choice.
* **Migration data loss.** Structurally mitigated: the spreadsheet is never modified, every step is re-runnable from it, and cutover requires the §8 parity check.

---

## 12. Out of scope, with their hooks

Deferred features, each with its schema hook already in place so deferral costs nothing:

* **Manual tasks (UI):** `task.garden_id` / `garden_item_id`, one-off semantics, and RLS rules all exist; the feature is a frontend project.
* **Multiple gardens per user / shared gardens (UI):** the membership model exists; a garden switcher and an invite flow are frontend projects. Interim workaround: Dan can add a member row via the dashboard.
* **Additional sign-in providers:** additive in Supabase Auth configuration; note the standing rule that an eventual iOS App Store app offering any social login must also offer Sign in with Apple.
* **App-store packaging:** the v2.0 backend is already the API any future client would use; no data changes required. Play Store via a packaged PWA is cheap; the App Store implies the Phase 4+ native/Flutter question.
* **Paywall:** deliberately unbuilt (D10). The design keeps "what content does this user see?" answered server-side, so a future premium tier is a policy change, not a client rewrite.
* **`Estimated_Minutes` display:** the column ports; surfacing it is the natural first post-2.0 feature.
* **Non-UK gardening calendars:** the content is UK-specific by design; a known product boundary, not a bug.

---

## 13. Stage 1 implementation record (as-built)

Stage 1 was built and verified against Dan's real data on 16 July 2026. This section records what was decided or discovered during implementation, so the design stays the authoritative reference. Nothing here overturns a §1–§12 decision; it fills in the choices those sections left to implementation.

### 13.1 Artifacts

A `db/` folder of runnable, re-runnable, self-testing SQL, each file showing a visible results grid or confirmation readout (the Supabase web editor does not surface notice messages):

| File | Purpose |
|---|---|
| `01_schema.sql` | Tables, keys, constraints, indexes (§4) |
| `02_rls.sql` | Membership helpers, grants, RLS, policies (§5) |
| `03_functions.sql` | `select_tasks` and `create_garden` (§4.6, §5) |
| `04_staging.sql` | The six workbook tabs loaded verbatim into a `staging` schema |
| `05_transform.sql` | Staging → live tables, encoding every review decision (§8) |
| `06_verify.sql` | Row-count reconciliation, coverage report, retirement roll-call (§8.9) |
| `tests/01_constraints_test.sql` | 23 adversarial constraint checks |
| `tests/02_rls_test.sql` | The §5 access-control matrix, 49 checks |
| `tests/03_functions_test.sql` | 26 function behaviour checks |

### 13.2 Category-tier review — final dispositions (§8 step 4)

The 26 tasks that targeted a bare category were each given an explicit home. **19 re-homed, 7 retired.** New collections created: `GROUP_ALL_BEDS` (all 9 bed types), `GROUP_SHRUB_GENERIC` (all 33 shrubs), `GROUP_TREE_GENERIC` (all 22 trees), `GROUP_HERBS` (all 12 herbs), `GROUP_HAND_TOOLS` (8 hand tools — trowel, fork, spade, hoe, secateurs, shears, loppers, leaf rake; power tools and non-oilable items excluded).

| Disposition | Tasks |
|---|---|
| → `GROUP_GRASS_LAWN` | `0011`–`0017` (7 lawn tasks) |
| → `GROUP_ALL_BEDS` | `0018`, `0019`, `0020` (bed weeding) |
| → `GROUP_SHRUB_GENERIC` | `0540`–`0543` (generic shrub care) |
| → `GROUP_TREE_GENERIC` | `0077`, `0078`, `0079` |
| → `GROUP_HERBS` | `0087` |
| → `GROUP_HAND_TOOLS` | `0066` |
| **Retired** | `0027` (Re-edge Bed Borders); `0042`, `0043`, `0044`, `0047`, `0052`, `0053` (the six generic `PLANT` tasks) |

Rationale for the retirements: each is a seasonal *activity* or a container/subset task rather than care for an owned item — the "activity vs asset-care" principle applied. The `PLANT` clean sweep directly resolves the long-standing "generic plant tasks appear unhelpfully" complaint. Proper flowering-/tender-/plant-specific versions, and a lawn-edge task to replace `0027`, are future content-authoring work.

### 13.3 Decisions settled at implementation

* **Category sort order** follows `SPEC.md` (Lawn, Beds, Trees & shrubs, Plants & flowers, Veg & herbs, Garden structures, Tools), not the stray helper column in `Reference_Lists`.
* **`create_garden` is permissive** about a second garden (per D4): it does not check whether the caller already owns one. The v2.0 UI, not the database, enforces one-garden-per-user by never offering a second. When multi-garden ships, no change is needed here.
* **`select_tasks` refuses** a garden the caller does not belong to (raises, rather than returning an empty list), so the security boundary is observable and testable. This complements — does not replace — the RLS that already makes other gardens invisible.
* **`garden_item.legacy_category`** was added (a nullable column beyond the §4.5 table) to preserve which category tile an item was originally added under — information the blueprint alone can't recover for dual-category items. Carried across, never read by v2 logic.
* **Defensive schema additions** beyond the letter of §4, each low-risk: a check that a global task cannot carry a stray `garden_item_id`; a guard rejecting a `valid_months` array containing a null element.

### 13.4 The ownerless garden — a stage 3 constraint

The migration creates Dan's garden with a fixed id but **no `garden_member` row**, because no sign-in account exists in Stage 1. The garden is reachable only via the dashboard (admin) until then. **Stage 3 onboarding must, for Dan, *link his new account to this existing garden as owner* rather than call `create_garden` for a fresh empty one.** This is a new constraint on the §9 onboarding design, not covered there originally. (New friends, who have no pre-migrated garden, follow the normal `create_garden` path.)

### 13.5 Coverage finding

247 of 248 blueprints are covered. `TOOL_WATERING_CAN` (not in Dan's garden) is the sole gap — it previously had only the bare-`TOOL` clean task, correctly narrowed away from it. It joins the five structures noted in `SPEC.md` §5E (`STRUCT_PLANTER_BOX`, `STRUCT_PERGOLA`, `STRUCT_COLD_FRAME`, `STRUCT_ARCH`, `STRUCT_POND`) on the future-authoring list.

### 13.6 Parity result and the expected-differences list (§8 step 9)

The live app's matching logic was replicated against the workbook and diffed against `select_tasks` for Dan's garden across all twelve months. **In no month does v2 surface a task the live app would not** (no over-matching). Every difference across the year is one deliberately introduced in this stage:

| Task | Difference | Cause | Season it shows |
|---|---|---|---|
| `TASK_0027` Re-edge Bed Borders | retired | review | Mar–May, Sep |
| `TASK_0042` Deadhead Flowers | retired | review | May–Sep |
| `TASK_0043` Water Plants | retired | review | Apr–Sep |
| `TASK_0044` Stake Tall Plants | retired | review | (masked by cooldown) |
| `TASK_0047` Plant Spring Bulbs | retired | review | Sep–Nov |
| `TASK_0052` Feed Patio Pots | retired | review | (masked by cooldown) |
| `TASK_0053` Protect Plants from Frost | retired | review | Oct, Nov, Mar |
| `TASK_0066` End of Season Tool Clean | no longer offered for the chainsaw | narrowed to hand tools | Nov |
| *(wind-sensitive tasks in general)* | shown when calm, hidden when windy | corrected wind semantics (§6) | no effect on Dan's garden this season |

The corrected wind behaviour is real in general but, on Dan's current inventory, produces no observable difference: none of his in-season matching tasks carries a wind threshold.

---

## 14. Stage 2 implementation record (as-built)

Stage 2 was built and verified against Dan's real data on 16 July 2026. As with §13, this records what was decided or discovered during implementation. Nothing here overturns a §1–§12 decision; it fills in the choices §7 left to implementation.

### 14.1 Artifacts

Two Apps Script files attached to the authoring workbook:

| File | Purpose |
|---|---|
| `Audit.gs` (revised) | The existing audit, now aware of the `Retired` column and `Collections` tab; `RETIRED_TASK_IDS` removed; findings exposed via `collectAuditFindings(ss)` so the publish gate reuses them rather than reimplementing the audit |
| `Publish.gs` (new) | The `Garden Data → Publish to app` pipeline: read-first, gate, push over the Supabase REST API, and a `Publish_Report` tab; plus a `Check before publish (no changes)` dry-run item |

`Code.gs` (the live 1.x API) is untouched; it is decommissioned at Stage 3 cutover, not before.

### 14.2 How the workbook came to encode the Stage 1 hand-migration

The pivotal Stage 2 finding: Stage 1's decisions lived in `05_transform.sql`, not in the workbook. Publishing reads the workbook, so the workbook had to be brought up to date first, or a publish would have regressed the database to the pre-review world. The reconciliation, all authored under review:

* **`Collections` tab** (new): `Code`, `Name` for all ten collections — the five originals plus the five created in the §13.2 review — declaring each collection and naming it. Membership still lives in the `Groups` column.
* **`Retired` column** (new, `Master_Task_Matrix` column L): a non-blank value marks a tombstone. This is the schema-property realisation of the old `RETIRED_TASK_IDS` mechanism (§4.1).
* **`GROUP_ALL_BEDS`** enumerated onto all nine bed blueprints in the `Groups` column. The shrub/tree/herb/hand-tool memberships (`GROUP_SHRUB_GENERIC` ×33, `GROUP_TREE_GENERIC` ×22, `GROUP_HERBS` ×12, `GROUP_HAND_TOOLS` ×8) were already present and correct, so only the beds needed adding.
* **The 19 re-homed targets** rewritten from bare categories to their collection codes (`0011`–`0017`→`GROUP_GRASS_LAWN`, `0018`–`0020`→`GROUP_ALL_BEDS`, `0066`→`GROUP_HAND_TOOLS`, `0077`–`0079`→`GROUP_TREE_GENERIC`, `0087`→`GROUP_HERBS`, `0540`–`0543`→`GROUP_SHRUB_GENERIC`).
* **The 7 review-retirements** marked via the `Retired` column, rows kept in place.
* **The 5 tombstones** (`0050`, `0051`, `0064`, `0082`, `0083`) added as retired rows with recovered names, so the database reproduces them from the workbook rather than holding state the workbook cannot.

The principle settled here: **the workbook is the complete source of truth for the curated catalogue.** Everything the database contains — including tombstones and reviewed collection membership — is reproducible from it. Fully explicit membership (Option A) was chosen over prefix-derivation, consistent with D2 and the "explicit over inferred" rule; the coverage report is the backstop that makes "you must tag a new member" safe.

### 14.3 The reconciliation rule (a §7 clarification settled at implementation)

§7 says "retiring (never deleting) curated rows absent from the workbook." Taken literally this cannot apply uniformly, because `collection` has no `retired_at` and the junction tables must be re-mirrored. The rule as built:

* **Blueprints and tasks retire, never delete.** Absent from the workbook ⇒ `retired_at` set. A tombstone date is stamped once and never walked forward on later publishes (the push preserves any existing `retired_at`).
* **Collections are upsert-only.** They are never removed by publishing (an empty collection is harmless); a collection is emptied by clearing its membership, not by deletion.
* **The three junction tables are the only rows physically deleted,** and only to re-mirror them to the workbook. They carry no history and nothing references them.
* **Blueprint retirement is by absence only.** No `Retired` column was added to `Item_Dictionary`; blueprint retirement has only ever arisen from merging duplicates, which is a deletion-from-the-workbook. A future "retire a blueprint while keeping its row visible" would be a small addition.

### 14.4 The gate

The gate runs `collectAuditFindings` and refuses to publish on any ERROR, then adds three publish-specific blocks and one warning:

* **Every live task must resolve** to a declared blueprint or a declared collection. A bare category prefix is not resolvable — which is precisely how D2 (no automatic category tier) is enforced at the boundary: an un-rehomed category task cannot be published.
* **Every `GROUP_*` tag on a blueprint must be declared** on the `Collections` tab (else its membership would reference a non-existent collection).
* **Every task's category must be one of the seven.**
* **Coverage is a warning, not a block** (per the §13.5 precedent of knowingly shipping with gaps).

### 14.5 Security and configuration

The push authenticates with the Supabase **service-role key**, which bypasses RLS — correct, because the publish pipeline is the sole authorised writer to the curated tables (§5). It is held in Apps Script **Script Properties** (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`), never in a code file or the repository, with the workbook kept unshared. This is the pattern the OpenWeather key will also follow once it moves to the Edge Function secret store at Stage 3 (§9).

### 14.6 Acceptance result

* The **reconciliation publish** reproduced the Stage 1 as-built database from the workbook.
* A **second, unchanged publish** reported zero membership churn across all three junction tables, confirming the pipeline is a faithful mirror rather than a churn machine.
* A **real content edit** was authored in the workbook and round-tripped to the live database with no direct database access — the stated acceptance criterion.
* **Coverage is now clean.** The six blueprints listed as gaps in §13.5 — `TOOL_WATERING_CAN` and the five structures (`STRUCT_PLANTER_BOX`, `STRUCT_PERGOLA`, `STRUCT_COLD_FRAME`, `STRUCT_ARCH`, `STRUCT_POND`) — have had tasks authored and now receive them, so the publish coverage report returns empty.
