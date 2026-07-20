# 📱 Boom Scroll — Mobile & Desktop Learning Feed

**Boom Scroll** is a mobile-first, text-only flashcard learning feed designed as a companion app for **Aetherium**. It turns study decks exported from Aetherium into a vertical, single-card swipe feed with interactive flip reveals and multi-workspace filtering.

---

## 🛠️ Technology Stack

Boom Scroll is built using **Tauri v2**, giving it native cross-platform support across Mobile (Android & iOS) and Desktop (macOS, Linux, Windows), as well as a standalone web app fallback.

### Frontend
- **Framework:** React 18 / 19 with TypeScript (strict mode)
- **Styling:** Tailwind CSS v3 with custom mobile viewport configurations (`viewport-fit=cover`)
- **Bundler:** Vite 7
- **Animations & Interaction:** Touch/Pointer gesture handlers with rubber-banding, threshold-based swipe commits, and pre-shuffled deck queues

### Backend & Native Shell
- **Core Framework:** Tauri v2 (Rust)
- **Native Plugins:**
  - `@tauri-apps/plugin-dialog` / `tauri-plugin-dialog`: Native OS file picker dialogs
  - `@tauri-apps/plugin-fs` / `tauri-plugin-fs`: Native filesystem access for deck imports
- **Android Target:** Configured under `src-tauri/gen/android` using Kotlin & Gradle (`com.aetherium.boomscroll`)

---

## 🗂️ Deck Format & Persistence

### 1. File Format (`aetherium.boomscroll.deck` v2)
Boom Scroll reads `.json` deck files exported from Aetherium (**Preferences → Backup → Boom Scroll**). Decks contain workspace metadata and flashcards:

```json
{
  "format": "aetherium.boomscroll.deck",
  "version": 2,
  "exported_at": "2026-07-20T11:05:00Z",
  "card_count": 64,
  "workspaces": [
    {
      "id": "workspace-1",
      "name": "🧠 AI & Machine Learning",
      "card_count": 8
    }
  ],
  "cards": [
    {
      "id": "card-1",
      "kind": "flashcard",
      "front": "What does Q, K, V stand for in attention?",
      "back": "Query, Key, Value — Q asks 'what to look for', K advertises 'what I am', and V states 'what I contain'.",
      "topic": "Attention Mechanism",
      "workspace_id": "workspace-1"
    }
  ]
}
```

### 2. Built-in Demo Deck
Includes an expanded 64-card demo deck (`public/demo.json`) across 8 subjects:
- 🧠 **AI & Machine Learning** (Transformers, Attention, Scaling Laws)
- 🎼 **Music Theory** (Intervals, Cadences, Polyrhythms, Progression)
- 🏛️ **Roman Empire** (Republic collapse, Rubicon crossing, Legion structure)
- ⚡ **Quantum Computing & Physics** (Superposition, Entanglement, Shor's/Grover's algorithms)
- 🌱 **Biology & Genetics** (Central Dogma, CRISPR, Respiration, Mitosis vs. Meiosis)
- 🐍 **Software Architecture & Python** (CPython GIL, Generators, SOLID, `asyncio`)
- 🌐 **Earth Science & Geography** (Plate Tectonics, Thermohaline Circulation, Biomes)
- 💰 **Macro & Micro Economics** (Elasticity, Fiscal/Monetary Policy, Nash Equilibrium)

### 3. Local Storage Persistence
Loaded decks and active workspace filter selections are automatically persisted to `localStorage` (`boomscroll_active_deck` and `boomscroll_enabled_ids`). When launching or refreshing the app, your study feed is restored automatically.

---

## 🚀 Building and Running

### Prerequisites
- [Node.js](https://nodejs.org/) (v20 or v22)
- [Rust & Cargo](https://rustup.rs/) (for Tauri builds)
- [Android Studio & NDK](https://developer.android.com/studio) (only if building for Android)

### Commands

#### 1. Web Development Server
Runs the web app in standard browser dev mode:
```bash
npm install
npm run dev
```

#### 2. Tauri Desktop Dev Mode
Runs the Tauri native desktop app (macOS / Linux / Windows):
```bash
npm run tauri dev
```

#### 3. Android Dev Mode (via Tauri v2)
Launches the app on a connected Android device or emulator:
```bash
npm run tauri android dev
```

#### 4. Typecheck & Production Web Build
Validates TypeScript and generates static distribution assets in `dist/`:
```bash
npm run build
```

#### 5. Production Tauri Build
Compiles native release binaries / APK bundles:
```bash
npm run tauri build
```
