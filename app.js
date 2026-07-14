const API_URL = "https://script.google.com/macros/s/AKfycbwDA5U9Ve0EIcfDbtOnwhGCukR-2WuNLWL_xm0zj3PC5mlR7-IGAecli9E2Bao5Nix6/exec";

// --- LOCAL MEMORY STATE ---
let globalDictionary = [];
let userInventory = [];
let selectedCategoryRef = null;
let selectedSubItemObj = null; // Stores the actual dictionary row object

// --- HIDE-THIS-TASK STATE ---
const HIDE_REVEAL_WIDTH = 76; // px — must match .task-hide-action's width in style.css
let currentlyRevealedWrapper = null; // the one task card currently swiped open, if any
let dragState = null;                // in-progress swipe gesture, or null when idle
let undoToastTimeout = null;
let undoToastTaskId = null;

// ------------------------------
// ------------------------------
// LOAD ALL DATA FROM BACKEND
// ------------------------------
async function loadAppData() {
  try {
    const currentMonth = new Date().getMonth() + 1;
    const url = `${API_URL}?action=get_all&month=${currentMonth}&t=${Date.now()}`;
    const response = await fetch(url, { cache: "no-store" });
    const json = await response.json();

    if (json.status !== "success") {
      console.error("Backend error:", json);
      document.getElementById("task-container").innerHTML = 'Backend returned an error.';
      return;
    }

    // 1. Update Global State (WITH PROPER CASING MAPPING)
    const rawCategories = json.categories || [];
    globalDictionary = rawCategories.map(item => ({
        Category: item.category || '',
        Suggested_Name: item.suggested_name || '',
        Default_Asset_ID_Prefix: item.prefix || ''
    }));
    
    userInventory = json.inventory || [];
    const tasks = json.tasks || [];

    // 2. Render UI using your ACTUAL function names
    renderTaskCards(tasks);
    renderGroupedInventory();

  } catch (err) {
    console.error("Fetch failed:", err);
    const taskContainer = document.getElementById("task-container");
    if (taskContainer) {
        taskContainer.innerHTML = 'Unable to load data from server.';
    }
  }
}

// --- NAVIGATION LOGIC ---
function switchTab(viewId, element) {
  // 1. Toggle nav active state
  document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
  element.classList.add('active');

  // 2. Swap view panels
  document.querySelectorAll('.view-section').forEach(section => section.classList.remove('active-view'));
  document.getElementById(`view-${viewId}`).classList.add('active-view');

  // 3. SMART REFRESH: If returning to the Today view, re-fetch the tasks!
  if (viewId === 'today') {
      fetchGardeningTasks();
  }
}

// --- API FETCHERS ---
async function fetchDictionary() {
    try {
        const response = await fetch(API_URL + "?action=get_dictionary");
        const result = await response.json();
        if(result.status === "success") {
            // Normalise to PascalCase regardless of what casing the API returns
            globalDictionary = result.data.map(item => ({
                Category:                item.Category                || item.category                || '',
                Suggested_Name:          item.Suggested_Name          || item.suggested_name          || '',
                Default_Asset_ID_Prefix: item.Default_Asset_ID_Prefix || item.prefix                  || ''
            }));
        }
    } catch (error) {
        console.error("Error fetching dictionary:", error);
    }
}

async function fetchGardeningTasks() {
    const taskContainer = document.getElementById("task-container");
    taskContainer.innerHTML = '<div class="loading-spinner-box">Gathering seasonal rules...</div>';

    try {
        // 2. Query data based on the client's current system calendar month (1-12)

const currentMonth = new Date().getMonth() + 1;

// Add a cache-buster timestamp to force Safari to fetch fresh data
const cacheBuster = new Date().getTime();
const targetRequestUrl = `${API_URL}?month=${currentMonth}&t=${cacheBuster}`;

// Add the 'no-store' directive for modern browsers
const response = await fetch(targetRequestUrl, { cache: 'no-store' });

        const result = await response.json();
        
        if (result.status === "success") {
            renderTaskCards(result.data);
        } else {
            throw new Error(result.message || "Unknown API Error");
        }
    } catch (error) {
        console.error("API Pipeline Error:", error);
        taskContainer.innerHTML = `<div class="loading-spinner-box" style="color:red;">Pipeline Error: ${error.message}</div>`;
    }
}

