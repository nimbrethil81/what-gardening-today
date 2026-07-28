# Database Content Workflow

How to add new **items** (to `Item_Dictionary`) and new **tasks** (to `Master_Task_Matrix`) in the Google Sheets authoring workbook for *What Gardening Today?*

This covers the manual authoring process only — generating content with an LLM, importing it cleanly into the sheet, and verifying it. It does not cover the app's runtime behaviour; see `SPEC.md` for the schema and matching rules this document depends on.

**As of v2.0, the workbook is an authoring workbench, not a live database.** Content is written here exactly as before, but it reaches the app only when it is *published* to the hosted database (Supabase) via an explicit **Garden Data → Publish to app** step. Authoring is unchanged; publishing is new. See §10.

_Current as of v2.1 (2026-07-25). This revision rewrote the task-generation prompt (§5), restructured QA from two passes into three (§7, §8), and added the `Reviewed` column (§2)._

> **If you read only one thing, read this.** The v2.0 migration **abolished bare-category targeting.** A task may no longer target `LAWN` or `PLANT` and sweep up everything beneath it — such a target now *blocks publishing*. Every task must target either one specific blueprint or a **declared collection**. The consequence for authoring is that **a new blueprint inherits nothing.** Add a plant and write no tasks for it, and it will silently receive zero tasks forever — there is no fallback tier to catch it. See §2 and §2a.

---

## 1. Where the data lives

The authoring tabs in the Google Sheet:

- **`Item_Dictionary`** — the catalogue of item *blueprints* shown in the "Add to My Garden" picker. Four columns: `Category`, `Suggested_Name`, `Default_Asset_ID_Prefix`, `Groups`.
- **`Master_Task_Matrix`** — the care tasks matched to those items. Thirteen columns: `Task_ID`, `Target_Asset_ID`, `Task_Name`, `Category`, `Instruction`, `Valid_Months`, `Frequency_Days`, `Suppress_If_Raining`, `Suppress_If_Temp_Below`, `Requires_Wind_Above`, `Estimated_Minutes`, `Retired` (column L; see §2) and `Reviewed` (column M; see §2). Columns A–K are authored by prompt and pasted; L and M are filled by hand only.
- **`Collections`** — added in v2.0. Two columns, `Code` and `Name`, declaring every `GROUP_*` collection that exists and giving it a human display name. Membership still lives in the `Groups` column of `Item_Dictionary`; this tab declares the collections that column may reference. See §2.
- **`Reference_Lists`** — maps the seven display categories to their top-level prefixes; the audit's source of truth for valid categories and prefixes.

**Written by the audit, never edited by hand:**

- **`Audit_Report`** — the findings from **Garden Data → Run Audit**.
- **`Coverage_Grid`** — a blueprint-by-month table of how many live tasks reach each item in each month. Rebuilt on every audit run. It is a *reference artefact for the editorial review* (§7b), not a list of faults. See §7d.
- **`Publish_Report`** — written by the publish step (§10).

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
| `GROUP_LAWN_RENOVATION` | Ryegrass, Fine Fescue, Mixed Utility — lawns that take autumn scarify / aerate / overseed / top dress |
| `GROUP_LAWN_STANDARD_FEED` | Ryegrass, Mixed Utility — lawns that take a full-rate high-nitrogen feed. Deliberately excludes fescue, bentgrass and buffalo |
| `GROUP_CULTIVATED_BED` | Herbaceous Border, Raised Bed, Annual Bedding, Mixed Shrub Border, Cutting Garden — beds of rich, worked garden soil |
| `GROUP_ALL_BEDS` | Herbaceous Border, Mixed Shrub Border, Woodland Shade, Gravel, Bog Garden, Rock Garden |
| `GROUP_BED_CLEARED` | Raised Bed, Annual Bedding, Cutting Garden — beds that stand empty between plantings |
| `GROUP_SHRUB_GENERIC` | Shrubs for which generic shrub care is safe |
| `GROUP_TREE_GENERIC` | Trees for which generic tree care is safe |
| `GROUP_HERBS` | Culinary and ornamental herbs |
| `GROUP_HAND_TOOLS` | Hand tools only — deliberately excludes powered tools, so tool-cleaning advice never reaches a chainsaw |

> **`GROUP_ALL_BEDS` does not mean every bed.** Despite the name it currently omits Raised Bed, Annual Bedding and Cutting Garden. A weeding task targeting it therefore does *not* reach three of the nine bed types. Treat the member list above as authoritative and the name as historical.

