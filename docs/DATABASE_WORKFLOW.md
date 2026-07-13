# Database Content Workflow

How to add new **items** (to `Item_Dictionary`) and new **tasks** (to `Master_Task_Matrix`) in the Google Sheets backend for *What Gardening Today?*

This covers the manual authoring process only — generating content with an LLM, importing it cleanly into the sheet, and verifying it. It does not cover the app's runtime behaviour; see `SPEC.md` for the schema and matching rules this document depends on.

---

## 1. Where the data lives

Two tabs in the backend Google Sheet:

- **`Item_Dictionary`** — the catalogue of item *blueprints* shown in the "Add to My Garden" picker. Four columns: `Category`, `Suggested_Name`, `Default_Asset_ID_Prefix`, `Groups`.
- **`Master_Task_Matrix`** — the care tasks matched to those items. Eleven columns: `Task_ID`, `Target_Asset_ID`, `Task_Name`, `Category`, `Instruction`, `Valid_Months`, `Frequency_Days`, `Suppress_If_Raining`, `Suppress_If_Temp_Below`, `Requires_Wind_Above`, `Estimated_Minutes`.

**Order of operations:** always add the item to `Item_Dictionary` first, then add its tasks. A task's `Target_Asset_ID` must reference a prefix or a group tag that already exists.

---

## 2. Conventions that must not be broken

These are load-bearing. Getting them wrong causes silent failures (no error, just tasks that never appear or rows that import into the wrong columns).

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

### One blueprint per real-world item

Never enter the same plant twice under two different prefixes. This has caused real bugs: Rose, Lavender, Hydrangea, Raspberry and Strawberry all previously existed twice, producing two identical-looking pills in the picker with entirely different task behaviour depending on which the user happened to tap. If an item belongs in two categories, use a multi-valued `Category` cell.

### Asset ID prefixes

- Uppercase, no spaces.
- **Any number of segments** joined by single underscores — `LAWN`, `PLANT_ROSE`, `LAWN_MIXED_UTILITY`, `PLANT_LILY_OF_THE_VALLEY`, `VEG_FRUIT_RASPBERRY` are all valid. (Before v1.3 the matcher truncated everything to two segments, so longer prefixes silently failed. That limit is gone.)
- The first segment must be one of the nine category prefixes: `LAWN`, `BED`, `TREE`, `SHRUB`, `PLANT`, `VEG`, `HERB`, `STRUCT`, `TOOL`. Do not invent new top-level prefixes — a `FRUIT_*` family was invented once and none of its tasks ever matched anything.
- Prefixes **may** be substrings of one another (`PLANT_LILY` and `PLANT_LILY_OF_THE_VALLEY` coexist safely). Matching is an exact equality test, so one can never capture the other's tasks.
- Every prefix must be unique.
- `GROUP_` is a **reserved prefix** and must never begin an asset prefix.
- The four-digit instance suffix (`_0001`) is added automatically by the backend when a user adds an item. **Never type it into `Default_Asset_ID_Prefix` or into a task's `Target_Asset_ID`.**

### Groups

The `Groups` column declares an item's membership of cross-cutting sets that tasks can target — the middle tier between "the whole category" and "one specific item".

- Optional. Blank means the item belongs to no groups.
- Tags are uppercase, prefixed `GROUP_`, comma-separated within the one cell (e.g. `GROUP_SOFT_FRUIT, GROUP_CANE_FRUIT`).
- Tags live on the **blueprint**, not on the user's individual garden item. "Raspberries are soft fruit" is a fact about raspberries, declared once.
- **Groups are never inferred from spelling.** `VEG_FRUIT_RASPBERRY` does *not* automatically belong to any `VEG_FRUIT` grouping — there is no such thing. If you want a task to cover all soft fruit, tag each soft fruit blueprint `GROUP_SOFT_FRUIT` and target that.
- **Create groups lazily.** Only invent a group at the moment you want to write a task that applies to a set of items. Do not attempt to build a taxonomy up front.
- A group must exist on at least one blueprint before a task may target it. A task targeting an empty group matches nothing (silently).

Groups currently in use:

| Tag | Members |
|---|---|
| `GROUP_SOFT_FRUIT` | Raspberry, Strawberry, Blackberry, Goji |
| `GROUP_BRASSICA` | Broccoli, Kale |
| `GROUP_TENDER_BULB` | Dahlia (the other tender bulbs each have their own lift-and-store task) |

