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
 *  see resetPerGardenUiState(), and the stale-response guards in loadToday()
 *  and loadInventory() — each request remembers the garden it was made for and
 *  discards its own answer if that garden is no longer the one on screen.
 *  loadToday() carries a true in-flight guard on top of that, because it is the
 *  one call with a per-user ceiling behind it; see "ONE DAILY CALL AT A TIME".
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

const SIGNUP_DISABLED_MESSAGE =
  "New account sign-up is currently closed. If you think you should already have access, get in touch.";
const OAUTH_CALLBACK_ERROR_MESSAGE =
  "Google sign-in didn’t finish. Try again, or get in touch if it keeps happening.";
const OAUTH_CALLBACK_ERROR_PARAMS = ["error", "error_code", "error_description", "error_uri"];

/* OAuth failures return to the same page as successful sign-ins, but without a
 * session. Read them before supabase-js initialises or signed-out routing runs,
 * remove provider detail from the address bar, and carry only our safe copy to
 * the sign-in screen. Successful callback fragments are left entirely alone. */
function consumeOAuthCallbackError(location = window.location, history = window.history) {
  const url = new URL(location.href);
  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
  const errorCode = url.searchParams.get("error_code") || hashParams.get("error_code");
  const errorName = url.searchParams.get("error") || hashParams.get("error");

  if (!errorCode && !errorName) return null;

  const hashCarriesOAuthParams = OAUTH_CALLBACK_ERROR_PARAMS.some(param => hashParams.has(param));
  OAUTH_CALLBACK_ERROR_PARAMS.forEach(param => {
    url.searchParams.delete(param);
    hashParams.delete(param);
  });
  if (hashCarriesOAuthParams) {
    const cleanHash = hashParams.toString();
    url.hash = cleanHash ? "#" + cleanHash : "";
  }
  history.replaceState(history.state, "", url.pathname + url.search + url.hash);

  return String(errorCode || "").toLowerCase() === "signup_disabled"
    ? SIGNUP_DISABLED_MESSAGE
    : OAUTH_CALLBACK_ERROR_MESSAGE;
}

let pendingOAuthCallbackError = window.location && window.history
  ? consumeOAuthCallbackError()
  : null;

const { createClient } = window.supabase;
const sb = configLooksValid ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

/* Sent with every piece of feedback, so a bug report says which build it came
 * from. It must match CACHE_NAME in sw.js, and both must be bumped in the same
 * commit — a report labelled with a version that was never deployed is worse
 * than no label at all. */
const APP_VERSION = "gardening-v56-identify-photo";

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
let sessionRecoveryPromise = null;

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
let setupLocationRequestSerial = 0;

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
const HIDE_REVEAL_WIDTH = 88; // px — must match .task-hide-action's width in style.css
let currentlyRevealedWrapper = null;
let dragState = null;
let toastTimeout = null;
let undoToastState = null;

// --- TODAY VIEW STATE ---
// The server remains the sole matching engine. These values control display
// only: a maximum duration, deterministic hero promotion and stale-response
// protection for overlapping requests.
let todayTasks = [];
let todayLoadedFor = null;
let selectedTimeMinutes = null; // null = Any
let todayRequestSerial = 0;
let todayLoadingTimer = null;
let expandedTaskId = null;
let todayHeroTaskId = null;

// --- ONE DAILY CALL AT A TIME ---
// `today` is the only call that can cost money: a cache miss inside it spends
// one of OpenWeather's sixty-a-minute, shared across every user of the app at
// once. Adding a plant, removing one, hiding a job and undoing all fire their
// own refresh, so a quick flurry of tidying used to fire a burst of calls whose
// earlier answers were thrown away by the stale-response guard the moment they
// landed. Since db/19, that burst is also spending a per-user allowance.
//
// So: one call in flight at a time. A refresh asked for while one is running
// does not queue up behind it — it sets a flag, and exactly ONE more call goes
// out when the current one settles, whatever else was asked for in between.
// The trailing call reads the garden and state current AT THAT MOMENT rather
// than when it was requested, which is why it re-enters loadToday() from the
// top instead of replaying anything.
//
// This is not a debounce. Nothing is delayed: the first tap always calls
// immediately, so no single action ever feels slower.
let todayInFlight = false;
let todayTrailingWanted = false;

// The daily hero is presentation state, not a horticultural ranking record.
// Persist it per user and garden so ordinary re-renders, switching and reloads
// cannot promote a second "good place to start" on the same device that day.
const DAILY_HERO_KEY = "wgt.dailyHero";
const dailyHeroMemory = new Map();

/* --- DISMISSING THE FROST WARNING -----------------------------------------
 *
 * ON THE DEVICE, NOT IN THE DATABASE, and this was a deliberate choice over
 * the more obvious one. A per-garden dismiss stored server-side would be
 * tidier and would follow a person between their phone and their tablet — and
 * it would let whoever opens the app first in a SHARED garden silence the
 * frost warning for everybody else before they had ever seen it. That is not a
 * rough edge, it is the feature failing at the only moment it matters. So the
 * dismiss is local, exactly like the daily hero above, and carries the same
 * two accepted limitations: it does not travel between devices, and it falls
 * back to memory alone if browser storage is blocked (SPEC.md's "Current
 * accepted DEV interface").
 *
 * The de-dup itself is NOT local. The spell — "is this the same frost we were
 * already warning about" — is per garden in the database, because that is a
 * fact about the weather and the garden rather than about a person.
 *
 * WHAT IS STORED IS THE SPELL IT DISMISSED, not a date and not a flag. Same
 * spell still running, the stored value matches and the banner stays down
 * however many times the app is opened. A genuinely new frost — after a real
 * forty-eight-hour clear — arrives with a new spell_started_at, the stored
 * value no longer matches, and the banner comes back on its own. There is no
 * re-arm step anywhere in the system, and nothing to get out of step.
 */
const FROST_DISMISS_KEY = "wgt.frostDismissed";
const frostDismissMemory = new Map();

// --- MY GARDEN ASYNC / MODAL STATE ---
let inventoryRequestSerial = 0;
let catalogueRequestSerial = 0;
let hiddenTasksRequestSerial = 0;
let gardenAddResetTimer = null;
let removeItemState = null;
let removeItemReturnFocus = null;
const modalFocusReturn = new Map();


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

function gardenCalendarDay() {
  const garden = currentGarden();
  const timeZone = (garden && garden.timezone) || "Europe/London";
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return values.year + "-" + values.month + "-" + values.day;
  } catch (error) {
    return new Date().toISOString().slice(0, 10);
  }
}

function dailyHeroStorageSlot() {
  return currentUserId && currentGardenId
    ? currentUserId + ":" + currentGardenId
    : null;
}

function readDailyHeroRecord(slot) {
  if (!slot) return null;
  if (dailyHeroMemory.has(slot)) return dailyHeroMemory.get(slot);
  try {
    const raw = window.localStorage.getItem(DAILY_HERO_KEY);
    const map = raw ? JSON.parse(raw) : {};
    const record = map && typeof map === "object" ? map[slot] : null;
    if (record && typeof record === "object") dailyHeroMemory.set(slot, record);
    return record || null;
  } catch (error) {
    return null;
  }
}

function writeDailyHeroRecord(slot, record) {
  if (!slot) return;
  dailyHeroMemory.set(slot, record);
  try {
    const raw = window.localStorage.getItem(DAILY_HERO_KEY);
    const map = raw ? JSON.parse(raw) : {};
    const safeMap = map && typeof map === "object" ? map : {};
    safeMap[slot] = record;
    window.localStorage.setItem(DAILY_HERO_KEY, JSON.stringify(safeMap));
  } catch (error) {
    /* In-memory state still keeps the current session coherent. */
  }
}

/* Which spell, if any, has been dismissed on this device for this garden.
 * Slot-keyed on user AND garden like the hero, so two people sharing a tablet
 * do not inherit each other's dismissals and neither does a second garden. */
function readFrostDismissedSpell(slot) {
  if (!slot) return null;
  if (frostDismissMemory.has(slot)) return frostDismissMemory.get(slot);
  try {
    const raw = window.localStorage.getItem(FROST_DISMISS_KEY);
    const map = raw ? JSON.parse(raw) : {};
    const spell = map && typeof map === "object" ? map[slot] : null;
    const value = typeof spell === "string" && spell ? spell : null;
    frostDismissMemory.set(slot, value);
    return value;
  } catch (error) {
    return null;
  }
}

/* Passing null forgets the dismissal, which is what Undo does. The in-memory
 * copy is written first and unconditionally: with storage blocked it is the
 * only record there is, and the dismiss must still work for the session. */
function writeFrostDismissedSpell(slot, spell) {
  if (!slot) return;
  frostDismissMemory.set(slot, spell || null);
  try {
    const raw = window.localStorage.getItem(FROST_DISMISS_KEY);
    const map = raw ? JSON.parse(raw) : {};
    const safeMap = map && typeof map === "object" ? map : {};
    if (spell) safeMap[slot] = spell;
    else delete safeMap[slot];
    window.localStorage.setItem(FROST_DISMISS_KEY, JSON.stringify(safeMap));
  } catch (error) {
    /* In-memory state still keeps the current session coherent. */
  }
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

function showAccessibleModal(modalId, initialFocusId, parentModalId = null) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  if (modal.classList.contains("hidden")) {
    modalFocusReturn.set(modalId, document.activeElement);
  }
  if (parentModalId) {
    const parent = document.getElementById(parentModalId);
    if (parent && !parent.classList.contains("hidden")) {
      parent.setAttribute("aria-hidden", "true");
      parent.setAttribute("inert", "");
      modal.dataset.parentModal = parentModalId;
    }
  }
  modal.classList.remove("hidden");
  requestAnimationFrame(() => {
    const preferred = initialFocusId ? document.getElementById(initialFocusId) : null;
    const fallback = modal.querySelector("button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href]");
    const target = preferred && !preferred.disabled ? preferred : fallback;
    if (target) target.focus();
  });
}

function hideAccessibleModal(modalId, restoreFocus = true) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  const wasOpen = !modal.classList.contains("hidden");
  modal.classList.add("hidden");

  const parentId = modal.dataset.parentModal;
  if (parentId) {
    const parent = document.getElementById(parentId);
    if (parent) {
      parent.removeAttribute("aria-hidden");
      parent.removeAttribute("inert");
    }
    delete modal.dataset.parentModal;
  }

  const returnFocus = modalFocusReturn.get(modalId);
  modalFocusReturn.delete(modalId);
  if (wasOpen && restoreFocus && returnFocus && document.contains(returnFocus)) returnFocus.focus();
}

function closeModalFromKeyboard(modalId) {
  if (modalId === "garden-modal") closeGardenModal();
  if (modalId === "settings-modal") closeSettingsModal();
  if (modalId === "garden-danger-modal") closeGardenDangerModal();
  if (modalId === "delete-account-modal") closeDeleteAccountModal();
  if (modalId === "feedback-modal") closeFeedbackModal();
  if (modalId === "item-detail-modal") closeItemDetail();
  if (modalId === "photo-remove-modal") closePhotoRemoveModal();
  if (modalId === "photo-viewer") closePhotoViewer();
  if (modalId === "identify-modal") closeIdentify();
}

function handleAccessibleModalKeydown(event) {
  const modal = event.currentTarget;
  if (!modal || modal.classList.contains("hidden")) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeModalFromKeyboard(modal.id);
    return;
  }
  if (event.key !== "Tab") return;

  const controls = Array.from(modal.querySelectorAll(
    'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
  )).filter(control => control.offsetParent !== null);
  if (controls.length === 0) return;
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

