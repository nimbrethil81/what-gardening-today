/* ==========================================================================
 *  What Gardening Today? — frontend (v2.0)
 *
 *  Talks to Supabase, not the old Apps Script. The daily view goes through the
 *  `today` Edge Function (weather + tasks in one call); everything else is a
 *  direct, Row-Level-Security-governed read or write via supabase-js.
 *
 *  On open, a small gate decides what to show:
 *    - not signed in            -> the sign-in screen
 *    - signed in, no garden yet -> the first-run garden setup screen
 *    - signed in, has a garden  -> the app (Today, My Garden), fed from Supabase
 * ========================================================================== */

/* ---- Supabase connection -------------------------------------------------
 * Fill these in from your Supabase dashboard: Project Settings -> API.
 * The anon / publishable key is SAFE to include here — it is designed to be
 * public and is governed by Row Level Security. Do NOT paste the service_role
 * key (that one bypasses security and belongs only in the Edge Function).
 */
const SUPABASE_URL = "https://YOUR-PROJECT-REF.supabase.co";
const SUPABASE_ANON_KEY = "YOUR-ANON-PUBLIC-KEY";

const { createClient } = window.supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ---- App state ---------------------------------------------------------- */
let currentGardenId = null;
let routedUserId = undefined;      // guards against redundant re-routing on focus
let pendingSigninEmail = null;

let globalDictionary = [];         // picker catalogue: {Category, Suggested_Name, blueprint_id}
let userInventory = [];            // {item_id, friendly_name, category, blueprint_name}
let selectedCategoryRef = null;
let selectedSubItemObj = null;

// Location captured on the setup screen
let setupLat = null;
let setupLon = null;

// Display order for inventory category groups (mirrors the picker tiles)
const CATEGORY_ORDER = [
  "Lawn", "Beds", "Trees & shrubs", "Plants & flowers",
  "Veg & herbs", "Garden structures", "Tools"
];

// --- HIDE-THIS-TASK STATE ---
const HIDE_REVEAL_WIDTH = 76; // px — must match .task-hide-action's width in style.css
let currentlyRevealedWrapper = null;
let dragState = null;
let undoToastTimeout = null;
let undoToastTaskId = null;


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
    showSigninEmailStep();
    showView("signin");
    return;
  }

  try {
    const { data, error } = await sb.from("garden").select("id, name").limit(1);
    if (error) throw error;

    if (!data || data.length === 0) {
      showView("setup");
      return;
    }

    currentGardenId = data[0].id;
    showView("app");
    await loadCatalogue();
    loadToday();
    loadInventory();
  } catch (err) {
    console.error("Routing failed:", err);
    setSplashMessage("Something went wrong loading your garden. Check your connection, then tap Retry.", true);
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
 *  SIGN IN  (emailed 6-digit code, with the magic-link return handled too)
 * ========================================================================== */

function showSigninEmailStep() {
  document.getElementById("signin-email-step").classList.remove("hidden");
  document.getElementById("signin-code-step").classList.add("hidden");
  document.getElementById("signin-error").textContent = "";
  document.getElementById("signin-code-error").textContent = "";
}

function showSigninCodeStep() {
  document.getElementById("signin-email-step").classList.add("hidden");
  document.getElementById("signin-code-step").classList.remove("hidden");
}

async function handleSendCode() {
  const email = document.getElementById("signin-email").value.trim();
  const errEl = document.getElementById("signin-error");
  errEl.textContent = "";

  if (!email || email.indexOf("@") === -1) {
    errEl.textContent = "Please enter a valid email address.";
    return;
  }

  const btn = document.getElementById("signin-send-btn");
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Sending…";

  try {
    const redirect = window.location.origin + window.location.pathname;
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: redirect }
    });
    if (error) throw error;

    pendingSigninEmail = email;
    document.getElementById("signin-sent-to").textContent = email;
    document.getElementById("signin-code").value = "";
    showSigninCodeStep();
  } catch (err) {
    console.error("Sign-in send failed:", err);
    const msg = String(err && err.message ? err.message : "").toLowerCase();
    if (msg.indexOf("rate") !== -1 || (err && err.status === 429)) {
      errEl.textContent = "You just asked for a code — check your inbox, or wait a minute before trying again.";
    } else {
      // Friendly / specific message (configurable — see docs/CONFIG_ITEMS.md #4)
      errEl.textContent = "We couldn't send a sign-in code to that address. It may not be on the guest list — ask Dan for an invite.";
    }
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
}

