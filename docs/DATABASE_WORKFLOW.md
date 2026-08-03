# Database Content Workflow

How to add new **items** (to `Item_Dictionary`) and new **tasks** (to `Master_Task_Matrix`) in the Google Sheets authoring workbook for *What Gardening Today?*

This covers the manual authoring process only — generating content with an LLM, importing it cleanly into the sheet, and verifying it. It does not cover the app's runtime behaviour; see `SPEC.md` for the schema and matching rules this document depends on.

**As of v2.0, the workbook is an authoring workbench, not a live database.** Content is written here exactly as before, but it reaches the app only when it is *published* to the hosted database (Supabase) via an explicit **Garden Data → Publish to app** step. Authoring is unchanged; publishing is new. See §10.

_Current as of v2.7 (2026-08-03). This revision documents the review programme automation added in `Review.gs`: the `Review_Pass` column and the `Review_Passes` tab (§1, §2, §3, §6, §9), the packet builder that assembles a complete editorial review pass and offers it wrapped in either the review prompt or the authoring prompt (§7b), the decisions tab and applier that transcribe accepted findings back into the matrix (§7e), and the process for filling a gap the review found (§7f). The editorial review prompt has moved out of this document and into `Review.gs`, so that there is exactly one copy of it (§8a)._

> **If you read only one thing, read this.** The v2.0 migration **abolished bare-category targeting.** A task may no longer target `LAWN` or `PLANT` and sweep up everything beneath it — such a target now *blocks publishing*. Every task must target either one specific blueprint or a **declared collection**. The consequence for authoring is that **a new blueprint inherits nothing.** Add a plant and write no tasks for it, and it will silently receive zero tasks forever — there is no fallback tier to catch it. See §2 and §2a.

---

## Contents

