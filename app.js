/* ==========================================================================
 *  What Gardening Today? — frontend (v2.1)
 *
 *  Talks to Supabase, not the old Apps Script. The daily view goes through the
 *  `today` Edge Function (weather + tasks in one call); everything else is a
 *  direct, Row-Level-Security-governed read or write via supabase-js.
 *
 *  On open, a small gate decides what to show:
 *    - not signed in            -> the sign-in screen
 *    - signed in, no garden yet -> the garden form, in first-run mode
 *    - signed in, has gardens   -> the app (Today, My Garden), showing the
 *                                  garden you were last in
 *
 *  MULTIPLE GARDENS. A user may belong to any number of gardens (garden_member
 *  has always been many-to-many); the header names the one you are looking at
 *  and switches between them. Everything per-garden — tasks, weather,
 *  inventory, hidden tasks, completion history — is keyed on garden_id in the
 *  database, so switching is a matter of changing currentGardenId and
 *  re-fetching. What it is NOT a matter of is leaving stale state on screen:
 *  see resetPerGardenUiState(), and the in-flight guards in loadToday() and
 *  loadInventory().
 * ========================================================================== */

/* ---- Supabase connection -------------------------------------------------
 * The project URL and anon key live in config.js (loaded before this file),
 * NOT here — so that editing app.js can never wipe your credentials again.
 * Copy config.example.js to config.js and fill in your values (from the
 * Supabase dashboard: Project Settings -> API). The anon key is safe to commit
 * — it is public by design and governed by Row Level Security. The service_role
 * key must never appear in any frontend file.
 */
const APP_CONFIG = window.APP_CONFIG || {};
const SUPABASE_URL = APP_CONFIG.SUPABASE_URL;
const SUPABASE_ANON_KEY = APP_CONFIG.SUPABASE_ANON_KEY;

const configLooksValid =
  typeof SUPABASE_URL === "string" &&
  SUPABASE_URL.indexOf("supabase.co") !== -1 &&
  SUPABASE_URL.indexOf("YOUR-PROJECT-REF") === -1 &&
  typeof SUPABASE_ANON_KEY === "string" &&
  SUPABASE_ANON_KEY.length > 20 &&
  SUPABASE_ANON_KEY.indexOf("YOUR-ANON") === -1;

const { createClient } = window.supabase;
const sb = configLooksValid ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

/* Sent with every piece of feedback, so a bug report says which build it came
 * from. It must match CACHE_NAME in sw.js, and both must be bumped in the same
 * commit — a report labelled with a version that was never deployed is worse
 * than no label at all. */
const APP_VERSION = "gardening-v17";

/* ---- Small helpers ------------------------------------------------------- */

// Makes a user-supplied string safe to drop into innerHTML. A garden called
// "Mum & Dad's" would otherwise render wrongly, and anything sharper than an
// ampersand would render as markup. Garden names are now shown in three places
// (header, switcher, settings), so this matters more than it used to.
function escapeHtml(s) {
  return String(s === null || s === undefined ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// "1 item" / "3 items" — used in the delete confirmation, where saying
// "1 items" would undercut the seriousness of the sentence it sits in.
function plural(n, one, many) {
  return n + " " + (n === 1 ? one : many);
}

// The UK, generously boxed: Shetland at the top, Northern Ireland at the left,
// East Anglia at the right.
//
// THIS IS A PRE-FILTER, NOT THE TEST. See checkUkLocation() for why a rectangle
// on its own is not good enough. Used alone it would accept Dublin.
function isInUK(lat, lon) {
  return lat >= 49.8 && lat <= 60.9 && lon >= -8.7 && lon <= 1.8;
}


/* ---- App state ---------------------------------------------------------- */
let currentGardenId = null;
let currentUserId = null;
let gardens = [];                  // [{id, name, latitude, longitude, timezone,
                                   //   created_at, role, otherMembers}] oldest first
let routedUserId = undefined;      // guards against redundant re-routing on focus

// Picker catalogue. One entry per (blueprint, category) pair, so a blueprint
// listed under two tiles appears twice — which is correct: the tile it is added
// under decides how it is grouped in My Garden.
//   {Category, Suggested_Name, blueprint_id, browseGroup, browseSort, botanical}
// browseGroup is null for anything the workbook has not assigned a heading to;
// those are shown under "Other" at the bottom rather than being hidden.
// The catalogue is GLOBAL and entitlement is per USER, so it survives a garden
// switch untouched and is only ever loaded once.
let globalDictionary = [];
let userInventory = [];            // {item_id, friendly_name, category, blueprint_name}
let inventoryLoadedFor = null;     // which garden userInventory actually describes
let selectedCategoryRef = null;
let selectedSubItemObj = null;

// Sort key used for blueprints with no browse group, so "Other" always lands at
// the bottom regardless of what Sort_Order values the workbook uses.
const UNGROUPED_SORT = 32000;
const UNGROUPED_LABEL = "Other";

// Location captured on the garden form
let setupLat = null;
let setupLon = null;

// Which job the garden form is doing: "first-run" | "add" | "edit"
let gardenFormMode = "first-run";
let editingGardenId = null;

// Which way out of a garden the confirmation panel is asking about
let gardenDangerMode = "delete";   // "delete" | "leave"

// May this person start another garden? The database owns this rule
// (may_create_garden, db/14) and is the only thing that enforces it — app.js
// and config.js are public files served with a published key, so this copy is
// PRESENTATION, deciding what the button does rather than whether it may.
// Defaults to true so that a failed read offers the button and lets the server
// refuse: fail open in the browser, closed in the database.
let mayCreateGarden = true;

// Set while recovering from a garden the server says we can no longer see, so
// a persistent 403 cannot spin route() and loadToday() against each other.
let missingGardenRecovery = false;

// Display order for inventory category groups (mirrors the picker tiles)
const CATEGORY_ORDER = [
  "Lawn", "Beds", "Trees & shrubs", "Plants & flowers",
  "Veg & herbs", "Garden structures", "Tools"
];

// --- HIDE-THIS-TASK STATE ---
const HIDE_REVEAL_WIDTH = 76; // px — must match .task-hide-action's width in style.css
let currentlyRevealedWrapper = null;
let dragState = null;
let toastTimeout = null;
let undoToastTaskId = null;


/* ==========================================================================
 *  WHICH GARDEN OPENS BY DEFAULT
 *
 *  The one you were last in. That is the whole rule, and it matches the way
 *  the feature is actually used: you are mostly in your own garden and
 *  occasionally in somebody else's, so the app should stay where you left it
 *  rather than making you re-navigate every morning.
 *
 *  Kept on the device, KEYED BY USER ID, so two people sharing a tablet don't
 *  inherit each other's last garden. Every read is validated against the
 *  gardens you can actually see — a remembered id may point at a garden that
 *  has since been deleted, or one you were removed from, or a leftover from a
 *  different account — and anything unrecognised falls back silently to your
 *  oldest garden. This must never produce an error: it is a convenience, and a
 *  convenience that can break the app is not one.
 *
 *  Every access is wrapped, because localStorage throws rather than returning
 *  null in some private-browsing modes. If storage is unavailable you simply
 *  always get your oldest garden, and everything else works.
 * ========================================================================== */

const LAST_GARDEN_KEY = "wgt.lastGarden";
const REMEMBER_GARDEN_KEY = "wgt.rememberGarden";

// Default ON, which is the behaviour that already existed. Wrapped like every
// other storage access, because localStorage throws in some private modes —
// and a preference that can break the app is not one.
function rememberGardenEnabled() {
  try { return window.localStorage.getItem(REMEMBER_GARDEN_KEY) !== "0"; }
  catch (e) { return true; }
}

function setRememberGarden(on) {
  try {
    window.localStorage.setItem(REMEMBER_GARDEN_KEY, on ? "1" : "0");
    if (!on) window.localStorage.removeItem(LAST_GARDEN_KEY);
    else if (currentUserId && currentGardenId) writeLastGardenId(currentUserId, currentGardenId);
  } catch (e) { /* preference simply won't stick */ }
}

function readLastGardenMap() {
  try {
    const raw = window.localStorage.getItem(LAST_GARDEN_KEY);
    const map = raw ? JSON.parse(raw) : null;
    return (map && typeof map === "object") ? map : {};
  } catch (e) {
    return {};
  }
}

function readLastGardenId(userId) {
  if (!userId) return null;
  return readLastGardenMap()[userId] || null;
}

function writeLastGardenId(userId, gardenId) {
  if (!rememberGardenEnabled()) return;
  if (!userId || !gardenId) return;
  try {
    const map = readLastGardenMap();
    map[userId] = gardenId;
    window.localStorage.setItem(LAST_GARDEN_KEY, JSON.stringify(map));
  } catch (e) {
    /* storage blocked — you'll get your oldest garden instead. Not an error. */
  }
}

function forgetLastGardenId(userId) {
  if (!userId) return;
  try {
    const map = readLastGardenMap();
    delete map[userId];
    window.localStorage.setItem(LAST_GARDEN_KEY, JSON.stringify(map));
  } catch (e) { /* nothing to forget */ }
}


/* ==========================================================================
 *  THE GARDENS YOU BELONG TO
 *
 *  Two reads rather than one join, deliberately. `garden` gives the gardens
 *  themselves in a stable order (oldest first — alphabetical would silently
 *  reshuffle the switcher every time you renamed something). `garden_member`
 *  gives your role in each, AND who else is in them, which is what decides
 *  whether "Delete this garden" is offered, refused, or replaced by "Leave".
 *  RLS returns only gardens you are a member of, from both.
 * ========================================================================== */

async function loadGardens() {
  const [gardenRes, memberRes, gateRes] = await Promise.all([
    sb.from("garden")
      .select("id, name, latitude, longitude, timezone, created_at")
      .order("created_at", { ascending: true }),
    sb.from("garden_member").select("garden_id, user_id, role"),
    sb.rpc("may_create_garden")
  ]);

  if (gardenRes.error) throw gardenRes.error;
  if (memberRes.error) throw memberRes.error;

  // Third in the same round trip, so the switcher never has to wait on it and
  // the answer is refreshed by every path that reloads the list — creating,
  // deleting and leaving all come back through here. NOT thrown on: an error
  // or a null leaves the button offered, and the database refuses if it must.
  mayCreateGarden = gateRes.error ? true : gateRes.data !== false;

  const membership = {};
  (memberRes.data || []).forEach(row => {
    if (!membership[row.garden_id]) membership[row.garden_id] = { role: null, others: 0 };
    if (row.user_id === currentUserId) membership[row.garden_id].role = row.role;
    else membership[row.garden_id].others += 1;
  });

  gardens = (gardenRes.data || []).map(g => {
    const m = membership[g.id] || {};
    return {
      id: g.id,
      name: g.name,
      latitude: g.latitude,
      longitude: g.longitude,
      timezone: g.timezone,
      created_at: g.created_at,
      role: m.role || "member",
      otherMembers: m.others || 0
    };
  });

  return gardens;
}

function currentGarden() {
  return gardens.filter(g => g.id === currentGardenId)[0] || null;
}


/* ==========================================================================
 *  THE GATE: which screen do we show?
 * ========================================================================== */

function showView(which) {
  ["splash", "signin", "setup"].forEach(v => {
    const el = document.getElementById("view-" + v);
    if (el) el.classList.toggle("hidden", v !== which);
  });
  document.getElementById("app-root").classList.toggle("hidden", which !== "app");
}

async function route() {
  showView("splash");
  setSplashMessage("");

  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    currentGardenId = null;
    currentUserId = null;
    gardens = [];
    closeAllModals();
    showSigninDefault();
    showView("signin");
    return;
  }

  currentUserId = session.user.id;

  try {
    await loadGardens();

    // Zero gardens is a real, handled state — it is where every new user
    // starts, and where you land after deleting your last one. No special case.
    if (gardens.length === 0) {
      currentGardenId = null;
      showGardenForm("first-run");
      return;
    }

    // The remembered garden if it still exists and is still yours; the oldest
    // otherwise. NB the old code took .limit(1) with no ORDER BY, which was
    // fine with one garden and non-deterministic the moment there were two.
    const remembered = readLastGardenId(currentUserId);
    const chosen = gardens.filter(g => g.id === remembered)[0] || gardens[0];

    currentGardenId = chosen.id;
    writeLastGardenId(currentUserId, currentGardenId);

    renderGardenHeader();
    showView("app");

    // Global and entitlement-free, so it is fetched once per session and
    // survives every garden switch.
    if (globalDictionary.length === 0) await loadCatalogue();

    loadToday();
    loadInventory();
  } catch (err) {
    console.error("Routing failed:", err);
    setSplashMessage("Something went wrong loading your gardens. Check your connection, then tap Retry.", true);
    showView("splash");
  }
}

function setSplashMessage(text, showRetry) {
  const msg = document.getElementById("splash-message");
  const retry = document.getElementById("splash-retry");
  if (msg) msg.textContent = text || "Loading…";
  if (retry) retry.classList.toggle("hidden", !showRetry);
}


/* ==========================================================================
 *  SIGN IN  (Google, and only Google)
 *
 *  The emailed 6-digit code used to sit behind "Use email instead". It is gone:
 *  one way in is one thing to explain, one thing to test, and one thing that
 *  can go wrong. The sign-in screen says so in as many words, so nobody hunts
 *  for a way in that isn't there.
 * ========================================================================== */

function showSigninDefault() {
  // Nothing to reset but the error line — the screen has one control on it.
  document.getElementById("signin-google-error").textContent = "";
}

async function handleGoogleSignIn() {
  const errEl = document.getElementById("signin-google-error");
  errEl.textContent = "";

  const btn = document.getElementById("signin-google-btn");
  btn.disabled = true;

  try {
    const redirect = window.location.origin + window.location.pathname;
    const { error } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: redirect }
    });
    if (error) throw error;
    // On success the browser navigates away to Google, then back again —
    // onAuthStateChange picks up the returned session and calls route().
  } catch (err) {
    console.error("Google sign-in failed:", err);
    errEl.textContent = "Couldn't start Google sign-in. Check your connection and try again.";
    btn.disabled = false;
  }
}

