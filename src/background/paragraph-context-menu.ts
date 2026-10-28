import { SETTINGS_KEY } from "../shared/defaults";
import { getSettings } from "../shared/settings";
import type { ExtensionSettings, RuntimeRequest, RuntimeResponse } from "../shared/types";

export const PARAGRAPH_MENU_ID = "wupage-translate-paragraph";
export const RESTORE_PARAGRAPH_MENU_ID = "wupage-restore-paragraph";

export function initParagraphContextMenu(): void {
  // Register synchronously: service workers may restart directly for this click.
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    void handleParagraphMenuClick(info, tab).catch(error => console.warn("WuPage paragraph menu:", error));
  });
  let updates = Promise.resolve();
  const sync = (enabled: boolean) => {
    updates = updates.catch(() => undefined).then(async () => {
      for (const [id, title] of [[PARAGRAPH_MENU_ID, "使用 WuPage 翻译此段落"], [RESTORE_PARAGRAPH_MENU_ID, "恢复此段原文"]]) {
        await upsertMenu(id, { title, contexts: ["page", "frame", "selection", "link"],
          documentUrlPatterns: ["http://*/*", "https://*/*"], visible: enabled });
      }
    });
    void updates.catch(error => console.warn("WuPage paragraph menu:", error));
  };
  let revision = 0;
  chrome.storage.onChanged?.addListener((changes, area) => {
    const settings = changes[SETTINGS_KEY]?.newValue as ExtensionSettings | undefined;
    if (area === "local" && settings) { revision++; sync(settings.contextMenuTranslationEnabled === true); }
  });
  const initialRevision = revision;
  void getSettings().then(settings => {
    if (revision === initialRevision) sync(settings.contextMenuTranslationEnabled === true);
  }).catch(error => console.warn("WuPage paragraph menu:", error));
}

function upsertMenu(id: string, properties: chrome.contextMenus.CreateProperties): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.contextMenus.update(id, properties, () => {
      if (!chrome.runtime.lastError) { resolve(); return; }
      if (properties.visible === false) { resolve(); return; }
      chrome.contextMenus.create({ ...properties, id }, () => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve();
      });
    });
  });
}

export async function handleParagraphMenuClick(info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab): Promise<void> {
  if ((info.menuItemId !== PARAGRAPH_MENU_ID && info.menuItemId !== RESTORE_PARAGRAPH_MENU_ID) || tab?.id === undefined) return;
  if (!(await getSettings()).contextMenuTranslationEnabled) return;
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "TRANSLATE_CONTEXT_PARAGRAPH",
      action: info.menuItemId === RESTORE_PARAGRAPH_MENU_ID ? "restore" : "translate"
    } satisfies RuntimeRequest, { frameId: info.frameId ?? 0 }) as RuntimeResponse | undefined;
    if (!response?.ok || typeof (response.data as { started?: unknown } | undefined)?.started !== "boolean") {
      throw new Error("Page listener unavailable");
    }
  } catch {
    // Old tabs have no current content listener. Open a refresh explanation.
    await chrome.tabs.create({ url: `${chrome.runtime.getURL("options.html")}?paragraphTranslationNotice=refresh` });
  }
}
