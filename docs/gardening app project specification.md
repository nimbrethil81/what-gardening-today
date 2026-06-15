# Project Specification: "What Gardening Today?" (MVP)

## 1. VISION & STRATEGY
The "What Gardening Today?" app eliminates cognitive overload and decision paralysis for enthusiastic novice gardeners. Instead of navigating complex canvas designers, tracking layouts, or reading encyclopedias, the entire application behavior is driven by a single core interface interaction: tapping a button to answer, "What gardening should I do today?"

### Core Principles:
* **Action-Oriented:** Delivers immediate, hyper-localized, and time-appropriate tasks.
* **Novice-Friendly:** Strips away technical botanical jargon in favor of bite-sized, actionable guidance.
* **Zero-Maintenance Infrastructure:** Built with a fully decoupled, open web architecture that costs $0 to run and avoids platform lock-in.

---

## 2. COMPONENT ARCHITECTURE & LIVE CONFIGURATION
The system is built as a highly responsive Progressive Web App (PWA) reading dynamically from a relational database schema structured inside Google Sheets.

* **Data Layer (Google Sheets):** Acts as the relational database containing three primary tables: `User_Profile`, `Master_Task_Matrix`, and `Task_Log`.
* **API Gateway (Google Apps Script Web App):** Listens for client GET/POST requests, filters data relationships, and returns clean RESTful JSON payloads.
* **Frontend Interface (GitHub Pages Static Host):** Vanilla HTML5, CSS3, and JavaScript configured with a Service Worker and Web App Manifest to run as a standalone iOS/Android PWA.

---

## 3. RELATIONAL DATABASE SCHEMA (GOOGLE SHEETS)

### Tab 1: `User_Profile`
Defines the physical features, assets, or plants currently present in the user's specific garden.
* **Asset_ID (Primary Key):** Unique uppercase identifier (e.g., `LAWN`, `BED_RAISED`, `VEG_TOMATO`).
* **Category:** Broad grouping for UI formatting (e.g., Lawn, Beds, Structures, Veg).
* **Friendly_Name:** Human-readable name displayed on screen (e.g., "Front Lawn").
* **Is_Active:** Checkbox (TRUE/FALSE) to toggle whether this asset should generate tasks.

### Tab 2: `Master_Task_Matrix`
The global engine containing the rules and care instructions for all supported garden assets.
* **Task_ID (Primary Key):** Unique identifier (e.g., `TASK_0001`).
* **Target_Asset_ID (Foreign Key):** Matches the base category or item blueprint from `User_Profile`. Supports hierarchical matching (e.g., a task targeting `VEG` will apply to `VEG_TOMATO`).
* **Task_Name:** Brief title of the activity (e.g., "Spring Mowing").
* **Category:** Matches the asset category.
* **Instruction:** Detailed, step-by-step novice-friendly guidance.
* **Valid_Months:** Comma-separated string or number array defining when the task can occur (e.g., `3,4,5`).
* **Frequency_Days:** Cooldown period before the task can reappear (e.g., `7` for weekly, `365` for annual).

### Tab 3: `Task_Log`
Appends a historical record every time a user checks off a task card.
* **Log_ID:** Auto-generated unique row ID.
* **Timestamp:** Date and time of completion.
* **Task_ID:** References the completed `Master_Task_Matrix` row.
* **Notes:** Default tracking string sent via client payload.

---

## 4. WAYS OF WORKING & ARCHITECTURAL PRINCIPLES

### A. Data Architecture & Future-Proofing
* **Blueprints, Not Instances:** The master database must only contain generic, universally applicable data (e.g., a dictionary of plant types, general tasks). User-specific data (e.g., "My Front Lawn", specific user schedules) must live entirely separately in the user profile state.
* **Scalable Structures First:** Before adding new properties to a JSON object or columns to a database, the structure must be evaluated for scale. Avoid hardcoding specific IDs where a broader category allows for future flexibility without restructuring.
* **Single Source of Truth:** Data must not be duplicated across different files or sheets. If the frontend needs to know a plant's water requirements, it references the master dictionary rather than storing a local copy of that value.

### B. Separation of Concerns (The Tech Stack)
* **Database (Google Sheets/JSON):** Strictly passive storage. It holds raw data and does not perform calculations or formatting.
* **API/Middleware (Apps Script):** Strictly handles data retrieval, logical filtering (such as hierarchical matching and date calculations), and routing between the database and frontend.
* **Frontend (GitHub Pages PWA):** Strictly handles state management, user interface logic, and view rendering. UI design elements (colors, text formatting) should never be passed down from the database layers.

### C. Development & Error Handling
* **Fail Gracefully:** If an external resource fails to load (e.g., a network error fetching the item dictionary), the app must not crash. It should disable the affected UI elements and display a clear, user-friendly error message.
* **Iterative Commits:** Code changes to GitHub should represent single, testable features or fixes, making it easier to roll back if a new addition breaks existing logic.

### D. AI Collaboration & Prompting Workflow
* **Phase-Based Chats:** Major project milestones or architectural shifts dictate a fresh chat environment to keep context sharp.
* **Context Loading:** A fresh chat must always begin with the latest `specification.md`, `app.js`, and `index.html` uploaded as files to establish the baseline.
* **Targeted Troubleshooting:** During active development, errors or function rewrites should be handled using short, specific code snippets in the chat prompt rather than full file re-uploads.
* **Precise Code Placement:** When providing updates or modifications to code files, instructions *must* include exact, literal placement anchors (e.g., *"Insert this block directly after `const API_URL = ...` and before `function fetchTasks()`"*). Avoid ambiguous placement advice.

---

## 5. DEVELOPMENT ROADMAP

* **Phase 1 (COMPLETE):** Operational single-button PWA. Logic matches current-month strings on the Google Sheets backend and returns basic daily tasks.
* **Phase 2 (COMPLETE):** Stateful Interactivity. Checkboxes added to UI cards. Checking a box updates `Task_Log` via a POST request. Processing engine calculates `Date_Completed + Frequency_Days` to successfully suppress completed tasks for their cooldown window. Added the "My Garden" tab UI with hierarchical asset matching.
* **Phase 3 (NEXT STEP - Environmental Integration):** Client-side HTML5 Geolocation parsing combined with external real-time weather API hooks (e.g., OpenWeatherMap free tier). Allows conditional rules: automatically hiding "Watering" tasks if regional rain totals exceed thresholds in the past 24 hours, or serving "Wind Protection" alerts when gale-force thresholds are breached.
* **Phase 4 (Cross-Platform Scale):** Exporting schemas via CSV datasets to an open-source hosted cloud database instance (e.g., Supabase PostgreSQL tier). Translating logic blueprints into cross-platform native frameworks.
