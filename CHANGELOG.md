# Changelog

All notable changes to "What Gardening Today?" will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning follows a simplified semantic scheme:

- **MAJOR** (e.g. 1.0 → 2.0) — architectural phase transitions per SPEC.md §6 (e.g. backend migration, native rewrite).
- **MINOR** (e.g. 1.0 → 1.1) — user-facing features, UI changes, and bug fixes within the current phase.

---
## [2.13] — 2026-08-20

### `Valid_Months` ordering, and a check that was wrong twice

A content-pipeline release. Nothing in the app changes, no user sees anything different, and no published data changes meaning — but three things in the workbook's own rules were wrong, and two of them were wrong in the audit report, which is the worst place for a rule to be wrong because it is where you go to find out whether anything is.

It began with about fifty **`Valid_Months` not ascending** warnings, and the question of whether they mattered at all.

**Changed — the ordering convention is now SEASON ORDER, not ascending**

They did not matter, in the sense that ordering has no runtime meaning — that was settled in [2.9] and is unchanged. But reading fifty of them showed the *rule* was wrong.

Roughly forty of the flagged rows were a single continuous window that crosses the new year, written from the month it opens: `11,12,1,2`, `12,1,2`, `10,11,12,1,2,3`. That is not carelessness. It is a second convention, and a **more informative one than ascending**, because the order tells a reader — and, more to the point, tells the timing review — when the job starts. The ascending rule wanted those rewritten `1,2,11,12`, which reads as a January job. Following the audit's advice would have destroyed real information on forty rows and made the timing review worse on precisely the rows it exists to protect, since its whole question is about the month a window opens.

So the convention changed to fit the data rather than the other way round:

- Group the months into maximal runs of consecutive months, wrapping December into January. Each run is a **window**.
- **One window** — write it from its opening month forward. `11,12,1,2`, `3,4,5`.
- **Two or more** — order the windows by opening month ascending, each written from its own opening month forward. `10,11,3,4` becomes `3,4,10,11`.
- **All twelve months** — plain ascending, because there is no opening month to start from.

For any window that does not cross the new year this is **identical to ascending**, so the overwhelming majority of the matrix was already compliant and untouched.

One implementation, `monthsCanonicalOrder_` in `Audit.gs`, is shared by the audit's sweep and the review applier's validator, so the two cannot drift apart about what a corrected row looks like. The applier still refuses a badly-ordered value and now names the canonical form in the refusal, so the fix is a copy and paste. It writes the accepted value **in the order given, not sorted** — under the old rule sorting would have been harmless, under this one it would silently undo the convention.

**Fixed — the ordering finding claimed a blockage that did not exist**

The old finding said a non-ascending row "cannot be edited through either Apply decisions flow until it is corrected". It can. `reviewApplyDecisions_` reads the existing cell only as a before-value for the log; the sole validation is `reviewValidateValue_` on the value being **written**. Nothing anywhere inspects the order of what is already stored. The applier's refusal bites on a *proposed* value, never a stored one, so every one of those rows was editable the whole time.

Worth recording as a class of mistake rather than a typo: the finding asserted a downstream consequence that had never been traced through the downstream code.

**Fixed — the two-window cooldown check, twice**

[2.9] recorded the whole-matrix version of the cooldown-versus-own-months check as an open gap and suggested it "would make a good second WARNING addition to `Audit.gs`". It was added, run against the live matrix, and returned thirty-three rows. Reading them showed it wrong in two separate ways.

**First, it measured the wrong span.** It compared the cooldown against the run from one window *closing* to the next *opening*. But the user this check exists to protect is the diligent one, and a diligent user completes the job the day the window **opens**, not the day it shuts — so the gap actually available is a whole window wider than the check allowed. Seven of the thirty-three were fine: `3,4 + 9,10` on a 180-day cooldown was reported as broken, when 1 March plus 180 days is 28 August and September opens entirely on time.

`monthsWindowReach_` now **walks the days** rather than doing month arithmetic around a wrapping year. It follows a user who completes the task the first day it appears and reports which windows they actually reach, run once per possible entry window — because a user meets a task in whichever window comes round first for them, and everything after that is determined. It is a few hundred thousand integer operations across the few dozen rows with more than one window.

**Second, and more interesting, it was reporting two different things as one:**

- A cooldown **under a year** that still leaves a window unreachable *contradicts its own row*. Writing 180 says "twice a year"; if the user only ever gets one firing, the number and the months disagree and one of them is wrong. Two rows in the live matrix are like this and both are real. Per-row **WARNING**, `Cooldown contradicts the declared windows`.
- A cooldown of **a year or more** can fire at most once a year whatever the months say, so several windows cannot mean several occasions and never could. What they mean is several ways *in*: a user is offered the job in whichever window reaches them first and keeps that one for good. That is not a fault — it is why somebody joining in autumn gets a reminder in months rather than waiting until spring. Twenty-four rows are like this, and the honest finding is not "this is broken" but "your users are permanently split between these windows, so check both are equally good advice". One aggregate **REVIEW**, `Annual tasks offering a choice of window`, following the `Blueprints in no review pass` precedent — two dozen findings nobody can act on teaches you to skim the report.

Thirty-three warnings became two warnings and one review.

The lesson worth keeping: the original check asserted "that window can never come round for them" — a claim about behaviour — on the strength of arithmetic nobody had tested against the behaviour. Where a finding makes a claim that strong, the check should answer it the way a person would, by following what actually happens.

**Changed — the timing review prompt states the opening month rather than implying it**

`timingComposePrompt_` said a task appears "on the FIRST day of the first month in its `Valid_Months`". That is only correct for a window that does not cross the new year; for the forty-odd winter rows the phrase had **no correct reading in either ordering**, and those are exactly the rows where an early window costs a season.

Every row in the packet now carries a script-computed **`Window_Opens`** column — the month whose predecessor is absent from the set — and the prompt reasons about that instead. `11,12,1,2` and `1,2,11,12` both answer November. A two-window task names both openings and the prompt asks the reviewer to judge each. Context rows carry the column too, which makes the lawn-chain shape ("several tasks all opening on one day") readable straight down the column. The hedge that stood in `TimingReview.gs`'s header while this was uncertain is gone, replaced by the derivation.

**Added — `Normalise.gs`, a maintenance utility**

Thirty-two rows needed reordering, which is thirty-two chances to fat-finger a month into a cell nobody re-reads. `Normalise.gs` does it mechanically, using the same `monthsCanonicalOrder_` as everything else. Dry run first, one batched read and write, reads the cells back and **verifies** what landed, pins the number format of only the cells it touches to plain text (a short list such as `12,1` is the one value Sheets might take for a number), skips anything malformed or carrying a duplicate month, and records every before-and-after in `Review_Log` under a new mode `NORMALISE` — which no reader of that log mistakes for a review.

It is the **third thing that can write to `Master_Task_Matrix`**, after `Publish.gs` and `Review.gs`, and that is a deliberate decision rather than a drift. It is safe to automate where nothing else in this project is, for one reason: it is not a judgement. The only value it can write to a cell is `monthsCanonicalOrder_` of the months already in that cell, and matching treats the list as a set, so the months a task fires in provably cannot change. The "apply nothing automatically" rule in DATABASE_WORKFLOW §7b governs judgements, and there is no judgement here.

Its first version failed and is worth recording, because both faults are the classic ways an Apps Script utility dies. It asked for confirmation with a **modal dialog** and was documented to be run from the **editor** — but `SpreadsheetApp.getUi()` dialogs render in the spreadsheet tab, so the confirmation appeared where nobody was looking, the script waited for a click that never came, and the six-minute limit killed it with every write still ahead of it. And it wrote **one cell at a time**: sixty-four separate round trips where three would do. It now uses no dialogs at all — everything goes to a `Normalise_Report` tab, so it behaves identically from the editor, a menu or a trigger — and the dry run is the confirmation.

**Fixed — the worked example the documentation had been teaching from was arithmetically wrong**

Found while correcting the check, and the same mistake wearing different clothes. `DATABASE_WORKFLOW.md` had cited **"months 3 and 10 with a cooldown of 180"** as *the* worked example of a stranded window since [2.7], in §5, §6 and §9, and from there it had propagated into both live prompts in `Review.gs`. It is wrong. 1 March plus 180 days is 28 August; October opens on time; 1 October plus 180 is 30 March, which is still inside the March window. **That row fires in both windows every year.**

The error is identical to the one in the first version of the audit check — measuring from the wrong end of the first window — which is presumably why neither caught the other. It has been replaced everywhere with **months 3 and 6 on a 180-day cooldown**, which genuinely strands June (use 90; a quarterly `3,6,9,12` needs about 80), and the verification checklist in §6 now points at the audit rather than asking for the arithmetic by hand. Three releases of documentation, two prompts and one audit check all had the same defect because each was written from the last rather than from the behaviour.

**Changed — the authoring and review prompts**

Both prompts in `Review.gs` and the timing prompt now ask for season order, with the wrap-around case spelled out, so a reviewer proposing `1,2,11,12` for a winter window is refused with the right answer in the message. The authoring prompt's `Frequency_Days` rule (ii) now notes that the audit sweeps the whole matrix for the two-window fault, so a row breaking it will be reported rather than merely discouraged. The timing prompt gains an explicit out-of-scope item for month ordering, which the audit polices and the reviewer should never report.

**Not changed**

- `Publish.gs`, `Code.gs`, `InteractionReview.gs` — untouched.
- The published data. Ordering cannot reach the database in any form that matters: `select_tasks` tests the season with `v_month = any (t.valid_months)`, `string_to_array` preserves whatever it is given and nothing sorts it, and `task_valid_months_shape` checks only cardinality, nullness and range.

### Documentation

`DATABASE_WORKFLOW.md` to v2.13: the season-order convention with its shape table (§9), the corrected `Valid_Months` authoring rule (§5), the two rewritten cooldown checks and the retired ascending check (§7a), the `Window_Opens` column in the timing packet (§7g), and the corrected worked example in §5, §6 and §9. The superseded rules are recorded rather than deleted — a convention that a large minority of the data quietly disobeys is worth reading about before it is worth re-deriving. `SPEC.md`: `Normalise.gs` added to the content-pipeline component list, with the argument for why a third writer to the task matrix is a deliberate exception rather than an erosion of the "apply nothing automatically" rule; Phase 4.3's claim about the ascending check annotated rather than rewritten; and a new completed roadmap phase (4.7).

### Known gaps and deferred work

Unchanged from [2.12], with two additions:

- **Two real cooldown faults are outstanding as data**, not code. `TASK_0472` is quarterly (March, June, September, December) on a 180-day cooldown, which is double what it can be — about 80 works. `TASK_0036` declares January–February and October–November, which is an otherwise-continuous October-to-February run **with December missing**; adding `12` makes it one window and the finding clears without touching the cooldown. `TASK_0030` carries exactly the same months on a 365-day cooldown and looks like the same authoring slip. Two rows sharing an unusual shape is usually one habit rather than two accidents.
- **The twenty-four "choice of window" rows are a horticultural question, not a defect.** Where the two windows are equally good advice, nothing needs doing. Where one is better, the users locked into the other are quietly getting the worse of it every year, and the row should either say so in its instruction or drop the weaker window. Good material for a timing review pass.

---
## [2.12.1] — 2026-08-17

### Fixed: the app shrank to fit its own header

Reported from an installed iPhone PWA within hours of 2.12 going out. The bottom bar no longer looked pinned; the My Garden cards were narrower than before and the screen could be nudged sideways; Today was off-centre. Quitting and reopening fixed Today but left My Garden narrow.

One fault, not four. Measured at a 375px viewport, where `.app-container` should be 343px wide:

| | Today | My Garden |
|---|---|---|
| 2.11 | 343px | 343px |
| 2.12 | **183px** | **297px** |
| 2.12, after switching to a longer-named garden | **343px** | 297px |
| 2.12.1 | 343px | 343px |

That third row is the reported symptom exactly. Reopening appeared to fix Today because the garden it reopened into had a longer name; My Garden was unmoved because its width came from its own content rather than the header.

**The cause was a strut that had been holding the layout open by accident.** `body` is a column flex container with `align-items: center`. That centres its children — and it also means they are **not** stretched across the cross axis: each is sized to fit its own contents unless it declares a width. `.fullscreen-view` declares `width: 100%`, which is why the splash, sign-in and garden-form screens were never affected. `#app-root` never did, so the app has been shrink-to-fit since the day it was written. It looked correct for a year only because the header carried the fixed string "🌱 What Gardening Today?", which is wide enough to prop the container open to full width on any phone.

2.12 replaced that title with the current garden's name. "Home" is short, the prop went, and the app began sizing itself to whatever its widest content happened to be — different on each tab, and different again after every switch or rename. The nav bar was not a second bug but the same one seen from below: it is `position: fixed; width: 100%` and stayed precisely where it had always been, while everything above it shrank and drifted off-centre.

**Fixed** by giving `#app-root` the `width: 100%` that `.fullscreen-view` has always had, plus `margin: 0 auto` on `.app-container` so it still centres once a screen is wider than 440px. Two declarations, and a comment at the point of the fix spelling out the trap — the next person to change that header would otherwise fall into it the same way, and the failure is silent.

Only `style.css` and `sw.js` change. `CACHE_NAME` bumped `gardening-v10` → `gardening-v11`.

### Why the tests did not catch it

Worth recording, because the gap is more instructive than the fix. 2.12 shipped with 64 database checks and 35 headless frontend checks, every one of them passing. Every frontend check asked *is the right thing on screen* — the right garden name, the right buttons, the right wording, the right recovery from a 403 — and **not one asked whether it was the right size**. A layout can be perfectly correct in content and structure while being half the width it should be, and a suite assembled entirely from behavioural assertions will wave it through.

The suite now asserts geometry as well as behaviour: that `.app-container` is exactly the viewport less its margins (to a maximum of 440px), that it is centred, and that the document never grows wider than the viewport — on both tabs, at 320, 375, 390, 430 and 1200px. The check fails against the 2.12 files and passes against these, which is the only reason to believe it is testing anything.

---
## [2.12] — 2026-08-17

### Multiple gardens per user

One person, several gardens. The case that drove it is the ordinary one: somebody who tends their own garden and also a relative's, and wants to switch between them rather than choose.

Most of this was already true and simply not offered. `garden_member` has been many-to-many since the v2 schema was drawn, every per-garden table keys on `garden_id`, `select_tasks` and `today` both take a garden id and verify membership themselves, and `create_garden` was written **permissive about a second garden on purpose** — `db/03_functions.sql` says so in a comment written a month before this feature existed. Reading, switching and creating therefore needed no database change at all.

Two things were genuinely impossible rather than merely un-exposed, and they are the whole of the new SQL. **Deleting** a garden: `garden` is granted SELECT and UPDATE only, and `02_rls_test.sql` asserts "Alice cannot delete her garden" as a *passing* test. **Leaving** one: `garden_member`'s delete policy requires ownership, so an ordinary member could not remove their own row — exactly the person who would want to. The obvious fix for the second, letting anyone delete their own row, is the wrong one: it re-opens the orphan hole file 12 exists to close.

**Added — the garden switcher**

The header line used to say the name of the app you had just opened, which in an installed PWA is the one fact you already have. It now says **which garden you are looking at**, and tapping it opens the list.

That placement was chosen over the alternatives for a specific reason: it costs **no vertical space**, so the task list stays exactly where it was and opening the app still puts today's jobs in front of you immediately. A row of chips under the header would have made switching a single tap, but at the price of a permanent band above the tasks, a list that doesn't survive five gardens, and a layout that visibly reshapes the day a second one appears. A third bottom-nav tab was rejected on semantics: the nav bar is for destinations, and switching gardens is not somewhere you go — it is a change of context that alters what both existing tabs show.

The list itself is a bottom sheet reusing the modal the settings and delete-account panels already use — which were, it turned out, already bottom sheets. So the switcher introduces no new interaction to learn and almost no new CSS, and it lands under the thumb rather than at the top of the screen where it was opened from.

- **The garden you were last in reopens**, remembered per user id on the device so two people sharing a tablet don't inherit each other's. Validated on every open against the gardens you can actually see, with a silent fall back to your oldest if the remembered one has gone. Never an error: it is a convenience, and a convenience that can break the app is not one. The app's first use of browser storage, and it degrades to "your oldest garden" if storage is blocked.
- **Ordered oldest first.** Alphabetical would silently reshuffle the list every time something was renamed.
- **The header updates before the data arrives**, from the list already held, so the switch feels immediate rather than waiting on a round trip. The task list visibly reloading underneath it is the signal that something changed — which is what stops a job being ticked off in the wrong garden.
- Tappable even with one garden, because otherwise nobody would discover the feature exists and "Add another garden" would have nowhere to live.

**Added — creating, renaming and relocating a garden**

The first-run setup screen became one form doing three jobs — first run, adding another, and editing — because all three ask for the same two things, and three copies of the postcode lookup would be three things to keep correct. Cancel appears only when there is an app to go back to.

**Editing covers a real defect as well as a new feature.** A garden's location was previously set once at creation and could never be corrected, so a mistyped postcode meant permanently wrong weather — and the weather is what decides which tasks appear. Renaming matters more than it used to for a different reason: with a switcher, the name *is* the navigation, and a list reading "Garden" and "Garden 2" is unusable.

**Added — `leave_garden()` and `delete_garden()` (`db/13_gardens.sql`)**

Both `SECURITY DEFINER` with a pinned empty `search_path`, in the house style. Neither takes a user argument, so neither can be aimed at anybody else.

- **`leave_garden` applies exactly the rules `delete_my_account` already applies**, so the two paths out of a garden cannot disagree: last member out deletes the garden and everything below it; a departing sole owner hands it to the longest-standing remaining member, ties broken by user id; anybody else simply goes. It returns which of the three happened, because the three are genuinely different from the user's point of view.
- **`delete_garden` is refused while anybody else is a member.** Somebody who merely tends a garden has no notification channel: they would open the app one morning to find years of their own history gone, erased by a tap they never saw. Remove them first, or leave it to them. This deliberately makes deleting a *garden* stricter than deleting an *account*, which hands shared gardens on rather than destroying them — both err in the same direction, which is never to destroy data on behalf of somebody who did not ask.
- **Deleting your last garden is allowed**, and the function deliberately does not check for it. Zero gardens is already a real, handled state — it is where every new user starts, and where `route()` sends anybody with none. Refusing would have built a trap whose only exit was deleting the entire account, which is far more destructive than what was asked for.
- **Deletion is hard, not soft**, matching file 12 and the position `10_activity.sql` states outright: deletion means deletion. The cascades take items, manual tasks, completions, hidden tasks and the activity record.