A `GROUP_HERBACEOUS_PERENNIAL` group was considered and rejected — see CHANGELOG 1.3. The lesson is worth keeping: **a group must describe what an item *is*, not what content it happens to be missing.** If the only thing the members have in common is "no specific task written yet", it is not a group.

### Task targeting

`Target_Asset_ID` must be **exactly one** of:

1. A **category** prefix — e.g. `LAWN`. Applies to every item in that category.
2. A **full item** prefix that exists in `Item_Dictionary` — e.g. `VEG_FRUIT_RASPBERRY`. Applies to that item type only.
3. A **group tag** that exists in `Item_Dictionary.Groups` — e.g. `GROUP_SOFT_FRUIT`. Applies to every item carrying that tag.

Anything else matches nothing. In particular, a partial prefix such as `VEG_FRUIT` or `VEG_BRASSICA` is **not** a valid target — it looks plausible and fails silently. Use a group.

### The category-tier safety rule

A task targeting a bare category prefix must be safe for **every** member of that category, with no exceptions.

This has bitten us. "Cut Back Perennials" (cut to 10cm of the ground) targeted `PLANT`, so it was being issued for Rose, Clematis, Bamboo and Ivy — all woody. Similarly, generic shrub feeding and mulching would be actively harmful to Lavender, which needs poor, dry soil, which is why those two tasks are deliberately absent from the generic shrub set.

If advice is right for most members of a category but wrong for some, it belongs on a group or a specific item — not on the category.

### The semicolon rule

Both tables are imported as **semicolon-separated** text.

The reason: `Valid_Months` legitimately contains commas (e.g. `3,4,5`), and now `Category` and `Groups` can too. If the file were comma-separated, those lists would split across separate columns on import and shove every later column out of place — a silent corruption. Using semicolons as the column separator keeps the comma-lists safely inside one cell.

Consequence: **no free-text field may contain a semicolon.** `Task_Name` and `Instruction` must use only commas and full stops.

### The rain column is a true/false value, not text

`Suppress_If_Raining` is read by the backend as a real boolean. After import, a `TRUE` in that column should sit **right-aligned** (Sheets treats it as a logical value). If it lands **left-aligned** as the text "TRUE", suppression silently does nothing. Leave the cell **blank** when the task is unaffected by rain — don't type `FALSE`.

---

## 3. Workflow A — adding items to `Item_Dictionary`

1. Run the **Item prompt** (§5) in a fresh LLM chat. If you're topping up an existing category, paste your current names/prefixes into the prompt's "ALREADY EXISTS" slot so it won't repeat or collide with them.
2. Copy the generated block (everything inside the code block).
3. In the sheet, on the `Item_Dictionary` tab, click the first empty cell in **column A** below your last row.
4. Paste. Everything lands stacked in one column.
5. Select what you just pasted, then **Data → Split text to columns → Separator: Semicolon**.
6. Delete the header row the prompt included (your sheet already has headers).
7. Check: prefixes are uppercase, no spaces, first segment is one of the nine valid category prefixes. Optional duplicate guard — put `=IF(COUNTIF(C:C,C2)>1,"DUP","")` in a spare column and look for any `DUP` flags, then delete the helper column.
8. Check for duplicate *items* as well as duplicate prefixes: does this plant already exist in the sheet under a different prefix?

---

## 4. Workflow B — adding tasks to `Master_Task_Matrix`

1. **Find the next Task ID.** Put this formula in any empty cell. It reads the highest existing number and gives you the next one to start from:

   ```
   =IFERROR("TASK_"&TEXT(MAX(ARRAYFORMULA(IFERROR(VALUE(REGEXEXTRACT(Master_Task_Matrix!A2:A,"\d+")),0)))+1,"0000"),"TASK_0001")
   ```

2. Run the **Task prompt** (§5), giving it: your item names + exact prefixes (or group tags), the starting Task ID from step 1, and the target category.
3. Copy the generated block.
4. On the `Master_Task_Matrix` tab, click the first empty cell in **column A** below your last row, and paste.
5. Select what you pasted, then **Data → Split text to columns → Separator: Semicolon**.
6. Delete the header row the prompt included.
7. Run the verification checklist in §6.

**Optional safety net:** if you'd rather not paste straight into the live table, do steps 4–6 on a scratch tab first, eyeball the result, then copy the clean block into the real table.

---

## 5. The prompts

