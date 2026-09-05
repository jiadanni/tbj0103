import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "../lib/api";
import AuthenticationView from "../views/AuthenticationView";

/** Secondary windows share the backend lock, never a renderer-local unlock. */
export default function WindowAuthGate({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const listenerReady = useRef(false);
  const refresh = useCallback(async () => {
    if (!listenerReady.current) { return; }
    const current = ++generation.current;
    try {
      const status = await api.boot.checkState();
      if (current !== generation.current) { return; }
      if (status.unlock_required) {
        setUnlocked(false);
        setError("Unlock the database in the main window first.");
        return;
      }
      const authenticated = await api.security.isUnlocked();
      if (current !== generation.current) { return; }
      setUnlocked(authenticated);
      setError("");
    } catch (err) {
      if (current !== generation.current) { return; }
      setUnlocked(false);
      setError(`Unable to check authentication: ${String(err)}`);
    } finally {
      if (current === generation.current) { setChecking(false); }
    }
  }, []);

  useEffect(() => {
    const invalidate = () => { ++generation.current; };
    let disposed = false;
    let unlisten: (() => void) | undefined;
    listenerReady.current = false;
    setChecking(true);
    void listen("app-locked", () => {
      invalidate();
      setUnlocked(false);
      setChecking(false);
    }).then((dispose) => {
      if (disposed) { dispose(); return; }
      unlisten = dispose;
      listenerReady.current = true;
      void refresh();
    }).catch((err: unknown) => {
      if (disposed) { return; }
      invalidate();
      setUnlocked(false);
      setChecking(false);
      setError(`Unable to monitor the app lock: ${String(err)}`);
    });
    window.addEventListener("focus", refresh);
    return () => {
      disposed = true;
      listenerReady.current = false;
      invalidate();
      window.removeEventListener("focus", refresh);
      unlisten?.();
    };
  }, [refresh, retry]);

  if (checking) { return <div role="status">Checking authentication...</div>; }
  if (error) {
    return <div role="alert">{error} <button onClick={() => setRetry((value) => value + 1)}>Retry</button></div>;
  }
  if (!unlocked) { return <AuthenticationView onAuthenticated={refresh} />; }
  return children;
}
