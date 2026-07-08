# Database Content Workflow

How to add new **items** (to `Item_Dictionary`) and new **tasks** (to `Master_Task_Matrix`) in the Google Sheets backend for *What Gardening Today?*

This covers the manual authoring process only — generating content with an LLM, importing it cleanly into the sheet, and verifying it. It does not cover the app's runtime behaviour; see `SPEC.md` for the schema and matching rules this document depends on.

---

## 1. Where the data lives

Two tabs in the backend Google Sheet:

- **`Item_Dictionary`** — the catalogue of item *blueprints* shown in the "Add to My Garden" picker. Three columns: `Category`, `Suggested_Name`, `Default_Asset_ID_Prefix`.
- **`Master_Task_Matrix`** — the care tasks matched to those items. Eleven columns: `Task_ID`, `Target_Asset_ID`, `Task_Name`, `Category`, `Instruction`, `Valid_Months`, `Frequency_Days`, `Suppress_If_Raining`, `Suppress_If_Temp_Below`, `Requires_Wind_Above`, `Estimated_Minutes`.

**Order of operations:** always add the item to `Item_Dictionary` first, then add its tasks. A task's `Target_Asset_ID` must reference a prefix that already exists.

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

### Asset ID prefixes

- Uppercase, no spaces.
- **One or two segments** joined by a single underscore: `PREFIX` or `PREFIX_SUBTYPE` — e.g. `LAWN`, `PLANT_ROSE`, `STRUCT_SHED`, `VEG_TOMATO`. **Never three or more segments.** A three-segment prefix (e.g. `VEG_TOMATO_CHERRY`) will never match at runtime, because the matcher only ever builds up to the first two segments.
- Every prefix is unique, and no prefix may collide with another as a segment-level prefix (per `SPEC.md` §3 asset-matching rules).
- The four-digit instance suffix (`_0001`) is added automatically by the backend when a user adds an item. **Never type it into `Default_Asset_ID_Prefix` or into a task's `Target_Asset_ID`.**

### Task targeting

`Target_Asset_ID` must be **either** a category-level token (e.g. `LAWN`, targeting everything in that group) **or** a full two-segment item prefix that exists in `Item_Dictionary` (e.g. `PLANT_ROSE`). It must exactly match an existing prefix — do not invent new ones.

### The semicolon rule

Both tables are imported as **semicolon-separated** text.

The reason: `Valid_Months` legitimately contains commas (e.g. `3,4,5`). If the file were comma-separated, those months would split across separate columns on import and shove every later column out of place — a silent corruption. Using semicolons as the column separator keeps the comma-list safely inside one cell.

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
7. Check: prefixes are uppercase, no spaces, one or two segments. Optional duplicate guard — put `=IF(COUNTIF(C:C,C2)>1,"DUP","")` in a spare column and look for any `DUP` flags, then delete the helper column.

---

## 4. Workflow B — adding tasks to `Master_Task_Matrix`

1. **Find the next Task ID.** Put this formula in any empty cell. It reads the highest existing number and gives you the next one to start from:

   ```
   =IFERROR("TASK_"&TEXT(MAX(ARRAYFORMULA(IFERROR(VALUE(REGEXEXTRACT(Master_Task_Matrix!A2:A,"\d+")),0)))+1,"0000"),"TASK_0001")
   ```

2. Run the **Task prompt** (§5), giving it: your item names + exact prefixes, the starting Task ID from step 1, and the target category.
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
ALREADY EXISTS (do not repeat these names or prefixes, and do not create a prefix that collides with them):
[Paste existing Suggested_Name / prefix pairs, or leave blank]

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
2. Exactly three columns, exact headers:
Category;Suggested_Name;Default_Asset_ID_Prefix
3. Use a SEMICOLON (;) as the column separator.

FIELD RULES:
- Category: exactly one of the 7 above.
- Suggested_Name: clean, human-readable, NO semicolons (e.g. Rose, Lavender, Shed, Tomato, Hand Trowel).
- Default_Asset_ID_Prefix: UPPERCASE, no spaces, ONE or TWO segments joined by a single underscore — TYPE or TYPE_ITEM (e.g. LAWN, PLANT_ROSE, STRUCT_SHED, VEG_TOMATO, TOOL_TROWEL). NEVER three or more segments. Every prefix must be unique.

