# Database Content Workflow

How to add new **items** (to `Item_Dictionary`) and new **tasks** (to `Master_Task_Matrix`) in the Google Sheets authoring workbook for *What Gardening Today?*

This covers the manual authoring process only — generating content with an LLM, importing it cleanly into the sheet, and verifying it. It does not cover the app's runtime behaviour; see `SPEC.md` for the schema and matching rules this document depends on.

**As of v2.0, the workbook is an authoring workbench, not a live database.** Content is written here exactly as before, but it reaches the app only when it is *published* to the hosted database (Supabase) via an explicit **Garden Data → Publish to app** step. Authoring is unchanged; publishing is new. See §10.

_Current as of v2.1 (2026-07-23)._

> **If you read only one thing, read this.** The v2.0 migration **abolished bare-category targeting.** A task may no longer target `LAWN` or `PLANT` and sweep up everything beneath it — such a target now *blocks publishing*. Every task must target either one specific blueprint or a **declared collection**. The consequence for authoring is that **a new blueprint inherits nothing.** Add a plant and write no tasks for it, and it will silently receive zero tasks forever — there is no fallback tier to catch it. See §2 and §2a.

---

## 1. Where the data lives

The authoring tabs in the Google Sheet:

- **`Item_Dictionary`** — the catalogue of item *blueprints* shown in the "Add to My Garden" picker. Four columns: `Category`, `Suggested_Name`, `Default_Asset_ID_Prefix`, `Groups`.
- **`Master_Task_Matrix`** — the care tasks matched to those items. Twelve columns: `Task_ID`, `Target_Asset_ID`, `Task_Name`, `Category`, `Instruction`, `Valid_Months`, `Frequency_Days`, `Suppress_If_Raining`, `Suppress_If_Temp_Below`, `Requires_Wind_Above`, `Estimated_Minutes`, and `Retired` (column L; see §2). The twelfth column was added in v2.0 to mark tombstoned tasks.
- **`Collections`** — added in v2.0. Two columns, `Code` and `Name`, declaring every `GROUP_*` collection that exists and giving it a human display name. Membership still lives in the `Groups` column of `Item_Dictionary`; this tab declares the collections that column may reference. See §2.
- **`Reference_Lists`** — maps the seven display categories to their top-level prefixes; the audit's source of truth for valid categories and prefixes.

**No longer live:** the `User_Profile` and `Task_Log` tabs. A user's garden items and their completion history now live in Postgres (`garden_item` and `task_completion`) and are written by the app, not the workbook. Any such tabs still present in the workbook are frozen historical copies — do not edit them expecting an effect, and treat audit findings about them as archaeology rather than live faults.

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
| `GROUP_GRASS_LAWN` | Ryegrass, Fine Fescue, Bentgrass, Mixed Utility, Buffalo — conventional mown turf |
| `GROUP_CULTIVATED_BED` | Herbaceous Border, Raised Bed, Annual Bedding, Mixed Shrub Border, Cutting Garden — beds of rich, worked garden soil |
| `GROUP_ALL_BEDS` | Every bed type, including those outside `GROUP_CULTIVATED_BED` (e.g. Woodland Shade) — for jobs like weeding that suit any bed |
| `GROUP_SHRUB_GENERIC` | Shrubs for which generic shrub care is safe |
| `GROUP_TREE_GENERIC` | Trees for which generic tree care is safe |
| `GROUP_HERBS` | Culinary and ornamental herbs |
| `GROUP_HAND_TOOLS` | Hand tools only — deliberately excludes powered tools, so tool-cleaning advice never reaches a chainsaw |

The last five were created during the v2.0 category-tier review, to re-home tasks that previously targeted a bare category. They are the sanctioned replacement for "applies to the whole category" — the difference being that their membership is an explicit, inspectable list rather than a spelling coincidence.

A `GROUP_HERBACEOUS_PERENNIAL` group was considered and rejected — see CHANGELOG 1.3. The lesson is worth keeping: **a collection must describe what an item *is*, not what content it happens to be missing.** If the only thing the members have in common is "no specific task written yet", it is not a collection.