**Changed — the `garden_member` delete policy, closing two states that were reachable today**

The policy let an owner delete *any* row in their garden, including their own. Nothing in the UI did that, but `app.js` and `config.js` are public files served with a published key, so the Data API is reachable directly whatever the UI offers. Two bad end states followed: a garden with **nobody in it** — file 12's orphan, by a different route — and, worse, a garden with members and **no owner**, a state with no exit at all, because there is no update policy on `garden_member` and so nobody could ever be promoted.

Two clauses make both unrepresentable, declaratively, where they can be read rather than inferred: you cannot remove *yourself* this way (that is `leave_garden`'s job, because leaving is the case that has to decide between deleting the garden and handing it over), and an owner row cannot be removed by this path at all. Removing an ordinary member — which is how a shared garden becomes deletable — still works exactly as `02_rls_test.sql` has always asserted.

**Added — a ten-garden ceiling in `create_garden`**

The same reasoning as the 200-item guard, and the same disclaimer: **not a paywall**. Nothing previously bounded the number of gardens, because nothing offered a second one. Counted over membership rather than ownership, so it cannot be walked around once sharing exists. Ten is far above any honest use — the case this was built for is two — and invisible until somebody is doing something absurd.

**Changed — Settings, split into two groups**

It now holds two different kinds of thing, and one of them was already ambiguous: **`hidden_task` is per garden**, so the flat "Hidden Tasks" list has always meant "hidden in *this* garden" without ever saying so. Naming the current garden as a section heading fixes that, and makes "Delete this garden" unambiguous at the same time. The account actions sit below it, separated. Which way out of a garden is offered depends on who else is in it: Leave appears only when there is somebody to leave it to, Delete only to an owner, and rename only to an owner because that is what the policy permits.

The confirmation panel says what is actually in the garden — "Home holds 34 items and 212 completed jobs" — rather than warning in the abstract, following the precedent set by the account-deletion panel that describes each garden by name. When the garden is shared it says so *before* the tap and takes the confirm button away, rather than letting a refusal arrive as an error afterwards.

### Fixed

- **`route()` picked an arbitrary garden.** It read `.select("id, name").limit(1)` with no `ORDER BY` — correct-looking with one garden, non-deterministic with two, and free to return a different one on each open. A latent bug that a second garden detonates rather than a new one.
- **The destructive buttons have been rendering as bright blue calls-to-action.** `.danger-text-btn` sets a muted grey, but those buttons also carry `.text-btn`, which is declared *later* in the stylesheet and paints them `--accent-blue`. Equal specificity, so the later rule won — and "Delete my account" has been styled as an invitation since 2.11, despite the comment directly above it saying it should never be what a thumb finds by accident. Scoping to `.danger-row .danger-text-btn` puts it right, for the account entry and the two garden entries now beside it.
- **A brand-new garden was congratulated for work it had never had.** An empty Today showed "✨ Your garden is up to date!" — the no-tasks-due message — which for a garden with nothing in it is actively misleading. It now distinguishes the two, and can only do so because the empty state re-renders once the inventory for *that* garden arrives; the two calls run in parallel and either can land first.

### Changed — cross-garden state, which is where the bugs would otherwise have been

Switching is faster than a round trip, so a reply can arrive after the user has moved on. `loadToday`, `loadInventory` and `fetchHiddenTasks` now record which garden each request was *for* and discard anything stale, rather than painting one garden's tasks under another garden's name.

Everything transient is stood down on a switch. The undo toast is the one that actually bites: hide a task, switch, then tap Undo, and the delete would have been aimed at the **new** garden using the **old** garden's task id. The half-swiped card, the primed "Remove?" button and the picker's selection go with it.

A 403 from the daily call — the garden was deleted, or you were removed from it, on another device — is now caught specifically and re-routes with "that garden is no longer available", instead of the generic "check your connection", which would have been both wrong and baffling. The toast moved outside `#app-root` so that message still shows on the setup screen, which is exactly where you land after deleting your last garden.

`sw.js` `CACHE_NAME` bumped `gardening-v9` → `gardening-v10`.

### Tests

`db/13_gardens_test.sql` — 64 checks, throwaway-and-rollback in the house style. It proves: a second garden is allowed and an eleventh refused; all three leave outcomes, including that the **longest-standing** member is the one promoted — and the fixture makes that member deliberately not the lowest user id, so a wrong tie-break would show up rather than pass by luck; that deleting a shared garden is refused **and refused without side effects**; that removing the member first and then deleting reaches the same end state; that deleting your last garden leaves you with none, which is a real state and not an error; that an owner cannot remove herself through the policy but can still remove an ordinary member; and the two invariants — no garden anywhere left with nobody in it, and none left with no owner.

The SQL was **executed rather than reasoned about**. A local PostgreSQL 16 was stood up with a stub of the Supabase pieces the schema relies on (`auth.users`, `auth.uid()`, the three roles) and `db/01` through `db/13` loaded into it in order. 64/64 pass, with no regressions: `02` 49/49, `03` 26/26, `11` 28/28, `12` 36/36. One note for anyone repeating it — give the local `service_role` `BYPASSRLS` as Supabase does, or two publish-pipeline checks in `02` fail for reasons that have nothing to do with this change.

The frontend was driven headlessly in Chromium against a stubbed Supabase client: 35 checks, all passing, zero uncaught errors. They cover the default garden with and without a memory, switching, persistence across a reload, the empty-garden wording, rename, the duplicate-name warning, cancel, creating, deleting, the 403 recovery path, and deleting the last garden.

### Deliberate non-changes

- **No invite flow, and no members list.** Sharing a garden with another *user* remains a separate feature; this one is about one person holding several gardens. Adding a member still requires their user id and there is no email lookup, so in practice you create both gardens yourself — which is exactly what the driving use case needs.
- **"Leave this garden" was built anyway**, hidden unless somebody else is in the garden. It costs one button reusing the confirmation panel in a different mode, and it means Settings is not quietly wrong the moment a second member exists.
- **`select_tasks` and the `today` function are untouched.** Both already took a garden id and verified membership themselves. Neither needed to learn that this feature happened.
- **Garden timezone stays fixed at `Europe/London`** and is not editable, even though location now is. Moving a garden abroad needs more than a postcode box, and the timezone drives all the date arithmetic.
- **Duplicate garden names are allowed**, with a warning on the form. The name lives on the garden, which can be shared, so "unique per user" is not a rule the database can hold.

### Known gaps recorded

- **A removed member is not told, and cannot be re-added from inside the app.** With no invite flow, removing somebody is effectively permanent; the confirmation says so.
- **The switcher is a live read.** Offline it cannot list your other gardens, though the one you are in still works from cache.
- **The last-used garden is per device, not per account.** Switching on your phone does not move your tablet. Storing it server-side would mean a write on every switch to save a tap.
- **`escapeHtml` now carries more weight.** Garden names are user-typed and appear in the header, the switcher, the settings heading and two confirmation panels. `"Mum's garden"` is a test case in the frontend suite for that reason.

---
## [2.11] — 2026-08-17

### Groundwork: measuring return, somewhere for ownership to live, and the way out

Three pieces of work that share one property and were done together for that reason: each is far cheaper to install now than to retrofit later, and one of them cannot be installed later at all.

**The measurement is the urgent one.** `task_completion` records what a garden *did*. Nothing recorded that somebody *looked* — and an open that produces no completion is precisely the churn signal. That number cannot be reconstructed after the fact: every day without the table is a day of baseline that will never exist. Every conversation about growth, pricing and conversion had been running on guesswork, and it will keep doing so until there is a season of data. So it went in first, alone, before anything that depends on it.

**Added — `garden_day` and `record_garden_day()` (`db/10_activity.sql`)**

- One row per garden per day, with a count of opens. Two small columns and an integer: a garden opened every day of a year contributes 365 rows at roughly 100 bytes, so a thousand active gardens is about 20 MB a year against a 500 MB free-tier database. It adds nothing to Supabase's MAU billing, which counts users rather than rows, and nothing to egress — the write happens inside a call the app was already making.
- **The day is resolved in the garden's own timezone**, not UTC and not the device's, by the function rather than by the Edge Function. The rule for “which day is it here?” already exists once in `select_tasks`; a second implementation in TypeScript would have been a second thing to keep correct.
- **Not user-accessible at all.** RLS enabled with no policies and no grant, the same posture as `weather_cache`. A user can neither read it nor inflate their own count.
- **The keep-alive cannot contaminate it**, because the scheduled ping calls `keepalive()` and never `today`.
- Pruning old rows into a monthly summary is described in a comment and deliberately **not built**: at present it would solve a problem that does not exist.

**Changed — the `today` Edge Function**

One call added, and its position is the whole of the design. It sits **after** the membership check, so probing somebody else's garden id can never register as activity; and **before** the weather and task work, so an open still counts on a day when OpenWeather is down or matching fails — the person opened the app, which is the thing being measured. It is wrapped so that nothing it does can reach the caller. The day this table breaks, nobody misses a task.

### Somewhere for ownership to live, installed switched off

**Added — `product`, `pack_member`, `entitlement` (`db/11_entitlement.sql`)**

Dormant by construction: no products exist, no entitlements exist, every blueprint is core, and the picker is unchanged. Nothing is for sale and no paywall exists. It is here because doing it later would mean one migration touching every blueprint, the picker and the add path simultaneously.

- **Entitlement sits on the user, not the garden.** The deciding case was somebody who tends their own garden and also a relative's: garden-based entitlement would charge them twice for one purchase, and they are the most engaged kind of user there is.
- **The governing principle, which everything else follows from: entitlement grants the right to *add*, not the right to *see*.** Once an item is in a garden it belongs to the garden — every member sees it, every member gets its tasks, and a lapsed subscription takes none of it away. Only *adding* a pack item asks whether the caller is entitled. This is why the check is a trigger on inserting a `garden_item` and appears nowhere in `select_tasks`: two people looking at the same garden can never see different plants, and no paywall can ever withhold care advice for something somebody is actually growing.
- **A junction table, not a column on `blueprint`.** The first draft of the design had both, which would have been two representations of one fact and free to drift apart — the exact failure class the v2 migration existed to kill. The junction won: a plant may sit in several packs, owning any one of them is enough, and it is the same shape as `collection_member`. “Core” needs no migration, because a plant in no pack is free by silence.
- **Retiring a pack releases its contents** rather than stranding them. A withdrawn product must never leave a plant permanently un-addable, because that would put its care advice out of reach too — the deliberate failure direction.
- **A `feature` product with blueprint members is unrepresentable**, via a composite foreign key on `(product_id, product_kind)`, the same technique the task/garden-item key already uses.
- **Nobody can grant themselves anything.** No insert, update or delete grant exists at any level; a user reads their own rows only, and a signed-out caller is refused the table one layer earlier still, holding no grant at all.
- **Prices are not stored.** The App Store and Play Console are the merchants of record.

**Added — a 200-item guard on `garden_item`, which is explicitly not a paywall**

Inventory size was considered as a freemium lever and rejected on product grounds rather than commercial ones: a cap that binds pushes people to leave things *out* of their inventory to stay under it, and the app is then advising on a garden it can no longer see properly. That degrades the recommendations in order to sell a subscription. What remains is an abuse and performance guard — garden inventory is the one user-controlled input to `select_tasks`, which walks every active item on every open — set far above any real garden and invisible in the UI. Enforced in the database, because `app.js` and `config.js` are public files served with a published key and a browser-side check is decorative.

### The way out

**Added — `delete_my_account()` (`db/12_account_deletion.sql`) and the two-tap flow in the app**

Required in-app by Apple and by UK GDPR regardless of any store. It turned out to be less about deleting a person than about not orphaning a garden.

- **The schema had already made the hard part easy.** `task_completion` and `hidden_task` are keyed on the garden, not the user — there is no “who did this” column anywhere — so the ugliest question in account deletion never arises: nothing needs anonymising, because nothing was ever attributed. A departing partner cannot resurrect tasks the other had already done.
- **The actual problem is the orphan.** Gardens do not cascade from users and must not, since one member leaving cannot be allowed to destroy the others' data. But delete the last member and the garden survives with nobody in it: unreachable, because every policy requires membership, yet still holding a location, an inventory, years of history and its activity record. Data that should have been erased, sitting there forever. Clearing that up is the substance of the file.
- **Three outcomes.** Last member out: the garden goes, and cascades take everything below it. Sole owner leaving with others still there: the garden is **handed to the longest-standing remaining member**, ties broken by user id so the result is deterministic. Another owner remaining: nothing happens to the garden at all.
- **Immediate, with no grace period** — for a reason specific to this project rather than a general preference. The deferred version needs something to run a month later and finish the job, and the only scheduler here is a twice-weekly GitHub Action that has already been observed to stop silently. A deletion that quietly never happens is worse than none.
- **The function takes no arguments.** That is the security design: with nothing to pass there is nothing to tamper with, and it cannot be aimed at anybody else. One transaction, so nobody is ever half-deleted.
- **A hard delete, never a soft one.** A soft delete keeps the row and leaves the email permanently taken; as built, signing up again with the same email works and produces a genuinely new person with an empty slate. Proven by test rather than assumed.
- **The client clears the session locally afterwards.** The stored token stays technically valid for up to an hour after the account is gone, and an app holding one looks signed in but shows nothing — which reads as “broken”, not “signed out”.

**Changed — `index.html`, `app.js`, `style.css`**

The entry point is deliberately quiet: plain muted text, last in the settings panel, because it is irreversible and should never be what a thumb finds by accident. The confirmation panel reverses the weight — “Keep my account” is the prominent button and comes first. Confirming destruction should not be the easiest thing on the screen.

Rather than a generic warning, the panel **names each garden and says what happens to it**: one you tend alone will be deleted with everything in it, one you share stays and passes to whoever has tended it longest. Somebody who shares a garden deserves to know it survives them leaving. If that lookup fails it falls back to honest generic wording rather than blocking the deletion. A small `escapeHtml` helper came with it, since a garden called “Mum & Dad's” would otherwise render wrongly.

**Added — a foreign-key audit in the deletion file's readout**

Deletion works only while every table referencing `auth.users` or `garden` declares `ON DELETE CASCADE`. A future table that forgets would make it fail with an obscure constraint error at the worst possible moment. The readout lists every such link and flags anything that would block it — worth re-running after any schema change.

### Tests

`db/11_entitlement_test.sql` (28 checks) and `db/12_account_deletion_test.sql` (36 checks), both throwaway-and-rollback in the house style. Between them they prove: dormant means dormant; a pack item is refused to a non-owner and allowed to an owner; an expired entitlement stops granting while an item already added stays put; retiring a pack releases it; an un-entitled co-member keeps full sight of a pack item in a shared garden; nobody can grant themselves anything; the ceiling binds at 200 and a removed item frees a slot; every deletion outcome including one user with two gardens in different situations at once; the email is freed for re-registration; and, the single check that matters most, that **no garden anywhere is left with nobody in it**.

Two findings came out of writing them. The signed-out entitlement check originally expected an empty result and got a refusal instead — `anon` holds no grant at all, so the door does not open a layer earlier than the policy would have been consulted. That is stronger than what was tested for, so the test was corrected rather than the schema. And the deletion suite fails when run as one file while both halves pass in isolation; the halves are retained as `_FIRSTHALF` / `_SECONDHALF` diagnostics until that is understood. Every check passes, so the logic is verified; the fault is in the scaffolding.

### Deliberate non-changes

- **No paywall, no store billing, no receipt validation, no restore-purchases, no prices in the UI.** All cheap to add when there is something to sell, all expensive to maintain before then.
- **`select_tasks` is untouched**, and that is the point: the matching engine never learns that entitlement exists.
- **House plants were considered as the first content pack and rejected for now.** Indoors there is no weather, no frost and no wind suppression, and the seasonal logic barely applies — the engine's most distinctive inputs go dead. It is a separate product rather than a pack.
- **Notifications will not be gated**, despite being the obvious candidate. They are the retention mechanism: a free user who is never nudged drifts away in November and never returns in April, and a churned free user converts at zero. Frost warnings are also time-critical advice, which is the wrong side of the line.

### Known gaps recorded

- The `garden_item` guard fires on **insert only**, so a future “restore a removed item” feature would bypass both the ceiling and the entitlement check. Noted at the point in the code where it would need fixing.
- **Nobody is told when a garden changes hands.** There is no notification mechanism; the new owner discovers it by noticing they can manage members.
- **Behavioural data is now recorded and the privacy notice must say so before public launch**, alongside ICO registration as a data controller.
- **No automated backups on the free tier.** Curated content regenerates from the workbook; a user's garden does not.

---
## [2.10] — 2026-08-06

### The third and last review programme, and an assumption worth testing

The interaction review (DATABASE_WORKFLOW §7c) asks the one question neither of the other two passes can: not "is this task right", but "what does a real person see when several individually correct tasks arrive in the same month, in the same garden". The audit sees rows, not gardens. The editorial review sees one item group, while a real garden spans several — and the contradictions worth most sit between a bed task and a plant task, authored in different passes that never see each other.

It was the last pass still assembled by hand, because both this document and the original design recorded that the packet builder could not serve it: its unit is a garden, not a declared review pass. **That turned out to be wrong, and testing the claim rather than inheriting it is where most of the value in this release came from.** Assembling "every live task that could fire for these blueprints in October" is the editorial packet's own reaching logic — match on a blueprint prefix *or* on any collection those blueprints belong to — with a month filter on top. The four gardens are fixed lists of blueprints. The only genuinely missing ingredient was a tab to declare them on, and with that the hand assembly disappears from the workflow entirely.

**Added — `InteractionReview.gs`**

- **Build review packet.** The picker is a grid rather than a list: one row per garden, one button per canonical month, each carrying the date that run was last done or `never run`. Choosing the next run and seeing how far the twenty-run programme has got are the same glance. The packet is shown with a copy button, written durably to a new `Interaction_Packet` tab, and `Interaction_Decisions` is laid out ready for the findings.
- **The month's workload, computed rather than requested.** The prompt has always asked the reviewer to add up `Estimated_Minutes` "allowing for anything that recurs within the month" — arithmetic over thirty rows, which a script gets right every time and a reader gets wrong occasionally. The packet now states the once-through total, the total allowing for anything whose cooldown is shorter than a month, and names the recurring tasks; rows with no usable minutes value are counted separately so a small total is not mistaken for a light month when it is really an incomplete one. The prompt asks for a judgement of the number instead of its computation.
- **Context rows — the same garden's tasks in the other eleven months**, with windows and cooldowns but no instructions, explicitly not under review. Some collisions cannot be seen from one month's rows at all: the six-month gap between a lawn weedkiller and an overseeding needs both windows in view. Same device as the timing packet's context section, for the same reason.
- **Full collection membership**, asterisked outside the garden — where a `WRONG-MEMBER` fault usually hides.
- **Its own verdict vocabulary** — `CONTRADICTION`, `ORDERING`, `EXCLUSION`, `DUPLICATION`, `LOAD`, `WRONG-MEMBER` — the `Type` column of the pass's own output table, used unchanged. There is no `OK`: the output is a list of conflicts, not a per-task verdict table.
- **Apply decisions (dry run and real)**, **Mark a run as reviewed**, and **Set up the gardens** — the last seeds the four gardens from the workflow document and matches each member against `Item_Dictionary` by name where the match is unambiguous, listing whatever it could not match rather than quietly dropping it. A garden that lists something which is not a blueprint prefix is refused at packet-build time and named, because a garden silently missing an item reviews a garden nobody has.

**Added — the `Interaction_Gardens` tab, and why progress does not live in a column**

The other two programmes review *rows*, so a per-row marker column can carry their whole progress: a row has been looked at or it has not. This one reviews a **garden in a month**, and a task stamped because it appeared in *Awkward garden, April* has still never been seen in *Productive garden, September* — a completely different collision. Twenty runs is the real completeness question and no column can express it.

So the bookkeeping is split. Columns A to C of the new tab are authored — the garden, its blueprint prefixes, and notes — and columns D onwards are written by the script: one column per canonical month, holding the date that run was last applied or marked. Four rows by five months, legible at a glance. **Derived, never stored**, read back out of `Review_Log` exactly as the `Review_Passes` status columns are, so there is no box to tick and nothing that can drift.

`Review_Passes` gained no columns for this programme, and that is the design confirming itself rather than an omission: its unit is not a pass, so pass-shaped progress would have been meaningless for it.

**Changed — `Master_Task_Matrix` column O goes live**

- **`Interaction_Reviewed` (O)** was reserved and format-checked in 2.9; it is now written, on exactly the rows that were in a packet, following the timing programme's precedent rather than editorial's.
- It carries a deliberately narrower claim than the run grid: *this task has appeared in at least one interaction packet*. That answers a question the grid cannot — which live tasks has an interaction reviewer never seen at all — which is one filter on a blank column O.
- **Existing `I` entries in column M are left exactly where they are.** They are the honest record of the reviews run by hand before this programme existed, the audit still counts and reports them as historical, and rewriting them would have bought nothing. The interaction review simply stops adding new ones.

**Added — an audit check that turns a silence into a number**

`auditInteractionReviewState` reports how many of the twenty runs have been done and how many tasks carry a column O marker, but the figure worth reading is the third one: **what proportion of the live matrix the declared gardens can reach at all**. Four gardens of a dozen items cannot exercise a 250-blueprint catalogue, that is not a fault, and the fraction they *do* exercise was not visible from anywhere. A low number argues for a fifth garden rather than more runs of the four — and it is the kind of thing that would otherwise be assumed comfortably and never checked. Alongside it, three checks against reviewing a garden you did not describe: a garden with no members, a member that is not a blueprint prefix, and a duplicate garden name.

**Added — a six-field mode, and the reasoning for the number**

`interactionMode_().allowedFields` is `Instruction`, `Target_Asset_ID`, `Task_Name`, `Valid_Months`, `Estimated_Minutes`, `Retired` — wider than the timing review's two, narrower than editorial's ten. It follows what each finding type actually resolves to: contradictions, ordering and exclusions become a sentence added to an instruction; duplication becomes a retirement, a retarget or a rename; wrong-member becomes a retarget or a collection split; load becomes a moved window or a corrected minutes value, and this is the only pass that reads `Estimated_Minutes` seriously enough to notice a wrong one.

**`Frequency_Days` and the three weather columns are withheld on purpose.** A weather gate cannot change what collides, and the cooldown belongs to the timing programme: an interaction reviewer who concludes a task recurs too often records a `NONE` finding and hands it across, which is the exact mirror of the timing programme handing instruction problems to editorial. Keeping that symmetry is what stops three programmes drifting into one general-purpose editor with three names.

**Not changed — the decision block, despite the findings being *n*-ary**

A finding here names a *set* of tasks colliding, not one task, and the six-column block has one `Task_ID` slot per row. It needed no contract change. By the time a conflict reaches the block it has already been resolved into cells, because the prompt requires the resolution to name which row to change and what sentence to add or remove — so one conflict becomes one row per cell, with every row carrying the same `Finding` text as the grouping key.

The one shape that genuinely has no single cell — six lawn tasks all opening on the same morning — is a `NONE` finding, and a `NONE` row may name several tasks in its `Task_ID` cell (`TASK_0231 + TASK_0417`). **The existing applier already handled that with no change**, because it recognises `NONE` before it attempts to resolve the id, so the text passes straight through into the log. The same thing on a row that *does* change a cell is refused loudly, by name, which is the right failure. The alternative — a seventh `Finding_ID` column — was rejected: it would have shifted the tick-boxes on all three decisions tabs and broken the paste-into-A4-and-split habit for two working programmes, to buy a grouping the `Finding` text already provides.

**Changed — `Audit.gs`**

- The menu gains an "Interaction review" submenu, alongside Editorial review and Timing review. `onOpen` remains the project's single menu builder.
- `INTERACTION_MONTHS` (March, April, September, October, December) and the month-name list are declared here rather than in `InteractionReview.gs`, for the same reason `TIMING_MIN_FREQUENCY_DAYS` is: the audit summary, the run grid and the packet builder all have to agree, and this file is where every cross-file constant already lives.
- The malformed-column-O message no longer says a value there was necessarily typed by hand, and the review-state summary now describes its `I` count as historical, pointing at the column O finding for the live figure.
- The `Estimated_Minutes` warning now says what the value is *for*, since a wrong one now distorts a whole garden-month's load judgement rather than one row.

**Changed — `Review.gs` (three small things)**

- **The log records the `Finding` text on applied rows.** It has always carried the reason, the impact and any warnings, but the reviewer's own four-to-eight-word label for the fault was written for `NOTED` rows only. The interaction review needs it, because that shared text is the only thing that groups a decomposed *n*-ary finding back together when the log is read a year later. It improves the other two programmes' logs at the cost of a few more words in the Notes column.
- **"Mark a pass as reviewed" is editorial-only.** It used to ask whether you meant `E` or `I`, because the interaction review recorded itself in column M and had no menu of its own. Offering `I` now would stamp the wrong column with the wrong unit — a whole pass, when an interaction run is a garden and a month.
- The derived status tabs are refreshed **after** the log is written rather than before — see Fixed.

**Fixed — the status tabs were reporting the previous run's date**

`reviewWritePassStatus_` derives each pass's "Last run" from `Review_Log`, and the applier was calling it *before* writing this run's log entry. The date it wrote was therefore the previous run's, and stayed wrong until the next audit refreshed it. Present since the column was added in 2.7 and unnoticed because an audit is usually run soon afterwards. Moving the call below `reviewWriteLog_` fixes it for the editorial and timing columns, and mattered more here: the interaction run grid is that programme's entire progress record, not one column of a summary, so a run would have appeared not to have happened.

**Not changed**

- `TimingReview.gs` — untouched. The mode contract absorbed a third programme without needing to change for it, which was the point of the 2.9 refactor.
- `Publish.gs` — no edit needed, again. Column O sits past its fixed read index exactly as columns M and N do.
- The applier itself — no change beyond the two above. Staging, validation, the same-cell guard, the retired-row guard and the orphan simulation are shared and identical for all three programmes.

### Documentation

`DATABASE_WORKFLOW.md` to v2.10: §7c rewritten from a hand-assembly procedure into the automated programme, with new subsections on the packet, the verdicts and field set, how an *n*-ary finding decomposes, and where progress lives; §8b's pasteable prompt replaced by a pointer to `interactionComposePrompt_`, matching what §8a and §8c already do, leaving a record of what the prompt asks and what is worth keeping if it is edited; the `Interaction_Gardens` tab and the promotion of column O from reserved to live (§2); the mode table in §7e extended to three programmes and given a row for where each one's progress lives; and the new audit checks (§7a). Top-level section numbers are unchanged — nothing was renumbered, since §7d–§7f are cross-referenced from comments inside the scripts. `SPEC.md`: `InteractionReview.gs` added to the content-pipeline component list, §5D item 7 updated now that all three passes assemble by script, and a new completed roadmap phase (4.4), which also clears "automating the interaction review" from the on-the-horizon list.

### Known gaps and deferred work

Unchanged from [2.9], less the interaction-review automation, with two additions:

- **The gardens need their prefixes filling in once.** The seeded list names members the way the workflow document does — "mixed utility lawn", "compost bin" — and the setup step matches what it can against `Item_Dictionary`, but anything ambiguous is left for you. The packet builder refuses to build a garden with an unmatched member rather than reviewing a smaller garden than you described, so the cost of leaving one is a clear refusal rather than a quiet wrong answer.
- **The verdict vocabularies are declared by each prompt, not enforced by the applier.** §7e's mode table has listed "which verdicts are legal" since 2.9, and no code checks it — a wrong verdict is recorded as typed and changes nothing. That is deliberate rather than an oversight (refusing a row over a label would cost more than it saves), and §7e now says so rather than implying an enforcement that does not exist.
---
## [2.9] — 2026-08-06

### A second review programme, and the refactor that made it cheap to add

The horticultural review of `Master_Task_Matrix` had a second, narrower question sitting outside what the editorial review (2.8) asks: not "is this advice right", but "does this task's window open in a month the job can actually be done". A worked-by-hand pass over the 443 tasks with a cooldown of 180 days or more found the shape of fault worth automating for — sixteen "prune immediately after flowering" tasks whose windows opened while the plant was still in flower, six Chelsea-chop tasks all opening three weeks early, an autumn lawn chain of six ordered steps all arriving on the same morning, and two opposite lift-before/lift-after-frost tasks sharing one window. None of that is visible from a pass-shaped review, because the pattern crosses pass boundaries; it is only visible when the whole long-cooldown set is in front of one reviewer at once.

Rather than fork the editorial programme, the applier that transcribes accepted findings back into the sheet (2.8) became **mode-driven**: a mode is a small object declaring which decisions tab to read, which marker column to stamp and with which letter, which fields a row may change, and how to perform the stamp. Everything else — staging, validation, the same-cell guard, the retired-row guard, orphan simulation, the log — lives once and is shared between programmes. Three copies of that logic is how a rule ends up enforced in two programmes and quietly not in the third.

**Added — `TimingReview.gs`**

- **Build review packet.** Assembles the timing prompt with its data already slotted in, and shows it in a window with a copy button, writing a durable copy to a new `Timing_Packet` tab. The unit is a *filter*, not a pass: every live, non-retired task with `Frequency_Days` >= 180, sliceable by any declared review pass (reusing `reviewGatherPass_`, so a task reaching the pass through a collection its blueprints belong to is included exactly as it is for editorial review) or taken as **Everything** — every qualifying task in the workbook at once. The whole-workbook option is not a fallback; it is where the cross-pass patterns above were actually found, and a pass-only tool would have missed all of them.
- **Context rows.** Every *other* live task sharing a target with a row under review — usually a short-cooldown task that never met the frequency threshold on its own — listed with name, months and frequency but explicitly marked not under review. Added because a reviewer judging "wait until you have mown it twice" cannot without the mowing task's own cooldown in view, and the mowing task is a 7-day job that would never otherwise appear in a long-cooldown filter.
- **Full collection membership**, asterisked outside the slice — the same section and the same reasoning as the editorial packet, reused rather than reimplemented.
- **Its own verdict vocabulary** — `EARLY`, `LATE`, `SEQUENCE`, `CONTRADICTS`, `OK` — kept distinct from editorial's `WRONG`/`RISKY`/`TIMING`/... set, because collapsing every finding here into editorial's single `TIMING` verdict would discard the distinction between "opens too early" and "the stated order is impossible", which is most of what makes `Review_Log` worth reading back a year from now.
- **Apply decisions (dry run and real)** and **Mark a slice as reviewed** — both delegate to the shared applier in timing mode (below).
- New tabs: `Timing_Packet`, `Timing_Decisions` — kept separate from editorial's own tabs rather than shared, because a Decisions tab is cleared the moment its own programme builds a new packet, and a shared tab would let building a timing packet mid-editorial-pass silently discard ticked editorial decisions, or the reverse.

**Added — `Master_Task_Matrix` columns N and O**

- **`Timing_Reviewed` (N).** Same `<letter> <date>` format as `Reviewed`, one letter (`T`). Stamped only on rows that were actually in a built packet — not every task a slice's pass reaches, which is editorial's unit and the wrong one here, since a timing sweep of a pass may cover a third of its live tasks and stamping the rest would claim a review that never happened.
- **`Interaction_Reviewed` (O), reserved.** Format-checked by the audit; nothing writes it yet. Added now so the sheet is already the right shape when the interaction review (7c) is automated the way this one and the editorial one now are. The interaction review continues to record itself as `I` in column M until then.
- Both are inert for publishing, for the same reason `Reviewed` always has been: `Publish.gs` reads the task matrix by fixed index 0–11 and never looks further.

**Changed — `Review.gs` (the applier becomes mode-driven)**

- `reviewApplyDecisions_` takes an optional `mode` argument, defaulting to `reviewEditorialMode_()` — so every existing editorial call site, and every editorial behaviour a user would notice, is unchanged.
- `reviewStampPass_` is now a thin wrapper over a new `reviewStampRows_`, which takes an explicit array of rows rather than deriving them from a pass name. Editorial review's stamping behaviour ("every live task reaching the pass") is unchanged — it is simply `reviewStampPass_` calling the general form with `reviewGatherPass_(...).live`.
- `reviewPrepareDecisionsSheet_` and `reviewCountPendingDecisions_` take the target sheet name as a parameter, defaulting to editorial's own tab where editorial calls them.
- `Review_Log` gains a ninth column, `Mode` (I). A blank means `EDITORIAL` — every row logged before this column existed was written by the editorial programme, so that default is correct rather than a migration compromise. A pre-existing sheet gets the column added non-destructively on its next write. `reviewGapsFromLog_` and `reviewPassLastRun_` both filter on it, so a timing `NONE` finding can never be picked up by the editorial *authoring* prompt as a job to go and write, and a timing sweep can never make an editorial pass read as freshly run.
- `reviewWritePassStatus_` writes four more columns (H–K) on `Review_Passes`, carrying the timing programme's own summary — eligible tasks, reviewed tasks, status, last run — scoped to qualifying rows only, so a pass whose tasks are all short-cooldown correctly reads "no qualifying tasks" rather than "not started".

**Added — a narrow field set, enforced, not just documented**

The timing mode's `allowedFields` is exactly `Valid_Months` and `Frequency_Days`. A timing finding that touches anything else — instruction wording, a retarget — is refused by the applier with a message pointing at the editorial programme, rather than silently accepted into a review that was never meant to judge it. This is checked in the shared applier once, immediately after a row's target column is resolved, so a future third mode gets the same guarantee without writing it again.

**Changed — `Audit.gs`**

- The menu gains a "Timing review" submenu, alongside Editorial review.
- New checks: malformed `Timing_Reviewed` and `Interaction_Reviewed` values (via a shared `reviewedCellIsWellFormed_` helper, so the three marker-column checks cannot drift out of step with each other), and a new **`Valid_Months` not ascending** WARNING — see Fixed, below.
- New `auditTimingReviewState`, the timing equivalent of the existing review-state summary, deliberately scoped to *qualifying* rows only (`Frequency_Days` >= 180): counting every live task in the denominator would report thousands of weekly and fortnightly tasks as "not yet timing reviewed", which is not a gap in the programme, it is a task the programme was never asked to look at.
- `TIMING_MIN_FREQUENCY_DAYS` (180) declared here rather than in `TimingReview.gs`, since `Audit.gs`, `Review.gs` and `TimingReview.gs` all need to agree on which rows qualify.

**Fixed — the `Valid_Months` ascending-order gap, and the question behind it**

The authoring rules have always required `Valid_Months` written in ascending order, and the review applier has always *refused* to write a non-ascending list — but nothing in the audit checked for one, so a row typed `12,1,2` passed clean and would only be refused the day someone tried to edit it through a review. The new WARNING closes that.

Whether correcting the order could ever change behaviour was an open question, carried as an explicit hedge in both `Audit.gs`'s finding text and `TimingReview.gs`'s header while the timing review was being designed. It is now settled by reading `select_tasks` itself: `db/03_functions.sql` tests the season with `v_month = any (t.valid_months)`, a membership test over a Postgres integer array with no notion of first, last or order, and `db/01_schema.sql`'s `task_valid_months_shape` constraint checks only cardinality, nullness and the 1–12 range. **Ordering is a pure authoring convention with no runtime meaning.** Both files, and the timing review prompt itself, now state this as fact rather than an assumption, and the timing prompt explicitly tells a reviewer not to report a non-ascending row as a timing fault.

**Not changed**

- `Publish.gs` — no edit was needed; the new marker columns sit past its fixed read index exactly as `Reviewed` always has.
- The interaction review (7c) — still assembled and applied by hand. A brief for automating it, written to be handed to a fresh conversation with no context from this one, records what already exists, the mode contract it would need to satisfy, and four design questions specific to its shape (whether a per-task marker even fits a pass whose unit is a garden-and-month; how an *n*-ary finding — several tasks colliding, not one — decomposes into a six-column block built for one `Task_ID` per row; which fields it plausibly needs given its output is mostly added instruction sentences; and whether the packet builder can in fact serve it, which both `DATABASE_WORKFLOW.md` and the original design assumed it could not).

### Documentation

`DATABASE_WORKFLOW.md` to v2.9: the pass table extended to four (§7), the `Timing_Reviewed` and `Interaction_Reviewed` columns (§2), the mode-driven applier and the `Mode` column on `Review_Log` (§7e), the timing review programme in full (new §7g, numbered to avoid renumbering §7d–§7f, which are cross-referenced from the scripts themselves), the timing prompt (new §8c), and the confirmed `Valid_Months` set semantics with their source citation (new §9 section). `SPEC.md`: `Review.gs` and `TimingReview.gs` added to the content-pipeline component list (previously undocumented there even for the editorial programme), §5D item 7 widened to name all three review passes, and a new completed roadmap phase (4.3) for this release. In fixing this, a stale cross-reference was also closed: `DATABASE_WORKFLOW.md` §9 has pointed at a `Reveal_If_Wind_Above` roadmap entry in `SPEC.md` §6 since v2.4 that never existed; it now does.

### Known gaps and deferred work

Unchanged from [2.8], with two additions:

- The whole-matrix version of the cooldown-versus-own-months check remains open. The applier warns when a *staged* change would create the fault; nothing yet sweeps every existing row the way the new ascending-order check does, and would make a good second WARNING addition to `Audit.gs` at the same severity. *(Closed in [2.13] — and the first attempt at it was wrong twice, which is recorded there.)*
- The 19 rows identified as non-ascending during design of this release are a data cleanup, not a code change, and are unaffected by anything in this release — they display and match correctly today and will continue to. *(Superseded by [2.13]: the ascending rule itself was wrong. Most of those rows were correct as written, and the count was in any case incomplete — the ascending check could not see a wrap-around window typed in ascending order, which turned out to be the larger group.)*
---
## [2.8] — 2026-08-03

### The editorial review programme is now assembled and applied by script

The horticultural review of `Master_Task_Matrix` (DATABASE_WORKFLOW §7b) had two mechanical halves either side of the judgement: assembling a complete packet for a group of items, and transcribing the accepted findings back into a 700-row sheet. Both were done by hand, both were slow, and the first was where the review's worst failure came from — an incomplete packet makes "what is missing?" unanswerable, which is how the old row-batched version reported jobs as absent when they existed elsewhere in the file.

A new `Review.gs` automates both. It automates **transcription, never judgement**: nothing reaches the task matrix that has not been ticked by hand, one row at a time, and a dry run shows every before-and-after first. The "apply nothing automatically" rule in §7b is intact.

**Added — `Review.gs`**

- **Build review packet.** Assembles one pass and shows it in a window with a copy button, and writes a durable copy to a new `Review_Packet` tab. The packet carries the item group, every live task reaching those items — direct and collection targets both — the full membership of every collection involved, the month coverage rows, and the tasks previously retired for those items.
- **Two prompts from one gather.** The same material is offered wrapped in either the review prompt or the authoring prompt — the task prompt from DATABASE_WORKFLOW §5 with all five input slots pre-filled, for writing the tasks a review said were missing (§7f). They cannot disagree about what reaches these items, and the authoring one cannot be run against a stale copy of the review one's data. It carries the gaps forward too: the NOTED findings from the pass's most recent apply run are lifted out of `Review_Log`, with the applier's own standing note stripped back off, and handed over as a starting point with explicit permission to disagree that one of them is a gap at all. Its EXISTING TASKS block carries the full instruction, which the printed version does not ask for — without it the diff step is guessing whether a job is covered from a task's name alone.
- **Apply decisions (dry run).** Reads the ticked rows on a new `Review_Decisions` tab and reports exactly which cell would change from what to what, touching no data.
- **Apply decisions.** The same for real, followed by stamping column M across the pass. Nothing is written until every row has been staged, so a refusal on row forty cannot leave rows one to thirty-nine half-applied.
- **Mark a pass as reviewed.** Stamps `E` or `I` without applying anything, for a pass that produced no changes.
- **Suggest passes for unassigned items.** Fills blank `Review_Pass` cells from each item's top-level prefix. Never overwrites.
- New tabs: `Review_Passes` (authored), `Review_Packet`, `Review_Log` (written by script), `Review_Decisions` (written by script, then filled in by hand). `Review_Log` is appended to and never cleared — it is the permanent record of every change the programme has made, and the only place a *before* value survives.

**Added — pass status on the `Review_Passes` tab, derived rather than stored**

Columns C to G of `Review_Passes` are rebuilt on every audit run, every apply and every mark: how many blueprints a pass holds, how many live tasks reach them, how many of those carry an editorial marker, a plain-English status, and the date it was last actually run. With 25 passes there was no way to see at a glance which had been done.

Nothing is stored and there is no box to tick — a stored flag is a second source of truth that drifts the moment a task is authored and the flag not cleared.

It reads two sources because neither answers the question alone. Column M says whether a *task* has been looked at; `Review_Log` says whether a *pass* has been run. A task targeting `GROUP_SHRUB_GENERIC` is stamped when `Shrubs_01` is applied, so `Shrubs_02` would read as partly or wholly reviewed on column M alone without anyone having opened it. Dry runs do not count as running a pass.

The per-pass wall of text in `Audit_Report` is replaced by a one-line tally and a pointer to the tab, which sits next to the pass it describes and is far easier to scan.

**Added — `Item_Dictionary` column G, `Review_Pass`**

Names which review pass a blueprint belongs to, declared on the `Review_Passes` tab. Membership on the blueprint, declaration on a tab — the same shape as collections and browse groups.

**Inert for publishing.** `Publish.gs` reads that tab by fixed column index 0–5 and never looks at index 6, exactly as it stops at index 11 on the task matrix and never sees `Reviewed`. `Publish.gs` is unchanged by this release.

**Added — authoring rules enforced at the point of writing**

Nothing in this project previously checked an authoring rule *before* a value entered the sheet; the audit can only inspect what is already there. The applier refuses a staged change that breaks one, and says why:

- an instruction under 80 characters, or naming a chemical active or brand;
- a semicolon in any free-text value;
- malformed `Valid_Months`, or a non-positive `Frequency_Days` or `Estimated_Minutes`;
- a `Target_Asset_ID` that is not a blueprint prefix or a declared collection, including a bare category prefix;
- two ticked rows changing the same cell;
- any change to an already-retired row other than un-retiring it.

`Suppress_If_Raining` is written as a real logical value or the cell is cleared, so a row changed through the applier cannot land in the left-aligned-text trap.

It warns without refusing on: a cooldown that outlasts the smallest gap between the task's own declared months (the fault found twice, in the tools and trees passes), a wind ceiling below 10 mph, a temperature floor on winter-only content, a cadence under three days, and a retarget to a collection with no members.

**Added — loud reporting on the two changes that alter the audience**

Retargeting and retiring change *who* receives a task rather than what it says, so `Review_Log` reports them in full rather than as a one-line diff. A retarget names every blueprint that gains the task and every one that loses it. A retirement names every blueprint that loses it, and — after simulating the whole run together — every blueprint left with **no live task at all**. That last check is the one no single row can make: twelve retirements can each look reasonable and between them leave an item showing a user an empty screen in every month of the year.

**Changed — `Audit.gs`**

- The menu gains an "Editorial review" submenu. `onOpen` remains the single menu builder for the project.
- `readDictionary` reads column G; `readTasks` now also returns the retirement *reason*, which the packet shows the reviewer so that a job withdrawn on purpose is not reported back as a gap.
- New `auditReviewPasses`: undeclared pass names, blueprints in no pass (aggregated to one finding, not 250), and a per-pass breakdown of size, live task count and how many of those are editorially reviewed. That breakdown replaces the global count as the programme's bookmark — the count says how much is left, the breakdown says where. All findings are WARNING or REVIEW and can never block a publish.
- `computeCollectionMembers_` and `computeCoverageCounts_` extracted out of `writeCoverageGrid`, so the coverage grid and the review packet answer "which blueprints does this task reach, in which months" from one implementation. Two copies of that logic drifting apart is precisely the fault that made the old review report gaps that did not exist.
- Every new behaviour is tolerant of an absent `Review.gs` and an absent `Review_Passes` tab: a workbook that has not adopted the programme audits exactly as it did before.

**Changed — the editorial review prompt has moved**

Out of `DATABASE_WORKFLOW.md` §8a and into `reviewComposePacket_` in `Review.gs`, where it is emitted with the pass's data already slotted into it. A prompt printed in a document and a prompt used by a script are two copies of the same thing, and the copy you paste around fresh data is the one that quietly goes stale. §8a now describes what it checks and points at the function.

Two sections are new relative to hand assembly, and both close known failure modes: collection members **outside** the pass are listed and asterisked, because that is where a collection-level fault hides; and previously **retired** tasks are listed with their reasons. The `Reviewed` column is deliberately excluded from the packet — telling a reviewer a row has been looked at before primes it toward approval.

**Not changed**

- `Publish.gs` — no edit was needed.
- `SPEC.md` — nothing here reaches the app, the database schema or `select_tasks`.
- The task prompt still authors new tasks, and still runs in its own conversation. The applier changes cells and does not write new rows: a missing job needs the year plan, the diff, the cadence reconciliation and a four-part instruction, none of which fits in a decision row. A `MISSING` finding is recorded as NOTED and handed back. What the authoring packet removes is the assembly, not the judgement — DATABASE_WORKFLOW §7f is the process.

### Documentation

`DATABASE_WORKFLOW.md` to v2.7: the `Review_Pass` column and `Review_Passes` tab (§1, §2, §3, §6, §9), the packet builder (§7b), the decisions tab and applier (§7e), the process for filling a gap the review found (§7f), the prompt's move (§8a), and the applier's cooldown check (§9).

### Known gaps and deferred work

Unchanged from [2.8], with one addition: the whole-matrix version of the cooldown-versus-own-months check — sweeping every existing row rather than only rows being changed — remains a human checklist item (DATABASE_WORKFLOW §6) and would make a good addition to `Audit.gs` at WARNING severity.
---
## [2.7] — 2026-07-29

Editorial review of the lawn group: 8 blueprints (`LAWN_*`) and the 33 live tasks
reaching them, including everything arriving via `GROUP_GRASS_LAWN`,
`GROUP_LAWN_RENOVATION` and `GROUP_LAWN_STANDARD_FEED`. Content only — no
application, schema or `select_tasks` changes. It closes a question left open in
2.2 rather than raising a new one.

### Removed
- **Buffalo Grass Lawn (`LAWN_BUFFALO`) withdrawn from the catalogue.** 2.2 recorded
  that it was "worth questioning as a blueprint" after its presence forced exclusions
  on five separate lawn tasks and shaped both new lawn collections. Reading the group
  end to end settles it. It is a warm-season grass sitting in a collection of
  cool-season ones, and roughly half the eighteen tasks reaching it were calendared
  for a growth cycle it does not have: the spring programme landing while it is
  dormant, the autumn feed as it returns to dormancy, and `TASK_0635` diagnosing red
  thread, which is a disease of cool-season turf. It is also not a viable lawn in a UK
  climate. Excluding it from `GROUP_LAWN_RENOVATION` in 2.2 was the right reasoning
  applied to one collection; this is that reasoning followed to its conclusion. The row
  is deleted from `Item_Dictionary`, so the publish tombstones the blueprint rather
  than erasing it, and it can be restored whole if the app is ever taken to a warmer
  climate.

### Changed
- **`TASK_0009` "Summer Feeding" rewritten.** It was the only task in the lawn block
  still carrying its pre-2.2 text — four short clauses with no rate, no finish
  condition and no common mistake — and it told every grass lawn to apply a full-rate
  feed while `TASK_0635` told the same user to use a half rate on fine fescue and
  bentgrass. It now carries the rate qualifier, so the advice is correct for every
  member of `GROUP_GRASS_LAWN` rather than merely tolerable for some, and the task
  stays where it is instead of being narrowed. This also part-closes the 2.2 note that
  fine turf had no feed of its own: Fescue and Bentgrass now receive a growing-season
  feed at a rate that suits them. `TASK_0008` stays narrowed to
  `GROUP_LAWN_STANDARD_FEED`, because a 12-4-8 growth feed has no safe fine-turf
  version at any rate — which is the distinction that made a collection the right
  answer there and a sentence the right answer here.

### Notes
- **`TASK_0005`, `TASK_0007` and `TASK_0013` were reviewed for retargeting and
  deliberately left alone.** Withdrawing Buffalo removed the objection to all three.
  Moving them would have carried 2.2's stoloniferous-surface reasoning past the point
  where it holds: solid-tine aeration does not damage a bent sward, and light spring
  scarification is the only thatch management Bentgrass receives at all, since it sits
  outside the autumn programme entirely.
- **Bentgrass has no autumn renovation and no feed above half rate.** Not introduced
  here, but visible for the first time now the group has been read end to end. It is
  the most thatch-prone of the four remaining grasses, which makes its exclusion from
  every scarification but the lightest worth its own decision rather than an inherited
  one.
- **The rest of the lawn review is not in this release.** The pass also found a named
  active ingredient in `TASK_0015`, an NPK ratio in `TASK_0010` that contradicts its
  own description and matches no product on sale, rake advice in `TASK_0583` that
  would strip a moss lawn, three tasks involving blades or power tools with no safety
  wording, and missing seasonal jobs for the clover, moss and wildflower lawns. Held
  back deliberately so this publish could be read against a clean report.
- No frontend file changed, so `CACHE_NAME` is not bumped.
---
## [2.6] - 2026-07-29

Editorial review of the tree group: 22 blueprints (`TREE_*`, all members of
`GROUP_TREE_GENERIC`) and the 50 live tasks reaching them. Content only — no
application, schema or `select_tasks` changes.

### Removed

- **Six duplicate watering tasks.** `TASK_0391` (cherry), `TASK_0402` (rowan),
  `TASK_0419` (field maple), `TASK_0422` (oak), `TASK_0522` (willow) and `TASK_0535`
  (ash) each declared the same months, the same 7-day cooldown and the same rain
  suppression as `TASK_0649`, which was added on `GROUP_TREE_GENERIC` in 2.3. Six
  species owners were being asked to water the same tree twice. `TASK_0522`'s one
  genuine detail — willows are thirstier than most trees — was folded into `TASK_0521`
  before retirement.
- **`TASK_0400` "Mulch Rowan Tree"** and **`TASK_0421` "Mulch English Oak"** —
  duplicates of `TASK_0077` on identical months. `TASK_0421` was also the more
  dangerous of the two, specifying "a deep ring" with no depth and omitting the
  keep-it-off-the-trunk warning that `TASK_0077` carries, so a novice following it
  alone would bury the trunk.
- **`TASK_0415` "Feed Yew Tree"** — duplicated `TASK_0078` on months, and contradicted
  it on quantity ("a handful" against 70g per square metre).
- **`TASK_0404` "Thin Crab Apples"** — not a recognised UK job. The fruit is the
  display, branch failure under a crab apple crop is rare, and thinning defeats the
  point of the tree. Meanwhile the species that genuinely need thinning after June
  drop — apple and especially plum — have no thinning task at all. Re-homing that job
  is on the outstanding list.
- **`TASK_0392` "Net Cherry Tree"** — netting a full-size cherry is not achievable
  from the ground, and the row said nothing about keeping the net taut or checking it
  for trapped birds and hedgehogs. Retired rather than scoped, as the tree it would
  remain useful for is a dwarf or trained specimen that the blueprint does not
  distinguish.
- **`TASK_0523` "Check for Storm Damage"** — a v1 row whose behaviour inverted at the
  2.0 cutover and was never re-verified. Under v1, `Requires_Wind_Above 30` showed the
  task in a gale, which is what its instruction ("After strong winds…") was written
  for. Under v2 the field suppresses above the threshold, so the task had become a
  plain 12-month, 3-day-cooldown row that merely went quiet in high wind — prompting a
  willow owner to inspect for storm damage roughly 120 times a year. `DESIGN_V2.md` §6
  listed this inversion as expected and to be verified; this appears to be the row that
  was not. Storm damage is self-evident from a window in any case.

  Tombstones, not deletions, in every case above.

### Changed

- **Thirty tasks rewritten** to the current instruction standard. `TASK_0093` and the
  whole contiguous block `TASK_0390`–`TASK_0422` were single-sentence rows carrying no
  finish condition, no common mistake and no safety note. They cleared the audit's
  80-character stub check and failed §5 of `DATABASE_WORKFLOW.md` regardless — a
  distinct authoring cohort rather than scattered lapses.
- **Five task names corrected** under the §5 rule that a name must describe who the
  task is for. `TASK_0077` "Mulch Trees and Shrubs" → "Mulch Around Trees" and
  `TASK_0078` "Feed Trees and Shrubs" → "Feed Young and Fruiting Trees"; both targeted
  a trees-only collection, and are the exact fault §5 uses as its worked example.
  `TASK_0080` "Trim Conifers" → "Trim Conifer Hedge", `TASK_0406` "Plant Magnolia Feed"
  → "Feed Magnolia" (the old name read as an instruction to plant a feed), and
  `TASK_0521` "Pollard or Coppice" → "Pollard or Coppice Willow". `TASK_0538`
  "Formative Prune" → "Formative Prune Sycamore".
- **A standard working-at-height line**, in the manner of the chemical line added in
  2.2 and the power-tool line added in 2.3: keep both feet on the ground, work within
  comfortable reach, and leave anything above head height or thicker than your arm to a
  tree surgeon. Applied to the nine rows involving a saw or a mature tree, with
  `Requires_Wind_Above 15` alongside, matching `TASK_0624`. A powered variant covering
  eye protection and RCD use goes on the three hedge-trimming rows. Formative pruning
  of young trees is deliberately excluded, being by definition within reach.
- **`TASK_0078` rescoped from every tree to young, fruiting and container trees.**
  A full granular feed reaching all 22 members meant feeding mature native oak, ash,
  birch and sycamore that neither need nor benefit from it, and applying a 70g per
  square metre rate around the "drip line" of an olive in a pot. Yew is now named as an
  exception the user can tick off, following the `GROUP_MAINS_POWERED` pattern of
  handling the awkward member in the instruction rather than restructuring the
  collection.
- **`TASK_0411` now leads with a decision rather than an action.** An elder flowers on
  the previous year's stems, so hard-pruning for foliage removes that year's flowers and
  berries — putting the row in direct conflict with `TASK_0412` and `TASK_0413`, which
  harvest them. All six directions between the three rows are now stated, per the §5
  rule that a conflict warning is written into both. Cooldown 365 → 1095 so that
  flowering years fall in between.
- **`TASK_0539` reduced to a single reassurance row.** It previously fired July to
  September but its only actionable step — raking fallen leaves — happens in October and
  November, outside its own months. Tar spot is harmless and the spores blow in from
  every sycamore nearby, so the raking sentence was dropped rather than promoted to its
  own task, which would have duplicated the group-level autumn leaf clearance still to
  be written. Cooldown 30 → 365, as a reassurance only needs to land once.
- **`TASK_0398` and `TASK_0399` cross-referenced.** Coppicing a hazel removes the nut
  crop for several years; both rows now say so, and `TASK_0398` offers cutting a third
  of the stems each winter as the way to have both.

### Fixed

- **Superseded pruning advice on `TASK_0070`.** "Seal large cuts with pruning compound"
  is no longer recommended — wound paints trap moisture against the wound. The
  silver-leaf protection comes from the summer timing, which the row already had right.
- **Two tasks that would destroy a grafted plant.** `TASK_0521` told willow owners to
  cut "near ground level", which on a Kilmarnock willow removes the entire grafted
  weeping head permanently and leaves a bare stick, and is wrong for a weeping willow
  besides. `TASK_0398` did the same for contorted and purple-leaved hazels, commonly
  grafted onto plain rootstock. Both now name the exclusion before the action.
- **Four unstated poisoning risks.** `TASK_0414` had a novice generating a barrowload
  of yew clippings — poisonous, and more so as they wilt — with no instruction to clear,
  bag or keep them from children, pets and grazing animals. `TASK_0408` and `TASK_0409`
  had bare hands on laburnum pods and sap, mentioning the toxicity only as motivation
  and never as a precaution. `TASK_0413` sent a novice to pick elderberries without
  saying they must be cooked. `TASK_0412` omitted stripping the green stalks.
- **`TASK_0093` told a novice to remove caterpillars from hawthorn by hand.**
  Brown-tail moth is a principal hawthorn pest and contact with the hairs is the injury
  — a persistent rash, with eye and breathing irritation. Now specifies gloves, never
  handling hairy caterpillars or webbed nests, and leaving large nests alone.
- **`TASK_0410` had a novice reaching into a hawthorn** with no mention of gloves or eye
  protection.
- **Three hedge-trimming rows with no mention of the machine.** `TASK_0080`, `0414` and
  `0416` each describe a job routinely done on a 3m hedge with a powered trimmer, and
  none named eye protection, RCD use or the danger of working off a ladder with a
  running blade.
- **`TASK_0068` shortened every lateral to 3–4 buds**, which removes the crop on
  tip-bearing apple varieties. Now advises shortening the longest new shoots by about a
  third and explains why.
- **`TASK_0401` gave a fire blight method that would spread it.** "Prune out affected
  areas" omitted the 60cm margin into clean wood, disinfecting between cuts, and burning
  or binning the prunings — leaving a task worse than no task.
- **Cooldowns preventing a task's own window from firing**, the same class of fault
  fixed for `TASK_0056`, `0059`, `0062` and `0067` in 2.3. `TASK_0079` declared March
  and October against a 180-day cooldown, so an October completion blocked the following
  March and the task settled into firing once a year; now 120. `TASK_0093`, `0399`,
  `0401`, `0405` and `0412` each declared a multi-month window against a 365-day
  cooldown, making every month after the first unreachable.
- **February removed from three bleeding species.** `TASK_0418` (field maple) warned
  against pruning when the sap is rising while including the month it starts;
  `TASK_0538` (sycamore, also an *Acer*) and `TASK_0417` (hornbeam) omitted the warning
  altogether. All three now 11,12,1, and all three state the reason.
- **`TASK_0399` was a month late.** Cobnuts ripen from late August and grey squirrels
  strip a tree within days; the old window opened in September and ran into October.
- **`TASK_0405` said "dispose of" the leaves**, which is the exact point a novice puts
  them on the compost heap and reintroduces apple scab the following spring.
- **`TASK_0406` prescribed ericaceous feed to every magnolia** regardless of soil, with
  "to support flowering in acidic soils" leaving it ambiguous whether the user should
  apply it only on acid soil or in order to create one.
- **`TASK_0077` and `TASK_0649` reaching a container-grown olive.** An 8–10cm bark
  mulch and one to two watering cans weekly are both wrong for a potted Mediterranean
  tree, where wet roots are the usual cause of death. Both now carry a container
  exception. `TASK_0077` also replaces "collar rot" with plain wording.
- **Rain suppression applied inconsistently to the same job.** `TASK_0406` hid a
  granular feed in wet weather, which is when it works best, while `TASK_0078` never
  did. Cleared on `0406`.
- **`TASK_0093` carried `Suppress_If_Temp_Below 0`**, a value that can never fire in
  April or May. Cleared.
---
## [2.5] — 2026-07-28

Three audit checks removed, two rebuilt somewhere they can tell the truth.

`auditProfile`, `auditLog` and `auditHiddenTasks` had been reading the `User_Profile`,
`Task_Log` and `Hidden_Tasks` tabs since before the v2.0 cutover, at which point those
tabs stopped being live. Gardens, completions and hidden tasks moved to Postgres and
are written by the app; the tabs became snapshots that drift further from reality
every time somebody uses the app. The checks were still running, still reporting
confidently, and increasingly describing a garden that no longer existed.

Removing them turned out to be less straightforward than deleting three functions,
in two useful ways.

**The fault modes are impossible now.** Each check existed because v1 encoded
relationships as strings a rename could silently orphan — `User_Profile.Asset_ID` was
matched to `Item_Dictionary` by string prefix, so renaming a prefix stranded every
item using it. In v2 `garden_item.blueprint_id` and `task_completion.task_id` are
real foreign keys, and tasks are tombstoned rather than deleted. The database will
not permit the states these checks looked for. A literal rebuild against live data
would have been three queries that return zero rows forever — reassuring noise rather
than a safety net.

**The audit had a hidden dependency on the file it was supposed to have outlived.**
`auditProfile` called `getCorePrefix`, which is not defined in `Audit.gs` at all; it
comes from `Code.gs`, the v1 runtime that was meant to be decommissioned at cutover.
The audit only worked because that file was still sitting in the project. Deleting
the check removed the dependency.

### Added
- **Two live-database checks** in `Publish.gs` (`readGardenUsage_`), reported after a
  publish under "Affecting real gardens". Both are warnings and neither blocks:
  - **Retired but still owned** — a blueprint withdrawn from the catalogue that is
    still present in at least one garden. Removing a blueprint from the workbook
    tombstones it on publish while anyone who already had one keeps their item, and
    nothing else reported that.
  - **Owned but receives nothing** — a blueprint somebody has in their garden that no
    live task reaches. This is the coverage report narrowed to reality: the general
    list mixes "nobody has added this yet", which can wait, with "somebody is looking
    at an empty screen", which cannot. Only the second appears here.
- **A missing-tab guard on `readDictionary` and `readTasks`** (`getSheetOrFlag`),
  matching the one `readReferenceLists` always had. Prompted by renaming
  `User_Profile` mid-release, which stopped the audit dead with `TypeError: Cannot
  read properties of null (reading 'getDataRange')` — a message naming neither the
  tab nor the cause. A missing tab is now an ordinary ERROR finding that says which
  one, and lists the usual causes (a rename, a trailing space, a changed capital).

### Changed
- **The publish completion alert** gains an "Affecting real gardens" count, and the
  report a matching section.
- **Coverage is passed from the gate into the read-back** rather than re-derived from
  the database, so there remains exactly one implementation of what reaches what.
- **`Audit.gs` no longer reads the live database or `Code.gs`.** It is now purely a
  check over authored content, judged from the workbook alone.
- **The three v1 tabs are archived** under an `ARCHIVE_` prefix. They are kept as the
  only record of the pre-migration state; nothing looks them up.

### Notes
- **The live checks are aggregated to blueprint level on purpose.** The publish
  pipeline authenticates with the service-role key and therefore bypasses Row Level
  Security, so it can read every garden. The report gives a blueprint name, an item
  count and a garden count — never a garden name, a user, or anyone's own reference
  for an item. Today that distinction is theoretical because there is one garden; it
  stops being theoretical the moment friends are invited, and it is much easier to
  build in now than to retrofit after the workbook has quietly become a place where
  other people's gardens are listed.
- **They run after the push, not in the gate.** The dry run's promise is that it
  touches the database not at all and works with Supabase unconfigured, and that was
  worth more than warning slightly earlier. The trade-off is that you learn you have
  orphaned an item just after publishing rather than just before; the fix is to
  restore the row and publish again.

---
---
## [2.4] — 2026-07-28

The "Add to My Garden" picker had become a victim of the catalogue's growth. Tapping
Plants & Flowers produced an undifferentiated wall of pills that was fine at thirty
items and unusable approaching a hundred, with no way to find anything except reading
the whole list — and no way at all to find something if you guessed the wrong tile.

Three changes address it: pills now cluster under headings, a search box spans the
entire catalogue rather than the selected tile, and the handful of blueprints whose
common name is genuinely ambiguous carry a botanical name beside it.

The architectural point is what the headings are *not*. A browse group could have
been implemented by reusing collections, which already group blueprints and were
right there. It was not, because collections decide what an item **receives** and
headings decide only where it **appears**, and fusing the two would have meant that
reorganising a screen could silently change somebody's tasks. That is the exact class
of failure §2a exists to prevent. `browse_group` is therefore its own table, absent
from `select_tasks`, and rejected by the audit as a task target.

### Added
- **`browse_group` table** (`db/09_browse_groups.sql`) — the picker's headings, with
  a `sort_order` authored in gaps of ten so a new heading can be slotted between two
  existing ones without renumbering. Upsert-only, following the `collection`
  precedent: publishing never deletes one, because a blueprint may still point at it.
- **`blueprint.browse_group_id`** (nullable) — which heading a blueprint appears
  under. Null is normal and safe: those blueprints collect under an "Other" heading
  at the bottom of the picker rather than being hidden, and a category where nothing
  has been grouped renders as one plain list exactly as before.
- **`blueprint.botanical_name`** (nullable) — shown inline in small italic brackets,
  "Geranium *(Pelargonium)*". Authored only where the common name could mean more
  than one plant; blank on the large majority of rows. A check constraint rejects a
  blank-but-present value, which would render as empty brackets.
- **`Browse_Groups` workbook tab** (`Name`, `Sort_Order`) declaring every valid
  heading, and two new `Item_Dictionary` columns — `Browse_Group` (E) and
  `Botanical_Name` (F).
- **Catalogue-wide search in the picker.** Typing switches the list to a flat set of
  matches drawn from *every* category, each labelled with the tile it belongs to;
  clearing the box returns to the grouped view. Deliberately not scoped to the
  selected tile: a beginner does not necessarily know whether Lavender lives under
  Trees & shrubs or Plants & flowers, and a search that finds nothing because they
  guessed wrong reads as "the app doesn't have it". Selecting a result follows its
  category, so the item is filed where it was chosen from rather than under whichever
  tile happened to be lit. Botanical names are matched too, so "Pelargonium" finds
  Geranium.
- **Six new audit checks** covering the new columns: undeclared heading and missing
  `Sort_Order` (both ERROR, both hard faults that would otherwise fail the publish
  part-way through), plus duplicate sort orders, unused headings, blueprints with no
  heading in an otherwise-grouped category, and botanical names that are redundant,
  over-long, or carry a semicolon (all WARNING or REVIEW).

### Changed
- **The publish gate blocks on two new conditions** — a `Browse_Group` value not
  declared on the `Browse_Groups` tab, and a declared heading with no whole-number
  `Sort_Order` — and reports a second warning-only list beside the coverage report:
  blueprints with no heading assigned.
- **`Publish.gs` pushes browse groups** as a new step between categories and
  blueprints, and `Audit.gs` reads and validates the two new columns. Both files also
  gained named constants for the `Item_Dictionary` column indexes, which were
  previously bare numbers.
- **Service worker** `CACHE_NAME` bumped `gardening-v7` → `gardening-v8`.
- **The pill container is now a block element** rather than a flex row, so it can
  hold heading groups; each group wraps its own pills.

### Fixed
- **Table privileges on a newly created table.** The first publish attempt failed
  with `42501 permission denied for table browse_group`. Enabling Row Level Security
  and writing a read policy is not sufficient on its own — RLS is a filter applied on
  top of ordinary SQL privileges, so without a `GRANT` the request is refused before
  any policy is consulted. The pre-existing tables carry their grants from
  `01_schema.sql`; a new one inherits nothing. `09_browse_groups.sql` now grants
  `SELECT` to `authenticated` and `SELECT, INSERT, UPDATE` to `service_role`,
  withholding `DELETE` deliberately. Left unfound, this would have surfaced again at
  the frontend as a picker that silently showed everything under "Other".
- **The heading seed no longer overwrites authored sort orders.** It was written as
  `on conflict do update`, which was correct while the migration was the only thing
  that had ever populated the table and wrong the moment the workbook took ownership.
  Now `on conflict do nothing`: bootstrap on first run, no-op thereafter.

### Notes
- Nothing in this release touches matching. `select_tasks` is unchanged, and the
  tasks a garden receives are identical before and after.
- The three frozen v1 authoring tabs (`User_Profile`, `Task_Log`, `Hidden_Tasks`)
  remain in the workbook, still read by three audit checks that now report on a
  snapshot rather than live data. Renaming `User_Profile` during this release
  crashed the audit outright, because that reader — unlike `Reference_Lists` — has no
  missing-tab guard. Both the guards and the wider question of retiring those checks
  are carried to a later release.

---
---
## [2.3] — 2026-07-27

The second editorial review pass, and the first run under the item-scoped method
introduced after 2.2: the Tools group reviewed as one complete set — all eighteen
blueprints, every live task that reaches them, and the collection memberships and
month coverage that determine what a user actually sees. Forty rows touched.

The largest finding was not horticultural. Fifteen tasks carried `Valid_Months` of
`1,12`, written meaning "January to December" and stored as the array `{1, 12}` —
so they had been firing in January and December only since the day they were
authored. That put strimmer-line replacement in midwinter, pressure-washer
maintenance in the months nobody pressure-washes, and left leaf-blower care absent
in October and November. Every instruction on those rows described a per-use or
in-season job; none of them described a midwinter one. The data and the prose had
been contradicting each other in plain sight.

### Added
- **Two collections**, each created because a task was right for part of its audience
  and meaningless or unsafe for the rest:
  - `GROUP_CUTTING_TOOLS` (Secateurs, Loppers, Hand Shears) — the bypass cutters that
    carry infection between plants on their blades. Wiping blades with disinfectant is
    a real job for these three and a nonsense one for a trowel or a wheelbarrow, which
    is what `GROUP_HAND_TOOLS` would have reached.
  - `GROUP_MAINS_POWERED` (Lawn Mower, Hedge Trimmer, Strimmer, Leaf Blower, Pressure
    Washer, Chainsaw) — cable inspection and RCD use. Without a collection this would
    have been six near-identical rows; the awkward member is the cordless machine with
    no cable, and the instruction opens by telling battery users they can tick it off.
- **Eleven tasks (`TASK_0651`–`TASK_0661`)** closing the gaps the review identified:
  - **Winter storage** for the pressure washer (`0651`), chainsaw (`0652`), strimmer
    (`0658`) and hedge trimmer (`0659`). Water left in a pressure-washer pump over a
    UK winter cracks the housing, which usually costs more than the machine is worth,
    and there was no task anywhere telling anyone to drain it.
  - **`TASK_0653` "Chainsaw Safety Refresher"** — annual, before the winter cutting
    season. Nothing in the matrix had told a novice that chainsaw work needs training,
    what kickback is, or that anything overhead belongs to a tree surgeon.
  - **`TASK_0654` "Clean Under the Mower Deck"** and **`TASK_0655` "Check Power Cable
    and Use an RCD"** — the mower had three winter service tasks and nothing at all
    across the six months it is used weekly.
  - **`TASK_0656`/`TASK_0657` (watering can)** — rinsing out, and filling ahead so
    seedlings are not watered straight from a cold tap. The can previously had one
    task a year.
  - **`TASK_0660` (hose spring check)** and **`TASK_0661` (leaf rake pre-season check)`**.
- **A standard power-tool safety line**, in the manner of the chemical-safety line
  added in 2.2: isolate the machine before touching a blade, wear eye protection, use
  an RCD outdoors. It previously appeared on exactly one of the fifteen rows that
  needed it.

### Changed
- **Twenty-nine tasks rewritten.** Details in Fixed below.
- **Every `1,12` row re-monthed to the season the tool is actually used** rather than
  a blanket twelve: hedge trimmer April–October, strimmer April–September, leaf blower
  September–January, pressure washer March–October, gloves and chainsaw all year.
- **The mower, strimmer and blower rewritten electric-first**, with petrol content kept
  but clearly labelled as a branch. Every one of them previously opened with spark
  plugs and air filters, leaving the majority of users hunting for a component their
  machine does not have.
- **"Check your handbook" added throughout the powered-tool set**, as the standing rule
  for anything where the correct figure varies by machine.
- **Cooldowns corrected where a second seasonal window was unreachable.** `TASK_0056`,
  `0059`, `0062` and `0067` each declared two months with a 365-day cooldown, so the
  later window could never fire — the task ran once a year in the earlier month and the
  second window was decorative. `TASK_0061` and `0063` had the same fault at 180 days.
- **`TASK_0066` "End of Season Tool Clean" broadened** to absorb the retired spade and
  fork tasks, and to distinguish linseed oil (digging tools, wooden handles) from light
  machine oil (anything that cuts).
- **`TASK_0461` retargeted** from `TOOL_LOPPERS` to `GROUP_CUTTING_TOOLS` and renamed
  "Sanitise Blades Before and After Pruning". Secateurs are what people actually prune
  with and had no sanitising task at all.
- **`TASK_0477` consolidated into "Chainsaw Pre-Use Checks"**, absorbing the chain
  brake test and a bar-oil check. Chain tension, oil level and brake function all
  happen in the same two minutes before starting the saw; as separate cards the
  chainsaw became eligible for eight tasks a month, which is nagging rather than
  maintenance.
- **`TASK_0622` "Store watering can" rewritten** and renamed. Its instruction was a
  restatement of its title, and it told the user to put the can away in October —
  during the main autumn planting season, when new trees, shrubs and potted bulbs still
  need watering.
- **Column M (`Reviewed`) stamped `E 2026-07-27`** on the forty live rows in this group.

### Fixed
- **Fifteen tasks firing in the wrong two months of the year.** See the note above.
  `TASK_0460`, `0461`, `0462`, `0463`, `0465`, `0467`, `0469`, `0473`, `0474`, `0475`,
  `0476`, `0477`, `0478`, `0479` and `0480`.
- **A wrong disease-and-tool pairing** — the same class of error as the scarlet lily
  beetle on lily of the valley. `TASK_0461` gave honey fungus as its reason for
  sanitising blades, but honey fungus spreads underground through rhizomorphs and does
  not travel on pruning tools. Replaced with diseases that genuinely do: canker, coral
  spot, fireblight, silver leaf.
- **A chainsaw file size stated as universal.** `TASK_0478` specified a 5.5mm round
  file. File diameter is set by chain pitch, and most domestic saws take 4.0mm; a
  novice following this would round the cutters over and ruin the chain. Now defers to
  the handbook. The same task omitted depth gauges entirely, without which a chain
  eventually stops cutting and starts grabbing.
- **`TASK_0479` instructed chain oil into a nose sprocket**, which takes grease from a
  grease gun, on bars that mostly have no grease point at all. Rewritten as bar-groove
  cleaning and bar flipping, with the grease step conditional on the handbook.
- **`TASK_0459` told the user to sharpen both lopper blades.** Filing the flat hooked
  counter-blade of a bypass lopper stops the two blades passing cleanly and cannot be
  undone. `TASK_0060` had this right for secateurs since it was written.
- **`TASK_0066` sent linseed oil to cutting tools.** Applied across `GROUP_HAND_TOOLS`
  it reached secateurs, loppers and shears, where linseed dries to a sticky film that
  gums the pivot — and it contradicted `TASK_0059`, `0060` and `0460`, which all
  correctly specify machine oil. The 2.0 narrowing kept this task off the chainsaw; it
  did not make it safe for every member it kept.
- **Two duplicate jobs.** In November a spade or fork owner was told to clean and oil
  the same tool twice, by `TASK_0066` and by `TASK_0061`/`0063`. In March a mower owner
  was told to sharpen the blade twice, by `TASK_0056` and by `TASK_0057`, which
  includes sharpening in the full service.
- **Eleven tasks put a novice's hands next to a blade without saying to isolate the
  machine.** `TASK_0056`, `0057`, `0058`, `0466`, `0467`, `0468`, `0469`, `0470`,
  `0472`, `0473` and `0478`. `TASK_0465` was the only row in the powered set that said
  it.
- **No pressure-washer task mentioned injection injury.** A lance jet can drive water
  through skin and needs hospital treatment; nor was there any mention of eye protection
  or RCD use for mains equipment operated in the wet.
- **`TASK_0480` had a novice running a chainsaw** to test the brake with no protective
  equipment, footing or grip mentioned — the single most hazardous instruction in the
  group.
- **`TASK_0462` told leather gloves to be washed in warm soapy water**, which shrinks
  and stiffens them, while `TASK_0464` separately treated them as leather to be
  conditioned. Now split by material.
- **`TASK_0461` specified a 10% bleach solution**, which pits blade steel and rusts the
  pivot, with no rinse-and-oil step afterwards. It also used "rubbing alcohol", a term
  a UK user will not find on a shelf.

### Removed
- **`TASK_0061` "Clean and Oil Spade"** and **`TASK_0063` "Inspect and Clean Garden
  Fork"** — absorbed into `TASK_0066`, which now carries their tine and handle checks
  for every hand tool. Tombstones, not deletions.
- **`TASK_0460` "Oil Loppers Pivot Joint"** — pivot oiling is now covered once a year
  by `TASK_0066` for all three cutting tools, not just loppers.
- **`TASK_0480` "Check Chainsaw Chain Brake"** — absorbed into `TASK_0477`.

### Known gaps and deferred work
- **The spade and fork drop from two annual touchpoints to one**, the direct
  consequence of folding `TASK_0061` and `0063` into a November-only group task. A
  deliberate trade, reversible by running `TASK_0066` in March as well at a 140-day
  cooldown.
- **Hedge cutting during the bird nesting season is still unaddressed.** Damaging an
  active nest is an offence, which effectively rules out hedge cutting from March to
  August. That warning belongs on the hedge-*cutting* task, which lives outside the
  Tools group, and is logged for the review pass that covers it.
- **`TASK_0082` and `TASK_0083` can never be editorially reviewed.** Both are retired
  migration placeholders with no instruction text. They are excluded from the review
  count because the audit counts live tasks only, which is the correct behaviour.
- **The remaining categories are unreviewed.** Lawn, Beds, Trees & shrubs, Plants &
  flowers, Veg & herbs and Garden structures have had no item-scoped pass, and the
  twenty-six tasks authored in 2.2 (`0625`–`0650`) still need the independent review
  that entry flagged.

### Developer notes
- **`Valid_Months` is a set, never a range.** `1,12` means January and December. There
  is no range syntax and the schema will never reject the shorter reading, because
  `{1,12}` is a perfectly valid two-element array. This is worth an explicit line in
  `docs/DATABASE_WORKFLOW.md` §9 and a WARNING in `Audit.gs`: a task whose months are
  exactly `{1,12}` with a cooldown of 90 days or less is almost certainly a mis-written
  "all year".
- **The Coverage_Grid tab needs rebuilding after this publish.** The pre-change grid
  faithfully reported the `1,12` blanks, which is what surfaced the fault — it was
  right, and the data was wrong.
- **Rows 644–647 of `Master_Task_Matrix` are out of ID order** (`TASK_0018`–`0020` and
  `0028`, cut and re-pasted at the bottom during the 2.2 retargeting). Harmless, since
  nothing depends on row order, but "the last row" and "the highest Task ID" are no
  longer the same row.
- **`TASK_0471` does not exist.** A numbering gap, not a lost task — confirmed against
  a cut of the matrix that included retired rows.
- **No frontend file changed, so `CACHE_NAME` is not bumped.** This release is content
  only.

## [2.2] — 2026-07-25

A horticultural quality review of `Master_Task_Matrix`. The app's architecture has been sound since 2.0; its *advice* had never been read end to end by a horticultural eye. This entry is mostly content, and it found more than expected — including one recommendation that was illegal and several that would damage the plant or the person following them.

The review ran in two stages. First, a detailed pass over `TASK_0001`–`TASK_0049` — where the bulk of the fixes below come from. Then, a lighter sweep over the whole matrix to close the gaps that first pass could only *suspect*, since a fifty-row slice can't tell you what's missing for an item whose other tasks sit hundreds of rows away. The second stage both authored the missing content and corrected several first-stage conclusions (rose pruning, for instance, was reported missing but already existed further down the file).

It also records a latent fault in the publish pipeline that these edits happened to be the first ever to expose.

### Added
- **Three collections**, each created because a task was right for most of its audience and wrong for some:
  - `GROUP_LAWN_RENOVATION` (Ryegrass, Fine Fescue, Mixed Utility) — the lawns that tolerate autumn scarification, hollow-tine aeration, overseeding and top dressing. Bentgrass is excluded because hard two-directional scarification damages a stoloniferous surface; Buffalo Grass because it is a warm-season grass and an autumn renovation strips it just as it enters dormancy, with no growth left to recover.
  - `GROUP_LAWN_STANDARD_FEED` (Ryegrass, Mixed Utility) — the lawns that take a full-rate high-nitrogen spring feed. Fine turf wants low nitrogen; high nitrogen encourages annual meadow-grass, thatch and fusarium.
  - `GROUP_BED_CLEARED` (Raised, Annual Bedding, Cutting Garden) — beds that are genuinely empty between plantings, and can therefore have manure forked into them.
- **`TASK_0623` "Recut Lawn Edges"** — split out of `TASK_0011`, which had merged two different jobs at one cadence (see Fixed). Twice a year, half-moon iron.
- **`TASK_0624` "Check Shed Roof Felt"** — split out of `TASK_0037`, so that replacing roof felt carries its own working-at-height warning rather than sitting inside a 60-minute painting job. Suppressed above 15mph wind.
- **Twenty-six new tasks (`TASK_0625`–`TASK_0650`)** authored in the second stage to close coverage gaps the first pass identified:
  - **Lawn winter set (`0625`–`0628`)** — clear fallen leaves, stay off frosted or waterlogged turf, brush off worm casts, and check for chafer grubs and leatherjackets. A grass lawn previously received no task at all in December, January or February; it now has coverage in every month.
  - **Red thread (`0635`)** — the commonest UK lawn disease, and counter-intuitive: it signals the lawn is underfed, so the fix is a summer feed rather than a fungicide (of which none is approved for amateur use anyway). Respects the `TASK_0008` narrowing by calling for a half rate on fine turf.
  - **Dahlia lifecycle (`0629`–`0634`)** — a plant that had two tasks for a year-round cycle now has a complete loop: check stored tubers, start into growth, slug-protect the shoots, plant out, stake, deadhead. This also resolves `TASK_0049`'s dangling reference to a staking task that didn't exist.
  - **Rose (`0636`–`0638`)** — deadheading, sucker removal (pull, don't cut) and greenfly, three jobs the retired category-tier tasks used to cover generically.
  - **Greenhouse (`0639`–`0642`)** — shading, ventilate-and-damp-down, pest checks and winter insulation. The building was well covered; growing *in* it was not.
  - **Miscellaneous gaps (`0643`–`0650`)** — protect new bedding and planters from late frost, clear the fence base, reduce climber weight before winter gales, plan crop rotation, plant daffodil bulbs, water newly planted trees (on `GROUP_TREE_GENERIC`), and bed-level spring slug protection.
- **A standard chemical-safety line** on every task naming a pesticide, herbicide or fungicide (`TASK_0014`, `0015`, `0038`, `0046`): read and follow the label, wear gloves, don't apply in wind, keep children and pets off until dry. In the UK the label is the law, and none of these tasks said so. A shorter wood-treatment variant on `TASK_0034` and `TASK_0037`.
- **Ordering hints across the spring and autumn lawn programmes.** September made a lawn owner eligible for nine tasks with an implied order (moss treatment → scarify → aerate → overseed → top dress → feed) that nothing in the data expressed. Each task now says where it sits. Overseeding before scarification wastes the seed, and nothing previously prevented it.
- **A "Where the push stopped" section in the publish report**, showing the step reached, the rows outstanding at that point, and the steps completed first.

### Changed
- **Thirty-seven tasks rewritten** in the first-stage pass over `TASK_0001`–`TASK_0049`, and five `Retired` cells corrected. Details in Fixed below.
- **Weather gates applied where they were missing.** Rain suppression on mowing (`TASK_0001`–`0003` — mowing wet grass tears it, clogs the mower and is a slip risk), on weedkiller application (`TASK_0014`, `0038`), on top dressing (`TASK_0017`) and on patio and timber work (`TASK_0033`, `0034`, `0037`). A 10°C floor on the two timber-treatment tasks, which will not cure below it.
- **`Estimated_Minutes` made honest.** Hand hollow-tining a lawn was 60 minutes (now 150); treating a whole fence boundary was 90 (now 240); top dressing 60 (now 120). The old figures were out by multiples, which matters now the value is destined for the UI.
- **`TASK_0011` narrowed to shear-trimming only**, its recut work moving to `TASK_0623`.
- **`TASK_0048` retargeted** from `GROUP_TENDER_BULB` to `PLANT_DAHLIA` and renamed "Lift and Store Dahlia Tubers", the instruction being dahlia-specific throughout (see Fixed).
- **`TASK_0018`–`0020` (bed weeding) retargeted** from `GROUP_ALL_BEDS` to `GROUP_CULTIVATED_BED`. Hoeing and forking are wrong or impossible in Gravel, Rock, Bog and Woodland Shade beds. Gravel keeps coverage through its own `TASK_0502`; Bog, Rock and Woodland now have no weeding task and are logged as a content gap for a future pass.
- **`TASK_0028` (Autumn Bed Clearance) rewritten** to name the seven plants that must be left standing over winter — penstemon, echinacea, rudbeckia, sedum, eryngium, gaura, verbena bonariensis — and to point the user to their spring cut-back tasks instead. It previously told a Herbaceous Border owner to cut these down in October, directly contradicting each plant's own leave-standing task.
- **Per-tree watering tasks consolidated.** Six near-identical tasks (`TASK_0391`, `0402`, `0419`, `0422`, `0522`, `0535` — cherry, rowan, field maple, oak, willow, ash) retired in favour of one `Water Newly Planted Trees` task on `GROUP_TREE_GENERIC` (`TASK_0649`), which also extends the same care to the sixteen trees that previously had none.
- **`TASK_0077` / `TASK_0078` given distinct names** — both read "Mulch/Feed Trees", identical target and months, showing a tree owner two identically-named cards in the same month. Now "Mulch Trees and Shrubs" and "Feed Trees and Shrubs". (The 2.0 entry records an earlier rename of this pair; the collision had re-formed since.)
- **Publish pipeline (`Publish.gs`) hardened.** Every `task_target` row now carries a uniform key set; `sbInsert_` and `sbUpsert_` group rows by key signature before sending; and the push now refuses to build targeting links it cannot complete, naming the offending tasks, before the reconcile runs rather than silently skipping them.

### Fixed

**Illegal or dangerous**
- **`TASK_0038` recommended sodium chlorate**, banned in the UK since 2009 and illegal to sell or use. It also recommended glyphosate on a drive without noting that most amateur labels prohibit use where run-off can reach a drain, and offered a flame gun with no fire warning. Rewritten around hand-weeding and boiling water, with the chemical names removed.
- **`TASK_0040` told a novice to run a paraffin heater in a sealed glass box** with no ventilation warning — paraffin produces carbon monoxide and large volumes of water vapour — and said nothing about greenhouse electrics needing an RCD-protected outdoor circuit. The only genuine injury risk in the batch.
- **`TASK_0037` presented re-felting a shed roof as part of a 60-minute painting job.** Now split, with an explicit working-at-height warning.

**Horticulturally wrong**
- **`TASK_0024` recommended forking grit into clay at 5kg/m² to a depth of 30cm.** That quantity is a dusting — far too little to change clay's structure, and small additions can make it worse. Digging 30cm through an established herbaceous or shrub border destroys it, and the months included October and November, when clay is wet. Rewritten around bulky organic matter, with raised beds as the fallback and an explicit "never work soil wet enough to stick to your boots".
- **`TASK_0047` gave bulb planting depth as two to three times the bulb's *diameter*.** The rule is the bulb's *height*. For tall narrow bulbs like tulips and daffodils that halves the correct depth. Corrected despite the task being retired, so the error isn't inherited when the job is re-authored — and the second-stage daffodil-planting task (`TASK_0648`) uses the corrected height rule.
- **`TASK_0048` applied one recipe to three genera.** "After the first frost blackens the foliage" is dahlia-correct and wrong for gladioli, which are lifted before frost. "Dry for 24 hours" is far too short — dahlia tubers need two to three weeks upside down or they rot in storage. Cannas want slightly moist compost, not dry.
- **`TASK_0008` applied a full-rate high-nitrogen feed to fine-turf and warm-season lawns**, and `TASK_0004` applied an autumn renovation to a warm-season grass. Both resolved by the new collections.
- **`TASK_0023` forked manure into the top 25cm of established herbaceous and mixed shrub borders**, severing feeding roots and spearing dormant crowns. It also overlapped `TASK_0029`'s liming window, and lime and manure applied together cancel each other out — and said nothing about manured ground making carrots and parsnips fork.
- **`TASK_0046` was a calendar fungicide programme**, firing every 14 days from May to September whether or not the rose had blackspot: up to ten applications, far beyond any amateur label's annual maximum. Reframed as condition-triggered, with hygiene and resistant varieties promoted to the front.

**Internally contradictory**
- **`TASK_0002` said "mow more frequently in peak growing season" while its `Frequency_Days` was 14** — twice as long as spring's 7. The data said the opposite of the text.
- **`TASK_0001` told the user to cut 50-60mm grass down to 25mm while never removing more than a third of the blade.** Both instructions in one sentence, impossible to follow.
- **`TASK_0013` said not to mow overseeded areas for 6-8 weeks**, which in April meant an unmown lawn until late June, contradicting the mowing tasks firing every 7-14 days. It also isn't right: new grass is topped once it reaches about 5cm.
- **`TASK_0014` ran a selective weedkiller every 28 days from April to September** — up to six applications where labels almost universally cap at one or two, which is both illegal and damaging — and its window ran straight over both overseeding tasks, killing the seedlings.
- **`TASK_0011` recut the lawn edge with a half-moon iron every 14 days.** Each recut takes a slice off the lawn and it does not grow back; over a season that is several centimetres of lawn, irreversibly. The fortnightly job is shear-trimming.
- **`TASK_0039` targeted the shed but instructed the user to check drainage "around the greenhouse and patio".** A shed-only owner was told to inspect things they don't have; a greenhouse-only owner never got the check at all.

**Smaller**
- **`TASK_0025` had a novice forking a bed in February**, when bulbs are just below the surface and herbaceous crowns are invisible.
- **`TASK_0032` stopped sweeping the patio in November**, excluding exactly the months when algae on wet paving is at its most slippery.
- **`TASK_0033` recommended a pressure washer** with no warning that it permanently pits soft stone and blows the sand out of block paving joints, and no eye protection.
- **`TASK_0034` had no rain suppression or temperature floor**, so the app would suggest painting a fence in October drizzle, and did not warn that fence treatment scorches plants growing against the panel.
- **`TASK_0015` could fire alongside `TASK_0008`**, and lawn sand already contains nitrogen — a double feed. It also invited confusion between "lawn sand" (a moss killer) and the "sharp sand" of `TASK_0006` and `TASK_0017`.
- **`TASK_0030` read "remove algae and green algae"**, garbled. **`TASK_0017` used "lute"**, professional greenkeeping jargon, with no finishing point given. **`TASK_0036` said "dispose of chemicals safely"** without saying how. **`TASK_0045` used "drip zone"**. **`TASK_0035` used "postcrete"** unexplained, and neither fence task mentioned that you cannot alter a neighbour's fence without asking.
- **The `Retired` column read "Tomestone" rather than "Tombstone"** on `TASK_0027`, `0042`, `0043`, `0044` and `0047`.

**Publish pipeline**
- **A publish that needed to add both a blueprint-targeted and a collection-targeted `task_target` row in the same run failed** with PostgREST error `PGRST102` — "All object keys must match". Section 7 of `pushToSupabase_` built `{ task_id, blueprint_id }` for one kind of link and `{ task_id, collection_id }` for the other, and `reconcileById_` sent them as one batch; PostgREST rejects a batch whose objects carry different key sets. The fault has been latent since Stage 2 and never fired because every previous publish happened to add only one kind of link at a time. Nothing in the authored content was at fault.

### Removed
- **`TASK_0026` "Apply Compost"**, retired as a duplicate. It overlapped `TASK_0021` (Spring Mulching), `TASK_0022` (Autumn Mulching) and `TASK_0023` (Dig In Manure) on identical beds in identical months — in October a Cultivated Bed owner was told three separate times to put organic matter on the same bed. Tombstone, not deletion.

### Known gaps and deferred work
- **Bog, Rock and Woodland Shade beds now have no weeding task.** A consequence of narrowing `TASK_0018`–`0020` to `GROUP_CULTIVATED_BED` (Gravel is separately covered by `TASK_0502`). Bed-specific weeding for these three — hand-weeding only, no hoeing or forking near alpines and bulbs — is logged for a future authoring pass rather than written here.
- **Fine Fescue, Bentgrass and Buffalo Grass have no spring feed task**, a direct consequence of narrowing `TASK_0008`. They need a half-rate fine-turf feed and, for Buffalo, a summer one. The coverage report does not flag this, because coverage asks only whether a blueprint receives *any* task, and these lawns receive plenty of others.
- **`LAWN_BUFFALO` is worth questioning as a blueprint.** Buffalo grass is a warm-season grass not grown outdoors in the UK in any meaningful quantity, and its presence is what forced the exclusions on five separate lawn tasks and the two new lawn collections. Retiring it would let much of that return to a single `GROUP_GRASS_LAWN` target.
- **The generation and QA process itself is being overhauled** in light of what this review exposed — the fixed task-count quota, the two-sentence instruction cap, and the row-batched (rather than item-scoped) review that made the first stage report gaps which didn't exist. That work targets `docs/DATABASE_WORKFLOW.md` and `Audit.gs` and is tracked separately.
- **The 26 second-stage tasks (`0625`–`0650`) have not themselves been through an independent editorial review** — they were authored and checked in the same session, which the workflow explicitly warns against. They should go through a fresh item-scoped pass with the rest of the matrix.

### Developer notes
- **A failed push can leave junction rows deleted and not replaced.** `reconcileById_` deletes before it inserts, so when the `task_target` insert failed, seven tasks (`TASK_0004`, `0006`, `0008`, `0012`, `0017`, `0023`, `0048`) were left with no targeting and would not have appeared for anyone. The damage was invisible only because every one of them is out of season in July. Repaired by a subsequent successful publish, which rebuilds the desired set from scratch. Reversing the order — insert first, delete second — would remove this exposure entirely and is safe, since the two sets are disjoint by construction; not done, and worth a decision.
- **The gate and the push validate against different things.** The gate proves a task's target exists *in the workbook*; the push needs that target's *live database id*. A newly-declared collection satisfies the first and not yet the second, which is why the gate can pass while the push cannot complete. The new refusal in section 7 makes that failure explicit and, crucially, non-destructive.
- **The immediate workaround, should anything like this recur**, is to publish twice with only one shape of link outstanding each time — retire the tasks carrying the other kind of target, publish, clear the cells, publish again. This is what restored the seven links before the code fix landed.
- **No frontend file changed, so `CACHE_NAME` is not bumped.** This release is content and Apps Script only.
- **Semicolon-delimited CSV remains mandatory** for authoring prompts covering `Master_Task_Matrix`, since `Valid_Months` uses internal commas.
---
## [2.1] — 2026-07-20

Google sign-in becomes the primary way into the app, removing the dependency on email delivery — and, in particular, curing the installed-iOS-PWA sign-in problem that emailed magic links couldn't. This entry also records two changes that shipped shortly after 2.0 but weren't yet written up.

### Added
- **Google sign-in (OAuth).** A "Continue with Google" button, now the primary sign-in method. Invite-only is preserved: public sign-ups stay disabled, so only email addresses added to the Supabase user list can get in, whichever provider they use. Google was chosen as the one free, viable social provider — Apple's Sign in with Apple needs a paid developer account, and Facebook Login needs heavy app/business review — and because an app-initiated OAuth flow returns cleanly into an installed iOS PWA, where an emailed magic link opens in Safari and never reaches the installed app.
- **`config.js`** (with `config.example.js` as its template). The Supabase URL and anon key moved out of `app.js` into a separate config file the app never regenerates, so deploying a new `app.js` can no longer overwrite the credentials. `app.js` now shows a clear message if the config is missing or still holds placeholder values, instead of failing later as a misleading sign-in error.

### Changed
- **The sign-in screen leads with Google.** The emailed-code flow is retained but tucked behind a "Use email instead" link, and stays fully functional for reviving later (e.g. once custom email is configured for friend invitations).
- **Service worker** bumped `gardening-v4` → `gardening-v7` across these changes.

### Fixed
- **The Hide button no longer shows through a completed task.** Completing a task fades its card to half-opacity; the red swipe-to-hide action sits behind the card and was bleeding through the translucent card. A completed card now removes that action entirely and stops responding to the swipe.

### Notes
- Email sign-in (and the Resend / custom-SMTP path toward it) is deliberately parked while the app is single-user. It becomes relevant again only for inviting friends, which independently requires a verified sending domain.
- **Updating an installed iOS PWA can be stubborn.** Deleting the home-screen icon does not clear the site's cached files; a full update may require clearing the site under iOS Settings → Apps → Safari → Advanced → Website Data. Also note the PWA manifest's `start_url`/`scope` are fixed to the live path (`/what-gardening-today/`), so an icon added from the dev URL will open the live app — install from the intended environment.

---

## [2.0] — 2026-07-17

**Status:** shipped. The v2 frontend is now the live app, replacing the 1.x Google Sheets / Apps Script stack. A few operational follow-ups remain open — see *Post-cutover follow-ups* below.

v2.0 is the Phase 4 architectural transition in `SPEC.md` §6: the backend moves from Google Sheets + Google Apps Script to Supabase (PostgreSQL), the app gains email sign-in and per-garden Row-Level Security, and the frontend is rewired to talk to the new backend directly. The Google Sheet is retained but demoted from live database to content-authoring surface, published into Postgres by a dedicated pipeline. `SPEC.md` has been rewritten as the authoritative description of the new system; `DESIGN_V2.md` is retained as the point-in-time migration-design record.

This entry consolidates the three build stages (database foundations, publish pipeline, frontend + cutover), replacing the earlier stage-1 note.

### Added
- **The v2.0 relational schema** (`db/01_schema.sql`) — real tables replacing the string-encoded spreadsheet relationships with foreign keys and constraints. Integrity the workbook could only ask for is now enforced at write time: `valid_months` is a checked 1–12 integer array; `suppress_if_raining` is a real boolean (the `"TRUE"`-as-text failure class is untypeable); every task target is a real foreign key (a phantom target cannot be stored); a composite key guarantees a manual task's item belongs to the same garden. Adversarial constraint test (`db/tests/01_constraints_test.sql`): 23 checks, all passing.
- **Row-Level Security** (`db/02_rls.sql`) — per-garden isolation enforced by the database on every query. Signed-in users read the shared catalogue but cannot alter it; each garden's data is invisible and unwritable to non-members; completion history is append-only by policy; the mixed `task` table (global read-only rows alongside per-garden writable rows) carries the most intricate policies. Test matrix written before the policies (`db/tests/02_rls_test.sql`): 49 checks, all passing.
- **The matching engine as one Postgres function** (`db/03_functions.sql`) — `select_tasks(garden, month, temp, is_raining, wind_mph)`, the sole implementation of the matching rule, plus `create_garden(name, lat, lon, timezone)`, the atomic onboarding function. Behaviour test (`db/tests/03_functions_test.sql`): 26 checks, all passing.
- **Email authentication and the "guest list."** Supabase Auth with passwordless email sign-in (one-time code and/or magic link). Public sign-up is disabled: an account exists only once its email is added from the dashboard, which is what keeps the app private.
- **Sign-in and first-run garden setup screens** (frontend). A signed-out visitor sees a sign-in screen; a signed-in visitor with no garden sees a one-screen setup — garden name plus location by postcode (via postcodes.io) or current location — which calls `create_garden`. Existing users land straight on Today's Tasks. A sign-out control lives in the settings panel.
- **The `today` Edge Function** (`supabase/functions/today/`) — one server-side call returning the day's weather and filtered tasks for a garden. It holds the OpenWeather key (never shipped to the browser), reads the garden's own coordinates, serves weather from a shared cache, and degrades to an unfiltered list if weather fails.
- **`weather_cache` table** (`db/07_weather_cache.sql`) — a short-lived, location-rounded, service-role-only cache so nearby gardens share one weather fetch.
- **Free-tier keep-alive** (`db/08_keepalive.sql`, `.github/workflows/keepalive.yml`) — a scheduled GitHub Action calls a minimal `keepalive()` function twice a week (Mondays and Thursdays), so the free-tier database registers activity and never pauses for inactivity.
- **The content-publish pipeline** (`Publish.gs`) — pushes audited Sheet content into the Postgres catalogue and task tables, reconciling the live database to the Sheet and handling retirement via `retired_at`. `Audit.gs` is retained as the pre-publish integrity check.
- **Ten collections** — the five pre-existing groups plus five created during the category-tier review (`GROUP_ALL_BEDS`, `GROUP_SHRUB_GENERIC`, `GROUP_TREE_GENERIC`, `GROUP_HERBS`, `GROUP_HAND_TOOLS`).
- **`docs/CONFIG_ITEMS.md`** — a running register of tunable values and operational settings (weather-cache freshness and rounding, sign-in delivery, keep-alive cadence, service-worker version, allowed origins, and more).

### Changed
- **The matching engine moved from Apps Script to the database.** `select_tasks` is now the single authoritative implementation; the frontend no longer carries or calls a bespoke matching API.
- **The frontend data layer was rewired to Supabase.** `index.html`, `app.js`, and `style.css` were rebuilt: the daily view calls the `today` function; inventory, the catalogue picker, completions, and hide/unhide are direct Row-Level-Security-governed reads and writes via `supabase-js`. What the user sees is unchanged; how it's fed is entirely new.
- **The bare-category matching tier was abolished in the data.** The 26 tasks that targeted a bare category were reviewed one by one: 19 re-homed to explicit collections, 7 retired. "Applies to all shrubs" is now a curated, inspectable set rather than a prefix match. Re-homings touching Dan's garden: all lawn tasks → `GROUP_GRASS_LAWN`; the three bed-weeding tasks → `GROUP_ALL_BEDS` (which, unlike `GROUP_CULTIVATED_BED`, includes his Woodland Shade bed); the four generic shrub tasks → `GROUP_SHRUB_GENERIC` (Lavender included); and "End of Season Tool Clean" → `GROUP_HAND_TOOLS`, so it no longer offers rust-and-linseed care to his chainsaw.
- **Categories carry a display sort order** (Lawn, Beds, Trees & shrubs, Plants & flowers, Veg & herbs, Garden structures, Tools).
- **`SPEC.md` rewritten** as the self-contained authoritative reference for the v2.0 architecture; the v1 Google Sheets / Apps Script schema and API sections are replaced by the Postgres schema, the access model, and the data-access-and-functions description.
- **Service worker** (`sw.js`): registration added (the app had none, so there was no offline shell before); `CACHE_NAME` bumped `gardening-v3` → `gardening-v4`; it now caches only our own same-origin files and never the Supabase, OpenWeather, or postcode calls.

### Fixed
Four long-standing 1.x limitations are resolved by the new architecture:
- **Weather location.** Tasks are filtered against weather at the garden's own stored coordinates, and the widget and the filter are fed from the same reading — the v1 hardcoded-location and widget-versus-filter disagreement are both gone.
- **Wind suppression direction.** A task is now correctly hidden when wind is *above* its threshold (v1 had it inverted).
- **Drifted data-fetch paths.** There is one daily call, re-run on return to the Today view, so weather-suppressed tasks can no longer briefly reappear on a tab switch.
- **British Summer Time date-stamping.** Day maths is timezone-aware and completions are stored as `timestamptz`, so a late-evening completion is no longer logged a day early.

### Removed
- **Google Sheets as the live database, and the Apps Script Web App as the runtime API.** The v1 runtime routes (`get_all`, `get_tasks`, `get_profile`, `get_dictionary`, `get_weather`, `get_hidden_tasks`, and the POST routes) are retired at cutover; their work is done by the `today` function and direct RLS operations. Apps Script itself lives on, repurposed to the publish pipeline.
- **The bare-category targeting tier** (see Changed) — no task may target a bare category any longer.
- **Seven tasks retired in the category-tier review**, each a seasonal *activity* or a subset-only task rather than asset-care for an owned item: "Re-edge Bed Borders" (`TASK_0027` — really a lawn-edge job, for future re-authoring) and six generic `PLANT` tasks — "Deadhead Flowers", "Water Plants", "Stake Tall Plants", "Plant Spring Bulbs", "Feed Patio Pots", "Protect Plants from Frost" (`TASK_0042`–`0044`, `0047`, `0052`, `0053`). Retirement is a tombstone (`retired_at`), not a deletion; the tasks remain for history's sake but never match.

### Migration and verification
- **Real data migrated in full** (`db/04_staging.sql` → `05_transform.sql`): 248 blueprints, 255 blueprint-category links, 10 collections with 101 members, 612 curated tasks, 25 garden items, 68 completions, 1 hidden task — every table reconciled exactly to its predicted count.
- **Five tombstones**, not the three anticipated in `DESIGN_V2.md` §8: beyond `TASK_0050`, `TASK_0051` and `TASK_0064`, the real completion history also referenced `TASK_0082` and `TASK_0083` (no longer in the matrix, never added to `RETIRED_TASK_IDS`). Both are recreated as retired rows with placeholder names so those completions keep a valid reference; their workbook history is worth investigating separately.
- **Coverage:** 247 of 248 blueprints receive at least one task. The one exception, `TOOL_WATERING_CAN` (not in Dan's garden), lost its only task when tool-cleaning was narrowed to hand tools; it joins the five structures (`STRUCT_PLANTER_BOX`, `STRUCT_PERGOLA`, `STRUCT_COLD_FRAME`, `STRUCT_ARCH`, `STRUCT_POND`) on the "needs a task authored" list. Lavender is covered via `GROUP_SHRUB_GENERIC`.
- **Parity check passed.** `select_tasks` was compared against the live app's output for Dan's garden across all twelve months: no over-matching in any month, and every difference across the year is a deliberate one from this migration (the seven retirements and the hand-tool narrowing). Full expected-differences list in `DESIGN_V2.md` §13.

### Post-cutover follow-ups
The live switch is done — the production app now serves the v2 frontend against Supabase. These operational items remain open:
- Confirm the OpenWeather API key was never committed to the public repo (current files *and* git history) or placed in any frontend file. It was authored only in the Apps Script (private, in Google Drive), so exposure is not expected; rotate the key only if that check finds it somewhere public. Either way, in v2 the key belongs solely in the `today` function secret, never in the browser.
- Retire the old Apps Script *runtime* Web App deployment (the publish pipeline stays).
- Custom email is required before friends can be invited; a single-user cutover does not need it.

### Developer notes
- **The migrated garden is ownerless until first sign-in** and must be *linked* to an account — add the account from the dashboard, then insert an `owner` membership row for garden `a0000000-0000-0000-0000-000000000001` — rather than provisioned via `create_garden`. Recorded in `DESIGN_V2.md` §13.
- `create_garden` is deliberately **permissive** about a second garden; the UI, not the database, limits a user to one. `select_tasks` **refuses** a garden the caller doesn't belong to outright, rather than returning an empty list, so the boundary is testable. When weather is unknown, no weather filtering is applied.
- Sign-in supports both an emailed code and a magic link; which is delivered is a dashboard email-template setting. On an installed iOS PWA the code avoids the "link opens in the browser instead of the app" quirk.
- Every SQL file is re-runnable, and each shows a visible results grid or confirmation readout rather than relying on notices (which the Supabase web editor does not surface).

---

## [1.5] — 2026-07-14

The first purely additive feature since the matching engine was fixed, and the first user-scoped data in the schema: a way to tell the app "I don't want this task," without deleting it from the matrix for anyone else.

### Added
- **Hide this task.** Swiping a task card sideways reveals a Hide button. Tapping it removes the card immediately and hides that Task_ID from appearing again, with a brief "Undo" toast giving a grace window before it's final.
- **Settings screen for hidden tasks.** A new gear icon in the header opens a simple list of everything currently hidden, each with a one-tap Restore.
- **New sheet tab, `Hidden_Tasks`.** Two columns: `Task_ID`, `Date_Hidden`. Created automatically, with headers, the first time a task is hidden — no manual setup required. See `SPEC.md` §3, Tab 5.
- **Three new API routes:** `GET ?action=get_hidden_tasks` (returns each hidden task's current name and category, looked up live from `Master_Task_Matrix` rather than stored, so a later rename is always reflected correctly); `POST hide_task` (idempotent — hiding an already-hidden task succeeds without a duplicate row); `POST unhide_task`.
- **Matcher change:** `selectTasks` now checks `Hidden_Tasks` before any other filter, so a hidden task is excluded unconditionally regardless of season, cooldown, or weather.
- **Audit check:** `Audit.gs` now flags `Hidden_Tasks` entries pointing at Task_IDs that no longer exist (harmless, but surfaced so the tab doesn't quietly accumulate dead rows).

### Developer notes
- This is the first genuinely user-scoped table in the schema — everything else is either a shared blueprint (`Item_Dictionary`, `Master_Task_Matrix`) or implicitly single-user (`User_Profile`, `Task_Log`). Worth treating as a preview of the harder problem in the multi-user design conversation: there is no `User_ID` column yet, so today `Hidden_Tasks` is the entire hidden-task state for the one garden the app serves.
- Frontend: three files changed (`index.html`, `style.css`, `app.js`); `sw.js` `CACHE_NAME` bumped `gardening-v2` → `gardening-v3` accordingly.
- The swipe gesture is direction-locked against the drag's start position, so a vertical scroll is never mistaken for a horizontal swipe. This and the click-driven logic (hide, undo, restore, modal open/close) were verified with an automated DOM test harness before shipping; the drag physics themselves still want a quick check on a real device.

---

## [1.4] — 2026-07-13

The same category-tier fault fixed in 1.3, found again by the audit — this time in `LAWN` and `BED`, where several tasks were actively harmful to the specialist lawn and bed types rather than merely irrelevant to them.

### Fixed
- **Turf care applied to non-turf lawns.** All conventional mowing, scarifying, aerating, feeding, overseeding, and weed/moss treatment tasks targeted the bare `LAWN` category, so they were being issued for Wildflower Meadow, Moss and Clover lawns as well as ordinary turf. Two of these were actively destructive: "Weed Treatment" applies a selective broadleaf weedkiller, which would kill a clover lawn outright, since clover is a broadleaf plant; "Moss Treatment" applies moss killer, which would be issued directly against a lawn whose entire purpose is moss. Sixteen tasks are now targeted at the new `GROUP_GRASS_LAWN` instead. "Lawn Edging" remains at the `LAWN` tier, since it genuinely applies to every lawn type.
- **Soil enrichment applied to beds that need the opposite.** "Improve Drainage" targeted the bare `BED` category, so it was being issued for the Bog Garden bed, whose purpose is to stay waterlogged. "Spring Mulching", "Fork Over Beds" and "Apply Compost" were likewise reaching the Gravel and Rock Garden beds, both of which depend on poor, free-draining conditions the task would undermine, and the Woodland Shade bed, where raking away "Autumn Bed Clearance"'s fallen leaves removes the leaf litter that bed exists to provide. Seven tasks are now targeted at the new `GROUP_CULTIVATED_BED` instead. Weeding (spring, summer, autumn) and bed re-edging remain at the `BED` tier, since every bed needs both.
- **"Prepare Vegetable Bed" retargeted from `BED` to `BED_RAISED`.** A veg-growing task had no business appearing for an Annual Bedding or Cutting Garden bed.

### Added
- **`GROUP_GRASS_LAWN`**: Ryegrass, Fine Fescue, Bentgrass, Mixed Utility, Buffalo. Fine turf grasses (Fescue, Bentgrass) are cut lower in practice than the group's mowing tasks specify, but are not split into their own group — the mowing instructions give a range, and modelling the distinction was judged not worth a group only a handful of users would ever hit.
- **`GROUP_CULTIVATED_BED`**: Herbaceous Border, Raised Bed, Annual Bedding, Mixed Shrub Border, Cutting Garden. Gravel, Rock Garden, Bog Garden and Woodland Shade are deliberately excluded — each already has its own correct tasks, which the generic bed tasks were undermining.
- **Ten new tasks** for the three lawn types now outside the generic tier: cutting and lifting a wildflower meadow's hay, an optional early spring cut, sowing yellow rattle to weaken competing grass, and leaving it standing over winter for wildlife (`TASK_0579`–`0582`); clearing leaves from and watering a moss lawn, and hand-weeding it rather than ever chemically treating it (`TASK_0583`–`0585`); mowing a clover lawn high and infrequently, overseeding bare patches, and an explicit warning never to feed or weedkill it (`TASK_0586`–`0588`).

### Developer notes
- No items in the developer's own garden are affected by the retargeting (two Mixed Utility lawns remain fully covered by `GROUP_GRASS_LAWN`); the Woodland Shade bed loses the generic mulching, manure, forking and autumn-clearance tasks, retaining only its weeding, re-edging, and its own three woodland-specific tasks.
- This fix originated from the audit's REVIEW list of category-tier tasks (`Audit_Report`, 13 Jul 2026), not from a user-reported symptom — the intended use of that list.

---



A schema and matching-engine change. The task matcher previously inferred an item's identity from the first two segments of its ID, which both mis-assigned tasks and silently dropped them. Matching is now explicit at three tiers, and groupings are declared in the data rather than inferred from spelling.

### Added
- **Data integrity audit (`Audit.gs`).** A read-only checker attached to the spreadsheet, run from a new **Garden Data → Run Audit** menu and reporting into an `Audit_Report` tab. Every significant bug found during this release was a *silent* one — a task targeting something that did not exist, an item receiving nothing, a duplicate key — none of which raised an error, and all of which were mechanically detectable. The audit checks for exactly those, plus schema hygiene, orphaned garden items, dead group tags and orphaned log entries. It reads the seven categories and nine prefixes from `Reference_Lists`, which finally gives that legacy tab a purpose. It never modifies data. Paired with an editorial review prompt (`docs/DATABASE_WORKFLOW.md` §8) for the horticultural correctness no script can judge.
- **Lavender tasks** (`TASK_0574`–`TASK_0578`), including the one that matters most: never cut lavender back into the old brown wood, because unlike most shrubs it cannot regrow from it. Also an explicit instruction *not* to feed or richly mulch it, which is counter-intuitive and the reason feeding and mulching were kept out of the generic shrub set.
- **Group tier for task matching.** New optional `Groups` column on `Item_Dictionary`, holding comma-separated `GROUP_*` tags. A task may now target a declared group (e.g. `GROUP_SOFT_FRUIT`) and will apply to every item carrying that tag, regardless of how the item's ID is spelled. This provides the middle tier between "whole category" and "one specific item" that the previous design had no way to express. `GROUP_` is now a reserved prefix.
- **Multi-category blueprints.** `Item_Dictionary.Category` may now list more than one category, comma-separated. The backend emits one picker entry per category, so an item such as Rose appears under both "Plants & flowers" and "Trees & shrubs" tiles while remaining a single blueprint. No frontend change was required.
- **Care tasks for the water butt and compost bin** (`TASK_0566`–`TASK_0573`): cleaning out the butt, checking the lid and stand, clearing the downpipe diverter, and turning, balancing, moistening and harvesting the compost. These were the last two items in the garden receiving no tasks at all.
- **Care tasks for six previously uncovered plants** (`TASK_0544`–`TASK_0564`): Geranium, Peony, Lupin, Echinacea, Foxglove and Allium had blueprints in `Item_Dictionary` but no tasks of their own, and were relying entirely on generic `PLANT` tasks. Notable inclusions: checking peony planting depth (crowns buried deeper than 5cm never flower — the commonest cause of a healthy peony refusing to bloom), watching for lupin aphid, and leaving echinacea seed heads standing over winter rather than cutting back in autumn.
- **Generic shrub task set** (`TASK_0540`–`TASK_0543`): checking for dead or damaged wood, watering newly planted shrubs, firming in wind-rocked shrubs, and clearing weeds around shrub bases. The `SHRUB` category previously had no category-level tasks at all, so shrubs with no dedicated tasks of their own — Lavender among them — received nothing. Feeding and mulching are deliberately excluded from this set: they are already covered per-shrub, and blanket feeding would be actively harmful to shrubs such as Lavender that require poor, free-draining soil.

### Fixed
- **Multi-word item prefixes were being truncated.** The matcher built each item's identity from only the first two underscore-separated segments of its `Asset_ID`, discarding the rest. Any item whose name needed three or more words was therefore mis-identified: `PLANT_LILY_OF_THE_VALLEY` was treated as `PLANT_LILY`, so Lily of the Valley received true-lily tasks (including inspecting for scarlet lily beetle, which does not affect it) while its own two tasks never appeared at all. The matcher now uses the item's full prefix. This also activated previously dead tasks for Beech Hedge, Side Gate, and the Woodland Shade bed.
- **Harmful generic advice on woody plants.** "Cut Back Perennials" (`TASK_0050`, cut to 10cm of the ground) and "Divide Perennials" (`TASK_0051`, lift and split the clump) targeted the entire `PLANT` category, so they were being issued for Rose, Clematis, Bamboo and Ivy — all woody. **Both tasks are deleted.** They were redundant as well as harmful: cutting back and dividing herbaceous perennials is a bed-level job, and the matrix already covers it at bed level with "Autumn Bed Clearance" (`TASK_0028`) and "Divide Herbaceous Border Clumps" (`TASK_0488`). Their Task IDs are retired and will not be reissued. "Lift and Store Tender Bulbs" (`TASK_0048`) was likewise being issued for every plant and is now targeted at `GROUP_TENDER_BULB`.
- **Duplicate `Task_ID`.** `TASK_0262` had been assigned to two different rows — a Thalictrum task and a Tiarella task — violating the primary-key rule. The Thalictrum row keeps `TASK_0262` (it follows `TASK_0261`, also Thalictrum); the Tiarella row "Divide Foam Flower Clumps" is renumbered to `TASK_0565`. Neither plant is in the garden, so no `Task_Log` entries pointed at the ambiguous ID.
- **Orphaned fruit and brassica tasks.** Three raspberry tasks targeted `FRUIT_RASPBERRY` while the inventory item was `VEG_FRUIT_RASPBERRY`, so they never matched. Separately, "Net Fruit Bushes" (`VEG_FRUIT`) and "Net Brassicas" (`VEG_BRASSICA`) targeted middle-tier strings that could never match anything. All are now correctly targeted, the latter two via the new group tier.
- **Duplicate item blueprints.** Rose, Lavender, Hydrangea, Raspberry and Strawberry each appeared twice in `Item_Dictionary` under two different prefixes — two identical-looking entries in the picker with entirely different task behaviour depending on which was chosen. This is why Lavender received no tasks. Each is now a single blueprint.

### Removed
- **`TASK_0050` "Cut Back Perennials"** and **`TASK_0051` "Divide Perennials"** — see Fixed above. Both were redundant as well as harmful: the same jobs are already covered at bed level by "Autumn Bed Clearance" (`TASK_0028`) and "Divide Herbaceous Border Clumps" (`TASK_0488`).
- **`TASK_0064` "Clean Spray Bottles and Sprayers"** — targeted the bare `TOOL` category, so instructions for rinsing out a knapsack sprayer were being issued to anyone who owned a chainsaw or a wheelbarrow. The same category-tier fault as the perennial tasks, and with no sprayer blueprint in `Item_Dictionary` to retarget it to, deletion was cleaner than inventing one.

All three Task IDs are **retired and must never be reissued**. `Task_Log` still holds completions recorded against them, and a reissued ID would inherit a completion history belonging to a different job — potentially suppressing a brand-new task on a cooldown it never earned. `Audit.gs` enforces this via `RETIRED_TASK_IDS`: it suppresses the expected orphaned-log warnings, and raises an ERROR if a retired ID is ever reused.

Log entries for retired tasks are deliberately **left in place**. `Task_Log` is an append-only historical record; those jobs really were completed on those dates, and deleting the rows to tidy an audit report would be falsifying history to make a report look clean.

### Changed
- **Asset matching logic is now shared.** `get_tasks` and `get_all` each carried their own copy of the matching rule, which is how the truncation defect came to exist in two places at once. Both routes now call the same helper functions.
- **`FRUIT_*` prefixes retired.** `FRUIT` was never a valid category prefix. Goji and Blackberry are renamed to `VEG_FRUIT_GOJI` and `VEG_FRUIT_BLACKBERRY`; the duplicate `FRUIT_RASPBERRY` and `FRUIT_STRAWBERRY` blueprints are deleted.
- **Rose, Lavender and Hydrangea consolidated onto their `SHRUB_*` prefixes** (all three are woody), listed under both the "Plants & flowers" and "Trees & shrubs" tiles. Rose's four tasks are retargeted from `PLANT_ROSE` to `SHRUB_ROSE`.
- **Six woody plants re-catalogued from `PLANT_*` to `SHRUB_*`:** Clematis, Ivy, Jasmine, Bamboo, Rhododendron and Viburnum. All are woody, and there was already precedent for climbers sitting under the shrub prefix (`SHRUB_WISTERIA`). The four climbers and bamboo are listed under both the "Plants & flowers" and "Trees & shrubs" tiles, since a novice might reasonably look for them under either. Their fourteen tasks are retargeted accordingly.

  Fuchsia and Heather are deliberately **not** moved. Both are woody, but both are commonly grown in pots and baskets, where the generic `PLANT` watering and patio-pot feeding is exactly the care they need — moving them would trade that away for shrub tasks of little relevance. See `SPEC.md` §5E.
- **`TASK_0077` / `TASK_0078` renamed** from "Mulch/Feed Trees and Shrubs" to "Mulch/Feed Trees" — they only ever targeted `TREE`, and the names promised coverage they did not deliver.
- **Garden coordinates lifted into named constants** (`GARDEN_LAT` / `GARDEN_LON`) at the top of the Apps Script, rather than being buried in the weather helper.
- **`Estimated_Minutes` is now returned** in the API task payload. It is not yet displayed in the UI.

### Developer notes
- **`Target_Asset_ID` may no longer be assumed to be one or two segments.** It is now exactly one of: a category prefix, a full item prefix, or a `GROUP_*` tag. Prefixes may safely be substrings of one another — matching is an equality test, not a prefix test.
- **A `GROUP_HERBACEOUS_PERENNIAL` group was designed and then abandoned.** It would have been unworkable: roughly 25 perennials already carry their own specific divide or cut-back tasks (which a generic version would duplicate), and several standard border perennials — Penstemon, Gaura, Eryngium, Rudbeckia, Echinacea, Sedum, Verbena bonariensis — must deliberately be left standing over winter. Any honest tagging would have produced both duplicate and incorrect advice, and any tagging that avoided those problems would really have meant "not yet covered by a specific task" — a group definition that rots the moment new content is written. Deleting the two generic tasks was the correct resolution.
- **`Item_Dictionary` now has four columns.** Import prompts and the verification checklist in `docs/DATABASE_WORKFLOW.md` are updated accordingly.

---

## [1.2] — 2026-07-08

### Added
- Full set of app icons generated from a new master 1024px source image: `icon-512`, `icon-192`, `apple-touch-icon` (180px), `favicon-32`, and a multi-resolution `favicon.ico`. Registered the 512px icon in the manifest (previously only 192px was present) and added a dedicated Apple touch icon and favicon set in `index.html`.

### Changed
- Moved all icon assets from the repository root into a dedicated `assets/icons/` folder; updated references in `manifest.json`, `index.html`, and `sw.js` accordingly.
- Service worker rebuilt to fix stale-cache delivery: switched from cache-first to network-first, added a versioned cache name with automatic cleanup of old caches on activation, and immediate activation of new versions. Deployed frontend fixes now reach installed PWAs on the next launch (provided the cache version is bumped).

### Developer note
- Each future deploy that changes a cached file must bump `CACHE_NAME` in `sw.js`.

---

## [1.1] — 2026-07-08

### Changed
- Redesigned the "My Garden" tab for a more cohesive, modern look. Section headings ("Add to My Garden" and "My Garden") now use a small green accent bar beside the title in place of the previous plain heading style. The inventory list is now wrapped in a single pale-green tinted container, with thin dividers separating category groups (Lawn, Beds, etc.) inside it, rather than each group floating separately on the page background.

---

## [1.0] — Baseline

Initial baseline capturing the completed Phases 1–3 as documented in SPEC.md §6.

### Core capabilities
- **Daily task recommendations.** Season-aware, cooldown-suppressed, weather-filtered gardening tasks matched to the user's inventory. Tasks are surfaced via the "Today's Tasks" tab and driven by hierarchical asset matching against `Master_Task_Matrix`.
- **Stateful task completion.** Checkboxes on task cards log completions to `Task_Log`. The processing engine calculates `Date_Completed + Frequency_Days` to hide completed tasks for their cooldown window.
- **Dynamic inventory management.** "My Garden" tab lets the user add items via category tiles + item pill selector + optional custom reference name, and remove items via a two-tap confirm/execute soft-delete flow.
- **Environmental integration.** Frontend HTML5 Geolocation for the weather widget. Backend OpenWeather proxy via Apps Script. Combined `get_all` route returns season-and-weather-filtered tasks with the inventory in a single call.
- **PWA delivery.** Installable via GitHub Pages with service worker + Web App Manifest for iOS/Android home-screen installation.

### Architecture
- **Frontend:** Vanilla HTML/CSS/JS on GitHub Pages, no framework.
- **API:** Google Apps Script Web App as the sole external endpoint (`doGet` / `doPost`), including a secure weather proxy.
- **Data:** Google Sheets as a relational store (`User_Profile`, `Item_Dictionary`, `Master_Task_Matrix`, `Task_Log`, `Reference_Lists`).

### Known limitations at baseline
See SPEC.md §5E for the full list. Summary: hardcoded backend weather location; inverted wind suppression logic; parallel data-fetch paths that drift on tab switch; UTC midnight date-stamping edge case; unbounded `Task_Log`; legacy two-digit asset ID suffix fallback.