The whole-category collections were created during the v2.0 category-tier review, to re-home tasks that previously targeted a bare category. They are the sanctioned replacement for "applies to the whole category" — the difference being that their membership is an explicit, inspectable list rather than a spelling coincidence.

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

If advice is right for most members but wrong for some, it belongs on a narrower collection or on the specific item. `GROUP_LAWN_STANDARD_FEED` is the worked example: a full-rate high-nitrogen spring feed is right for ryegrass and utility turf and wrong for fine fescue, so the feed targets the narrower set rather than all grass lawns.

### The semicolon rule

Both tables are imported as **semicolon-separated** text.

The reason: `Valid_Months` legitimately contains commas (e.g. `3,4,5`), and `Category` and `Groups` can too. If the file were comma-separated, those lists would split across separate columns on import and shove every later column out of place — a silent corruption. Using semicolons as the column separator keeps the comma-lists safely inside one cell.

Consequence: **no free-text field may contain a semicolon.** `Task_Name` and `Instruction` must use only commas and full stops.

A semicolon that reaches the sheet does no harm where it sits — the damage happens if that row is ever exported and re-imported, when it splits the row across columns. The audit flags every occurrence as a WARNING; treat those as a real cleanup job rather than cosmetic noise.

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

**This column is inert for publishing.** `Publish.gs` reads `Master_Task_Matrix` by fixed column index 0–11 and never looks at index 12, so nothing in column M reaches the database. It exists purely for the authoring programme. The audit reports how many live tasks are reviewed and how many are not, which is how you find where you stopped.

**A collection task is legitimately reviewed more than once.** A task targeting `GROUP_SHRUB_GENERIC` comes up in every shrub group pass, judged against a different awkward member each time. Update the date when it does; the column records the most recent look, not a one-time tick.

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

   Always read this from the workbook rather than trusting a remembered number.

2. **Gather the prompt's three required inputs.** The task prompt (§5) will not work properly without them:
   - the item names and exact prefixes, or the collection tag;
   - for a collection target, the **full member list** of that collection;
   - **every live task that already reaches those items** — including tasks that target a collection they belong to, which are easy to forget. Filter `Master_Task_Matrix` by target, and check the `Groups` cell of each item for collections to filter by as well.
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