async function fetchInventory() {
    const inventoryList = document.getElementById('inventory-list');
    inventoryList.innerHTML = '<div class="loading-spinner-box">Growing garden...</div>';

    try {
        const response = await fetch(API_URL + "?action=get_profile");
        const result = await response.json();
        if (result.status === "success") {
            userInventory = result.data;
            renderGroupedInventory();
        }
    } catch (error) {
        console.error("Error fetching inventory:", error);
        inventoryList.innerHTML = '<div class="loading-spinner-box" style="color:red;">Failed to load inventory.</div>';
    }
}
// --- GEOLOCATION & WEATHER LOGIC ---
function requestLocalWeather() {
  if (!navigator.geolocation) {
    updateWeatherFallback();
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;

      try {
        const url = `${API_URL}?action=get_weather&lat=${lat}&lon=${lon}`;
        const response = await fetch(url);
        const json = await response.json();

        if (json.status === "success") {
  const temp = Math.round(json.data.main.temp);
  const desc = json.data.weather[0].description;
  const icon = json.data.weather[0].icon;

  // Capitalise description
  const niceDesc = desc.charAt(0).toUpperCase() + desc.slice(1);

  document.getElementById("weather-temp").textContent = `${temp}°C`;
  document.getElementById("weather-desc").textContent = niceDesc;

  // Add icon
  document.getElementById("weather-icon").src =
    `https://openweathermap.org/img/wn/${icon}@2x.png`;
}
 else {
          updateWeatherFallback();
        }
      } catch (err) {
        updateWeatherFallback();
      }
    },

    // ❗ This was missing — without it, the widget never updates
    (err) => {
      console.warn("Geolocation blocked:", err);
      updateWeatherFallback();
    }
  );
}

function updateWeatherFallback() {
  document.getElementById("weather-temp").textContent = "--°C";
  document.getElementById("weather-desc").textContent = "Weather unavailable";
}


function updateWeatherWidget(weatherData) {
    // Selectors for your UI
    const tempDisplay = document.querySelector('.weather-widget h1');
    const conditionDisplay = document.querySelector('.weather-widget p');
    
    if (tempDisplay && conditionDisplay) {
        // Round the temperature and grab the main condition (e.g., "Rain", "Clear")
        const temp = Math.round(weatherData.main.temp);
        const condition = weatherData.weather[0].main;
        
        // Simple mapping to add an emoji based on the condition
        let emoji = "☁️";
        if (condition === "Clear") emoji = "☀️";
        if (condition === "Rain" || condition === "Drizzle") emoji = "🌧️";
        
        tempDisplay.innerHTML = `${temp}°C ${emoji}`;
        conditionDisplay.textContent = weatherData.weather[0].description;
    }
}

// --- UI RENDERING LOGIC ---
function renderTaskCards(tasks) {
    const taskContainer = document.getElementById("task-container");
    taskContainer.innerHTML = "";
    currentlyRevealedWrapper = null; // any previous swipe-open state no longer applies

    if (tasks.length === 0) {
        taskContainer.innerHTML = `<div class="loading-spinner-box">✨ Your garden is up to date!</div>`;
        return;
    }

    tasks.forEach(task => {
        const wrapper = document.createElement("div");
        wrapper.className = "task-card-wrapper";

        // Build the modern UI card, now sitting on top of a Hide action
        // that's revealed by swiping the card sideways.
        wrapper.innerHTML = `
            <div class="task-hide-action">
                <button class="hide-task-btn" data-task-id="${task.task_id}">Hide</button>
            </div>
            <div class="task-card">
                <div class="task-info">
                    <h3>${task.task_name}</h3>
                    <p>${task.category} • ${task.instruction}</p>
                </div>
                <button class="task-action-btn task-check" data-task-id="${task.task_id}" data-asset-id="${task.asset_id}">✓</button>
            </div>
        `;
        taskContainer.appendChild(wrapper);
    });
}