### Task targeting

`Target_Asset_ID` must be **exactly one** of:

1. A **full item** prefix that exists in `Item_Dictionary` — e.g. `VEG_FRUIT_RASPBERRY`. Applies to that item type only.
2. A **collection tag** declared on the `Collections` tab and carried by at least one blueprint — e.g. `GROUP_SOFT_FRUIT`. Applies to every item carrying that tag.

There is no third option. In particular:

- A **bare category prefix** (`LAWN`, `PLANT`, `SHRUB`, …) is **no longer a valid target** and will block the publish. This tier was abolished in v2.0; its safe tasks were re-homed to the whole-category collections listed above, and its unsafe ones retired.
- A **partial prefix** such as `VEG_FRUIT` or `VEG_BRASSICA` has never been valid — it looks plausible and matches nothing. Use a collection.

### The collection safety rule

*(This is the old category-tier safety rule. The tier is gone; the hazard it guarded against is not.)*

A task targeting a collection must be safe for **every** member of that collection, with no exceptions.

This has bitten us repeatedly. "Cut Back Perennials" (cut to 10cm of the ground) targeted the whole `PLANT` category, so it was being issued for Rose, Clematis, Bamboo and Ivy — all woody. Generic shrub feeding and mulching would be actively harmful to Lavender, which needs poor, dry soil. And "End of Season Tool Clean" — rust-and-linseed care — was reaching a chainsaw until `GROUP_HAND_TOOLS` was created.

What changed in v2 is not the rule but the *visibility*: a collection's membership is a list you can read, so the blast radius of a task is always knowable before you write it. Before adding a task to a collection, read that collection's member list and check the advice against the most awkward member, not the typical one.

If advice is right for most members but wrong for some, it belongs on a narrower collection or on the specific item.

### The semicolon rule

Both tables are imported as **semicolon-separated** text.

The reason: `Valid_Months` legitimately contains commas (e.g. `3,4,5`), and `Category` and `Groups` can too. If the file were comma-separated, those lists would split across separate columns on import and shove every later column out of place — a silent corruption. Using semicolons as the column separator keeps the comma-lists safely inside one cell.

Consequence: **no free-text field may contain a semicolon.** `Task_Name` and `Instruction` must use only commas and full stops.

### The rain column is a true/false value, not text

`Suppress_If_Raining` is published to a real boolean column. After import, a `TRUE` in that cell should sit **right-aligned** (Sheets treats it as a logical value). If it lands **left-aligned** as the text "TRUE", it is not a boolean. Leave the cell **blank** when the task is unaffected by rain — don't type `FALSE`.

In v1 a text "TRUE" silently did nothing. In v2 the database column is genuinely typed, so the failure surfaces at publish rather than lurking — but the audit still checks it at authoring time, which is the cheaper place to catch it.

### The `Collections` tab declares every collection

A collection is a named set of blueprints that a task can target. The `Groups` column of `Item_Dictionary` records *which blueprints belong to* a collection; the `Collections` tab records *that the collection exists* and gives it a display name.

- Two columns: `Code` (e.g. `GROUP_SOFT_FRUIT`) and `Name` (e.g. `Soft fruit`).
- **Every `GROUP_*` tag you use** — in a `Groups` cell or as a task target — **must be declared here.** Publishing needs the declaration so it can create the collection with a name and reference it by key; an undeclared tag is a publish-blocking error, not a silent miss.
- A collection may be declared before any blueprint carries it (the audit flags this as REVIEW, not an error) — useful when setting up a group ahead of the tasks that will target it.
- Collections are never deleted by publishing. Removing a code from this tab does not remove the collection from the database; it simply stops being maintained. Empty it by clearing its members if you want it to reach nothing.

### The `Retired` column tombstones a task

Column **L** of `Master_Task_Matrix`, headed `Retired`. Any non-blank value marks the task as retired: put a short reason in the cell (it stays as editorial context). This replaces the old procedure of *deleting* a task's row and listing its ID in an `Audit.gs` constant.