async function handleSignOut() {
  try { await sb.auth.signOut(); } catch (e) { console.error("Sign out error:", e); }
  closeAllModals();
  // onAuthStateChange (SIGNED_OUT) will route() us back to the sign-in screen.
}


/* ==========================================================================
 *  THE GARDEN SWITCHER
 *
 *  The header shows the current garden's name and opens a bottom sheet listing
 *  every garden you belong to. Two things make this safe rather than merely
 *  compact:
 *
 *    - the name sits directly above the task list at all times, so "which
 *      garden am I ticking things off in?" is answered without looking for it;
 *    - switching visibly clears and reloads that list, which is the signal
 *      that something changed.
 *
 *  The header updates BEFORE the data arrives, from the list we already hold,
 *  so the switch feels immediate rather than waiting on a round trip.
 * ========================================================================== */

function renderGardenHeader() {
  const nameEl = document.getElementById("garden-switch-name");
  const btn = document.getElementById("garden-switch-btn");
  const g = currentGarden();
  if (nameEl) nameEl.textContent = g ? g.name : "Your garden";
  if (btn) {
    btn.setAttribute("aria-label",
      g ? ("Current garden: " + g.name + ". Switch garden") : "Switch garden");
  }
}

function openGardenModal() {
  renderGardenList();
  document.getElementById("garden-modal").classList.remove("hidden");
  const btn = document.getElementById("garden-switch-btn");
  if (btn) btn.setAttribute("aria-expanded", "true");
}

function closeGardenModal() {
  document.getElementById("garden-modal").classList.add("hidden");
  const btn = document.getElementById("garden-switch-btn");
  if (btn) btn.setAttribute("aria-expanded", "false");
}

/* THE EXPLANATION IS PUT AWAY EVERY TIME THE SHEET OPENS, so somebody who met
 * it once, deleted a garden and came back doesn't find yesterday's "no" still
 * sitting there under a button that would now work. */
function resetGardenGateNote() {
  const note = document.getElementById("garden-gate-note");
  if (note) note.classList.add("hidden");
}

function renderGardenList() {
  const listEl = document.getElementById("garden-list");
  listEl.innerHTML = "";
  resetGardenGateNote();

  if (gardens.length === 0) {
    listEl.innerHTML = '<div class="loading-spinner-box">You haven\'t set up a garden yet.</div>';
    return;
  }

  gardens.forEach(g => {
    const isCurrent = g.id === currentGardenId;
    const row = document.createElement("button");
    row.type = "button";
    row.className = "garden-row" + (isCurrent ? " current" : "");
    row.setAttribute("data-garden-id", g.id);
    if (isCurrent) row.setAttribute("aria-current", "true");

    // Only shown when it's true, so the common case stays a plain list of names.
    const shared = g.otherMembers > 0
      ? '<span class="garden-row-meta">Shared with ' +
        plural(g.otherMembers, "other person", "other people") + '</span>'
      : "";

    row.innerHTML =
      '<span class="garden-row-text">' +
        '<span class="garden-row-name">' + escapeHtml(g.name) + '</span>' +
        shared +
      '</span>' +
      '<span class="garden-row-tick" aria-hidden="true">' + (isCurrent ? "✓" : "") + '</span>';

    listEl.appendChild(row);
  });
}

/* WHAT HAPPENS WHEN YOU CANNOT ADD ANOTHER GARDEN.
 *
 * The button stays exactly where it was, looking exactly as it did, and stays
 * tappable. A control that vanishes at the limit — or greys out — is a dead end
 * a novice cannot diagnose: it reads as the app being broken rather than as an
 * answer. So tapping it answers, in place, in the sheet already on screen.
 *
 * Nothing is lost by tapping, because the form never opened and there was
 * nothing typed. There is no upgrade button, because there is nothing to
 * upgrade to yet, and the wording says so rather than implying a shop.
 *
 * Everything else in this sheet still works: the gardens are still listed and
 * still switch. Entitlement grants the right to ADD, never the right to SEE. */
function handleAddGardenClick() {
  if (!mayCreateGarden) {
    const note = document.getElementById("garden-gate-note");
    if (note) note.classList.remove("hidden");
    return;
  }
  closeGardenModal();
  showGardenForm("add");
}

function handleGardenListClick(event) {
  const row = event.target.closest(".garden-row");
  if (!row) return;
  switchGarden(row.getAttribute("data-garden-id"));
}

function switchGarden(gardenId) {
  closeGardenModal();
  if (!gardenId || gardenId === currentGardenId) return;
  if (!gardens.some(g => g.id === gardenId)) return;

  currentGardenId = gardenId;
  writeLastGardenId(currentUserId, gardenId);

  resetPerGardenUiState();
  renderGardenHeader();

  // Land on Today. Switching gardens is nearly always "what needs doing over
  // there?", and it guarantees the task list visibly reloads — which is the
  // thing that stops you ticking a job off in the wrong garden.
  goToTab("today");   // switchTab re-runs loadToday for us
  loadInventory();
}

/* Everything on screen that belonged to the garden we are leaving.
 *
 * The undo toast is the one that actually bites: hide a task in one garden,
 * switch, then tap Undo, and without this the delete would be aimed at the NEW
 * garden using the OLD garden's task id. The rest is tidiness, but tidiness
 * that stops a half-swiped card or a primed "Remove?" button carrying over
 * into a garden it was never meant for. */
function resetPerGardenUiState() {
  hideToast();

  currentlyRevealedWrapper = null;
  dragState = null;

  userInventory = [];
  inventoryLoadedFor = null;
  const inventoryList = document.getElementById("inventory-list");
  if (inventoryList) {
    inventoryList.innerHTML = '<div class="loading-spinner-box">Growing garden...</div>';
  }

  selectedCategoryRef = null;
  selectedSubItemObj = null;
  document.querySelectorAll(".tile-btn").forEach(tile => tile.classList.remove("selected"));
  const custom = document.getElementById("custom-name");
  if (custom) custom.value = "";
  clearPillSearch();
}

/* Called when the server tells us we can no longer see the garden we are in —
 * because it was deleted, or we were removed from it, on another device. The
 * generic "check your connection" message would be both wrong and confusing. */
async function handleGardenGone() {
  const lostName = (currentGarden() || {}).name || "That garden";

  if (missingGardenRecovery) {
    // We already re-routed once and landed on another dead end. Stop rather
    // than bouncing between route() and loadToday() indefinitely.
    const c = document.getElementById("task-container");
    if (c) {
      c.dataset.empty = "false";
      c.innerHTML = '<div class="loading-spinner-box">Couldn\'t open that garden. Close the app and open it again.</div>';
    }
    return;
  }
  missingGardenRecovery = true;

  forgetLastGardenId(currentUserId);
  currentGardenId = null;
  closeAllModals();
  resetPerGardenUiState();

  await route();   // another garden, or the setup screen if that was the last
  showToast(lostName + " is no longer available.", false);
}


/* ==========================================================================
 *  THE GARDEN FORM — first run, adding another, and editing
 *
 *  All three ask for the same two things, so they are the same screen. The
 *  differences are the wording, whether Cancel exists (on the first run there
 *  is nowhere to go back to), and whether Save creates or updates.
 *
 *  Editing covers a real defect as well as a new feature: before this, a
 *  garden's location was set once at creation and could never be corrected, so
 *  a mistyped postcode meant permanently wrong weather — and the weather is
 *  what decides which tasks appear.
 * ========================================================================== */

function showGardenForm(mode, garden) {
  gardenFormMode = mode;
  editingGardenId = (mode === "edit" && garden) ? garden.id : null;

  const title = document.getElementById("setup-title");
  const subtitle = document.getElementById("setup-subtitle");
  const saveBtn = document.getElementById("setup-create-btn");
  const cancelBtn = document.getElementById("setup-cancel-btn");
  const nameInput = document.getElementById("setup-name");
  const confirmEl = document.getElementById("setup-location-confirm");

  document.getElementById("setup-error").textContent = "";
  document.getElementById("setup-postcode").value = "";
  showUkNote(false);
  saveBtn.disabled = true;
  cancelBtn.disabled = false;

  if (mode === "edit" && garden) {
    title.textContent = "Edit garden";
    subtitle.textContent = "Change what it's called, or put it in the right place.";
    saveBtn.textContent = "Save changes";
    nameInput.value = garden.name || "";
    setupLat = (garden.latitude === null || garden.latitude === undefined) ? null : Number(garden.latitude);
    setupLon = (garden.longitude === null || garden.longitude === undefined) ? null : Number(garden.longitude);
    confirmEl.textContent = "📍 Using the location saved for this garden";
    confirmEl.classList.remove("hidden");
    describeSavedLocation(setupLat, setupLon);
  } else if (mode === "add") {
    title.textContent = "Add a garden";
    subtitle.textContent = "A name and a location, and you can switch to it whenever you like.";
    saveBtn.textContent = "Create garden";
    nameInput.value = "";
    setupLat = null; setupLon = null;
    confirmEl.classList.add("hidden");
  } else {
    title.textContent = "Set up your garden";
    subtitle.textContent = "Just a name and a location, and you're ready to go.";
    saveBtn.textContent = "Create my garden";
    nameInput.value = "";
    setupLat = null; setupLon = null;
    confirmEl.classList.add("hidden");
  }

  cancelBtn.classList.toggle("hidden", mode === "first-run");

  validateSetup();
  showView("setup");
}