async function handleVerifyCode() {
  const code = document.getElementById("signin-code").value.trim();
  const errEl = document.getElementById("signin-code-error");
  errEl.textContent = "";

  if (!code) { errEl.textContent = "Enter the code from your email."; return; }
  if (!pendingSigninEmail) { showSigninEmailStep(); return; }

  const btn = document.getElementById("signin-verify-btn");
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Signing in…";

  try {
    const { error } = await sb.auth.verifyOtp({ email: pendingSigninEmail, token: code, type: "email" });
    if (error) throw error;
    // onAuthStateChange (SIGNED_IN) will fire and route() us onward.
  } catch (err) {
    console.error("Verify failed:", err);
    errEl.textContent = "That code didn't work. Check it and try again, or request a new one.";
    btn.disabled = false;
    btn.textContent = orig;
  }
}

async function handleSignOut() {
  try { await sb.auth.signOut(); } catch (e) { console.error("Sign out error:", e); }
  closeHiddenTasksModal();
  // onAuthStateChange (SIGNED_OUT) will route() us back to the sign-in screen.
}


/* ==========================================================================
 *  FIRST-RUN GARDEN SETUP  (a new friend sees this; you skip it)
 * ========================================================================== */

async function handleFindPostcode() {
  const pc = document.getElementById("setup-postcode").value.trim();
  const errEl = document.getElementById("setup-error");
  const confirmEl = document.getElementById("setup-location-confirm");
  errEl.textContent = "";

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
    setupLat = r.latitude;
    setupLon = r.longitude;
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

  if (!navigator.geolocation) {
    errEl.textContent = "Your device can't share its location — enter a postcode instead.";
    return;
  }

  const btn = document.getElementById("setup-locate-btn");
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Locating…";

  navigator.geolocation.getCurrentPosition(async (pos) => {
    setupLat = pos.coords.latitude;
    setupLon = pos.coords.longitude;

    let area = "Current location";
    try {
      const res = await fetch(`https://api.postcodes.io/postcodes?lon=${setupLon}&lat=${setupLat}`);
      if (res.ok) {
        const j = await res.json();
        if (j.result && j.result[0]) {
          const r = j.result[0];
          area = [r.admin_ward || r.parish, r.admin_district].filter(Boolean).join(", ") || area;
        }
      }
    } catch (e) { /* keep the generic label */ }

    confirmEl.textContent = "📍 " + area;
    confirmEl.classList.remove("hidden");
    btn.disabled = false;
    btn.textContent = orig;
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
}

async function handleCreateGarden() {
  const name = document.getElementById("setup-name").value.trim();
  const errEl = document.getElementById("setup-error");
  errEl.textContent = "";

  if (!name || setupLat === null || setupLon === null) return;

  const btn = document.getElementById("setup-create-btn");
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Creating…";

  try {
    const { data, error } = await sb.rpc("create_garden", {
      p_name: name,
      p_latitude: setupLat,
      p_longitude: setupLon
    });
    if (error) throw error;

    currentGardenId = data; // create_garden returns the new garden's id
    showView("app");
    await loadCatalogue();
    loadToday();
    loadInventory();
  } catch (err) {
    console.error("Create garden failed:", err);
    errEl.textContent = "Couldn't create your garden. Check your connection and try again.";
    btn.disabled = false;
    btn.textContent = orig;
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


/* ==========================================================================
 *  TODAY  (weather + tasks, via the `today` Edge Function)
 * ========================================================================== */

async function loadToday() {
  if (!currentGardenId) return;
  const taskContainer = document.getElementById("task-container");
  taskContainer.innerHTML = '<div class="loading-spinner-box">Gathering seasonal rules...</div>';

  try {
    const { data, error } = await sb.functions.invoke("today", {
      body: { garden_id: currentGardenId }
    });
    if (error) throw error;

    renderWeather(data.weather);
    renderTaskCards(data.tasks || []);
  } catch (err) {
    console.error("Today failed:", err);
    renderWeather(null);
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

function renderTaskCards(tasks) {
  const taskContainer = document.getElementById("task-container");
  taskContainer.innerHTML = "";
  currentlyRevealedWrapper = null;

  if (tasks.length === 0) {
    taskContainer.innerHTML = `<div class="loading-spinner-box">✨ Your garden is up to date!</div>`;
    return;
  }

  tasks.forEach(task => {
    const wrapper = document.createElement("div");
    wrapper.className = "task-card-wrapper";
    wrapper.innerHTML = `
      <div class="task-hide-action">
        <button class="hide-task-btn" data-task-id="${task.task_id}">Hide</button>
      </div>
      <div class="task-card">
        <div class="task-info">
          <h3>${task.name}</h3>
          <p>${task.category} • ${task.instruction}</p>
        </div>
        <button class="task-action-btn task-check" data-task-id="${task.task_id}">✓</button>
      </div>
    `;
    taskContainer.appendChild(wrapper);
  });
}


/* ==========================================================================
 *  MY GARDEN — inventory
 * ========================================================================== */

async function loadInventory() {
  if (!currentGardenId) return;
  const inventoryList = document.getElementById("inventory-list");
  inventoryList.innerHTML = '<div class="loading-spinner-box">Growing garden...</div>';

  try {
    const { data, error } = await sb
      .from("garden_item")
      .select("id, friendly_name, legacy_category, blueprint:blueprint_id ( name )")
      .eq("garden_id", currentGardenId)
      .is("removed_at", null)
      .order("id");
    if (error) throw error;

    userInventory = (data || []).map(r => ({
      item_id: r.id,
      friendly_name: r.friendly_name || "",
      category: r.legacy_category || "Other",
      blueprint_name: (r.blueprint && r.blueprint.name) ? r.blueprint.name : ""
    }));
    renderGroupedInventory();
  } catch (err) {
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

      cardDiv.innerHTML = `
        <div>
          <strong>${displayName}</strong>
          ${customRef ? `<div class="inventory-item-meta">📌 ${customRef}</div>` : ""}
        </div>
        <button class="remove-asset-btn" data-item-id="${item.item_id}" data-friendly-name="${displayName}">✕</button>
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
      .select("id, name, retired_at, blueprint_category ( category:category_id ( name ) )")
      .is("retired_at", null)
      .order("name");
    if (error) throw error;

    globalDictionary = [];
    (data || []).forEach(bp => {
      (bp.blueprint_category || []).forEach(bc => {
        const cn = bc.category && bc.category.name;
        if (cn) globalDictionary.push({ Category: cn, Suggested_Name: bp.name, blueprint_id: bp.id });
      });
    });
  } catch (err) {
    console.error("Catalogue failed:", err);
  }
}

function selectCategory(categoryKey, element) {
  document.querySelectorAll(".tile-btn").forEach(tile => tile.classList.remove("selected"));
  element.classList.add("selected");

  selectedCategoryRef = categoryKey;
  selectedSubItemObj = null;

  const pillBox = document.getElementById("pill-box");
  pillBox.innerHTML = "";

  const relevantItems = globalDictionary.filter(item => item.Category === categoryKey);
  relevantItems.sort((a, b) => a.Suggested_Name.localeCompare(b.Suggested_Name));

  if (relevantItems.length === 0) {
    pillBox.innerHTML = '<div class="pill-placeholder">No items in this category yet.</div>';
    validateForm();
    return;
  }

  relevantItems.forEach(item => {
    const pill = document.createElement("button");
    pill.className = "item-pill";
    pill.innerText = item.Suggested_Name;
    pill.onclick = () => {
      document.querySelectorAll(".item-pill").forEach(p => p.classList.remove("selected"));
      pill.classList.add("selected");
      selectedSubItemObj = item;
      validateForm();
    };
    pillBox.appendChild(pill);
  });

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
    document.querySelectorAll(".item-pill").forEach(p => p.classList.remove("selected"));
    selectedSubItemObj = null;
    validateForm();

    btn.textContent = "Added! 🎉";
    setTimeout(() => { btn.textContent = "Add to My Garden"; }, 2000);

    loadInventory();
    loadToday();
  } catch (error) {
    console.error("Add item error:", error);
    btn.textContent = "Couldn't add — try again";
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
 * ========================================================================== */

async function handleHideTaskClick(event) {
  const hideBtn = event.target.closest(".hide-task-btn");
  if (!hideBtn) return;

  const taskId = parseInt(hideBtn.getAttribute("data-task-id"), 10);
  const wrapper = hideBtn.closest(".task-card-wrapper");
  const nameEl = wrapper ? wrapper.querySelector(".task-info h3") : null;
  const taskName = nameEl ? nameEl.textContent : "Task";

  if (currentlyRevealedWrapper === wrapper) currentlyRevealedWrapper = null;
  if (wrapper) wrapper.remove();

  showUndoToast(taskId, taskName);

  try {
    const { error } = await sb.from("hidden_task").insert({
      garden_id: currentGardenId,
      task_id: taskId
    });
    // 23505 = already hidden (unique key). That's a success, not a failure.
    if (error && error.code !== "23505") console.error("Hide task failed:", error);
  } catch (error) {
    console.error("Hide task error:", error);
  }
}

function showUndoToast(taskId, taskName) {
  if (undoToastTimeout) clearTimeout(undoToastTimeout);

  undoToastTaskId = taskId;
  const toast = document.getElementById("undo-toast");
  const message = document.getElementById("undo-toast-message");
  message.textContent = `"${taskName}" hidden.`;
  toast.classList.add("visible");

  undoToastTimeout = setTimeout(() => {
    toast.classList.remove("visible");
    undoToastTimeout = null;
    undoToastTaskId = null;
  }, 5000);
}

async function handleUndoHide() {
  if (undoToastTaskId === null || undoToastTaskId === undefined) return;
  const taskId = undoToastTaskId;

  if (undoToastTimeout) { clearTimeout(undoToastTimeout); undoToastTimeout = null; }
  document.getElementById("undo-toast").classList.remove("visible");
  undoToastTaskId = null;

  try {
    const { error } = await sb.from("hidden_task")
      .delete()
      .eq("garden_id", currentGardenId)
      .eq("task_id", taskId);
    if (error) throw error;
    loadToday(); // bring the restored task straight back
  } catch (error) {
    console.error("Undo hide error:", error);
  }
}


/* ==========================================================================
 *  HIDDEN TASKS MANAGEMENT (settings gear icon)
 * ========================================================================== */

function openHiddenTasksModal() {
  document.getElementById("hidden-tasks-modal").classList.remove("hidden");
  fetchHiddenTasks();
}

function closeHiddenTasksModal() {
  document.getElementById("hidden-tasks-modal").classList.add("hidden");
}

async function fetchHiddenTasks() {
  const listEl = document.getElementById("hidden-tasks-list");
  listEl.innerHTML = '<div class="loading-spinner-box">Loading...</div>';

  try {
    const { data, error } = await sb
      .from("hidden_task")
      .select("task_id, hidden_at, task:task_id ( name, category:category_id ( name ) )")
      .eq("garden_id", currentGardenId)
      .order("hidden_at", { ascending: false });
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
    listEl.innerHTML = '<div class="loading-spinner-box">You haven\'t hidden any tasks.</div>';
    return;
  }

  hiddenTasks.forEach(task => {
    const card = document.createElement("div");
    card.className = "hidden-task-card";
    card.innerHTML = `
      <div class="hidden-task-info">
        <h4>${task.task_name}</h4>
        <p>${task.category}</p>
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
      listEl.innerHTML = '<div class="loading-spinner-box">You haven\'t hidden any tasks.</div>';
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

  // --- Sign-in screen ---
  const sendBtn = document.getElementById("signin-send-btn");
  if (sendBtn) sendBtn.addEventListener("click", handleSendCode);
  const verifyBtn = document.getElementById("signin-verify-btn");
  if (verifyBtn) verifyBtn.addEventListener("click", handleVerifyCode);
  const backBtn = document.getElementById("signin-back-btn");
  if (backBtn) backBtn.addEventListener("click", showSigninEmailStep);
  const emailInput = document.getElementById("signin-email");
  if (emailInput) emailInput.addEventListener("keydown", e => { if (e.key === "Enter") handleSendCode(); });
  const codeInput = document.getElementById("signin-code");
  if (codeInput) codeInput.addEventListener("keydown", e => { if (e.key === "Enter") handleVerifyCode(); });

  // --- Garden setup screen ---
  const findBtn = document.getElementById("setup-find-btn");
  if (findBtn) findBtn.addEventListener("click", handleFindPostcode);
  const locateBtn = document.getElementById("setup-locate-btn");
  if (locateBtn) locateBtn.addEventListener("click", handleUseLocation);
  const createBtn = document.getElementById("setup-create-btn");
  if (createBtn) createBtn.addEventListener("click", handleCreateGarden);
  const setupName = document.getElementById("setup-name");
  if (setupName) setupName.addEventListener("input", validateSetup);
  const setupPostcode = document.getElementById("setup-postcode");
  if (setupPostcode) setupPostcode.addEventListener("keydown", e => { if (e.key === "Enter") handleFindPostcode(); });

  // --- Splash retry ---
  const splashRetry = document.getElementById("splash-retry");
  if (splashRetry) splashRetry.addEventListener("click", route);

  // --- Today view: completion, hide, swipe ---
  const taskContainer = document.getElementById("task-container");
  if (taskContainer) {
    taskContainer.addEventListener("click", handleTaskCompletion);
    taskContainer.addEventListener("click", handleHideTaskClick);
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

  // --- Undo toast ---
  const undoBtn = document.getElementById("undo-toast-btn");
  if (undoBtn) undoBtn.addEventListener("click", handleUndoHide);

  // --- Settings modal ---
  const settingsBtn = document.getElementById("settings-btn");
  if (settingsBtn) settingsBtn.addEventListener("click", openHiddenTasksModal);
  const closeModalBtn = document.getElementById("close-hidden-modal");
  if (closeModalBtn) closeModalBtn.addEventListener("click", closeHiddenTasksModal);
  const hiddenModal = document.getElementById("hidden-tasks-modal");
  if (hiddenModal) {
    hiddenModal.addEventListener("click", (e) => { if (e.target === hiddenModal) closeHiddenTasksModal(); });
  }
  const hiddenTasksList = document.getElementById("hidden-tasks-list");
  if (hiddenTasksList) hiddenTasksList.addEventListener("click", handleRestoreTask);
  const signOutBtn = document.getElementById("signout-btn");
  if (signOutBtn) signOutBtn.addEventListener("click", handleSignOut);

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