- A retired task **keeps its row** — name, instruction and all — but is published as a tombstone: `retired_at` is set in the database and it is given **no targets**, so it never appears in the app.
- Retirement preserves history. Completions recorded against the task (now in `task_completion` in Postgres) keep a valid reference, and the retired ID can never be reissued.
- A retired row still needs a valid `Task_ID`, `Valid_Months`, `Frequency_Days` and `Category`, because the database stores the tombstone. A pure tombstone for a task that never had a real row (recovered from an orphaned log entry) can use nominal values: `Valid_Months` `1`, `Frequency_Days` `365`. Its target may be left blank.
- The old `RETIRED_TASK_IDS` constant in `Audit.gs` is **gone.** Retirement is now a property of the data, exactly here. To withdraw a task, fill its `Retired` cell and publish — do not delete the row.

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

---

## 4. Workflow B — adding tasks to `Master_Task_Matrix`

1. **Find the next Task ID.** Put this formula in any empty cell. It reads the highest existing number and gives you the next one to start from:

   ```
   =IFERROR("TASK_"&TEXT(MAX(ARRAYFORMULA(IFERROR(VALUE(REGEXEXTRACT(Master_Task_Matrix!A2:A,"\d+")),0)))+1,"0000"),"TASK_0001")
   ```

2. Run the **Task prompt** (§5), giving it: your item names + exact prefixes (or collection tags), the starting Task ID from step 1, and the target category.
3. Copy the generated block.
4. On the `Master_Task_Matrix` tab, click the first empty cell in **column A** below your last row, and paste.
5. Select what you pasted, then **Data → Split text to columns → Separator: Semicolon**.
6. Delete the header row the prompt included.
7. Run the verification checklist in §6.

**Optional safety net:** if you'd rather not paste straight into the live table, do steps 4–6 on a scratch tab first, eyeball the result, then copy the clean block into the real table.

---

## 5. The prompts

Each prompt below carries a recommended model and thinking effort. They differ more than you might expect: one is bounded formatting work, the other produces advice a novice will follow literally. Spend the reasoning where the mistakes are expensive.

### Item prompt (`Item_Dictionary`)

> **Recommended: Claude Sonnet 5, extended thinking on, low-to-medium effort.**
>
> This is bounded generation against a strict format. The likely failures — a stray semicolon, a mis-spelled category, an invented top-level prefix — are mechanical, and the audit catches all of them before they can do harm. Sonnet is quick and entirely sufficient.
>
> Step up to **Opus 4.8 at medium** if you're seeding an unfamiliar category from scratch, or if you're leaning on it to assign collections. Deciding whether generic shrub care is genuinely safe for a particular shrub is a horticultural judgement, not a formatting one, and it's the part of this prompt that can quietly cause harm downstream.

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
2. Exactly four columns, exact headers:
Category;Suggested_Name;Default_Asset_ID_Prefix;Groups
3. Use a SEMICOLON (;) as the column separator.

FIELD RULES:
- Category: one or more of the 7 above. If an item genuinely belongs under two tiles (e.g. a Rose is both a flower and a shrub), list both, comma-separated inside the one field (e.g. "Plants & flowers, Trees & shrubs"). Never create two rows for the same plant.
- Suggested_Name: clean, human-readable, NO semicolons (e.g. Rose, Lavender, Shed, Tomato, Hand Trowel).
- Default_Asset_ID_Prefix: UPPERCASE, no spaces, segments joined by single underscores. The FIRST segment must be one of: LAWN, BED, TREE, SHRUB, PLANT, VEG, HERB, STRUCT, TOOL. Any number of further segments is allowed (e.g. PLANT_ROSE, LAWN_MIXED_UTILITY, VEG_FRUIT_RASPBERRY). Never invent a new top-level prefix. Every prefix must be unique. Never begin a prefix with GROUP_ — that is reserved.
- Choose the prefix by what care the item actually needs, not by which tile it displays under. Woody plants (roses, lavender, hydrangea) take SHRUB_*; herbaceous plants take PLANT_*.
- Groups: assign the item to every EXISTING group tag I listed above that genuinely applies. This matters: an item in no group, with no tasks written specifically for it, will receive NO care tasks at all — there is no category-level fallback. Comma-separate multiple tags inside the one field. Do not invent speculative new groups; if an item fits none of my existing tags, leave it blank and say so in a note AFTER the code block so I can write specific tasks for it.

