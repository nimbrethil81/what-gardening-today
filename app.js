const API_URL = "https://script.google.com/macros/s/AKfycbwrxA5Le2a3uawQFZ6xAX1jsJ_Tou2Vy4w_x8qhNbNSC_UyJ5N-WveFuM_QjPqL6yA1/exec"; 

// --- SPA NAVIGATION & DICTIONARY LOGIC ---
let globalDictionary = [];

document.addEventListener("DOMContentLoaded", () => {
  // Navigation Event Listeners
  document.getElementById('nav-today').addEventListener('click', () => switchView('today'));
  document.getElementById('nav-profile').addEventListener('click', () => switchView('profile'));
});

function switchView(viewName) {
  // 1. Hide everything and remove active states
  document.getElementById('view-today').classList.add('hidden');
  document.getElementById('view-profile').classList.add('hidden');
  document.getElementById('nav-today').classList.remove('active');
  document.getElementById('nav-profile').classList.remove('active');

  // 2. Show the requested view
  if (viewName === 'today') {
    document.getElementById('view-today').classList.remove('hidden');
    document.getElementById('nav-today').classList.add('active');
  } else if (viewName === 'profile') {
    document.getElementById('view-profile').classList.remove('hidden');
    document.getElementById('nav-profile').classList.add('active');
    
    // Fetch the dictionary only once
    if (globalDictionary.length === 0) {
      fetchDictionary();
    }
    
    // ALWAYS fetch fresh inventory when opening the tab
    fetchInventory();
  }
}

async function fetchDictionary() {
  try {
    // Note: We append ?action=get_dictionary to hit the new logic block in your API
    const response = await fetch(API_URL + "?action=get_dictionary");
    const result = await response.json();
    
    if (result.status === 'success') {
      globalDictionary = result.data;
      setupDropdownLogic();
    }
  } catch (error) {
    console.error("Error fetching dictionary:", error);
  }
}