/* In edit mode we know the coordinates but not what to call the place. Naming
 * it is reassuring ("📍 Amersham, Buckinghamshire" beats a bare promise), but
 * it is decoration: if the lookup fails, or the user has already moved on, the
 * neutral wording stands and nothing is blocked. */
async function describeSavedLocation(lat, lon) {
  if (lat === null || lon === null) return;
  const confirmEl = document.getElementById("setup-location-confirm");

  // Shares the one lookup, so it gets the 2 km radius and the wide-search
  // retry instead of the 100 m default. On the default this found nothing for
  // most gardens and silently left the neutral wording, which is the whole
  // reason the place was almost never named here.
  //
  // It only ever relabels. A garden that already exists is not re-judged on
  // the way into the edit form, whatever the lookup says about it — that
  // would be a rule applied to somebody after the fact.
  const place = await checkUkLocation(lat, lon);
  if (place.area && gardenFormMode === "edit") {
    confirmEl.textContent = "📍 " + place.area;
  }
}

function handleCancelGardenForm() {
  if (gardenFormMode === "first-run") return;   // nowhere to go back to
  gardenFormMode = "add";
  editingGardenId = null;
  renderGardenHeader();
  showView("app");
}

function showUkNote(show) {
  const el = document.getElementById("setup-uk-note");
  if (el) el.classList.toggle("hidden", !show);
}

/* Refusing is not an error. Nothing went wrong; the answer is simply no. So it
 * gets the explanation panel rather than the red error line, and it leaves
 * setupLat/setupLon null, which is what keeps Create greyed out. */
function refuseNonUkLocation() {
  setupLat = null;
  setupLon = null;
  document.getElementById("setup-location-confirm").classList.add("hidden");
  showUkNote(true);
  validateSetup();
}

/* Is this garden in the UK, and what is this place called? One question, not
 * two, because the same request answers both.
 *
 * DO NOT "SIMPLIFY" THIS BACK TO A BOUNDING BOX. A lat/lon rectangle drawn
 * around the UK also contains most of the Republic of Ireland and all of the
 * Isle of Man. Dublin (53.35, -6.26), Cork (51.90, -8.47) and Douglas
 * (54.15, -4.48) all sit inside the box below. None of them is the UK,
 * terms.html §2 says the advice will not be right outside the UK, and quietly
 * accepting an Irish garden is a real failure rather than a cosmetic one.
 *
 * What actually tells them apart is that postcodes.io holds UK postcodes and
 * nothing else. So "is there a UK postcode anywhere near here?" IS the UK
 * test — and it is the same call that already names the place on screen.
 *
 * TWO ATTEMPTS, because neither alone is enough:
 *   1. radius=2000, the documented maximum, NOT the default. The default is
 *      about 100 m and misses ordinary suburban gardens — Amersham comes back
 *      empty on it. Starting wide enough is what keeps the second call rare.
 *   2. wideSearch=true, roughly 20 km, only when the first finds nothing. This
 *      is what covers Foula and Fair Isle, which are UK and are a long way
 *      from anything.
 *
 * Note that radius is CLAMPED to its maximum in silence, so asking for a
 * bigger one is not a substitute for wideSearch: radius=20000 finds nothing in
 * the Cairngorms, where wideSearch finds PH22. Both were checked against the
 * live API rather than assumed.
 *
 * A miss is `result: null`, not an empty array.
 *
 * A FAILED REQUEST IS NOT A REFUSAL. If postcodes.io is unreachable or returns
 * an error we fall back to the bounding box and accept, because somebody
 * else's outage must never lock a real UK gardener out of their own garden. */
async function checkUkLocation(lat, lon) {
  // Free, offline, and catches Paris without a single request.
  if (!isInUK(lat, lon)) return { inUK: false, area: null };

  const base = "https://api.postcodes.io/postcodes?lon=" + encodeURIComponent(lon) +
               "&lat=" + encodeURIComponent(lat) + "&limit=1";

  try {
    let nearest = await nearestPostcode(base + "&radius=2000");
    if (!nearest) nearest = await nearestPostcode(base + "&wideSearch=true");
    if (!nearest) return { inUK: false, area: null };

    const area = [nearest.admin_ward || nearest.parish, nearest.admin_district]
      .filter(Boolean).join(", ");
    return { inUK: true, area: area || null };

  } catch (err) {
    console.warn("postcodes.io lookup failed — falling back to the bounding box:", err);
    return { inUK: true, area: null };
  }
}

async function nearestPostcode(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("postcodes.io returned " + res.status);
  const json = await res.json();
  return (json.result && json.result[0]) || null;   // a miss is null, not []
}

async function handleFindPostcode() {
  const pc = document.getElementById("setup-postcode").value.trim();
  const errEl = document.getElementById("setup-error");
  const confirmEl = document.getElementById("setup-location-confirm");
  errEl.textContent = "";
  showUkNote(false);

  if (!pc) { errEl.textContent = "Enter a postcode."; return; }

  const btn = document.getElementById("setup-find-btn");
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Finding…";

  try {
    const res = await fetch("https://api.postcodes.io/postcodes/" + encodeURIComponent(pc));
    if (!res.ok) throw new Error("not found");
    const json = await res.json();
    const r = json.result;

    // Belt and braces. postcodes.io only resolves UK postcodes, so this cannot
    // fire — which is exactly why it is worth keeping: it costs one comparison
    // and it says out loud what the rule on this screen is.
    if (!isInUK(r.latitude, r.longitude)) { refuseNonUkLocation(); return; }

    setupLat = r.latitude;
    setupLon = r.longitude;
    showUkNote(false);
    const area = [r.admin_ward || r.parish, r.admin_district].filter(Boolean).join(", ");
    confirmEl.textContent = "📍 " + (area || "Location found");
    confirmEl.classList.remove("hidden");
  } catch (err) {
    setupLat = null; setupLon = null;
    confirmEl.classList.add("hidden");
    errEl.textContent = "Hmm, we couldn't find that postcode. Check it and try again.";
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
    validateSetup();
  }
}

function handleUseLocation() {
  const errEl = document.getElementById("setup-error");
  const confirmEl = document.getElementById("setup-location-confirm");
  errEl.textContent = "";
  showUkNote(false);

  if (!navigator.geolocation) {
    errEl.textContent = "Your device can't share its location — enter a postcode instead.";
    return;
  }

  const btn = document.getElementById("setup-locate-btn");
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Locating…";

  navigator.geolocation.getCurrentPosition(async (pos) => {
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;

    // One lookup answers both questions. The UK test used to be a rectangle
    // done here, with a separate request purely for the label; the request was
    // always the better test and was already being made.
    const place = await checkUkLocation(lat, lon);

    btn.disabled = false;
    btn.textContent = orig;

    if (!place.inUK) { refuseNonUkLocation(); return; }

    setupLat = lat;
    setupLon = lon;
    showUkNote(false);
    confirmEl.textContent = "📍 " + (place.area || "Current location");
    confirmEl.classList.remove("hidden");
    validateSetup();
  }, (err) => {
    console.warn("Geolocation blocked:", err);
    errEl.textContent = "Couldn't get your location — enter a postcode instead.";
    btn.disabled = false;
    btn.textContent = orig;
  });
}

function validateSetup() {
  const name = document.getElementById("setup-name").value.trim();
  const ready = !!name && setupLat !== null && setupLon !== null;
  document.getElementById("setup-create-btn").disabled = !ready;

  // Duplicate names are allowed — the name lives on the garden, which can be
  // shared, so uniqueness "per user" isn't a rule the database can hold. But
  // two entries called "Home" in the switcher are genuinely hard to tell apart,
  // so say so before it happens rather than after.
  const note = document.getElementById("setup-name-note");
  if (!note) return;
  const clash = !!name && gardens.some(g =>
    g.id !== editingGardenId &&
    g.name && g.name.trim().toLowerCase() === name.toLowerCase());

  if (clash) {
    note.textContent = "You already have a garden called “" + name +
      "”. That's allowed, but they'll look identical in the switcher.";
    note.classList.remove("hidden");
  } else {
    note.textContent = "";
    note.classList.add("hidden");
  }
}

function gardenSaveErrorMessage(err) {
  const code = err && err.code ? String(err.code) : "";
  const msg = String((err && err.message) || "");
  const hint = String((err && err.hint) || "");

  // THE PAYWALL, ARRIVING FROM THE SERVER. This is reached when the browser's
  // copy of the rule is stale, or somebody drove the API directly. Saying
  // "check your connection" here would be a lie, and the kind of lie that has
  // somebody turning their wi-fi off and on for ten minutes.
  //
  // Matched on the HINT, not the message: one branch meaning "this needs
  // something you don't have", rather than one branch per paid feature.
  //
  // The message is a BACKSTOP, not the rule — if a future PostgREST ever
  // stopped passing hints through, the alternative here is telling somebody at
  // a paywall to check their connection, which is worth one redundant string.
  if (hint.indexOf("entitlement:") === 0 || msg.indexOf("paid version") !== -1) {
    return "Keeping more than one garden will be part of a paid version later on. " +
           "It isn't something you can buy yet.";
  }

  if (code === "54000" || msg.indexOf("maximum of") !== -1) {
    return "You've reached the maximum number of gardens. Delete one you no longer tend, then try again.";
  }
  if (gardenFormMode === "edit") {
    return "Couldn't save your changes. Check your connection and try again.";
  }
  return "Couldn't create your garden. Check your connection and try again.";
}

async function handleSaveGarden() {
  const name = document.getElementById("setup-name").value.trim();
  const errEl = document.getElementById("setup-error");
  errEl.textContent = "";

  if (!name || setupLat === null || setupLon === null) return;

  const btn = document.getElementById("setup-create-btn");
  const cancelBtn = document.getElementById("setup-cancel-btn");
  const orig = btn.textContent;
  const mode = gardenFormMode;
  btn.disabled = true;
  cancelBtn.disabled = true;
  btn.textContent = mode === "edit" ? "Saving…" : "Creating…";

  try {
    if (mode === "edit") {
      const targetId = editingGardenId;
      const { error } = await sb.from("garden")
        .update({ name: name, latitude: setupLat, longitude: setupLon })
        .eq("id", targetId);
      if (error) throw error;

      await loadGardens();

      // Renaming is owner-only by policy, and a blocked UPDATE under RLS
      // changes nothing SILENTLY rather than raising. So confirm it landed,
      // instead of reporting a success we haven't actually seen.
      const saved = gardens.filter(g => g.id === targetId)[0];
      if (!saved || saved.name !== name) throw new Error("update affected no rows");

      renderGardenHeader();
      showView("app");
      loadToday();      // the location may have moved: weather and filtering change

    } else {
      const { data, error } = await sb.rpc("create_garden", {
        p_name: name,
        p_latitude: setupLat,
        p_longitude: setupLon
      });
      if (error) throw error;

      await loadGardens();
      currentGardenId = data;   // create_garden returns the new garden's id
      writeLastGardenId(currentUserId, currentGardenId);

      resetPerGardenUiState();
      renderGardenHeader();
      showView("app");

      if (globalDictionary.length === 0) await loadCatalogue();
      goToTab("today");   // switchTab runs loadToday for us
      loadInventory();
    }
  } catch (err) {
    console.error("Save garden failed:", err);
    errEl.textContent = gardenSaveErrorMessage(err);
  } finally {
    btn.disabled = false;
    cancelBtn.disabled = false;
    btn.textContent = orig;
    validateSetup();
  }
}


