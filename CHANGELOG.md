# Changelog

All notable changes to "What Gardening Today?" will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning follows a simplified semantic scheme:

- **MAJOR** (e.g. 1.0 → 2.0) — architectural phase transitions per SPEC.md §6 (e.g. backend migration, native rewrite).
- **MINOR** (e.g. 1.0 → 1.1) — user-facing features, UI changes, and bug fixes within the current phase.

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
