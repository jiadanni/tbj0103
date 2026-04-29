# Back/Forward Navigation Implementation Guide

## Overview
Implemented browser-like back/forward navigation in the Aetherium Tauri app, allowing users to navigate the app history using keyboard shortcuts, trackpad gestures, and UI buttons.

## Features Implemented

### 1. Keyboard Shortcuts
- **Escape**: Go back one step in history
- **Alt+Left Arrow** (or **Cmd+Left** on macOS): Go back
- **Alt+Right Arrow** (or **Cmd+Right** on macOS): Go forward
- Shortcuts are disabled when there's no history to navigate
- Shortcuts are ignored when focused in text inputs

### 2. Trackpad/Touch Gestures
- **Swipe Right**: Go back one step
- **Swipe Left**: Go forward one step
- 80px swipe threshold to prevent accidental triggers
- Only works with touch and stylus input (not mouse)
- Smart direction detection (horizontal movement > vertical)

### 3. UI Navigation Buttons
- Back/Forward chevron buttons in titlebar
- Buttons show disabled state when history is not available
- Visual feedback on hover
- Tooltips showing available keyboard shortcuts

## Architecture

### Core Files

#### 1. `tauri/src/hooks/useNavigationHistory.ts`
**Purpose**: Manages the application navigation history stack

**Key Components**:
- `useNavigationHistory()` hook
- Global navigation stack (max 50 entries)
- Tracking of path, search params, and location state
- Functions: `goBack()`, `goForward()`
- State flags: `canGoBack`, `canGoForward`

**Design Decisions**:
- Global history (not per-component) to work correctly with split-pane layouts
- Uses `replace: true` in navigate calls to avoid duplicate stack entries
- Automatic history entry truncation when navigating forward after going back

#### 2. `tauri/src/hooks/useNavigationHotkeys.ts`
**Purpose**: Handles keyboard shortcuts and gesture input

**Key Components**:
- `useNavigationHotkeys(options)` hook
- Two independent effects: one for keyboard, one for gestures
- Pointer Events API for cross-platform gesture support

**Implementation Details**:
```typescript
interface NavigationHotkeysOptions {
  onBack?: () => void;
  onForward?: () => void;
  canGoBack?: boolean;
  canGoForward?: boolean;
}
```

#### 3. `tauri/src/App.tsx` - NavigationManager Component
**Purpose**: Orchestrates navigation history tracking at the app level

**Responsibilities**:
- Creates navigation history context
- Wires up hotkey handlers
- Sits inside BrowserRouter to receive all navigation events

#### 4. `tauri/src/components/Layout.tsx` - BackForwardNavigation Component
**Purpose**: Renders back/forward UI buttons

**Features**:
- Two buttons (back/forward) with chevron icons
- Disabled state based on `canGoBack`/`canGoForward`
- Keyboard shortcuts displayed in tooltips
- Integrated with `useNavigationHistory` hook

## How It Works

### Navigation Flow
1. User navigates to `/chat`, `/notes`, `/graph`, etc. via any means
2. `useNavigationHistory` tracks the location change
3. Current page is added to navigation stack if different from previous
4. Buttons show enabled/disabled based on history stack position

### Back Navigation Flow
1. User presses Escape or clicks back button
2. `goBack()` is called
3. History index moves backward
4. `navigate(prevEntry.path)` is called with `replace: true`
5. `useNavigationHistory` detects the navigation but skips adding duplicate
6. UI updates to show new disabled state of buttons

### Gesture Detection Flow
1. Pointer down event → record starting position (x, y)
2. Pointer move events → track delta from start
3. If horizontal movement > 80px and > vertical movement → mark as swipe
4. Pointer up event → calculate final delta and trigger back/forward
5. Reset state for next gesture

## Integration Points

### In App.tsx
```typescript
<BrowserRouter>
  <NavigationManager />  // Added here
  <MenuEventHandler />
  ...
</BrowserRouter>
```

### In Layout.tsx Titlebar
```typescript
<div data-workspace-titlebar-actions>
  <BackForwardNavigation />  // Added before History button
  <TitlebarSortMenu />
  <TitlebarHistoryMenu />
  ...
</div>
```

## Design Decisions & Rationale

### Global History (Not Per-Component)
- **Why**: Split-pane mode requires shared history across both panes
- **Alternative Considered**: Per-pane history (rejected - confusing UX)

### Escape Key for Back
- **Why**: Common browser convention, intuitive for users
- **Limitation**: Disabled in text inputs to avoid breaking form input

### Pointer Events for Gestures
- **Why**: Cross-platform support (macOS, Linux, Windows)
- **Why Not Mouse**: Mouse swipes are unreliable and conflict with scrolling

### 80px Swipe Threshold
- **Why**: Prevents accidental navigation while scrolling
- **Calibration**: Typical trackpad scroll momentum is < 60px

### Replace Navigation
- **Why**: Prevents creating new history stack entries from back navigation
- **Implementation**: Flag-based approach to avoid re-tracking back/forward moves

## Testing Considerations

### Manual Testing Checklist
- [ ] Escape key goes back on /project, /chat, /notes, etc.
- [ ] Back button becomes disabled when at start of history
- [ ] Forward button becomes disabled when at end of history
- [ ] Swipe right on trackpad goes back
- [ ] Swipe left on trackpad goes forward
- [ ] Escape doesn't trigger when typing in search boxes
- [ ] Alt+Left/Right works on non-macOS systems
- [ ] Cmd+Left/Right works on macOS
- [ ] History persists across split-pane navigation
- [ ] Forward history clears when navigating after back

### Edge Cases Covered
- Multiple rapid back/forward clicks (handled by history bounds checking)
- Navigation while buttons are disabled (prevented by disabled state)
- Escape in text inputs (explicitly excluded)
- Replace navigation not creating duplicates (flag-based tracking)
- Split-pane simultaneous navigation (global history shared)

## Performance Implications
- Memory: 50 max entries × ~100 bytes per entry = ~5KB
- CPU: Minimal - only fires on keyboard/pointer events
- No polling or background work

## Future Enhancements
- [ ] Browser-style dropdown menu from back button showing history list
- [ ] Visual animation for navigation transitions
- [ ] Customizable swipe sensitivity in preferences
- [ ] Mouse back/forward button support
- [ ] Persistent history across app restarts (currently session-only)

## Browser Compatibility
- Chrome/Edge: Full support (Pointer Events)
- Safari: Full support (Pointer Events)
- Firefox: Full support (Pointer Events)
- Mobile: Swipe gestures on touch screens

## Accessibility
- Keyboard shortcuts documented in titles
- Disabled state clearly indicated
- ARIA labels on buttons
- Keyboard navigation independent of mouse/touch