/* ==========================================================================
 *  LEAVING OR DELETING ONE GARDEN
 *
 *  Two different actions, worded differently on purpose:
 *
 *    Delete this garden — destroys it for everyone. Owner only, and the
 *      database REFUSES it while anybody else is a member (db/13). Somebody
 *      who merely tends a garden has no notification channel: they would open
 *      the app one morning to find years of their own history gone, erased by
 *      a tap they never saw. Remove them first, or leave it to them.
 *
 *    Leave this garden — removes only you. If you were the sole owner and
 *      others remain, the garden is handed to the longest-standing member;
 *      if you were the last one, leaving IS deleting, so the UI offers Delete
 *      instead and never shows Leave.
 *
 *  Both act on the garden you are CURRENTLY IN, which is named at the top of
 *  Settings — so it is not possible to destroy one you aren't looking at.
 *  Neither is reversible, and leaving is unrecoverable by you: with no invite
 *  flow, nobody can add you back from inside the app.
 * ========================================================================== */

function openGardenDangerModal(mode) {
  const g = currentGarden();
  if (!g) return;

  gardenDangerMode = mode;

  document.getElementById("garden-danger-error").textContent = "";
  document.getElementById("garden-danger-title").textContent =
    mode === "leave" ? "Leave this garden" : "Delete this garden";
  document.getElementById("garden-danger-lede").textContent =
    mode === "leave"
      ? "You'll stop seeing this garden and its tasks. Nobody can add you back from inside the app, so treat it as permanent."
      : "This cannot be undone. There is no way to get any of it back.";

  const confirmBtn = document.getElementById("garden-danger-confirm-btn");
  confirmBtn.textContent = mode === "leave" ? "Yes, leave it" : "Yes, delete everything";
  confirmBtn.classList.remove("hidden");
  confirmBtn.disabled = false;

  const cancelBtn = document.getElementById("garden-danger-cancel-btn");
  cancelBtn.textContent = mode === "leave" ? "Stay in this garden" : "Keep this garden";
  cancelBtn.disabled = false;

  document.getElementById("garden-danger-modal").classList.remove("hidden");
  describeGardenImpact(g, mode);
}

function closeGardenDangerModal() {
  document.getElementById("garden-danger-modal").classList.add("hidden");
}

/* Say what is actually in this garden, rather than warning in the abstract.
 * "34 items and 212 completed jobs" is a number somebody can weigh; "this
 * cannot be undone" on its own is not. Same principle as the account-deletion
 * panel, which describes each garden by name. */
async function describeGardenImpact(garden, mode) {
  const box = document.getElementById("garden-danger-impact");
  const confirmBtn = document.getElementById("garden-danger-confirm-btn");
  const name = escapeHtml(garden.name);

  box.innerHTML = '<div class="loading-spinner-box">Checking this garden…</div>';

  // Refused by the database anyway — so say so BEFORE the tap, not after, and
  // take the confirm button away rather than leaving it there to fail.
  if (mode === "delete" && garden.otherMembers > 0) {
    confirmBtn.classList.add("hidden");
    box.innerHTML =
      '<p class="delete-impact-line keep"><strong>' + name + '</strong> is shared with ' +
      (garden.otherMembers === 1 ? "someone else" : "other people") +
      ", so it can't be deleted — everything in it is theirs too. Remove them from " +
      "the garden first, or leave it yourself and let them keep it.</p>";
    return;
  }

  try {
    const [items, done] = await Promise.all([
      sb.from("garden_item").select("id", { count: "exact", head: true })
        .eq("garden_id", garden.id).is("removed_at", null),
      sb.from("task_completion").select("id", { count: "exact", head: true })
        .eq("garden_id", garden.id)
    ]);
    if (items.error) throw items.error;
    if (done.error) throw done.error;

    const contents = "<strong>" + name + "</strong> holds " +
      plural(items.count || 0, "item", "items") + " and " +
      plural(done.count || 0, "completed job", "completed jobs") + ".";

    box.innerHTML = mode === "leave"
      ? '<p class="delete-impact-line keep">' + contents +
        " It stays exactly as it is for everyone else — you simply stop seeing it.</p>"
      : '<p class="delete-impact-line gone">' + contents +
        " All of it goes: every plant, tool and structure, and everything you've ever ticked off.</p>";

  } catch (err) {
    // Never let the description block the action. Honest generic wording.
    console.error("Garden impact check failed:", err);
    box.innerHTML = mode === "leave"
      ? '<p class="delete-impact-line keep">You\'ll stop seeing <strong>' + name +
        "</strong>. It stays exactly as it is for everyone else.</p>"
      : '<p class="delete-impact-line gone"><strong>' + name +
        "</strong> will be deleted, along with every plant, tool and structure in it, " +
        "and everything you've ever ticked off.</p>";
  }
}

function gardenDangerErrorMessage(err, mode) {
  const msg = String((err && err.message) || "");
  if (msg.indexOf("shared with") !== -1) {
    return "This garden is shared, so it can't be deleted. Remove the other members first, or leave it yourself.";
  }
  if (msg.indexOf("Only the owner") !== -1) {
    return "Only the owner of a garden can delete it.";
  }
  if (msg.indexOf("not a member") !== -1) {
    return "You're no longer a member of this garden.";
  }
  return mode === "leave"
    ? "Something went wrong and you have NOT left this garden. Please try again."
    : "Something went wrong and this garden has NOT been deleted. Please try again.";
}

async function handleConfirmGardenDanger() {
  const btn = document.getElementById("garden-danger-confirm-btn");
  const cancelBtn = document.getElementById("garden-danger-cancel-btn");
  const errEl = document.getElementById("garden-danger-error");
  const orig = btn.textContent;

  const mode = gardenDangerMode;
  const targetId = currentGardenId;
  const targetName = (currentGarden() || {}).name || "That garden";
  if (!targetId) return;

  errEl.textContent = "";
  btn.disabled = true;
  cancelBtn.disabled = true;
  btn.textContent = mode === "leave" ? "Leaving…" : "Deleting…";

  try {
    const { error } = mode === "leave"
      ? await sb.rpc("leave_garden", { p_garden_id: targetId })
      : await sb.rpc("delete_garden", { p_garden_id: targetId });
    if (error) throw error;

    // Everything on screen belonged to a garden that is no longer ours.
    forgetLastGardenId(currentUserId);
    currentGardenId = null;
    closeAllModals();
    resetPerGardenUiState();

    // route() picks the next garden, or the setup screen if that was the last
    // one — which is a real state, not an error: it's where every user starts.
    await route();
    showToast(mode === "leave" ? "You've left " + targetName + "." : targetName + " deleted.", false);

  } catch (err) {
    console.error("Garden " + mode + " failed:", err);
    errEl.textContent = gardenDangerErrorMessage(err, mode);
    btn.disabled = false;
    cancelBtn.disabled = false;
    btn.textContent = orig;
  }
}


/* ==========================================================================
 *  DELETING YOUR ACCOUNT
 *
 *  Two taps: "Delete my account" in Settings opens a confirmation panel that
 *  spells out what happens to each garden, and only the second button actually
 *  does it. Immediate and irreversible — there is no grace period and no backup.
 *
 *  The database does all the thinking (delete_my_account, db/12). A garden you
 *  tend alone is deleted outright; a garden you share is handed to whoever has
 *  been a member longest, so their plants and history survive you leaving.
 *
 *  AFTERWARDS WE MUST CLEAR THE SESSION LOCALLY. The saved token stays
 *  technically valid for up to an hour after the account is gone, and an app
 *  holding one looks signed in but shows nothing — which reads as "broken",
 *  not as "signed out". So: clear locally, then reload to a clean slate.
 * ========================================================================== */

function openDeleteAccountModal() {
  document.getElementById("delete-error").textContent = "";
  document.getElementById("delete-account-modal").classList.remove("hidden");
  describeDeletionImpact();
}

function closeDeleteAccountModal() {
  document.getElementById("delete-account-modal").classList.add("hidden");
}

/* Say what will actually happen, garden by garden, rather than a vague warning.
 * Someone who tends a shared garden deserves to know it survives; someone with
 * one garden of their own deserves to know it doesn't. */
async function describeDeletionImpact() {
  const box = document.getElementById("delete-impact");
  box.innerHTML = '<div class="loading-spinner-box">Checking your gardens…</div>';

  try {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) throw new Error("no user");

    // RLS lets you see the members of any garden you belong to, so this returns
    // every garden you're in, with everyone else who's in it.
    const { data, error } = await sb
      .from("garden_member")
      .select("garden_id, user_id, garden:garden_id ( name )");
    if (error) throw error;

    const gardenImpact = {};
    (data || []).forEach(row => {
      if (!gardenImpact[row.garden_id]) {
        gardenImpact[row.garden_id] = {
          name: (row.garden && row.garden.name) ? row.garden.name : "Your garden",
          others: 0
        };
      }
      if (row.user_id !== user.id) gardenImpact[row.garden_id].others++;
    });

    const list = Object.values(gardenImpact);
    if (list.length === 0) {
      box.innerHTML = '<p class="delete-impact-line">Your account will be deleted. You have no gardens set up.</p>';
      return;
    }

    box.innerHTML = list.map(g => {
      const name = escapeHtml(g.name);
      return g.others > 0
        ? `<p class="delete-impact-line keep">
             <strong>${name}</strong> is shared, so it stays. Whoever has tended it
             longest becomes its owner, and everything in it is left exactly as it is.
           </p>`
        : `<p class="delete-impact-line gone">
             <strong>${name}</strong> will be deleted — every plant, tool and structure
             in it, and everything you've ever ticked off.
           </p>`;
    }).join("");

  } catch (err) {
    // Never let this block the deletion itself: fall back to honest generic wording.
    console.error("Deletion impact check failed:", err);
    box.innerHTML = `<p class="delete-impact-line gone">
        Your account and any garden you tend on your own will be deleted, along with
        everything in them. Gardens you share with someone else will stay with them.
      </p>`;
  }
}

async function handleConfirmDeleteAccount() {
  const btn = document.getElementById("delete-confirm-btn");
  const cancelBtn = document.getElementById("delete-cancel-btn");
  const errEl = document.getElementById("delete-error");
  const orig = btn.textContent;

  errEl.textContent = "";
  btn.disabled = true;
  cancelBtn.disabled = true;
  btn.textContent = "Deleting…";

  try {
    const { error } = await sb.rpc("delete_my_account");
    if (error) throw error;

    // Gone. Drop the saved session without asking the server (there is no
    // account left to ask about), then reload into the sign-in screen.
    forgetLastGardenId(currentUserId);
    try { await sb.auth.signOut({ scope: "local" }); } catch (e) { /* nothing left to sign out of */ }
    window.location.reload();

  } catch (err) {
    console.error("Delete account failed:", err);
    errEl.textContent = "Something went wrong and your account has NOT been deleted. Please try again.";
    btn.disabled = false;
    cancelBtn.disabled = false;
    btn.textContent = orig;
  }
}


/* ==========================================================================
 *  SEND FEEDBACK
 *
 *  A row in `feedback` (db/15), not a mailto. The published email address is
 *  still there and still required — somebody who cannot sign in must be able to
 *  reach a human — but a row arrives already attached to a user and a version,
 *  which is the round-trip an email costs.
 *
 *  THREE COLUMNS, and only three. user_id has no INSERT grant at all: it
 *  defaults to auth.uid(), so it cannot be supplied and cannot be forged.
 *  Sending it would not be helpful; it would be a 42501.
 * ========================================================================== */

function openFeedbackModal() {
  const form = document.getElementById("feedback-form");
  const thanks = document.getElementById("feedback-thanks");
  const body = document.getElementById("feedback-body");
  const bug = document.querySelector('input[name="feedback-kind"][value="bug"]');
  const errEl = document.getElementById("feedback-error");

  // A fresh box every time it opens. The one case where the previous message
  // is deliberately kept is a failed send — and that leaves the modal open.
  if (form) form.classList.remove("hidden");
  if (thanks) thanks.classList.add("hidden");
  if (body) body.value = "";
  if (bug) bug.checked = true;
  if (errEl) errEl.textContent = "";

  document.getElementById("feedback-modal").classList.remove("hidden");
}

function closeFeedbackModal() {
  document.getElementById("feedback-modal").classList.add("hidden");
}

