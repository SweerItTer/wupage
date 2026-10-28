import { SETTINGS_KEY } from "../shared/defaults";
import type { ExtensionSettings } from "../shared/types";
import { findTranslatableParagraph } from "./dom";
import { translateParagraph } from "./paragraph-translation";
import { sendRuntimeRequest } from "./runtime";

const EXCLUDED = "input,textarea,select,button,[contenteditable]:not([contenteditable='false']),[role='textbox'],[role='button'],img,video,audio,canvas,svg,#wupage-selection-tools,#wupage-floating-hitbox,#wupage-floating-menu,#wupage-debug-panel,#wupage-image-tools,#wupage-paragraph-notice";

export function initParagraphContextTranslation(onChange: () => void = () => {}): (action: "translate" | "restore") => Promise<{ started: boolean }> {
  let enabled = false;
  let revision = 0;
  let target: Element | null = null;
  let point = { x: 12, y: 12 };
  const setSettings = (settings: ExtensionSettings) => {
    enabled = settings.contextMenuTranslationEnabled === true;
    document.documentElement.classList.toggle("wupage-context-translation", enabled);
    if (!enabled) target = null;
  };
  chrome.storage.onChanged.addListener((changes, area) => {
    const settings = changes[SETTINGS_KEY]?.newValue as ExtensionSettings | undefined;
    if (area === "local" && settings) { revision++; setSettings(settings); }
  });
  const initialRevision = revision;
  void sendRuntimeRequest<ExtensionSettings>({ type: "GET_SETTINGS" }).then(settings => {
    if (revision === initialRevision) setSettings(settings);
  }).catch(() => undefined);
  document.addEventListener("contextmenu", event => {
    target = null;
    document.getElementById("wupage-paragraph-notice")?.remove();
    if (!enabled) return;
    const element = event.composedPath().find(node => node instanceof Element) as Element | undefined;
    if (!element || event.composedPath().some(node => node instanceof Element && node.matches(EXCLUDED)) || element.closest(EXCLUDED)) return;
    const output = element.closest(".wupage-translation");
    const targetId = output?.getAttribute("data-wupage-translation-target");
    target = targetId
      ? [...document.querySelectorAll("[data-wupage-target-id]")].find(node => node.getAttribute("data-wupage-target-id") === targetId) ?? null
      : findTranslatableParagraph(output?.parentElement ?? element);
    point = { x: event.clientX, y: event.clientY };
  }, true);
  return async action => {
    const captured = target;
    const anchor = { ...point };
    try {
      const settings = await sendRuntimeRequest<ExtensionSettings>({ type: "GET_SETTINGS" });
      if (!settings.contextMenuTranslationEnabled) return { started: false };
      if (!captured?.isConnected) throw new Error("此处没有可翻译的段落，请在正文段落上重新右键。");
      await translateParagraph(captured, action);
      return { started: true };
    } catch (error) {
      showNotice(error instanceof Error ? error.message : String(error), anchor);
      return { started: false };
    } finally {
      onChange();
    }
  };
}

function showNotice(message: string, point: { x: number; y: number }): void {
  document.getElementById("wupage-paragraph-notice")?.remove();
  const notice = document.createElement("div");
  notice.id = "wupage-paragraph-notice";
  notice.setAttribute("role", "status");
  notice.textContent = message;
  notice.style.cssText = `all:initial!important;position:fixed!important;z-index:2147483647!important;box-sizing:border-box!important;max-width:calc(100vw - 24px)!important;width:max-content!important;padding:10px 12px!important;border:1px solid var(--wp-border,#c9d1cf)!important;border-radius:8px!important;background:var(--wp-surface,#fff)!important;color:var(--wp-foreground,#172026)!important;font:13px/1.6 system-ui,sans-serif!important;box-shadow:0 4px 16px #0002!important;overflow-wrap:anywhere!important;`;
  document.documentElement.append(notice);
  const rect = notice.getBoundingClientRect();
  notice.style.setProperty("left", `${Math.max(12, Math.min(point.x, innerWidth - rect.width - 12))}px`, "important");
  notice.style.setProperty("top", `${Math.max(12, Math.min(point.y + 12, innerHeight - rect.height - 12))}px`, "important");
  window.setTimeout(() => notice.remove(), 5000);
}