async function route() {
  showView("splash");
  setSplashMessage("");

  const { data: { session } } = await sb.auth.getSession();
  const callbackError = pendingOAuthCallbackError;
  pendingOAuthCallbackError = null;
  if (!session) {
    currentGardenId = null;
    currentUserId = null;
    gardens = [];
    closeAllModals();
    forgetPhotoSession();
    forgetIdentifySession();
    showSigninDefault(callbackError || "");
    showView("signin");
    requestAnimationFrame(() => document.getElementById("signin-title").focus());
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
    if (await sessionHasGone(err, (err && err.status) || 0)) {
      await recoverFromSessionLoss();
      return;
    }
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

function resetGoogleSignInControl() {
  const btn = document.getElementById("signin-google-btn");
  if (btn) btn.disabled = false;
}

function showSigninDefault(message = "") {
  // Reset a pending state restored from the back-forward cache after an OAuth
  // handoff is cancelled or its external navigation fails.
  document.getElementById("signin-google-error").textContent = message;
  resetGoogleSignInControl();
}

async function handleGoogleSignIn() {
  pendingOAuthCallbackError = null;
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
  showAccessibleModal("garden-modal", "close-garden-modal");
  const btn = document.getElementById("garden-switch-btn");
  if (btn) btn.setAttribute("aria-expanded", "true");
}

function closeGardenModal(restoreFocus = true) {
  hideAccessibleModal("garden-modal", restoreFocus);
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

  // Invalidate every outstanding Today response, including an older request
  // for the same garden that may complete after a later refresh.
  todayRequestSerial += 1;
  if (todayLoadingTimer) { clearTimeout(todayLoadingTimer); todayLoadingTimer = null; }
  todayTasks = [];
  todayLoadedFor = null;
  expandedTaskId = null;
  todayHeroTaskId = null;
  const taskStatus = document.getElementById("task-status");
  if (taskStatus) {
    taskStatus.textContent = "";
    taskStatus.className = "status-message hidden";
  }

  currentlyRevealedWrapper = null;
  dragState = null;

  userInventory = [];
  inventoryLoadedFor = null;
  inventoryRequestSerial += 1;
  hiddenTasksRequestSerial += 1;
  const inventoryList = document.getElementById("inventory-list");
  if (inventoryList) {
    inventoryList.innerHTML = '<div class="garden-local-status">Seeing what’s growing…</div>';
  }

  selectedCategoryRef = null;
  selectedSubItemObj = null;
  document.querySelectorAll(".tile-btn").forEach(tile => {
    tile.classList.remove("selected");
    tile.setAttribute("aria-pressed", "false");
  });
  const custom = document.getElementById("custom-name");
  if (custom) custom.value = "";
  if (gardenAddResetTimer) { clearTimeout(gardenAddResetTimer); gardenAddResetTimer = null; }
  setAddButtonState("idle");
  setGardenAddError("");
  closeRemoveItemModal(false);
  clearPillSearch();
  resetItemPhotoState();
  closeIdentify({ forced: true, gardenSwitch: true });
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
  setupLocationRequestSerial += 1;
  gardenFormMode = mode;
  editingGardenId = (mode === "edit" && garden) ? garden.id : null;

  const title = document.getElementById("setup-title");
  const subtitle = document.getElementById("setup-subtitle");
  const saveBtn = document.getElementById("setup-create-btn");
  const cancelBtn = document.getElementById("setup-cancel-btn");
  const nameInput = document.getElementById("setup-name");
  const confirmEl = document.getElementById("setup-location-confirm");
  const findBtn = document.getElementById("setup-find-btn");
  const locateBtn = document.getElementById("setup-locate-btn");
  const locateLabel = document.getElementById("setup-locate-label");

  document.getElementById("setup-error").textContent = "";
  document.getElementById("setup-postcode").value = "";
  showUkNote(false);
  saveBtn.disabled = true;
  cancelBtn.disabled = false;
  findBtn.disabled = false;
  findBtn.textContent = "Find postcode";
  locateBtn.disabled = false;
  locateLabel.textContent = "Use my current location";

  if (mode === "edit" && garden) {
    title.textContent = "Edit garden";
    subtitle.textContent = "Change what it's called, or put it in the right place.";
    saveBtn.textContent = "Save changes";
    nameInput.value = garden.name || "";
    setupLat = (garden.latitude === null || garden.latitude === undefined) ? null : Number(garden.latitude);
    setupLon = (garden.longitude === null || garden.longitude === undefined) ? null : Number(garden.longitude);
    confirmEl.textContent = "Using the location saved for this garden";
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
  requestAnimationFrame(() => title.focus());
}

/* In edit mode we know the coordinates but not what to call the place. Naming
 * it is reassuring ("Amersham, Buckinghamshire" beats a bare promise), but
 * it is decoration: if the lookup fails, or the user has already moved on, the
 * neutral wording stands and nothing is blocked. */
async function describeSavedLocation(lat, lon) {
  if (lat === null || lon === null) return;
  const confirmEl = document.getElementById("setup-location-confirm");
  const requestSerial = setupLocationRequestSerial;

  // Shares the one lookup, so it gets the 2 km radius and the wide-search
  // retry instead of the 100 m default. On the default this found nothing for
  // most gardens and silently left the neutral wording, which is the whole
  // reason the place was almost never named here.
  //
  // It only ever relabels. A garden that already exists is not re-judged on
  // the way into the edit form, whatever the lookup says about it — that
  // would be a rule applied to somebody after the fact.
  const place = await checkUkLocation(lat, lon);
  if (place.area && gardenFormMode === "edit" &&
      requestSerial === setupLocationRequestSerial && setupLat === lat && setupLon === lon) {
    confirmEl.textContent = place.area;
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

  const requestSerial = ++setupLocationRequestSerial;
  const btn = document.getElementById("setup-find-btn");
  const locateBtn = document.getElementById("setup-locate-btn");
  const orig = btn.textContent;
  btn.disabled = true;
  locateBtn.disabled = true;
  btn.textContent = "Finding…";

  try {
    const res = await fetch("https://api.postcodes.io/postcodes/" + encodeURIComponent(pc));
    if (!res.ok) throw new Error("not found");
    const json = await res.json();
    const r = json.result;
    if (requestSerial !== setupLocationRequestSerial ||
        document.getElementById("setup-postcode").value.trim() !== pc) return;

    // Belt and braces. postcodes.io only resolves UK postcodes, so this cannot
    // fire — which is exactly why it is worth keeping: it costs one comparison
    // and it says out loud what the rule on this screen is.
    if (!isInUK(r.latitude, r.longitude)) { refuseNonUkLocation(); return; }

    setupLat = r.latitude;
    setupLon = r.longitude;
    showUkNote(false);
    const area = [r.admin_ward || r.parish, r.admin_district].filter(Boolean).join(", ");
    confirmEl.textContent = area || "Location found";
    confirmEl.classList.remove("hidden");
  } catch (err) {
    if (requestSerial !== setupLocationRequestSerial) return;
    setupLat = null; setupLon = null;
    confirmEl.classList.add("hidden");
    errEl.textContent = "Hmm, we couldn't find that postcode. Check it and try again.";
  } finally {
    if (requestSerial === setupLocationRequestSerial) {
      btn.disabled = false;
      locateBtn.disabled = false;
      btn.textContent = orig;
      validateSetup();
    }
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

  const requestSerial = ++setupLocationRequestSerial;
  const btn = document.getElementById("setup-locate-btn");
  const findBtn = document.getElementById("setup-find-btn");
  const label = document.getElementById("setup-locate-label");
  const orig = label.textContent;
  btn.disabled = true;
  findBtn.disabled = true;
  label.textContent = "Locating…";

  navigator.geolocation.getCurrentPosition(async (pos) => {
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;

    // One lookup answers both questions. The UK test used to be a rectangle
    // done here, with a separate request purely for the label; the request was
    // always the better test and was already being made.
    const place = await checkUkLocation(lat, lon);
    if (requestSerial !== setupLocationRequestSerial) return;

    btn.disabled = false;
    findBtn.disabled = false;
    label.textContent = orig;

    if (!place.inUK) { refuseNonUkLocation(); return; }

    setupLat = lat;
    setupLon = lon;
    showUkNote(false);
    confirmEl.textContent = place.area || "Current location";
    confirmEl.classList.remove("hidden");
    validateSetup();
  }, (err) => {
    if (requestSerial !== setupLocationRequestSerial) return;
    console.warn("Geolocation blocked:", err);
    errEl.textContent = "Couldn't get your location — enter a postcode instead.";
    btn.disabled = false;
    findBtn.disabled = false;
    label.textContent = orig;
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
    if (await sessionHasGone(err, 0)) { await recoverFromSessionLoss(); return; }
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

  showAccessibleModal("garden-danger-modal", "garden-danger-cancel-btn", "settings-modal");
  describeGardenImpact(g, mode);
}

function closeGardenDangerModal(restoreFocus = true) {
  hideAccessibleModal("garden-danger-modal", restoreFocus);
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
    if (await sessionHasGone(err, 0)) { await recoverFromSessionLoss(); return; }
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
    if (targetId !== currentGardenId) return;
    if (await sessionHasGone(err, 0)) { await recoverFromSessionLoss(); return; }
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
  showAccessibleModal("delete-account-modal", "delete-cancel-btn", "settings-modal");
  describeDeletionImpact();
}

function closeDeleteAccountModal(restoreFocus = true) {
  hideAccessibleModal("delete-account-modal", restoreFocus);
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
    if (await sessionHasGone(err, 0)) { await recoverFromSessionLoss(); return; }
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
    if (await sessionHasGone(err, 0)) { await recoverFromSessionLoss(); return; }
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

  showAccessibleModal("feedback-modal", "close-feedback-modal", "settings-modal");
}

function closeFeedbackModal(restoreFocus = true) {
  hideAccessibleModal("feedback-modal", restoreFocus);
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
    const thanks = document.getElementById("feedback-thanks");
    thanks.classList.remove("hidden");
    thanks.focus();
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
      await recoverFromSessionLoss();
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

async function recoverFromSessionLoss() {
  if (sessionRecoveryPromise) return sessionRecoveryPromise;
  sessionRecoveryPromise = (async () => {
    // Stand down the auth callback before clearing the stale local token, so a
    // SIGNED_OUT event cannot start a second route in parallel with recovery.
    routedUserId = null;
    try { await sb.auth.signOut({ scope: "local" }); } catch (error) { /* local cleanup continues */ }

    closeAllModals();
    resetPerGardenUiState();
    forgetPhotoSession();
    forgetIdentifySession();
    currentGardenId = null;
    currentUserId = null;
    gardens = [];
    missingGardenRecovery = false;
    showSigninDefault();
    document.getElementById("signin-google-error").textContent =
      "Your session ended. Sign in again to continue.";
    showView("signin");
    requestAnimationFrame(() => document.getElementById("signin-title").focus());
  })();
  try {
    await sessionRecoveryPromise;
  } finally {
    sessionRecoveryPromise = null;
  }
}


/* ==========================================================================
 *  NAVIGATION
 * ========================================================================== */

function switchTab(viewId, element) {
  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.classList.remove("active");
    btn.removeAttribute("aria-current");
  });
  element.classList.add("active");
  element.setAttribute("aria-current", "page");

  const target = document.getElementById(`view-${viewId}`);
  // Tapping Today while Today is already on screen, showing the current
  // garden's own list, asks for nothing new — so it fetches nothing. The second
  // half of that test is load-bearing: switchGarden() and the new-garden flow
  // both reach Today through here, and both have just cleared todayLoadedFor,
  // which is exactly what says "the list on screen belongs to the garden you
  // have left". Testing only "is Today already visible" would leave those two
  // journeys showing the previous garden's jobs.
  const alreadyShowingThisGarden =
    viewId === "today" &&
    target.classList.contains("active-view") &&
    todayLoadedFor === currentGardenId;

  document.querySelectorAll(".view-section").forEach(section => section.classList.remove("active-view"));
  target.classList.add("active-view");

  // Returning to Today re-runs the daily call, so the list is always current.
  if (viewId === "today" && !alreadyShowingThisGarden) loadToday();
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

  // Already asking? Ask again once, when this one is done — see "ONE DAILY CALL
  // AT A TIME". Note the flag is set, not a copy of anything: five actions in
  // three seconds still produce exactly one trailing call, and it will use
  // whatever garden is current when it finally goes out.
  if (todayInFlight) { todayTrailingWanted = true; return; }
  todayInFlight = true;

  const taskContainer = document.getElementById("task-container");
  const statusEl = document.getElementById("task-status");
  const gardenAtRequest = currentGardenId;
  const requestSerial = ++todayRequestSerial;
  const hasCurrentContent = todayLoadedFor === gardenAtRequest;

  taskContainer.setAttribute("aria-busy", "true");
  taskContainer.classList.toggle("refreshing", hasCurrentContent);
  if (!hasCurrentContent) taskContainer.innerHTML = "";
  if (statusEl) {
    statusEl.className = "status-message hidden";
    statusEl.textContent = "";
  }

  if (todayLoadingTimer) clearTimeout(todayLoadingTimer);
  todayLoadingTimer = setTimeout(() => {
    if (requestSerial !== todayRequestSerial || gardenAtRequest !== currentGardenId) return;
    if (hasCurrentContent) {
      if (statusEl) {
        statusEl.textContent = "Refreshing today’s jobs…";
        statusEl.className = "status-message";
      }
    } else {
      taskContainer.innerHTML = `
        <div class="loading-state">
          <strong>Finding today’s best jobs…</strong>
          <span>Checking your garden and today’s conditions.</span>
        </div>`;
    }
  }, 300);

  try {
    const { data, error } = await sb.functions.invoke("today", {
      body: { garden_id: gardenAtRequest }
    });

    if (requestSerial !== todayRequestSerial || gardenAtRequest !== currentGardenId) return;

    if (error) {
      // 403 is the `today` function saying "you are not a member of this
      // garden" — it was deleted, or you were removed, on another device.
      // "Check your connection" would be both wrong and baffling.
      const status = (error.context && typeof error.context.status === "number")
        ? error.context.status : null;
      if (status === 403 || status === 404) { await handleGardenGone(); return; }
      if (await sessionHasGone(error, status || 0)) { await recoverFromSessionLoss(); return; }
      throw error;
    }

    renderWeather(data && data.weather);
    todayTasks = (data && Array.isArray(data.tasks)) ? data.tasks : [];
    todayHeroTaskId = resolveDailyHeroTaskId(todayTasks);
    todayLoadedFor = gardenAtRequest;
    renderCurrentTaskList();
  } catch (err) {
    if (requestSerial !== todayRequestSerial || gardenAtRequest !== currentGardenId) return;
    console.error("Today failed:", err);
    renderWeather(null);
    taskContainer.dataset.empty = "false";
    taskContainer.innerHTML = `
      <div class="today-error-state">
        <h2>We couldn’t show today’s jobs.</h2>
        <p>Check your connection and try again.</p>
        <button type="button" class="secondary-action-btn" data-action="retry-today">Try again</button>
      </div>`;
  } finally {
    if (requestSerial === todayRequestSerial) {
      if (todayLoadingTimer) { clearTimeout(todayLoadingTimer); todayLoadingTimer = null; }
      taskContainer.classList.remove("refreshing");
      taskContainer.setAttribute("aria-busy", "false");
      if (statusEl) statusEl.classList.add("hidden");
    }

    // finally, not catch: the flag has to clear on a thrown network error and
    // on a 403 handled above just as surely as on success. Miss one of those
    // cases and a single failed refresh jams every tap after it, for good,
    // until the app is reloaded.
    todayInFlight = false;
    if (todayTrailingWanted) {
      todayTrailingWanted = false;
      loadToday();   // fresh read of currentGardenId; its own stale-garden guard applies
    }
  }
}

function renderWeather(weather) {
  const widget = document.getElementById("weather-widget");
  const tempEl = document.getElementById("weather-temp");
  const descEl = document.getElementById("weather-desc");
  const iconEl = document.getElementById("weather-icon");

  if (weather && weather.available) {
    if (widget) widget.classList.remove("unavailable");
    tempEl.textContent = `${weather.temp_c}°C`;
    const d = weather.description || "";
    descEl.textContent = d ? d.charAt(0).toUpperCase() + d.slice(1) : "Current weather";
    if (weather.icon) {
      iconEl.src = `https://openweathermap.org/img/wn/${weather.icon}@2x.png`;
      iconEl.alt = "";
    } else {
      iconEl.removeAttribute("src");
    }
  } else {
    if (widget) widget.classList.add("unavailable");
    tempEl.textContent = "Weather";
    descEl.textContent = "Unavailable";
    iconEl.removeAttribute("src");
  }
}

function taskMinutes(task) {
  const minutes = Number(task && task.estimated_minutes);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : Number.POSITIVE_INFINITY;
}

function formatTaskDuration(task) {
  const minutes = taskMinutes(task);
  if (!Number.isFinite(minutes)) return "Time varies";
  if (minutes < 60) return minutes + " min";
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours + (hours === 1 ? " hour" : " hours");
  }
  const hours = Math.floor(minutes / 60);
  return hours + " hr " + (minutes % 60) + " min";
}

/* The server's category-first order remains authoritative for the normal
 * list. The one display exception is the hero: choose the shortest eligible
 * job. Equal durations retain returned order; task_id is the final stable
 * fallback if future transforms ever introduce duplicate positions. */
function orderTasksForDisplay(tasks, maximumMinutes, fixedHeroTaskId) {
  const indexed = (tasks || []).map((task, index) => ({ task, index }));
  const eligible = maximumMinutes === null
    ? indexed
    : indexed.filter(entry => taskMinutes(entry.task) <= maximumMinutes);

  if (eligible.length === 0) return { hero: null, remaining: [], eligible: [] };

  const heroEntry = fixedHeroTaskId === undefined
    ? eligible.slice().sort((a, b) =>
        taskMinutes(a.task) - taskMinutes(b.task) ||
        a.index - b.index ||
        Number(a.task.task_id || 0) - Number(b.task.task_id || 0)
      )[0]
    : eligible.find(entry => Number(entry.task.task_id) === Number(fixedHeroTaskId)) || null;

  return {
    hero: heroEntry ? heroEntry.task : null,
    remaining: eligible.filter(entry => entry !== heroEntry).map(entry => entry.task),
    eligible: eligible.map(entry => entry.task)
  };
}

function resolveDailyHeroTaskId(tasks) {
  const slot = dailyHeroStorageSlot();
  const day = gardenCalendarDay();
  const existing = readDailyHeroRecord(slot);
  if (existing && existing.day === day && Number.isFinite(Number(existing.taskId))) {
    return Number(existing.taskId);
  }

  const ordered = orderTasksForDisplay(tasks, null);
  if (!ordered.hero) return null;
  const taskId = Number(ordered.hero.task_id);
  writeDailyHeroRecord(slot, { day, taskId });
  return taskId;
}

const TASK_ART = {
  "Lawn": "task-lawn.svg",
  "Beds": "task-beds.svg",
  "Trees & shrubs": "task-trees-shrubs.svg",
  "Veg & herbs": "task-veg-herbs.svg",
  "Garden structures": "task-structures.svg",
  "Structures": "task-structures.svg",
  "Tools": "task-tools.svg",
  "Plants & flowers": "task-plants-flowers.svg"
};

function taskArtPath(category) {
  return "assets/wgt/" + (TASK_ART[category] || "task-plants-flowers.svg");
}

/* --- "Why today?" — the derived reason line -------------------------------
 * select_tasks (db/18) returns a reason CODE, never a sentence. A code is a
 * fact about the garden; a sentence is copy, and copy should not need a
 * database migration to change. Both strings therefore live here, and only
 * here.
 *
 * The wording is impersonal on purpose. A garden can be shared, so the person
 * reading the card is not necessarily the person who did the job. "Last done
 * in April" is true for both of them; "you last did this in April" is not.
 *
 * Precedence between the two codes is settled in SQL, so exactly one code ever
 * arrives and this function never has to choose. A task with no code shows no
 * line at all — there is deliberately no generic fallback, because a sentence
 * that fits every job tells the reader nothing.
 */
const REASON_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/* Whole months between two matched ISO dates. Both are YYYY-MM-DD in the
 * GARDEN's timezone — reason_date is computed that way by select_tasks and
 * gardenCalendarDay() by the same rule — so they are compared as plain
 * integers. Building Date objects here would let the browser's own timezone
 * back in, and could shift the answer by a day at the boundary for anyone
 * reading the app from abroad. */
function monthsBetween(then, now) {
  const months = (Number(now[1]) - Number(then[1])) * 12 + (Number(now[2]) - Number(then[2]));
  // Earlier in the calendar month than the completion was: not a full month yet.
  return Number(now[3]) < Number(then[3]) ? months - 1 : months;
}

function taskReasonLine(task) {
  const code = task && task.reason_code;

  if (code === "season_closing") {
    // "Usual" is doing real work in this sentence. valid_months records when
    // the app considers a job eligible, not the last horticulturally sensible
    // day to do it, so anything more absolute would claim more than is known.
    return "The usual season for this ends this month.";
  }

  if (code !== "last_done") return "";

  const then = ISO_DATE.exec(String(task.reason_date || ""));
  const now = ISO_DATE.exec(gardenCalendarDay());
  if (!then || !now) return "";

  // Past twelve months a month name stops helping and starts misleading: with a
  // long cooldown, "last done in April" could mean April of the year before
  // last. Say the vaguer, true thing instead.
  if (monthsBetween(then, now) >= 12) return "Last done over a year ago.";

  const month = REASON_MONTHS[Number(then[2]) - 1];
  if (!month) return "";

  // Naming the year is what separates the two readings of "last done in
  // January" on the fifth of January: four days ago, or eleven and a half
  // months ago. Under twelve months, a differing year can only be the last one.
  return then[1] === now[1]
    ? "Last done in " + month + "."
    : "Last done in " + month + " last year.";
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
    ? `<div class="today-empty-state">
         <div><h2>Let’s set up your garden</h2><p>Add the plants, tools and structures you have, and we’ll find the jobs that fit.</p><button type="button" class="secondary-action-btn" data-action="open-garden">Add to My Garden</button></div>
       </div>`
    : `<div class="today-empty-state">
         <div><h2>Nothing much to do today</h2><p>Your garden’s in a good place. Enjoy it.</p></div>
         <img src="assets/wgt/nothing-much-today.svg" alt="">
       </div>`;
}

function renderNoTimeFitState() {
  const taskContainer = document.getElementById("task-container");
  const label = selectedTimeMinutes === 60 ? "1 hour" : selectedTimeMinutes + " minutes";
  taskContainer.dataset.empty = "false";
  taskContainer.innerHTML = `
    <div class="today-error-state">
      <h2>No jobs fit ${escapeHtml(label)} today</h2>
      <p>There may still be worthwhile jobs if you have longer.</p>
      <button type="button" class="secondary-action-btn" data-action="show-all-times">Show jobs for any time</button>
    </div>`;
}

function taskCardMarkup(task, hero) {
  const taskId = Number(task.task_id);
  const title = escapeHtml(task.name);
  const category = escapeHtml(task.category || "Garden task");
  const guidance = escapeHtml(task.instruction || "No instructions are available for this job yet.");
  const titleId = "task-title-" + taskId;
  const guidanceId = "task-guidance-" + taskId;
  const expanded = expandedTaskId === taskId;
  const priority = hero ? '<p class="task-priority-label">A good place to start</p>' : "";

  /* The hero already has a supporting line in the collapsed card, so its reason
   * goes there, in place of the shortest-job sentence, rather than opening a
   * second one. Never both: two supporting sentences on the one elevated card
   * is exactly the "catalogue of competing recommendations" the design intent
   * rules out. Every other card carries its reason at the top of the expanded
   * panel instead, where "What to do" still leads. */
  const reason = taskReasonLine(task);
  const summary = hero
    ? `<p class="task-summary">${escapeHtml(reason || "The shortest job in today’s list — a straightforward way to get going.")}</p>`
    : "";
  const reasonLine = (reason && !hero)
    ? `<p class="task-reason">${escapeHtml(reason)}</p>`
    : "";

  return `
    <div class="task-hide-action">
      <button class="hide-task-btn" type="button" data-task-id="${taskId}" aria-label="Hide ${title}">Hide</button>
    </div>
    <article class="task-card${hero ? " hero" : ""}${expanded ? " expanded" : ""}" aria-labelledby="${titleId}">
      <button class="task-disclosure" type="button" data-task-id="${taskId}" aria-expanded="${expanded}" aria-controls="${guidanceId}" aria-label="${expanded ? "Hide" : "Show"} instructions for ${title}, ${category}">
        <span class="sr-only">${expanded ? "Hide" : "Show"} instructions</span>
      </button>
      <div class="task-disclosure-visual">
        <img class="task-art" src="${taskArtPath(task.category)}" alt="">
        <span class="task-info">
          ${priority}
          <h3 id="${titleId}">${title}<svg class="task-title-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5"/></svg></h3>
          ${summary}
          <span class="task-meta"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.5"/><path d="M10 5.8v4.5l3 1.8"/></svg>${escapeHtml(formatTaskDuration(task))}</span>
        </span>
      </div>
      <button class="task-action-btn task-check" type="button" data-task-id="${taskId}" aria-label="Mark ${title}, ${category}, as done">
        <svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="14.5"/><path class="task-tick" d="m11.5 18.3 4.2 4.2 8.8-9"/></svg>
      </button>
      <div id="${guidanceId}" class="task-guidance" ${expanded ? "" : "hidden"}>
        ${reasonLine}
        <h4>What to do</h4>
        <p>${guidance}</p>
        <div class="task-guidance-actions"><button class="task-hide-explicit hide-task-btn" type="button" data-task-id="${taskId}">Hide this job</button></div>
      </div>
    </article>`;
}

/* Completion and Hide are local operations, so their visible result must also
 * live in the local task model. Removing only the card element lets any later
 * render (for example, expanding the next card) resurrect stale content. */
function removeTodayTaskFromClient(taskId) {
  const index = todayTasks.findIndex(task => Number(task.task_id) === Number(taskId));
  if (index < 0) return { task: null, index: -1 };
  const [task] = todayTasks.splice(index, 1);
  if (expandedTaskId === Number(taskId)) expandedTaskId = null;
  return { task, index };
}

function restoreTodayTaskToClient(task, index) {
  if (!task || todayTasks.some(item => Number(item.task_id) === Number(task.task_id))) return;
  const insertionIndex = Number.isInteger(index)
    ? Math.max(0, Math.min(index, todayTasks.length))
    : todayTasks.length;
  todayTasks.splice(insertionIndex, 0, task);
}

function invalidateTodayRequestForLocalMutation() {
  todayRequestSerial += 1;
  if (todayLoadingTimer) { clearTimeout(todayLoadingTimer); todayLoadingTimer = null; }
  const taskContainer = document.getElementById("task-container");
  if (taskContainer) {
    taskContainer.classList.remove("refreshing");
    taskContainer.setAttribute("aria-busy", "false");
  }
}

/* ==========================================================================
 *  THE FROST WARNING
 *
 *  WHAT IT IS FOR. Until now the weather could only ever take jobs AWAY: a
 *  task suppressed by rain or cold simply was not on the list, and nothing
 *  said so. Reveal thresholds (db/23) do the opposite — a frost-protection job
 *  appears BECAUSE a frost is forecast — and a job that appears for a reason
 *  the gardener cannot see is worse than one that does not appear at all. This
 *  banner is that reason, said once, above everything else on the screen.
 *
 *  IT IS A SUMMARY, NOT A RE-SKINNED CARD. The matching jobs are still
 *  ordinary outlined cards in their ordinary place in the list. Styling them
 *  differently was considered and rejected: they are ordinary jobs, and
 *  decorating the card would say "this job is unusual" when what is unusual is
 *  only the reason it is here today.
 *
 *  WHY ONLY FROST. `weather_reveal_code` can also say 'wind', and the banner
 *  deliberately ignores that: wind-triggered content was explicitly deferred
 *  past the frost pilot, so no wind row exists, and no wording for one has been
 *  agreed. Inventing "Strong wind expected tonight" here would be putting
 *  unapproved copy in front of real users for a case that cannot arise yet. A
 *  wind-revealed task would simply appear as an ordinary card with no banner,
 *  which is what every card did before this feature existed — so the gap is a
 *  missing explanation rather than a wrong one.
 *
 *  THE COPY. The app describing its own state, so no pronoun, and ordinary
 *  contractions are fine — this is not one of the four verbatim safety
 *  categories (docs/WGT_VOICE_AND_TONE.md §4, §5). One matched job is named
 *  using its own title, because task titles are already plain imperative
 *  instructions ("Cover tender plants with fleece") and a second, hand-written
 *  content field would be a second thing to keep true. Two or more always take
 *  the generic line: joining job names into one sentence reads worse the more
 *  there are, and it is the case where the list below is the better answer
 *  anyway.
 * ========================================================================== */

const FROST_TITLE = "Frost expected tonight";

function frostRevealedTasks(tasks) {
  return (tasks || []).filter(task => task && task.weather_reveal_code === "frost");
}

/* DELIBERATELY NOT FILTERED BY THE AVAILABLE-TIME PILLS, unlike the list
 * itself. "I have fifteen minutes" is a statement about what can be fitted in;
 * a frost is a statement about what happens tonight whether or not it is
 * convenient. Filtering the warning would mean the person with least time —
 * the one most likely to skip the job — is also the one not told about it. */
function frostBannerState(tasks) {
  const revealed = frostRevealedTasks(tasks);
  if (revealed.length === 0) return null;

  /* Every revealed task in one spell shares its garden's spell, but they are
   * separate rows in the database and only one value can tag a dismissal, so
   * the newest is taken. It moves only when a genuinely new spell starts, which
   * is exactly when the dismissal should stop applying.
   *
   * The fallback matters more than it looks. A revealed task always carries a
   * spell in practice — the extremes select_tasks tests against come from the
   * same call that writes the spell row — but if that ever changed, tagging the
   * dismissal with the garden's own calendar day degrades to "dismissed for
   * today" rather than to "dismissed for ever". */
  const spells = revealed
    .map(task => task.spell_started_at)
    .filter(value => typeof value === "string" && value);
  const spell = spells.length ? spells.slice().sort().pop() : "day:" + gardenCalendarDay();

  return {
    spell,
    subtitle: revealed.length === 1
      ? revealed[0].name
      : revealed.length + " tasks added to protect against tonight’s frost"
  };
}

function renderFrostBanner() {
  const slot = document.getElementById("frost-banner-slot");
  if (!slot) return;

  const state = frostBannerState(todayTasks);
  const dismissed = state && readFrostDismissedSpell(dailyHeroStorageSlot()) === state.spell;

  if (!state || dismissed) {
    slot.classList.add("hidden");
    slot.innerHTML = "";
    return;
  }

  /* escapeHtml on the subtitle is load-bearing rather than defensive: with one
   * match it is a task name, which comes from the workbook today but from a
   * gardener's own custom task the day custom tasks ship. */
  slot.classList.remove("hidden");
  slot.innerHTML = `
    <div class="frost-banner">
      <svg class="frost-banner-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2.5v19M3.8 7.2l16.4 9.6M20.2 7.2 3.8 16.8"/>
        <path d="M12 6.2 9.6 4.4M12 6.2l2.4-1.8M12 17.8l-2.4 1.8M12 17.8l2.4 1.8"/>
        <path d="m6.3 9 .3-3M6.3 9l-2.8-1.1M17.7 15l-.3 3M17.7 15l2.8 1.1"/>
        <path d="m6.3 15-2.8 1.1M6.3 15l.3 3M17.7 9l2.8-1.1M17.7 9l-.3-3"/>
      </svg>
      <div class="frost-banner-copy">
        <h2>${escapeHtml(FROST_TITLE)}</h2>
        <p>${escapeHtml(state.subtitle)}</p>
      </div>
      <button class="frost-banner-dismiss" type="button" data-action="dismiss-frost"
              data-spell="${escapeHtml(state.spell)}" aria-label="Dismiss the frost warning">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5.5 5.5 9 9m0-9-9 9"/></svg>
      </button>
    </div>`;
}

/* Dismiss gets the same five-second Undo as Hide, and for the same reason: the
 * control is small, it sits next to nothing else, and the thing it removes is
 * the only notice a person gets about tonight. Nothing here touches the
 * network — the dismissal is local — so unlike Hide there is no failure path
 * and no state to roll back on one. */
function handleFrostDismiss(spell) {
  const slot = dailyHeroStorageSlot();
  writeFrostDismissedSpell(slot, spell);
  renderFrostBanner();
  showUndoToast({ type: "frost-banner", slot, gardenId: currentGardenId });
}

function renderCurrentTaskList(options) {
  const taskContainer = document.getElementById("task-container");
  const preservePosition = !!(options && options.preservePosition);
  const oldY = preservePosition ? window.scrollY : null;
  taskContainer.innerHTML = "";
  currentlyRevealedWrapper = null;
  missingGardenRecovery = false;   // a successful load clears the recovery latch

  /* FIRST, AND OUTSIDE EVERY EARLY RETURN BELOW. The banner is driven by the
   * task data rather than by the call site, so completing the last frost job,
   * hiding it, or undoing either takes the banner with it — and does so through
   * the one function every one of those paths already calls. Putting it after
   * the empty-state return would have left a stale warning on screen in the one
   * case where it is most obviously wrong: no jobs left, still warning. */
  renderFrostBanner();

  if (todayTasks.length === 0) {
    renderTodayEmptyState();
    return;
  }

  const ordered = orderTasksForDisplay(todayTasks, selectedTimeMinutes, todayHeroTaskId);
  if (ordered.eligible.length === 0) {
    renderNoTimeFitState();
    return;
  }

  taskContainer.dataset.empty = "false";

  (ordered.hero ? [ordered.hero] : []).concat(ordered.remaining).forEach(task => {
    const isHero = !!ordered.hero && Number(task.task_id) === Number(ordered.hero.task_id);
    const wrapper = document.createElement("div");
    wrapper.className = "task-card-wrapper" + (isHero ? " hero-wrapper" : "");
    wrapper.dataset.taskId = String(task.task_id);
    wrapper.innerHTML = taskCardMarkup(task, isHero);
    taskContainer.appendChild(wrapper);
  });
  if (oldY !== null) requestAnimationFrame(() => window.scrollTo(0, oldY));
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

  const disclosure = event.target.closest(".task-disclosure");
  if (!disclosure) return;
  const taskId = Number(disclosure.dataset.taskId);
  expandedTaskId = expandedTaskId === taskId ? null : taskId;
  renderCurrentTaskList({ preservePosition: true });
  if (expandedTaskId !== null) {
    const reopened = document.querySelector(`.task-disclosure[data-task-id="${expandedTaskId}"]`);
    if (reopened) reopened.focus({ preventScroll: true });
  }
}

function handleTaskContainerAction(event) {
  const action = event.target.closest("[data-action]");
  if (!action) return;
  if (action.dataset.action === "retry-today") loadToday();
  if (action.dataset.action === "show-all-times") setTimeFilter(null);
  if (action.dataset.action === "open-garden") goToTab("garden");
}

function setTimeFilter(minutes) {
  selectedTimeMinutes = minutes;
  document.querySelectorAll(".time-pill").forEach(button => {
    const value = button.dataset.minutes === "all" ? null : Number(button.dataset.minutes);
    const selected = value === selectedTimeMinutes;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  });
  expandedTaskId = null;
  if (todayLoadedFor === currentGardenId) renderCurrentTaskList({ preservePosition: true });
}

function handleTimeFilter(event) {
  const button = event.target.closest(".time-pill");
  if (!button) return;
  setTimeFilter(button.dataset.minutes === "all" ? null : Number(button.dataset.minutes));
}


/* ==========================================================================
 *  MY GARDEN — inventory
 * ========================================================================== */

async function loadInventory() {
  if (!currentGardenId) return;
  const gardenAtRequest = currentGardenId;
  const requestSerial = ++inventoryRequestSerial;
  const inventoryList = document.getElementById("inventory-list");
  const hasCurrentContent = inventoryLoadedFor === gardenAtRequest;
  loadItemPhotos(gardenAtRequest);
  loadIdentifyAccess();
  if (!hasCurrentContent) {
    inventoryList.innerHTML = '<div class="garden-local-status">Seeing what’s growing…</div>';
  } else {
    inventoryList.classList.add("refreshing");
  }

  try {
    const { data, error } = await sb
      .from("garden_item")
      .select("id, friendly_name, legacy_category, blueprint:blueprint_id ( name )")
      .eq("garden_id", gardenAtRequest)
      .is("removed_at", null)
      .order("id");

    if (requestSerial !== inventoryRequestSerial || gardenAtRequest !== currentGardenId) return;
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
    if (requestSerial !== inventoryRequestSerial || gardenAtRequest !== currentGardenId) return;
    console.error("Inventory failed:", err);
    if (await sessionHasGone(err, 0)) { await recoverFromSessionLoss(); return; }
    if (!hasCurrentContent) {
      inventoryList.innerHTML = `
        <div class="garden-inventory-error">
          <p>We couldn’t show your garden. Please try again.</p>
          <button type="button" class="secondary-action-btn" data-action="retry-inventory">Try again</button>
        </div>`;
    }
  } finally {
    if (requestSerial === inventoryRequestSerial) inventoryList.classList.remove("refreshing");
  }
}

const CATEGORY_ART = {
  "Lawn": "category-lawn.svg",
  "Beds": "category-beds.svg",
  "Trees & shrubs": "category-trees-shrubs.svg",
  "Plants & flowers": "category-plants-flowers.svg",
  "Veg & herbs": "category-veg-herbs.svg",
  "Garden structures": "category-structures.svg",
  "Structures": "category-structures.svg",
  "Tools": "category-tools.svg"
};

function categoryArtPath(category) {
  return "assets/wgt/" + (CATEGORY_ART[category] || "category-plants-flowers.svg");
}

function renderGroupedInventory() {
  const displayArea = document.getElementById("inventory-list");
  displayArea.innerHTML = "";

  if (userInventory.length === 0) {
    displayArea.innerHTML = `
      <div class="garden-inventory-empty">
        <h3>You haven’t added anything yet.</h3>
        <p>Choose a category or search above to add something to your garden.</p>
      </div>`;
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

    const groupTitle = document.createElement("h3");
    groupTitle.className = "inventory-group-title";
    groupTitle.innerHTML = `<img src="${categoryArtPath(categoryName)}" alt=""><span>${escapeHtml(categoryName === "Garden structures" ? "Structures" : categoryName)}</span>`;
    groupDiv.appendChild(groupTitle);

    items.forEach(item => {
      const cardDiv = document.createElement("div");
      cardDiv.className = "inventory-item-card";
      const itemId = Number(item.item_id);
      const hasPhoto = itemPhotos.has(itemId);
      const openable = itemDetailAvailable(itemId);
      if (hasPhoto) cardDiv.classList.add("has-photo");

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
      // RM-026: the photo, when there is one, sits left of the name; the row
      // opens item detail only when there is something there to see or do.
      const identityLabel = customRef ? displayName + ", " + customRef : displayName;
      const copyMarkup = `
          <strong>${escapeHtml(displayName)}</strong>
          ${customRef ? `<div class="inventory-item-meta">${escapeHtml(customRef)}</div>` : ""}`;
      cardDiv.innerHTML = `
        ${hasPhoto ? photoThumbMarkup(itemId, identityLabel) : ""}
        ${openable
          ? `<button type="button" class="inventory-item-copy inventory-item-open" data-item-id="${itemId}" aria-label="Open ${escapeHtml(identityLabel)}">${copyMarkup}</button>`
          : `<div class="inventory-item-copy">${copyMarkup}</div>`}
        <button class="remove-asset-btn" type="button" data-item-id="${item.item_id}" data-item-name="${escapeHtml(displayName)}" aria-label="Remove ${escapeHtml(displayName)} from My Garden">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6.5 6.5v9M10 6.5v9M13.5 6.5v9M4.5 5h11M7 5V3.5h6V5M5.5 5l.7 12h7.6l.7-12"/></svg>
        </button>
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
  const requestSerial = ++catalogueRequestSerial;
  const statusEl = document.getElementById("catalogue-status");
  if (statusEl) {
    statusEl.textContent = "Finding plants, tools and structures…";
    statusEl.className = "garden-local-status";
  }
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
    if (requestSerial !== catalogueRequestSerial) return;

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
    if (statusEl) {
      statusEl.textContent = "";
      statusEl.className = "garden-local-status hidden";
    }
    refreshPillBox();
  } catch (err) {
    if (requestSerial !== catalogueRequestSerial) return;
    console.error("Catalogue failed:", err);
    if (await sessionHasGone(err, 0)) { await recoverFromSessionLoss(); return; }
    if (statusEl) {
      statusEl.innerHTML = `We couldn’t load the catalogue. <button type="button" class="text-btn" data-action="retry-catalogue">Try again</button>`;
      statusEl.className = "garden-local-status error";
    }
    setPillPlaceholder("Your saved garden is still available below.");
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
  pill.type = "button";
  pill.className = "item-pill" + (showSource ? " item-pill--result" : "");
  pill.setAttribute("aria-pressed", "false");

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
    document.querySelectorAll(".item-pill").forEach(p => {
      p.classList.remove("selected");
      p.setAttribute("aria-pressed", "false");
    });
    pill.classList.add("selected");
    pill.setAttribute("aria-pressed", "true");
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
    const selected = tile.dataset.category === categoryKey;
    tile.classList.toggle("selected", selected);
    tile.setAttribute("aria-pressed", selected ? "true" : "false");
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
  document.querySelectorAll(".tile-btn").forEach(tile => {
    tile.classList.remove("selected");
    tile.setAttribute("aria-pressed", "false");
  });
  element.classList.add("selected");
  element.setAttribute("aria-pressed", "true");

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
  const busy = submitBtn.dataset.state === "planting" || submitBtn.dataset.state === "success";
  submitBtn.disabled = busy || !(selectedCategoryRef && selectedSubItemObj);
}

function setAddButtonState(state) {
  const btn = document.getElementById("add-asset-btn");
  const label = document.getElementById("add-asset-label");
  if (!btn || !label) return;
  btn.dataset.state = state;
  btn.classList.toggle("planting", state === "planting");
  btn.classList.toggle("success", state === "success");
  label.textContent = state === "planting" ? "Planting…" : state === "success" ? "Added!" : "Add to My Garden";
  validateForm();
}

function setGardenAddError(message) {
  const errorEl = document.getElementById("garden-add-error");
  if (!errorEl) return;
  errorEl.textContent = message || "";
  errorEl.classList.toggle("hidden", !message);
}

async function handleAddAsset() {
  const customName = document.getElementById("custom-name").value.trim();
  const btn = document.getElementById("add-asset-btn");
  if (!selectedCategoryRef || !selectedSubItemObj) return;
  const gardenAtAdd = currentGardenId;
  const categoryAtAdd = selectedCategoryRef;
  const itemAtAdd = selectedSubItemObj;

  setGardenAddError("");
  setAddButtonState("planting");

  try {
    const { error } = await sb.from("garden_item").insert({
      garden_id: gardenAtAdd,
      blueprint_id: itemAtAdd.blueprint_id,
      friendly_name: customName.length > 0 ? customName : null,
      legacy_category: categoryAtAdd   // the tile it was added under -> grouping
    });
    if (error) throw error;
    if (gardenAtAdd !== currentGardenId) return;

    // A slow add must not erase a newer choice made while the request was in
    // flight. When the original choice is still current, keep its category as
    // approved but clear the item and optional reference for the next add.
    const originalChoiceStillCurrent = selectedCategoryRef === categoryAtAdd &&
      selectedSubItemObj && selectedSubItemObj.blueprint_id === itemAtAdd.blueprint_id;
    if (originalChoiceStillCurrent) {
      document.getElementById("custom-name").value = "";
      // Stand the search down and return to browsing the category the item came
      // from, so adding several things there does not mean retyping.
      clearPillSearch();
    }

    setAddButtonState("success");
    const liveStatus = document.getElementById("garden-add-status");
    if (liveStatus) liveStatus.textContent = "Added to My Garden";
    if (gardenAddResetTimer) clearTimeout(gardenAddResetTimer);
    gardenAddResetTimer = setTimeout(() => {
      setAddButtonState("idle");
      if (liveStatus) liveStatus.textContent = "";
      gardenAddResetTimer = null;
    }, 850);

    loadInventory();
    loadToday();
  } catch (error) {
    console.error("Add item error:", error);
    if (gardenAtAdd !== currentGardenId) return;
    if (await sessionHasGone(error, 0)) { await recoverFromSessionLoss(); return; }
    // The per-garden item ceiling (db/11) is the one refusal worth naming: the
    // generic "try again" would send someone round a loop that cannot succeed.
    const full = String((error && error.message) || "").indexOf("maximum of") !== -1;
    setAddButtonState("idle");
    setGardenAddError(full
      ? "This garden is full, so another item can’t be added."
      : "We couldn’t add " + itemAtAdd.Suggested_Name + ". Please try again.");
  }
}


/* ==========================================================================
 *  MY GARDEN — removing an item (modal confirm, then soft delete)
 * ========================================================================== */

function handleRemoveAsset(event) {
  const btn = event.target.closest(".remove-asset-btn");
  if (!btn) return;
  openRemoveItemModal({
    itemId: Number(btn.dataset.itemId),
    itemName: btn.dataset.itemName || "this item",
    gardenId: currentGardenId
  }, btn);
}

function handleGardenViewAction(event) {
  const action = event.target.closest("[data-action]");
  if (!action) return;
  if (action.dataset.action === "retry-inventory") loadInventory();
  if (action.dataset.action === "retry-catalogue") loadCatalogue();
}

function openRemoveItemModal(state, trigger) {
  removeItemState = state;
  removeItemReturnFocus = trigger || null;
  document.getElementById("remove-item-title").textContent = "Remove " + state.itemName + "?";
  // RM-026: removing an item permanently deletes its photo (peer review §2).
  const photoNote = itemPhotos.has(state.itemId)
    ? " Its photo will be permanently deleted."
    : itemPhotosLoadedFor !== state.gardenId ? " If it has a photo, that will be permanently deleted too." : "";
  document.getElementById("remove-item-body").textContent = "This will remove it from My Garden." + photoNote;
  const errorEl = document.getElementById("remove-item-error");
  errorEl.textContent = "";
  errorEl.classList.add("hidden");
  const confirm = document.getElementById("remove-item-confirm-btn");
  confirm.disabled = false;
  confirm.textContent = "Remove";
  document.getElementById("remove-item-modal").classList.remove("hidden");
  requestAnimationFrame(() => document.getElementById("remove-item-cancel-btn").focus());
}

function closeRemoveItemModal(restoreFocus = true) {
  const modal = document.getElementById("remove-item-modal");
  if (!modal) return;
  modal.classList.add("hidden");
  const returnFocus = removeItemReturnFocus;
  removeItemState = null;
  removeItemReturnFocus = null;
  if (restoreFocus && returnFocus && document.contains(returnFocus)) returnFocus.focus();
}

function handleRemoveItemModalKeydown(event) {
  const modal = document.getElementById("remove-item-modal");
  if (!modal || modal.classList.contains("hidden")) return;

  if (event.key === "Escape") {
    event.preventDefault();
    closeRemoveItemModal();
    return;
  }
  if (event.key !== "Tab") return;

  const controls = Array.from(modal.querySelectorAll("button:not([disabled])"));
  if (controls.length === 0) return;
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

async function executeRemoveAsset() {
  if (!removeItemState) return;
  const state = removeItemState;
  const btn = document.getElementById("remove-item-confirm-btn");
  const errorEl = document.getElementById("remove-item-error");
  btn.disabled = true;
  btn.textContent = "Removing…";
  errorEl.textContent = "";
  errorEl.classList.add("hidden");

  try {
    const { error } = await sb
      .from("garden_item")
      .update({ removed_at: new Date().toISOString() })
      .eq("id", state.itemId)
      .eq("garden_id", state.gardenId);
    if (error) throw error;
    if (state.gardenId !== currentGardenId) return;

    userInventory = userInventory.filter(item => Number(item.item_id) !== state.itemId);
    const removedPhoto = itemPhotos.get(state.itemId);
    if (removedPhoto) { itemPhotos.delete(state.itemId); forgetPhotoUrls(removedPhoto.generation_id); }
    closeRemoveItemModal(false);
    renderGroupedInventory();
    showToast(state.itemName + " removed from My Garden.", false);
    loadToday();
  } catch (error) {
    console.error("Remove item error:", error);
    if (state.gardenId !== currentGardenId) return;
    if (await sessionHasGone(error, 0)) { await recoverFromSessionLoss(); return; }
    btn.disabled = false;
    btn.textContent = "Remove";
    errorEl.textContent = "We couldn’t remove " + state.itemName + ". Please try again.";
    errorEl.classList.remove("hidden");
  }
}


/* ==========================================================================
 *  ITEM PHOTOS (RM-026) — one photo on a garden item
 *
 *  DEV pilot (issue #17). The database decides everything that matters —
 *  membership, the RM-026 entitlement, the expected generation, the account
 *  ceiling, what was actually uploaded — through the item-photos Edge Function,
 *  which forwards this caller's session. Nothing here is a security boundary:
 *  hiding a button only keeps the screen honest about what the server allows.
 *
 *  Who can do what (journeys §10.3, §11):
 *    - Add / Change: garden member WITH the RM-026 entitlement;
 *    - View / Remove: any garden member, entitlement or not, so losing the
 *      entitlement never hides or traps a photo.
 *  During the pilot an account without the entitlement sees no Add or Change
 *  control and no discovery prompt — only existing photos, and Remove.
 *
 *  The photo is processed once on the device (Stage 0 §4, §9): decoded by the
 *  browser (which applies EXIF orientation), resized to a 1600 px main image
 *  and a 256 px square thumbnail, re-encoded as JPEG — which drops the
 *  original's metadata — and checked before upload. The original never leaves
 *  the device. Signed read links live in memory for this session only.
 * ========================================================================== */

const PHOTO = {
  BUCKET: "garden-item-photos",          // mirrors item_photo_settings() in the database
  FUNCTION: "item-photos",
  MAX_SOURCE_BYTES: 50 * 1024 * 1024,    // coarse sanity check only (Stage 0 §9 item 6)
  MAX_DECODED_PIXELS: 50000000,          // admits 48 MP; checked from the header BEFORE decoding
  HEADER_BYTES: 1024 * 1024,             // enough to reach a JPEG's size marker past large APP segments
  MAIN_EDGE: 1600,
  MAIN_QUALITY: 0.82,
  THUMB_EDGE: 256,
  THUMB_QUALITY: 0.78,
  MAIN_MAX_BYTES: 2621440,               // the server refuses anything larger
  THUMB_MAX_BYTES: 204800,
  CACHE_CONTROL: "31536000",             // generations are immutable, so a long cache is safe
  SIGN_BATCH: 200,                       // the function's per-call ceiling
  URL_REFRESH_MARGIN_MS: 5 * 60 * 1000   // re-sign a little before the hour runs out
};

/* ---- Pure helpers: no DOM, no network (unit-tested) ----------------------- */

function photoAscii(b, at, length) {
  let s = "";
  for (let i = at; i < at + length && i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}

/* Reads EXIF IFD entries from a TIFF block. Returns every tag seen, by IFD,
 * and the IFD0 orientation. Bounded and cycle-safe: it is fed untrusted bytes. */
function readTiffTags(b, start, end) {
  if (start + 8 > end) return null;
  const le = b[start] === 0x49 && b[start + 1] === 0x49;
  const be = b[start] === 0x4D && b[start + 1] === 0x4D;
  if (!le && !be) return null;
  const u16 = o => le ? (b[o] | (b[o + 1] << 8)) : ((b[o] << 8) | b[o + 1]);
  const u32 = o => le
    ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 16777216
    : b[o] * 16777216 + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
  const result = { tags: [], orientation: 1 };
  const seen = new Set();
  const walk = (offset, ifd, depth) => {
    const at = start + offset;
    if (depth > 4 || offset < 8 || at + 2 > end || seen.has(at)) return;
    seen.add(at);
    const count = u16(at);
    for (let k = 0; k < count; k++) {
      const entry = at + 2 + k * 12;
      if (entry + 12 > end) break;
      const tag = u16(entry);
      result.tags.push({ ifd, tag, value: u16(entry + 8) });
      if (ifd === "0" && tag === 0x0112) result.orientation = u16(entry + 8);
      if (tag === 0x8769) walk(u32(entry + 8), "exif", depth + 1);
      if (tag === 0x8825) walk(u32(entry + 8), "gps", depth + 1);
      if (tag === 0xA005) walk(u32(entry + 8), "interop", depth + 1);
    }
    const nextAt = at + 2 + count * 12;
    if (ifd === "0" && nextAt + 4 <= end) {
      const next = u32(nextAt);
      if (next) walk(next, "1", depth + 1);
    }
  };
  walk(u32(start + 4), "0", 0);
  return result;
}

/* Walks a JPEG's segments up to the image data, handing each one to visit().
 * visit(marker, dataStart, dataEnd) may return true to stop early. */
function walkJpegSegments(b, visit) {
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xFF) return;
    const marker = b[i + 1];
    if (marker === 0xFF) { i += 1; continue; }                              // fill byte
    if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD8)) { i += 2; continue; }
    if (marker === 0xD9 || marker === 0xDA) return;                          // end, or image data
    const length = (b[i + 2] << 8) | b[i + 3];
    if (length < 2) return;
    if (visit(marker, i + 4, Math.min(i + 2 + length, b.length))) return;
    i += 2 + length;
  }
}

function readJpegHeader(b) {
  const header = { format: "jpeg", width: 0, height: 0, orientation: 1 };
  walkJpegSegments(b, (marker, start, end) => {
    if (marker === 0xE1 && photoAscii(b, start, 6) === "Exif\0\0") {
      const tiff = readTiffTags(b, start + 6, end);
      if (tiff) header.orientation = tiff.orientation;
    }
    const isFrame = marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC;
    if (isFrame && start + 5 <= end) {
      header.height = (b[start + 1] << 8) | b[start + 2];
      header.width = (b[start + 3] << 8) | b[start + 4];
      return true;
    }
    return false;
  });
  return header.width && header.height ? header : null;
}

/* HEIF/AVIF: the largest 'ispe' (image spatial extent) property. Encoded
 * dimensions, before any 'irot' rotation — fine for a pixel-count guard. */
function readHeifHeader(b) {
  let width = 0;
  let height = 0;
  for (let i = 4; i + 16 <= b.length; i++) {
    if (b[i] === 0x69 && b[i + 1] === 0x73 && b[i + 2] === 0x70 && b[i + 3] === 0x65) {   // "ispe"
      const w = b[i + 8] * 16777216 + ((b[i + 9] << 16) | (b[i + 10] << 8) | b[i + 11]);
      const h = b[i + 12] * 16777216 + ((b[i + 13] << 16) | (b[i + 14] << 8) | b[i + 15]);
      if (w * h > width * height) { width = w; height = h; }
    }
  }
  return width && height ? { format: "heif", width, height, orientation: 1 } : null;
}

/* Encoded width/height (and JPEG orientation) from the first bytes of a file,
 * or null when the format is not recognised — the decoder then decides, and
 * a post-decode check is the backstop. */
function readImageHeader(b) {
  if (!b || b.length < 12) return null;
  if (b[0] === 0xFF && b[1] === 0xD8) return readJpegHeader(b);
  if (b[0] === 0x89 && photoAscii(b, 1, 3) === "PNG" && b.length >= 24) {
    const w = b[16] * 16777216 + ((b[17] << 16) | (b[18] << 8) | b[19]);
    const h = b[20] * 16777216 + ((b[21] << 16) | (b[22] << 8) | b[23]);
    return { format: "png", width: w, height: h, orientation: 1 };
  }
  if (photoAscii(b, 0, 3) === "GIF") {
    return { format: "gif", width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8), orientation: 1 };
  }
  if (photoAscii(b, 0, 4) === "RIFF" && photoAscii(b, 8, 4) === "WEBP" && b.length >= 30) {
    const chunk = photoAscii(b, 12, 4);
    if (chunk === "VP8X") {
      return { format: "webp", width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)), orientation: 1 };
    }
    if (chunk === "VP8 ") {
      return { format: "webp", width: (b[26] | (b[27] << 8)) & 0x3FFF, height: (b[28] | (b[29] << 8)) & 0x3FFF, orientation: 1 };
    }
    if (chunk === "VP8L") {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { format: "webp", width: (bits & 0x3FFF) + 1, height: ((bits >>> 14) & 0x3FFF) + 1, orientation: 1 };
    }
    return null;
  }
  if (photoAscii(b, 4, 4) === "ftyp") return readHeifHeader(b);
  return null;
}

function photoPixelsAllowed(width, height) {
  return width > 0 && height > 0 && width * height <= PHOTO.MAX_DECODED_PIXELS;
}

/* Longest edge at most maxEdge, aspect ratio kept, never upscaled. */
function photoMainSize(width, height, maxEdge = PHOTO.MAIN_EDGE) {
  const longest = Math.max(width, height);
  const scale = longest > maxEdge ? maxEdge / longest : 1;
  return {
    width: Math.min(maxEdge, Math.max(1, Math.round(width * scale))),
    height: Math.min(maxEdge, Math.max(1, Math.round(height * scale)))
  };
}

/* The centred square a 'cover' thumbnail is cut from. */
function photoThumbCrop(width, height) {
  const side = Math.min(width, height);
  return { sx: Math.floor((width - side) / 2), sy: Math.floor((height - side) / 2), side };
}

function isJpegBytes(b) {
  return !!b && b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF;
}

/* Tags that would locate, date or identify a photo or its owner. Safari's
 * encoder writes its own small Exif block (colour space and pixel dimensions),
 * so the check is for what must NOT be there, not for no Exif at all.
 * Orientation is refused only when it asks for a rotation or mirror: a value
 * of 1 ("as stored") is harmless after the decoder has already turned the
 * pixels upright, and an encoder may write it. */
const PHOTO_FORBIDDEN_TAGS = {
  0x010E: "description", 0x010F: "camera make", 0x0110: "camera model",
  0x0112: "orientation", 0x0132: "date", 0x013B: "artist", 0x013C: "host computer",
  0x8298: "copyright", 0x8825: "location", 0x9003: "date taken", 0x9004: "date digitised",
  0x9010: "time offset", 0x9011: "time offset", 0x9012: "time offset",
  0x927C: "maker note", 0x9286: "comment", 0x9290: "sub-second time",
  0x9291: "sub-second time", 0x9292: "sub-second time", 0xA420: "image id",
  0xA430: "owner name", 0xA431: "serial number", 0xA433: "lens make",
  0xA434: "lens model", 0xA435: "lens serial number"
};

/* IPTC datasets an encoder writes as housekeeping: envelope version, file
 * format and character set (record 1) and the application record's version
 * (2:00). Anything else in record 2 — caption, keywords, dates, places,
 * authors — or a dated envelope entry is refused. */
const IPTC_HOUSEKEEPING = new Set(["1:0", "1:20", "1:22", "1:90", "2:0"]);

/* What a Photoshop/IPTC (APP13) block holds beyond an encoder's own
 * housekeeping. Safari writes a small one when it re-encodes a camera photo;
 * a canvas re-encode cannot copy the original's, so this is a backstop. A
 * block that cannot be read counts as a problem: refusing is the safe failure. */
function iptcProblems(b, start, end) {
  if (photoAscii(b, start, 14) !== "Photoshop 3.0\0") return ["IPTC"];
  const problems = [];
  let i = start + 14;
  while (i + 12 <= end) {
    if (photoAscii(b, i, 4) !== "8BIM") { problems.push("IPTC"); break; }
    const id = (b[i + 4] << 8) | b[i + 5];
    const nameField = 1 + b[i + 6];                              // Pascal string, padded to even
    const sizeAt = i + 6 + nameField + (nameField % 2);
    if (sizeAt + 4 > end) { problems.push("IPTC"); break; }
    const size = b[sizeAt] * 16777216 + ((b[sizeAt + 1] << 16) | (b[sizeAt + 2] << 8) | b[sizeAt + 3]);
    const dataStart = sizeAt + 4;
    const dataEnd = dataStart + size;
    if (dataEnd > end) { problems.push("IPTC"); break; }
    if (id === 0x0422 || id === 0x0423) problems.push("Exif in IPTC");
    if (id === 0x0424) problems.push("XMP");
    if (id === 0x0404) {
      for (let k = dataStart; k < dataEnd;) {
        if (b[k] === 0x00) break;                                // trailing padding
        if (b[k] !== 0x1C || k + 5 > dataEnd || (b[k + 3] & 0x80)) { problems.push("IPTC"); break; }
        const name = b[k + 1] + ":" + b[k + 2];
        if (!IPTC_HOUSEKEEPING.has(name)) problems.push("IPTC " + name);
        k += 5 + ((b[k + 3] << 8) | b[k + 4]);
      }
    }
    i = dataEnd + (size % 2);
  }
  return problems;
}

/* What a JPEG still carries that it must not: [] means clean. */
function jpegMetadataProblems(b) {
  const problems = [];
  if (!isJpegBytes(b)) return ["not a JPEG"];
  walkJpegSegments(b, (marker, start, end) => {
    if (marker === 0xE1 && photoAscii(b, start, 6) === "Exif\0\0") {
      const tiff = readTiffTags(b, start + 6, end);
      for (const t of (tiff ? tiff.tags : [])) {
        if (t.ifd === "gps") problems.push("location");
        else if (t.tag === 0x0112 && t.value === 1) continue;
        else if (PHOTO_FORBIDDEN_TAGS[t.tag]) problems.push(PHOTO_FORBIDDEN_TAGS[t.tag]);
      }
    }
    if (marker === 0xE1 && photoAscii(b, start, 28) === "http://ns.adobe.com/xap/1.0/") problems.push("XMP");
    if (marker === 0xED) problems.push(...iptcProblems(b, start, end));
    return false;
  });
  return Array.from(new Set(problems));
}

/* ---- Processing (browser) ------------------------------------------------- */

class PhotoProblem extends Error {
  constructor(kind, details = []) { super(kind); this.kind = kind; this.details = details; }
}

/* The DEV pilot shows what a refused photo still carried, so a device test can
 * say exactly what an encoder wrote. Never on the public addresses. */
function photoDiagnosticsWanted(location = window.location) {
  const host = (location && location.hostname) || "";
  return !/(^|\.)whatgardeningtoday\.com$/.test(host) && !/\.github\.io$/.test(host);
}

function photoProblemMessage(error, withDetails = false) {
  const kind = error && error.kind;
  if (kind === "too_large") return "That photo is too large to use. Try another photo.";
  if (kind === "metadata") {
    const details = withDetails && error.details && error.details.length ? " (Found: " + error.details.join(", ") + ".)" : "";
    return "That photo couldn’t be prepared safely. Try another photo." + details;
  }
  return "That photo couldn’t be used. Try another photo.";
}

async function decodePhotoSource(file) {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);   // applies EXIF orientation by default
      return { image: bitmap, width: bitmap.width, height: bitmap.height, close: () => { if (bitmap.close) bitmap.close(); } };
    } catch (e) { /* fall back to the slower image-element decode */ }
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  try {
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return {
      image: img, width: img.naturalWidth, height: img.naturalHeight,
      close: () => { img.removeAttribute("src"); URL.revokeObjectURL(url); }
    };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw new PhotoProblem("unsupported");
  }
}

/* Draws straight into a derivative-sized canvas — never a source-sized one —
 * and releases it as soon as the JPEG exists. */
function encodePhotoDerivative(image, sx, sy, sw, sh, dw, dh, quality) {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = dw;
    canvas.height = dh;
    const ctx = canvas.getContext("2d");
    if (!ctx) { reject(new PhotoProblem("unsupported")); return; }
    ctx.fillStyle = "#FFFFFF";        // JPEG has no transparency
    ctx.fillRect(0, 0, dw, dh);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, sx, sy, sw, sh, 0, 0, dw, dh);
    canvas.toBlob(blob => {
      canvas.width = 0;
      canvas.height = 0;
      if (blob) resolve(blob); else reject(new PhotoProblem("unsupported"));
    }, "image/jpeg", quality);
  });
}

async function checkPhotoDerivative(blob, maxBytes) {
  if (!blob || blob.type !== "image/jpeg") throw new PhotoProblem("unsupported");
  if (blob.size > maxBytes) throw new PhotoProblem("too_large");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (!isJpegBytes(bytes)) throw new PhotoProblem("unsupported");
  const problems = jpegMetadataProblems(bytes);
  if (problems.length > 0) throw new PhotoProblem("metadata", problems);
}

async function processItemPhoto(file) {
  if (!file || !file.size || /svg/i.test(file.type || "")) throw new PhotoProblem("unsupported");
  if (file.size > PHOTO.MAX_SOURCE_BYTES) throw new PhotoProblem("too_large");

  // Decoding is where the memory goes, so the pixel count is judged first.
  const head = new Uint8Array(await file.slice(0, PHOTO.HEADER_BYTES).arrayBuffer());
  const header = readImageHeader(head);
  if (header && !photoPixelsAllowed(header.width, header.height)) throw new PhotoProblem("too_large");

  const source = await decodePhotoSource(file);
  try {
    if (!photoPixelsAllowed(source.width, source.height)) throw new PhotoProblem("too_large");
    // A diagnostic only: an axis-swapping orientation whose decoded size was
    // not swapped. Never "corrected" here — the decoder owns orientation.
    if (header && header.orientation >= 5 && header.orientation <= 8 && header.width !== header.height
        && source.width === header.width && source.height === header.height) {
      console.warn("Photo orientation may not have been applied by this browser.");
    }
    const size = photoMainSize(source.width, source.height);
    const main = await encodePhotoDerivative(source.image, 0, 0, source.width, source.height,
      size.width, size.height, PHOTO.MAIN_QUALITY);
    const crop = photoThumbCrop(source.width, source.height);
    const thumb = await encodePhotoDerivative(source.image, crop.sx, crop.sy, crop.side, crop.side,
      PHOTO.THUMB_EDGE, PHOTO.THUMB_EDGE, PHOTO.THUMB_QUALITY);
    await checkPhotoDerivative(main, PHOTO.MAIN_MAX_BYTES);
    await checkPhotoDerivative(thumb, PHOTO.THUMB_MAX_BYTES);
    return { main, thumb, width: size.width, height: size.height };
  } finally {
    source.close();
  }
}

/* ---- State ---------------------------------------------------------------- */

let photoEntitlement = { userId: null, known: false, value: false };
let itemPhotos = new Map();            // garden_item_id -> { generation_id, width, height }
let itemPhotosLoadedFor = null;        // which garden itemPhotos describes
let itemPhotosRequestSerial = 0;
const photoUrlCache = new Map();       // "<generation>:thumb|image" -> { url, expiresAt } — memory only
let photoDetail = null;                // the open item detail; see openItemDetail()
let photoOpSerial = 0;                 // stale-response guard for item detail work
let photoViewer = null;
let photoViewerSerial = 0;

function photoEntitled() {
  return photoEntitlement.known && photoEntitlement.userId === currentUserId && photoEntitlement.value;
}

function itemDetailAvailable(itemId) {
  return photoEntitled() || itemPhotos.has(Number(itemId));
}

function photoUrl(generationId, variant) {
  const hit = photoUrlCache.get(generationId + ":" + variant);
  return hit && hit.expiresAt > Date.now() ? hit.url : null;
}

function forgetPhotoUrls(generationId) {
  photoUrlCache.delete(generationId + ":thumb");
  photoUrlCache.delete(generationId + ":image");
}

function inventoryItem(itemId) {
  return userInventory.find(item => Number(item.item_id) === Number(itemId)) || null;
}

function itemIdentity(item) {
  const name = item.blueprint_name || item.friendly_name || "Item";
  const reference = (item.friendly_name && item.blueprint_name && item.friendly_name !== item.blueprint_name)
    ? item.friendly_name : "";
  return { name, reference, label: reference ? name + ", " + reference : name };
}

/* Called on garden switch and sign-out: nothing photo-related may carry over. */
function resetItemPhotoState() {
  itemPhotosRequestSerial += 1;
  itemPhotos = new Map();
  itemPhotosLoadedFor = null;
  closePhotoViewer(false);
  closePhotoRemoveModal(false);
  closeItemDetail(false);
}

function forgetPhotoSession() {
  resetItemPhotoState();
  photoUrlCache.clear();
  photoEntitlement = { userId: null, known: false, value: false };
}

/* ---- Server calls ----------------------------------------------------------- */

async function callItemPhotos(body) {
  try {
    const { data, error } = await sb.functions.invoke(PHOTO.FUNCTION, { body });
    if (!error) return { ok: true, data: data || {} };
    let status = 0;
    let reason = "";
    const response = error.context;
    if (response && typeof response.json === "function") {
      status = response.status || 0;
      try { reason = ((await response.json()) || {}).error || ""; } catch (e) { /* not JSON */ }
    }
    return { ok: false, status, reason };
  } catch (e) {
    return { ok: false, status: 0, reason: "" };
  }
}

/* Loads the RM-026 entitlement (once per signed-in user) and this garden's
 * photo list, then signs thumbnail links for any photo without a fresh one.
 * Re-renders only when something visible changed, so a garden with no photos,
 * seen by an account without the entitlement, never redraws. */
async function loadItemPhotos(gardenId) {
  if (!gardenId) return;
  const serial = ++itemPhotosRequestSerial;
  const userAtRequest = currentUserId;
  const wasEntitled = photoEntitled();
  const hadPhotos = itemPhotosLoadedFor === gardenId && itemPhotos.size > 0;
  const entitlementWanted = !(photoEntitlement.known && photoEntitlement.userId === userAtRequest);

  const [entitlement, list] = await Promise.all([
    entitlementWanted ? sb.rpc("item_photos_entitled").then(r => r, () => null) : Promise.resolve(null),
    sb.rpc("item_photo_list", { p_garden_id: gardenId }).then(r => r, () => null)
  ]);
  if (currentUserId !== userAtRequest) return;
  if (entitlement && !entitlement.error) {
    photoEntitlement = { userId: userAtRequest, known: true, value: entitlement.data === true };
  }
  if (serial !== itemPhotosRequestSerial || gardenId !== currentGardenId) return;
  if (!list || list.error) {
    // The inventory itself reports garden-level failures. Photos stay unknown,
    // which the remove-item warning allows for.
    if (photoEntitled() !== wasEntitled) rerenderPhotoSurfaces();
    return;
  }

  itemPhotos = new Map((list.data || []).map(row => [
    Number(row.garden_item_id),
    { generation_id: row.generation_id, width: row.width, height: row.height }
  ]));
  itemPhotosLoadedFor = gardenId;
  if (itemPhotos.size > 0 || hadPhotos || photoEntitled() !== wasEntitled) rerenderPhotoSurfaces();
  if (itemPhotos.size === 0) return;

  const signed = await ensurePhotoUrls(gardenId, Array.from(itemPhotos.keys()), false);
  if (serial !== itemPhotosRequestSerial || gardenId !== currentGardenId) return;
  if (signed) rerenderPhotoSurfaces();
}

/* Signs links for the listed items that lack a fresh one. The function signs
 * only what the database says this caller may see. Returns true if anything
 * new arrived. */
async function ensurePhotoUrls(gardenId, itemIds, includeImage) {
  const wanted = itemIds.map(Number).filter(id => {
    const photo = itemPhotos.get(id);
    if (!photo) return false;
    return !photoUrl(photo.generation_id, "thumb") || (includeImage && !photoUrl(photo.generation_id, "image"));
  });
  if (wanted.length === 0) return false;

  let changed = false;
  for (let i = 0; i < wanted.length; i += PHOTO.SIGN_BATCH) {
    const res = await callItemPhotos({
      action: "sign",
      garden_id: gardenId,
      garden_item_ids: wanted.slice(i, i + PHOTO.SIGN_BATCH),
      include_image: includeImage
    });
    if (!res.ok) {
      if (res.status === 401 && await sessionHasGone(null, 401)) { await recoverFromSessionLoss(); }
      return changed;
    }
    if (gardenId !== currentGardenId) return changed;
    const expiresAt = Date.now() + (Number(res.data.expires_in) || 3600) * 1000 - PHOTO.URL_REFRESH_MARGIN_MS;
    for (const p of (res.data.photos || [])) {
      const id = Number(p.garden_item_id);
      const known = itemPhotos.get(id);
      // The server's current generation wins over a list read moments earlier.
      if (known && known.generation_id !== p.generation_id) {
        itemPhotos.set(id, { generation_id: p.generation_id, width: p.width, height: p.height });
      }
      if (p.thumb_url) photoUrlCache.set(p.generation_id + ":thumb", { url: p.thumb_url, expiresAt });
      if (p.image_url) photoUrlCache.set(p.generation_id + ":image", { url: p.image_url, expiresAt });
      changed = true;
    }
  }
  return changed;
}

function rerenderPhotoSurfaces() {
  if (inventoryLoadedFor === currentGardenId) renderGroupedInventory();
  if (photoDetail) renderItemDetail();
}

/* ---- My Garden thumbnail ---------------------------------------------------- */

function photoThumbMarkup(itemId, label) {
  const photo = itemPhotos.get(Number(itemId));
  if (!photo) return "";
  const url = photoUrl(photo.generation_id, "thumb");
  return `<button type="button" class="inventory-item-photo" data-photo-item-id="${Number(itemId)}" aria-label="View photo of ${escapeHtml(label)}">${
    url ? `<img class="inventory-photo-img" src="${escapeHtml(url)}" alt="" width="64" height="64" decoding="async">` : ""
  }</button>`;
}

function handleInventoryPhotoClick(event) {
  const thumb = event.target.closest(".inventory-item-photo");
  if (thumb) { openPhotoViewer(Number(thumb.dataset.photoItemId), null); return; }
  const open = event.target.closest(".inventory-item-open");
  if (open) openItemDetail(Number(open.dataset.itemId), open);
}

/* A broken thumbnail leaves the calm placeholder, never a broken-image icon.
 * Listened for in the capture phase, because image errors do not bubble. */
function handlePhotoImageError(event) {
  const img = event.target;
  if (!img || img.tagName !== "IMG") return;
  if (img.classList.contains("inventory-photo-img")) { img.remove(); return; }
  if (img.classList.contains("item-detail-img") && photoDetail) {
    photoDetail.imageFailed = true;
    renderItemDetail();
  }
}

/* ---- Item detail -------------------------------------------------------------- */

function openItemDetail(itemId, trigger) {
  if (!inventoryItem(itemId) || !itemDetailAvailable(itemId)) return;
  photoDetail = {
    itemId: Number(itemId),
    gardenId: currentGardenId,
    step: "idle",          // idle | choosing | processing | confirming | saving | failed
    mode: null,            // add | change
    pickerReturnState: null, // restore the current view if the native picker is cancelled
    pending: null,         // { main, thumb, width, height, previewUrl? } kept for Retry
    message: "",
    messageIsError: false,
    imageFailed: false,
    token: ++photoOpSerial
  };
  renderItemDetail();
  showAccessibleModal("item-detail-modal", "close-item-detail-modal");
  if (trigger) modalFocusReturn.set("item-detail-modal", trigger);   // the row, not a rebuilt copy of it
  loadDetailImage(photoDetail.token);
}

async function loadDetailImage(token) {
  const d = photoDetail;
  if (!d || !itemPhotos.has(d.itemId)) return;
  const photo = itemPhotos.get(d.itemId);
  if (photoUrl(photo.generation_id, "image")) return;
  const gardenId = d.gardenId;
  await ensurePhotoUrls(gardenId, [d.itemId], true);
  if (!photoDetail || photoDetail.token !== token) return;
  if (!photoUrl((itemPhotos.get(d.itemId) || photo).generation_id, "image")) photoDetail.imageFailed = true;
  renderItemDetail();
}

function closeItemDetail(restoreFocus = true) {
  if (photoDetail) discardPendingPhoto(photoDetail);
  photoDetail = null;
  photoOpSerial += 1;
  hideAccessibleModal("item-detail-modal", restoreFocus);
}

function discardPendingPhoto(d) {
  if (d && d.pending && d.pending.previewUrl) URL.revokeObjectURL(d.pending.previewUrl);
  if (d) d.pending = null;
}

function isCurrentPhotoOp(token) {
  return !!photoDetail && photoDetail.token === token && photoDetail.gardenId === currentGardenId;
}

function setDetailMessage(d, message, isError) {
  d.message = message;
  d.messageIsError = !!isError;
}

function renderItemDetail(focusFirstAction = false) {
  const d = photoDetail;
  if (!d) return;
  const item = inventoryItem(d.itemId);
  if (!item || d.gardenId !== currentGardenId) { closeItemDetail(false); return; }
  const who = itemIdentity(item);
  const photo = itemPhotos.get(d.itemId) || null;
  const entitled = photoEntitled();
  const viewStep = d.step === "choosing" && d.pickerReturnState ? d.pickerReturnState.step : d.step;

  document.getElementById("item-detail-title").textContent = who.name;
  const refEl = document.getElementById("item-detail-reference");
  refEl.textContent = who.reference;
  refEl.classList.toggle("hidden", !who.reference);

  // The photo area. A replacement is previewed here before it is used; the
  // current photo stays until a new one has been safely saved.
  const area = document.getElementById("item-detail-photo");
  if (viewStep === "confirming" && d.pending && d.pending.previewUrl) {
    area.innerHTML = `<img class="item-detail-preview" src="${escapeHtml(d.pending.previewUrl)}" alt="The new photo for ${escapeHtml(who.label)}">`;
  } else if (photo) {
    const image = d.imageFailed ? null : photoUrl(photo.generation_id, "image");
    const thumb = photoUrl(photo.generation_id, "thumb");
    const shown = image || thumb;
    area.innerHTML = `
      <button type="button" class="item-detail-photo-btn" data-photo-action="view" aria-label="View photo of ${escapeHtml(who.label)}">
        ${shown ? `<img class="item-detail-img" src="${escapeHtml(shown)}" alt="" decoding="async">` : ""}
      </button>
      ${d.imageFailed ? `
        <div class="item-detail-photo-problem">
          <p>Photo unavailable</p>
          <button type="button" class="secondary-action-btn" data-photo-action="retry-image">Try again</button>
        </div>` : ""}`;
    const ratio = photo.width && photo.height ? photo.width + " / " + photo.height : "4 / 3";
    area.style.setProperty("--photo-ratio", ratio);
  } else {
    area.innerHTML = "";
  }
  area.classList.toggle("hidden", area.innerHTML.trim() === "");

  const status = document.getElementById("item-detail-status");
  status.textContent = d.message;
  status.classList.toggle("is-error", d.messageIsError);
  status.classList.toggle("hidden", !d.message);

  const buttons = [];
  const button = (action, label, kind) =>
    `<button type="button" class="${kind}" data-photo-action="${action}">${label}</button>`;
  if (viewStep === "idle") {
    if (photo) {
      if (entitled) buttons.push(button("change", "Change photo", "secondary-action-btn"));
      buttons.push(button("remove", "Remove photo", "photo-remove-btn"));
    } else if (entitled) {
      buttons.push(button("add", "Add photo", "primary-action-btn"));
    }


  } else if (viewStep === "confirming") {
    buttons.push(button("use", "Use this photo", "primary-action-btn"));
    buttons.push(button("another", "Try another photo", "secondary-action-btn"));
    buttons.push(button("cancel", "Cancel", "photo-text-btn"));
  } else if (viewStep === "failed") {
    if (d.pending) buttons.push(button("retry", "Retry", "primary-action-btn"));
    buttons.push(button("another", "Try another photo", d.pending ? "secondary-action-btn" : "primary-action-btn"));
    buttons.push(button("cancel", "Cancel", "photo-text-btn"));
  }
  const actions = document.getElementById("item-detail-actions");
  actions.innerHTML = buttons.join("");
  actions.classList.toggle("hidden", buttons.length === 0);

  if (focusFirstAction) {
    const first = actions.querySelector("button") || document.getElementById("close-item-detail-modal");
    requestAnimationFrame(() => { if (first && document.contains(first)) first.focus(); });
  }
}

function handleItemDetailAction(event) {
  const control = event.target.closest("[data-photo-action]");
  const d = photoDetail;
  if (!control || !d) return;
  const action = control.dataset.photoAction;

  if (action === "view") { openPhotoViewer(d.itemId, "item-detail-modal"); return; }
  if (action === "retry-image") {
    const photo = itemPhotos.get(d.itemId);
    if (photo) photoUrlCache.delete(photo.generation_id + ":image");
    d.imageFailed = false;
    renderItemDetail();
    loadDetailImage(d.token);
    return;
  }
  if (action === "add" || action === "change" || action === "another") {
    if (!photoEntitled()) return;
    if (d.step !== "choosing") d.pickerReturnState = { step: d.step, mode: d.mode };
    if (action !== "another") d.mode = action;
    d.step = "choosing";
    // Open inside the tap: the device/browser owns camera, library and file choices.
    // Keep the existing view and pending preview intact until a file is selected.
    const input = document.getElementById("photo-input");
    input.value = "";
    input.click();
    return;
  }
  if (action === "cancel") {
    discardPendingPhoto(d);
    d.step = "idle";
    d.mode = null;
    d.pickerReturnState = null;
    d.token = ++photoOpSerial;
    setDetailMessage(d, "", false);
    renderItemDetail(true);
    return;
  }
  if (action === "use" || action === "retry") { savePendingPhoto(); return; }
  if (action === "remove") openPhotoRemoveModal();
}

function handlePhotoPickerCancelled() {
  const d = photoDetail;
  if (!d || d.step !== "choosing" || !d.pickerReturnState) return;
  const before = d.pickerReturnState;
  d.step = before.step;
  d.mode = before.mode;
  d.pickerReturnState = null;
  renderItemDetail(true);
}

async function handlePhotoFileChosen(event) {
  const input = event.target;
  const file = input.files && input.files[0];
  input.value = "";
  const d = photoDetail;
  if (!file) { handlePhotoPickerCancelled(); return; }
  if (!d || d.step !== "choosing" || !photoEntitled()) return;
  d.pickerReturnState = null;

  const token = d.token = ++photoOpSerial;
  discardPendingPhoto(d);
  d.step = d.mode === "change" ? "processing" : "saving";
  setDetailMessage(d, d.mode === "change" ? "Preparing photo…" : "Saving photo…", false);
  renderItemDetail();

  let processed;
  try {
    processed = await processItemPhoto(file);
  } catch (error) {
    if (!isCurrentPhotoOp(token)) return;
    if (!(error instanceof PhotoProblem)) console.error("Photo processing failed:", error);
    d.step = "failed";
    setDetailMessage(d, photoProblemMessage(error, photoDiagnosticsWanted()), true);
    renderItemDetail(true);
    return;
  }
  if (!isCurrentPhotoOp(token)) return;
  d.pending = processed;

  if (d.mode === "change") {
    d.pending.previewUrl = URL.createObjectURL(processed.main);
    d.step = "confirming";
    setDetailMessage(d, "", false);
    renderItemDetail(true);
    return;
  }
  savePendingPhoto();
}

/* begin → two signed uploads → commit, shared by item detail and the RM-015
 * identification journey. Returns { abandoned } once stillHere() fails, the
 * failed call's { ok: false, status, reason }, or { ok: true, photo }. */
async function uploadItemPhoto(itemId, pending, expected, stillHere) {
  const begin = await callItemPhotos({ action: "begin", garden_item_id: itemId, expected_generation_id: expected });
  if (!stillHere()) return { abandoned: true };
  if (!begin.ok) return begin;

  try {
    const uploads = begin.data.uploads || {};
    const bucket = sb.storage.from(begin.data.bucket || PHOTO.BUCKET);
    const options = { contentType: "image/jpeg", cacheControl: PHOTO.CACHE_CONTROL };
    const results = await Promise.all([
      bucket.uploadToSignedUrl(uploads.image.path, uploads.image.token, pending.main, options),
      bucket.uploadToSignedUrl(uploads.thumb.path, uploads.thumb.token, pending.thumb, options)
    ]);
    const failed = results.find(r => r && r.error);
    if (failed) throw failed.error;
  } catch (error) {
    console.error("Photo upload failed:", error);
    if (!stillHere()) return { abandoned: true };
    return { ok: false, status: 0, reason: "upload_failed" };
  }
  if (!stillHere()) return { abandoned: true };

  const commit = await callItemPhotos({
    action: "commit", garden_item_id: itemId, generation_id: begin.data.generation_id,
    width: pending.width, height: pending.height, expected_generation_id: expected
  });
  if (!stillHere()) return { abandoned: true };
  if (!commit.ok) return commit;
  const saved = commit.data.photo || {};
  return {
    ok: true,
    photo: {
      generation_id: saved.generation_id || begin.data.generation_id,
      width: saved.width || pending.width,
      height: saved.height || pending.height
    }
  };
}

function recordSavedPhoto(gardenId, itemId, photo, before) {
  itemPhotos.set(itemId, photo);
  itemPhotosLoadedFor = gardenId;
  if (before) forgetPhotoUrls(before.generation_id);
}

/* Item-detail Add/Change. Once the uploads have started the save is carried
 * through even if this screen is closed; only a garden switch or
 * sign-out abandons it (an uncommitted upload is swept up later). The screen
 * is updated only while it still shows the same attempt. */
async function savePendingPhoto() {
  const d = photoDetail;
  if (!d || !d.pending || !photoEntitled()) return;
  const token = d.token = ++photoOpSerial;
  const pending = d.pending;
  const gardenId = d.gardenId;
  const itemId = d.itemId;
  const userAtStart = currentUserId;
  const before = itemPhotos.get(itemId) || null;
  const expected = d.mode === "change" && before ? before.generation_id : null;
  const stillHere = () => currentGardenId === gardenId && currentUserId === userAtStart;

  d.step = "saving";
  setDetailMessage(d, "Saving photo…", false);
  renderItemDetail();

  const res = await uploadItemPhoto(itemId, pending, expected, stillHere);
  if (res.abandoned) return;
  if (!res.ok) { photoSaveFailed(token, res); return; }
  recordSavedPhoto(gardenId, itemId, res.photo, before);

  if (isCurrentPhotoOp(token)) {
    discardPendingPhoto(photoDetail);
    photoDetail.step = "idle";
    photoDetail.mode = null;
    photoDetail.imageFailed = false;
    setDetailMessage(photoDetail, "Photo saved.", false);
    renderItemDetail(true);
  }
  if (inventoryLoadedFor === gardenId) renderGroupedInventory();
  await ensurePhotoUrls(gardenId, [itemId], true);
  if (stillHere()) rerenderPhotoSurfaces();
}

function photoSaveFailed(token, res) {
  if (res.status === 401) {
    sessionHasGone(null, 401).then(gone => { if (gone) recoverFromSessionLoss(); });
    return;
  }
  const reason = res.reason || "";
  if (reason === "item_unavailable" || reason === "item_removed") {
    if (isCurrentPhotoOp(token)) closeItemDetail(false);
    showToast("That item is no longer in this garden.", false);
    loadInventory();
    return;
  }
  if (!isCurrentPhotoOp(token)) return;
  const d = photoDetail;

  if (reason === "not_entitled") {
    photoEntitlement = { userId: currentUserId, known: true, value: false };
    discardPendingPhoto(d);
    d.step = "idle";
    d.mode = null;
    setDetailMessage(d, "Photos can’t be added on this account.", true);
    rerenderPhotoSurfaces();
    return;
  }
  if (reason === "photo_exists" || reason === "stale_generation" || reason === "generation_in_use") {
    discardPendingPhoto(d);
    d.step = "idle";
    d.mode = null;
    setDetailMessage(d, "This item’s photo was just changed somewhere else, so this one wasn’t saved.", true);
    renderItemDetail(true);
    loadItemPhotos(d.gardenId);
    return;
  }
  if (reason === "account_ceiling") {
    discardPendingPhoto(d);
    d.step = "idle";
    d.mode = null;
    setDetailMessage(d, "Photo not saved. This account has reached its photo limit.", true);
    renderItemDetail(true);
    return;
  }
  // Anything else — connection, Storage, an expired upload — is worth a retry
  // with the photo already prepared.
  d.step = "failed";
  setDetailMessage(d, "Photo not saved", true);
  renderItemDetail(true);
}

/* ---- Remove photo ------------------------------------------------------------ */

function openPhotoRemoveModal() {
  const d = photoDetail;
  if (!d || !itemPhotos.has(d.itemId)) return;
  const errorEl = document.getElementById("photo-remove-error");
  errorEl.textContent = "";
  errorEl.classList.add("hidden");
  const confirm = document.getElementById("photo-remove-confirm-btn");
  confirm.disabled = false;
  confirm.textContent = "Remove photo";
  showAccessibleModal("photo-remove-modal", "photo-remove-cancel-btn", "item-detail-modal");
}

function closePhotoRemoveModal(restoreFocus = true) {
  hideAccessibleModal("photo-remove-modal", restoreFocus);
}

/* The photo stays on screen until the server confirms it is gone. */
async function confirmPhotoRemove() {
  const d = photoDetail;
  const photo = d ? itemPhotos.get(d.itemId) : null;
  if (!d || !photo) { closePhotoRemoveModal(); return; }
  const token = d.token = ++photoOpSerial;
  const gardenId = d.gardenId;
  const itemId = d.itemId;
  const confirm = document.getElementById("photo-remove-confirm-btn");
  const errorEl = document.getElementById("photo-remove-error");
  confirm.disabled = true;
  confirm.textContent = "Removing…";
  errorEl.classList.add("hidden");

  const res = await callItemPhotos({ action: "remove", garden_item_id: itemId, expected_generation_id: photo.generation_id });
  if (gardenId !== currentGardenId) return;

  if (res.ok || res.reason === "no_photo") {
    itemPhotos.delete(itemId);
    forgetPhotoUrls(photo.generation_id);
    closePhotoRemoveModal(false);
    if (inventoryLoadedFor === gardenId) renderGroupedInventory();
    if (isCurrentPhotoOp(token)) {
      photoDetail.imageFailed = false;
      setDetailMessage(photoDetail, "Photo removed.", false);
      renderItemDetail(true);
    }
    return;
  }
  if (res.status === 401 && await sessionHasGone(null, 401)) { await recoverFromSessionLoss(); return; }
  if (res.reason === "stale_generation") {
    closePhotoRemoveModal(false);
    if (isCurrentPhotoOp(token)) {
      setDetailMessage(photoDetail, "This item’s photo was just changed somewhere else. Check it before removing it.", true);
      renderItemDetail(true);
    }
    loadItemPhotos(gardenId);
    return;
  }
  if (res.reason === "item_unavailable" || res.reason === "item_removed") {
    closePhotoRemoveModal(false);
    photoSaveFailed(token, res);
    return;
  }
  confirm.disabled = false;
  confirm.textContent = "Remove photo";
  errorEl.textContent = "Couldn’t remove this photo. Check your connection and try again.";
  errorEl.classList.remove("hidden");
}

/* ---- Full-screen viewer ------------------------------------------------------ */

function openPhotoViewer(itemId, parentModalId) {
  const item = inventoryItem(itemId);
  const photo = itemPhotos.get(Number(itemId));
  if (!item || !photo) return;
  const serial = ++photoViewerSerial;
  photoViewer = { itemId: Number(itemId), gardenId: currentGardenId, serial };
  document.getElementById("photo-viewer-title").textContent = "Photo of " + itemIdentity(item).label;
  const stage = document.getElementById("photo-viewer-stage");
  stage.classList.remove("zoomed");
  showPhotoViewerImage(photoUrl(photo.generation_id, "image") || photoUrl(photo.generation_id, "thumb"));
  showAccessibleModal("photo-viewer", "close-photo-viewer", parentModalId);
  if (!photoUrl(photo.generation_id, "image")) loadPhotoViewerImage(serial);
}

async function loadPhotoViewerImage(serial) {
  const v = photoViewer;
  if (!v) return;
  setPhotoViewerProblem(false);
  await ensurePhotoUrls(v.gardenId, [v.itemId], true);
  if (!photoViewer || photoViewer.serial !== serial) return;
  const photo = itemPhotos.get(v.itemId);
  const url = photo ? photoUrl(photo.generation_id, "image") : null;
  if (url) showPhotoViewerImage(url); else setPhotoViewerProblem(true);
}

function showPhotoViewerImage(url) {
  const img = document.getElementById("photo-viewer-img");
  if (url) { img.src = url; img.classList.remove("hidden"); }
  else { img.removeAttribute("src"); img.classList.add("hidden"); }
}

function setPhotoViewerProblem(show) {
  document.getElementById("photo-viewer-problem").classList.toggle("hidden", !show);
}

function closePhotoViewer(restoreFocus = true) {
  photoViewer = null;
  photoViewerSerial += 1;
  const img = document.getElementById("photo-viewer-img");
  if (img) img.removeAttribute("src");
  hideAccessibleModal("photo-viewer", restoreFocus);
}

function handlePhotoViewerClick(event) {
  if (event.target.closest("#close-photo-viewer")) { closePhotoViewer(); return; }
  if (event.target.closest("#photo-viewer-retry")) {
    const v = photoViewer;
    const photo = v ? itemPhotos.get(v.itemId) : null;
    if (photo) photoUrlCache.delete(photo.generation_id + ":image");
    if (v) loadPhotoViewerImage(v.serial);
    return;
  }
  // Tap the photo to see it at full size; tap again to fit it to the screen.
  if (event.target.id === "photo-viewer-img") {
    document.getElementById("photo-viewer-stage").classList.toggle("zoomed");
  }
}

function handlePhotoViewerImageError() {
  if (photoViewer) setPhotoViewerProblem(true);
}


/* ==========================================================================
 *  IDENTIFY FROM PHOTO (RM-015) — inside My Garden's Add
 *
 *  Issue #41, Dan-only pilot. The plant-identification Edge Function decides
 *  everything that matters — the signed-in caller, the separate RM-015
 *  entitlement, the operator pause, both usage ceilings and how the evidence
 *  is classified and which choices may be offered — so nothing here is a
 *  security boundary. has_entitlement is asked only so the button is offered
 *  to the account that may use it, before any photo is requested; a pause or
 *  usage limit is refused by the backend before any provider call is made.
 *
 *  One journey at a time, carried in identifyJourney with a token. Every
 *  await is followed by identifyCurrent(token), so a late reply, a garden
 *  switch or sign-out can never paint into or save to another journey or
 *  garden. Steps:
 *    choosing → preparing → preview → identifying → result → adding
 *      → attaching (RM-026 entitled accounts only) → finished
 *  with problem (photo/offline/service/limits/paused), uncertain (the Add
 *  may or may not have landed) and photo_failed (item saved, photo not) as
 *  the other ways out. The photo is prepared once, by the item-photo
 *  pipeline, and the same processed JPEG is attached; it is never kept
 *  beyond this foreground journey.
 * ========================================================================== */

const IDENTIFY = {
  FUNCTION: "plant-identification",
  PRODUCT: "FEATURE_PLANT_IDENTIFICATION",   // the separate RM-015 entitlement
  CHOICE_LIMIT: 3,
  PHOTO_TIP: "One plant, close up and in good light, usually works best."
};

let identifyAccess = { userId: null, known: false, value: false };
let identifyJourney = null;
let identifySerial = 0;

function identifyAvailable() {
  return identifyAccess.known && identifyAccess.userId === currentUserId && identifyAccess.value;
}

function identifyCurrent(token) {
  const j = identifyJourney;
  return !!j && j.token === token && j.gardenId === currentGardenId && j.userId === currentUserId;
}

/* Once per signed-in user. A failed read leaves the button hidden: offering
 * something that may be refused helps nobody, and ordinary search remains. */
async function loadIdentifyAccess() {
  const userAtRequest = currentUserId;
  if (!userAtRequest) return;
  if (!(identifyAccess.known && identifyAccess.userId === userAtRequest)) {
    let res = null;
    try { res = await sb.rpc("has_entitlement", { p_code: IDENTIFY.PRODUCT }); } catch (e) { res = null; }
    if (currentUserId !== userAtRequest) return;
    if (res && !res.error) identifyAccess = { userId: userAtRequest, known: true, value: res.data === true };
  }
  renderIdentifyEntry();
}

function renderIdentifyEntry() {
  const entry = document.getElementById("identify-entry");
  if (entry) entry.classList.toggle("hidden", !identifyAvailable());
}

function forgetIdentifySession() {
  closeIdentify({ forced: true });
  identifyAccess = { userId: null, known: false, value: false };
  renderIdentifyEntry();
}

function releaseIdentifyPhoto(j) {
  if (j && j.previewUrl) URL.revokeObjectURL(j.previewUrl);
  if (j) { j.previewUrl = null; j.photo = null; }
}

/* The catalogue entry for a mapped blueprint, filed under the first of its
 * categories in display order, exactly as if it had been picked there. */
function identifyCatalogueItem(blueprintId) {
  const entries = globalDictionary.filter(entry => entry.blueprint_id === blueprintId);
  if (entries.length === 0) return null;
  const rank = category => { const i = CATEGORY_ORDER.indexOf(category); return i === -1 ? CATEGORY_ORDER.length : i; };
  return entries.slice().sort((a, b) => rank(a.Category) - rank(b.Category))[0];
}

/* The backend has already chosen and ordered what may be offered; this only
 * attaches WGT names. An unmapped choice keeps its place. */
function identifyChoices(data) {
  const raw = Array.isArray(data && data.choices) ? data.choices : [];
  return raw.slice(0, IDENTIFY.CHOICE_LIMIT).filter(choice => choice && typeof choice === "object").map(choice => {
    const catalogue = choice.catalogue && typeof choice.catalogue === "object" ? choice.catalogue : null;
    const item = catalogue ? identifyCatalogueItem(Number(catalogue.blueprint_id)) : null;
    const commonNames = Array.isArray(choice.common_names) ? choice.common_names : [];
    return {
      item,
      unshown: !!catalogue && !item,          // mapped, but this device's catalogue can't show it
      genusOnly: choice.evidence_type === "genus",
      broad: choice.evidence_type === "genus" || (!!catalogue && catalogue.mapping_rank === "genus"),
      botanical: String(choice.scientific_name || choice.genus || ""),
      common: typeof commonNames[0] === "string" ? commonNames[0] : ""
    };
  });
}

function identifyRetryTime(iso) {
  const at = iso ? new Date(iso) : null;
  if (!at || isNaN(at.getTime())) return "";
  const time = at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const now = new Date();
  if (at.toDateString() === now.toDateString()) return time;
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (at.toDateString() === tomorrow.toDateString()) return time + " tomorrow";
  return at.toLocaleDateString("en-GB", { weekday: "long" }) + " at " + time;
}

/* ---- Server call ------------------------------------------------------------ */

async function callPlantIdentification(blob) {
  const form = new FormData();
  form.append("image", blob, "plant.jpg");
  try {
    const { data, error } = await sb.functions.invoke(IDENTIFY.FUNCTION, { body: form });
    if (!error) return { ok: true, status: 200, data: data || {} };
    let status = 0;
    let body = {};
    const response = error.context;
    if (response && typeof response.json === "function") {
      status = response.status || 0;
      try { body = (await response.json()) || {}; } catch (e) { /* not JSON */ }
    }
    return { ok: false, status, data: body };
  } catch (e) {
    return { ok: false, status: 0, data: {} };
  }
}

function identifyProblemKind(res) {
  const reason = (res.data && res.data.error) || "";
  if (reason === "not_entitled") return "unavailable";
  if (reason === "capability_disabled") return "paused";
  if (reason === "user_limit") return "user_limit";
  if (reason === "global_limit" || reason === "provider_quota") return "busy";
  if (["invalid_image", "wrong_image_type", "image_too_large", "identifying_metadata"].indexOf(reason) !== -1) return "photo";
  if (res.status === 0 && navigator.onLine === false) return "offline";
  return "service";
}

/* ---- Journey ---------------------------------------------------------------- */

function startIdentify() {
  if (!identifyAvailable() || !currentGardenId) return;
  // A picker whose cancel the browser never reported leaves "choosing"
  // behind with nothing on screen; starting again simply replaces it.
  if (identifyJourney && identifyJourney.step !== "choosing") return;
  identifyJourney = {
    token: ++identifySerial,
    gardenId: currentGardenId,
    userId: currentUserId,
    step: "choosing",
    pickerReturn: null,     // the view to restore if Try another photo is cancelled
    photo: null,            // { main, thumb, width, height } from processItemPhoto
    previewUrl: null,
    result: null,
    latencyMs: null,
    selectedId: null,
    addError: "",
    problem: null,          // { kind, message?, retryAt? }
    itemId: null,           // set once, by the one successful Add
    itemName: "",
    photoProblem: ""
  };
  openIdentifyPicker();
}

function openIdentifyPicker() {
  // Inside the tap: the device/browser owns camera, library and file choices.
  const input = document.getElementById("identify-input");
  if (!input) return;
  input.value = "";
  input.click();
}

function identifyAnotherPhoto() {
  const j = identifyJourney;
  if (!j || ["preview", "result", "problem"].indexOf(j.step) === -1) return;
  j.pickerReturn = j.step;
  j.step = "choosing";
  openIdentifyPicker();
}

function handleIdentifyPickerCancelled() {
  const j = identifyJourney;
  if (!j || j.step !== "choosing") return;
  if (!j.pickerReturn) { identifyJourney = null; return; }   // nothing was ever shown
  j.step = j.pickerReturn;
  j.pickerReturn = null;
  renderIdentify(true);
}

async function handleIdentifyFileChosen(event) {
  const input = event.target;
  const file = input.files && input.files[0];
  input.value = "";
  if (!file) { handleIdentifyPickerCancelled(); return; }
  const j = identifyJourney;
  if (!j || j.step !== "choosing" || j.gardenId !== currentGardenId || j.userId !== currentUserId) return;

  const token = j.token = ++identifySerial;
  releaseIdentifyPhoto(j);
  Object.assign(j, { pickerReturn: null, result: null, latencyMs: null, selectedId: null, addError: "", problem: null });
  j.step = "preparing";
  openIdentifyModal();
  renderIdentify();

  let processed;
  try {
    processed = await processItemPhoto(file);
  } catch (error) {
    if (!identifyCurrent(token)) return;
    if (!(error instanceof PhotoProblem)) console.error("Photo processing failed:", error);
    j.step = "problem";
    j.problem = { kind: "photo", message: photoProblemMessage(error, photoDiagnosticsWanted()) };
    renderIdentify(true);
    return;
  }
  if (!identifyCurrent(token)) return;
  j.photo = processed;
  j.previewUrl = URL.createObjectURL(processed.main);
  j.step = "preview";
  renderIdentify(true);
}

/* One press, one dispatch: the step leaves "preview" before the request is
 * made, so a repeated tap finds nothing to do. Nothing retries by itself. */
async function runIdentification() {
  const j = identifyJourney;
  if (!j || j.step !== "preview" || !j.photo) return;
  if (navigator.onLine === false) {
    j.step = "problem";
    j.problem = { kind: "offline" };
    renderIdentify(true);
    return;
  }
  const token = j.token = ++identifySerial;
  j.step = "identifying";
  renderIdentify();

  const started = Date.now();
  const res = await callPlantIdentification(j.photo.main);
  if (!identifyCurrent(token)) return;
  j.latencyMs = Date.now() - started;

  if (res.ok) {
    j.result = res.data;
    const offered = identifyChoices(res.data).filter(choice => choice.item);
    const single = res.data.outcome === "strong" || res.data.outcome === "genus";
    j.selectedId = single && offered.length === 1 ? offered[0].item.blueprint_id : null;
    j.step = "result";
    renderIdentify(true);
    return;
  }
  if (res.status === 401 && await sessionHasGone(null, 401)) { await recoverFromSessionLoss(); return; }
  if (!identifyCurrent(token)) return;
  const kind = identifyProblemKind(res);
  if (kind === "unavailable") {
    identifyAccess = { userId: currentUserId, known: true, value: false };
    renderIdentifyEntry();
  }
  j.step = "problem";
  j.problem = { kind, retryAt: res.data && res.data.retry_at };
  renderIdentify(true);
}

function selectIdentifiedItem(blueprintId) {
  const j = identifyJourney;
  if (!j || j.step !== "result") return;
  const offered = identifyChoices(j.result).some(choice => choice.item && choice.item.blueprint_id === blueprintId);
  if (!offered) return;
  j.selectedId = blueprintId;
  j.addError = "";
  renderIdentify(`[data-blueprint-id="${blueprintId}"]`);
}

/* The insert is the commit point. A definite refusal can be retried; an
 * answer that never arrived cannot be, because the item may already exist. */
async function addIdentifiedItem() {
  const j = identifyJourney;
  if (!j || j.step !== "result" || j.selectedId === null || j.itemId) return;
  const item = identifyCatalogueItem(j.selectedId);
  if (!item || !identifyCurrent(j.token)) return;
  if (navigator.onLine === false) {
    j.addError = "You seem to be offline, so nothing was added. Connect and try again.";
    renderIdentify();
    return;
  }
  const referenceEl = document.getElementById("identify-reference-input");
  const reference = referenceEl ? referenceEl.value.trim() : "";
  const token = j.token = ++identifySerial;
  const journey = j;
  j.step = "adding";
  j.addError = "";
  j.itemName = item.Suggested_Name;
  renderIdentify();

  let data = null;
  let error = null;
  try {
    ({ data, error } = await sb.from("garden_item").insert({
      garden_id: j.gardenId,
      blueprint_id: item.blueprint_id,
      friendly_name: reference.length > 0 ? reference : null,
      legacy_category: item.Category
    }).select("id").single());
  } catch (e) {
    error = e;
  }

  if (!identifyCurrent(token)) {
    // Only a forced close (garden switch) can get here mid-insert. The item
    // still exists in the garden it was added to, and the person is told so.
    if (!error && data && currentUserId === journey.userId) {
      const garden = gardens.find(g => g.id === journey.gardenId);
      showToast(item.Suggested_Name + " was added to " + (garden ? garden.name : "your other garden") + ".", false);
    }
    return;
  }
  if (error) {
    console.error("Add identified item error:", error);
    if (await sessionHasGone(error, 0)) { await recoverFromSessionLoss(); return; }
    if (!identifyCurrent(token)) return;
    if (!error.code) {
      j.step = "uncertain";
      renderIdentify(true);
      loadInventory();
      return;
    }
    const full = String(error.message || "").indexOf("maximum of") !== -1;
    j.step = "result";
    j.addError = full
      ? "This garden is full, so another item can’t be added."
      : item.Suggested_Name + " couldn’t be added. Please try again.";
    renderIdentify(true);
    return;
  }

  j.itemId = Number(data && data.id);
  loadInventory();
  loadToday();
  if (j.itemId && photoEntitled()) { attachIdentifiedPhoto(); return; }
  finishIdentify(j.itemName + " added to My Garden.");
}

/* Item first, photo second: the same processed image, never a second Add. */
async function attachIdentifiedPhoto() {
  const j = identifyJourney;
  if (!j || !j.itemId || !j.photo || (j.step !== "adding" && j.step !== "photo_failed")) return;
  const token = j.token = ++identifySerial;
  const gardenId = j.gardenId;
  const itemId = j.itemId;
  const userAtStart = j.userId;
  const stillHere = () => currentGardenId === gardenId && currentUserId === userAtStart;
  j.step = "attaching";
  j.photoProblem = "";
  renderIdentify();

  // Carried through even if the sheet is closed, like an item-detail save;
  // only a garden switch or sign-out abandons it.
  const res = await uploadItemPhoto(itemId, j.photo, null, stillHere);
  if (res.abandoned) return;
  if (res.ok) {
    recordSavedPhoto(gardenId, itemId, res.photo, null);
    if (inventoryLoadedFor === gardenId) renderGroupedInventory();
    ensurePhotoUrls(gardenId, [itemId], false).then(signed => { if (signed && stillHere()) rerenderPhotoSurfaces(); });
    if (identifyCurrent(token)) finishIdentify(j.itemName + " added to My Garden with its photo.");
    return;
  }
  if (res.status === 401 && await sessionHasGone(null, 401)) { await recoverFromSessionLoss(); return; }
  if (!identifyCurrent(token)) return;
  j.step = "photo_failed";
  j.photoProblem = res.reason || "";
  renderIdentify(true);
}

function identifyPhotoRetryable(reason) {
  return ["not_entitled", "account_ceiling", "item_unavailable", "item_removed", "photo_exists"].indexOf(reason) === -1;
}

function finishIdentify(message) {
  closeIdentify({ finished: true });
  showToast(message, false);
}

/* Every way out. Before Add nothing exists to mention; after Add the person
 * is told the item is there. A forced close (garden switch, sign-out) never
 * waits; an ordinary close waits for an Add in flight to answer. */
function closeIdentify(options = {}) {
  const j = identifyJourney;
  if (j && j.step === "adding" && !options.forced && !options.finished) return;
  identifyJourney = null;
  identifySerial += 1;
  const reference = document.getElementById("identify-reference-input");
  if (reference) reference.value = "";
  hideAccessibleModal("identify-modal", !options.forced);
  if (!j) return;
  releaseIdentifyPhoto(j);
  if (!j.itemId || options.finished) return;
  if (options.forced) {
    if (options.gardenSwitch) {
      const garden = gardens.find(g => g.id === j.gardenId);
      showToast(j.itemName + " was added to " + (garden ? garden.name : "your other garden") + ".", false);
    }
    return;
  }
  showToast(j.step === "attaching"
    ? j.itemName + " added to My Garden. Its photo is still saving."
    : j.itemName + " added to My Garden" + (j.step === "photo_failed" ? " without its photo." : "."), false);
}

function identifySearchInstead() {
  closeIdentify();
  const search = document.getElementById("pill-search");
  if (search) {
    search.focus();
    if (search.scrollIntoView) search.scrollIntoView({ block: "center" });
  }
}

function identifyCheckGarden() {
  closeIdentify();
  const inventory = document.getElementById("garden-inventory-title");
  if (inventory && inventory.scrollIntoView) inventory.scrollIntoView({ block: "start" });
}

function openIdentifyModal() {
  const modal = document.getElementById("identify-modal");
  if (!modal || !modal.classList.contains("hidden")) return;
  showAccessibleModal("identify-modal", "close-identify-modal");
  const trigger = document.getElementById("identify-btn");
  if (trigger) modalFocusReturn.set("identify-modal", trigger);
}

function handleIdentifyModalClick(event) {
  const modal = document.getElementById("identify-modal");
  if (event.target === modal || event.target.closest("#close-identify-modal")) { closeIdentify(); return; }
  const control = event.target.closest("[data-identify-action]");
  if (!control || control.disabled) return;
  const action = control.dataset.identifyAction;
  // A tap on the sheet means the picker has gone, whether or not the browser
  // reported its cancel; restore the view it was opened from.
  if (identifyJourney && identifyJourney.step === "choosing" && identifyJourney.pickerReturn) {
    identifyJourney.step = identifyJourney.pickerReturn;
    identifyJourney.pickerReturn = null;
  }
  if (action === "identify") runIdentification();
  else if (action === "retry") {
    const j = identifyJourney;
    if (j && j.step === "problem" && j.photo) { j.step = "preview"; runIdentification(); }
  }
  else if (action === "another") identifyAnotherPhoto();
  else if (action === "select") selectIdentifiedItem(Number(control.dataset.blueprintId));
  else if (action === "add") addIdentifiedItem();
  else if (action === "retry-photo") attachIdentifiedPhoto();
  else if (action === "search") identifySearchInstead();
  else if (action === "check-garden") identifyCheckGarden();
  else if (action === "cancel" || action === "done") closeIdentify();
}

/* ---- Presentation ------------------------------------------------------------- */

function identifyLead(heading, note) {
  return `<p class="identify-lead">${heading}</p>` + (note ? `<p class="identify-note">${note}</p>` : "");
}

function identifyBotanicalLine(choice) {
  const parts = [];
  if (choice.botanical) parts.push(`<i>${escapeHtml(choice.botanical)}</i>`);
  if (choice.common && choice.item) parts.push(escapeHtml(choice.common));
  if (choice.genusOnly) parts.push("exact type unclear");
  return parts.join(" · ");
}

function identifyChoiceMarkup(choice, selectedId, eyebrow) {
  const line = identifyBotanicalLine(choice);
  if (choice.item) {
    const selected = choice.item.blueprint_id === selectedId;
    return `<button type="button" class="identify-choice${selected ? " selected" : ""}" data-identify-action="select"
        data-blueprint-id="${Number(choice.item.blueprint_id)}" aria-pressed="${selected}">
      ${eyebrow ? `<span class="identify-choice-eyebrow">${eyebrow}</span>` : ""}
      <span class="identify-choice-name">${escapeHtml(choice.item.Suggested_Name)}</span>
      ${line ? `<span class="identify-choice-latin">${line}</span>` : ""}
      ${selected ? `<span class="identify-choice-selected" aria-hidden="true">✓ Selected</span>` : ""}
    </button>`;
  }
  const name = choice.common || choice.botanical;
  const note = choice.unshown ? "Can’t be shown just now. Try searching for it." : "Not in WGT yet";
  return `<div class="identify-choice is-unavailable">
      ${eyebrow ? `<span class="identify-choice-eyebrow">${eyebrow}</span>` : ""}
      <span class="identify-choice-name">${escapeHtml(name)}</span>
      ${choice.common && choice.botanical ? `<span class="identify-choice-latin"><i>${escapeHtml(choice.botanical)}</i></span>` : ""}
      <span class="identify-choice-note">${note}</span>
    </div>`;
}

function identifyResultMarkup(j) {
  const data = j.result || {};
  const outcome = data.outcome;
  const choices = identifyChoices(data);
  if (choices.length === 0) {
    return outcome === "not_identified"
      ? identifyLead("No plant could be identified in this photo.", IDENTIFY.PHOTO_TIP)
      : identifyLead("The plant couldn’t be identified clearly from this photo.", IDENTIFY.PHOTO_TIP);
  }
  if (outcome === "ambiguous") {
    const any = choices.some(choice => choice.item);
    return identifyLead(choices.length > 1 ? "It could be one of these." : "It might be this.",
        any ? "Choose the one that matches, or search if none of them do." : "None of these are in WGT yet. Search below if it might be something else.") +
      `<div class="identify-choices">${choices.map(choice => identifyChoiceMarkup(choice, j.selectedId, "")).join("")}</div>`;
  }
  const choice = choices[0];
  const eyebrow = choice.broad ? "This looks like a kind of" : "This looks like";
  let note = "";
  if (!choice.item && choice.genusOnly) {
    note = "The exact plant isn’t clear from this photo, so it can’t be matched to an item in WGT. Search for it, or try a closer photo.";
  } else if (!choice.item && !choice.unshown) {
    note = "That plant isn’t in WGT yet, so it can’t be added. Search if you think it’s something else.";
  } else if (choice.item && choice.broad) {
    note = "WGT’s advice for " + escapeHtml(choice.item.Suggested_Name) + " suits this whole group of plants.";
  }
  return `<div class="identify-choices">${identifyChoiceMarkup(choice, j.selectedId, eyebrow)}</div>` +
    (note ? `<p class="identify-note">${note}</p>` : "");
}

function identifyProblemMarkup(problem) {
  const when = identifyRetryTime(problem.retryAt);
  switch (problem.kind) {
    case "photo": return identifyLead(escapeHtml(problem.message || "That photo couldn’t be used. Try another photo."), "");
    case "offline": return identifyLead("You seem to be offline.", "Nothing has been sent. Connect and try again.");
    case "user_limit": return identifyLead("You’ve used all your photo identifications for now.",
      (when ? "You can identify another plant after " + escapeHtml(when) + ". " : "") + "You can still search for the plant.");
    case "busy": return identifyLead("Photo identification is busy today.",
      (when ? "Try again after " + escapeHtml(when) + ". " : "") + "You can still search for the plant.");
    case "paused": return identifyLead("Photo identification is paused just now.", "You can still search for the plant.");
    case "unavailable": return identifyLead("Photo identification isn’t available on this account.", "You can still search for the plant.");
    default: return identifyLead("The photo couldn’t be identified just now.",
      "Trying again counts as another identification. You can also search for the plant.");
  }
}

function identifyPhotoFailedNote(reason) {
  if (reason === "not_entitled") return "Photos can’t be added on this account.";
  if (reason === "account_ceiling") return "This account has reached its photo limit.";
  if (reason === "item_unavailable" || reason === "item_removed") return "That item is no longer in this garden.";
  if (reason === "photo_exists") return "It already has a photo.";
  return "Check your connection and retry, or add a photo later from the item in My Garden.";
}

/* DEV-only evaluation evidence for the issue #41 real-photo calibration.
 * Never on the public addresses, which is why raw scores may appear. */
function identifyDiagnosticsMarkup(j) {
  if (!photoDiagnosticsWanted() || !j.result) return "";
  const d = j.result;
  const row = entry => {
    const name = escapeHtml(entry.scientific_name || entry.genus || "?");
    const score = typeof entry.score === "number" ? entry.score.toFixed(3) : "?";
    const map = entry.catalogue ? " → " + escapeHtml(String(entry.catalogue.mapping_rank)) + " #" + Number(entry.catalogue.blueprint_id) : "";
    return `<li>${name} ${score}${map}</li>`;
  };
  const list = rows => Array.isArray(rows) && rows.length ? `<ol>${rows.map(row).join("")}</ol>` : "<p>None</p>";
  const usage = d.usage || {};
  const left = value => value === undefined || value === null ? "?" : escapeHtml(String(value));
  const photo = j.photo ? `${j.photo.width}×${j.photo.height}, ${j.photo.main.size} bytes` : "";
  return `<details class="identify-diagnostics"><summary>Evaluation details (DEV only)</summary>
    <p>Outcome ${escapeHtml(String(d.outcome || ""))}${d.reason ? " (" + escapeHtml(String(d.reason)) + ")" : ""}
      · model ${escapeHtml(String(d.provider_version || "unknown"))} · ${Number(j.latencyMs) || 0} ms
      · left ${left(usage.user_remaining)} you / ${left(usage.global_remaining)} all
      · photo ${escapeHtml(photo)}</p>
    <p>Species</p>${list(d.candidates)}<p>Genus</p>${list(d.genus_evidence)}</details>`;
}

function identifyBodyMarkup(j, view) {
  const name = escapeHtml(j.itemName);
  switch (view) {
    case "preparing": return identifyLead("Preparing photo…", "");
    case "preview": return identifyLead("Check the photo shows the plant clearly.",
      "Identify sends this photo to Pl@ntNet, which suggests what the plant might be. " + IDENTIFY.PHOTO_TIP);
    case "identifying": return identifyLead("Identifying the plant…", "");
    case "result": return identifyResultMarkup(j) + identifyDiagnosticsMarkup(j);
    case "adding": return identifyLead("Adding " + name + "…", "");
    case "attaching": return identifyLead(name + " is in My Garden.", "Saving its photo…");
    case "photo_failed": return identifyLead(name + " is in My Garden, but its photo wasn’t saved.",
      identifyPhotoFailedNote(j.photoProblem));
    case "uncertain": return identifyLead("It isn’t clear whether " + name + " was added.",
      "Check My Garden before adding it again, so it isn’t added twice.");
    case "problem": return identifyProblemMarkup(j.problem || {});
    default: return "";
  }
}

function identifyActionsMarkup(j, view, selected) {
  const b = (action, label, kind, disabled) =>
    `<button type="button" class="${kind}" data-identify-action="${action}"${disabled ? " disabled" : ""}>${label}</button>`;
  const cancel = b("cancel", "Cancel", "photo-text-btn");
  const search = kind => b("search", "Search instead", kind);
  switch (view) {
    case "preparing":
    case "identifying": return cancel;
    case "preview": return b("identify", "Identify", "primary-action-btn") + b("another", "Try another photo", "secondary-action-btn") + cancel;
    case "result": return (selected ? b("add", "Add to My Garden", "primary-action-btn") : "") +
      b("another", "Try another photo", selected ? "secondary-action-btn" : "primary-action-btn") + search("photo-text-btn") + cancel;
    case "adding": return b("add", "Adding…", "primary-action-btn", true);
    case "attaching": return "";
    case "photo_failed": return (identifyPhotoRetryable(j.photoProblem) ? b("retry-photo", "Retry photo", "primary-action-btn") : "") +
      b("done", "Done", identifyPhotoRetryable(j.photoProblem) ? "secondary-action-btn" : "primary-action-btn");
    case "uncertain": return b("check-garden", "Check My Garden", "primary-action-btn");
    case "problem": {
      const kind = (j.problem || {}).kind;
      if (kind === "photo") return b("another", "Try another photo", "primary-action-btn") + search("secondary-action-btn") + cancel;
      if (kind === "offline" || kind === "service") return b("retry", "Try again", "primary-action-btn") + search("secondary-action-btn") + cancel;
      return search("primary-action-btn") + cancel;
    }
    default: return "";
  }
}

function renderIdentify(focus = false) {
  const j = identifyJourney;
  if (!j) return;
  const view = j.step === "choosing" && j.pickerReturn ? j.pickerReturn : j.step;
  const modal = document.getElementById("identify-modal");

  const photoEl = document.getElementById("identify-photo");
  const showPhoto = !!j.previewUrl && ["preview", "identifying", "result"].indexOf(view) !== -1;
  photoEl.innerHTML = showPhoto ? `<img class="identify-preview" src="${escapeHtml(j.previewUrl)}" alt="The photo to identify">` : "";
  photoEl.classList.toggle("hidden", !showPhoto);
  photoEl.classList.toggle("is-compact", view === "result");

  document.getElementById("identify-body").innerHTML = identifyBodyMarkup(j, view);

  const selected = view === "result" && j.selectedId !== null;
  document.getElementById("identify-reference").classList.toggle("hidden", !selected);
  const errorEl = document.getElementById("identify-error");
  const errorText = view === "result" ? j.addError : "";
  errorEl.textContent = errorText;
  errorEl.classList.toggle("hidden", !errorText);

  const actions = document.getElementById("identify-actions");
  actions.innerHTML = identifyActionsMarkup(j, view, selected);
  actions.classList.toggle("hidden", actions.innerHTML === "");

  if (focus) {
    requestAnimationFrame(() => {
      const target = (typeof focus === "string" && modal && modal.querySelector(focus)) ||
        actions.querySelector("button:not([disabled])") || document.getElementById("close-identify-modal");
      if (target && document.contains(target)) target.focus();
    });
  }
}


/* ==========================================================================
 *  SWIPE-TO-REVEAL "HIDE" GESTURE  (unchanged — purely visual)
 * ========================================================================== */

function onCardPointerDown(e) {
  const wrapper = e.target.closest(".task-card-wrapper");
  if (!wrapper) return;
  if (wrapper.classList.contains("completed")) return; // completed cards don't swipe
  // Completion and explicit Hide are ordinary controls, not drag handles.
  // Ignoring their pointerdown avoids a small sideways finger movement from
  // priming the swipe state or suppressing the intended click.
  if (e.target.closest(".task-action-btn, .hide-task-btn")) return;

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
  invalidateTodayRequestForLocalMutation();
  const removed = removeTodayTaskFromClient(taskId);
  const task = removed.task;

  if (currentlyRevealedWrapper === wrapper) currentlyRevealedWrapper = null;
  if (wrapper) wrapper.remove();

  const hideState = {
    type: "hide",
    taskId,
    taskName,
    task,
    taskIndex: removed.index,
    gardenId: gardenAtHide
  };

  try {
    const { error } = await sb.from("hidden_task").insert({
      garden_id: gardenAtHide,
      task_id: taskId
    });
    // 23505 = already hidden (unique key). That's a success, not a failure.
    if (error && error.code !== "23505") throw error;
    if (gardenAtHide !== currentGardenId) return;
    // Undo must follow the insert: a faster delete would otherwise undo nothing.
    showUndoToast(hideState);
  } catch (error) {
    console.error("Hide task error:", error);
    if (gardenAtHide !== currentGardenId) return;
    if (await sessionHasGone(error, 0)) { await recoverFromSessionLoss(); return; }
    hideToast();
    restoreTodayTaskToClient(task, removed.index);
    renderCurrentTaskList({ preservePosition: true });
    showTaskStatus("We couldn’t hide “" + taskName + "”. Please try again.", true);
  }
}

/* One banner, two jobs: the undoable "task hidden", and a plain notice with
 * nothing to undo ("Mum's garden deleted"). The notice class hides the button.
 * It lives outside #app-root in the markup, so a notice still shows on the
 * setup screen — which is exactly where you land after deleting your last
 * garden. */
function showToast(message, withUndo) {
  if (toastTimeout) { clearTimeout(toastTimeout); toastTimeout = null; }
  if (!withUndo) undoToastState = null;

  const toast = document.getElementById("undo-toast");
  if (!toast) return;
  document.getElementById("undo-toast-message").textContent = message;
  toast.classList.toggle("notice", !withUndo);
  toast.classList.add("visible");

  toastTimeout = setTimeout(hideToast, withUndo ? 5000 : 4000);
}

function hideToast() {
  if (toastTimeout) { clearTimeout(toastTimeout); toastTimeout = null; }
  undoToastState = null;
  const toast = document.getElementById("undo-toast");
  if (toast) toast.classList.remove("visible");
}

function showUndoToast(state) {
  undoToastState = state;
  const message = state.type === "completion"
    ? '“' + state.taskName + '” completed.'
    : state.type === "frost-banner"
      ? "Frost warning dismissed."
      : '“' + state.taskName + '” hidden.';
  showToast(message, true);
}

async function handleUndoAction() {
  if (!undoToastState) return;
  const state = undoToastState;
  const gardenAtUndo = currentGardenId;

  hideToast();
  if (state.gardenId !== gardenAtUndo) return;

  /* The frost dismissal is the only undoable thing in the app that never left
   * the device, so it is undone before the try block rather than inside it:
   * there is no request to fail, nothing to roll back, and no status message
   * worth showing for putting a banner back that is now visibly back. */
  if (state.type === "frost-banner") {
    writeFrostDismissedSpell(state.slot, null);
    renderFrostBanner();
    return;
  }

  try {
    const result = state.type === "completion"
      ? await sb.rpc("undo_task_completion", { p_completion_id: state.completionId })
      : await sb.from("hidden_task")
          .delete()
          .eq("garden_id", gardenAtUndo)
          .eq("task_id", state.taskId);
    const error = result.error;
    if (error) throw error;
    if (gardenAtUndo !== currentGardenId) return;
    invalidateTodayRequestForLocalMutation();
    restoreTodayTaskToClient(state.task, state.taskIndex);
    renderCurrentTaskList({ preservePosition: true });
    showTaskStatus(state.type === "completion" ? "Completion undone." : "Job restored.", false);
  } catch (error) {
    console.error("Undo error:", error);
    if (gardenAtUndo !== currentGardenId) return;
    if (await sessionHasGone(error, 0)) { await recoverFromSessionLoss(); return; }
    showTaskStatus("We couldn’t undo that change. Please refresh and try again.", true);
  }
}

function showTaskStatus(message, isError) {
  const statusEl = document.getElementById("task-status");
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.className = "status-message" + (isError ? " error" : "");
  setTimeout(() => {
    if (statusEl.textContent === message) statusEl.classList.add("hidden");
  }, 5000);
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

  showAccessibleModal("settings-modal", "close-settings-modal");
  fetchHiddenTasks();
}

function closeSettingsModal(restoreFocus = true) {
  hideAccessibleModal("settings-modal", restoreFocus);
}

function closeAllModals() {
  closeIdentify({ forced: true });
  closePhotoViewer(false);
  closePhotoRemoveModal(false);
  closeItemDetail(false);
  closeFeedbackModal(false);
  closeDeleteAccountModal(false);
  closeGardenDangerModal(false);
  closeRemoveItemModal(false);
  closeSettingsModal(false);
  closeGardenModal(false);
}

async function fetchHiddenTasks() {
  const listEl = document.getElementById("hidden-tasks-list");
  const requestSerial = ++hiddenTasksRequestSerial;
  listEl.innerHTML = '<div class="garden-local-status">Checking hidden tasks…</div>';
  const gardenAtRequest = currentGardenId;

  try {
    const { data, error } = await sb
      .from("hidden_task")
      .select("task_id, hidden_at, task:task_id ( name, category:category_id ( name ) )")
      .eq("garden_id", gardenAtRequest)
      .order("hidden_at", { ascending: false });
    if (requestSerial !== hiddenTasksRequestSerial || gardenAtRequest !== currentGardenId) return;
    if (error) throw error;

    const rows = (data || []).map(r => ({
      task_id: r.task_id,
      task_name: r.task ? r.task.name : "(this task no longer exists)",
      category: (r.task && r.task.category) ? r.task.category.name : "",
      date_hidden: r.hidden_at
    }));
    renderHiddenTasksList(rows);
  } catch (error) {
    if (requestSerial !== hiddenTasksRequestSerial || gardenAtRequest !== currentGardenId) return;
    console.error("Fetch hidden tasks error:", error);
    if (await sessionHasGone(error, 0)) { await recoverFromSessionLoss(); return; }
    listEl.innerHTML = `
      <div class="hidden-tasks-error" role="alert">
        <p>We couldn’t show hidden tasks for this garden.</p>
        <button type="button" class="secondary-action-btn" data-action="retry-hidden-tasks">Try again</button>
      </div>`;
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
      <button class="restore-task-btn" type="button" data-task-id="${task.task_id}">Restore</button>
      <p class="hidden-task-error hidden" role="alert"></p>
    `;
    listEl.appendChild(card);
  });
}

async function handleRestoreTask(event) {
  const retry = event.target.closest('[data-action="retry-hidden-tasks"]');
  if (retry) { fetchHiddenTasks(); return; }
  const btn = event.target.closest(".restore-task-btn");
  if (!btn) return;

  const taskId = parseInt(btn.getAttribute("data-task-id"), 10);
  const gardenAtRestore = currentGardenId;
  const card = btn.closest(".hidden-task-card");
  const taskNameEl = card ? card.querySelector(".hidden-task-info h4") : null;
  const taskName = taskNameEl ? taskNameEl.textContent : "that task";
  const errorEl = card ? card.querySelector(".hidden-task-error") : null;
  if (errorEl) { errorEl.textContent = ""; errorEl.classList.add("hidden"); }
  btn.disabled = true;
  btn.textContent = "Restoring…";

  try {
    const { error } = await sb.from("hidden_task")
      .delete()
      .eq("garden_id", gardenAtRestore)
      .eq("task_id", taskId);
    if (error) throw error;
    if (gardenAtRestore !== currentGardenId) return;

    if (card) card.remove();

    loadToday();

    const listEl = document.getElementById("hidden-tasks-list");
    if (listEl.children.length === 0) {
      listEl.innerHTML = '<div class="loading-spinner-box">You haven\'t hidden any tasks in this garden.</div>';
    }
  } catch (error) {
    console.error("Restore task error:", error);
    if (gardenAtRestore !== currentGardenId) return;
    if (await sessionHasGone(error, 0)) { await recoverFromSessionLoss(); return; }
    btn.disabled = false;
    btn.textContent = "Restore";
    if (errorEl) {
      errorEl.textContent = "We couldn’t restore “" + taskName + "”. Please try again.";
      errorEl.classList.remove("hidden");
    }
  }
}


/* ==========================================================================
 *  COMPLETING A TASK
 * ========================================================================== */

async function handleTaskCompletion(event) {
  const checkbox = event.target.closest(".task-check");
  if (!checkbox) return;

  const card = checkbox.closest(".task-card");
  const wrapper = checkbox.closest(".task-card-wrapper");
  const taskId = parseInt(checkbox.getAttribute("data-task-id"), 10);
  const task = todayTasks.find(item => Number(item.task_id) === taskId);
  const taskName = task ? task.name : "Task";
  const gardenAtCompletion = currentGardenId;

  checkbox.disabled = true;
  checkbox.setAttribute("aria-label", "Marking " + taskName + " as done");

  try {
    const { data, error } = await sb.from("task_completion").insert({
      garden_id: gardenAtCompletion,
      task_id: taskId,
      notes: "Completed via PWA client"
    }).select("id").single();
    if (error) throw error;
    if (gardenAtCompletion !== currentGardenId) return;

    invalidateTodayRequestForLocalMutation();
    const removed = removeTodayTaskFromClient(taskId);
    const completedTask = removed.task || task;

    checkbox.classList.add("completed");
    checkbox.setAttribute("aria-label", taskName + " completed");
    card.classList.add("completing");
    if (wrapper) {
      wrapper.classList.add("completed");
      if (currentlyRevealedWrapper === wrapper) currentlyRevealedWrapper = null;
      card.style.transform = "translateX(0)";
    }

    const reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setTimeout(() => {
      if (gardenAtCompletion !== currentGardenId) return;
      if (wrapper) wrapper.classList.add("removing");
      setTimeout(() => {
        if (gardenAtCompletion !== currentGardenId) return;
        if (wrapper) wrapper.remove();
        showUndoToast({
          type: "completion",
          taskId,
          taskName,
          task: completedTask,
          taskIndex: removed.index,
          gardenId: gardenAtCompletion,
          completionId: data.id
        });
      }, reducedMotion ? 0 : 180);
    }, reducedMotion ? 80 : 420);
  } catch (error) {
    console.error("Completion error:", error);
    if (gardenAtCompletion !== currentGardenId) return;
    if (await sessionHasGone(error, 0)) { await recoverFromSessionLoss(); return; }
    checkbox.disabled = false;
    checkbox.setAttribute("aria-label", "Mark " + taskName + " as done");
    showTaskStatus("We couldn’t mark “" + taskName + "” as done. Please try again.", true);
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
  window.addEventListener("pageshow", resetGoogleSignInControl);

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
  ["garden-modal", "settings-modal", "garden-danger-modal", "delete-account-modal", "feedback-modal",
   "item-detail-modal", "photo-remove-modal", "photo-viewer", "identify-modal"]
    .forEach(id => {
      const modal = document.getElementById(id);
      if (modal) modal.addEventListener("keydown", handleAccessibleModalKeydown);
    });
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
    taskContainer.addEventListener("click", handleTaskContainerAction);
    taskContainer.addEventListener("pointerdown", onCardPointerDown);
    taskContainer.addEventListener("pointermove", onCardPointerMove);
    taskContainer.addEventListener("pointerup", onCardPointerUp);
    taskContainer.addEventListener("pointercancel", onCardPointerUp);
  }
  const timeFilterGroup = document.getElementById("time-filter-group");
  if (timeFilterGroup) timeFilterGroup.addEventListener("click", handleTimeFilter);

  // --- Today view: the frost warning's dismiss ---
  // Its own listener rather than a line in handleTaskContainerAction, because
  // the banner lives OUTSIDE #task-container: it sits above the weather widget,
  // and the container's listeners also carry the swipe-to-hide gesture, which
  // has no business anywhere near a one-tap dismiss.
  const frostSlot = document.getElementById("frost-banner-slot");
  if (frostSlot) {
    frostSlot.addEventListener("click", event => {
      const button = event.target.closest('[data-action="dismiss-frost"]');
      if (!button) return;
      handleFrostDismiss(button.dataset.spell || null);
    });
  }

  // --- My Garden ---
  const gardenView = document.getElementById("view-garden");
  if (gardenView) gardenView.addEventListener("click", handleGardenViewAction);
  const inventoryList = document.getElementById("inventory-list");
  if (inventoryList) {
    inventoryList.addEventListener("click", handleRemoveAsset);
    inventoryList.addEventListener("click", handleInventoryPhotoClick);
    inventoryList.addEventListener("error", handlePhotoImageError, true);
  }

  // --- RM-026 item photos: detail, remove-photo confirm, viewer ---
  const itemDetailModal = document.getElementById("item-detail-modal");
  if (itemDetailModal) {
    itemDetailModal.addEventListener("click", event => {
      if (event.target === itemDetailModal || event.target.closest("#close-item-detail-modal")) { closeItemDetail(); return; }
      handleItemDetailAction(event);
    });
    itemDetailModal.addEventListener("error", handlePhotoImageError, true);
  }
  const photoInput = document.getElementById("photo-input");
  if (photoInput) {
    photoInput.addEventListener("change", handlePhotoFileChosen);
    photoInput.addEventListener("cancel", handlePhotoPickerCancelled);
  }
  // --- RM-015 identify from photo ---
  const identifyBtn = document.getElementById("identify-btn");
  if (identifyBtn) identifyBtn.addEventListener("click", startIdentify);
  const identifyInput = document.getElementById("identify-input");
  if (identifyInput) {
    identifyInput.addEventListener("change", handleIdentifyFileChosen);
    identifyInput.addEventListener("cancel", handleIdentifyPickerCancelled);
  }
  const identifyModal = document.getElementById("identify-modal");
  if (identifyModal) identifyModal.addEventListener("click", handleIdentifyModalClick);
  const photoRemoveModal = document.getElementById("photo-remove-modal");
  if (photoRemoveModal) {
    photoRemoveModal.addEventListener("click", event => {
      if (event.target === photoRemoveModal || event.target.closest("#close-photo-remove-modal, #photo-remove-cancel-btn")) {
        closePhotoRemoveModal();
        return;
      }
      if (event.target.closest("#photo-remove-confirm-btn")) confirmPhotoRemove();
    });
  }
  const photoViewerEl = document.getElementById("photo-viewer");
  if (photoViewerEl) photoViewerEl.addEventListener("click", handlePhotoViewerClick);
  const photoViewerImg = document.getElementById("photo-viewer-img");
  if (photoViewerImg) photoViewerImg.addEventListener("error", handlePhotoViewerImageError);
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
  const closeRemoveItemBtn = document.getElementById("close-remove-item-modal");
  if (closeRemoveItemBtn) closeRemoveItemBtn.addEventListener("click", closeRemoveItemModal);
  const removeItemCancelBtn = document.getElementById("remove-item-cancel-btn");
  if (removeItemCancelBtn) removeItemCancelBtn.addEventListener("click", closeRemoveItemModal);
  const removeItemConfirmBtn = document.getElementById("remove-item-confirm-btn");
  if (removeItemConfirmBtn) removeItemConfirmBtn.addEventListener("click", executeRemoveAsset);
  const removeItemModal = document.getElementById("remove-item-modal");
  if (removeItemModal) {
    removeItemModal.addEventListener("click", event => {
      if (event.target === removeItemModal) closeRemoveItemModal();
    });
    removeItemModal.addEventListener("keydown", handleRemoveItemModalKeydown);
  }

  // --- Undo / notice toast ---
  const undoBtn = document.getElementById("undo-toast-btn");
  if (undoBtn) undoBtn.addEventListener("click", handleUndoAction);

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