async function handleSendFeedback() {
  const errEl = document.getElementById("feedback-error");
  const bodyEl = document.getElementById("feedback-body");
  const btn = document.getElementById("feedback-send-btn");
  const orig = btn.textContent;

  errEl.textContent = "";

  const checked = document.querySelector('input[name="feedback-kind"]:checked');
  const kind = checked ? checked.value : "other";
  const body = bodyEl.value.trim();

  if (!body) { errEl.textContent = "Write something first."; return; }

  // What screen they were on when they hit Send. Capped hard by the column
  // check (2,000 characters of jsonb) — this is a label, never free prose.
  const active = document.querySelector(".view-section.active-view");
  const context = {
    v: APP_VERSION,
    view: active ? active.id.replace(/^view-/, "") : "unknown"
  };

  btn.disabled = true;
  btn.textContent = "Sending…";

  let httpStatus = 0;

  try {
    const res = await sb.from("feedback").insert({ kind, body, context });
    httpStatus = res.status || 0;
    if (res.error) throw res.error;

    document.getElementById("feedback-form").classList.add("hidden");
    document.getElementById("feedback-thanks").classList.remove("hidden");
    bodyEl.value = "";
    const bug = document.querySelector('input[name="feedback-kind"][value="bug"]');
    if (bug) bug.checked = true;

  } catch (err) {
    console.error("Send feedback failed:", err);

    // Branch on the HINT, never on the English: the wording of a database
    // exception is not an interface, and 54000 alone does not distinguish this
    // from the 200-item ceiling.
    if (err && err.hint === "feedback:daily-limit") {
      errEl.textContent = "You've reached today's feedback limit. Thanks for everything you've " +
        "sent — you can send more tomorrow. If something's urgent, email me at " +
        "whatgardeningtoday@gmail.com.";

    } else if (await sessionHasGone(err, httpStatus)) {
      // Signed out or expired while the modal was open. "Check your connection"
      // would be a lie, and retrying would fail exactly the same way, so send
      // them where the problem actually is.
      closeFeedbackModal();
      route();
      return;

    } else {
      errEl.textContent = "Couldn't send that — check your connection and try again. " +
        "Your message is still here.";
    }
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
}

/* A 401, or PostgREST's own "JWT expired" code, is the cheap tell. Asking
 * supabase-js whether there is still a session is the reliable one, and it is
 * the only one that works offline — a send that never reached the server was
 * never refused by it. Both are asked, in that order.
 *
 * Note that being offline is NOT this: getSession() reads the stored session
 * locally and does not go to the network, so it still answers "yes, signed in"
 * with the wi-fi off. That is what keeps the offline case on the ordinary
 * "check your connection" branch where it belongs. */
async function sessionHasGone(err, httpStatus) {
  if (httpStatus === 401) return true;
  if (err && String(err.code || "").indexOf("PGRST301") !== -1) return true;
  try {
    const { data: { session } } = await sb.auth.getSession();
    return !session;
  } catch (e) {
    return false;   // couldn't tell — treat it as the ordinary failure
  }
}


/* ==========================================================================
 *  NAVIGATION
 * ========================================================================== */

function switchTab(viewId, element) {
  document.querySelectorAll(".nav-item").forEach(btn => btn.classList.remove("active"));
  element.classList.add("active");

  document.querySelectorAll(".view-section").forEach(section => section.classList.remove("active-view"));
  document.getElementById(`view-${viewId}`).classList.add("active-view");

  // Returning to Today re-runs the daily call, so the list is always current.
  if (viewId === "today") loadToday();
}

// Same thing, without needing the button element to hand — used after
// switching or creating a garden.
function goToTab(viewId) {
  const btn = document.getElementById(viewId === "today" ? "nav-today" : "nav-profile");
  if (btn) switchTab(viewId, btn);
}


/* ==========================================================================
 *  TODAY  (weather + tasks, via the `today` Edge Function)
 * ========================================================================== */

async function loadToday() {
  if (!currentGardenId) return;
  const taskContainer = document.getElementById("task-container");
  taskContainer.dataset.empty = "false";
  taskContainer.innerHTML = '<div class="loading-spinner-box">Gathering seasonal rules...</div>';

  // Which garden this request is FOR. Switching is faster than a round trip, so
  // a reply can arrive after the user has moved on; painting it over the new
  // garden would show one garden's tasks under another garden's name.
  const gardenAtRequest = currentGardenId;

  try {
    const { data, error } = await sb.functions.invoke("today", {
      body: { garden_id: gardenAtRequest }
    });

    if (gardenAtRequest !== currentGardenId) return;   // stale: discard

    if (error) {
      // 403 is the `today` function saying "you are not a member of this
      // garden" — it was deleted, or you were removed, on another device.
      // "Check your connection" would be both wrong and baffling.
      const status = (error.context && typeof error.context.status === "number")
        ? error.context.status : null;
      if (status === 403 || status === 404) { await handleGardenGone(); return; }
      throw error;
    }

    renderWeather(data.weather);
    renderTaskCards(data.tasks || []);
  } catch (err) {
    if (gardenAtRequest !== currentGardenId) return;   // stale: discard
    console.error("Today failed:", err);
    renderWeather(null);
    taskContainer.dataset.empty = "false";
    taskContainer.innerHTML = '<div class="loading-spinner-box">Couldn\'t reach your garden. Check your connection and try again.</div>';
  }
}

function renderWeather(weather) {
  const tempEl = document.getElementById("weather-temp");
  const descEl = document.getElementById("weather-desc");
  const iconEl = document.getElementById("weather-icon");

  if (weather && weather.available) {
    tempEl.textContent = `${weather.temp_c}°C`;
    const d = weather.description || "";
    descEl.textContent = d ? d.charAt(0).toUpperCase() + d.slice(1) : "";
    if (weather.icon) {
      iconEl.src = `https://openweathermap.org/img/wn/${weather.icon}@2x.png`;
      iconEl.style.display = "";
    } else {
      iconEl.removeAttribute("src");
    }
  } else {
    tempEl.textContent = "--°C";
    descEl.textContent = "Weather unavailable";
    iconEl.removeAttribute("src");
  }
}

/* "Nothing due" and "you haven't told us what's in it yet" are completely
 * different messages, and a brand-new garden must never be congratulated for
 * finishing work it has never had. The two can only be told apart once the
 * inventory for THIS garden has actually arrived — which may be after the task
 * list does, since the two load in parallel. So the message is rendered from
 * whatever is known now, and loadInventory() calls this again when it knows
 * more. */
function renderTodayEmptyState() {
  const c = document.getElementById("task-container");
  if (!c) return;
  c.dataset.empty = "true";
  const inventoryKnown = inventoryLoadedFor === currentGardenId;
  c.innerHTML = (inventoryKnown && userInventory.length === 0)
    ? '<div class="loading-spinner-box">Nothing here yet — add your first plants, tools and structures in My Garden.</div>'
    : '<div class="loading-spinner-box">✨ Your garden is up to date!</div>';
}

function renderTaskCards(tasks) {
  const taskContainer = document.getElementById("task-container");
  taskContainer.innerHTML = "";
  currentlyRevealedWrapper = null;
  missingGardenRecovery = false;   // a successful load clears the recovery latch

  if (tasks.length === 0) {
    renderTodayEmptyState();
    return;
  }
  taskContainer.dataset.empty = "false";

  tasks.forEach(task => {
    const wrapper = document.createElement("div");
    wrapper.className = "task-card-wrapper";
    // Curated tasks are trusted, but a manual task's name/category/instruction
    // is user-written (task_insert_manual_mine lets any garden member create
    // one), so all three are escaped before going into innerHTML. escapeHtml
    // also turns a null/undefined value into "" rather than the literal word
    // "null", which a category-less or instruction-less task would otherwise
    // show on screen.
    wrapper.innerHTML = `
      <div class="task-hide-action">
        <button class="hide-task-btn" data-task-id="${task.task_id}">Hide</button>
      </div>
      <div class="task-card">
        <div class="task-info">
          <h3>${escapeHtml(task.name)}</h3>
          <div class="task-description-wrap">
            <p class="task-instruction">${escapeHtml(task.category)} • ${escapeHtml(task.instruction)}</p>
            <span class="task-fade" aria-hidden="true"></span>
          </div>
          <button class="task-expand-toggle" type="button" aria-expanded="false" aria-label="Show more">▾</button>
        </div>
        <button class="task-action-btn task-check" data-task-id="${task.task_id}">✓</button>
      </div>
    `;
    taskContainer.appendChild(wrapper);
  });

  // Every card is rendered at the same collapsed (3-line-clamped) height, but
  // the chevron/fade hint should only appear on the ones actually cut off.
  // That can't be known until the text is laid out in the DOM, so this runs
  // one frame after the cards are inserted and compares each description's
  // full height (scrollHeight) against its clamped height (clientHeight).
  requestAnimationFrame(() => {
    taskContainer.querySelectorAll(".task-card").forEach(card => {
      const description = card.querySelector(".task-instruction");
      if (description && description.scrollHeight > description.clientHeight + 1) {
        card.classList.add("has-more");
      }
    });
  });
}

/* --- Tap-to-expand a task card's description ------------------------------
 * Tapping the card body (but not the tick or the Hide button) toggles between
 * the clamped 3-line preview and the full description, growing the card in
 * place. Only cards whose text is actually cut off respond — there's nothing
 * to expand on a short one.
 *
 * This shares the task-container with the swipe-to-hide gesture below, so a
 * swipe that ends up back where it started (a mid-drag pointerup) must not
 * also be read as a tap. onCardPointerUp sets suppressClick on the wrapper
 * whenever a horizontal drag actually moved the card; this handler reads and
 * clears that flag before deciding whether to toggle.
 */
function handleTaskCardExpand(event) {
  const wrapper = event.target.closest(".task-card-wrapper");
  if (!wrapper) return;

  if (wrapper.dataset.suppressClick === "true") {
    wrapper.dataset.suppressClick = "false";
    return;
  }

  if (event.target.closest(".task-action-btn")) return; // the tick — handled elsewhere
  if (event.target.closest(".hide-task-btn")) return;    // the Hide button behind the card

  const card = wrapper.querySelector(".task-card");
  if (!card.classList.contains("has-more")) return; // nothing to expand

  const expanded = card.classList.toggle("expanded");
  const toggle = card.querySelector(".task-expand-toggle");
  if (toggle) {
    toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
    toggle.setAttribute("aria-label", expanded ? "Show less" : "Show more");
  }
}


/* ==========================================================================
 *  MY GARDEN — inventory
 * ========================================================================== */

async function loadInventory() {
  if (!currentGardenId) return;
  const gardenAtRequest = currentGardenId;
  const inventoryList = document.getElementById("inventory-list");
  inventoryList.innerHTML = '<div class="loading-spinner-box">Growing garden...</div>';

  try {
    const { data, error } = await sb
      .from("garden_item")
      .select("id, friendly_name, legacy_category, blueprint:blueprint_id ( name )")
      .eq("garden_id", gardenAtRequest)
      .is("removed_at", null)
      .order("id");

    if (gardenAtRequest !== currentGardenId) return;   // stale: discard
    if (error) throw error;

    userInventory = (data || []).map(r => ({
      item_id: r.id,
      friendly_name: r.friendly_name || "",
      category: r.legacy_category || "Other",
      blueprint_name: (r.blueprint && r.blueprint.name) ? r.blueprint.name : ""
    }));
    inventoryLoadedFor = gardenAtRequest;
    renderGroupedInventory();

    // Today may already be showing its empty state, which could not choose the
    // right wording until this arrived. Now it can.
    const taskContainer = document.getElementById("task-container");
    if (taskContainer && taskContainer.dataset.empty === "true") renderTodayEmptyState();

  } catch (err) {
    if (gardenAtRequest !== currentGardenId) return;   // stale: discard
    console.error("Inventory failed:", err);
    inventoryList.innerHTML = '<div class="loading-spinner-box">Couldn\'t load your garden. Check your connection.</div>';
  }
}

function renderGroupedInventory() {
  const displayArea = document.getElementById("inventory-list");
  displayArea.innerHTML = "";

  if (userInventory.length === 0) {
    displayArea.innerHTML = '<p class="form-instruction">Your garden is empty.</p>';
    return;
  }

  const groupedItems = {};
  userInventory.forEach(item => {
    if (!groupedItems[item.category]) groupedItems[item.category] = [];
    groupedItems[item.category].push(item);
  });

  const orderedNames = Object.keys(groupedItems).sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a);
    const ib = CATEGORY_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  orderedNames.forEach(categoryName => {
    const items = groupedItems[categoryName];
    const groupDiv = document.createElement("div");
    groupDiv.className = "inventory-group";

    const groupTitle = document.createElement("div");
    groupTitle.className = "inventory-group-title";
    groupTitle.innerText = categoryName;
    groupDiv.appendChild(groupTitle);

    items.forEach(item => {
      const cardDiv = document.createElement("div");
      cardDiv.className = "inventory-item-card";

      const displayName = item.blueprint_name || item.friendly_name || "Item";
      // Show the user's custom reference only when it differs from the item's name
      const customRef = (item.friendly_name && item.blueprint_name && item.friendly_name !== item.blueprint_name)
        ? item.friendly_name
        : null;

      // displayName and customRef are user-supplied (blueprint name is curated
      // and safe, but friendly_name is typed by whoever added the item), so
      // both are escaped before going into innerHTML — same rule as garden
      // names. data-friendly-name was dropped: nothing in the app ever reads
      // it, so it was a second unescaped copy doing no work.
      cardDiv.innerHTML = `
        <div>
          <strong>${escapeHtml(displayName)}</strong>
          ${customRef ? `<div class="inventory-item-meta">📌 ${escapeHtml(customRef)}</div>` : ""}
        </div>
        <button class="remove-asset-btn" data-item-id="${item.item_id}">✕</button>
      `;
      groupDiv.appendChild(cardDiv);
    });

    displayArea.appendChild(groupDiv);
  });
}


