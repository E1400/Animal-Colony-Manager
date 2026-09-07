"use client";

import { useSyncExternalStore } from "react";

type Theme = "light" | "dark" | "system";
const KEY = "colony.theme";

/**
 * Light, dark, or whatever the device says.
 *
 * "System" is a real third option rather than an absence — a vivarium is dim
 * and a phone on auto will flip to dark mid-shift, which some people want and
 * others find disorienting.
 *
 * The choice lives in localStorage and is exposed as an external store so
 * React can subscribe without a state-setting effect. Every access is guarded
 * because Safari private mode throws on localStorage.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(KEY)});if(t==="dark"||t==="light"){document.documentElement.dataset.theme=t}}catch(e){}})()`;

const listeners = new Set<() => void>();
let cache: Theme | null = null;

function read(): Theme {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === "dark" || stored === "light" ? stored : "system";
  } catch {
    return "system";
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): Theme {
  if (cache === null) cache = read();
  return cache;
}

/**
 * The server has no idea what this device chose. Returning "system" keeps the
 * first client render identical to the markup it hydrates; React then swaps in
 * the real value. The inline script above has already applied the colours, so
 * the label catching up a moment later is invisible.
 */
function getServerSnapshot(): Theme {
  return "system";
}

function choose(next: Theme) {
  cache = next;
  const root = document.documentElement;
  if (next === "system") delete root.dataset.theme;
  else root.dataset.theme = next;

  try {
    if (next === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {
    // The choice still holds for this page view.
  }
  for (const listener of listeners) listener();
}

const ORDER: Theme[] = ["light", "dark", "system"];
const LABEL: Record<Theme, string> = { light: "Light", dark: "Dark", system: "Auto" };

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return (
    <button
      type="button"
      onClick={() => choose(ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length])}
      aria-label={`Theme: ${LABEL[theme]}. Change.`}
      title={`Theme: ${LABEL[theme]}`}
      className="flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-muted hover:text-foreground"
    >
      {LABEL[theme]}
    </button>
  );
}
