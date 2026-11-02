# 🐦 3D Flappy Bird Online (GitHub & Render Edition)

A modular, full-stack **3D Flappy Bird Online** web game built with **Three.js (WebGL)** and **Node.js**, featuring **96 unlockable 3D cosmetics** (53 Bird & Pokémon skins + 43 Pipe skins), **60Hz deterministic server-side anti-cheat**, **Top 100 multi-entry leaderboards** across Easy, Medium, and Hard modes, and a **live auto-updating database (`data/db.json` + `/database`)**.

---

## 📁 Modular Project Structure

Instead of one giant file, the project is cleanly split into small, focused files so updates are fast and easy:

```text
Flappy-Bird-3D(Github-repo)/
├── server.js                      # Main HTTP server entry point (Render-ready)
├── package.json                   # Node.js package config (`npm start`)
├── render.yaml                    # Render.com 1-click deployment blueprint
├── .gitignore                     # Git ignore rules
├── data/
│   ├── db.json                    # Live auto-updating database (logins, new bests, accounts, runs)
│   └── seed-db.json               # Backup seed database with all existing accounts & records
├── src/
│   ├── config/
│   │   └── physicsConfig.js       # Shared 60Hz deterministic physics constants & Mulberry32 PRNG
│   ├── services/
│   │   ├── antiCheat.js           # Authoritative 60Hz server-side replay verification
│   │   └── database.js            # Auto-updating JSON database manager + live file watcher
│   └── routes/
│       └── apiRoutes.js           # All REST API routes (/api/login, /api/run/*, /api/database/*)
└── public/
    ├── index.html                 # Main 3D game page
    ├── admin-db.html              # Live Database Viewer & Record Editor (/database)
    ├── css/
    │   ├── main.css               # Core HUD, Lobby, Locker, Leaderboard & Stats layout
    │   └── themes.css             # Dark, Light, and Cyber / Retro color themes
    └── js/
        ├── config.js              # Client physics config & seeded PRNG
        ├── skins-data.js          # All 53 Bird Skins & 43 Pipe Skins definitions
        ├── sound.js               # Web Audio API sound synthesizer
        ├── textures.js            # Procedural HDR studio envMap, bump maps & pipe textures
        ├── models-3d.js           # 3D Bird, True 3D Pokémon, Wings, Pipes & Particle builders
        ├── ui-views.js            # Locker, Stats, Leaderboard, Auth & Theme UI controller
        └── game.js                # Main FlappyBirdOnline game loop & bootstrap
```

---

## 🗄️ How the Auto-Updating Database Works

Every time a player **logs in**, **registers**, or **gets a NEW BEST score**, the database (`data/db.json`) automatically updates and writes human-readable status messages right at the top of `data/db.json`:

1. **`databaseStatus`** (Top of `data/db.json`):
   - Shows `lastUpdatedReadable`, `latestEventBanner` (e.g. who just logged in or achieved a new best), `currentChampions` for Easy/Medium/Hard, and total counts.
2. **`playerRecordsOverview`** (Second section of `data/db.json`):
   - Lists every player sorted by their highest all-time score with:
     - `summary`: `"🏆 Best: 109 pts (Easy: 109 | Medium: 40 | Hard: 27)"`
     - `loginStatus`: `"🔑 Logged in 4 time(s) • Last login: ..."`
     - `newBestStatus`: `"🔥 NEW BEST in EASY: 109 pts ..."`
     - `records`: `{ "easy": 109, "medium": 40, "hard": 27 }`
3. **`activityFeed`** (Third section of `data/db.json`):
   - Keeps a chronological log of every `LOGIN`, `NEW_BEST`, `REGISTER`, `VERIFIED_RUN`, and `ADMIN_RECORD_UPDATE`.

### How to Look At or Change Player Records:
- **Option A — In Your Browser (`/database`)**:
  - Open `http://localhost:3000/database` (or `https://your-render-url.onrender.com/database` or click the **🗄️** icon in the top-right bar of the game).
  - You can see live logins, new bests, and edit any player's **Easy**, **Medium**, or **Hard** record and click **💾 Save**!
- **Option B — Directly in `data/db.json`**:
  - Open `data/db.json` in any text editor, change a player's `easy`, `medium`, or `hard` score under `playerRecordsOverview` or `users`, and save the file. The server watches `data/db.json` and automatically syncs your changes to the leaderboards!

---

## 🚀 How to Host on Render.com (Step-by-Step)

1. **Create a GitHub Repository**:
   - Create a new repository on [GitHub](https://github.com/new) (e.g., `Flappy-Bird-3D`).
   - Open a terminal inside this `Flappy-Bird-3D(Github-repo)` folder and run:
     ```bash
     git init
     git add .
     git commit -m "Initial commit: Modular 3D Flappy Bird Online with live database"
     git branch -M main
     git remote add origin https://github.com/<your-username>/<your-repo>.git
     git push -u origin main
     ```
2. **Deploy on Render**:
   - Go to [dashboard.render.com](https://dashboard.render.com/) and click **New +** → **Web Service** (or **Blueprint**).
   - Connect your GitHub repository.
   - Use these settings (auto-configured via `render.yaml`):
     - **Runtime**: `Node`
     - **Build Command**: `npm install`
     - **Start Command**: `npm start`
   - Click **Create Web Service** — your 3D Flappy Bird website will be live in ~1 minute!