// Look up the canonical Suggested_Name for an asset using its ID prefix
function getSuggestedName(assetId) {
    // Strip the trailing _NNNN random suffix to recover the dictionary prefix
    // e.g. "VEG_TOMATO_4821" → "VEG_TOMATO", "LAWN_1034" → "LAWN"
    const prefix = assetId.replace(/_\d{4}$/, '');
    const entry = globalDictionary.find(d => d.Default_Asset_ID_Prefix === prefix);
    return entry ? entry.Suggested_Name : null;
}

function renderGroupedInventory() {
    const displayArea = document.getElementById('inventory-list');
    displayArea.innerHTML = '';

    if(userInventory.length === 0) {
        displayArea.innerHTML = '<p class="form-instruction">Your garden is empty.</p>';
        return;
    }

    // Group items by category
    const groupedItems = {};
    userInventory.forEach(item => {
        if(!groupedItems[item.category]) {
            groupedItems[item.category] = [];
        }
        groupedItems[item.category].push(item);
    });

    for (const [categoryName, items] of Object.entries(groupedItems)) {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'inventory-group';
        
        const groupTitle = document.createElement('div');
        groupTitle.className = 'inventory-group-title';
        groupTitle.innerText = categoryName;
        groupDiv.appendChild(groupTitle);

        items.forEach(item => {
            const cardDiv = document.createElement('div');
            cardDiv.className = 'inventory-item-card';

            const suggestedName = getSuggestedName(item.asset_id);
            const displayName   = suggestedName || item.friendly_name || item.asset_id;
            // Only show the user's custom reference if it differs from the suggested name
            const customRef     = (item.friendly_name && suggestedName && item.friendly_name !== suggestedName)
                                    ? item.friendly_name
                                    : null;

            cardDiv.innerHTML = `
                <div>
                    <strong>${displayName}</strong>
                    ${customRef ? `<div class="inventory-item-meta">📌 ${customRef}</div>` : ''}
                </div>
                <button class="remove-asset-btn" data-asset-id="${item.asset_id}" data-friendly-name="${displayName}">✕</button>
            `;
            groupDiv.appendChild(cardDiv);
        });

        displayArea.appendChild(groupDiv);
    }
}

// --- FORM INTERACTION LOGIC (MY GARDEN) ---
function selectCategory(categoryKey, element) {
    document.querySelectorAll('.tile-btn').forEach(tile => tile.classList.remove('selected'));
    element.classList.add('selected');
    
    selectedCategoryRef = categoryKey;
    selectedSubItemObj = null;

    const pillBox = document.getElementById('pill-box');
    pillBox.innerHTML = '';

    // Filter dictionary based on actual Google Sheet categories
    const relevantItems = globalDictionary.filter(item => item.Category === categoryKey);

  // ADD THIS NEW LINE TO SORT THE ITEMS ALPHABETICALLY:
  relevantItems.sort((a, b) => a.Suggested_Name.localeCompare(b.Suggested_Name));
  
    if(relevantItems.length === 0) {
        pillBox.innerHTML = '<div class="pill-placeholder">Loading items... (or none found)</div>';
        validateForm();
        return;
    }

    relevantItems.forEach(item => {
        const pill = document.createElement('button');
        pill.className = 'item-pill';
        pill.innerText = item.Suggested_Name;
        pill.onclick = () => {
            document.querySelectorAll('.item-pill').forEach(p => p.classList.remove('selected'));
            pill.classList.add('selected');
            selectedSubItemObj = item; // Store full object to grab prefix later
            validateForm();
        };
        pillBox.appendChild(pill);
    });

    validateForm();
}

function validateForm() {
    const submitBtn = document.getElementById('add-asset-btn');
    if(selectedCategoryRef && selectedSubItemObj) {
        submitBtn.disabled = false;
    } else {
        submitBtn.disabled = true;
    }
}