### Item prompt (`Item_Dictionary`)

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
- Groups: leave BLANK unless the item clearly belongs to an existing group tag I listed above. Comma-separate multiple tags inside the one field. Do not invent speculative new groups.

Generate the CSV now.
```

### Task prompt (`Master_Task_Matrix`)

```
Act as an expert UK horticulturist and database engineer. I am expanding the `Master_Task_Matrix` table for my gardening app. Generate a CSV dataset of care tasks to APPEND to that table. For each item I list, generate 2–4 highly specific seasonal or maintenance tasks.

TARGET ITEMS (Name + exact prefix, or group tag):
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
- Target_Asset_ID: MUST exactly match a prefix or group tag I provided. Never invent prefixes, and never use a partial prefix such as VEG_FRUIT — partial prefixes match nothing.
- Task_Name: short title, no semicolons (e.g. Cut Back Old Canes).
- Category: exactly the TARGET CATEGORY above.
- Instruction: novice-friendly UK advice, max 2 sentences. Commas fine, NO semicolons.
- Valid_Months: comma-separated integers 1–12, ascending, no spaces (e.g. 3,4,5). This comma list sits inside ONE semicolon field.
- Frequency_Days: positive integer cooldown (7 weekly, 14 fortnightly, 365 annual). Never blank.
- Suppress_If_Raining: the word TRUE only if the task shouldn't be done in rain (watering, liquid feed, spraying). Otherwise leave blank.
- Suppress_If_Temp_Below: integer °C if the task needs warmth (e.g. 5). Otherwise blank.
- Requires_Wind_Above: integer mph ONLY for emergency wind-prep tasks meant to appear when it's windy (e.g. 20). Otherwise blank. (See caveat in the workflow doc — use sparingly for now.)
- Estimated_Minutes: whole minutes a novice would realistically spend on one occurrence (e.g. 10, 30, 90). Never blank.

CRITICAL — CATEGORY-LEVEL TASKS: if any Target_Asset_ID is a bare category prefix (LAWN, PLANT, SHRUB, VEG, TREE, BED, HERB, STRUCT, TOOL), the advice MUST be safe for every possible member of that category without exception. Do not write category-level tasks that assume a plant is herbaceous, or that assume it wants rich soil or feeding. If the advice is right for most members but wrong for some, tell me — it needs a group or a specific item instead.

Generate the CSV now.
```

---

## 6. Verification checklist (after importing tasks)

- Columns line up: eleven filled columns, headers in the right order, nothing shifted.
- `Valid_Months` sits as a single cell like `3,4,5` — **not** spread across several columns.
- `Task_ID` values continue the sequence with no gaps or duplicates.
- Every `Target_Asset_ID` is a category prefix, a full item prefix that exists in `Item_Dictionary`, or a `GROUP_*` tag that exists in `Item_Dictionary.Groups` — with no `_0001`-style suffix and no partial prefixes.
- Any category-level task is genuinely safe for every member of that category.
- `Suppress_If_Raining` TRUE cells are right-aligned (real boolean), not left-aligned text.
- `Frequency_Days` and `Estimated_Minutes` are whole numbers, never blank.
- No stray semicolons inside `Task_Name` or `Instruction`.

### After importing items

- `Category` cells contain only the seven allowed values (one or more, comma-separated).
- No plant appears twice under different prefixes.
- Any `GROUP_*` tag used is one you intended, spelled exactly as it appears elsewhere in the column.

---

## 7. Notes on specific columns

### `Estimated_Minutes`

This column captures a realistic per-task time estimate. As of v1.3 it **is** returned in the API payload, but is **not yet displayed** in the app. It will surface in a later phase (e.g. a time badge on task cards, or a "quick jobs under 15 minutes" filter). Populate it going forward; existing rows can be backfilled later.

### `Requires_Wind_Above` — current caveat

Wind handling is a known limitation under review (see `SPEC.md` §5E): the existing behaviour shows a task only when wind is *above* the threshold, which suits genuine "do this because it's windy" prep tasks but not the more common "don't spray/feed when it's windy" case. Until that logic is settled, use this column sparingly, and leave it blank for ordinary spraying/feeding tasks rather than authoring data that may need reworking once the fix lands.

### `Groups` — a warning about silent failure

A task targeting a group tag that no blueprint carries will match nothing, with no error. If a group-level task never appears, check the spelling of the tag in both places before assuming the matcher is broken.
