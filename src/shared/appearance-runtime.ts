import { SETTINGS_KEY } from "./defaults";
import { applyColorScheme, getColorScheme, normalizeAppearance, type ColorScheme } from "./appearance";
import type { ExtensionSettings } from "./types";

/** Content scripts set only prefixed tokens; they never change the host page's color scheme. */
export function setupAppearance(value: unknown, { extensionPage = true, live = true, onChange }: {
  extensionPage?: boolean; live?: boolean; onChange?: (scheme: ColorScheme) => void;
} = {}): {
  update: (value: unknown) => void;
  dispose: () => void;
} {
  let appearance = normalizeAppearance(value);
  const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : undefined;
  function paint(): void {
    const tone = appearance.mode === "system" ? media?.matches ? "dark" : "light" : appearance.mode;
    const scheme = getColorScheme(appearance, tone);
    applyColorScheme(document.documentElement, scheme);
    document.documentElement.style.setProperty("--wp-floating-opacity", String(appearance.floatingOpacity / 100));
    if (extensionPage) document.documentElement.style.colorScheme = tone;
    onChange?.(scheme);
  }
  function update(value: unknown): void {
    const next = normalizeAppearance(value);
    if (JSON.stringify(next) === JSON.stringify(appearance)) return;
    appearance = next; paint();
  }
  const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
    if (area === "local" && changes[SETTINGS_KEY]) {
      update((changes[SETTINGS_KEY].newValue as Partial<ExtensionSettings> | undefined)?.appearance);
    }
  };
  const storage = typeof chrome !== "undefined" ? chrome.storage?.onChanged : undefined;
  media?.addEventListener("change", paint);
  if (live) storage?.addListener(changed);
  function dispose(): void {
    media?.removeEventListener("change", paint);
    if (live) storage?.removeListener?.(changed);
    window.removeEventListener("pagehide", onHide);
  }
  function onHide(event: PageTransitionEvent): void { if (!event.persisted) dispose(); }
  window.addEventListener("pagehide", onHide);
  paint();
  return { update, dispose };
}