// --- POST REQUESTS ---
async function handleAddAsset() {
    const customNameInput = document.getElementById('custom-name').value.trim();
    const btn = document.getElementById('add-asset-btn');
    
    if (!selectedCategoryRef || !selectedSubItemObj) return;

    // Use custom name if provided, otherwise default to the dictionary's suggested name
    const finalFriendlyName = customNameInput.length > 0 ? customNameInput : selectedSubItemObj.Suggested_Name;

    // Generate unique ID based on the dictionary prefix
    const uniqueAssetId = `${selectedSubItemObj.Default_Asset_ID_Prefix}_${Math.floor(1000 + Math.random() * 9000)}`;

    btn.disabled = true;
    btn.textContent = "Planting...";

    try {
        const response = await fetch(API_URL, {
            method: "POST",
            body: JSON.stringify({
                action: "add_asset",
                asset_id: uniqueAssetId,
                category: selectedCategoryRef,
                friendly_name: finalFriendlyName
            })
        });

        const result = await response.json();
        if(result.status === "success") {
            // Clear Form
            document.getElementById('custom-name').value = '';
            document.querySelectorAll('.item-pill').forEach(p => p.classList.remove('selected'));
            selectedSubItemObj = null;
            validateForm();
            
            btn.textContent = "Added! 🎉";
            setTimeout(() => { btn.textContent = "Add to My Garden"; }, 2000);
            
            // Refresh Inventory List
            fetchInventory();
        }
    } catch (error) {
        console.error("Add Asset Error:", error);
        btn.textContent = "Network Error.";
        btn.style.backgroundColor = "#f44336";
        setTimeout(() => { 
            btn.textContent = "Add to My Garden"; 
            btn.style.backgroundColor = ""; 
            btn.disabled = false;
        }, 3000);
    }
}

// --- REMOVE ASSET LOGIC ---
function handleRemoveAsset(event) {
    const btn = event.target.closest('.remove-asset-btn');
    if (!btn) return;

    if (btn.dataset.confirming === 'true') {
        // Second tap — execute removal
        const assetId = btn.getAttribute('data-asset-id');
        executeRemoveAsset(assetId, btn);
    } else {
        // First tap — ask for confirmation
        btn.dataset.confirming = 'true';
        btn.textContent = 'Remove?';
        btn.classList.add('confirming');

        // Auto-reset after 3 seconds if no second tap
        setTimeout(() => {
            if (btn.dataset.confirming === 'true') {
                btn.dataset.confirming = 'false';
                btn.textContent = '✕';
                btn.classList.remove('confirming');
            }
        }, 3000);
    }
}

async function executeRemoveAsset(assetId, btn) {
    btn.disabled = true;
    btn.textContent = '⏳';

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'remove_asset',
                asset_id: assetId
            })
        });

        const result = await response.json();
        if (result.status === 'success') {
            btn.textContent = '✓';
            btn.classList.remove('confirming');
            btn.classList.add('removed');

            // Refresh inventory and today's tasks after a short delay
            setTimeout(() => {
                fetchInventory();
                fetchGardeningTasks();
            }, 600);
        } else {
            throw new Error(result.message || 'Remove failed');
        }
    } catch (error) {
        console.error('Remove Asset Error:', error);
        btn.disabled = false;
        btn.textContent = '✕';
        btn.dataset.confirming = 'false';
        btn.classList.remove('confirming');
    }
}

// --- SWIPE-TO-REVEAL "HIDE" GESTURE ---
// A horizontal drag on a task card slides it aside to reveal the Hide button
// sitting underneath. Direction-locked against startY/startX so a vertical
// scroll gesture is left alone and never mistaken for a swipe.

function onCardPointerDown(e) {
    const wrapper = e.target.closest('.task-card-wrapper');
    if (!wrapper) return;

    const card = wrapper.querySelector('.task-card');
    const wasRevealed = wrapper.classList.contains('revealed');

    dragState = {
        wrapper, card,
        startX: e.clientX,
        startY: e.clientY,
        startTransform: wasRevealed ? -HIDE_REVEAL_WIDTH : 0,
        locked: false,
        isHorizontal: false,
        lastX: undefined
    };
    card.style.transition = 'none';
}