/* ==========================================================================
 *  MY GARDEN — the picker (catalogue) and adding an item
 * ========================================================================== */

async function loadCatalogue() {
  try {
    const { data, error } = await sb
      .from("blueprint")
      .select(
        "id, name, botanical_name, retired_at, " +
        "browse_group:browse_group_id ( name, sort_order ), " +
        "blueprint_category ( category:category_id ( name ) )"
      )
      .is("retired_at", null)
      .order("name");
    if (error) throw error;

    globalDictionary = [];
    (data || []).forEach(bp => {
      const bg = bp.browse_group || null;
      (bp.blueprint_category || []).forEach(bc => {
        const cn = bc.category && bc.category.name;
        if (!cn) return;
        globalDictionary.push({
          Category: cn,
          Suggested_Name: bp.name,
          blueprint_id: bp.id,
          browseGroup: bg ? bg.name : null,
          browseSort: bg && bg.sort_order !== null ? bg.sort_order : UNGROUPED_SORT,
          botanical: bp.botanical_name || null
        });
      });
    });
  } catch (err) {
    console.error("Catalogue failed:", err);
  }
}

/* --- Building one pill ----------------------------------------------------
 * A pill always shows the common name. It additionally shows:
 *   - the botanical name, inline in brackets, when the workbook has set one
 *     (only for genuinely ambiguous common names, so most pills won't have it);
 *   - which tile it belongs to, on a second line, but ONLY in search results,
 *     where matches can come from a category other than the one you're looking
 *     at and tapping blind would file the item in the wrong place.
 */
function createItemPill(item, showSource) {
  const pill = document.createElement("button");
  pill.className = "item-pill" + (showSource ? " item-pill--result" : "");

  const nameLine = document.createElement("span");
  nameLine.className = "item-pill-name";
  nameLine.appendChild(document.createTextNode(item.Suggested_Name));

  if (item.botanical) {
    const latin = document.createElement("span");
    latin.className = "item-pill-latin";
    latin.textContent = "(" + item.botanical + ")";
    nameLine.appendChild(document.createTextNode(" "));
    nameLine.appendChild(latin);
  }
  pill.appendChild(nameLine);

  if (showSource) {
    const source = document.createElement("span");
    source.className = "item-pill-source";
    source.textContent = item.Category;
    pill.appendChild(source);
  }

  pill.onclick = () => {
    document.querySelectorAll(".item-pill").forEach(p => p.classList.remove("selected"));
    pill.classList.add("selected");
    selectedSubItemObj = item;

    // A search result may belong to a tile other than the one currently lit up.
    // Follow it, so the item is filed under the category it was chosen from.
    if (item.Category !== selectedCategoryRef) {
      selectedCategoryRef = item.Category;
      highlightCategoryTile(item.Category);
    }
    validateForm();
  };

  return pill;
}

function highlightCategoryTile(categoryKey) {
  document.querySelectorAll(".tile-btn").forEach(tile => {
    tile.classList.toggle("selected", tile.dataset.category === categoryKey);
  });
}

function setPillPlaceholder(text) {
  const pillBox = document.getElementById("pill-box");
  pillBox.innerHTML = "";
  const ph = document.createElement("div");
  ph.className = "pill-placeholder";
  ph.textContent = text;
  pillBox.appendChild(ph);
}

/* --- Browsing: pills clustered under headings ------------------------------
 * Headings come from the workbook and appear in its Sort_Order. Anything with
 * no heading assigned collects under "Other" at the end — visible rather than
 * lost. A category where nothing has been assigned a heading renders as one
 * unlabelled block, exactly as the picker looked before.
 */
function renderCategoryPills(categoryKey) {
  const pillBox = document.getElementById("pill-box");
  pillBox.innerHTML = "";

  const items = globalDictionary.filter(item => item.Category === categoryKey);
  if (items.length === 0) {
    setPillPlaceholder("No items in this category yet.");
    return;
  }

  // Bucket by heading, remembering each heading's sort position.
  const buckets = new Map(); // label -> { sort, items: [] }
  items.forEach(item => {
    const label = item.browseGroup || UNGROUPED_LABEL;
    if (!buckets.has(label)) {
      buckets.set(label, { sort: item.browseGroup ? item.browseSort : UNGROUPED_SORT, items: [] });
    }
    buckets.get(label).items.push(item);
  });

  const groups = Array.from(buckets.entries())
    .map(([label, v]) => ({ label: label, sort: v.sort, items: v.items }))
    .sort((a, b) => (a.sort - b.sort) || a.label.localeCompare(b.label));

  // Nothing in this category is grouped: render one plain block, no headings.
  const anyGrouped = groups.some(g => g.label !== UNGROUPED_LABEL);

  groups.forEach(group => {
    group.items.sort((a, b) => a.Suggested_Name.localeCompare(b.Suggested_Name));

    const wrap = document.createElement("div");
    wrap.className = "pill-group";

    if (anyGrouped) {
      const title = document.createElement("div");
      title.className = "pill-group-title";
      title.textContent = group.label;
      wrap.appendChild(title);
    }

    const row = document.createElement("div");
    row.className = "pill-row";
    group.items.forEach(item => row.appendChild(createItemPill(item, false)));
    wrap.appendChild(row);

    pillBox.appendChild(wrap);
  });
}

/* --- Searching: a flat list across every category --------------------------
 * Deliberately not limited to the tile you're on: a beginner may not know
 * whether Lavender lives under Trees & shrubs or Plants & flowers, and a search
 * that finds nothing because they guessed the wrong tile reads as "the app
 * doesn't have it". Every result carries its category, so nothing is added
 * blind. Botanical names are matched too where one has been set, so typing
 * "Pelargonium" finds Geranium.
 */
function renderSearchResults(rawQuery) {
  const q = rawQuery.trim().toLowerCase();
  const pillBox = document.getElementById("pill-box");
  pillBox.innerHTML = "";

  const matches = globalDictionary.filter(item => {
    const name = item.Suggested_Name.toLowerCase();
    const latin = (item.botanical || "").toLowerCase();
    return name.indexOf(q) !== -1 || (latin && latin.indexOf(q) !== -1);
  });

  if (matches.length === 0) {
    setPillPlaceholder("Nothing matches “" + rawQuery.trim() + "”.");
    return;
  }

  // Names that START with what was typed are almost always what was meant, so
  // they come first; everything else falls in behind, alphabetically.
  matches.sort((a, b) => {
    const aStarts = a.Suggested_Name.toLowerCase().indexOf(q) === 0;
    const bStarts = b.Suggested_Name.toLowerCase().indexOf(q) === 0;
    if (aStarts !== bStarts) return aStarts ? -1 : 1;
    return a.Suggested_Name.localeCompare(b.Suggested_Name) ||
           a.Category.localeCompare(b.Category);
  });

  const row = document.createElement("div");
  row.className = "pill-row";
  matches.forEach(item => row.appendChild(createItemPill(item, true)));
  pillBox.appendChild(row);
}

/* --- What the pill box should be showing right now ------------------------ */
function refreshPillBox() {
  const searchInput = document.getElementById("pill-search");
  const query = searchInput ? searchInput.value : "";

  if (query.trim().length > 0) {
    renderSearchResults(query);
  } else if (selectedCategoryRef) {
    renderCategoryPills(selectedCategoryRef);
  } else {
    setPillPlaceholder("Select a category above, or search.");
  }
  validateForm();
}

function handlePillSearchInput() {
  const searchInput = document.getElementById("pill-search");
  const clearBtn = document.getElementById("pill-search-clear");
  const hasText = !!(searchInput && searchInput.value.trim().length > 0);

  if (clearBtn) clearBtn.classList.toggle("hidden", !hasText);

  // Anything currently picked is no longer on screen once the list changes
  // underneath it, so drop it rather than leaving Add enabled for something
  // invisible.
  selectedSubItemObj = null;
  refreshPillBox();
}

function clearPillSearch() {
  const searchInput = document.getElementById("pill-search");
  if (searchInput) searchInput.value = "";
  const clearBtn = document.getElementById("pill-search-clear");
  if (clearBtn) clearBtn.classList.add("hidden");
  selectedSubItemObj = null;
  refreshPillBox();
}

function selectCategory(categoryKey, element) {
  document.querySelectorAll(".tile-btn").forEach(tile => tile.classList.remove("selected"));
  element.classList.add("selected");

  selectedCategoryRef = categoryKey;
  selectedSubItemObj = null;

  // Tapping a tile is a browsing action, so any live search is stood down —
  // otherwise the tile would light up while search results stayed on screen.
  const searchInput = document.getElementById("pill-search");
  if (searchInput && searchInput.value) {
    searchInput.value = "";
    const clearBtn = document.getElementById("pill-search-clear");
    if (clearBtn) clearBtn.classList.add("hidden");
  }

  renderCategoryPills(categoryKey);
  validateForm();
}

function validateForm() {
  const submitBtn = document.getElementById("add-asset-btn");
  submitBtn.disabled = !(selectedCategoryRef && selectedSubItemObj);
}

