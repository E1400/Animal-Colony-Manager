"use client";

import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";
const KEY = "colony.theme";

/**
 * Light or dark, nothing else.
 *
 * The device preference still decides what you get on a first visit — the
 * script below reads it — but once someone has pressed the button their choice
 * sticks. Offering "auto" as a third position asks people to reason about a
 * state they cannot see the effect of.
 *
 * Every localStorage access is guarded because Safari private mode throws.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(KEY)});if(t!=="dark"&&t!=="light"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.dataset.theme=t}catch(e){}})()`;

const listeners = new Set<() => void>();
let cache: Theme | null = null;

function read(): Theme {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === "dark" || stored === "light") return stored;
    const attr = document.documentElement.dataset.theme;
    if (attr === "dark" || attr === "light") return attr;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
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

/** The server cannot know the device preference; the icon corrects itself. */
function getServerSnapshot(): Theme {
  return "light";
}

function choose(next: Theme) {
  cache = next;
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // The choice still holds for this page view.
  }
  for (const listener of listeners) listener();
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const next = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={() => choose(next)}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      // Square and icon-only: the written label was as wide as the control
      // itself and crowded the account name beside it. Still 44px, so it stays
      // a real tap target.
      className="flex size-11 items-center justify-center rounded-lg border border-border text-muted transition-colors hover:border-accent hover:text-foreground"
    >
      {theme === "dark" ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}
