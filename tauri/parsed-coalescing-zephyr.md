# Linux Client-Side Decorations (CSD)

## Context
The app uses native OS decorations on Linux while macOS has a custom overlay titlebar. This adds CSD on Linux — removing the native titlebar and rendering custom window control buttons (minimize, maximize, close) in the WorkspaceTabBar.

## Changes

### 1. Create `src-tauri/tauri.linux.conf.json`
Disable native decorations on Linux:
```json
{ "app": { "windows": [{ "decorations": false }] } }
```

### 2. Add window permissions — `src-tauri/capabilities/default.json`
Add permissions for window control APIs:
- `core:window:allow-minimize`
- `core:window:allow-toggle-maximize`
- `core:window:allow-close`

### 3. Add `isLinux` to `src/lib/platform.ts`
Export `isLinux` detection alongside existing `isMac`.

### 4. Create `src/components/WindowControls.tsx`
Linux-only component with minimize/maximize/close buttons using `@tauri-apps/api/window`. Styled to match the app theme, positioned at the right end of the titlebar.

### 5. Update `src/components/Layout.tsx` — WorkspaceTabBar
- Import and render `<WindowControls />` on the right side of the tab bar when on Linux
- Already has `data-tauri-drag-region` so dragging works

### 6. Update `src/App.tsx` and `src/views/AuthenticationView.tsx`
Add `<WindowControls />` to the loading/auth drag regions so window can be controlled before Layout mounts.

## Files to modify
- `src-tauri/tauri.linux.conf.json` (new)
- `src-tauri/capabilities/default.json`
- `src/lib/platform.ts`
- `src/components/WindowControls.tsx` (new)
- `src/components/Layout.tsx`
- `src/App.tsx`
- `src/views/AuthenticationView.tsx`

## Verification
- `npm run tauri dev` on Linux — native titlebar should be gone
- Custom close/minimize/maximize buttons visible in top-right of workspace tab bar
- Window dragging still works via the tab bar
- Buttons function correctly (close, minimize, maximize/restore)
- macOS behavior unchanged (overlay titlebar, no custom buttons)