- [1. Where the data lives](#1-where-the-data-lives)
- [2. Conventions that must not be broken](#2-conventions-that-must-not-be-broken)
- [2a. Nothing until deliberately included](#2a-nothing-until-deliberately-included)
- [3. Workflow A — adding items to Item_Dictionary](#3-workflow-a--adding-items-to-item_dictionary)
- [4. Workflow B — adding tasks to Master_Task_Matrix](#4-workflow-b--adding-tasks-to-master_task_matrix)
- [5. The prompts](#5-the-prompts)
- [6. Verification checklist (after importing tasks)](#6-verification-checklist-after-importing-tasks)
- [7. Quality assurance](#7-quality-assurance)
- [8. The review prompts](#8-the-review-prompts)
- [9. Notes on specific columns](#9-notes-on-specific-columns)
- [10. Publishing to the app](#10-publishing-to-the-app)

---

## 1. Where the data lives

The authoring tabs in the Google Sheet:

- **`Item_Dictionary`** — the catalogue of item *blueprints* shown in the "Add to My Garden" picker. Seven columns: `Category`, `Suggested_Name`, `Default_Asset_ID_Prefix`, `Groups`, `Browse_Group` (column E; see §2), `Botanical_Name` (column F; see §2) and `Review_Pass` (column G; see §2). Columns A–D are authored by prompt and pasted; E, F and G are filled by hand, by prompt, or (for G) by a menu item.
- **`Master_Task_Matrix`** — the care tasks matched to those items. Thirteen columns: `Task_ID`, `Target_Asset_ID`, `Task_Name`, `Category`, `Instruction`, `Valid_Months`, `Frequency_Days`, `Suppress_If_Raining`, `Suppress_If_Temp_Below`, `Requires_Wind_Above`, `Estimated_Minutes`, `Retired` (column L; see §2) and `Reviewed` (column M; see §2). Columns A–K are authored by prompt and pasted; L and M are filled by hand or by the review applier (§7e).
- **`Collections`** — added in v2.0. Two columns, `Code` and `Name`, declaring every `GROUP_*` collection that exists and giving it a human display name. Membership still lives in the `Groups` column of `Item_Dictionary`; this tab declares the collections that column may reference. See §2.
- **`Browse_Groups`** — added in v2.4. Two columns, `Name` and `Sort_Order`, declaring every heading the picker may cluster items under and the order those headings appear in. Referenced by the `Browse_Group` column of `Item_Dictionary`. **Purely a display concern — a browse group is not a collection and can never be a task target.** See §2.
- **`Review_Passes`** — added in v2.7. Columns A and B, `Pass_Name` and `Notes`, declare every editorial review pass that exists. Columns C to G are written by the script and show the state of each pass; see §2. Membership lives in the `Review_Pass` column of `Item_Dictionary`; this tab declares the passes that column may reference. **Bookkeeping only — a review pass affects neither what an item receives nor where it appears.** See §2 and §7b.
- **`Reference_Lists`** — maps the seven display categories to their top-level prefixes; the audit's source of truth for valid categories and prefixes.

**Written by a script, never edited by hand:**

- **`Audit_Report`** — the findings from **Garden Data → Run Audit**.
- **`Coverage_Grid`** — a blueprint-by-month table of how many live tasks reach each item in each month. Rebuilt on every audit run. It is a *reference artefact for the editorial review* (§7b), not a list of faults. See §7d.
- **`Publish_Report`** — written by the publish step (§10).
- **`Review_Packet`** — the assembled packet for one pass, one line per row: the review prompt, then a divider, then the authoring prompt. Rebuilt each time you build a packet, and the caption names the row range of each. See §7b.
- **`Review_Log`** — appended to by the review applier and never cleared. The permanent record of every change the review programme has made to the task matrix, and the only place a *before* value survives. See §7e.

**Written by a script, then filled in by hand:**

- **`Review_Decisions`** — laid out by the packet builder, pasted into and ticked by you, then read by the applier. See §7e.

**Archived, and read by nothing:** the `User_Profile`, `Task_Log` and `Hidden_Tasks` tabs. A user's garden items, completion history and hidden tasks live in Postgres (`garden_item`, `task_completion`, `hidden_task`) and are written by the app, not the workbook. The tabs that remain are frozen snapshots from before the v2.0 cutover, kept only as a record of the pre-migration state; they are prefixed `ARCHIVE_` and no code looks them up. Do not edit them expecting an effect.

The two questions those tabs used to answer — is a retired blueprint still sitting in somebody's garden, and is an item somebody owns receiving nothing — are now asked of the live database and reported after a publish (§10).

**Order of operations:** always add the item to `Item_Dictionary` first, then add its tasks. A task's `Target_Asset_ID` must reference an item prefix or a group tag that already exists — and, for a group tag, one that is declared on the `Collections` tab.

---

## 2. Conventions that must not be broken

These are load-bearing. Getting them wrong causes silent failures (no error, just tasks that never appear or rows that import into the wrong columns) or, since v2.0, a blocked publish.

### The seven categories (exact spelling, casing, and ampersands)

```
Lawn
Beds
Trees & shrubs
Plants & flowers
Veg & herbs
Garden structures
Tools
```

An item may belong to **more than one** category. List them comma-separated in the single `Category` cell (e.g. `Plants & flowers, Trees & shrubs`). The item then appears under both tiles in the picker while remaining one blueprint. Use this instead of creating a second row.

Note that a task's `Category` is now **display metadata only** — it labels the card in the app. It plays no part in deciding who receives the task. That job belongs entirely to `Target_Asset_ID`.

### One blueprint per real-world item

Never enter the same plant twice under two different prefixes. This has caused real bugs: Rose, Lavender, Hydrangea, Raspberry and Strawberry all previously existed twice, producing two identical-looking pills in the picker with entirely different task behaviour depending on which the user happened to tap. If an item belongs in two categories, use a multi-valued `Category` cell.

### One blueprint, one growing form

The inverse of the rule above, and the harder one to spot. Cataloguing the same plant twice is an obvious fault. Cataloguing two plants that need opposite treatment *once* is not, and it produces the same class of bug from the other direction.

A single blueprint is safe only where every plant a user would file under that name wants the same care. Several currently do not:

- **Hedge or specimen.** Yew, Hornbeam, Hawthorn and Conifer are each grown both as clipped hedging and as a free-standing tree. A late-summer hedge trim and a winter formative prune to a clear trunk are both correct, and each is wrong for the other form.
- **Ornamental or productive.** Cherry covers both a flowering cherry and a fruiting one. A netting or harvest task is meaningless on the former.
- **Grafted or on its own roots.** Willow covers coloured-stem willows that want hard annual cutting, weeping willows that do not, and Kilmarnock willow, a grafted standard that is destroyed by it. Hazel has the same split between plain green stock and contorted or purple forms.

There is no mechanism that resolves this — `select_tasks` matches a blueprint, not a form of it. So there are only three honest options, and choosing none of them is what causes the bug:

1. **Split the blueprint** where the two forms are genuinely different purchases (`TREE_YEW_HEDGE` against `TREE_YEW`). Cleanest, but it doubles the catalogue entry and the user has to know which they have.
2. **Scope inside the instruction**, opening with who the task is for and telling everyone else to tick it off — the pattern `GROUP_MAINS_POWERED` uses for cordless machines. Cheapest, and adequate where the wrong action is merely wasted effort.
3. **Do not write the task at all** where the wrong action is irreversible. This is the right answer whenever getting it wrong kills the plant, and it is why `TASK_0392` was retired rather than scoped.

Option 2 is the usual choice, but it is only safe when a user who ignores the opening sentence loses nothing they cannot get back. Where the wrong action is irreversible, use option 1 or option 3 — see the irreversible-advice rule in §5.

**Whichever you choose, scope on something the user can check by looking.** "If yours is grown as a hedge", "if there is fruit on it", "if the pot is standing in water" are all answerable in seconds. A condition the user cannot self-assess — where they live, what their soil is, which cultivar they bought — is either ignored or wrongly assumed not to apply, and the second of those is how a scoped task ends up doing harm. The rule and its worked cases are in §5 under SCOPE.

### Asset ID prefixes

Since v2.0 these are **labels and publish-pipeline matching keys**, not logic. The app never parses a prefix to work out what an item is; it follows real foreign keys. The prefix survives as the blueprint's `legacy_code`, which is how the publish step recognises "this workbook row is that database row". So the rules below still matter — a changed or duplicated prefix breaks the *publish* match — but they no longer drive any runtime behaviour.

- Uppercase, no spaces.
- **Any number of segments** joined by single underscores — `LAWN`, `PLANT_ROSE`, `LAWN_MIXED_UTILITY`, `PLANT_LILY_OF_THE_VALLEY`, `VEG_FRUIT_RASPBERRY` are all valid.
- The first segment must be one of the nine category prefixes: `LAWN`, `BED`, `TREE`, `SHRUB`, `PLANT`, `VEG`, `HERB`, `STRUCT`, `TOOL`. Do not invent new top-level prefixes — the audit validates against `Reference_Lists`, and an unknown prefix is flagged.
- Prefixes **may** be substrings of one another (`PLANT_LILY` and `PLANT_LILY_OF_THE_VALLEY` coexist safely). Lookup is exact-key equality, never a prefix scan, so one can never capture the other's tasks.
- Every prefix must be unique. A duplicate makes the publish match ambiguous.
- `GROUP_` is a **reserved prefix** and must never begin an asset prefix.
- **Never type an instance suffix** (`_0001`) into `Default_Asset_ID_Prefix` or a task's `Target_Asset_ID`. In v1 the backend appended these; in v2 a user's garden item is identified by a real database key and the suffix has no meaning at all.

### Collections (the `Groups` column)

The `Groups` column declares an item's membership of a named set that tasks can target. **Since v2.0 this is the only way to write a task that applies to more than one item type.**

- Optional in form, but see §2a — for most new items it is the difference between receiving tasks and receiving nothing.
- Tags are uppercase, prefixed `GROUP_`, comma-separated within the one cell (e.g. `GROUP_SOFT_FRUIT, GROUP_CANE_FRUIT`).
- Tags live on the **blueprint**, not on the user's individual garden item. "Raspberries are soft fruit" is a fact about raspberries, declared once.
- **Membership is never inferred from spelling.** `VEG_FRUIT_RASPBERRY` does *not* automatically belong to any `VEG_FRUIT` grouping — there is no such thing. If you want a task to cover all soft fruit, tag each soft fruit blueprint `GROUP_SOFT_FRUIT` and target that.
- Every tag used must be declared on the `Collections` tab (see below) or the publish is blocked.
- A collection with no members matches nothing (silently at runtime; the audit flags it).

Collections currently in use:

| Tag | Members |
|---|---|
| `GROUP_SOFT_FRUIT` | Raspberry, Strawberry, Blackberry, Goji |
| `GROUP_BRASSICA` | Broccoli, Kale |
| `GROUP_TENDER_BULB` | Dahlia (the other tender bulbs each have their own lift-and-store task) |
| `GROUP_GRASS_LAWN` | Ryegrass, Fine Fescue, Bentgrass, Mixed Utility — conventional mown turf |
| `GROUP_LAWN_RENOVATION` | Ryegrass, Fine Fescue, Mixed Utility — lawns that take autumn scarify / aerate / overseed / top dress |
| `GROUP_LAWN_STANDARD_FEED` | Ryegrass, Mixed Utility — lawns that take a full-rate high-nitrogen feed. Deliberately excludes fescue and bentgrass, which take the same feed at half rate via `TASK_0009` |
| `GROUP_CULTIVATED_BED` | Herbaceous Border, Raised Bed, Annual Bedding, Mixed Shrub Border, Cutting Garden — beds of rich, worked garden soil |
| `GROUP_ALL_BEDS` | Herbaceous Border, Mixed Shrub Border, Woodland Shade, Gravel, Bog Garden, Rock Garden |
| `GROUP_BED_CLEARED` | Raised Bed, Annual Bedding, Cutting Garden — beds that stand empty between plantings |
| `GROUP_SHRUB_GENERIC` | Shrubs for which generic shrub care is safe |
| `GROUP_TREE_GENERIC` | Trees for which generic tree care is safe |
| `GROUP_HERBS` | Culinary and ornamental herbs |
| `GROUP_HAND_TOOLS` | Hand tools only — deliberately excludes powered tools, so tool-cleaning advice never reaches a chainsaw |
| `GROUP_WOODY_HERBS` | Rosemary, Sage, Thyme, Oregano — the evergreen Mediterranean sub-shrubs among the herbs. A deliberate subset of GROUP_HERBS, which also holds the leafy annuals and herbaceous perennials |

> **`GROUP_ALL_BEDS` does not mean every bed.** Despite the name it currently omits Raised Bed, Annual Bedding and Cutting Garden. A weeding task targeting it therefore does *not* reach three of the nine bed types. Treat the member list above as authoritative and the name as historical.

> **`GROUP_WOODY_HERBS` is a subset of GROUP_HERBS, not a replacement for it.** Its four members are evergreen Mediterranean sub-shrubs, and three things follow from that which are false for basil, mint, chives, parsley, coriander, dill, chervil and tarragon: they will not reshoot from bare brown wood, so any advice that removes growth has to stop at this year's green; they are the host plants for rosemary beetle, which is active from late summer through to spring; and in pots they are lost far more often to waterlogged winter compost than to cold. The collection describes what these plants are, not what content they happen to be missing, which is what makes it a legitimate collection rather than a holding pen — compare the GROUP_HERBACEOUS_PERENNIAL rejection in CHANGELOG 1.3. Watering and feeding stay on GROUP_HERBS, because those jobs are universal to anything in a pot and the difference in feed strength is handled inside the instruction text rather than by splitting the audience..

The whole-category collections were created during the v2.0 category-tier review, to re-home tasks that previously targeted a bare category. They are the sanctioned replacement for "applies to the whole category" — the difference being that their membership is an explicit, inspectable list rather than a spelling coincidence.

A `GROUP_HERBACEOUS_PERENNIAL` group was considered and rejected — see CHANGELOG 1.3. The lesson is worth keeping: **a collection must describe what an item *is*, not what content it happens to be missing.** If the only thing the members have in common is "no specific task written yet", it is not a collection.

### Task targeting

`Target_Asset_ID` must be **exactly one** of:

1. A **full item** prefix that exists in `Item_Dictionary` — e.g. `VEG_FRUIT_RASPBERRY`. Applies to that item type only.
2. A **collection tag** declared on the `Collections` tab and carried by at least one blueprint — e.g. `GROUP_SOFT_FRUIT`. Applies to every item carrying that tag.

There is no third option. In particular:

- A **bare category prefix** (`LAWN`, `PLANT`, `SHRUB`, …) is **no longer a valid target** and will block the publish. This tier was abolished in v2.0; its safe tasks were re-homed to the whole-category collections listed above, and its unsafe ones retired.
- A **partial prefix** such as `VEG_FRUIT` or `VEG_BRASSICA` has never been valid — it looks plausible and matches nothing. Use a collection.
- A **browse group** or a **review pass** is never a valid target. Both are labels for humans; neither has ever reached the matching engine.

### The collection safety rule

*(This is the old category-tier safety rule. The tier is gone; the hazard it guarded against is not.)*

A task targeting a collection must be safe for **every** member of that collection, with no exceptions.

This has bitten us repeatedly. "Cut Back Perennials" (cut to 10cm of the ground) targeted the whole `PLANT` category, so it was being issued for Rose, Clematis, Bamboo and Ivy — all woody. Generic shrub feeding and mulching would be actively harmful to Lavender, which needs poor, dry soil. And "End of Season Tool Clean" — rust-and-linseed care — was reaching a chainsaw until `GROUP_HAND_TOOLS` was created.

What changed in v2 is not the rule but the *visibility*: a collection's membership is a list you can read, so the blast radius of a task is always knowable before you write it. Before adding a task to a collection, read that collection's member list and check the advice against the most awkward member, not the typical one.

If advice is right for most members but wrong for some, it belongs on a narrower collection or on the specific item. `GROUP_LAWN_STANDARD_FEED` is the worked example: a full-rate high-nitrogen spring feed is right for ryegrass and utility turf and wrong for fine fescue, so the feed targets the narrower set rather than all grass lawns.

### The semicolon rule

Both tables are imported as **semicolon-separated** text.

The reason: `Valid_Months` legitimately contains commas (e.g. `3,4,5`), and `Category` and `Groups` can too. If the file were comma-separated, those lists would split across separate columns on import and shove every later column out of place — a silent corruption. Using semicolons as the column separator keeps the comma-lists safely inside one cell.

Consequence: **no free-text field may contain a semicolon.** `Task_Name` and `Instruction` must use only commas and full stops.

A semicolon that reaches the sheet does no harm where it sits — the damage happens if that row is ever exported and re-imported, when it splits the row across columns. The audit flags every occurrence as a WARNING; treat those as a real cleanup job rather than cosmetic noise. The review applier (§7e) refuses outright to write a value containing one.

### The rain column is a true/false value, not text

`Suppress_If_Raining` is published to a real boolean column. After import, a `TRUE` in that cell should sit **right-aligned** (Sheets treats it as a logical value). If it lands **left-aligned** as the text "TRUE", it is not a boolean. Leave the cell **blank** when the task is unaffected by rain — don't type `FALSE`.

In v1 a text "TRUE" silently did nothing. In v2 the database column is genuinely typed, so the failure surfaces at publish rather than lurking — but the audit still checks it at authoring time, which is the cheaper place to catch it. A row changed through the review applier (§7e) cannot fall into this trap at all: the applier writes a real logical value or clears the cell.

### The `Collections` tab declares every collection

A collection is a named set of blueprints that a task can target. The `Groups` column of `Item_Dictionary` records *which blueprints belong to* a collection; the `Collections` tab records *that the collection exists* and gives it a display name.

- Two columns: `Code` (e.g. `GROUP_SOFT_FRUIT`) and `Name` (e.g. `Soft fruit`).
- **Every `GROUP_*` tag you use** — in a `Groups` cell or as a task target — **must be declared here.** Publishing needs the declaration so it can create the collection with a name and reference it by key; an undeclared tag is a publish-blocking error, not a silent miss.
- A collection may be declared before any blueprint carries it (the audit flags this as REVIEW, not an error) — useful when setting up a group ahead of the tasks that will target it.
- Collections are never deleted by publishing. Removing a code from this tab does not remove the collection from the database; it simply stops being maintained. Empty it by clearing its members if you want it to reach nothing.

### The `Browse_Groups` tab declares every picker heading

A browse group is a heading the "Add to My Garden" picker clusters pills under — Perennials, Bulbs & tubers, Roses, Hedging. The `Browse_Group` column of `Item_Dictionary` records *which heading a blueprint sits under*; the `Browse_Groups` tab records *that the heading exists* and where it appears on screen.

- Two columns: `Name` (e.g. `Bulbs & tubers`) and `Sort_Order` (a whole number).
- **A browse group is not a collection, and the difference is load-bearing.** A collection decides what a blueprint *receives*; a browse group decides only where it *appears in a list*. They are separate tables in the database for exactly this reason: reorganising the picker can never change anyone's tasks. A task targeting a browse group is caught by the audit as "Target matches nothing" — headings are not valid targets and never will be.
- **Every heading named in a `Browse_Group` cell must be declared here.** An undeclared heading is a publish-blocking error, in the same way an undeclared collection is. The usual cause is a near-miss — `Bulbs and tubers` against a declared `Bulbs & tubers`.
- **`Sort_Order` must be a whole number.** It is a NOT NULL column in the database, so a blank blocks the publish rather than failing part-way through it. Author them in gaps of ten, so a new heading can be slotted between two existing ones without renumbering everything below.
- A heading may be declared before any blueprint uses it (the audit flags this as REVIEW, not an error), and headings are never deleted by publishing — the same upsert-only treatment collections get. Stop using a heading by clearing it from the blueprints that carry it.
- **A blank `Browse_Group` is legitimate.** Blueprints with no heading appear under an "Other" heading at the bottom of the picker — visible, not lost — and the audit warns about them only where *other* items in the same category have been grouped. A category nobody has grouped at all (Tools, Lawn) renders as one plain list, exactly as the picker looked before headings existed.
- The heading list is global rather than per-category. A heading is just a label; the picker shows whichever headings the blueprints under the tapped tile actually use.

### The `Botanical_Name` column disambiguates, and usually stays blank

Column **F** of `Item_Dictionary`. Where it is filled in, the picker shows it inline beside the common name, in smaller italics and brackets — "Geranium *(Pelargonium)*".

- **Fill it in only where the common name is genuinely ambiguous** — where the everyday word covers more than one plant, or where a beginner might not be sure the catalogue entry matches what is in their garden. Geranium, Bluebell, Laurel, Jasmine and Cedar qualify. Sunflower, Tomato and Foxglove do not. **Most rows should be blank.**
- The database enforces name uniqueness on blueprints, so this is never resolving a clash between two rows. It is resolving a doubt in the user's head.
- **Prefer the genus alone** (`Pelargonium`) over the full species (`Hyacinthoides non-scripta`). The name is displayed inside a small pill on a phone, and a long one can take up an entire row. Use the full species only where the genus by itself does not settle the ambiguity. The audit flags anything over thirty characters for a second look.
- Leave it **blank**, not empty-looking. A cell containing only spaces is rejected by the database, because it would render as a pair of empty brackets.
- The search box matches botanical names as well as common ones, so a filled-in cell makes that plant findable by its Latin name. This is a side benefit, not a reason to fill them all in — the picker showing a Latin name next to every plant would be noise.

### The `Review_Pass` column groups blueprints for review

Column **G** of `Item_Dictionary`, added in v2.7. It names which editorial review pass (§7b) a blueprint belongs to, so that a packet can be assembled by script rather than by filtering the sheet by hand.

- **One pass name per blueprint**, spelled exactly as it appears on the `Review_Passes` tab. Not a list, unlike `Groups`: the point of the programme is to cover the catalogue once, and a blueprint in two passes gets reviewed twice and finished never.
- **Inert for publishing, in the same way the `Reviewed` column is.** `Publish.gs` reads `Item_Dictionary` by fixed column index 0–5 and never looks at index 6, so nothing in this column can reach the database or affect a user. That is deliberate: the safest bookkeeping is bookkeeping the pipeline cannot see.
- **It is neither a collection nor a browse group.** It changes neither what an item receives nor where it appears. A task targeting a pass name is caught by the audit as "Target matches nothing".
- **Blank is legitimate but has a cost.** A blueprint with no pass appears in no packet and will never be reviewed. The audit reports the total as a single REVIEW finding rather than one per row, so that adding the column to a 250-row catalogue does not produce 250 findings.
- Fill it in the same sitting as the blueprint (§3 step 11). To fill a backlog, run **Garden Data → Editorial review → Suggest passes for unassigned items**, which fills blank cells only and never overwrites anything you have already set. It reads each item's `Browse_Group` — already a judgement about how a gardener groups these plants, and a far better answer than the prefix, which lumps every herbaceous plant together under `PLANT` — and puts the item in the **highest-numbered** matching pass that still has room. Newest-first rather than evenest: dropping a new plant into a pass already marked complete quietly makes it incomplete again. When every matching pass is full the item is left blank and reported, because opening a `Perennials_06` is a decision about the shape of the programme.

### The `Review_Passes` tab declares every pass

The same relationship as everywhere else in this workbook: the tab records *that the pass exists*, and the column in `Item_Dictionary` records *which blueprints are in it*.

- Two columns: `Pass_Name` (e.g. `Perennials_03`) and `Notes` (anything you want to remember about it — which collections it involves, why you split it the way you did).
- **Declaring a pass is optional.** The picker lists every name it finds in column G whether or not it is declared, shown in a separate group underneath with its item count, and one button declares them all. Everywhere else in this workbook a declaration tab is load-bearing, because an undeclared collection or browse group has nowhere to publish to. A review pass publishes nowhere, so refusing to build a packet over a missing declaration would be a heavy price for a warning — particularly when the pass list grows every time a category outgrows its split.
- **What declaring buys you** is the order the passes appear in, somewhere to keep notes, and a cleaner audit report. What the separation in the picker buys you is the typo check: a stray `Perennial_03` carrying one item is obvious sitting next to `Perennials_03` carrying fifteen. The audit reports undeclared names as a WARNING for the same reason.
- **Numbered families are the normal shape.** `Perennials_01` … `Perennials_05`, `Bulbs & tubers_01`, `Shrubs_02`. The base name is what the suggester matches on, and the number is how a category grows past what one sitting can review.

**Columns C to G track the state of each pass, and are written by the script.** They are rebuilt on every audit run, every apply and every mark, so do not type in them — anything you enter is overwritten. Columns A and B are yours.

| Column | Holds |
|---|---|
| C `Items` | blueprints carrying this pass name in column G |
| D `Live tasks` | live tasks reaching those blueprints, directly or through a collection |
| E `Reviewed` | how many of those carry an `E` marker in column M |
| F `Status` | in plain English, below |
| G `Last run` | the date the pass was last actually applied or marked |

**All of it is derived, and none of it is stored.** There is no box to tick, deliberately: a stored flag is a second source of truth that drifts the moment you author a task and forget to clear it, and this workbook already has enough ways to fail quietly. Everything is recomputed from `Master_Task_Matrix` and `Review_Log`, so it cannot disagree with them.

**Two sources, because neither answers the question alone.** Column M records whether a *task* has been looked at. `Review_Log` records whether a *pass* has been run. The difference matters: a task targeting `GROUP_SHRUB_GENERIC` is stamped the moment `Shrubs_01` is applied, so `Shrubs_02` — which shares those collection tasks — would read as partly or even wholly reviewed on column M alone, without anyone having opened it. A dry run does not count as running a pass.

The statuses:

- **Not started** — never run, and none of its tasks reviewed. This is where to pick the programme up.
- **Not run — N of its tasks were reviewed in another pass** — those are collection tasks a neighbouring pass has already stamped. The tasks have been judged; these items have not.
- **Complete** — run, and every live task reaching it carries an `E`.
- **N task(s) unreviewed since — run it again** — it was signed off and has since had tasks added, which is the normal state after filling a gap the review found (§7f). Not a fault; a queue.
- **No items** / **No tasks reach these items** — usually a leftover pass name, or a typo in column G that has stranded a single item.
- **A pass of more than about sixteen blueprints is too big.** The audit flags it. A packet a reviewer will not read to the end is worse than two packets they will, and the completeness that makes "what is missing?" answerable is a property of the *pass*, not of the packet size — so split the pass, never its tasks.
- The tab is created for you, seeded with ten suggested passes, the first time you build a packet.
- Nothing is ever deleted by publishing, because nothing here is ever published.

### The `Retired` column tombstones a task

Column **L** of `Master_Task_Matrix`, headed `Retired`. Any non-blank value marks the task as retired: put a short reason in the cell (it stays as editorial context). This replaces the old procedure of *deleting* a task's row and listing its ID in an `Audit.gs` constant.

- A retired task **keeps its row** — name, instruction and all — but is published as a tombstone: `retired_at` is set in the database and it is given **no targets**, so it never appears in the app.
- Retirement preserves history. Completions recorded against the task (now in `task_completion` in Postgres) keep a valid reference, and the retired ID can never be reissued.
- A retired row still needs a valid `Task_ID`, `Valid_Months`, `Frequency_Days` and `Category`, because the database stores the tombstone. A pure tombstone for a task that never had a real row (recovered from an orphaned log entry) can use nominal values: `Valid_Months` `1`, `Frequency_Days` `365`. Its target may be left blank.
- **The reason text is read by the review packet builder** (§7b) and shown to the reviewer, so a job you withdrew on purpose is not reported back to you as a gap. Write the cell as a sentence someone else could act on — "Destroys grafted forms, see TASK_0401" rather than "no".
- The old `RETIRED_TASK_IDS` constant in `Audit.gs` is **gone.** Retirement is now a property of the data, exactly here. To withdraw a task, fill its `Retired` cell and publish — do not delete the row.

### The `Reviewed` column records review state

Column **M** of `Master_Task_Matrix`, headed `Reviewed`. Added because re-reviewing the matrix is a multi-session programme of roughly two dozen passes (§7b) and there was previously no way to keep your place between sessions.

**Format:** a pass letter, a space, and an ISO date. Multiple entries are comma-separated, most recent last.

```
E 2026-07-25                    reviewed once, editorially
E 2026-07-25, I 2026-08-14      also covered by an interaction review
```

- `E` — the editorial review (§7b) has covered this row.
- `I` — the interaction review (§7c) has covered this row.

Leave it **blank** for a row that has not been reviewed. Anything else in the cell is flagged by the audit as a malformed value, so the count stays trustworthy.

**Since v2.7 it is normally written by script, not by hand.** Applying a pass's decisions (§7e) stamps `E` and today's date across every live task reaching that pass, and **Mark a pass as reviewed** does the same without applying anything. Both replace an existing entry of the same letter rather than adding to it, so a collection task that comes up in five shrub passes ends with one `E` entry carrying the most recent date, not five. Entries of the other letter are preserved. You can still type it by hand; the format is the same.

**This column is inert for publishing.** `Publish.gs` reads `Master_Task_Matrix` by fixed column index 0–11 and never looks at index 12, so nothing in column M reaches the database. It exists purely for the authoring programme. The audit reports how many live tasks are reviewed and how many are not, and breaks that down by pass, which is how you find where you stopped.

**A collection task is legitimately reviewed more than once.** A task targeting `GROUP_SHRUB_GENERIC` comes up in every shrub group pass, judged against a different awkward member each time. The column records the most recent look, not a one-time tick.

---

## 2a. Nothing until deliberately included

The single most important behavioural change in v2.0, and the one most likely to catch you out when authoring.

**Under v1**, a new blueprint got care for free. Add `PLANT_ASTER` and it immediately inherited every task targeting the bare `PLANT` category. That inheritance was also the source of the worst bugs in the project's history — items silently receiving advice that was wrong or harmful for them, with nobody having decided they should.

**Under v2**, nothing is inherited. A blueprint receives exactly the tasks that name it, plus the tasks targeting collections it has been explicitly added to. Add a new plant, write no tasks, tag no collections, and it will receive **zero tasks, forever, silently.** The app will happily show it in the picker and in the user's garden, and never suggest a single thing to do with it.

This is the intended design — it trades a class of harmful-advice bugs for a class of missing-content gaps, which are far safer and are detectable. But it puts a real obligation on authoring:

**Whenever you add a blueprint, decide its coverage in the same sitting.** Either:
- add it to one or more existing collections (usually the right answer — a new shrub probably belongs in `GROUP_SHRUB_GENERIC`), and/or
- write specific tasks for it, and/or
- consciously accept that it has no content yet, and let the coverage report track it.

**The coverage report is the safety net.** The dry run (§10) lists every blueprint that no live task reaches. It is a *warning*, never a blocker — some items legitimately await content — so it only helps if you actually read it. Run the dry run after any authoring session that adds blueprints, and treat a new name appearing in the coverage list as a to-do, not as noise.

**The review programme is the second safety net, and it fails the same way.** A blueprint with no `Review_Pass` is in no packet, so no editorial review will ever ask what it is missing. Setting column G is part of adding an item, not an afterthought.

Known outstanding gaps are recorded in `SPEC.md` §5E rather than here, so that this document does not carry a list that silently goes stale. The dry run is always the live authority.

---

## 3. Workflow A — adding items to `Item_Dictionary`

1. Run the **Item prompt** (§5) in a fresh LLM chat. If you're topping up an existing category, paste your current names/prefixes into the prompt's "ALREADY EXISTS" slot so it won't repeat or collide with them. Paste your existing collection tags into the "EXISTING GROUP TAGS" slot so it reuses them rather than inventing.
2. Copy the generated block (everything inside the code block).
3. In the sheet, on the `Item_Dictionary` tab, click the first empty cell in **column A** below your last row.
4. Paste. Everything lands stacked in one column.
5. Select what you just pasted, then **Data → Split text to columns → Separator: Semicolon**.
6. Delete the header row the prompt included (your sheet already has headers).
7. Check: prefixes are uppercase, no spaces, first segment is one of the nine valid category prefixes. Optional duplicate guard — put `=IF(COUNTIF(C:C,C2)>1,"DUP","")` in a spare column and look for any `DUP` flags, then delete the helper column.
8. Check for duplicate *items* as well as duplicate prefixes: does this plant already exist in the sheet under a different prefix?
9. **Decide coverage now** (§2a). For each new item, either add it to the appropriate collections in the `Groups` cell, or queue it for task authoring. An item with neither will receive nothing.
10. **Set `Browse_Group`** (column E) for anything landing in a category whose other items are grouped — in practice Plants & flowers, Trees & shrubs and Veg & herbs. Use a heading exactly as spelled on the `Browse_Groups` tab. Left blank, the item still works but drops to the bottom of the picker under "Other". Fill `Botanical_Name` (column F) only if the common name is ambiguous; leave it blank otherwise.
11. **Set `Review_Pass`** (column G), so the item will actually be reviewed. The prompt output is six columns wide and the semicolon split never touches column G, so it is always yours to fill. A name that is not yet on the `Review_Passes` tab still works — the picker offers it and can declare it for you — but declaring it is what gives you control over the order and somewhere to keep notes. If you are adding a batch, **Garden Data → Editorial review → Suggest passes for unassigned items** will fill the blanks from each item's browse group, packing into the newest pass that has room.

---

## 4. Workflow B — adding tasks to `Master_Task_Matrix`

1. **Find the next Task ID.** Put this formula in any empty cell. It reads the highest existing number and gives you the next one to start from:

   ```
   =IFERROR("TASK_"&TEXT(MAX(ARRAYFORMULA(IFERROR(VALUE(REGEXEXTRACT(Master_Task_Matrix!A2:A,"\d+")),0)))+1,"0000"),"TASK_0001")
   ```

   Always read this from the workbook rather than trusting a remembered number. The review packet builder (§7b) also prints it in its header, computed the same way, so if you are filling gaps found by a review you already have it.

2. **Gather the prompt's three required inputs.** The task prompt (§5) will not work properly without them:
   - the item names and exact prefixes, or the collection tag;
   - for a collection target, the **full member list** of that collection;
   - **every live task that already reaches those items** — including tasks that target a collection they belong to, which are easy to forget. Filter `Master_Task_Matrix` by target, and check the `Groups` cell of each item for collections to filter by as well.

   **If you are filling gaps found by an editorial review, do not assemble this by hand.** The review packet already contains all three, correctly resolved, plus the retired list. See §7f.
3. Run the **Task prompt** (§5). Read its year plan and diff before you look at the CSV.
4. Copy **only the code block**. The year plan, the diff and the notes are for you to read, not to paste.
5. On the `Master_Task_Matrix` tab, click the first empty cell in **column A** below your last row, and paste.
6. Select what you pasted, then **Data → Split text to columns → Separator: Semicolon**.
7. Delete the header row the prompt included.
8. Leave columns **L** (`Retired`) and **M** (`Reviewed`) empty on new rows. The paste is eleven columns wide and never touches them.
9. Run the verification checklist in §6, then **Garden Data → Run Audit**.

**Optional safety net:** if you'd rather not paste straight into the live table, do steps 5–7 on a scratch tab first, eyeball the result, then copy the clean block into the real table.

---

## 5. The prompts

Each prompt below carries a recommended model and thinking effort. They differ more than you might expect: one is bounded formatting work, the other produces advice a novice will follow literally. Spend the reasoning where the mistakes are expensive.

### Item prompt (`Item_Dictionary`)

> **Recommended: Claude Sonnet 5, extended thinking on, low-to-medium effort.**
>
> This is bounded generation against a strict format. The likely failures — a stray semicolon, a mis-spelled category, an invented top-level prefix — are mechanical, and the audit catches all of them before they can do harm. Sonnet is quick and entirely sufficient.
>
> Step up to **Opus 5 at medium** if you're seeding an unfamiliar category from scratch, or if you're leaning on it to assign collections. Deciding whether generic shrub care is genuinely safe for a particular shrub is a horticultural judgement, not a formatting one, and it's the part of this prompt that can quietly cause harm downstream.
>
> The prompt deliberately does **not** output `Review_Pass`. That column is yours (§3 step 11), and keeping the output six columns wide is what guarantees the semicolon split can never overwrite it.

```
Act as an expert UK horticulturist and database engineer. I maintain a lookup table called `Item_Dictionary` for a mobile gardening app — a master catalogue of blueprint items a user might have in their garden.

TASK:
- If I supply a CATEGORY and COUNT below, generate that many items for that single category.
- If both are blank, generate 5–10 common baseline items for EACH of the 7 categories.

INPUTS (optional):
CATEGORY: [blank, or one of the 7 below]
COUNT: [blank, or a number]
ALREADY EXISTS (do not repeat these items or prefixes, and do not create a prefix that collides with them):
[Paste existing Suggested_Name / prefix pairs, or leave blank]
EXISTING GROUP TAGS (reuse these where they apply; only invent a new one if genuinely needed):
[Paste existing GROUP_* tags, or leave blank]
VALID BROWSE GROUPS (use these exact strings and no others):
[Paste the Name column from the Browse_Groups tab, or leave blank]

THE 7 STRICT CATEGORIES (exact casing and ampersands):
Lawn
Beds
Trees & shrubs
Plants & flowers
Veg & herbs
Garden structures
Tools

OUTPUT RULES:
1. Output ONLY raw CSV text inside a single code block. No text before or after.
2. Exactly six columns, exact headers:
Category;Suggested_Name;Default_Asset_ID_Prefix;Groups;Browse_Group;Botanical_Name
3. Use a SEMICOLON (;) as the column separator.

FIELD RULES:
- Category: one or more of the 7 above. If an item genuinely belongs under two tiles (e.g. a Rose is both a flower and a shrub), list both, comma-separated inside the one field (e.g. "Plants & flowers, Trees & shrubs"). Never create two rows for the same plant.
- Suggested_Name: clean, human-readable, NO semicolons (e.g. Rose, Lavender, Shed, Tomato, Hand Trowel).
- Default_Asset_ID_Prefix: UPPERCASE, no spaces, segments joined by single underscores. The FIRST segment must be one of: LAWN, BED, TREE, SHRUB, PLANT, VEG, HERB, STRUCT, TOOL. Any number of further segments is allowed (e.g. PLANT_ROSE, LAWN_MIXED_UTILITY, VEG_FRUIT_RASPBERRY). Never invent a new top-level prefix. Every prefix must be unique. Never begin a prefix with GROUP_ — that is reserved.
- Choose the prefix by what care the item actually needs, not by which tile it displays under. Woody plants (roses, lavender, hydrangea) take SHRUB_*; herbaceous plants take PLANT_*.
- Groups: assign the item to every EXISTING group tag I listed above that genuinely applies. This matters: an item in no group, with no tasks written specifically for it, will receive NO care tasks at all — there is no category-level fallback. Comma-separate multiple tags inside the one field. Do not invent speculative new groups; if an item fits none of my existing tags, leave it blank and say so in a note AFTER the code block so I can write specific tasks for it.
- Browse_Group: exactly one heading from the VALID BROWSE GROUPS list above, or blank. This controls only where the item appears in the picker — it has NO effect on which tasks the item receives, so never use it as a substitute for a group tag. Judge it by how a UK beginner would look for the item, not by strict botany: Lavender is botanically a shrub and belongs under Shrubs; a climbing rose belongs under Roses, not Climbers. If no heading fits — tools, sheds, patios, lawns, beds — leave it blank rather than forcing one.
- Botanical_Name: fill this in ONLY where the common name is genuinely ambiguous, meaning it could refer to more than one plant, or a beginner might not be sure the entry matches what is in their garden. Geranium, Bluebell, Laurel, Jasmine and Cedar qualify; Sunflower, Tomato and Foxglove do not. Expect the large majority of rows to be blank. Prefer the genus alone (Pelargonium) over the full species (Hyacinthoides non-scripta), because it is displayed inline in a small pill on a phone; use the full species only where the genus alone does not resolve the ambiguity. Never include a semicolon.

Generate the CSV now. After the code block, list separately any rows where you were unsure of the browse group or the botanical name, and why.
```

### Task prompt (`Master_Task_Matrix`)

> **Recommended: Claude Opus 5, extended thinking on, high effort.** (Claude Fable 5, if it's available to you.)
>
> Don't economise here — this is the one prompt whose mistakes reach a real garden. The output is advice a novice follows literally and has no knowledge to second-guess, and a collection-level task reaches every member of that collection at once.
>
> The failure that matters isn't a malformed row; the audit and the publish gate catch those. It's fluent, plausible-sounding advice that happens to be wrong for one awkward member of a collection, or right for the plant but wrong for the month. Nothing mechanical will ever catch that, so it's worth the deeper reasoning at the point of authoring rather than hoping the review picks it up later.
>
> **This prompt no longer asks for a fixed number of tasks.** It asks what the item's year looks like, compares that against what already exists, and writes only the difference. That means the "EXISTING TASKS" input is not optional garnish — leave it out and you will get duplicates of content you already have.
>
> **If you are filling gaps an editorial review found, do not fill these slots by hand.** The packet builder emits this prompt with all five inputs already in place — see §7b and §7f. Use the version below when you are authoring for something outside the review programme: a brand-new blueprint, or a gap you spotted yourself.

```
Act as an expert UK horticulturist and database engineer. I maintain `Master_Task_Matrix`, the care-task table for a UK gardening app. Its readers are NOVICE gardeners who follow instructions literally and have no knowledge to catch a mistake.

You are FILLING GAPS in an existing year of care. You are not producing a fixed number of tasks.

INPUTS
------
TARGET ITEMS (name + exact prefix, or collection tag):
[e.g.
Bamboo (SHRUB_BAMBOO)
Rhododendron (SHRUB_RHODODENDRON)]

COLLECTION MEMBERSHIP (required if any target above is a GROUP_ tag — the FULL list of blueprints in that collection):
[e.g. GROUP_SHRUB_GENERIC: Buddleja, Forsythia, Rose, Lavender, Holly, ...]

EXISTING TASKS FOR THESE ITEMS (required — every live task that already reaches these items, INCLUDING tasks that target a collection they belong to. If there are genuinely none, write NONE):
[Task_ID | Target_Asset_ID | Task_Name | Valid_Months | Frequency_Days]

ALREADY RETIRED FOR THESE ITEMS (jobs deliberately withdrawn — do NOT propose them again unless the reason no longer holds, and say so explicitly if you do):
[Task_ID | Task_Name | Retirement reason, or NONE]

STARTING TASK ID: [e.g. TASK_0651]
TARGET CATEGORY (exact casing): [e.g. Trees & shrubs]

METHOD — work in this order
---------------------------
STEP 1 — THE YEAR. Before writing any row, walk January to December for each target item and set out what that item actually needs in each month in UK conditions. Include the months where the correct answer is "nothing", and say why. A courgette in February is finished. A plum must not be pruned in winter because of silver leaf. Deliberate blanks are correct answers, not gaps to be filled — do not manufacture work to fill a calendar.

STEP 2 — THE DIFF. Compare your year against the EXISTING TASKS list. State plainly which needs are already covered and which are genuinely unmet.

STEP 3 — WRITE ONLY THE GAPS. Do not restate, reword or improve an existing task. If an existing task looks wrong to you, say so in the notes — do not silently write a competing version of it.

Write as many or as few rows as the gaps require. Two is fine. Nine is fine. Zero is fine: if the year is already covered, say so and write no CSV at all.

OUTPUT — in this order
----------------------
1. THE YEAR PLAN — month by month, in prose, including the deliberate blanks.
2. THE DIFF — covered versus genuinely missing.
3. THE CSV — a single code block, containing only the rows that fill the gaps.
4. NOTES — see the NOTES section at the end of this prompt.

Only the code block gets pasted into my sheet. Everything else is for me to read.

CSV RULES
---------
1. Exactly 11 columns, exact headers, in this order:
Task_ID;Target_Asset_ID;Task_Name;Category;Instruction;Valid_Months;Frequency_Days;Suppress_If_Raining;Suppress_If_Temp_Below;Requires_Wind_Above;Estimated_Minutes
2. Use a SEMICOLON (;) as the column separator. Do NOT use a semicolon anywhere else — not in Task_Name, not in Instruction.
3. Do NOT output a Retired or Reviewed column. Those are columns L and M and I fill them by hand.

FIELD RULES
-----------
- Task_ID: sequential from STARTING TASK ID, no gaps, 4-digit zero-padded.
- Target_Asset_ID: MUST exactly match one of the prefixes or collection tags I provided. Never invent prefixes. Never use a partial prefix such as VEG_FRUIT. Never use a bare category prefix (LAWN, BED, TREE, SHRUB, PLANT, VEG, HERB, STRUCT, TOOL) — bare category targets are INVALID and are rejected on import.
- Task_Name: short title, no semicolons. It must describe who the task is actually for. Do not write "Mulch Trees and Shrubs" on a task that targets only trees.
- Category: exactly the TARGET CATEGORY above. Display metadata only — it labels the card and plays no part in who receives the task.

- Instruction: 3 to 6 sentences of novice-friendly UK advice. It MUST contain all four of the following. Two sentences cannot hold them, which is why the old limit produced stubs.
    (a) THE ACTION — what to physically do, in plain words a beginner can act on without looking anything up. No jargon. If a technical term is unavoidable, define it in the same sentence.
    (b) THE FINISH CONDITION — how the user knows they have finished. "Until water runs from the bottom of the pot." "Until you can see bare soil between the crowns." Not "water well" or "tidy up".
    (c) THE COMMON MISTAKE — the specific thing beginners get wrong here, and what it causes. This is what separates a useful row from a stub, and it is the element most often missing.
    (d) A SAFETY NOTE, where one genuinely applies — blades, ladders and working at height, power tools, anything in a confined or unventilated space, anything involving a chemical product, and any plant whose sap, clippings or berries are poisonous. Omit it where nothing is at stake. Do not pad.
        Where one of these fits, use it VERBATIM as the last sentence rather than writing your own, so the wording stays identical across the matrix:
        - Hand tools on a mature tree: "Keep both feet on the ground and work only within comfortable reach, and leave anything above head height or thicker than your arm to a professional tree surgeon."
        - Powered hedge trimmer: "Wear eye protection, plug a mains trimmer into a socket protected by an RCD, and keep both feet on the ground rather than working off a ladder with a running blade."
        - Any chemical product: "Read and follow the product label - it is the legal instruction."
        Formative pruning of a young tree does NOT take the at-height line, being by definition within reach. Adding it there is padding.
        For a poisonous plant there is no standard line, because the risk differs — clippings reaching animals for yew, seed pods reaching children for laburnum, raw fruit for elder. Name the specific hazard and what to do about it, and set a wind threshold of 15 where the job is done at height.
  Commas and full stops only. NO SEMICOLONS.

- CHEMICALS — a hard rule, no exceptions. NEVER name a chemical active ingredient or brand: not glyphosate, not ferrous sulphate, not ferric phosphate, not metaldehyde, not copper sulphate, and not any other. This applies even inside a warning and even when the substance is banned. Product approvals change, and a row naming an active dates into being wrong or illegal without anyone noticing.
  Instead, name the PRODUCT CATEGORY as it appears on a shop shelf — "a selective lawn weedkiller", "a moss treatment sold for lawns", "slug pellets approved for garden use", "a path and drive weedkiller" — and add: "Read and follow the product label - it is the legal instruction."
  Where the hazard is that a beginner buys the wrong thing, disambiguate by describing the product's purpose rather than its chemistry: "the moss treatment sold for lawns, which is not the same as the sharp sand used for top dressing."

- Valid_Months: comma-separated integers 1–12, ascending, no spaces (e.g. 3,4,5). This comma list sits inside ONE semicolon field.

- Frequency_Days: a positive whole number — the cooldown before the task may reappear. Before you choose the number, state the real cadence in words in your NOTES ("in practice this is done once, in early spring"; "every week or so while the plants are cropping") and check that the number matches the words. A once-a-year job is 365. A weekly job through its season is 7. Never blank, never zero. Do NOT go below 3 unless the job genuinely needs doing every day — a value of 1 means the app may offer this task every single day of its season, which is how a useful job becomes something the user learns to dismiss.
  THEN CHECK THE COOLDOWN AGAINST YOUR OWN VALID_MONTHS. A cooldown longer than the gap between the months you declared makes those later months unreachable — the task fires in the first month and is still on cooldown when the others arrive, so they are decorative. Two rules follow:
    (i) If Valid_Months spans several consecutive months and the job recurs within that span — inspecting, picking, raking, checking — the cooldown must be short enough to fire more than once inside it. Do NOT write 365 on a job your own instruction describes as repeated.
    (ii) If Valid_Months declares two separate windows in a year, the cooldown must be shorter than the SMALLER gap between them, measured in both directions. Months 3 and 10 are seven months apart one way and five the other, so a 180-day cooldown blocks the March window every time and the task quietly becomes annual. Use 120.
  State this check in your NOTES for any row with more than one valid month.

- Estimated_Minutes: whole minutes a novice would realistically spend on ONE occurrence, including fetching the tools and putting them away. Calibrate against this scale:
      5        a look — checking, inspecting, opening a vent
      10-15    one plant or a small patch — deadheading, tying in, a single stake
      20-30    one bed, or mowing an average lawn
      45-60    a whole-bed job — clearing, planting out a row, lifting and storing
      90-150   a lawn renovation step, or cleaning all the greenhouse glass
      240      a whole-day job such as treating every fence panel
  A beginner is slower than an experienced gardener. Never blank, never zero.

- Suppress_If_Raining: the word TRUE only where rain genuinely stops the job — watering, liquid feeding, spraying, painting, mowing. Otherwise leave blank.

- Suppress_If_Temp_Below: integer degrees Celsius, and use it SPARINGLY. It HIDES the task below that temperature. Putting a value on a task whose Valid_Months fall between November and March will hide that task for most of the winter, which silently deletes it from the year without anyone seeing an error. Only use it where being hidden in the cold is genuinely what you want.

- Requires_Wind_Above: despite its name this HIDES the task when wind exceeds the given speed in mph. Use it for jobs that are unsafe or ineffective in wind — spraying, liquid feeding, spreading granules, anything at height. 15 to 25 is the sensible range. A value below 10 would hide the task almost permanently. Leave blank if wind does not matter, which is most tasks.

SEQUENCING AND CROSS-REFERENCES
-------------------------------
- The app does not order tasks. If a job must happen before or after another job on the same item, the ONLY place that ordering can live is the instruction text the user reads. Say it in the first sentence: "Autumn lawn programme - do this after aeration and before top dressing."
- If a new task conflicts with an existing one — a treatment that must not follow a sowing, a feed that must not follow another feed — write the warning into BOTH directions, and tell me in the NOTES which existing row needs the matching sentence adding. A one-sided warning is how the two rows drift apart later.

CRITICAL — IRREVERSIBLE ADVICE
------------------------------
Before writing any row that removes wood, ask what happens if the user has a slightly
different plant from the one you are picturing. Wasted effort is recoverable. A cut is
not. These three traps have all reached live data:

- GRAFTED PLANTS. Never write "cut to ground level", "cut down to a stump" or any
  equivalent without first naming who must NOT do it. Many ornamental forms are grafted
  onto a plain rootstock — contorted and purple hazel, Kilmarnock willow, weeping and
  standard forms generally, and every fruit tree — and cutting below the graft removes
  the variety permanently, leaving the rootstock. The user cannot undo this and will
  not know it has happened until the wrong plant grows back. Coppicing, pollarding and
  hard renovation pruning all need this exclusion stated BEFORE the action.

- THE BLEEDING SPECIES. Maple (including sycamore and field maple), birch, hornbeam,
  walnut and grapevine bleed sap heavily once it starts rising in late winter. Prune
  them in EARLY winter — 11,12,1 — and never declare February. Say why in the
  instruction, so the user does not tidy the tree up in March.

- CUTTING OFF NEXT YEAR'S CROP. Where a plant flowers or fruits on the previous
  season's wood, pruning for shape and pruning for a crop are different jobs with
  different answers. Elder and apple are worked examples. If one cut serves one goal
  and destroys the other, say so in the FIRST sentence and let the user choose — do not
  bury it, and do not pick for them.

CRITICAL — COLLECTION-LEVEL TASKS
---------------------------------
If a Target_Asset_ID is a GROUP_ tag, the advice must be safe for EVERY member listed above, without exception. Judge it against the most awkward member of the collection, not the typical one. If the advice is right for most members and wrong for one, do NOT write it — tell me which member breaks it, so I can narrow the collection or write a specific task instead.

SCOPE — WHO THE TASK IS FOR
---------------------------
Where a task applies to only some of the people who will receive it, say so in the
FIRST sentence and give everyone else permission to tick it off. A user who reads one
line and moves on has lost nothing. A user who works out three sentences in that it was
never meant for them has learned to skim, and will skim the row that did matter.

Filter on SOMETHING THE USER CAN OBSERVE, never on where they live. A geographic
condition — "if you are in the South East", "in milder parts of the country" — fails
three ways. The user cannot assess it. The boundary moves without anyone editing the
row. And when it goes out of date it fails UNSAFE, telling somebody the task is not for
them when it is. Pest ranges spread and frost dates shift, and nothing in the audit or
the publish gate can see an instruction that has quietly become geographically untrue.

There is almost always an observable stand-in for a region, and it is more accurate than
the region anyway:
  - not "if you are in the South East" but "if there is a white silken nest on the trunk"
  - not "where pear rust occurs" but "if there is a juniper in your garden or next door"
  - not "in colder parts of the country" but "if frost is forecast this week"
  - not "in high rainfall areas" but "if the pot is standing in water"

This holds for any condition the user cannot settle by looking — soil type, aspect,
hardiness, how long they have gardened. Find the thing they can see. An observable
filter also needs no maintenance, because the world updates it rather than you.

NOTES (after the code block)
----------------------------
- The cadence reconciliation for every new row: the real-world cadence in words, and the Frequency_Days you chose.
- Any existing row you believe is wrong, and why.
- Any cross-reference sentence that needs adding to an existing task.
- Anything you could NOT judge from the material I gave you — a collection whose membership I did not paste, an existing task whose instruction I did not include, a question about my climate or soil. Say so plainly rather than assuming.

Begin with the year plan.
```

### The standard safety lines

Three warnings recur often enough that they are now fixed wording rather than something each row invents. Each was introduced because an audit found the same hazard unmentioned across a dozen rows and present on one.

| Line | Introduced | Applies to |
|---|---|---|
| Read and follow the product label | v2.2 | any task naming a product category — weedkiller, moss treatment, slug pellets, wood treatment |
| Isolate the machine, eye protection, RCD outdoors | v2.3 | powered tool maintenance, where hands go near a blade |
| Keep both feet on the ground, tree surgeon above head height | v2.6 | pruning a mature tree with a saw or secateurs |
| Eye protection, RCD, no ladder with a running blade | v2.6 | powered hedge trimming |

Reuse the wording exactly. The point of a standard line is that it reads identically everywhere, so a user learns it once and a reviewer can grep for its absence. A paraphrase is worse than nothing, because it looks like the check has been done.

**Where a standard line does not fit, do not stretch one.** Poisonous plants are the case in point: yew, laburnum and elder each need a different warning about a different route to harm, and a generic "this plant is poisonous" would tell the user nothing they can act on. Write the specific hazard.

**Do not apply a safety line where nothing is at stake.** §5 says "do not pad" for a reason — a warning on every row is a warning on none.

---

## 6. Verification checklist (after importing tasks)

- Columns line up: the eleven authored columns, headers in the right order, nothing shifted. (Columns L `Retired` and M `Reviewed` are filled by hand or by the review applier, and the semicolon import never touches them.)
- `Retired` and `Reviewed` are both blank for every ordinary new task.
- `Valid_Months` sits as a single cell like `3,4,5` — **not** spread across several columns.
- `Task_ID` values continue the sequence with no gaps or duplicates.
- Every `Target_Asset_ID` is either a full item prefix that exists in `Item_Dictionary`, or a `GROUP_*` tag that is declared on `Collections` **and** carried by at least one blueprint — with no `_0001`-style suffix, no partial prefixes, and **no bare category prefixes**.
- Any collection-level task is genuinely safe for every member of that collection (check the member list, not your memory of it).
- Every `Instruction` carries the action, the finish condition and the common mistake — plus a safety note where one applies. A one-line instruction is a stub; the audit flags anything under 80 characters.
- No `Instruction` names a chemical active ingredient or brand.
- `Suppress_If_Raining` TRUE cells are right-aligned (real boolean), not left-aligned text.
- `Requires_Wind_Above`, where used, is on a task that should be **hidden** in wind — not one that should appear because of it.
- `Suppress_If_Temp_Below` is not set on a task whose months are all in the November-to-March window.
- `Frequency_Days` and `Estimated_Minutes` are whole numbers of 1 or more, never blank and never zero — and `Frequency_Days` is 3 or more unless the job is genuinely daily.
- **`Frequency_Days` is short enough to reach every month the task declares.** For a run of consecutive months, can it fire more than once inside the run? For two separate windows, is it shorter than the *smaller* gap between them, measured both ways? A 365 against a three-month window, or a 180 against months 3 and 10, means every month after the first never fires.
- **No task removing wood tells the user to cut low without naming who must not** — grafted, weeping and standard forms, and anything on a rootstock.
- **No maple, birch, hornbeam, walnut or vine task declares February**, and each says why it is pruned in early winter.
- **Any standard safety line is quoted exactly**, not paraphrased — and is absent from formative pruning of young trees, where it would be padding.
- **Any task applying to only some owners says so in its first sentence, and filters on something observable** — a nest on the trunk, a plant in the next garden, water standing under a pot. Never on region, soil, aspect or hardiness, which the user cannot assess and which date silently.
- No stray semicolons inside `Task_Name` or `Instruction`.

### After importing items

- `Category` cells contain only the seven allowed values (one or more, comma-separated).
- No plant appears twice under different prefixes.
- Any `GROUP_*` tag used is one you intended, spelled exactly as it appears elsewhere in the column, and declared on the `Collections` tab.
- Any `Browse_Group` used is spelled exactly as it appears on the `Browse_Groups` tab — watch for `and` where the tab says `&`.
- `Botanical_Name` is blank on the large majority of rows, and where present is a genus rather than a long full species.
- **Every new item has a `Review_Pass` (column G)** — or you have consciously accepted that it will never be reviewed. Check the spelling against the passes that already exist: a near-miss is not blocked, it just quietly becomes a second pass with one item in it. A blank here is the same class of quiet gap as a blank `Groups` cell, one step further down the line.
- Every new item either belongs to a collection or has tasks queued for it (§2a). Neither a browse group nor a review pass is coverage — one changes where the item appears, the other only whether you get asked what it is missing.

---

## 7. Quality assurance

This data fails **silently**. A task pointing at a target that doesn't exist doesn't throw an error — it just never appears. An item with no tasks doesn't complain — it simply shows the user nothing. Every significant bug found in this project so far has been of that kind, and each one sat undetected for weeks. QA is therefore not optional polish; it is the only thing standing between a typo and a plant that quietly never gets cared for.

Since v2.0 some of this is caught earlier and harder: the database rejects malformed rows at write time, and the publish gate refuses to run on any ERROR. But the gate cannot tell you that a task is *missing*, or that advice is *wrong*, or that two tasks issued in the same week contradict each other — so the human passes below still matter.

**There are three passes, and they catch entirely different things.**

| Pass | Unit of work | Catches | Run |
|---|---|---|---|
| **7a. Mechanical audit** | the whole workbook | broken references, malformed values, stubs, regressions | after every import; takes seconds |
| **7b. Editorial review** | one declared pass (10–16 related blueprints) | wrong advice, wrong month, unsafe collection tasks, genuinely missing jobs | one pass per session |
| **7c. Interaction review** | one garden, one month | contradictions, duplicates, ordering, cumulative load | after each category is editorially complete |

The editorial review has two follow-on steps that are not themselves passes: **§7e**, transcribing the findings you accept back into the matrix, and **§7f**, filling the gaps it found. Both were done by hand until v2.7 and are now partly automated.

### 7a. The mechanical audit — automated, run often

`Audit.gs` in the Apps Script project adds a **Garden Data → Run Audit** menu to the spreadsheet. It reads the authoring tabs, checks them against the rules in this document, and writes its findings to an `Audit_Report` tab. It never modifies data, and since v2.5 it never reads the live database either — everything it reports is judged from the workbook alone.

**Run it after every content import and after every schema change.** It takes seconds.

It checks for:

- **Targets that match nothing** — a `Target_Asset_ID` that is neither a prefix in `Item_Dictionary` nor a group tag carried by a blueprint. This is the single highest-value check, and would have caught the orphaned raspberry, fruit-netting and brassica tasks the day they were written.
- **Items that receive no tasks** — no specific tasks and no collection tasks. Since v2.0 there is no category-tier fallback to rescue them, so this check matters more than it used to (§2a).
- **Duplicate keys** — repeated `Task_ID` or `Asset_ID`.
- **Duplicate blueprints** — the same plant catalogued twice under different prefixes. The name check is deliberately loose, so "Rose" and "Rose Shrub" are flagged as a likely pair.
- **Duplicate task names on the same target** — two live tasks with the same name reaching the same item, which is almost always one job entered twice.
- **Collection tags that do nothing** — carried by blueprints but targeted by no task.
- **Stub instructions** — a live task whose instruction is under 80 characters. Too short to carry the action, the finish condition and the common mistake, so it is a candidate for rewriting.
- **Weather gates that suppress permanently** — a temperature floor on a task whose months all fall between November and March, and a wind ceiling below 10 mph. Both silently hide the task nearly always.
- **Implausible cadences** — a `Frequency_Days` below 3, meaning the task can reappear almost daily throughout its season.
- **Named chemicals** — any active ingredient or brand in a task name or instruction, flagged for review against the naming rule in §5. Withdrawn substances are called out separately and more loudly.
- **Schema hygiene** — invalid categories, unknown top-level prefixes, `GROUP_` misused as an asset prefix, `_NNNN` suffixes in a task target, malformed `Valid_Months`, missing `Frequency_Days` or `Estimated_Minutes`, semicolons in free text, malformed `Reviewed` values, and `Suppress_If_Raining` sitting as the *text* "TRUE" rather than a real boolean.
- **Review passes that do not exist** — a name in the `Review_Pass` column that is not declared on `Review_Passes`. This no longer stops the pass being reviewed, since the picker offers undeclared names too; it is a typo check, and a name carrying one or two items next to a near-identical one carrying fifteen is what it is looking for.
- **Blueprints in no review pass** — aggregated to a single finding with a count and the first dozen names, rather than one per row.
- **Review programme state** — how many live tasks carry a `Reviewed` value and how many do not.
- **Review pass status** — the audit rebuilds columns C to G of the `Review_Passes` tab (§2) on every run, and reports a one-line tally. That tab is the programme's bookmark: the global count tells you how much is left, the tab tells you *where* to pick it up.
- **Review pass too large** — a pass holding more than 16 blueprints, which is more than one sitting can review properly.

The `Reference_Lists` tab is the audit's source of truth for the seven categories and nine prefixes. Add a prefix there and the audit accepts it immediately — which is that tab's real job, and the reason to keep it.

**None of the review-programme checks can block a publish.** They are all WARNING or REVIEW severity. The publish gate blocks on ERROR only, so tightening the audit never risks stranding content that was publishable yesterday — and an unassigned blueprint is a gap in the *review* programme, not a fault in the content.

**A missing tab is now a finding, not a crash.** `Item_Dictionary` and `Master_Task_Matrix` carry the same guard `Reference_Lists` always had: rename one and the audit reports which tab it could not find, rather than stopping with a JavaScript error that names neither the tab nor the cause. The lookup is exact and case-sensitive, so a trailing space or a changed capital counts as missing. An absent `Review_Passes` tab is not a fault at all — the whole review-programme check simply stays quiet.

Findings come in three severities: **ERROR** (silently broken now), **WARNING** (probably not intended), and **REVIEW** (the script cannot judge; a human should look).

### 7b. The editorial review — human-judged, one pass at a time

The audit cannot tell you that scarlet lily beetle does not affect lily of the valley. No script can. Horticultural correctness needs a subject-matter pass.

**Why this is not done in batches of 50 rows.** An earlier version pasted a slice of the file by row number and asked three questions that a slice cannot answer:

- It asked what was **missing** for the items in the batch. You cannot know what is missing for roses while looking at two of their six tasks. The review duly reported rose pruning as absent when two correct pruning tasks existed further down the file.
- It asked for **contradictions** within the batch, when the real contradictions sit hundreds of rows apart.
- Task IDs run in rough authoring order, so 50 consecutive rows gave partial coverage of many items and complete coverage of almost none.

**The unit is a declared review pass: 10 to 16 related blueprints, with every live task that reaches any of them.** That includes tasks targeting any collection those blueprints belong to — which is the part most easily forgotten by hand, and the part where collection-safety bugs live. Group by shared collections and shared care pattern, so the awkward members sit in the same pass as the typical ones.

That makes the material complete for the items in it, which in turn makes "what is missing?" and "do any of these contradict?" answerable questions rather than guesses.

#### Building the packet

**Garden Data → Editorial review → Build review packet.** Pick a pass and the script assembles everything and shows it in a window with a copy button. It also writes a durable copy to the `Review_Packet` tab, one line per row, and lays out the `Review_Decisions` tab ready for the findings.

**The same material is offered wrapped in either of two prompts,** chosen with the toggle above the text:

- **Review prompt** — asks a reviewer what is wrong with these tasks. This is the pass itself.
- **Authoring prompt** — the task prompt from §5 with its five input slots already filled, for writing the tasks a review said were missing. See §7f.

One gather, two outputs, so the two can never disagree about what reaches these items. Whichever is showing is what the copy button copies.

What the packet contains, in order:

1. **The prompt** — the review instructions, so there is nothing to assemble around the data.
2. **The item group** — name, prefix and collection membership for every blueprint in the pass.
3. **Every live task reaching those items** — direct targets and collection targets both, with the full instruction text.
4. **Full collection membership** for every collection appearing as a target above. **Members outside the pass are marked with an asterisk.** They still receive the task, and they are usually where a collection-level fault hides, so the reviewer is told to judge the advice against them too. This is the check the manual process most often lost.
5. **Month coverage** for the pass's blueprints, sliced from the same computation that builds the `Coverage_Grid` tab (§7d), plus a line naming any item receiving nothing at all in any month.
6. **Previously retired tasks for these items**, with their retirement reasons. Without this a review reports a job you withdrew on purpose as a gap — which is exactly what happened before the section existed.
7. **The decision block specification** (§7e).

What it deliberately leaves out is the `Reviewed` column. Telling a reviewer that a row has been looked at before primes it toward approval, which is the failure mode the whole pass exists to resist.

The window header also shows the counts and the next free Task ID, which you will need if the review turns up gaps (§7f).

#### The programme

The catalogue is around 250 blueprints, so complete coverage is roughly two dozen passes — Plants & flowers alone needs eight to ten. At one pass per session that is a months-long programme, which is why the `Reviewed` column exists (§2) and why the audit reports progress per pass.

The passes themselves live on the `Review_Passes` tab, not in this document, so that the list cannot go stale here. **Start each session by running the audit and reading that tab**, which will tell you which passes have never been run and which have had tasks added since they were signed off. The tab is seeded with ten starting points the first time you build a packet; splitting the big ones is the first real job. The `Browse_Group` column is a good basis for splitting Plants & flowers, since Perennials, Bulbs & tubers and Roses are already sensible review groups.

**When to run it:** work through the programme steadily; additionally, run the relevant pass immediately after any large content injection, and whenever a new collection-level task is added, since those are the highest-risk kind.

**How:** paste the packet into a **fresh conversation**, with a model that has not seen this content before. Read the findings table, decide, then go to §7e. **Apply nothing automatically** — the whole point of the review is that a human decides, and an LLM confidently "correcting" curated horticultural data is precisely the risk being managed here. The applier in §7e does not weaken that rule; it automates transcription, never judgement.

### 7c. The interaction review — what fires together

This pass does not exist to judge any single task. It exists to judge what happens when several correct tasks arrive in the same week.

Neither of the other passes can catch this. The audit sees rows, not gardens. The editorial review sees one item group, but a real user's garden spans several — and the contradictions that matter are between a bed task and a plant task, or between two steps of the lawn programme that need doing in a particular order.

**The method:** take a plausible garden and a month. Assemble every live task that could fire for those items in that month. Then ask: do any of these contradict each other, duplicate each other, or need doing in a particular order that nothing tells the user about? Is the total amount of work plausible for one month?

**Four gardens, used consistently so results are comparable between runs:**

- **The starter garden** — mixed utility lawn, herbaceous border, shed, water butt, compost bin, trowel, spade, secateurs, rose, hydrangea. The modal novice.
- **The productive garden** — raised bed, greenhouse, cold frame, compost bin, tomato, courgette, runner bean, lettuce, carrot, strawberry, raspberry, basil, mint, watering can.
- **The low-maintenance garden** — gravel bed, drive, patio, fence panels, conifer, ivy, ornamental grass, hedge, leaf rake.
- **The awkward garden** — deliberately loaded with the exceptions: fine fescue lawn, clover lawn, moss lawn, lavender, plum, cherry, penstemon, echinacea, eryngium, chainsaw. This is the one that tests whether the collection boundaries actually hold.

**Five months, chosen because they are where jobs collide:** March, April, September, October, and one of December or January.

That is twenty runs for full coverage, but the awkward garden in April and October is where the value is concentrated — start there.

Use the interaction prompt in §8b. This pass is still assembled by hand: its unit is a garden rather than a pass, so the packet builder does not help. When a pass is complete, record it with **Garden Data → Editorial review → Mark a pass as reviewed**, choosing `I`, or type the entry into column M yourself.

### 7d. The `Coverage_Grid` tab

Every audit run rebuilds a `Coverage_Grid` tab: one row per blueprint, twelve columns for the months, each cell holding the number of live tasks that reach that item in that month. Empty months are shaded.

**This is a reference artefact, not a fault list.** Most empty months are correct — a courgette has nothing to do in February, a wildflower meadow is deliberately left alone from April to July, a plum must not be touched in winter. Turning it into audit findings would produce well over a hundred warnings that are almost all correct behaviour, and the only lasting effect would be teaching you to skim past the warnings section.

It feeds the editorial review instead. Since v2.7 you do not slice it by hand: the packet builder and the grid share one computation (`computeCoverageCounts_`), so the two can never disagree about what reaches what.

**The grid counts targeting, not applicability, and therefore overstates coverage.** A task counts for an item in a month if it targets that item and declares that month — the grid cannot read the instruction, so it cannot tell that the task only applies to some owners. Several do: watering a newly planted tree, checking stakes and ties, feeding a young or fruiting tree. Each shows as coverage for every member of `GROUP_TREE_GENERIC`, and none of them applies to a mature tree in open ground.

The tree pass is the worked example. On paper every tree had four to five tasks in March and one or two through the summer. In practice an established tree of any species received two jobs a year, both in spring, because everything else was scoped to young trees inside its own text. A grid row can look adequately covered and still describe an item the app has nothing to say about.

So when reading the grid in a review, ask not only whether the month is empty but **who the tasks in a non-empty month actually apply to.** A count of one, from a task whose first sentence excuses most owners, is a blank wearing a disguise.

### 7e. Applying what the review found

The review returns prose findings plus a **decision block** — a semicolon-separated transcription of the changes it would make, one row per cell. The prose is what you read and judge; the block exists only so that accepting a finding does not mean retyping an instruction by hand into a 700-row sheet.

**This does not weaken the "apply nothing automatically" rule.** Nothing reaches `Master_Task_Matrix` that you have not ticked, one row at a time. A dry run shows every before-and-after first. And the applier is stricter than a human transcriber, because it enforces the authoring rules in §5 at the moment of writing — which nothing else in this workflow does, since the audit can only inspect what is already in the sheet.

#### The decision block

Six columns: `Task_ID`, `Finding`, `Verdict`, `Field`, `New_Value`, `Reason`.

`Field` is the single column to change — one of `Task_Name`, `Target_Asset_ID`, `Instruction`, `Valid_Months`, `Frequency_Days`, `Suppress_If_Raining`, `Suppress_If_Temp_Below`, `Requires_Wind_Above`, `Estimated_Minutes`, `Retired` — or `NONE` where the finding needs a decision from you rather than a cell change. `Task_ID` is `NEW` for a job that does not exist yet.

`New_Value` is the complete new value: for `Instruction`, the whole rewritten instruction; for `Retired`, the withdrawal reason; for a weather column, a number or the word `BLANK` to clear it.

#### The workflow

1. Paste the block into cell **A4** of `Review_Decisions`, then **Data → Split text to columns → Separator: Semicolon**. The tab is already laid out, with tick-boxes waiting in column G, so the paste cannot disturb them.
2. Read down the `Reason` column and **tick column G** against each finding you accept. Leave the rest unticked. If you accept the finding but want different wording, put yours in the **Override** column — it wins over the reviewer's value.

   **Tick the `MISSING` rows too.** A row whose `Field` is `NONE` — a missing job, a collection that should be split — has no cell to change, so ticking it writes nothing to the task matrix. What it does is record the finding in `Review_Log`, and that is the *only* way the gap reaches the authoring step (§7f). Left unticked it is discarded when you next build a packet. Read the tick as "yes, that is a real gap", not "apply this change". The applier tells you at the end if you left any unticked.
3. **Apply decisions (dry run — no changes).** Read `Review_Log`. Nothing has been written.
4. **Apply decisions.** You get a confirmation naming how many cells will change and warning you if any blueprint would be left with nothing.

#### What it refuses

A staged change that breaks an authoring rule is refused with the reason, and nothing is written until every row has been staged — so a refusal on row forty cannot leave rows one to thirty-nine half-applied. It refuses:

- an instruction under 80 characters, or naming a chemical active or brand (§5);
- a semicolon in any free-text value;
- malformed `Valid_Months`, or a non-positive `Frequency_Days` or `Estimated_Minutes`;
- a `Target_Asset_ID` that is not a blueprint prefix or a declared collection — including a bare category prefix, which the publish gate would reject anyway;
- two ticked rows changing the same cell;
- any change to a row that is already retired, other than un-retiring it (`Field` `Retired`, `New_Value` `BLANK`).

It also warns without refusing: a cooldown that outlasts the gap between the task's own declared months (§9), a wind ceiling below 10 mph, a temperature floor on winter-only content, a cadence under three days, and a retarget to a collection with no members.

`Suppress_If_Raining` is written as a real logical value or the cell is cleared, so a row that goes through here cannot land in the left-aligned-text trap described in §2.

#### The loud changes

Two kinds of change alter *who* receives a task rather than what it says, and both are reported in full in `Review_Log` rather than as a one-line diff:

- **Retargeting.** Changing `Target_Asset_ID` silently changes the audience. The log names every blueprint that gains the task and every one that loses it.
- **Retiring.** The log names every blueprint that loses the task, and — after simulating the whole run together — every blueprint that would be left with **no live task at all**. This is the check no single row can make: twelve retirements can each look reasonable and between them leave an item showing a user an empty screen in every month of the year.

#### Afterwards

Applying stamps `E` and today's date into column M for every live task reaching the pass (§2). A task retired by the same run is not stamped, since there is nothing to review about a tombstone.

`Review_Log` is appended to and never cleared. It is the permanent record of every change the review programme has made, and the only place a *before* value survives. `Review_Decisions`, by contrast, is cleared each time a new packet is built — so anything you want to keep must be either applied, or written down somewhere else (§7f).

Building a new packet is blocked while `Review_Decisions` holds ticked rows that have not been through an apply run, so a pass cannot be abandoned half-decided by accident.

### 7f. Filling a gap the review found

#### Two prompts, two different CSVs

This is the thing to get straight before anything else, because both prompts end in a code block and they go to completely different places.

| | Review prompt | Authoring prompt |
|---|---|---|
| Asks | what is wrong with the tasks that exist | write the tasks that do not exist yet |
| Returns | a **decision block** — six columns, one row per finding | a **task block** — the standard eleven columns |
| Goes to | cell A4 of `Review_Decisions` | the first empty row of `Master_Task_Matrix` |

**Never paste a decision block into `Master_Task_Matrix`.** It is six columns of findings about existing rows, not task rows, and it would land as nonsense. The review prompt is told this explicitly, so it should not produce eleven-column rows at all — if it ever does, that is a bug in the prompt and worth telling me about.

#### Why both prompts ask about missing jobs

They are not doing the same work, and the overlap is smaller than it looks.

The **review** prompt *diagnoses*. It has the complete picture for the pass and an adversarial brief, so it is the right thing to answer "is anything obviously absent here?" — in one line of reasoning, cross-referenced to the empty months. Most passes turn up nothing, and knowing that is the point: without it you would run the authoring prompt speculatively on all 25 passes.

The **authoring** prompt *treats*. Writing a task means walking the year for the items concerned, diffing against what already exists and what was deliberately retired, choosing months and a cooldown that agree with each other, and writing an instruction carrying the action, the finish condition, the common mistake and a safety line. None of that fits in a review finding, and a reviewer asked to produce it would produce a stub.

So the reviewer writes one sentence and the author writes the row. The author does redo the year plan — deliberately. A review finding is a hypothesis, and inheriting it uncritically is how a review that was wrong about one row becomes a task that is wrong in the live data. The prompt is scoped to the items the gaps concern rather than the whole pass, so it is not walking sixteen years to write two tasks.

#### The walkthrough

1. **Build the packet**, choose **Review prompt**, copy, paste into a fresh conversation.
2. Read the findings. Paste the decision block into **cell A4 of `Review_Decisions`**, split by semicolon.
3. **Tick the changes you accept — and tick the `MISSING` rows too** (§7e). This is the step that decides whether the gaps survive.
4. **Apply decisions (dry run)**, read `Review_Log`, then **Apply decisions**. The alert will tell you if you left any findings unticked.
5. **Run the audit**, to confirm the changes landed.
6. **Build the packet again for the same pass**, and choose **Authoring prompt**. It now reflects the corrections, and carries the ticked gaps into its brief. The window tells you how many it found — if it says none, go back to step 3.
7. Paste into a **fresh** conversation. Read the year plan and the diff before the CSV.
8. Paste the eleven-column CSV into **`Master_Task_Matrix`**, per §4 steps 5–8. Leave columns L and M blank.
9. Run the audit, then publish the whole pass — corrections and new tasks — in one cycle.

The pass will now read **N task(s) unreviewed since** on the `Review_Passes` tab rather than **Complete**, because the new rows have not been reviewed by anyone. That is correct, and it is the reminder to give them an independent look in a later session.

#### What the authoring prompt brings with it

Worth knowing, because it is what makes step 6 worth doing rather than filling the slots by hand: the prompt arrives with the items, the collection membership with outside members asterisked, every live task *including its full instruction*, what has been retired and why, the starting Task ID and the target category. The gaps are lifted out of `Review_Log` with the applier's own "author it separately" note stripped off, so what reaches the brief is the reviewer's words.

**One trap.** The starting Task ID is computed from the highest number currently in the workbook. Generate for two passes in two conversations without importing the first batch in between and they will both start from the same number and collide. Import one batch before generating the next.

#### If you would rather defer it

The applier changes cells and never writes new tasks. A `MISSING` finding — or any finding whose `Field` is `NONE` — is recorded in `Review_Log` as **NOTED** and handed back to you, and that is where it stays.

**A NOTED finding that is neither filled nor written down disappears the next time you build a packet**, because `Review_Decisions` is cleared. The log keeps it, but a log is a record, not a to-do list. So if you are not filling it now, record it in `CHANGELOG.md` under known gaps and deferred work, where the earlier deferred lists already live. A gap that is written down is a decision; a gap that only exists in a log is an accident waiting to be repeated by the next review, which will find it again and report it again.

---

## 8. The review prompts

> **Recommended for both: Claude Opus 5, extended thinking on, high effort.** (Claude Fable 5, if it's available to you — these are the prompts in the workflow where reaching for the most capable model available is genuinely justified.)
>
> This is the deliberate adversarial pass, and the hardest reasoning in the whole workflow: noticing that a named pest doesn't actually affect a particular plant, or that advice is fine for nine members of a collection and harmful to the tenth. The default failure mode of a review is sycophantic approval — a model with room to think is markedly better at earning its disagreements.
>
> Two habits worth keeping regardless of model:
>
> - **Run it in a fresh conversation**, so nothing in the context primes it toward approval.
> - **Don't review content in the same conversation that generated it.** A model asked to critique its own output tends to defend it. If the task prompt wrote these rows, start somewhere clean — a different conversation at minimum, and ideally a different model.
>
> **Completeness matters more than size.** The old advice was to keep batches to about 50 rows. The real constraint is different: the reviewer needs *everything* that reaches the item group, however many rows that is, because an incomplete batch is what produced false findings before. If a pass is too large, split the pass — never its tasks.

### 8a. Editorial review prompt

**The prompt is no longer reproduced here. It lives in `reviewComposePacket_` in `Review.gs`,** and is emitted with the pass's data already slotted into it by **Garden Data → Editorial review → Build review packet** (§7b).

That move is deliberate. A prompt printed in a document and a prompt used by a script are two copies of the same thing, and the copy you paste around fresh data is the one that quietly goes stale. There is now one copy, and it cannot be used with mismatched data because it is assembled together with it.

To read it, either build a packet and look at the top of the `Review_Packet` tab, or open `reviewComposePacket_` in the Apps Script editor. To change it, change the function — and note that a change affects every future pass, so treat it with the care you would give a live prompt rather than a document.

For the record, what it asks the reviewer to check: horticultural accuracy (with pest and disease pairings called out); timing, including the cooldown-versus-own-months fault and February on the bleeding species; collection safety judged against the most awkward member, including members outside the pass; contradictions and duplicates; dangerous or irreversible advice, with grafted plants and cutting off next year's crop named explicitly; unmentioned hazards; chemical naming; novice clarity, including whether a beginner can tell if the task applies to them at all; and omissions, cross-referenced to the month coverage table and checked against the retired list. It requires every task to be listed including the passes, and ends with a `COULD NOT VERIFY` section.

**Why the last line of the prompt is there.** The default failure of a review prompt is sycophantic approval — hand a model rows of plausible-looking advice and it will tend to nod along. Requiring every row to be listed, including the passes, and explicitly licensing disagreement is what turns it from a rubber stamp into a genuine check. The `COULD NOT VERIFY` section serves the same purpose from the other direction: it gives the reviewer somewhere to put uncertainty other than a confident guess. If you ever edit the function, keep both.

### 8b. Interaction review prompt

Still assembled and pasted by hand — the unit of this pass is a garden rather than a declared review pass, so the packet builder does not apply.

```
Act as an expert UK horticulturist. You are reviewing how a set of individually
plausible gardening tasks behave WHEN THEY ARRIVE TOGETHER.

Do not review the tasks one at a time for correctness — that is done elsewhere.
Assume each task is broadly right in isolation. Your job is what happens when a
real person opens the app in one month and sees all of them at once.

THE GARDEN:
[paste the blueprint list: Suggested_Name | Default_Asset_ID_Prefix]

THE MONTH: [e.g. October]

EVERY LIVE TASK THAT COULD FIRE THIS MONTH FOR THIS GARDEN:
[paste rows: Task_ID | Target_Asset_ID | Task_Name | Instruction | Valid_Months |
 Frequency_Days | Estimated_Minutes]

CONTEXT:
- The app shows these tasks without any ordering. There is no dependency system.
  The only way one task can tell the user it must follow another is in its own
  instruction text.
- A task reappears after its Frequency_Days cooldown, so a low number means it
  recurs within the month.
- The user is a novice and will do what the cards say, in whatever order they
  appear.

ASSESS:

1. CONTRADICTIONS. Do any two tasks tell the user to do opposite things? (A real
   bug: an autumn bed clear-up saying to cut back herbaceous plants in October,
   while three other tasks correctly said to leave echinacea, penstemon and
   eryngium standing over winter.) Contradictions between a BED task and a PLANT
   task are the ones most easily missed, because they are authored separately.

2. ORDERING. Do any of these need doing in a particular sequence to work? (The
   lawn programme is the worked example: moss treatment, then scarify, then
   aerate, then overseed, then top dress, then feed. Done in the wrong order,
   several of them undo each other.) For each sequence you find, check whether
   every task in it actually SAYS where it sits. A sequence that is only correct
   if the user happens to guess the order is a defect.

3. MUTUAL EXCLUSION. Does any task rule out another within its stated window? (A
   real bug: a lawn weedkiller whose window overlapped both overseeding tasks,
   when the weedkiller must not be used within six months of sowing.) Check that
   the warning exists in BOTH rows, not just one.

4. DUPLICATION. Do two tasks amount to the same job reaching the user twice by
   different routes — typically one specific task and one collection task?

5. LOAD. Add up the Estimated_Minutes, allowing for anything that recurs within
   the month. Is this a plausible amount of gardening for one month? A month that
   demands two full days from a novice with a small garden will simply be ignored,
   which is worse than a month that asks for less.

6. THE AWKWARD MEMBERS. For each item in this garden, ask whether any task here is
   wrong for THAT specific item even though it is right for the others it reaches.

OUTPUT:

CONFLICTS — most serious first:

Tasks involved | Type | What goes wrong | Recommended resolution

Type is one of: CONTRADICTION, ORDERING, EXCLUSION, DUPLICATION, LOAD, WRONG-MEMBER

Recommended resolution should say WHICH row to change and WHAT sentence to add or
remove — not a general principle.

Then:

MONTH SUMMARY — total estimated time, the number of tasks, and your judgement of
whether this month is realistic for a novice.

Then:

COULD NOT VERIFY — anything you could not judge from the material given, including
any task whose interaction with something OUTSIDE this garden you suspect but
cannot check.
```

Findings from this pass are applied by hand. The decision block and the applier (§7e) are built around the editorial review's shape and the `Review_Decisions` tab is cleared when an editorial packet is built, so do not route interaction findings through it.

---

## 9. Notes on specific columns

### `Estimated_Minutes`

A realistic per-task time estimate for a novice, in whole minutes.

Since v2.0 this is a real database column with a constraint: it must be a positive whole number or empty. A zero or a stray letter is rejected at publish rather than silently ignored, so treat the audit's complaint about it as a genuine blocker rather than a nicety.

The scale in §5 is calibrated against the values already in the matrix — 5 minutes for a look, 10 to 15 for one plant, 20 to 30 for a bed or a mow, 45 to 60 for a whole-bed job, 90 to 150 for a lawn renovation step, 240 for treating every fence panel. Keep new content on that scale so the numbers stay comparable.

It **is** returned by the matching engine (`select_tasks`, and therefore by the `today` call the app makes), but is **not yet displayed** in the app. Surfacing it — a time badge on task cards, or a "quick jobs under 15 minutes" filter — is on the roadmap (`SPEC.md` §6). The interaction review (§7c) uses it now, which is the first thing that has.

### `Frequency_Days`

The cooldown before a completed task may be offered again. It is not a schedule — it does not make a task appear, it only stops it reappearing too soon.

The trap is that it can silently disagree with the instruction. A task whose text says "every week through the season" and whose `Frequency_Days` is 14 will offer itself half as often as its own advice says. §5 requires the cadence to be written out in words and reconciled against the number before the row is written.

Values below 3 mean the task can return almost every day of its season. That is right for a handful of jobs — watering a container in a heatwave, picking peas — and wrong for most. The audit flags them for review rather than as faults, because the script cannot tell which is which.

**The other trap is a cooldown longer than the task's own window.** A task declaring several months with a cooldown that outlasts them fires once and then sits out the rest, so every month after the first is decorative — visible in the data, never seen by a user. It has now been found twice: `TASK_0056`, `0059`, `0062` and `0067` in the tools pass, and `TASK_0079`, `0093`, `0399`, `0401`, `0405` and `0412` in the trees pass.

Two shapes to watch:

- **A run of consecutive months** — 6,7,8 with a cooldown of 365. Correct only if the job genuinely happens once and the months exist to widen the opportunity. Wrong wherever the instruction describes something repeated: inspecting, picking, raking, checking.
- **Two separate windows** — 3 and 10 with a cooldown of 180. Measure the gap in both directions and use the smaller. March to October is seven months; October to March is five. The 180-day cooldown clears in late March, so the March window is blocked every year and the task silently becomes annual. 120 works.

**This is mechanically detectable**, and since v2.7 the review applier (§7e) checks it: change either the months or the cooldown through a decision row and the log tells you if the cooldown now outlasts the smallest gap between the declared months, measured round the year. It is a warning rather than a refusal, because a genuinely once-a-year job with a wide window trips it legitimately. The whole-matrix version — sweeping every existing row — remains a human checklist item (§6) and would still make a good addition to `Audit.gs` at WARNING severity.

### `Suppress_If_Temp_Below` — a quiet way to delete a task

It **hides** the task when the temperature is below the value. That is useful for jobs that need warmth to work, such as a spring feed.

It is dangerous on winter content. A task valid in December, January and February that carries a temperature floor of 5°C will be hidden through most of the period it was written for, and nothing anywhere reports that it never appeared. Before setting it, ask whether being hidden in the cold is genuinely the behaviour you want. The audit now flags any task whose months all fall between November and March and which carries a value here, and the review applier warns before writing one.

### `Requires_Wind_Above` — **the name is now misleading**

**The behaviour of this column inverted in v2.0. Read this before using it.**

- **In v1** it meant *"show this task only when wind is above N mph"* — i.e. for emergency wind-prep jobs. That behaviour was a bug, recorded in the v1.x limitations.
- **In v2** it means *"hide this task when wind is above N mph"*. It publishes to the database column `suppress_if_wind_above`, and the matching engine drops the task when the current wind exceeds the value.

The workbook header still reads `Requires_Wind_Above` — a legacy label kept so the publish pipeline's column matching keeps working. Its name now describes the opposite of what it does, which is a trap for anyone authoring from the header alone.

**How to use it now:** put a threshold on tasks that are unsafe or ineffective in wind — spraying, liquid feeding, spreading granular fertiliser, anything at height. Something in the region of 15–25 mph is a sensible starting point. Leave it blank when wind is irrelevant, which is most tasks. A value below 10 would hide the task almost permanently, and the audit flags it.

The mapping to `suppress_if_wind_above` is confirmed in `Publish.gs` §4 of the push.

**Rows written under v1 semantics may still be in the matrix, and they will not look broken.** `DESIGN_V2.md` §6 listed this inversion as an expected behaviour change to be verified rather than fixed; the tree pass found one row where that verification never happened. `TASK_0523` "Check for Storm Damage" carried `Requires_Wind_Above 30` with an instruction beginning "After strong winds…", which under v1 meant *show this in a gale* and under v2 meant *hide it in one* — leaving a twelve-month task on a three-day cooldown that merely went quiet when it was most relevant. It was retired rather than repaired.

The signature to look for is an instruction whose text implies the wind is the *reason* for the task rather than an obstacle to it. Any surviving row of that shape is inverted. It is worth grepping the whole matrix for a non-blank value in this column and reading each instruction against it, because nothing in the audit or the publish gate can tell the difference — both see a valid integer.

**There is no way to make a task appear because of the weather**, and the two v1 rows that tried are the evidence for why one might be wanted. A `Reveal_If_Wind_Above` column alongside the existing suppression — deliberately restoring the v1 behaviour rather than inheriting it by accident — would make storm checks, wind-rock checks and "bring the pots in" viable. It is a schema change plus a `select_tasks` change, and is recorded on the roadmap in `SPEC.md` §6 rather than here.

### `Groups` — a warning about silent failure

A task targeting a collection tag that no blueprint carries will match nothing, with no error at runtime. If a collection-level task never appears, check the spelling of the tag in all three places — the `Groups` cell, the `Collections` tab, and the task's `Target_Asset_ID` — before assuming the matcher is broken. The audit catches all three cases; the app does not.

### `Reviewed` — inert by design

Column M is read by nothing except the audit's review-state summary and the review applier, which writes it. `Publish.gs` reads columns 0–11 by fixed index and never looks further, so whatever is in column M cannot reach the database or affect a user. That is deliberate: the review programme needed a bookmark, and the safest bookmark is one the pipeline cannot see.

### `Review_Pass` — bookkeeping, never behaviour

Column **G** of `Item_Dictionary`, and inert for exactly the same reason as `Reviewed`: `Publish.gs` reads that tab by fixed index 0–5 and stops. Nothing here reaches the database.

The distinction worth holding on to is the same one that separates `Groups` from `Browse_Group`, one step further out. `Groups` decides what an item **receives**. `Browse_Group` decides where it **appears**. `Review_Pass` decides only whether anyone ever **asks what it is missing**. All three fail quietly when left blank, and each failure is one degree further from the user: no group means an empty screen, no browse group means a harder-to-find pill, no review pass means a plant nobody has ever checked the advice for.

### `Browse_Group` and `Botanical_Name` — display, never behaviour

Columns **E** and **F** of `Item_Dictionary`. Both are published to the database and both are read by the app, so unlike `Reviewed` they are not inert — but neither touches `select_tasks`.

The failure mode to watch is quiet: a heading spelled slightly wrong blocks the publish, which is loud and fine; but a heading left blank does not, and the item simply drifts to the bottom of the picker under "Other" where it is harder to find. The dry run lists those, in the same spirit as the coverage report — a warning that only helps if you read it.

---

## 10. Publishing to the app

Authoring changes nothing that flows to users on its own. Content reaches the app only when you **publish** the workbook to the live database. This is deliberate: bulk editing stays where it is pleasant (the sheet), and the database stays where integrity is enforced.

### One-time setup

The publish tool talks to Supabase using a **service-role key**, which can read and write the whole database. It must never live in a code file or the repository, so it is stored in Apps Script's Script Properties, with the workbook kept unshared.

1. Supabase dashboard → **Project Settings → API**. Copy the **Project URL** and reveal-and-copy the **`service_role`** secret.
2. Apps Script editor (**Extensions → Apps Script**) → **Project Settings** (gear) → **Script properties** → add two:
   - `SUPABASE_URL` = the Project URL.
   - `SUPABASE_SERVICE_ROLE_KEY` = the service_role secret.

There is nothing to set up in the sheet; the `Publish_Report` tab is created on first use.

### The three movements of a publish

Choosing **Garden Data → Publish to app** runs, in order:

1. **The gate.** It runs the full audit and **refuses to publish on any ERROR.** It then adds its own publish-specific blocks: every live (non-retired) task must resolve to a real blueprint or a *declared* collection — a bare category prefix is not a valid target and will block; every `GROUP_*` tag carried by a blueprint must be declared on the `Collections` tab; every task's category must be one of the seven; every heading named in a `Browse_Group` cell must be declared on the `Browse_Groups` tab; and every declared heading must carry a whole-number `Sort_Order`. Finally it computes two **warning-only** reports that never block: the **coverage report** — blueprints that no live task reaches (some items may legitimately await content) — and the list of blueprints with **no browse group**, which will appear under "Other" in the picker.
2. **The push.** It reads the live catalogue first (to preserve tombstone dates and detect rows you have removed), then upserts categories, browse groups, blueprints, collections and tasks by their natural key (`legacy_code` / `code` / `name`), and reconciles the three membership tables (`blueprint_category`, `collection_member`, `task_target`) to mirror the workbook exactly. **Nothing curated is deleted.** A blueprint or task removed from the workbook is *retired* (a tombstone), not erased; collections and browse groups are upsert-only and are never removed at all.
3. **The report.** A `Publish_Report` tab records what was pushed, the live row counts read back, the coverage report, the blueprints with no browse group, the live-garden checks below, and the retirement roll-call.

Nothing on the `Review_Passes`, `Review_Packet`, `Review_Decisions` or `Review_Log` tabs takes any part in this, and nothing in `Item_Dictionary` column G or `Master_Task_Matrix` column M does either.

### What the live-garden checks tell you

Added in v2.5, in the post-publish report only. They are the two questions that cannot be answered from the workbook, because they depend on what people actually have in their gardens:

- **Retired but still owned.** A blueprint you have withdrawn from the catalogue that is still present in at least one garden. Removing a blueprint from `Item_Dictionary` tombstones it on publish, but anyone who already had one keeps their item. Nothing else reports that you have just done this. The fix is to restore the row and publish again, or to accept that those items are now orphaned.
- **Owned but receives nothing.** A blueprint that somebody has in their garden and that no live task reaches, so it shows nothing to do in any month. This is the coverage report (§2a) narrowed to reality — the difference between "nobody has added this yet", which can wait, and "somebody is looking at an empty screen", which cannot. **Treat anything appearing here as more urgent than the general coverage list.**

Both are **warnings and never block a publish**, and both are aggregated to blueprint level: the report gives a name, an item count and a garden count, and never a garden name, a user, or anyone's own reference for an item. That matters because the publish pipeline runs with a key that bypasses Row Level Security and can therefore see every garden — the workbook must not become a place where someone else's garden is listed.

They run after the push rather than before it, so the dry run keeps its promise of touching the database not at all. The trade-off is that you learn you have orphaned an item just after publishing rather than just before.

### The dry run

**Garden Data → Check before publish (no changes)** runs the gate and writes the report **without touching the database.** Run it before a real publish, and after any large authoring session, to see what would block and what coverage gaps exist. It is always safe.

### If a publish fails

The report's **"Where the push stopped"** section is the first thing to read. It gives the step the push was on, how many rows were outstanding at that moment, and which steps had already completed. That tells you immediately whether the failure was in reading the workbook, upserting the catalogue, or reconciling one of the three membership tables.

Because the reconcilers delete before they insert, a push that fails during a membership step can leave rows removed and their replacements unwritten. Nothing curated is ever lost — blueprints and tasks are only ever retired, never deleted — but a task can be left with no target, which means it silently stops appearing. **The fix is always to complete a successful publish**, which rebuilds the desired set from scratch and repairs anything left half-done.

If a failure resists a straight re-run, the shape of the outstanding rows is the usual culprit. PostgREST rejects a batch whose objects do not all carry an identical set of fields. The immediate workaround is to split the work across two publishes so that each carries only one shape: fill the `Retired` cell on the tasks carrying one kind of target, publish, clear those cells, and publish again. `Publish.gs` now groups rows by shape before sending, so this should not recur — but the technique is worth knowing.

### Habits worth keeping

- **Publish after authoring, or the app won't see your edits.** A silent gap between the workbook and the app is the one failure this workflow invites; the post-publish report and the dry run are the guard against it.
- **Read the coverage report, don't just skim past it.** It is the only thing standing between a new blueprint and permanent silence (§2a).
- **Read the live-garden section too, and treat it as the louder one.** A blueprint in the coverage list might simply be waiting for content. A blueprint in "Owned but receives nothing" is being seen by a real person right now.
- **Fix ERRORs, weigh WARNINGs, judge REVIEWs — then publish.** The gate enforces the ERRORs; the rest are yours to decide.
- **A retired task is withdrawn by filling its `Retired` cell, then publishing** — never by deleting its row.
- **Publish a review pass once, not twice.** Apply the corrections, author the new tasks the review asked for (§7f), then publish the lot in one cycle with one audit run and one changelog entry.
- **Re-running a publish is safe.** Every write is an upsert or an idempotent reconcile, so a second run with no authoring changes reports zero membership churn.
- **Nothing in column M, or in `Item_Dictionary` column G, affects a publish.** Marking rows reviewed is free and can be done at any time, including mid-session.
