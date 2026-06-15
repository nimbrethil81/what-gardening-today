const API_URL = "https://script.google.com/macros/s/AKfycbwrxA5Le2a3uawQFZ6xAX1jsJ_Tou2Vy4w_x8qhNbNSC_UyJ5N-WveFuM_QjPqL6yA1/exec";

// --- LOCAL MEMORY STATE ---
let globalDictionary = [];
let userInventory = [];
let selectedCategoryRef = null;
let selectedSubItemObj = null; // Stores the actual dictionary row object

document.addEventListener("DOMContentLoaded", () => {
    // 1. Initial Data Fetches
    fetchGardeningTasks();
    fetchDictionary();
    fetchInventory();

    // 2. Setup Event Listeners
    const taskContainer = document.getElementById("task-container");
    if(taskContainer) {
        taskContainer.addEventListener("click", handleTaskCompletion);
    }

    const addAssetBtn = document.getElementById("add-asset-btn");
    if (addAssetBtn) {
        addAssetBtn.addEventListener("click", handleAddAsset);
    }
});

// --- NAVIGATION LOGIC ---
function switchTab(viewId, element) {
    // Toggle nav active state
    document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
    element.classList.add('active');

    // Swap views
    document.querySelectorAll('.view-section').forEach(section => section.classList.remove('active-view'));
    document.getElementById(`view-${viewId}`).classList.add('active-view');
}

// --- API FETCHERS ---
async function fetchDictionary() {
    try {
        const response = await fetch(API_URL + "?action=get_dictionary");
        const result = await response.json();
        if(result.status === "success") {
            globalDictionary = result.data;
        }
    } catch (error) {
        console.error("Error fetching dictionary:", error);
    }
}

async function fetchGardeningTasks() {
    const taskContainer = document.getElementById("task-container");
    taskContainer.innerHTML = '<div class="loading-spinner-box">Gathering seasonal rules...</div>';

    try {
        const currentMonth = new Date().getMonth() + 1;
        const targetRequestUrl = `${API_URL}?month=${currentMonth}`;
        
        const response = await fetch(targetRequestUrl);
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
    inventoryList.innerHTML = '<div class="loading-spinner-box">Loading inventory...</div>';

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

// --- UI RENDERING LOGIC ---
function renderTaskCards(tasks) {
    const taskContainer = document.getElementById("task-container");
    taskContainer.innerHTML = "";

    if (tasks.length === 0) {
        taskContainer.innerHTML = `<div class="loading-spinner-box">✨ Your garden is up to date!</div>`;
        return;
    }

    tasks.forEach(task => {
        const card = document.createElement("div");
        card.className = `task-card`;
        
        // Build the modern UI card
        card.innerHTML = `
            <div class="task-info">
                <h3>${task.task_name}</h3>
                <p>${task.category} • ${task.instruction}</p>
            </div>
            <button class="task-action-btn task-check" data-task-id="${task.task_id}" data-asset-id="${task.asset_id}">✓</button>
        `;
        taskContainer.appendChild(card);
    });
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
            
            // Note: Our API returns friendly_name. 
            // In the real sheet, Suggested Name isn't passed back from the profile, so we use friendly_name.
            cardDiv.innerHTML = `
                <div>
                    <strong>${item.friendly_name || item.asset_id}</strong>
                </div>
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