Generate the CSV now.
```

### Task prompt (`Master_Task_Matrix`)

> **Recommended: Claude Opus 4.8, extended thinking on, high effort.**
>
> Don't economise here — this is the one prompt whose mistakes reach a real garden. The output is advice a novice follows literally and has no knowledge to second-guess, and a collection-level task reaches every member of that collection at once.
>
> The failure that matters isn't a malformed row; the audit and the publish gate catch those. It's fluent, plausible-sounding advice that happens to be wrong for one awkward member of a collection, or right for the plant but wrong for the month. Nothing mechanical will ever catch that, so it's worth the deeper reasoning at the point of authoring rather than hoping the editorial review picks it up later.

```
Act as an expert UK horticulturist and database engineer. I am expanding the `Master_Task_Matrix` table for my gardening app. Generate a CSV dataset of care tasks to APPEND to that table. For each item I list, generate 2–4 highly specific seasonal or maintenance tasks.

TARGET ITEMS (Name + exact prefix, or collection tag):
[e.g.
Bamboo (PLANT_BAMBOO)
Rhododendron (PLANT_RHODODENDRON)
Ivy (PLANT_IVY)]

STARTING TASK ID: [e.g. TASK_0544]
TARGET CATEGORY (exact casing): [e.g. Plants & flowers]

OUTPUT RULES:
1. Output ONLY raw CSV text inside a single code block. No text before or after.
2. Exactly 11 columns, exact headers, in this order:
Task_ID;Target_Asset_ID;Task_Name;Category;Instruction;Valid_Months;Frequency_Days;Suppress_If_Raining;Suppress_If_Temp_Below;Requires_Wind_Above;Estimated_Minutes
3. Use a SEMICOLON (;) as the column separator. Do NOT use a semicolon anywhere else — not in Task_Name, not in Instruction.

FIELD RULES:
- Task_ID: sequential from STARTING TASK ID, no gaps, 4-digit zero-padded (TASK_0544, TASK_0545 …).
- Target_Asset_ID: MUST exactly match one of the item prefixes or collection tags I provided above. Never invent prefixes. Never use a partial prefix such as VEG_FRUIT. Never use a bare category prefix (LAWN, BED, TREE, SHRUB, PLANT, VEG, HERB, STRUCT, TOOL) — bare category targets are INVALID in this system and are rejected on import.
- Task_Name: short title, no semicolons (e.g. Cut Back Old Canes).
- Category: exactly the TARGET CATEGORY above. This is display metadata only — it labels the card in the app and plays no part in who receives the task.
- Instruction: novice-friendly UK advice, max 2 sentences. Commas fine, NO semicolons.
- Valid_Months: comma-separated integers 1–12, ascending, no spaces (e.g. 3,4,5). This comma list sits inside ONE semicolon field.
- Frequency_Days: positive integer cooldown (7 weekly, 14 fortnightly, 365 annual). Never blank, never zero.
- Suppress_If_Raining: the word TRUE only if the task shouldn't be done in rain (watering, liquid feed, spraying). Otherwise leave blank.
- Suppress_If_Temp_Below: integer °C if the task needs warmth (e.g. 5). Otherwise blank.
- Requires_Wind_Above: despite its name, this HIDES the task when wind is above the given speed in mph. Use it for jobs that are unsafe or ineffective in wind — spraying, liquid feeding, applying granular fertiliser, working at height (e.g. 15 or 20). Leave blank if wind does not matter.
- Estimated_Minutes: whole minutes a novice would realistically spend on one occurrence (e.g. 10, 30, 90). Never blank, never zero.

