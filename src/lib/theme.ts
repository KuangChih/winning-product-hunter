/** Theme preference: follow the OS, or force light / dark. */
export type ThemePreference = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "theme";
export const THEME_PREFERENCES: ThemePreference[] = ["system", "light", "dark"];

export function parseThemePreference(value: string | null | undefined): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

export function isDarkTheme(preference: ThemePreference, systemPrefersDark: boolean): boolean {
  return preference === "dark" || (preference === "system" && systemPrefersDark);
}

/** The preference after this one, for a single cycling toggle button. */
export function nextThemePreference(current: ThemePreference): ThemePreference {
  return THEME_PREFERENCES[(THEME_PREFERENCES.indexOf(current) + 1) % THEME_PREFERENCES.length];
}

/**
 * Runs in <head> before the page paints, so a dark preference never flashes light first.
 * Kept tiny and dependency-free; storage can throw in private mode, which means "system".
 */
export const THEME_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem("${THEME_STORAGE_KEY}")}catch(e){}var d=p==="dark"||(p!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)})()`;