Generate the CSV now.
```

### Task prompt (`Master_Task_Matrix`)

```
Act as an expert UK horticulturist and database engineer. I am expanding the `Master_Task_Matrix` table for my gardening app. Generate a CSV dataset of care tasks to APPEND to that table. For each item I list, generate 2–4 highly specific seasonal or maintenance tasks.

TARGET ITEMS (Name + exact prefix):
[e.g.
Bamboo (PLANT_BAMBOO)
Rhododendron (PLANT_RHODODENDRON)
Ivy (PLANT_IVY)]

STARTING TASK ID: [e.g. TASK_0098]
TARGET CATEGORY (exact casing): [e.g. Plants & flowers]

OUTPUT RULES:
1. Output ONLY raw CSV text inside a single code block. No text before or after.
2. Exactly 11 columns, exact headers, in this order:
Task_ID;Target_Asset_ID;Task_Name;Category;Instruction;Valid_Months;Frequency_Days;Suppress_If_Raining;Suppress_If_Temp_Below;Requires_Wind_Above;Estimated_Minutes
3. Use a SEMICOLON (;) as the column separator. Do NOT use a semicolon anywhere else — not in Task_Name, not in Instruction.

FIELD RULES:
- Task_ID: sequential from STARTING TASK ID, no gaps, 4-digit zero-padded (TASK_0098, TASK_0099 …).
- Target_Asset_ID: MUST exactly match a prefix I provided. Never invent prefixes.
- Task_Name: short title, no semicolons (e.g. Cut Back Old Canes).
- Category: exactly the TARGET CATEGORY above.
- Instruction: novice-friendly UK advice, max 2 sentences. Commas fine, NO semicolons.
- Valid_Months: comma-separated integers 1–12, ascending, no spaces (e.g. 3,4,5). This comma list sits inside ONE semicolon field.
- Frequency_Days: positive integer cooldown (7 weekly, 14 fortnightly, 365 annual). Never blank.
- Suppress_If_Raining: the word TRUE only if the task shouldn't be done in rain (watering, liquid feed, spraying). Otherwise leave blank.
- Suppress_If_Temp_Below: integer °C if the task needs warmth (e.g. 5). Otherwise blank.
- Requires_Wind_Above: integer mph ONLY for emergency wind-prep tasks meant to appear when it's windy (e.g. 20). Otherwise blank. (See caveat in the workflow doc — use sparingly for now.)
- Estimated_Minutes: whole minutes a novice would realistically spend on one occurrence (e.g. 10, 30, 90). Never blank.

Generate the CSV now.
```

---

## 6. Verification checklist (after importing tasks)

- Columns line up: eleven filled columns, headers in the right order, nothing shifted.
- `Valid_Months` sits as a single cell like `3,4,5` — **not** spread across several columns.
- `Task_ID` values continue the sequence with no gaps or duplicates.
- Every `Target_Asset_ID` matches a prefix that exists in `Item_Dictionary` (or a valid category-level token), with no `_0001`-style suffix.
- `Suppress_If_Raining` TRUE cells are right-aligned (real boolean), not left-aligned text.
- `Frequency_Days` and `Estimated_Minutes` are whole numbers, never blank.
- No stray semicolons inside `Task_Name` or `Instruction`.

---

## 7. Notes on specific columns

### `Estimated_Minutes` (added, not yet wired into the app)

This column exists so we start capturing a realistic per-task time estimate now. It is **not yet read by the app** — the backend reads columns up to `Requires_Wind_Above` only, so the extra column is harmlessly ignored until we build the feature that surfaces it (e.g. a time badge on task cards, or a "quick jobs under 15 minutes" filter). Populate it going forward; existing rows can be backfilled later.

### `Requires_Wind_Above` — current caveat

Wind handling is a known limitation under review (see `SPEC.md` §5E): the existing behaviour shows a task only when wind is *above* the threshold, which suits genuine "do this because it's windy" prep tasks but not the more common "don't spray/feed when it's windy" case. Until that logic is settled, use this column sparingly, and leave it blank for ordinary spraying/feeding tasks rather than authoring data that may need reworking once the fix lands.