CRITICAL — COLLECTION-LEVEL TASKS: if any Target_Asset_ID is a collection tag (GROUP_*), the advice MUST be safe for EVERY member of that collection without exception. I will tell you the members if you ask. Do not write collection-level tasks that assume a plant is herbaceous, or that assume it wants rich soil or feeding. If the advice is right for most members but wrong for some, tell me — it needs a narrower collection or a specific item instead.

Generate the CSV now.
```

---

## 6. Verification checklist (after importing tasks)

- Columns line up: the eleven authored columns, headers in the right order, nothing shifted. (The twelfth column, `Retired`, is filled by hand only when tombstoning a task, and the semicolon import never touches it.)
- `Retired` is blank for every ordinary new task; it carries a value only on tombstones.
- `Valid_Months` sits as a single cell like `3,4,5` — **not** spread across several columns.
- `Task_ID` values continue the sequence with no gaps or duplicates.
- Every `Target_Asset_ID` is either a full item prefix that exists in `Item_Dictionary`, or a `GROUP_*` tag that is declared on `Collections` **and** carried by at least one blueprint — with no `_0001`-style suffix, no partial prefixes, and **no bare category prefixes**.
- Any collection-level task is genuinely safe for every member of that collection (check the member list, not your memory of it).
- `Suppress_If_Raining` TRUE cells are right-aligned (real boolean), not left-aligned text.
- `Requires_Wind_Above`, where used, is on a task that should be **hidden** in wind — not one that should appear because of it.
- `Frequency_Days` and `Estimated_Minutes` are whole numbers of 1 or more, never blank and never zero.
- No stray semicolons inside `Task_Name` or `Instruction`.

### After importing items

- `Category` cells contain only the seven allowed values (one or more, comma-separated).
- No plant appears twice under different prefixes.
- Any `GROUP_*` tag used is one you intended, spelled exactly as it appears elsewhere in the column, and declared on the `Collections` tab.
- Every new item either belongs to a collection or has tasks queued for it (§2a).

---

## 7. Quality assurance

This data fails **silently**. A task pointing at a target that doesn't exist doesn't throw an error — it just never appears. An item with no tasks doesn't complain — it simply shows the user nothing. Every significant bug found in this project so far has been of that kind, and each one sat undetected for weeks. QA is therefore not optional polish; it is the only thing standing between a typo and a plant that quietly never gets cared for.

Since v2.0 some of this is caught earlier and harder: the database rejects malformed rows at write time, and the publish gate refuses to run on any ERROR. But the gate cannot tell you that a task is *missing*, or that advice is *wrong* — so both halves below still matter.

There are two halves to it, and they catch entirely different things.

### 7a. The mechanical audit — automated, run often

`Audit.gs` in the Apps Script project adds a **Garden Data → Run Audit** menu to the spreadsheet. It reads every tab, checks them against the rules in this document, and writes its findings to an `Audit_Report` tab. It never modifies data.

**Run it after every content import and after every schema change.** It takes seconds.

It checks for:

- **Targets that match nothing** — a `Target_Asset_ID` that is neither a prefix in `Item_Dictionary` nor a group tag carried by a blueprint. This is the single highest-value check, and would have caught the orphaned raspberry, fruit-netting and brassica tasks the day they were written.
- **Items that receive no tasks** — no specific tasks and no collection tasks. Since v2.0 there is no category-tier fallback to rescue them, so this check matters more than it used to (§2a).
- **Duplicate keys** — repeated `Task_ID` or `Asset_ID`. (Note: `TASK_0262` is a known outstanding duplicate, used for both a Thalictrum and a Tiarella division task. Neither is in the live garden, so there is no runtime effect, but it should be renumbered before it causes confusion at scale.)
- **Duplicate blueprints** — the same plant catalogued twice under different prefixes. The name check is deliberately loose, so "Rose" and "Rose Shrub" are flagged as a likely pair.
- **Collection tags that do nothing** — carried by blueprints but targeted by no task.
- **Schema hygiene** — invalid categories, unknown top-level prefixes, `GROUP_` misused as an asset prefix, `_NNNN` suffixes in a task target, malformed `Valid_Months`, missing `Frequency_Days` or `Estimated_Minutes`, semicolons in free text, and `Suppress_If_Raining` sitting as the *text* "TRUE" rather than a real boolean.

The `Reference_Lists` tab is the audit's source of truth for the seven categories and nine prefixes. Add a prefix there and the audit accepts it immediately — which is that tab's real job, and the reason to keep it.

**Checks that have become historical.** The audit's "garden items with no blueprint" and "orphaned log entries" checks read the frozen `User_Profile` and `Task_Log` tabs. Live garden items and completions now live in Postgres, where foreign keys make both conditions impossible. Findings there describe the old workbook, not the running app — read them as archaeology.

**v2.0 changes to the audit.** It reads the `Retired` column and exempts tombstoned tasks from the target and coverage checks (a retired task is *meant* to reach nothing), while still requiring them to carry a valid ID, months, frequency and category, because the database stores them. It flags any `GROUP_*` tag used but not declared on `Collections`. And the `RETIRED_TASK_IDS` constant is gone: because retired tasks are now real rows, reissuing an ID is caught by the ordinary duplicate-key check.

Findings come in three severities: **ERROR** (silently broken now), **WARNING** (probably not intended), and **REVIEW** (the script cannot judge; a human should look).

### 7b. The editorial review — human-judged, run occasionally

The audit cannot tell you that scarlet lily beetle does not affect lily of the valley. No script can. Horticultural correctness needs a subject-matter pass.

**When to run it:** after any large content injection into a category, whenever a new collection-level task is added (they are the highest-risk kind), and otherwise roughly annually, working through one category at a time.

**How:** paste a batch of tasks — around 50 rows, quality drops off past that — into the review prompt in §8. It returns a findings table, not corrected data. **Apply nothing automatically.** The whole point of the review is that a human decides; an LLM confidently "correcting" curated horticultural data is precisely the risk being managed here.

---

## 8. The editorial review prompt

> **Recommended: Claude Opus 4.8, extended thinking on, high effort.** (Claude Fable 5, if it's available to you — this is the one prompt in the workflow where reaching for the most capable model available is genuinely justified.)
>
> This is the deliberate adversarial pass, and the hardest reasoning in the whole workflow: noticing that a named pest doesn't actually affect a particular plant, or that advice is fine for nine members of a collection and harmful to the tenth. As the note below the prompt says, the default failure mode of a review is sycophantic approval — a model with room to think is markedly better at earning its disagreements.
>
> Two habits worth keeping regardless of model:
>
> - **Run it in a fresh conversation**, so nothing in the context primes it toward approval.
> - **Don't review content in the same conversation that generated it.** A model asked to critique its own output tends to defend it. If the Task prompt wrote these rows, start somewhere clean — a different conversation at minimum, and ideally a different model.
>
> A more capable model does not rescue an oversized batch. Keep to roughly 50 rows whatever you're running.

```
Act as an expert UK horticulturist performing a quality review of an existing
gardening app's task database. You are REVIEWING, not authoring. Do not rewrite
the data — report what you find and let me decide.