async function handleAddAsset() {
  const customName = document.getElementById("custom-name").value.trim();
  const btn = document.getElementById("add-asset-btn");
  if (!selectedCategoryRef || !selectedSubItemObj) return;

  btn.disabled = true;
  btn.textContent = "Planting...";

  try {
    const { error } = await sb.from("garden_item").insert({
      garden_id: currentGardenId,
      blueprint_id: selectedSubItemObj.blueprint_id,
      friendly_name: customName.length > 0 ? customName : null,
      legacy_category: selectedCategoryRef   // the tile it was added under -> grouping
    });
    if (error) throw error;

    document.getElementById("custom-name").value = "";
    selectedSubItemObj = null;
    // Stand the search down and return to browsing the tile the item came from,
    // so adding several things from one category doesn't mean retyping.
    clearPillSearch();

    btn.textContent = "Added! 🎉";
    setTimeout(() => { btn.textContent = "Add to My Garden"; }, 2000);

    loadInventory();
    loadToday();
  } catch (error) {
    console.error("Add item error:", error);
    // The per-garden item ceiling (db/11) is the one refusal worth naming: the
    // generic "try again" would send someone round a loop that cannot succeed.
    const full = String((error && error.message) || "").indexOf("maximum of") !== -1;
    btn.textContent = full ? "This garden is full" : "Couldn't add — try again";
    btn.style.backgroundColor = "#f44336";
    setTimeout(() => {
      btn.textContent = "Add to My Garden";
      btn.style.backgroundColor = "";
      btn.disabled = false;
    }, 3000);
  }
}


/* ==========================================================================
 *  MY GARDEN — removing an item (two-tap confirm, then soft delete)
 * ========================================================================== */

function handleRemoveAsset(event) {
  const btn = event.target.closest(".remove-asset-btn");
  if (!btn) return;

  if (btn.dataset.confirming === "true") {
    const itemId = btn.getAttribute("data-item-id");
    executeRemoveAsset(itemId, btn);
  } else {
    btn.dataset.confirming = "true";
    btn.textContent = "Remove?";
    btn.classList.add("confirming");

    setTimeout(() => {
      if (btn.dataset.confirming === "true") {
        btn.dataset.confirming = "false";
        btn.textContent = "✕";
        btn.classList.remove("confirming");
      }
    }, 3000);
  }
}

async function executeRemoveAsset(itemId, btn) {
  btn.disabled = true;
  btn.textContent = "⏳";

  try {
    const { error } = await sb
      .from("garden_item")
      .update({ removed_at: new Date().toISOString() })
      .eq("id", itemId)
      .eq("garden_id", currentGardenId);
    if (error) throw error;

    btn.textContent = "✓";
    btn.classList.remove("confirming");
    btn.classList.add("removed");

    setTimeout(() => {
      loadInventory();
      loadToday();
    }, 600);
  } catch (error) {
    console.error("Remove item error:", error);
    btn.disabled = false;
    btn.textContent = "✕";
    btn.dataset.confirming = "false";
    btn.classList.remove("confirming");
  }
}


/* ==========================================================================
 *  SWIPE-TO-REVEAL "HIDE" GESTURE  (unchanged — purely visual)
 * ========================================================================== */

function onCardPointerDown(e) {
  const wrapper = e.target.closest(".task-card-wrapper");
  if (!wrapper) return;
  if (wrapper.classList.contains("completed")) return; // completed cards don't swipe

  const card = wrapper.querySelector(".task-card");
  const wasRevealed = wrapper.classList.contains("revealed");

  dragState = {
    wrapper, card,
    startX: e.clientX,
    startY: e.clientY,
    startTransform: wasRevealed ? -HIDE_REVEAL_WIDTH : 0,
    locked: false,
    isHorizontal: false,
    moved: false,
    lastX: undefined
  };
  card.style.transition = "none";
}

function onCardPointerMove(e) {
  if (!dragState) return;

  const deltaX = e.clientX - dragState.startX;
  const deltaY = e.clientY - dragState.startY;

  if (!dragState.locked) {
    if (Math.abs(deltaX) < 6 && Math.abs(deltaY) < 6) return;
    dragState.locked = true;
    dragState.isHorizontal = Math.abs(deltaX) > Math.abs(deltaY);
    if (!dragState.isHorizontal) {
      dragState.card.style.transition = "";
      dragState = null;
      return;
    }
  }

  if (!dragState.isHorizontal) return;

  dragState.moved = true;

  let newX = dragState.startTransform + deltaX;
  newX = Math.max(-HIDE_REVEAL_WIDTH, Math.min(0, newX));
  dragState.card.style.transform = `translateX(${newX}px)`;
  dragState.lastX = newX;
}

function onCardPointerUp() {
  if (!dragState || !dragState.isHorizontal) { dragState = null; return; }

  const { wrapper, card } = dragState;
  const finalX = dragState.lastX !== undefined ? dragState.lastX : dragState.startTransform;
  card.style.transition = "";

  // A drag that actually moved the card is a swipe, not a tap — the click
  // event that follows this pointerup shouldn't also expand/collapse the card.
  if (dragState.moved) wrapper.dataset.suppressClick = "true";

  if (finalX < -(HIDE_REVEAL_WIDTH / 2)) {
    if (currentlyRevealedWrapper && currentlyRevealedWrapper !== wrapper) {
      closeSwipeWrapper(currentlyRevealedWrapper);
    }
    openSwipeWrapper(wrapper);
  } else {
    closeSwipeWrapper(wrapper);
  }

  dragState = null;
}

function openSwipeWrapper(wrapper) {
  wrapper.classList.add("revealed");
  wrapper.querySelector(".task-card").style.transform = `translateX(-${HIDE_REVEAL_WIDTH}px)`;
  currentlyRevealedWrapper = wrapper;
}

function closeSwipeWrapper(wrapper) {
  wrapper.classList.remove("revealed");
  wrapper.querySelector(".task-card").style.transform = "translateX(0)";
  if (currentlyRevealedWrapper === wrapper) currentlyRevealedWrapper = null;
}


/* ==========================================================================
 *  HIDE / UNHIDE A TASK
 *
 *  hidden_task is keyed on the GARDEN, so hiding "Mow the lawn" at your own
 *  place leaves it showing at your mother-in-law's — which is right. It is also
 *  why the undo toast has to be stood down when you switch: see
 *  resetPerGardenUiState().
 * ========================================================================== */

async function handleHideTaskClick(event) {
  const hideBtn = event.target.closest(".hide-task-btn");
  if (!hideBtn) return;

  const taskId = parseInt(hideBtn.getAttribute("data-task-id"), 10);
  const wrapper = hideBtn.closest(".task-card-wrapper");
  const nameEl = wrapper ? wrapper.querySelector(".task-info h3") : null;
  const taskName = nameEl ? nameEl.textContent : "Task";
  const gardenAtHide = currentGardenId;

  if (currentlyRevealedWrapper === wrapper) currentlyRevealedWrapper = null;
  if (wrapper) wrapper.remove();

  showUndoToast(taskId, taskName);

  try {
    const { error } = await sb.from("hidden_task").insert({
      garden_id: gardenAtHide,
      task_id: taskId
    });
    // 23505 = already hidden (unique key). That's a success, not a failure.
    if (error && error.code !== "23505") console.error("Hide task failed:", error);
  } catch (error) {
    console.error("Hide task error:", error);
  }
}

/* One banner, two jobs: the undoable "task hidden", and a plain notice with
 * nothing to undo ("Mum's garden deleted"). The notice class hides the button.
 * It lives outside #app-root in the markup, so a notice still shows on the
 * setup screen — which is exactly where you land after deleting your last
 * garden. */
function showToast(message, withUndo) {
  if (toastTimeout) { clearTimeout(toastTimeout); toastTimeout = null; }

  const toast = document.getElementById("undo-toast");
  if (!toast) return;
  document.getElementById("undo-toast-message").textContent = message;
  toast.classList.toggle("notice", !withUndo);
  toast.classList.add("visible");

  toastTimeout = setTimeout(hideToast, withUndo ? 5000 : 4000);
}

function hideToast() {
  if (toastTimeout) { clearTimeout(toastTimeout); toastTimeout = null; }
  undoToastTaskId = null;
  const toast = document.getElementById("undo-toast");
  if (toast) toast.classList.remove("visible");
}

function showUndoToast(taskId, taskName) {
  undoToastTaskId = taskId;
  showToast('"' + taskName + '" hidden.', true);
}

async function handleUndoHide() {
  if (undoToastTaskId === null || undoToastTaskId === undefined) return;
  const taskId = undoToastTaskId;
  const gardenAtUndo = currentGardenId;

  hideToast();

  try {
    const { error } = await sb.from("hidden_task")
      .delete()
      .eq("garden_id", gardenAtUndo)
      .eq("task_id", taskId);
    if (error) throw error;
    loadToday(); // bring the restored task straight back
  } catch (error) {
    console.error("Undo hide error:", error);
  }
}


/* ==========================================================================
 *  SETTINGS  (gear icon)
 *
 *  Two groups, because it holds two different kinds of thing. Everything under
 *  the garden's name applies to THAT garden only — including the hidden-task
 *  list, which was always per-garden but never said so, and became genuinely
 *  ambiguous the moment a second garden existed.
 * ========================================================================== */

function openSettingsModal() {
  const g = currentGarden();
  const isOwner = !!(g && g.role === "owner");
  const shared = !!(g && g.otherMembers > 0);

  const nameEl = document.getElementById("settings-garden-name");
  if (nameEl) nameEl.textContent = g ? g.name : "This garden";

  // Rename and location are owner-only by policy (garden_update_owner), so
  // don't offer what RLS would silently refuse.
  const editBtn = document.getElementById("edit-garden-btn");
  if (editBtn) editBtn.classList.toggle("hidden", !isOwner);

  // Leaving only means something while there is somebody to leave it TO. As the
  // last member, leaving IS deleting, so Delete is the honest word for it.
  const leaveBtn = document.getElementById("leave-garden-btn");
  if (leaveBtn) leaveBtn.classList.toggle("hidden", !(shared || !isOwner));

  // Deleting destroys it for everyone: an owner's action only.
  const deleteBtn = document.getElementById("delete-garden-btn");
  if (deleteBtn) deleteBtn.classList.toggle("hidden", !isOwner);

  // Read from storage every time it opens: the preference lives in this device,
  // not in this session, so another tab may have changed it.
  const rememberToggle = document.getElementById("remember-garden-toggle");
  if (rememberToggle) rememberToggle.checked = rememberGardenEnabled();

  document.getElementById("settings-modal").classList.remove("hidden");
  fetchHiddenTasks();
}

function closeSettingsModal() {
  document.getElementById("settings-modal").classList.add("hidden");
}

function closeAllModals() {
  closeSettingsModal();
  closeGardenModal();
  closeGardenDangerModal();
  closeDeleteAccountModal();
  closeFeedbackModal();
}

async function fetchHiddenTasks() {
  const listEl = document.getElementById("hidden-tasks-list");
  listEl.innerHTML = '<div class="loading-spinner-box">Loading...</div>';
  const gardenAtRequest = currentGardenId;

  try {
    const { data, error } = await sb
      .from("hidden_task")
      .select("task_id, hidden_at, task:task_id ( name, category:category_id ( name ) )")
      .eq("garden_id", gardenAtRequest)
      .order("hidden_at", { ascending: false });
    if (gardenAtRequest !== currentGardenId) return;   // stale: discard
    if (error) throw error;

    const rows = (data || []).map(r => ({
      task_id: r.task_id,
      task_name: r.task ? r.task.name : "(this task no longer exists)",
      category: (r.task && r.task.category) ? r.task.category.name : "",
      date_hidden: r.hidden_at
    }));
    renderHiddenTasksList(rows);
  } catch (error) {
    console.error("Fetch hidden tasks error:", error);
    listEl.innerHTML = '<div class="loading-spinner-box">Failed to load hidden tasks.</div>';
  }
}

function renderHiddenTasksList(hiddenTasks) {
  const listEl = document.getElementById("hidden-tasks-list");
  listEl.innerHTML = "";

  if (hiddenTasks.length === 0) {
    listEl.innerHTML = '<div class="loading-spinner-box">You haven\'t hidden any tasks in this garden.</div>';
    return;
  }

  hiddenTasks.forEach(task => {
    const card = document.createElement("div");
    card.className = "hidden-task-card";
    // Same reasoning as renderTaskCards: a manual task's name/category is
    // user-written, so both are escaped before going into innerHTML.
    card.innerHTML = `
      <div class="hidden-task-info">
        <h4>${escapeHtml(task.task_name)}</h4>
        <p>${escapeHtml(task.category)}</p>
      </div>
      <button class="restore-task-btn" data-task-id="${task.task_id}">Restore</button>
    `;
    listEl.appendChild(card);
  });
}