function onCardPointerMove(e) {
    if (!dragState) return;

    const deltaX = e.clientX - dragState.startX;
    const deltaY = e.clientY - dragState.startY;

    if (!dragState.locked) {
        if (Math.abs(deltaX) < 6 && Math.abs(deltaY) < 6) return; // not enough movement to decide yet
        dragState.locked = true;
        dragState.isHorizontal = Math.abs(deltaX) > Math.abs(deltaY);
        if (!dragState.isHorizontal) {
            // Vertical gesture — this is a page scroll, not our swipe. Hand it back.
            dragState.card.style.transition = '';
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
    card.style.transition = '';

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
    wrapper.classList.add('revealed');
    wrapper.querySelector('.task-card').style.transform = `translateX(-${HIDE_REVEAL_WIDTH}px)`;
    currentlyRevealedWrapper = wrapper;
}

function closeSwipeWrapper(wrapper) {
    wrapper.classList.remove('revealed');
    wrapper.querySelector('.task-card').style.transform = 'translateX(0)';
    if (currentlyRevealedWrapper === wrapper) currentlyRevealedWrapper = null;
}

// --- HIDE THIS TASK ---
// Tapping Hide removes the card immediately and fires the request in the
// background, with a few seconds' grace via the Undo toast before it's final.

async function handleHideTaskClick(event) {
    const hideBtn = event.target.closest('.hide-task-btn');
    if (!hideBtn) return;

    const taskId = hideBtn.getAttribute('data-task-id');
    const wrapper = hideBtn.closest('.task-card-wrapper');
    const nameEl = wrapper ? wrapper.querySelector('.task-info h3') : null;
    const taskName = nameEl ? nameEl.textContent : 'Task';

    if (currentlyRevealedWrapper === wrapper) currentlyRevealedWrapper = null;
    if (wrapper) wrapper.remove();

    showUndoToast(taskId, taskName);

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'hide_task', task_id: taskId })
        });
        const result = await response.json();
        if (result.status !== 'success') {
            console.error('Hide task failed:', result.message);
        }
    } catch (error) {
        console.error('Hide Task Error:', error);
    }
}

function showUndoToast(taskId, taskName) {
    if (undoToastTimeout) clearTimeout(undoToastTimeout);

    undoToastTaskId = taskId;
    const toast = document.getElementById('undo-toast');
    const message = document.getElementById('undo-toast-message');
    message.textContent = `"${taskName}" hidden.`;
    toast.classList.add('visible');

    undoToastTimeout = setTimeout(() => {
        toast.classList.remove('visible');
        undoToastTimeout = null;
        undoToastTaskId = null;
    }, 5000);
}

async function handleUndoHide() {
    if (!undoToastTaskId) return;
    const taskId = undoToastTaskId;

    if (undoToastTimeout) { clearTimeout(undoToastTimeout); undoToastTimeout = null; }
    document.getElementById('undo-toast').classList.remove('visible');
    undoToastTaskId = null;

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'unhide_task', task_id: taskId })
        });
        const result = await response.json();
        if (result.status === 'success') {
            fetchGardeningTasks(); // bring the restored task straight back
        } else {
            console.error('Undo failed:', result.message);
        }
    } catch (error) {
        console.error('Undo Hide Error:', error);
    }
}

// --- HIDDEN TASKS MANAGEMENT (settings gear icon) ---

function openHiddenTasksModal() {
    document.getElementById('hidden-tasks-modal').classList.remove('hidden');
    fetchHiddenTasks();
}

function closeHiddenTasksModal() {
    document.getElementById('hidden-tasks-modal').classList.add('hidden');
}

async function fetchHiddenTasks() {
    const listEl = document.getElementById('hidden-tasks-list');
    listEl.innerHTML = '<div class="loading-spinner-box">Loading...</div>';

    try {
        const response = await fetch(API_URL + '?action=get_hidden_tasks&t=' + Date.now(), { cache: 'no-store' });
        const result = await response.json();

        if (result.status !== 'success') throw new Error(result.message || 'Unknown error');
        renderHiddenTasksList(result.data);
    } catch (error) {
        console.error('Fetch Hidden Tasks Error:', error);
        listEl.innerHTML = '<div class="loading-spinner-box" style="color:red;">Failed to load hidden tasks.</div>';
    }
}

