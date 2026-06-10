# 🌿 What Gardening Today? (MVP)

A minimalist, zero-cost progressive web app (PWA) designed to eliminate beginner gardening decision paralysis by serving up a single, localized actionable maintenance checklist.

## 🚀 Live Application
Access the app on your mobile device here:
👉 **[https://nimbrethil81.github.io/what-gardening-today/](https://nimbrethil81.github.io/what-gardening-today/)**

### 📱 iOS Home Screen Installation
1. Open the link above in **Safari** on your iPhone.
2. Tap the **Share** button (up-arrow icon) in the bottom toolbar.
3. Scroll down and select **Add to Home Screen**.
4. Open the app from your home screen to experience it as a native, borderless utility.

---

## 🛠️ Architecture & Technical Stack

*   **Frontend:** HTML5, Vanilla JavaScript, CSS3 (Hosted free on GitHub Pages)
*   **PWA Layer:** Service Worker (`sw.js`) offline caching + Web App Manifest (`manifest.json`)
*   **API Gateway:** Google Apps Script (Deployed as a public Web App acting as a micro REST API)
*   **Database:** Google Sheets (Relational structure mimicking production tables)

---

## 📊 Data Maintenance

To modify your garden profile assets or alter the rules of the logic engine, update your linked Google Sheet tracking workbook directly:

*   **`User_Profile`**: Toggle assets (e.g., `LAWN_01`, `TOMATO_01`) between `TRUE` and `FALSE` to reflect your physical inventory.
*   **`Master_Task_Matrix`**: Add or adjust task constraints, calendar month flags (`Valid_Months`), and standard operation instructions.

---

## 🗺️ Engineering Roadmap

- [x] **Phase 1 (Current):** Setup Zero-Cost Jamstack Engine & PWA Delivery.
- [ ] **Phase 2:** Interactivity & Stateful Memory (Persistent task logging via `Task_Log` writes).
- [ ] **Phase 3:** Environmental API Integration (HTML5 Geolocation + OpenWeather API smart filtering).
- [ ] **Phase 4:** Scale Migrate to Supabase (PostgreSQL) + Native App Engine (Flutter/SwiftUI).