async function handleRestoreTask(event) {
  const btn = event.target.closest(".restore-task-btn");
  if (!btn) return;

  const taskId = parseInt(btn.getAttribute("data-task-id"), 10);
  btn.disabled = true;
  btn.textContent = "⏳";

  try {
    const { error } = await sb.from("hidden_task")
      .delete()
      .eq("garden_id", currentGardenId)
      .eq("task_id", taskId);
    if (error) throw error;

    const card = btn.closest(".hidden-task-card");
    if (card) card.remove();

    loadToday();

    const listEl = document.getElementById("hidden-tasks-list");
    if (listEl.children.length === 0) {
      listEl.innerHTML = '<div class="loading-spinner-box">You haven\'t hidden any tasks in this garden.</div>';
    }
  } catch (error) {
    console.error("Restore task error:", error);
    btn.disabled = false;
    btn.textContent = "Restore";
  }
}


/* ==========================================================================
 *  COMPLETING A TASK
 * ========================================================================== */

async function handleTaskCompletion(event) {
  if (!event.target.classList.contains("task-check")) return;

  const checkbox = event.target;
  const card = checkbox.closest(".task-card");
  const taskId = parseInt(checkbox.getAttribute("data-task-id"), 10);

  checkbox.disabled = true;
  checkbox.innerText = "⏳";

  try {
    const { error } = await sb.from("task_completion").insert({
      garden_id: currentGardenId,
      task_id: taskId,
      notes: "Completed via PWA client"
    });
    if (error) throw error;

    checkbox.classList.add("completed");
    checkbox.innerText = "✓";
    card.style.opacity = "0.5";

    // Mark the whole card completed: this removes the Hide action sitting behind
    // it (so it can't show through the now-translucent card) and takes the card
    // out of the swipe gesture.
    const wrapper = card.closest(".task-card-wrapper");
    if (wrapper) {
      wrapper.classList.add("completed");
      if (currentlyRevealedWrapper === wrapper) currentlyRevealedWrapper = null;
      card.style.transform = "translateX(0)";
    }
  } catch (error) {
    console.error("Completion error:", error);
    checkbox.disabled = false;
    checkbox.innerText = "❌";
  }
}


/* ==========================================================================
 *  INIT
 * ========================================================================== */

document.addEventListener("DOMContentLoaded", () => {

  // Register the service worker (offline app shell). Harmless if unsupported.
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(err => console.warn("SW registration failed:", err));
  }

  // If config.js is missing or still holds placeholder values, sb is null.
  // Say so plainly, rather than letting it surface later as a misleading
  // "couldn't send a sign-in code" message.
  if (!sb) {
    console.error("Supabase config missing. Create config.js from config.example.js and fill in your values.");
    const msg = document.getElementById("splash-message");
    if (msg) msg.textContent = "App configuration is missing. config.js was not found or still has placeholder values — add your Supabase URL and anon key to config.js, then reload.";
    const retry = document.getElementById("splash-retry");
    if (retry) retry.classList.add("hidden");
    showView("splash");
    return;
  }

  // --- Sign-in screen ---
  const googleBtn = document.getElementById("signin-google-btn");
  if (googleBtn) googleBtn.addEventListener("click", handleGoogleSignIn);

  // --- Garden form (first run / add another / edit) ---
  const findBtn = document.getElementById("setup-find-btn");
  if (findBtn) findBtn.addEventListener("click", handleFindPostcode);
  const locateBtn = document.getElementById("setup-locate-btn");
  if (locateBtn) locateBtn.addEventListener("click", handleUseLocation);
  const createBtn = document.getElementById("setup-create-btn");
  if (createBtn) createBtn.addEventListener("click", handleSaveGarden);
  const cancelSetupBtn = document.getElementById("setup-cancel-btn");
  if (cancelSetupBtn) cancelSetupBtn.addEventListener("click", handleCancelGardenForm);
  const setupName = document.getElementById("setup-name");
  if (setupName) setupName.addEventListener("input", validateSetup);
  const setupPostcode = document.getElementById("setup-postcode");
  if (setupPostcode) setupPostcode.addEventListener("keydown", e => { if (e.key === "Enter") handleFindPostcode(); });

  // --- Splash retry ---
  const splashRetry = document.getElementById("splash-retry");
  if (splashRetry) splashRetry.addEventListener("click", route);

  // --- Garden switcher ---
  const gardenSwitchBtn = document.getElementById("garden-switch-btn");
  if (gardenSwitchBtn) gardenSwitchBtn.addEventListener("click", openGardenModal);
  const closeGardenBtn = document.getElementById("close-garden-modal");
  if (closeGardenBtn) closeGardenBtn.addEventListener("click", closeGardenModal);
  const gardenModal = document.getElementById("garden-modal");
  if (gardenModal) {
    gardenModal.addEventListener("click", (e) => { if (e.target === gardenModal) closeGardenModal(); });
  }
  const gardenList = document.getElementById("garden-list");
  if (gardenList) gardenList.addEventListener("click", handleGardenListClick);
  const addGardenBtn = document.getElementById("add-garden-btn");
  if (addGardenBtn) {
    addGardenBtn.addEventListener("click", handleAddGardenClick);
  }

  // --- Today view: completion, hide, swipe ---
  const taskContainer = document.getElementById("task-container");
  if (taskContainer) {
    taskContainer.addEventListener("click", handleTaskCompletion);
    taskContainer.addEventListener("click", handleHideTaskClick);
    taskContainer.addEventListener("click", handleTaskCardExpand);
    taskContainer.addEventListener("pointerdown", onCardPointerDown);
    taskContainer.addEventListener("pointermove", onCardPointerMove);
    taskContainer.addEventListener("pointerup", onCardPointerUp);
    taskContainer.addEventListener("pointercancel", onCardPointerUp);
  }

  // --- My Garden ---
  const inventoryList = document.getElementById("inventory-list");
  if (inventoryList) inventoryList.addEventListener("click", handleRemoveAsset);
  const addAssetBtn = document.getElementById("add-asset-btn");
  if (addAssetBtn) addAssetBtn.addEventListener("click", handleAddAsset);
  const pillSearch = document.getElementById("pill-search");
  if (pillSearch) {
    pillSearch.addEventListener("input", handlePillSearchInput);
    // Enter on a phone keyboard should dismiss the keyboard, not submit anything.
    pillSearch.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); pillSearch.blur(); } });
  }
  const pillSearchClear = document.getElementById("pill-search-clear");
  if (pillSearchClear) pillSearchClear.addEventListener("click", clearPillSearch);

  // --- Undo / notice toast ---
  const undoBtn = document.getElementById("undo-toast-btn");
  if (undoBtn) undoBtn.addEventListener("click", handleUndoHide);

  // --- Settings modal ---
  const settingsBtn = document.getElementById("settings-btn");
  if (settingsBtn) settingsBtn.addEventListener("click", openSettingsModal);
  const closeSettingsBtn = document.getElementById("close-settings-modal");
  if (closeSettingsBtn) closeSettingsBtn.addEventListener("click", closeSettingsModal);
  const settingsModal = document.getElementById("settings-modal");
  if (settingsModal) {
    settingsModal.addEventListener("click", (e) => { if (e.target === settingsModal) closeSettingsModal(); });
  }
  const hiddenTasksList = document.getElementById("hidden-tasks-list");
  if (hiddenTasksList) hiddenTasksList.addEventListener("click", handleRestoreTask);
  const rememberToggle = document.getElementById("remember-garden-toggle");
  if (rememberToggle) {
    rememberToggle.addEventListener("change", (e) => setRememberGarden(e.target.checked));
  }
  const signOutBtn = document.getElementById("signout-btn");
  if (signOutBtn) signOutBtn.addEventListener("click", handleSignOut);

  // --- Send feedback ---
  const feedbackBtn = document.getElementById("feedback-btn");
  if (feedbackBtn) feedbackBtn.addEventListener("click", openFeedbackModal);
  const closeFeedbackBtn = document.getElementById("close-feedback-modal");
  if (closeFeedbackBtn) closeFeedbackBtn.addEventListener("click", closeFeedbackModal);
  const feedbackSendBtn = document.getElementById("feedback-send-btn");
  if (feedbackSendBtn) feedbackSendBtn.addEventListener("click", handleSendFeedback);
  const feedbackModal = document.getElementById("feedback-modal");
  if (feedbackModal) {
    feedbackModal.addEventListener("click", (e) => { if (e.target === feedbackModal) closeFeedbackModal(); });
  }

  // --- This garden: rename / change location, leave, delete ---
  const editGardenBtn = document.getElementById("edit-garden-btn");
  if (editGardenBtn) {
    editGardenBtn.addEventListener("click", () => {
      const g = currentGarden();
      if (!g) return;
      closeSettingsModal();
      showGardenForm("edit", g);
    });
  }
  const leaveGardenBtn = document.getElementById("leave-garden-btn");
  if (leaveGardenBtn) leaveGardenBtn.addEventListener("click", () => openGardenDangerModal("leave"));
  const deleteGardenBtn = document.getElementById("delete-garden-btn");
  if (deleteGardenBtn) deleteGardenBtn.addEventListener("click", () => openGardenDangerModal("delete"));

  const closeGardenDangerBtn = document.getElementById("close-garden-danger-modal");
  if (closeGardenDangerBtn) closeGardenDangerBtn.addEventListener("click", closeGardenDangerModal);
  const gardenDangerCancelBtn = document.getElementById("garden-danger-cancel-btn");
  if (gardenDangerCancelBtn) gardenDangerCancelBtn.addEventListener("click", closeGardenDangerModal);
  const gardenDangerConfirmBtn = document.getElementById("garden-danger-confirm-btn");
  if (gardenDangerConfirmBtn) gardenDangerConfirmBtn.addEventListener("click", handleConfirmGardenDanger);
  const gardenDangerModal = document.getElementById("garden-danger-modal");
  if (gardenDangerModal) {
    gardenDangerModal.addEventListener("click", (e) => { if (e.target === gardenDangerModal) closeGardenDangerModal(); });
  }

  // Account deletion: two taps, and the second one is the only one that acts.
  const deleteAccountBtn = document.getElementById("delete-account-btn");
  if (deleteAccountBtn) deleteAccountBtn.addEventListener("click", openDeleteAccountModal);
  const closeDeleteBtn = document.getElementById("close-delete-modal");
  if (closeDeleteBtn) closeDeleteBtn.addEventListener("click", closeDeleteAccountModal);
  const deleteCancelBtn = document.getElementById("delete-cancel-btn");
  if (deleteCancelBtn) deleteCancelBtn.addEventListener("click", closeDeleteAccountModal);
  const deleteConfirmBtn = document.getElementById("delete-confirm-btn");
  if (deleteConfirmBtn) deleteConfirmBtn.addEventListener("click", handleConfirmDeleteAccount);
  const deleteModal = document.getElementById("delete-account-modal");
  if (deleteModal) {
    deleteModal.addEventListener("click", (e) => { if (e.target === deleteModal) closeDeleteAccountModal(); });
  }

  // --- The gate: react to sign-in / sign-out / initial session ---
  sb.auth.onAuthStateChange((event, session) => {
    if (event === "INITIAL_SESSION" || event === "SIGNED_IN" || event === "SIGNED_OUT") {
      const uid = session && session.user ? session.user.id : null;
      if (uid !== routedUserId) {
        routedUserId = uid;
        route();
      }
    }
  });
});
