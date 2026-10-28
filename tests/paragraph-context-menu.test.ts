import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, SETTINGS_KEY } from "../src/shared/defaults";
import type { ExtensionSettings } from "../src/shared/types";
import { getSettings } from "../src/shared/settings";
import { handleParagraphMenuClick, initParagraphContextMenu, PARAGRAPH_MENU_ID, RESTORE_PARAGRAPH_MENU_ID } from "../src/background/paragraph-context-menu";

vi.mock("../src/shared/settings", () => ({ getSettings: vi.fn() }));
let changed: (changes: Record<string, chrome.storage.StorageChange>, area: string) => void;
let stored: ExtensionSettings;
const info = { menuItemId: PARAGRAPH_MENU_ID, frameId: 3, editable: false };
const tab = { id: 42 } as chrome.tabs.Tab;

beforeEach(() => {
  stored = { ...structuredClone(DEFAULT_SETTINGS), contextMenuTranslationEnabled: true };
  vi.mocked(getSettings).mockImplementation(async () => stored);
  vi.stubGlobal("chrome", {
    runtime: { getURL: (path: string) => `chrome-extension://test/${path}` },
    storage: { onChanged: { addListener: (listener: typeof changed) => { changed = listener; } } },
    tabs: { sendMessage: vi.fn(async () => ({ ok: true, data: { started: true } })), create: vi.fn() },
    contextMenus: {
      update: vi.fn((_id, _properties, callback) => callback?.()),
      create: vi.fn((_properties, callback) => callback?.()), onClicked: { addListener: vi.fn() }
    }
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });

describe("paragraph context menu", () => {
  it("updates existing menu items on worker startup and follows the saved setting", async () => {
    initParagraphContextMenu();
    await vi.waitFor(() => expect(chrome.contextMenus.update).toHaveBeenCalledTimes(2));
    expect(chrome.contextMenus.create).not.toHaveBeenCalled();
    expect(chrome.contextMenus.update).toHaveBeenCalledWith(PARAGRAPH_MENU_ID,
      expect.objectContaining({ visible: true, contexts: ["page", "frame", "selection", "link"] }), expect.any(Function));
    stored.contextMenuTranslationEnabled = false;
    changed({ [SETTINGS_KEY]: { newValue: stored } }, "local");
    await vi.waitFor(() => expect(chrome.contextMenus.update).toHaveBeenCalledTimes(4));
    expect(chrome.contextMenus.update).toHaveBeenLastCalledWith(RESTORE_PARAGRAPH_MENU_ID,
      expect.objectContaining({ visible: false }), expect.any(Function));
  });

  it("routes translation and restoration to the right-clicked frame", async () => {
    await handleParagraphMenuClick(info, tab);
    expect(chrome.tabs.sendMessage).toHaveBeenLastCalledWith(42,
      { type: "TRANSLATE_CONTEXT_PARAGRAPH", action: "translate" }, { frameId: 3 });
    await handleParagraphMenuClick({ ...info, menuItemId: RESTORE_PARAGRAPH_MENU_ID }, tab);
    expect(chrome.tabs.sendMessage).toHaveBeenLastCalledWith(42,
      { type: "TRANSLATE_CONTEXT_PARAGRAPH", action: "restore" }, { frameId: 3 });
  });

  it("ignores disabled and unrelated actions", async () => {
    await handleParagraphMenuClick({ ...info, menuItemId: "other" }, tab);
    expect(getSettings).not.toHaveBeenCalled();
    stored.contextMenuTranslationEnabled = false;
    await handleParagraphMenuClick(info, tab);
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it("explains that a stale page needs refreshing", async () => {
    vi.mocked(chrome.tabs.sendMessage).mockRejectedValueOnce(new Error("No receiver"));
    await handleParagraphMenuClick(info, tab);
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: "chrome-extension://test/options.html?paragraphTranslationNotice=refresh" });
  });
});
