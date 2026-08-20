# Review decisions — What Gardening Today?

**What the overnight reviews have already raised and what was decided about it.** Every
review reads this file before it starts (standing rule 3 in `docs/OVERNIGHT_REVIEWS.md`)
and treats each table below differently.

This file exists because each overnight review runs in a fresh session with no memory of
any previous one. Without it, a finding dismissed in September is raised again in October,
in November and in December, with undiminished confidence — and the reports become
something to skim rather than read. Two minutes of maintenance a month is what stops that.

It lives in the repository rather than in the project so that it arrives with the clone.
A review that can read the code can always read this.

---

## The two tables, and why they are different

There are two quite different reasons a finding doesn't need reporting again, and they
need opposite handling.

**Closed** means *you disagreed, or decided it isn't worth doing.* Nothing further will
happen. A review should never mention it again — that is the whole point.

**Accepted, still outstanding** means *you agreed, and you haven't done it yet.* These
must not be reported as fresh findings, because you already know — but they must not
vanish either, because they are exactly the things most likely to be quietly forgotten.
Reviews list them in a short standing section at the end of the report, with no argument
and no re-analysis, so they stay visible until you close them out.

Getting this wrong in either direction is what kills a review programme. Suppress the
accepted ones entirely and your real backlog disappears. Leave them un-suppressed and
every report opens with three findings you already agreed with two months ago.

---

## How to add an entry

After reading a report, put each finding you are **not acting on right now** into one of
the two tables. Do it in the same sitting as reading the report, or it won't happen.

- **Finding** — enough to recognise it. The reviewer matches on meaning, not wording, so
  it doesn't have to be verbatim.
- **Raised by** — which review, so a security finding isn't suppressed for the UX pass.
- **Reason** — the important column. Six months from now the reason is the only part that
  still carries information, and it's what stops the decision being reopened by someone
  who has forgotten it. Write it for a stranger.
- **Date** — when you decided.

Findings you fix straight away don't belong in either table. They vanish on their own when
the code changes, and listing them would suppress a genuine regression later.

---

## Table 1 — Closed

Considered and deliberately not being done. **Reviews must not raise these again.**

Decision values: `Won't fix`, `Accepted risk`, `Not a bug`.

| Finding | Raised by | Decision | Reason | Date |
|---|---|---|---|---|
| _(none yet)_ | | | | |

---

## Table 2 — Accepted, still outstanding

Agreed, intended, not done yet. **Reviews must not raise these as new findings, but must
list them at the end of the report under "Already accepted and outstanding", one line
each, with the date they were accepted — no re-analysis and no argument.**

Move a row out of this table when you do the work (delete it) or when you change your mind
(move it to Table 1 with the reason you changed it).

| Finding | Raised by | Intent | Accepted on |
|---|---|---|---|
| _(none yet)_ | | | |

**A row that has sat here for a year is really a `Won't fix`.** Move it to Table 1 and
write down why, or do it. An "outstanding" list that only grows stops being read as
quickly as a report that only repeats itself.

---

## Standing context the reviews should not re-litigate

Not findings, but decisions taken deliberately that a reviewer will otherwise raise every
time. Kept separate from the tables above because these predate the review programme and
have their reasoning recorded elsewhere. Treat as Table 1 — do not raise.

| Thing | Why it is the way it is |
|---|---|
| No automated database backups | Free-tier Supabase, five invited friends who can text me. `WGT_STRATEGY.md` §7 makes moving to Pro a condition of opening to strangers, not of today. |
| No CI, no automated frontend tests | Solo hobby project deployed by `git push`. Worth raising only with a specific, cheap, concrete proposal. |
| Vanilla JS, no framework, no build step | Deliberate, recorded in `SPEC.md`. "Consider React" is not a finding. |
| `config.js` committed with the Supabase URL and anon key | The anon key is public by design and governed by Row-Level Security; every visitor's browser receives it. Only the `service_role` key would be a real finding. |
| Public sign-up disabled, accounts added by hand | Deliberate (`docs/CONFIG_ITEMS.md` #3a). The provisioning bottleneck is known and is the subject of `WGT_STRATEGY.md` §2. |
| Apps Script content pipeline absent from the repo | Known gap, being addressed separately. Noting it once per report is fine; it does not need to be a finding. |
| Retired content is tombstoned, never deleted | Deliberate, so a completion can still reference it. Not a data-hygiene problem. |
| Single 2,300-line `app.js` | Known. Worth raising only with a specific split proposal, not as a general observation about file length. |

Add to this table whenever a review spends findings on something you settled long ago.
