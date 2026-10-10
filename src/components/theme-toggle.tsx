"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  isDarkTheme,
  nextThemePreference,
  parseThemePreference,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "@/lib/theme";

const CHANGE_EVENT = "themepreferencechange";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function readPreference(): ThemePreference {
  try {
    return parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange); // other tabs
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

const LABELS: Record<ThemePreference, { icon: string; text: string }> = {
  system: { icon: "◐", text: "System theme" },
  light: { icon: "☀", text: "Light theme" },
  dark: { icon: "☾", text: "Dark theme" },
};

/** Cycles system → light → dark. The server renders "system"; the stored choice applies after. */
export function ThemeToggle() {
  const preference = useSyncExternalStore(subscribe, readPreference, () => "system" as const);

  useEffect(() => {
    const media = matchMedia(DARK_QUERY);
    const apply = () =>
      document.documentElement.classList.toggle("dark", isDarkTheme(preference, media.matches));
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [preference]);

  const next = nextThemePreference(preference);
  const label = LABELS[preference];
  return (
    <button
      type="button"
      onClick={() => {
        try {
          if (next === "system") localStorage.removeItem(THEME_STORAGE_KEY);
          else localStorage.setItem(THEME_STORAGE_KEY, next);
        } catch {
          // Storage unavailable (private mode): keep following the system theme.
        }
        window.dispatchEvent(new Event(CHANGE_EVENT));
      }}
      title={`${label.text} (switch to ${LABELS[next].text.toLowerCase()})`}
      aria-label={`${label.text}. Switch to ${LABELS[next].text.toLowerCase()}`}
      className="text-muted-foreground hover:text-foreground hover:bg-secondary size-8 rounded-md text-base"
    >
      <span aria-hidden>{label.icon}</span>
    </button>
  );
}
