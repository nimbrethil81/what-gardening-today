const API_URL = "YOUR_APPS_SCRIPT_WEB_APP_URL_HERE"; // Replace with your deployment URL

document.getElementById('actionBtn').addEventListener('click', fetchTasks);

function fetchTasks() {
    const container = document.getElementById('taskContainer');
    const loader = document.getElementById('loader');
    
    container.innerHTML = '';
    loader.classList.remove('hidden');

    const currentMonth = new Date().getMonth() + 1;
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    document.getElementById('listHeading').innerText = `TODAY'S TASKS (${months[currentMonth - 1]})`;

    fetch(`${API_URL}?month=${currentMonth}`)
        .then(response => response.json())
        .then(res => {
            loader.classList.add('hidden');
            if (res.status === "success" && res.data.length > 0) {
                renderCards(res.data);
            } else {
                container.innerHTML = '<p style="text-align:center; color:#666;">No maintenance operations required for your profile today!</p>';
            }
        })
        .catch(err => {
            loader.classList.add('hidden');
            container.innerHTML = '<p style="text-align:center; color:red;">Network communication failure.</p>';
            console.error(err);
        });
}

function renderCards(tasks) {
    const container = document.getElementById('taskContainer');
    tasks.forEach(task => {
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `
            <div class="checkbox-container">
                <input type="checkbox" id="${task.task_id}">
            </div>
            <div class="card-content">
                <span class="category-tag">${task.category}</span>
                <h3>${task.task_name}</h3>
                <p>${task.instruction}</p>
            </div>
        `;
        container.appendChild(card);
    });
}

// Service Worker Registration for PWA capability
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('Service worker operational:', reg.scope))
            .catch(err => console.error('Service worker initialization failure:', err));
    });
}