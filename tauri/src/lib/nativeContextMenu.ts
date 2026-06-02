const NATIVE_CONTEXT_MENU_ALLOW_SELECTOR = "[data-allow-native-context-menu]";

/**
 * Prevent the webview/browser fallback menu from leaking into the app shell.
 * Components with app-owned context menus can still handle the event normally.
 */
export function installNativeContextMenuSuppressor() {
  if (typeof window === "undefined") { return; }

  window.addEventListener("contextmenu", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(NATIVE_CONTEXT_MENU_ALLOW_SELECTOR)) { return; }

    event.preventDefault();
  }, { capture: true });
}
