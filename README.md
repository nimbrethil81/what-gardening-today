# 🌿 What Gardening Today?

A minimalist, zero-cost progressive web app (PWA) designed to eliminate beginner gardening decision paralysis by serving up a single, localized, actionable maintenance checklist — filtered by the weather, for the plants and structures you actually own.

## 🚀 Live Application
Access the app on your mobile device here:
👉 **[https://nimbrethil81.github.io/what-gardening-today/](https://nimbrethil81.github.io/what-gardening-today/)**

Access is by invitation — sign in with the email address that's been added as a user. See **Data Maintenance** below for how a new email is added.

### 📱 iOS Home Screen Installation
1. Open the link above in **Safari** on your iPhone.
2. Tap the **Share** button (up-arrow icon) in the bottom toolbar.
3. Scroll down and select **Add to Home Screen**.
4. Open the app from your home screen to experience it as a native, borderless utility.

---

## 🛠️ Architecture & Technical Stack

*   **Frontend:** HTML5, Vanilla JavaScript, CSS3 (hosted free on GitHub Pages)
*   **PWA Layer:** Service Worker (`sw.js`) offline caching + Web App Manifest (`manifest.json`)
*   **Database:** Supabase (PostgreSQL), with Row-Level Security governing per-garden access
*   **Daily view:** a Supabase Edge Function (`today`) returns the day's weather and filtered tasks in one call, keeping the weather API key server-side
*   **Authentication:** Supabase Auth — passwordless email sign-in (a one-time code and/or a magic link); public sign-up is disabled, so an account only exists once its email has been added by the project owner

This is the **v2.0** architecture. Full detail — the schema, the access model, and the reasoning behind it — lives in [`SPEC.md`](./SPEC.md), which is the authoritative reference. [`CHANGELOG.md`](./CHANGELOG.md) records what changed and when, including the migration from the original Google Sheets / Apps Script build.

---

## 📊 Data Maintenance

The horticultural content (the item catalogue and the task rules) is still authored in a Google Sheet — that hasn't changed — but the Sheet is no longer the live database. Edits are **published** into Supabase rather than read directly by the app:

1. Edit the tracking workbook as usual — add or retire catalogue items, adjust task rules, calendar-month flags, and instructions.
2. Run **Garden Data → Run Audit** (via the Apps Script menu) to check the edit is structurally sound before publishing.
3. Run **Publish** to push the audited content into the live database.

The full authoring workflow, prompts, and a verification checklist are in [`docs/DATABASE_WORKFLOW.md`](./docs/DATABASE_WORKFLOW.md).

Adding a new person's access (rather than new content) is a separate, simpler step done directly in the Supabase dashboard — see `SPEC.md` §2 for how sign-in and access control work.

---

## 🗺️ Engineering Roadmap

- [x] **Phase 1:** Zero-cost Jamstack engine & PWA delivery.
- [x] **Phase 2:** Interactivity & stateful memory (persistent task-completion logging).
- [x] **Phase 2.1:** Item inventory ("My Garden").
- [x] **Phase 3:** Environmental integration (weather-filtered tasks via a secure proxy).
- [x] **Phase 3.1:** Task dismissal (swipe-to-hide, with undo and a restore screen).
- [x] **Phase 4:** Migration to Supabase (PostgreSQL) — schema, Row-Level Security, email authentication, and the live cutover (2026-07-17).

The next items under consideration — custom email so friends can be invited, a garden switcher for genuine multi-user use, and surfacing task time estimates in the UI — are tracked in `SPEC.md` §6.
