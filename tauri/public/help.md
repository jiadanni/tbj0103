# Help — Aetherium

Aetherium is a **local-first AI learning companion**. All data stays on your machine. This guide walks you through every major feature.

---

## Table of Contents

1. [Navigation Overview](#navigation-overview)
2. [Workspaces & Folders](#workspaces--folders)
3. [Chat](#chat)
4. [Notes](#notes)
5. [Sources (Documents & Web Captures)](#sources-documents--web-captures)
6. [Learning Hub](#learning-hub)
7. [Practice & Flashcards](#practice--flashcards)
8. [Quick Search](#quick-search)
9. [Command Palette](#command-palette)
10. [Split-Pane Mode](#split-pane-mode)
11. [Preferences](#preferences)
12. [Keyboard Shortcuts](#keyboard-shortcuts)
13. [Troubleshooting](#troubleshooting)

---

## Navigation Overview

The **sidebar** on the left lets you jump between sections:

| Section | What it does |
|---|---|
| **Dashboard** | Overview of workspace activity, stats, and quick links |
| **Chat** | AI conversations backed by your workspace context |
| **Notes** | Markdown notes with wiki-links and daily-note templates |
| **Sources** | Upload documents and save web pages for RAG |
| **Learning** | Knowledge graph, learning paths, and concept nodes |
| **History** | Browse and search all past chat sessions |
| **Practice** | Flashcard review using spaced repetition (SM-2) |

Click any icon to navigate. Use the **App Menu** (≡ in the top-left) for quick actions like *New Chat*, *New Note*, and *Preferences*.

---

## Workspaces & Folders

**Workspaces** are top-level containers. Notes, documents, web captures, flashcards, and knowledge-graph nodes all belong to a workspace. Chat sessions live inside **Projects** (sub-containers within a workspace).

### Creating a workspace

1. Open **Preferences → Workspaces**.
2. Click **+ New Workspace**, give it a name, and optionally add a description or custom prompt instructions.
3. Switch between workspaces with the workspace switcher in the sidebar header.

### Folders inside Chat

Within the Chat view you can organise sessions into folders:

1. In the session sidebar, click the **folder+** icon.
2. Type a name and press `Enter`.
3. Drag sessions onto a folder to move them, or right-click a session for **Move to…**.

---

## Chat

### Starting a new conversation

- Click **New Chat** in the App Menu, or press the **+** button in the Chat sidebar.
- Type your message in the composer at the bottom and press `Enter` (or `Ctrl/Cmd + Enter` if the composer is in *multiline mode*).

### Attaching files and images

1. Click the **paperclip** icon in the composer toolbar.
2. Choose a text file, image, or any document. Aetherium indexes the content and injects relevant excerpts into the AI context automatically.

### Switching AI models

Click the **model badge** at the bottom of the composer to open the model picker. Models are grouped by family (Llama, Gemma, Mistral, etc.). Select a family on the left, then a specific variant on the right.

### Incognito chats

Click the **ghost** icon (👻) in the Chat sidebar header to create an **Incognito** session. Incognito chats are never included in workspace analytics or knowledge extraction.

### Pinning a session

Right-click a session → **Pin**. Pinned sessions float to the top of the sidebar.

### Renaming a session

Double-click the session title in the sidebar, type the new name, and press `Enter`. Press `Escape` to cancel.

### Context-augmented responses (RAG)

When documents or web captures are present in your workspace, Aetherium automatically retrieves relevant chunks and supplies them as context. The composer toolbar shows when RAG context is active.

---

## Notes

### Creating a note

- App Menu → **New Note**, or click **+** inside the Notes view.
- Notes are stored as Markdown and auto-saved as you type.

### Wiki-links

Type `[[` to open a link picker. Select an existing note to create a backlink. Backlinks are indexed automatically and visible in the **Learning** graph.

### Daily notes

In the Notes sidebar, click **Today** to open or create today's daily note. Previous days appear below it in reverse chronological order.

### Templates

1. Open **Preferences → Notes** to create or edit note templates.
2. When creating a note, choose a template from the dropdown at the top of the editor.

### AI-assisted note extraction

With a note open, click the **sparkle (✨)** button to extract concepts. Aetherium sends the note to your preferred model and stores new concept nodes in the knowledge graph.

---

## Sources (Documents & Web Captures)

### Uploading a document

1. Go to **Sources** in the sidebar.
2. Click **Upload** and select a file (PDF, TXT, Markdown, etc.).
3. Aetherium chunks the document and indexes it for RAG. Chunks appear under the document entry.

### Saving a web page

1. In the Sources view, click **Capture URL**.
2. Paste a URL. The page content is fetched, cleaned, and stored locally — no data leaves your machine.

### Using sources in chat

Uploaded documents and web captures are automatically available as RAG context. You can also drag a source directly into the chat composer to reference it explicitly.

---

## Learning Hub

Open **Learning** in the sidebar. It contains three tabs:

| Tab | Description |
|---|---|
| **Graph** | Interactive knowledge graph of concept nodes and links |
| **Roadmap** | Learning-path view with milestone tracking |
| **Review** | Flashcard review queue (alias for Practice) |

### Knowledge graph

- **Nodes** represent concepts extracted from your notes, chats, and documents.
- Click a node to see its source notes and linked concepts.
- Drag nodes to rearrange the layout. Scroll to zoom in/out.

### Learning paths

Inside the Roadmap tab, click **+ Goal** to add a learning milestone to the current project. Goals track progress automatically as related sessions and notes accumulate.

---

## Practice & Flashcards

Aetherium uses the **SM-2** spaced repetition algorithm.

### Creating flashcards

1. Navigate to **Learning → Review** or **Practice** in the sidebar.
2. Click **+ Card** and fill in the front and back.
3. Alternatively, highlight text in a note or chat message, and choose **Create Flashcard** from the selection toolbar.

### Reviewing cards

- Cards due for review appear in the Practice view.
- Rate each answer (**Again / Hard / Good / Easy**) to schedule the next review automatically.

---

## Quick Search

**Quick Search** is a floating search window that searches across conversations, messages, notes, documents, artifacts, and memories.

### Opening Quick Search

- Default shortcut: `Ctrl/Cmd + Shift + K`  
  *(Configurable in Preferences → Advanced → Quick Search shortcut)*

### Filtering results

Use the type-filter chips at the top of the Quick Search window to narrow results by category (conversation, message, artifact, memory, summary). The workspace scope can be set to search all workspaces or just the active one.

---

## Command Palette

Press `Ctrl/Cmd + Shift + P` to open the **Command Palette**. Type any command name or navigate by section.

---

## Split-Pane Mode

Split-pane lets you work with two workspaces or chat sessions side by side.

### Enabling split-pane

Click the **split columns** icon (⧉) in the top-right toolbar.

### Independent panes

Each pane maintains its own:

- Active workspace and project
- Open chat session
- Folder filter

Changes in one pane do not affect the other.

### Closing split-pane

Click the split icon again to return to single-pane mode. Your primary pane's state is preserved.

---

## Preferences

Open via **App Menu → Preferences** or `Ctrl/Cmd + Shift + ,`.

| Section | Key settings |
|---|---|
| **App** | Theme, accent colour, font size, navigation layout |
| **Chat** | Preferred model, dual-model mode, composer behaviour |
| **AI** | Ollama URL, remote inference, MLX / llama.cpp paths |
| **Security** | Touch ID / PIN lock |
| **Data Controls** | Granular data deletion (chats, notes, sources, flashcards, concepts, memories, thought queue) and AI-inferred data reset |
| **Memory** | View and manage workspace and global memory entries |
| **Backup** | Export and import `.aetherium-backup` files |
| **Workspaces** | Create, rename, delete, and configure workspaces |
| **Advanced** | Quick-search shortcut, workspace scope, deletion behaviour |

### Granular Data Deletion

Aetherium lets you selectively and permanently delete user records without having to delete entire workspaces:
1. Open **Preferences → Data Controls** (or **Preferences → Workspaces → Granular Data Deletion**).
2. Choose the deletion scope: the active workspace, selected workspaces, or all workspaces.
3. Select specific data categories to delete (Chats & Messages, Notes & Templates, Sources & Documents, Flashcards & Goals, Concepts & Links, Memories, Thought Queue & Alarms).
4. Optionally specify a retention/time cutoff (e.g., all time, or older than 7, 30, 90, or 365 days).
5. Click **Delete Selected Data…** to inspect the live preview of affected items and cascading database records.
6. For safety, deletions of 50 or more items require typing `delete` to confirm.

### Changing the theme

1. Open **Preferences → App**.
2. Select a theme from the grid (Dark, Light, Midnight, Solarized, etc.).
3. Click an accent colour swatch to change the highlight colour.

### Setting up Ollama

1. Install Ollama from [ollama.com](https://ollama.com) and run `ollama serve`.
2. Pull a model: `ollama pull llama3.2` (or any 7B+ model).
3. In **Preferences → AI**, confirm the Ollama URL is `http://localhost:11434`.

---

## Keyboard Shortcuts

### Global

| Shortcut | Action |
|---|---|
| `Ctrl/Cmd + Shift + K` | Open Quick Search |
| `Ctrl/Cmd + Shift + P` | Open Command Palette |
| `Ctrl/Cmd + Shift + ,` | Open Preferences |
| `Ctrl/Cmd + =` | Increase font size |
| `Ctrl/Cmd + -` | Decrease font size |
| `Ctrl/Cmd + 0` | Reset font size |
| `Ctrl/Cmd + Scroll` | Zoom in / out |
| `F12` | Open DevTools |

### Navigation

| Shortcut | Action |
|---|---|
| `Alt + ←` / `Cmd + ←` | Navigate back |
| `Alt + →` / `Cmd + →` | Navigate forward |
| `Cmd + [` | Navigate back (macOS) |
| `Cmd + ]` | Navigate forward (macOS) |

### Chat

| Shortcut | Action |
|---|---|
| `Enter` | Send message |
| `Shift + Enter` | New line in composer (multiline mode) |
| `Escape` | Cancel rename / close flyout |

### Session sidebar

| Action | How |
|---|---|
| Rename session | Double-click title, type, `Enter` |
| Cancel rename | `Escape` |
| Multi-select sessions | `Shift + click` or `Ctrl/Cmd + click` |
| Drag session to folder | Drag & drop |

---

## Troubleshooting

### AI features not responding

1. Verify Ollama is running: open a terminal and run `curl http://localhost:11434/api/tags`.
2. Check that a model is pulled: `ollama list`. You need at least one 7B+ parameter model for chat and RAG.
3. In **Preferences → AI**, confirm the Ollama URL matches (default `http://localhost:11434`).

### Chat list appears empty after switching workspace

The active project filter may be set to a project that was deleted. Open the project dropdown in the Chat sidebar and select **All** or a valid project.

### Font size is stuck at a large value

Press `Ctrl/Cmd + 0` to reset to the default (16 px), or go to **Preferences → App → Font size**.

### DevTools

Press `F12` to open the browser DevTools console. IPC errors from Tauri commands appear here as strings. Rust panics appear in the terminal running `npm run tauri dev`.

### Backup and restore

Go to **Preferences → Backup** to export a full `.aetherium-backup` JSON file. To restore, import the file from the same screen.