Below is a batch of tasks from `Master_Task_Matrix`. Each row is a piece of
gardening advice shown to a NOVICE UK gardener, who will follow it literally and
has no knowledge to catch a mistake.

TASKS UNDER REVIEW:
[paste rows: Task_ID | Target_Asset_ID | Task_Name | Instruction | Valid_Months |
 Frequency_Days]

COLLECTION MEMBERSHIP (for any GROUP_* target above):
[paste each collection tag and the full list of items in it]

CONTEXT — how targeting works:
- A GROUP_* tag means the task is shown for EVERY item declared a member of that
  collection, without exception.
- Anything else targets one specific item type.
- There is NO category-level targeting in this system. If you see a bare category
  prefix (LAWN, PLANT, SHRUB, VEG, TREE, BED, HERB, STRUCT, TOOL) as a target,
  flag it — it is invalid data and will be rejected.

CHECK EACH TASK FOR:

1. HORTICULTURAL ACCURACY. Is the advice correct for UK conditions? Pay particular
   attention to pest and disease pairings — is this pest actually a problem for this
   plant? (A real bug we found: a scarlet lily beetle task was being applied to lily
   of the valley, which the pest does not affect.)

2. TIMING. Are Valid_Months right for the UK? Would following this in the stated
   month damage the plant or waste the effort? Is Frequency_Days plausible for the
   real cadence of the job?