function setupDropdownLogic() {
  const categorySelect = document.getElementById('category-select');
  const itemSelect = document.getElementById('item-select');

  categorySelect.addEventListener('change', (e) => {
    const selectedCategory = e.target.value;
    
    // Reset the second dropdown
    itemSelect.innerHTML = '<option value="">2. Select Item...</option>'; 
    
    if (selectedCategory) {
      // Filter the global dictionary for items matching the chosen category
      const filteredItems = globalDictionary.filter(item => item.category === selectedCategory);
      
      // Populate the second dropdown
      filteredItems.forEach(item => {
        const option = document.createElement('option');
        option.value = item.prefix; // The database key (e.g., PLANT_ROSE)
        option.textContent = item.suggested_name; // The friendly text (e.g., Rose)
        itemSelect.appendChild(option);
      });
      
      itemSelect.disabled = false;
    } else {
      itemSelect.disabled = true;
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
    const actionButton = document.getElementById("action-btn");
    const taskContainer = document.getElementById("task-container");
  // NEW: Listen for the "Add to Garden" button click
    const addAssetBtn = document.getElementById("add-asset-btn");
    if (addAssetBtn) {
        addAssetBtn.addEventListener("click", handleAddAsset);
    }

    // Add immediate visual event listener to your primary action button
    if (actionButton) {
        actionButton.addEventListener("click", fetchGardeningTasks);
    }

    // NEW: Listen for checkbox toggles inside the task container
    if (taskContainer) {
        taskContainer.addEventListener("change", handleTaskCompletion);
    }
});

/**
 * Orchestrates the pipeline: shows loading states, requests the JSON payload from the API,
 * evaluates structural errors, and passes the arrays to the renderer.
 */
async function fetchGardeningTasks() {
    const taskContainer = document.getElementById("task-container");
    const actionButton = document.getElementById("action-btn");

    // 1. Establish visual UI state loading feedback
    actionButton.disabled = true;
    actionButton.textContent = "Checking your garden...";
    taskContainer.innerHTML = `
        <div class="loading-spinner-box">
            <p>Gathering seasonal rules and garden configurations...</p>
        </div>
    `;

    try {
        // 2. Query data based on the client's current system calendar month (1-12)
        const currentMonth = new Date().getMonth() + 1;
        const targetRequestUrl = `${API_URL}?month=${currentMonth}`;

        const response = await fetch(targetRequestUrl);
        
        if (!response.ok) {
            throw new Error(`Network returned structural status code: ${response.status}`);
        }

        const payload = await response.json();

        // 3. Evaluate backend logical flags
        if (payload.status === "success" || payload.success === true) {
            // Extract safe collection array from historical or upgraded naming keys
            const taskList = payload.data || payload.tasks || [];
            renderTaskCards(taskList);
        } else {
            throw new Error(payload.message || payload.error || "Unknown backend processing breakdown.");
        }

    } catch (error) {
        console.error("API Pipeline Error:", error);
        taskContainer.innerHTML = `
            <div class="error-card">
                <h3>Pipeline Connection Error</h3>
                <p>Could not load your garden data layer. Verify your Web App deployment settings allow access to 'Anyone'.</p>
                <small>${error.message}</small>
            </div>
        `;
    } finally {
        // 4. Re-enable user interaction loops
        actionButton.disabled = false;
        actionButton.textContent = "What gardening should I do today?";
    }
}

/**
 * Loops through the array elements and builds clean visual nodes inside the viewport DOM.
 */
function renderTaskCards(tasks) {
    const taskContainer = document.getElementById("task-container");
    taskContainer.innerHTML = ""; // Clear loader references

    // Handle empty state gracefully if no assets match current season parameters
    if (tasks.length === 0) {
        taskContainer.innerHTML = `
            <div class="empty-state-card">
                <p>✨ Your garden is perfectly up to date! No specific mandatory tasks registered for this month's conditions.</p>
            </div>
        `;
        return;
    }

    // Build functional markup loops
    tasks.forEach(task => {
        const card = document.createElement("div");
        card.className = `task-card category-${cleanStringForClass(task.category)}`;
        
        // Use fallbacks to handle both code structures interchangeably
        const displayName = task.task_display_name || `${task.task_name} (${task.asset_friendly_name || 'Garden'})`;
        const instructionText = task.instruction || "No specific care directions recorded.";
        const frequencyText = task.frequency || task.frequency_days ? `Every ${task.frequency || task.frequency_days} days` : "Seasonal routine";

        card.innerHTML = `
            <div class="task-card-header">
                <span class="category-badge">${task.category}</span>
                <span class="frequency-badge">${frequencyText}</span>
            </div>
            <h3 class="task-title">${displayName}</h3>
            <p class="task-instruction">${instructionText}</p>
            
            <label class="completion-checkbox-wrapper">
                <input type="checkbox" class="task-check" data-task-id="${task.task_id}" data-asset-id="${task.asset_id}">
                <span class="checkbox-label-text">Mark Task Completed</span>
            </label>
        `;
        
        taskContainer.appendChild(card);
    });
}

/**
 * Utility function to sanitize raw category names for CSS hook modifications
 */
function cleanStringForClass(str) {
    if (!str) return "generic";
    return str.toLowerCase().replace(/[^a-z0-9]/g, "-");
}

/**
 * Catches checkbox clicks, sends a POST request to the Google Sheet, 
 * and handles the visual UI updates.
 */
async function handleTaskCompletion(event) {
    // Only proceed if the changed element is specifically a task checkbox
    if (!event.target.classList.contains("task-check")) return;

    const checkbox = event.target;
    const card = checkbox.closest(".task-card");
    const taskId = checkbox.getAttribute("data-task-id");
    const assetId = checkbox.getAttribute("data-asset-id");
    const label = card.querySelector(".checkbox-label-text");

    // 1. Give immediate visual feedback that the network is working
    checkbox.disabled = true;
    label.textContent = "Logging to database...";

    try {
        // 2. Fire the payload to the backend
        const response = await fetch(API_URL, {
            method: "POST",
            body: JSON.stringify({
                task_id: taskId,
                asset_id: assetId,
                notes: "Completed via PWA client"
            })
        });

        const result = await response.json();

        // 3. Evaluate backend response
        if (result.status === "success" || result.success === true) {
            // Success! Visually confirm it for the user
            label.textContent = "Completed! 🎉";
            card.style.opacity = "0.5"; // Dim the card to show it's done
            card.style.transition = "opacity 0.3s ease";
        } else {
            throw new Error(result.message || "Database rejected the log.");
        }

    } catch (error) {
        // 4. Graceful Error Handling
        console.error("POST Pipeline Error:", error);
        label.textContent = "Network error. Try again.";
        label.style.color = "#f44336"; // Turn text red
        checkbox.disabled = false;
        checkbox.checked = false; // Uncheck it so they can try again
    }
}
/**
 * Gathers user input, generates a unique Asset ID, and posts it to the User_Profile database.
 */
async function handleAddAsset() {
    const category = document.getElementById('category-select').value;
    const itemPrefix = document.getElementById('item-select').value;
    const customName = document.getElementById('custom-name').value;
    const btn = document.getElementById('add-asset-btn');

    // 1. Validation to prevent empty database rows
    if (!category || !itemPrefix || !customName) {
        alert("Please select a category, an item, and provide a custom name.");
        return;
    }

    // 2. Generate a unique Asset_ID (e.g., PLANT_ROSE_8492) to prevent primary key conflicts
    const uniqueAssetId = `${itemPrefix}_${Math.floor(1000 + Math.random() * 9000)}`;

    // 3. UI Loading State
    btn.disabled = true;
    btn.textContent = "Planting in database...";

    try {
        // 4. Send payload to API Gateway
        const response = await fetch(API_URL, {
            method: "POST",
            body: JSON.stringify({
                action: "add_asset", // Triggers ROUTE 1 in Apps Script
                asset_id: uniqueAssetId,
                category: category,
                friendly_name: customName
            })
        });

        const result = await response.json();

        // 5. Evaluate and render success state
        if (result.status === "success" || result.success === true) {
            btn.textContent = "Added to Garden! 🎉";
            btn.style.backgroundColor = "#2e7d32"; // Dark success green
            
            // Gracefully reset the form after 2 seconds
            setTimeout(() => {
                document.getElementById('category-select').value = "";
                
                const itemSelect = document.getElementById('item-select');
                itemSelect.innerHTML = '<option value="" disabled selected hidden>2. Select Item...</option>';
                itemSelect.disabled = true;
                
                document.getElementById('custom-name').value = "";
                
                btn.textContent = "Add to Garden";
                btn.style.backgroundColor = ""; 
                btn.disabled = false;

                // NEW: Refresh the inventory list to show the newly added item!
                fetchInventory();
            }, 2000);
        } else {
            throw new Error(result.message || "Database rejected the entry.");
        }

    } catch (error) {
        // 6. Fail gracefully on network errors
        console.error("Add Asset Error:", error);
        btn.textContent = "Network Error. Try again.";
        btn.style.backgroundColor = "#f44336"; // Red error state
        
        setTimeout(() => {
            btn.textContent = "Add to Garden";
            btn.style.backgroundColor = "";
            btn.disabled = false;
        }, 3000);
    }
}
/**
 * Fetches the user's active garden items from the database
 */
async function fetchInventory() {
    const inventoryList = document.getElementById('inventory-list');
    inventoryList.innerHTML = '<p class="empty-state">Loading inventory...</p>';

    try {
        const response = await fetch(API_URL + "?action=get_profile");
        const result = await response.json();

        if (result.status === 'success') {
            renderInventory(result.data);
        } else {
            throw new Error(result.message);
        }
    } catch (error) {
        console.error("Error fetching inventory:", error);
        inventoryList.innerHTML = '<p class="empty-state" style="color: #f44336;">Failed to load inventory.</p>';
    }
}

/**
 * Builds the HTML for the inventory list
 */
function renderInventory(items) {
    const inventoryList = document.getElementById('inventory-list');
    inventoryList.innerHTML = ''; // Clear loader

    if (items.length === 0) {
        inventoryList.innerHTML = '<p class="empty-state">Your garden is empty! Add some items above.</p>';
        return;
    }

    items.forEach(item => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'inventory-item';
        itemDiv.innerHTML = `
            <div class="inventory-details">
                <strong>${item.friendly_name}</strong>
                <span class="inventory-category">${item.category}</span>
            </div>
            `;
        inventoryList.appendChild(itemDiv);
    });
}
