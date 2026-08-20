# Overnight review programme — What Gardening Today?

_Adapted from `WBCReviewPrompts.docx`. Written 2026-08-18, against v2.12._

This document does three things: assesses how well the Warboss Companion review prompts
transfer to WGT, gives rewritten prompts for the ones worth keeping, and sets out a
schedule for running them as unattended overnight tasks.

**A note on what changed in translation.** The WBC prompts assume a person pastes them
into a chat and stays to argue. These do not — they run at 01:00 with nobody watching,
in a session that has never seen this project before and will never see it again. That
single difference is responsible for most of the rewriting below: the evidence rule, the
"stop if nothing changed" rule, and the decisions ledger all exist because an unattended
reviewer has nobody to push back on it.

---

## Contents

1. [How well the WBC prompts transfer](#1-how-well-the-wbc-prompts-transfer)
2. [What an overnight run can and cannot reach](#2-what-an-overnight-run-can-and-cannot-reach)
3. [Standing rules — the shared preamble](#3-standing-rules--the-shared-preamble)
4. [The recommended review set](#4-the-recommended-review-set)
5. [Reviews held ready for the content pipeline](#5-reviews-held-ready-for-the-content-pipeline)
6. [Scheduling](#6-scheduling)
7. [What will go wrong, and the fix for each](#7-what-will-go-wrong-and-the-fix-for-each)

---

## 1. How well the WBC prompts transfer

The two projects are more different than they look. WBC is Apps Script, Google Sheets,
localStorage and three named modules with ownership boundaries. WGT is a static PWA
talking directly to Postgres, with access control enforced by Row-Level Security and
a separate content pipeline living in Apps Script. Where WBC's prompts name a specific
structure, that structure usually doesn't exist here — but the *question* underneath it
almost always does.

| WBC prompt | Verdict | What has to change |
|---|---|---|
| **Code Review** | Keep, rewritten | There are no `storage.js` / `sheets.js` / `resolver.js` boundaries to check. `app.js` is a single 2,305-line file. Substitute SPEC §5B's three planes (database / Edge Function / frontend), the `escapeHtml` discipline, the `CACHE_NAME` bump rule, and drift from `docs/CONFIG_ITEMS.md`. |
| **Technical Debt Audit** | Drop as a separate review | Overlaps the code review by roughly seventy per cent on a 13,000-line repo, half of which is SQL that is append-only by design. Its distinctive questions — dead code, "temporary" fixes gone permanent, roadmap blockers — fold into the code review as three extra bullets. |
| **UI/UX Review** | Keep, rewritten | WBC's context is "table-ready, low light". WGT's is the exact opposite: outdoors, bright sun, wet or gloved hands, and an older, novice audience. Also merge in accessibility, which is a bigger deal here than in a wargaming tool. |
| **Architecture Review** | Keep, barely changed — **best fit of the nine** | The three-phase framing transfers directly, and WGT's version is *better posed* than WBC's, because the phase boundaries have real numbers behind them (500 MB database, 5 GB egress, 50,000 MAU, 500,000 function invocations) and real trigger conditions in `WGT_STRATEGY.md` §7. "What breaks first" is arithmetic here, not speculation. |
| **Security Review** | Keep — **highest value of the nine** | One finding transfers verbatim: `LIVE_REPO_PAT` in the dev→live promotion workflow is the same shape of exposure in both projects. Everything else is new, and the new material is the important part: RLS *is* the access control layer, and a wrong RLS policy fails silently and invisibly. |
| **Test Generation** | Keep, reframed | WGT already has ~1,900 lines of SQL tests (`db/*_test.sql`). Asking for scenarios from scratch wastes the night. Ask instead for a gap analysis against what exists — and note the frontend has no tests at all. |
| **Documentation Generation** | Drop as written, **repurpose as a drift check** | WGT's documentation is already unusually good; generating more is low value. But `SPEC.md` claims to be authoritative for the system *as built*, and nothing mechanically enforces that. "Does SPEC.md still describe this code?" is tedious, high-value, and exactly what an overnight run is for. This is the strongest repurpose in the set. |
| **Challenge My Assumptions** | Keep, quarterly at most | `WGT_STRATEGY.md` §6 already *is* a premortem, and a good one. The prompt has to be rewritten to challenge what §6 has not already rejected, or to argue that a §6 rejection has gone stale — otherwise it will spend the night rediscovering conclusions you reached deliberately. |
| **Market Research** | Drop as a standing review | Needs a specific question to be worth anything, and a scheduled task can't supply one. Ask ad hoc instead. |

**Net: six standing reviews and one quarterly**, rather than nine.

### The one addition WBC doesn't have

**Documentation drift** (item 7 above, repurposed). It is the review that best fits both
the project and the format: `SPEC.md`, `CHANGELOG.md` and `docs/CONFIG_ITEMS.md` all
claim to describe the code as built, three files drift independently, and confirming
that by hand is exactly the kind of dull cross-referencing nobody does voluntarily.

---

## 2. What an overnight run can and cannot reach

I tested this rather than assuming it.

**`git clone` works, and is the right mechanism.** A shallow clone of the public dev repo
completed with no prompt and no authentication. Whole files, correct paths, includes
`.github/workflows/` — which the project's GitHub sync explicitly excludes.

**`WebFetch` on `github.com` and `raw.githubusercontent.com` triggered a permission
prompt**, which is the single most important practical finding here. The WBC prompts
instruct the reviewer to pull state from `raw.githubusercontent.com/...`. Overnight, with
nobody there to click Allow, that stalls the run. **Every prompt below clones instead.**

**Project-knowledge search returns fragments, not files.** Perfectly good for "what does
SPEC say about entitlement", useless for a code review — you cannot review the parts of
`app.js` that the search didn't happen to return. Hence the clone.

**The content pipeline is invisible.** `Audit.gs`, `Review.gs`, `TimingReview.gs`,
`InteractionReview.gs` and `Publish.gs` are not in the repo. That is a substantial and
load-bearing part of the system — the applier alone enforces a dozen authoring rules —
and no repo-based review can see any of it. Two consequences:

- Every prompt below is scoped to what the repo actually contains, and says so.
- Section 5 holds two prompts written for the pipeline, ready for whenever the `.gs`
  files land in the repo. Getting them there — via `clasp pull`, or simply pasting them
  into a `apps-script/` folder — is worth doing for reviewability alone, quite apart from
  the fact that the pipeline is currently the only part of the system with no version
  history.

**Reviews should target the dev repo**, not live. Live is a deployment artefact.

---

## 3. Standing rules — the shared preamble

Every scheduled task needs the same opening, and repeating it in six places means six
places to update. **Recommended: commit this as `docs/OVERNIGHT_REVIEWS.md` in the dev
repo.** Each prompt then clones the repo and reads it — which works regardless of what
tools the scheduled session happens to have, and means one edit changes all six.

If you'd rather not add a repo file, paste this block at the top of each task prompt
instead. Everything below assumes the repo-file version.

> **Standing rules for overnight reviews — What Gardening Today?**
>
> You are running unattended, overnight, in a fresh session with no memory of any previous
> run. Nobody will answer a question, so do not ask one — make a reasonable choice and
> state it plainly at the top of the report.
>
> **1. Get the code by cloning.** Run:
> `git clone --depth 1 https://github.com/nimbrethil81/what-gardening-today-dev.git`
> Read whole files. Do not use project-knowledge search for code: it returns fragments,
> and a review of fragments is worse than no review, because it reports as missing things
> it simply didn't see.
>
> **2. Stop early if nothing has changed.** Note the top version in `CHANGELOG.md`. If you
> can reach previous reports — they are saved in the project under `claude/reviews/` — and
> one for this same review names the same version, then the code has not moved: say so in
> one line and stop. If you cannot reach them, carry out the full review rather than
> guessing. A repeated review of unchanged code produces a repeated list, which trains the
> reader to skim.
>
> **3. Respect the decisions ledger.** Read `docs/REVIEW_DECISIONS.md` from the repository
> you have just cloned. It has two tables and they are handled differently.
>
> - **Table 1, "Closed"**, and the "Standing context" table at the foot of the file:
>   already considered and deliberately not being done. **Do not raise these at all.** If
>   you believe a dismissal has genuinely gone stale, say so in one sentence with what
>   changed, and do not re-argue it beyond that.
> - **Table 2, "Accepted, still outstanding"**: agreed but not yet done. **Do not report
>   these as findings** — they do not count against your ten. Instead, list them at the end
>   of the report under the heading **"Already accepted and outstanding"**, one line each,
>   giving the finding and the date it was accepted, with no re-analysis and no argument.
>   The point is that they stay visible without crowding out new work.
>
> The ledger lives in the repo rather than in the project precisely so that this rule
> cannot fail quietly: if you could clone, you can read it.
>
> **4. Evidence rule.** Every finding must name the file and line, and quote the two or
> three lines it rests on. Before writing the report, re-read each finding against the
> actual file and delete any that do not survive contact with it. A finding you cannot
> quote is a guess, and an unattended guess has nobody to catch it.
>
> **5. Volume.** At most ten findings, ranked most serious first. Fewer is better.
> "Nothing material found" is a good result and a useful one — report it plainly rather
> than padding.
>
> **6. Report only.** Change nothing in the repo, open no pull request, push nothing.
>
> **7. Judge against the right standard.** This is a hobby PWA for enthusiastic novice UK
> gardeners. It has about five invited users, costs roughly £5 a month to run, and
> sign-up is closed. A finding that only matters at a hundred thousand users is not a
> finding today, unless the review explicitly asks about scale. Advice that reaches a real
> garden, and anything touching other people's data, are the two things worth being strict
> about.
>
> **8. Output.** Write the report to `YYYY-MM-DD-<review-name>.md`. Open with an executive
> summary of three to five bullets, most severe first. Then detailed findings, each giving
> what, where (`file:line`), why it matters *for this project*, and what you'd do about it
> — but no implementation. Close with the `CHANGELOG.md` version reviewed.
>
> Deliver it with `SendUserFile`. **This is the step that must not be skipped** — it is the
> only one the reader is guaranteed to see. Then also save it to the project at
> `claude/reviews/YYYY-MM-DD-<review-name>.md` if the Projects tool is available; if it
> isn't, skip that silently and say so under rule 9.
>
> **9. Say what you could actually reach.** End the report with one line naming which of
> these worked: the repository clone, `docs/REVIEW_DECISIONS.md`, previous reports in the
> project, and saving back to the project. This is diagnostic rather than part of the
> review. It is how the reader can tell whether the programme is running on all its inputs
> or quietly running on half of them.

---

## 4. The recommended review set

Each prompt below is complete and standalone — paste it straight into a scheduled task.

---

### 4.1 Frontend code review

**Purpose:** the PWA is the only part with no tests and the only part a user touches
directly. `app.js` is 2,305 lines in one file.

```
Do a code review of the "What Gardening Today?" frontend.

First read docs/OVERNIGHT_REVIEWS.md in the repo and follow its standing rules in
full. Review name: frontend-code-review.

Scope — these files only:
  app.js, index.html, style.css, sw.js, manifest.json, config.example.js, privacy.html

Read SPEC.md and docs/CONFIG_ITEMS.md first; they are the standard you are judging
against.

Check for:
- Violations of SPEC.md §5B's three planes. The frontend does authentication UI,
  state and rendering. UI design elements must never arrive from the data layer.
- Any user-supplied string reaching innerHTML without escapeHtml() — garden names,
  item custom names, postcode echoes, error messages containing user input.
- Unhandled failure paths. SPEC §5C requires graceful degradation: postcodes.io
  down, the today function timing out, an expired session mid-action, no network.
  Find the ones that throw or hang instead of showing a friendly message.
- Values hardcoded in the frontend that belong in docs/CONFIG_ITEMS.md, and any of
  the 28 entries already there whose documented value no longer matches the code.
- Raw hex colours or magic numbers where the CSS custom properties should be used
  (--brand-green, --accent-blue, --accent-red, --bg-app, --bg-card, --text-main,
  --text-muted, --border-color, --brand-light).
- Service-worker cache correctness: sw.js must be network-first, must cache only
  same-origin files, and CACHE_NAME must have been bumped by the most recent
  release that changed a cached file. Check that against CHANGELOG.md.
- Duplicated logic, dead code, and functions large enough to be worth splitting out
  of app.js.
- Shortcuts or TODOs that have quietly become permanent.
- Anything that would obstruct the next items in SPEC.md §6.

Report findings only. Do not fix anything.
```

**Model & effort:** Opus, medium. **Cadence:** monthly.

---

### 4.2 Security and access-control review

**Purpose:** the repo is public, RLS is the entire access-control layer, and a wrong
policy fails silently. This is the review to run if you only run one.

```
Do a security review of "What Gardening Today?".

First read docs/OVERNIGHT_REVIEWS.md in the repo and follow its standing rules in
full. Review name: security-review.

Scope:
  db/02_rls.sql, db/03_functions.sql, db/10_activity.sql, db/11_entitlement.sql,
  db/12_account_deletion.sql, db/13_gardens.sql, db/07_weather_cache.sql,
  supabase/functions/today/index.ts, .github/workflows/, app.js, config.js

Read SPEC.md §2 and §5A first — the access model and the data-ownership principles
are what you are testing the code against.

Rank every finding by severity. Focus on:
- Row-Level Security. For each table, state plainly who can read it and who can
  write it, then say whether that matches SPEC.md. Look specifically for: a policy
  that permits more than intended, a table with RLS enabled but no policy, a
  SECURITY DEFINER function that bypasses a policy it shouldn't, and anything
  reachable by the anon role that should not be.
- weather_cache must be reachable only by the service role, never by a user.
- The today Edge Function: JWT verification on, membership proven by reading the
  garden row as the user, coordinates read server-side and never trusted from the
  client, the OpenWeather key never reaching the browser, and the CORS allowed-origin
  list being no wider than it needs to be.
- Whether today can be used as a free weather proxy or abused for volume by a
  signed-in user, and what the practical rate limit is.
- Account deletion (db/12) and garden deletion (db/13): does deleting a person
  destroy data belonging to someone else who shares the garden? SPEC §5A says it
  must not. Check the actual cascade behaviour, not the comments.
- Secrets. LIVE_REPO_PAT in .github/workflows/deploy-to-live.yml, and the Supabase
  secrets in keepalive.yml — scope, blast radius if leaked, and whether the workflow
  can be triggered by anyone who shouldn't be able to trigger it. Confirm no
  service_role key appears anywhere in the frontend or the repo.
- XSS and injection through user-entered text: garden names, custom item names,
  postcodes.
- Anything in localStorage or sessionStorage that shouldn't be there.

Note explicitly that the Apps Script content pipeline (Audit.gs, Review.gs,
Publish.gs and the two review modes) is not in this repo and is therefore outside
this review's reach — including whatever credential Publish.gs uses to write to the
database, which is the most security-relevant thing you cannot see.

Report findings only, ranked by severity.
```

**Model & effort:** Opus, high. **Cadence:** every other month (odd months). Move it to
monthly once sign-up opens to the public.

---

### 4.3 Architecture and scaling review

**Purpose:** the strongest transfer from the WBC set, and the one whose answer changes
as the strategy moves.

```
Do an architecture review of "What Gardening Today?".

First read docs/OVERNIGHT_REVIEWS.md in the repo and follow its standing rules in
full. Review name: architecture-review.

Read SPEC.md in full, then docs/CONFIG_ITEMS.md, then db/03_functions.sql and
supabase/functions/today/index.ts.

Part 1 — structure. Assess:
- Adherence to SPEC.md §5B's separation: Postgres owns storage, access control and
  the matching engine; the today Edge Function is the only server-side glue; the
  frontend does UI and state. Name anywhere that boundary has been crossed.
- select_tasks as the single matching engine. Is there any matching logic that has
  crept back into the frontend or the Edge Function?
- Data flow for one app open, end to end, and how many round trips it costs.

Part 2 — what breaks first. Do the arithmetic rather than speculating, and state
your assumptions. Against these three states:
  1. Now — invite-only, roughly five users, one manual provisioning step each.
  2. Public sign-up on, Google-only — a few hundred peak-season monthly actives.
  3. Compounding from seasonal pages — one to five thousand peak-season actives.

For each boundary, name what breaks FIRST and roughly at what number, against the
Supabase free tier: 500 MB database, 5 GB egress, 50,000 monthly active users,
500,000 Edge Function invocations. Every app open calls today, so invocations and
egress scale with opens, not with users. Consider also the weather cache's 0.1°
location grouping (nearby gardens share one fetch, so OpenWeather calls scale with
distinct locations), the RLS policy cost per query, and garden_day growth.

Do not use a generic "what if this scales" framing. Nothing beyond state 1 is
committed. The useful output is a short list of the form "at roughly X, Y gives
way, and the cheapest fix is Z".

Report findings only.
```

**Model & effort:** Opus, high. **Cadence:** every other month (odd months).

---

### 4.4 Documentation drift check

**Purpose:** the addition to the WBC set, and the best fit for unattended overnight work.

```
Check whether the documentation of "What Gardening Today?" still describes the code
as built.

First read docs/OVERNIGHT_REVIEWS.md in the repo and follow its standing rules in
full. Review name: documentation-drift.

This is a drift check, not a documentation-writing exercise. Do not draft new
documentation.

SPEC.md claims to be the single authoritative reference for the system as built.
docs/CONFIG_ITEMS.md claims to record where each tunable value lives and what it is
currently set to. CHANGELOG.md claims to record what each release changed. Test all
three claims against the code.

Check, in this order:
1. Every schema element SPEC.md §3 describes — does it exist in db/ as described?
   Every table and column in db/ — is it in SPEC.md?
2. Every one of the 28 entries in docs/CONFIG_ITEMS.md — does the value named there
   match the value actually in the code or workflow it points at? Name the ones
   that don't, with both values.
3. Every behaviour SPEC.md §2 and §4 describes for select_tasks, create_garden and
   the today function — does the implementation still do that?
4. Anything the code does that no document mentions at all. This is the most
   valuable category and the easiest to miss.
5. Internal cross-references that no longer resolve: a §-number, filename or tab
   name cited in one document that doesn't exist in the other.
6. Whether the most recent CHANGELOG entry accounts for the files that actually
   changed in it.

For each drift, say which side is wrong — the document or the code — or say you
can't tell and why.

Note that docs/DATABASE_WORKFLOW.md describes Apps Script files that are not in this
repo, so its accuracy cannot be checked here. Say so once; don't guess at it.

Report findings only. Do not edit SPEC.md, CHANGELOG.md or CONFIG_ITEMS.md.
```

**Model & effort:** Opus, medium. **Cadence:** monthly.

---

### 4.5 UI, UX and accessibility review

**Purpose:** the audience is older, novice and outdoors. The constraint is the inverse of
WBC's.

```
Do a UI, UX and accessibility review of "What Gardening Today?".

First read docs/OVERNIGHT_REVIEWS.md in the repo and follow its standing rules in
full. Review name: ux-accessibility-review.

Scope: index.html, style.css, and the rendering and interaction code in app.js.

IMPORTANT LIMITATION, and state it at the top of your report: you are reading source,
not using the app. The live site is behind a Google sign-in gate, so you cannot see
anything rendered. Judge only what the source supports, and say when a finding needs
confirming on a real device.

The context to judge against — this differs sharply from a desk application:
- Used outdoors, standing up, often in bright direct sunlight.
- One hand, frequently wet, muddy or gloved.
- The audience is enthusiastic novice gardeners, skewing older. Assume presbyopia and
  assume system text size may be turned up.
- The whole product is one question — "what should I do today?" — so anything between
  opening the app and the answer is friction.

Review, screen by screen: sign-in, first-run garden setup, Today, My Garden, the
add-to-garden picker, the hidden-tasks restore screen, the settings and garden modals,
and the two destructive-confirmation modals.

Look for:
- Touch targets below 44px, and any two targets close enough to mis-hit with a gloved
  thumb. The swipe-to-hide interaction deserves particular attention.
- Contrast. Compute actual contrast ratios for every text-on-background pair in
  style.css and report any below WCAG AA (4.5:1 for body text, 3:1 for large text).
  Say which fail outright in direct sunlight even if they pass AA.
- Layouts that break when system text size is enlarged, or that rely on a fixed height.
- Screen-reader and keyboard access: unlabelled controls, icon-only buttons with no
  accessible name, modals that don't trap focus or can't be dismissed, form inputs
  with no associated label, and whether error messages are announced.
- iOS PWA specifics: safe-area insets, sticky positioning, keyboard-covers-input,
  and anything that behaves differently when launched from the Home Screen.
- Novice-facing language: jargon, or an error message that tells the user what went
  wrong technically rather than what to do next.
- Inconsistency between screens in spacing, button placement or terminology.
- Destructive actions: is deleting a garden or an account clear about exactly what
  is lost, and is it reversible or clearly flagged as not?

Report findings and suggested improvements. Do not implement anything.
```

**Model & effort:** Opus, high. **Cadence:** every other month (even months).

---

### 4.6 Test coverage and scenario review

**Purpose:** there are already ~1,900 lines of SQL tests. The gap is the frontend.

```
Review test coverage for "What Gardening Today?" and generate the scenarios that are
missing.

First read docs/OVERNIGHT_REVIEWS.md in the repo and follow its standing rules in
full. Review name: test-coverage-review.

Start by reading what already exists — db/01_constraints_test.sql,
db/02_rls_test.sql, db/03_functions_test.sql, db/11_entitlement_test.sql,
db/12_account_deletion_test.sql, db/13_gardens_test.sql — and summarise in a short
table what each one actually proves. Do not propose a scenario that is already
covered; say so instead.

Then identify the gaps. Note up front that the frontend has no tests at all, so
almost everything in app.js is a gap by definition — prioritise ruthlessly rather
than listing everything.

Generate scenarios for the failure modes that matter, including:
- No network, and network lost mid-action (part-way through adding an item,
  completing a task, or creating a garden).
- The today function timing out, returning an error, or returning weather
  unavailable. SPEC §5C says tasks must still appear, unfiltered.
- postcodes.io unavailable or returning an unexpected shape; geolocation permission
  denied or ignored.
- Session expiring while the app is open, and returning to a backgrounded PWA days
  later.
- A garden with zero items; a user with zero gardens; the last remaining garden
  being deleted; the 200-item guard being hit.
- A blueprint retired while it is still in somebody's garden.
- Timezone and date arithmetic across the BST/GMT boundary and around midnight —
  this is the bug class SPEC says the garden timezone exists to close.
- A stale service-worker cache serving old frontend files after a deploy.
- Two members of one garden acting at the same time.
- A month in which an item legitimately has no tasks — an empty Today screen that
  is correct rather than broken.

For each: preconditions, action, expected behaviour per SPEC §5C's fail-gracefully
rule, and whether it is realistically automatable or has to be checked by hand.
Write the by-hand ones as steps a non-developer could follow.

Report scenarios only. Automate nothing.
```

**Model & effort:** Opus, medium. **Cadence:** every other month (even months).

---

### 4.7 Premortem and assumption challenge

**Purpose:** kept, but genuinely quarterly. `WGT_STRATEGY.md` §6 is already a good
premortem, so this has to be told not to redo it.

```
Challenge the assumptions behind "What Gardening Today?".

First read docs/OVERNIGHT_REVIEWS.md in the repo and follow its standing rules in
full. Review name: premortem.

Read WGT_STRATEGY.md in the project, then SPEC.md §1 and §6 from the repo.

Important: §6 of the strategy document already records a dozen options considered and
rejected, with reasons. Do not re-litigate those unless you can argue that a specific
rejection has gone stale, in which case say precisely what has changed to make it so.
Your value here is in what §6 does not already contain.

Two framings.

1. Premortem. It is three years from now and the project has failed to reach even its
   own stated good outcome — covering its costs and buying a decent meal. Working
   backwards, explain precisely why. Be specific about which assumption broke first.
   The strategy names seasonal pages as the one growth mechanism that compounds;
   assume they were built, and explain the failure anyway.

2. Argue against the decisions the project has actually committed to, giving the
   strongest honest case against each:
   - The PWA-only delivery, and the deferral of the App Store question.
   - Supabase free tier with no automated backups, for real users' data.
   - Vanilla JS with no framework and no frontend tests, at 2,300 lines and growing.
   - The never-gate-advice principle, which forecloses most viable monetisation.
   - The task matrix as "the genuine asset" — is it, and would anyone pay for it?
   - Invite-only as a deliberate state rather than a temporary one.

Be direct, not diplomatic. This is exploratory: present the argument, don't recommend
a direction.
```

**Model & effort:** Opus, high. **Cadence:** quarterly.

---

## 5. Reviews held ready for the content pipeline

These cannot run today — the files aren't in the repo. Keep them here for whenever they
are.

**A hard boundary first.** The three content review programmes — editorial, timing and
interaction — are deliberately human-judged, with packets assembled by script and
nothing reaching the task matrix that hasn't been ticked by hand. Overnight AI reviews
must not cross into that. `DATABASE_WORKFLOW.md` explicitly warns against authoring and
checking in the same session, and an unattended reviewer with opinions about pruning
windows is precisely the failure that warning describes. **These two prompts review the
pipeline's *code*, never its content.**

### 5.1 Content pipeline code review

```
Do a code review of the "What Gardening Today?" Apps Script content pipeline.

First read docs/OVERNIGHT_REVIEWS.md in the repo and follow its standing rules in
full. Review name: pipeline-code-review.

Scope: apps-script/Audit.gs, Review.gs, TimingReview.gs, InteractionReview.gs,
Publish.gs. Read docs/DATABASE_WORKFLOW.md first — it is the specification these
files implement.

You are reviewing code, not horticultural content. Do not evaluate any gardening
task, month, instruction or plant. If you notice something about the content itself,
note it in one line at the end and move on.

Check:
- The shared applier. DATABASE_WORKFLOW §7e lists what it refuses (instructions under
  80 characters, named chemical actives, semicolons in free text, malformed
  Valid_Months, non-positive Frequency_Days, a Target_Asset_ID that is not a blueprint
  prefix or declared collection, two ticked rows changing the same cell, changes to a
  retired row). Confirm each refusal is actually implemented, and that staging is
  complete before anything is written — a refusal on row forty must not leave rows one
  to thirty-nine applied.
- Mode isolation. Each mode declares its decisions tab, marker column, permitted
  fields and accepted verdicts. Confirm the timing mode genuinely cannot write outside
  Valid_Months and Frequency_Days, and that no mode can write a field it hasn't
  declared.
- Publish.gs reconciliation. CHANGELOG records a fault where reconcileById_ deleted
  junction rows before inserting their replacements, leaving seven tasks untargeted
  when an insert failed. Confirm whether that ordering has been reversed. If not, say
  what the current exposure is.
- Retirement by retired_at tombstone, never deletion of a row a completion might
  reference.
- The orphan simulation: does it correctly identify blueprints left with no live task
  when a run of retirements is simulated together rather than one at a time?
- Credential handling. Whatever key Publish.gs uses to write to Postgres — where it
  is stored, whether it could be read by anyone with view access to the sheet, and
  what it could do if it leaked.
- Error handling: a partially-failed publish, a missing tab, a renamed column, an
  Apps Script execution timeout mid-run.

Report findings only.
```

**Model & effort:** Opus, high. **Cadence:** whenever the pipeline has changed.

### 5.2 Fault-pattern sweep (advanced, optional)

```
Look for repeated fault shapes across the review programmes of "What Gardening
Today?".

First read docs/OVERNIGHT_REVIEWS.md and follow its standing rules. Review name:
fault-pattern-sweep.

Read Review_Log in the workbook — the permanent record of every change all three
review programmes have made, and the only place a "before" value survives.

You are looking for patterns, not individual faults, and you are producing candidates
for a human pass, never conclusions. The timing review exists because faults of one
shape crossed pass boundaries: sixteen "prune after flowering" tasks whose windows
opened while the plant was still flowering, six Chelsea chop tasks all three weeks
early, an autumn lawn chain of six steps all arriving the same morning. The question
here is whether a *new* shape of that kind is visible in what the reviews have
already corrected.

Output at most five candidate patterns. For each: the shape, the rows that suggest
it, how many further rows might share it, and which existing programme (editorial,
timing or interaction) is the right one to run against it.

Propose no edits, tick no decisions, and write nothing to any tab.
```

**Model & effort:** Opus, high. **Cadence:** twice a year at most.

---

## 6. Scheduling

### Yes — Claude's Scheduled Tasks will do this

Each firing starts a fresh session in this cloud environment. It gets the same tools
this session has, including bash and a network connection, so it can clone the repo,
read it, write a report, deliver the file and push a notification to your phone. Nothing
about the design above requires you to be awake.

Four things worth knowing before you commit:

- **Every firing starts cold.** The prompt has to be completely standalone, which is
  why each one above repeats its scope and points at the standing rules rather than
  assuming context. It's also why the decisions ledger in §7 matters so much.
- **Cron is UTC and doesn't shift with BST.** 01:00 UTC is 02:00 in summer and 01:00 in
  winter. Both are overnight, so it doesn't matter here — but don't set a time close to
  an hour you care about.
- **A gotcha worth avoiding.** In standard cron, when both day-of-month and day-of-week
  are restricted, they are combined with OR, not AND. `0 1 2-8 * 2` does *not* mean
  "the first Tuesday" — it means "every day from the 2nd to the 8th, **and** every
  Tuesday", which is eight times more runs than you wanted. The schedule below uses
  fixed dates only, which sidesteps it entirely.
- **Cost.** These run against your Claude subscription usage, not the API rates in
  `WGT_STRATEGY.md` §9. That table is for the content-review packets and still applies
  to those; it doesn't apply to these.

### What a cron expression is

Cron is the scheduling notation Unix has used since the 1970s, and scheduled tasks inherit
it. An expression is **five numbers separated by spaces**, and each position means a fixed
thing. Position matters entirely — there are no labels.

```
   ┌───────────── minute        (0–59)
   │   ┌───────────── hour      (0–23, 24-hour clock)
   │   │   ┌───────────── day of the month  (1–31)
   │   │   │   ┌───────────── month         (1–12)
   │   │   │   │   ┌───────────── day of the week (0–6, 0 = Sunday)
   │   │   │   │   │
   0   1   8   *   *
```

Read that one right to left: any weekday, any month, the 8th day, the 1st hour, minute
zero. So: **01:00 on the 8th of every month.**

Four symbols do all the work:

| Symbol | Meaning | Example |
|---|---|---|
| `*` | every value — "don't care" | `*` in the month field = every month |
| `,` | a list | `1,3,5` in the month field = January, March, May |
| `-` | a range | `2-6` in the weekday field = Tuesday to Saturday |
| `/` | a step | `*/4` in the hour field = every 4 hours |

A worked example from the table below: `0 1 3 1,3,5,7,9,11 *` is minute 0, hour 1, day 3,
months January/March/May/July/September/November, any weekday — **01:00 on the 3rd of
every other month.**

Two things that catch people out:

- **The times are UTC**, always, and they do not shift for British Summer Time. `0 1` is
  02:00 in summer and 01:00 in winter. Both are the middle of the night, so it doesn't
  matter here — but don't set a cron near an hour you actually care about.
- **Restricting both day-of-month and day-of-week ORs them, it doesn't AND them.**
  `0 1 2-8 * 2` is not "the first Tuesday" — it is "every day from the 2nd to the 8th,
  *and* every Tuesday", which is eight times more runs than intended. Every schedule below
  leaves the weekday field as `*` for exactly this reason.

### Recommended schedule

Staggered across the month so no two land on the same night, tiered by how fast the
thing being reviewed actually changes, and with every review getting at least a month
off between runs.

| Night | Review | Cron (UTC) | Frequency |
|---|---|---|---|
| 3rd | Security and access control | `0 1 3 1,3,5,7,9,11 *` | odd months |
| 8th | Frontend code review | `0 1 8 * *` | monthly |
| 13th | Documentation drift | `0 1 13 * *` | monthly |
| 15th | Premortem | `0 1 15 2,5,8,11 *` | quarterly |
| 18th | Architecture and scaling | `0 1 18 1,3,5,7,9,11 *` | odd months |
| 23rd | UI, UX and accessibility | `0 1 23 2,4,6,8,10,12 *` | even months |
| 28th | Test coverage | `0 1 28 2,4,6,8,10,12 *` | even months |

That works out at four runs in most months, roughly five nights apart, with a report
waiting each time you look. Turn on both push and email notification so the summary
reaches you at breakfast whether or not you open the app.

**Why not weekly.** The repo moved from v2.2 to v2.12 in about a month, but it moves in
bursts, and a review of unchanged code produces the same list twice. The "stop early if
the version hasn't changed" rule in the standing preamble handles that automatically —
you'll get a one-line "nothing has changed since v2.12" rather than a recycled report —
but there's no point spending the run at all if you know the answer.

**The break you asked for.** Cron can't express "six weeks off" cleanly. Two ways to get
one: narrow the month lists (dropping `12,1` from every schedule gives a genuine
December–January quiet period), or simply disable the tasks when you want a rest and
re-enable them later — the schedule is preserved, and nothing fires while they're off.
The second is better, because you'll know when you want the break and cron won't.

**Sequencing suggestion for the first month.** Run the security review and the
documentation drift check first. Security because it's the highest value and the least
likely thing you'd catch by eye; drift because it's the one you can act on immediately
and it'll tell you quickly whether the format is producing anything useful.

**On model choice.** These will run on whatever model this environment is configured
with, rather than picking up a per-review choice the way pasting a prompt by hand does.
The model can be set per scheduled task if you want the cheaper reviews on Sonnet —
worth doing for documentation drift and test coverage, which are more mechanical. Say
the word and I'll set it when we create them.

---

## 7. What will go wrong, and the fix for each

Six known failure modes, in rough order of how much damage they do.

**1. The same findings, every month, forever.** The worst one, and the reason most
recurring-review setups get quietly ignored by month three. A fresh session has no idea
you read a finding in September and decided not to act on it, so it reports it again in
October with the same confidence.

*Fix:* keep `docs/REVIEW_DECISIONS.md` **in the repo**, listing findings you've considered
and dismissed, one line each with the reason. Rule 3 of the standing preamble makes every
review read it first, and keeping it in the repo means it arrives with the clone — the one
channel every review is guaranteed to have. It takes two minutes to maintain and it is the
difference between a programme you keep and one you abandon.

*The trap inside the fix:* a single ledger table conflates "I disagreed" with "I agreed
but haven't done it yet", and suppressing the second kind is how a real backlog disappears
— those are precisely the items most likely to be forgotten. Hence the two tables. Closed
findings are silenced outright; accepted-but-outstanding ones are demoted to a one-line
standing list at the foot of each report, visible but not competing with new findings.

**2. Confident invention.** An unattended reviewer with nobody to push back on it will
produce findings that read perfectly and refer to code that isn't there. This gets worse,
not better, with a more capable model and a longer thinking budget.

*Fix:* rule 4 — quote the lines, then re-read each finding against the file before
writing it up. Not a guarantee, but it removes most of them, and it makes the survivors
quick to check.

**3. Enterprise-grade noise.** Ask a capable model to review a hobby app and it will
find real problems that don't matter: no CI, no monitoring, no rate limiting, secrets
that should be in a vault. All true. None of it worth an evening.

*Fix:* rule 7 sets the standard explicitly. Expect to tune the wording after the first
couple of runs.

**4. A permission prompt at 01:00.** Tested and real: `WebFetch` on GitHub asked for
approval, and with nobody to grant it the run stalls. Any tool needing consent will do
the same.

*Fix:* clone, don't fetch. Every prompt above does. If you add a review of your own,
keep it to bash, file reads and the clone.

**5. Reviewing a moving target.** If you push while a review is running, its findings
refer to a commit that no longer exists.

*Fix:* mostly self-solving at 01:00. Rule 8 requires the report to name the version
reviewed, so you can always tell.

**6. Reports piling up unread.** Four a month, each up to ten findings, is forty items a
month arriving whether or not you have time.

*Fix:* the ten-finding cap, and the executive summary first — if the summary says
nothing serious, that's a legitimate place to stop reading. Better to have four short
reports you read than one exhaustive one you don't.

---

## Recommended next steps

1. Decide on `docs/OVERNIGHT_REVIEWS.md` in the repo versus inlining the preamble into
   each task. The repo file is better and it's a genuine documentation addition rather
   than scaffolding.
2. Commit `docs/REVIEW_DECISIONS.md` to the repo, empty apart from its headings. It costs
   nothing now and it's the thing that keeps this useful in six months.
3. Set up **one** task first — the security review — with a one-off run tonight, and
   read what comes back before creating the other five. The prompts above are a design,
   not a tested artefact, and one real overnight run will teach you more about the
   wording than any amount of further discussion.
4. Consider getting the five `.gs` files into the repo. It unlocks §5, but the better
   reason is that the pipeline is currently the only part of the system with no version
   history at all.
```
