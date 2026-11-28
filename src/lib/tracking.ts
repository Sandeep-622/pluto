import { useCallback, useEffect, useRef } from "react";
import { apiUrl } from "./api";
import type { TrackRequest, UiEventName } from "./contract";

const sessionKey = "pluto-session-v1";
const idleMs = 30 * 60_000; // A visit that has been quiet this long counts as a new session.
const activeWindowMs = 60_000; // Time only counts while the tab is visible and the user did something in the last minute.
const tickMs = 5_000;
const heartbeatMs = 60_000;

type StoredSession = { id: string; active: number; lastInteraction: number };

function readStored(now: number): StoredSession | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(sessionKey) ?? "null");
    if (typeof value !== "object" || !value) return null;
    const { id, active, lastInteraction } = value as Partial<StoredSession>;
    if (typeof id !== "string" || typeof active !== "number" || typeof lastInteraction !== "number") return null;
    return now - lastInteraction < idleMs ? { id, active, lastInteraction } : null;
  } catch { return null; }
}

function deviceClass(): "mobile" | "tablet" | "desktop" {
  const width = window.innerWidth;
  return width < 768 ? "mobile" : width < 1100 ? "tablet" : "desktop";
}

/** Fire-and-forget. Tracking failures must never surface to the reader. */
export function sendTrack(token: string, event: TrackRequest, keepalive = false): void {
  try {
    void fetch(apiUrl("track"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(event),
      keepalive
    }).catch(() => undefined);
  } catch { /* API address not configured. */ }
}

/**
 * Starts one analytics session per visit while signed in, accumulates active time and
 * sends a heartbeat every minute plus a final one when the tab is hidden or closed.
 */
export function useSessionTracking(token: string | undefined) {
  const tokenRef = useRef<string | undefined>(undefined);
  const idRef = useRef<string | null>(null);
  const activeRef = useRef(0);

  useEffect(() => {
    tokenRef.current = token;
    if (!token) { idRef.current = null; return; }
    const begin = Date.now();
    const stored = readStored(begin);
    const state: StoredSession = stored ?? { id: crypto.randomUUID(), active: 0, lastInteraction: begin };
    idRef.current = state.id;
    activeRef.current = state.active;
    let lastInteraction = begin;
    const persist = () => {
      try { sessionStorage.setItem(sessionKey, JSON.stringify({ id: state.id, active: activeRef.current, lastInteraction })); } catch { /* ignore */ }
    };
    const beat = (keepalive = false) => sendTrack(token, { type: "session_heartbeat", sessionId: state.id, activeSeconds: Math.round(activeRef.current) }, keepalive);

    if (stored) beat();
    else sendTrack(token, { type: "session_start", sessionId: state.id, device: deviceClass(), locale: navigator.language?.slice(0, 20), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone?.slice(0, 64) });
    persist();

    const interact = () => { lastInteraction = Date.now(); };
    const onHidden = () => { if (document.visibilityState === "hidden") { persist(); beat(true); } };
    const onPageHide = () => { persist(); beat(true); };
    const interactions = ["pointerdown", "pointermove", "keydown", "scroll", "touchstart"] as const;
    interactions.forEach((name) => window.addEventListener(name, interact, { passive: true, capture: true }));
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
    const tick = window.setInterval(() => {
      if (document.visibilityState === "visible" && Date.now() - lastInteraction < activeWindowMs) activeRef.current += tickMs / 1000;
      persist();
    }, tickMs);
    const heartbeat = window.setInterval(() => { if (document.visibilityState === "visible") beat(); }, heartbeatMs);
    return () => {
      interactions.forEach((name) => window.removeEventListener(name, interact, { capture: true }));
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
      window.clearInterval(tick);
      window.clearInterval(heartbeat);
    };
  }, [token]);

  const sessionId = useCallback(() => idRef.current ?? undefined, []);

  const track = useCallback((name: UiEventName, detail?: string, includeWeb?: boolean) => {
    if (tokenRef.current && idRef.current) sendTrack(tokenRef.current, { type: "ui", sessionId: idRef.current, name, detail: detail?.slice(0, 60), includeWeb });
  }, []);

  /** Closes the session explicitly on sign-out; the stored id is dropped so the next sign-in starts fresh. */
  const endSession = useCallback(() => {
    if (tokenRef.current && idRef.current) sendTrack(tokenRef.current, { type: "session_end", sessionId: idRef.current, activeSeconds: Math.round(activeRef.current) }, true);
    try { sessionStorage.removeItem(sessionKey); } catch { /* ignore */ }
    idRef.current = null;
  }, []);

  return { sessionId, track, endSession };
}