function renderHiddenTasksList(hiddenTasks) {
    const listEl = document.getElementById('hidden-tasks-list');
    listEl.innerHTML = '';

    if (hiddenTasks.length === 0) {
        listEl.innerHTML = '<div class="loading-spinner-box">You haven\'t hidden any tasks.</div>';
        return;
    }

    hiddenTasks.forEach(task => {
        const card = document.createElement('div');
        card.className = 'hidden-task-card';
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
    const btn = event.target.closest('.restore-task-btn');
    if (!btn) return;

    const taskId = btn.getAttribute('data-task-id');
    btn.disabled = true;
    btn.textContent = '⏳';

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'unhide_task', task_id: taskId })
        });
        const result = await response.json();

        if (result.status === 'success') {
            const card = btn.closest('.hidden-task-card');
            if (card) card.remove();

            fetchGardeningTasks(); // keep Today's Tasks in sync in the background

            const listEl = document.getElementById('hidden-tasks-list');
            if (listEl.children.length === 0) {
                listEl.innerHTML = '<div class="loading-spinner-box">You haven\'t hidden any tasks.</div>';
            }
        } else {
            throw new Error(result.message || 'Restore failed');
        }
    } catch (error) {
        console.error('Restore Task Error:', error);
        btn.disabled = false;
        btn.textContent = 'Restore';
    }
}

async function handleTaskCompletion(event) {
    if (!event.target.classList.contains("task-check")) return;

    const checkbox = event.target;
    const card = checkbox.closest(".task-card");
    const taskId = checkbox.getAttribute("data-task-id");
    const assetId = checkbox.getAttribute("data-asset-id");

    checkbox.disabled = true;
    checkbox.innerText = "⏳";

    try {
        const response = await fetch(API_URL, {
            method: "POST",
            body: JSON.stringify({
                task_id: taskId,
                asset_id: assetId,
                notes: "Completed via PWA client"
            })
        });

        const result = await response.json();
        
        if(result.status === "success") {
            checkbox.classList.add("completed");
            checkbox.innerText = "✓";
            card.style.opacity = "0.5";
        }
    } catch (error) {
        console.error("POST Error:", error);
        checkbox.disabled = false;
        checkbox.innerText = "❌";
    }
}

// 1. Initial Data Fetches
document.addEventListener("DOMContentLoaded", () => {

    // 1. Fire these independently! If tasks fail, weather still loads.
    loadAppData();
    requestLocalWeather();

    // 2. Setup Event Listeners using your ACTUAL function names
    const taskContainer = document.getElementById("task-container");
    if (taskContainer) {
        taskContainer.addEventListener("click", handleTaskCompletion);
        taskContainer.addEventListener("click", handleHideTaskClick);

        // Swipe-to-reveal gesture on task cards
        taskContainer.addEventListener("pointerdown", onCardPointerDown);
        taskContainer.addEventListener("pointermove", onCardPointerMove);
        taskContainer.addEventListener("pointerup", onCardPointerUp);
        taskContainer.addEventListener("pointercancel", onCardPointerUp);
    }

    const inventoryList = document.getElementById("inventory-list");
    if (inventoryList) inventoryList.addEventListener("click", handleRemoveAsset);
    
    const addAssetBtn = document.getElementById("add-asset-btn");
    if (addAssetBtn) addAssetBtn.addEventListener("click", handleAddAsset);

    // 3. Undo toast
    const undoBtn = document.getElementById("undo-toast-btn");
    if (undoBtn) undoBtn.addEventListener("click", handleUndoHide);

    // 4. Hidden tasks settings modal
    const settingsBtn = document.getElementById("settings-btn");
    if (settingsBtn) settingsBtn.addEventListener("click", openHiddenTasksModal);

    const closeModalBtn = document.getElementById("close-hidden-modal");
    if (closeModalBtn) closeModalBtn.addEventListener("click", closeHiddenTasksModal);

    const hiddenModal = document.getElementById("hidden-tasks-modal");
    if (hiddenModal) {
        // Tapping the dimmed backdrop (not the panel itself) closes the modal
        hiddenModal.addEventListener("click", (e) => {
            if (e.target === hiddenModal) closeHiddenTasksModal();
        });
    }

    const hiddenTasksList = document.getElementById("hidden-tasks-list");
    if (hiddenTasksList) hiddenTasksList.addEventListener("click", handleRestoreTask);
});