> **Recommended: Claude Opus 5, extended thinking on, high effort.** (Claude Fable 5, if it's available to you.)
>
> Don't economise here — this is the one prompt whose mistakes reach a real garden. The output is advice a novice follows literally and has no knowledge to second-guess, and a collection-level task reaches every member of that collection at once.
>
> The failure that matters isn't a malformed row; the audit and the publish gate catch those. It's fluent, plausible-sounding advice that happens to be wrong for one awkward member of a collection, or right for the plant but wrong for the month. Nothing mechanical will ever catch that, so it's worth the deeper reasoning at the point of authoring rather than hoping the review picks it up later.
>
> **This prompt no longer asks for a fixed number of tasks.** It asks what the item's year looks like, compares that against what already exists, and writes only the difference. That means the "EXISTING TASKS" input is not optional garnish — leave it out and you will get duplicates of content you already have.

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
    (d) A SAFETY NOTE, where one genuinely applies — blades, ladders and working at height, power tools, anything in a confined or unventilated space, anything involving a chemical product. Omit it where nothing is at stake. Do not pad.
  Commas and full stops only. NO SEMICOLONS.

- CHEMICALS — a hard rule, no exceptions. NEVER name a chemical active ingredient or brand: not glyphosate, not ferrous sulphate, not ferric phosphate, not metaldehyde, not copper sulphate, and not any other. This applies even inside a warning and even when the substance is banned. Product approvals change, and a row naming an active dates into being wrong or illegal without anyone noticing.
  Instead, name the PRODUCT CATEGORY as it appears on a shop shelf — "a selective lawn weedkiller", "a moss treatment sold for lawns", "slug pellets approved for garden use", "a path and drive weedkiller" — and add: "Read and follow the product label - it is the legal instruction."
  Where the hazard is that a beginner buys the wrong thing, disambiguate by describing the product's purpose rather than its chemistry: "the moss treatment sold for lawns, which is not the same as the sharp sand used for top dressing."

- Valid_Months: comma-separated integers 1–12, ascending, no spaces (e.g. 3,4,5). This comma list sits inside ONE semicolon field.

- Frequency_Days: a positive whole number — the cooldown before the task may reappear. Before you choose the number, state the real cadence in words in your NOTES ("in practice this is done once, in early spring"; "every week or so while the plants are cropping") and check that the number matches the words. A once-a-year job is 365. A weekly job through its season is 7. Never blank, never zero. Do NOT go below 3 unless the job genuinely needs doing every day — a value of 1 means the app may offer this task every single day of its season, which is how a useful job becomes something the user learns to dismiss.

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

CRITICAL — COLLECTION-LEVEL TASKS
---------------------------------
If a Target_Asset_ID is a GROUP_ tag, the advice must be safe for EVERY member listed above, without exception. Judge it against the most awkward member of the collection, not the typical one. If the advice is right for most members and wrong for one, do NOT write it — tell me which member breaks it, so I can narrow the collection or write a specific task instead.

NOTES (after the code block)
----------------------------
- The cadence reconciliation for every new row: the real-world cadence in words, and the Frequency_Days you chose.
- Any existing row you believe is wrong, and why.
- Any cross-reference sentence that needs adding to an existing task.
- Anything you could NOT judge from the material I gave you — a collection whose membership I did not paste, an existing task whose instruction I did not include, a question about my climate or soil. Say so plainly rather than assuming.

Begin with the year plan.
```

---

## 6. Verification checklist (after importing tasks)

- Columns line up: the eleven authored columns, headers in the right order, nothing shifted. (Columns L `Retired` and M `Reviewed` are filled by hand only, and the semicolon import never touches them.)
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
- No stray semicolons inside `Task_Name` or `Instruction`.

### After importing items

- `Category` cells contain only the seven allowed values (one or more, comma-separated).
- No plant appears twice under different prefixes.
- Any `GROUP_*` tag used is one you intended, spelled exactly as it appears elsewhere in the column, and declared on the `Collections` tab.
- Every new item either belongs to a collection or has tasks queued for it (§2a).

---

## 7. Quality assurance

This data fails **silently**. A task pointing at a target that doesn't exist doesn't throw an error — it just never appears. An item with no tasks doesn't complain — it simply shows the user nothing. Every significant bug found in this project so far has been of that kind, and each one sat undetected for weeks. QA is therefore not optional polish; it is the only thing standing between a typo and a plant that quietly never gets cared for.

Since v2.0 some of this is caught earlier and harder: the database rejects malformed rows at write time, and the publish gate refuses to run on any ERROR. But the gate cannot tell you that a task is *missing*, or that advice is *wrong*, or that two tasks issued in the same week contradict each other — so the human passes below still matter.

**There are three passes, and they catch entirely different things.** The third is new; the second was rescoped after the previous row-batch version produced false findings.

| Pass | Unit of work | Catches | Run |
|---|---|---|---|
| **7a. Mechanical audit** | the whole workbook | broken references, malformed values, stubs, regressions | after every import; takes seconds |
| **7b. Editorial review** | one item group (10–15 related blueprints) | wrong advice, wrong month, unsafe collection tasks, genuinely missing jobs | one group per session |
| **7c. Interaction review** | one garden, one month | contradictions, duplicates, ordering, cumulative load | after each category is editorially complete |

### 7a. The mechanical audit — automated, run often

`Audit.gs` in the Apps Script project adds a **Garden Data → Run Audit** menu to the spreadsheet. It reads every tab, checks them against the rules in this document, and writes its findings to an `Audit_Report` tab. It never modifies data.

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
- **Review programme state** — how many live tasks carry a `Reviewed` value and how many do not, so a multi-session programme can find where it stopped.

The `Reference_Lists` tab is the audit's source of truth for the seven categories and nine prefixes. Add a prefix there and the audit accepts it immediately — which is that tab's real job, and the reason to keep it.

**None of the checks added in this revision can block a publish.** They are all WARNING or REVIEW severity. The publish gate blocks on ERROR only, so tightening the audit never risks stranding content that was publishable yesterday.

**Checks that have become historical.** The audit's "garden items with no blueprint" and "orphaned log entries" checks read the frozen `User_Profile` and `Task_Log` tabs. Live garden items and completions now live in Postgres, where foreign keys make both conditions impossible. Findings there describe the old workbook, not the running app — read them as archaeology.

Findings come in three severities: **ERROR** (silently broken now), **WARNING** (probably not intended), and **REVIEW** (the script cannot judge; a human should look).

### 7b. The editorial review — human-judged, one item group at a time

The audit cannot tell you that scarlet lily beetle does not affect lily of the valley. No script can. Horticultural correctness needs a subject-matter pass.

**Why this is no longer done in batches of 50 rows.** The previous version pasted a slice of the file by row number and asked three questions that a slice cannot answer:

- It asked what was **missing** for the items in the batch. You cannot know what is missing for roses while looking at two of their six tasks. The review duly reported rose pruning as absent when two correct pruning tasks existed further down the file.
- It asked for **contradictions** within the batch, when the real contradictions sit hundreds of rows apart.
- Task IDs run in rough authoring order, so 50 consecutive rows gave partial coverage of many items and complete coverage of almost none.

**The unit is now an item group: 10 to 15 related blueprints, with every live task that reaches any of them.** That includes tasks targeting any collection those blueprints belong to — which is the part most easily forgotten, and the part where collection-safety bugs live. Group by shared collections and shared care pattern, so the awkward members sit in the same pass as the typical ones.

That makes the batch complete for the items in it, which in turn makes "what is missing?" and "do any of these contradict?" answerable questions rather than guesses.

**The programme.** The catalogue is around 250 blueprints, so complete coverage is roughly two dozen passes — Plants & flowers alone needs eight to ten. At one group per session that is a months-long programme, which is exactly why the `Reviewed` column exists (§2). Suggested grouping:

| Pass | Group | Collections to include |
|---|---|---|
| 1 | Lawns (8) | `GROUP_GRASS_LAWN`, `GROUP_LAWN_RENOVATION`, `GROUP_LAWN_STANDARD_FEED` |
| 2 | Beds (9) | `GROUP_CULTIVATED_BED`, `GROUP_ALL_BEDS`, `GROUP_BED_CLEARED` |
| 3–4 | Garden structures (14) | — |
| 5–6 | Tools (17) | `GROUP_HAND_TOOLS` |
| 7–8 | Trees (25) | `GROUP_TREE_GENERIC` |
| 9–11 | Shrubs and climbers (35) | `GROUP_SHRUB_GENERIC` |
| 12 | Herbs (12) | `GROUP_HERBS` |
| 13 | Soft fruit and brassicas (7) | `GROUP_SOFT_FRUIT`, `GROUP_BRASSICA` |
| 14–16 | Vegetables (25) | — |
| 17–25 | Plants and flowers (110) | `GROUP_TENDER_BULB` |

**When to run it:** work through the programme steadily; additionally, run the relevant group immediately after any large content injection, and whenever a new collection-level task is added, since those are the highest-risk kind.

**How:** use the editorial prompt in §8a. It returns a findings table, not corrected data. **Apply nothing automatically.** The whole point of the review is that a human decides; an LLM confidently "correcting" curated horticultural data is precisely the risk being managed here.

When a pass is complete, put `E` and today's date in the `Reviewed` cell of every row it covered.

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

Use the interaction prompt in §8b. When a pass is complete, add `I` and today's date to the `Reviewed` cell of the rows it covered.

### 7d. The `Coverage_Grid` tab

Every audit run rebuilds a `Coverage_Grid` tab: one row per blueprint, twelve columns for the months, each cell holding the number of live tasks that reach that item in that month. Empty months are shaded.

**This is a reference artefact, not a fault list.** Most empty months are correct — a courgette has nothing to do in February, a wildflower meadow is deliberately left alone from April to July, a plum must not be touched in winter. Turning it into audit findings would produce well over a hundred warnings that are almost all correct behaviour, and the only lasting effect would be teaching you to skim past the warnings section.

Use it as an input to the editorial review instead: paste the rows for the item group you are reviewing, and let the reviewer judge which blanks are deliberate and which are gaps. That is a horticultural judgement, which is exactly what that pass is for.

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
> **Completeness matters more than size.** The old advice was to keep batches to about 50 rows. The new constraint is different: give the reviewer *everything* that reaches the item group, however many rows that is, because an incomplete batch is what produced false findings before. If a group is genuinely too large, split the group — never split its tasks.

### 8a. Editorial review prompt

```
Act as an expert UK horticulturist performing a quality review of an existing
gardening app's task database. You are REVIEWING, not authoring. Do not rewrite
the data — report what you find and let me decide.

Each row below is a piece of gardening advice shown to a NOVICE UK gardener, who
will follow it literally and has no knowledge to catch a mistake.

WHAT YOU HAVE BEEN GIVEN
------------------------
This is a COMPLETE view of one group of related items. Every live task that can
reach any item in this group is included, including tasks that target a collection
those items belong to. Nothing relevant to these items has been withheld.

That completeness is deliberate, and it means you CAN answer "what is missing?"
for these items. In an earlier version of this review the batch was a slice of the
file by row number, and the reviewer reported jobs as absent when they existed
elsewhere in the file. That cannot happen here — but if you believe you are
missing something you need, say so rather than guessing.

ITEM GROUP UNDER REVIEW:
[paste: Suggested_Name | Default_Asset_ID_Prefix | Groups]

ALL LIVE TASKS REACHING THESE ITEMS:
[paste rows: Task_ID | Target_Asset_ID | Task_Name | Instruction | Valid_Months |
 Frequency_Days | Estimated_Minutes]

COLLECTION MEMBERSHIP:
[For every GROUP_ tag appearing as a target above, paste the tag and the FULL LIST
 OF BLUEPRINTS IN IT — that is, the members of the collection.
 NOT a list of the tasks that target the collection. Getting this backwards
 silently disables the most valuable check in this review.]

MONTH COVERAGE (from the Coverage_Grid tab, for these items):
[paste the rows for these blueprints: Blueprint | Jan..Dec task counts]

CONTEXT — how targeting works:
- A GROUP_ tag means the task is shown for EVERY item declared a member of that
  collection, without exception.
- Anything else targets one specific item type.
- There is NO category-level targeting in this system. If you see a bare category
  prefix (LAWN, PLANT, SHRUB, VEG, TREE, BED, HERB, STRUCT, TOOL) as a target,
  flag it — it is invalid data and will be rejected.
- The app does not order tasks. If two jobs must be done in sequence, the only
  place that can be expressed is the instruction text itself.

CHECK EACH TASK FOR:

1. HORTICULTURAL ACCURACY. Is the advice correct for UK conditions? Pay particular
   attention to pest and disease pairings — is this pest actually a problem for this
   plant? (A real bug we found: a scarlet lily beetle task applied to lily of the
   valley, which the pest does not affect.)

2. TIMING. Are Valid_Months right for the UK? Would following this in the stated
   month damage the plant or waste the effort? Is Frequency_Days plausible for the
   real cadence of the job — and does it agree with what the instruction says? (A
   real bug: an instruction saying "mow more frequently in peak season" on a task
   whose cooldown was twice the spring value.)

3. COLLECTION SAFETY. If a task targets a GROUP_ collection, is the advice safe for
   EVERY member listed above? (Real bugs: "cut back to within 10cm of the ground"
   reaching roses, clematis, bamboo and ivy — all woody; rust-and-linseed tool care
   reaching a chainsaw; a full-rate nitrogen feed reaching fine fescue.) Judge
   against the most awkward member, not the typical one. Flag any collection-level
   task that is right for most members but harmful to some.

4. CONTRADICTIONS AND DUPLICATES. Do any two tasks here give conflicting advice, or
   tell the user to do substantially the same job twice? Because this batch is
   complete for these items, a contradiction you find here is real.

5. DANGEROUS OR IRREVERSIBLE ADVICE. Anything that could kill the plant, injure the
   person, or cannot be undone. Note especially plants that must NOT be cut into old
   wood (lavender, heather, most conifers), plants that must be LEFT standing over
   winter rather than cut back (penstemon, gaura, eryngium, rudbeckia, echinacea,
   sedum, verbena bonariensis), and trees that must not be pruned in winter because
   of silver leaf (plum, cherry and the other stone fruits).

6. SAFETY OMISSIONS. Does any task involve a blade, a ladder, work at height, a
   power tool, a confined or unventilated space, or a chemical product — without
   saying so? (A real bug: a greenhouse heater task that did not mention carbon
   monoxide or ventilation.)

7. CHEMICAL NAMING. Our rule is that no instruction may name a chemical active
   ingredient or brand — only the product category a user would recognise in a shop,
   plus an instruction to follow the label. Flag any row naming an active, whether or
   not the substance is currently approved.

8. NOVICE CLARITY. Would a beginner know what to do, and know when they had done it?
   Every instruction should carry the action, a finish condition, and the common
   mistake. Flag jargon ("lute", "drip zone", "fine tilth", "postcrete"), vagueness,
   and any step assuming knowledge the user will not have.

9. OMISSIONS. Given the complete picture above, is there an important, well-known
   seasonal job MISSING for any item in this group? Use the month coverage table:
   for each empty month, say whether the blank is CORRECT (nothing sensible to do
   then) or a GAP (a real job is missing). Do not treat every blank as a gap.

OUTPUT FORMAT:

First, a table, most serious first:

Task_ID | Verdict | Issue | Suggested fix

Verdict is one of:
  WRONG     — factually incorrect, or harmful if followed
  RISKY     — correct for some cases but harmful in others (usually collection-tier)
  TIMING    — the months or frequency are off
  UNSAFE    — a real hazard is unmentioned
  CHEMICAL  — names an active ingredient or brand
  UNCLEAR   — a novice would not know what to do, or when they had finished
  DUPLICATE — overlaps or conflicts with another task here
  OK        — no issues

List every task, including the OK ones, so I can see the whole group was reviewed.

Then:

MISSING TASKS — important jobs not covered for these items, one line of reasoning
each, cross-referenced to the empty months in the coverage table.

Then, and do not skip this:

COULD NOT VERIFY — everything you were unable to judge from the material given.
A collection whose membership I did not paste. An instruction you could only see
truncated. A question about my region, soil or aspect that changes the answer. Any
row where you are guessing. This section existing and being honest is worth more to
me than a confident verdict on a row you could not actually see.

Be specific and be willing to disagree with the existing data. Cautious approval of
a task that is wrong is worse than a false alarm I dismiss in ten seconds.
```

**Why that last line is there.** The default failure of a review prompt is sycophantic approval — hand a model rows of plausible-looking advice and it will tend to nod along. Requiring every row to be listed, including the passes, and explicitly licensing disagreement is what turns it from a rubber stamp into a genuine check. The `COULD NOT VERIFY` section serves the same purpose from the other direction: it gives the reviewer somewhere to put uncertainty other than a confident guess.

### 8b. Interaction review prompt

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

### `Suppress_If_Temp_Below` — a quiet way to delete a task

It **hides** the task when the temperature is below the value. That is useful for jobs that need warmth to work, such as a spring feed.

It is dangerous on winter content. A task valid in December, January and February that carries a temperature floor of 5°C will be hidden through most of the period it was written for, and nothing anywhere reports that it never appeared. Before setting it, ask whether being hidden in the cold is genuinely the behaviour you want. The audit now flags any task whose months all fall between November and March and which carries a value here.

### `Requires_Wind_Above` — **the name is now misleading**

**The behaviour of this column inverted in v2.0. Read this before using it.**

- **In v1** it meant *"show this task only when wind is above N mph"* — i.e. for emergency wind-prep jobs. That behaviour was a bug, recorded in the v1.x limitations.
- **In v2** it means *"hide this task when wind is above N mph"*. It publishes to the database column `suppress_if_wind_above`, and the matching engine drops the task when the current wind exceeds the value.

The workbook header still reads `Requires_Wind_Above` — a legacy label kept so the publish pipeline's column matching keeps working. Its name now describes the opposite of what it does, which is a trap for anyone authoring from the header alone.

**How to use it now:** put a threshold on tasks that are unsafe or ineffective in wind — spraying, liquid feeding, spreading granular fertiliser, anything at height. Something in the region of 15–25 mph is a sensible starting point. Leave it blank when wind is irrelevant, which is most tasks. A value below 10 would hide the task almost permanently, and the audit flags it.

The mapping to `suppress_if_wind_above` is confirmed in `Publish.gs` §4 of the push.

### `Groups` — a warning about silent failure

A task targeting a collection tag that no blueprint carries will match nothing, with no error at runtime. If a collection-level task never appears, check the spelling of the tag in all three places — the `Groups` cell, the `Collections` tab, and the task's `Target_Asset_ID` — before assuming the matcher is broken. The audit catches all three cases; the app does not.

### `Reviewed` — inert by design

Column M is read by nothing except the audit's review-state summary. `Publish.gs` reads columns 0–11 by fixed index and never looks further, so whatever is in column M cannot reach the database or affect a user. That is deliberate: the review programme needed a bookmark, and the safest bookmark is one the pipeline cannot see.

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
- **Nothing in column M affects a publish.** Marking rows reviewed is free and can be done at any time, including mid-session.