3. COLLECTION SAFETY. If a task targets a GROUP_* collection, is the advice safe for
   EVERY member listed above? (A real bug we found: "cut back to within 10cm of the
   ground" reached roses, clematis, bamboo and ivy — all woody. Another: rust-and-
   linseed tool care reaching a chainsaw.) Judge against the most awkward member of
   the collection, not the typical one. Flag any collection-level task that is right
   for most members but harmful to some.

4. CONTRADICTIONS AND DUPLICATES. Do any two tasks in this batch give conflicting
   advice, or tell the user to do substantially the same job twice?

5. DANGEROUS OR IRREVERSIBLE ADVICE. Anything that could kill the plant, injure the
   person, or cannot be undone. Note especially plants that must NOT be cut into old
   wood (lavender, heather, most conifers), and plants that must be LEFT standing
   over winter rather than cut back (penstemon, gaura, eryngium, rudbeckia,
   echinacea, sedum, verbena bonariensis).

6. NOVICE CLARITY. Would a beginner know what to do, and know when they had done it?
   Flag jargon, vagueness, and any step that assumes knowledge the user won't have.

7. OMISSIONS. For each item type in this batch, is there an important, well-known
   seasonal job that is MISSING? (A real example: lavender had no task warning against
   cutting into old wood — the single commonest way people kill it.)

OUTPUT FORMAT:

A table, most serious first:

Task_ID | Verdict | Issue | Suggested fix

Verdict is one of:
  WRONG     — factually incorrect, or harmful if followed
  RISKY     — correct for some cases but harmful in others (usually a collection-tier problem)
  TIMING    — the months or frequency are off
  UNCLEAR   — a novice would not know what to do
  DUPLICATE — overlaps or conflicts with another task in this batch
  OK        — no issues

List every task, including the OK ones, so I can see the whole batch was reviewed.

Then a separate section:

MISSING TASKS — important jobs not covered for the item types in this batch, with a
one-line reason each.

Be specific and be willing to disagree with the existing data. Cautious approval of a
task that is wrong is worse than a false alarm I dismiss in ten seconds.
```

**Why that last line is there.** The default failure of a review prompt is sycophantic approval — hand a model fifty rows of plausible-looking advice and it will tend to nod along. Requiring every row to be listed, including the passes, and explicitly licensing disagreement is what turns it from a rubber stamp into a genuine check.

---

## 9. Notes on specific columns

### `Estimated_Minutes`

A realistic per-task time estimate for a novice, in whole minutes.

Since v2.0 this is a real database column with a constraint: it must be a positive whole number or empty. A zero or a stray letter is rejected at publish rather than silently ignored, so treat the audit's complaint about it as a genuine blocker rather than a nicety.

It **is** returned by the matching engine (`select_tasks`, and therefore by the `today` call the app makes), but is **not yet displayed** in the app. Surfacing it — a time badge on task cards, or a "quick jobs under 15 minutes" filter — is on the roadmap (`SPEC.md` §6). Populate it for all new content; older rows can be backfilled at leisure.

### `Requires_Wind_Above` — **the name is now misleading**

**The behaviour of this column inverted in v2.0. Read this before using it.**

- **In v1** it meant *"show this task only when wind is above N mph"* — i.e. for emergency wind-prep jobs. That behaviour was a bug, recorded in the v1.x limitations.
- **In v2** it means *"hide this task when wind is above N mph"*. It publishes to the database column `suppress_if_wind_above`, and the matching engine drops the task when the current wind exceeds the value.

The workbook header still reads `Requires_Wind_Above` — a legacy label kept so the publish pipeline's column matching keeps working. Its name now describes the opposite of what it does, which is a trap for anyone authoring from the header alone.

**How to use it now:** put a threshold on tasks that are unsafe or ineffective in wind — spraying, liquid feeding, spreading granular fertiliser, anything at height. Something in the region of 15–20 mph is a sensible starting point. Leave it blank when wind is irrelevant, which is most tasks.

**Content written under the old meaning needs re-reading.** Any existing task carrying a wind value was authored to *appear* in high wind and will now be *hidden* by it. Worth an audit pass over the populated cells.

> **To confirm:** the mapping from this sheet column to `suppress_if_wind_above` lives in `Publish.gs`, which is authored in Google Drive and not in this repository — so it could not be verified here. Check the column mapping once in `Publish.gs` before relying on the guidance above, and correct this note if the header was renamed at some point.

### `Groups` — a warning about silent failure

A task targeting a collection tag that no blueprint carries will match nothing, with no error at runtime. If a collection-level task never appears, check the spelling of the tag in all three places — the `Groups` cell, the `Collections` tab, and the task's `Target_Asset_ID` — before assuming the matcher is broken. The audit catches all three cases; the app does not.

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

1. **The gate.** It runs the full audit and **refuses to publish on any ERROR.** It then adds three publish-specific blocks: every live (non-retired) task must resolve to a real blueprint or a *declared* collection — a bare category prefix is not a valid target and will block; every `GROUP_*` tag carried by a blueprint must be declared on the `Collections` tab; and every task's category must be one of the seven. Finally it computes a **coverage report** — blueprints that no live task reaches — which is a **warning only** and never blocks (some items may legitimately await content).
2. **The push.** It reads the live catalogue first (to preserve tombstone dates and detect rows you have removed), then upserts categories, blueprints, collections and tasks by their natural key (`legacy_code` / `code` / `name`), and reconciles the three membership tables (`blueprint_category`, `collection_member`, `task_target`) to mirror the workbook exactly. **Nothing curated is deleted.** A blueprint or task removed from the workbook is *retired* (a tombstone), not erased.
3. **The report.** A `Publish_Report` tab records what was pushed, the live row counts read back, the coverage report, and the retirement roll-call.

### The dry run

**Garden Data → Check before publish (no changes)** runs the gate and writes the report **without touching the database.** Run it before a real publish, and after any large authoring session, to see what would block and what coverage gaps exist. It is always safe.

### If a publish fails

The report's **"Where the push stopped"** section is the first thing to read. It gives the step the push was on, how many rows were outstanding at that moment, and which steps had already completed. That tells you immediately whether the failure was in reading the workbook, upserting the catalogue, or reconciling one of the three membership tables.

Because the reconcilers delete before they insert, a push that fails during a membership step can leave rows removed and their replacements unwritten. Nothing curated is ever lost — blueprints and tasks are only ever retired, never deleted — but a task can be left with no target, which means it silently stops appearing. **The fix is always to complete a successful publish**, which rebuilds the desired set from scratch and repairs anything left half-done.

If a failure resists a straight re-run, the shape of the outstanding rows is the usual culprit. PostgREST rejects a batch whose objects do not all carry an identical set of fields. The immediate workaround is to split the work across two publishes so that each carries only one shape: fill the `Retired` cell on the tasks carrying one kind of target, publish, clear those cells, and publish again. `Publish.gs` now groups rows by shape before sending, so this should not recur — but the technique is worth knowing.

### Habits worth keeping

- **Publish after authoring, or the app won't see your edits.** A silent gap between the workbook and the app is the one failure this workflow invites; the post-publish report and the dry run are the guard against it.
- **Read the coverage report, don't just skim past it.** It is the only thing standing between a new blueprint and permanent silence (§2a).
- **Fix ERRORs, weigh WARNINGs, judge REVIEWs — then publish.** The gate enforces the ERRORs; the rest are yours to decide.
- **A retired task is withdrawn by filling its `Retired` cell, then publishing** — never by deleting its row.
- **Re-running a publish is safe.** Every write is an upsert or an idempotent reconcile, so a second run with no authoring changes reports zero membership churn.
