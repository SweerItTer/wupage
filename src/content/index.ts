import type { ExtensionSettings, RuntimeRequest, RuntimeResponse } from "../shared/types";
import { hasPageTranslations, refreshTranslationColors } from "./dom";
import {
  getFloatingBallEnabled,
  getParagraphMode,
  initFloatingBall,
  openDebugPanel,
  refreshTranslationState,
  setFloatingBallEnabled,
  setParagraphMode
} from "./floating";
import { addRuntimeMessageListener, sendRuntimeRequest } from "./runtime";
import {
  getPageTranslationState,
  hidePageTranslation,
  loadPageTranslationSettings,
  startPageTranslation,
  updatePageTranslationSettings
} from "./page-translation";
import { injectContentStyles } from "./styles";
import { initImageTranslation, translateContextImage } from "./image-translation";
import { SETTINGS_KEY } from "../shared/defaults";
import { initAutoTranslation } from "./auto-translation";
import { initSelectionTranslation } from "./selection-translation";
import { setupAppearance } from "../shared/appearance-runtime";
import { initParagraphContextTranslation } from "./paragraph-context";
import { executeTranslationShortcut } from "./shortcuts";
import { initKeyboardShortcuts } from "./keyboard-shortcuts";

const translateContextParagraph = initParagraphContextTranslation(refreshTranslationState);

let pageActionVersion = 0;

addRuntimeMessageListener((request: RuntimeRequest, _sender, sendResponse) => {
  handleMessage(request)
    .then((data): RuntimeResponse => ({ ok: true, data }))
    .catch((error: unknown): RuntimeResponse => ({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }))
    .then(sendResponse);

  return true;
});

injectContentStyles();
const appearance = setupAppearance(undefined, { extensionPage: false, onChange: scheme => {
  refreshTranslationColors({ light: scheme.colors["translation-light"], dark: scheme.colors["translation-dark"] });
} });
// Ignore an older initial read if the user saves a newer appearance while it is pending.
let appearanceRevision = 0;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[SETTINGS_KEY]) appearanceRevision++;
});
void sendRuntimeRequest<ExtensionSettings>({ type: "GET_SETTINGS" }).then(settings => {
  if (!appearanceRevision) appearance.update(settings.appearance);
}).catch(() => undefined);
initFloatingBall();
initImageTranslation();
initAutoTranslation();
initSelectionTranslation();
initKeyboardShortcuts(executeTranslationShortcut);

chrome.storage.onChanged.addListener((changes, area) => {
  const change = changes[SETTINGS_KEY];
  if (area !== "local" || !change) return;
  const settings = change.newValue as ExtensionSettings | undefined;
  if (settings) updatePageTranslationSettings(settings);
});

async function handleMessage(request: RuntimeRequest): Promise<unknown> {
  if (request.type === "EXECUTE_TRANSLATION_SHORTCUT") {
    await executeTranslationShortcut(request.command);
    return { handled: true };
  }
  if (request.type === "TRANSLATE_CONTEXT_PARAGRAPH") return translateContextParagraph(request.action);
  if (request.type === "TRANSLATE_CONTEXT_IMAGE") {
    return translateContextImage(request.srcUrl);
  }
  if (request.type === "CLEAR_TRANSLATION") {
    pageActionVersion += 1;
    hidePageTranslation();
    return { cleared: true };
  }

  if (request.type === "GET_TRANSLATION_STATE") {
    return { translated: getPageTranslationState().active || hasPageTranslations() };
  }

  if (request.type === "GET_PARAGRAPH_MODE") {
    return { enabled: getParagraphMode() };
  }

  if (request.type === "SET_PARAGRAPH_MODE") {
    await setParagraphMode(request.enabled);
    return { enabled: getParagraphMode() };
  }

  if (request.type === "GET_FLOATING_BALL") {
    return { enabled: getFloatingBallEnabled() };
  }

  if (request.type === "SET_FLOATING_BALL") {
    await setFloatingBallEnabled(request.enabled);
    return { enabled: getFloatingBallEnabled() };
  }

  if (request.type === "OPEN_TRANSLATION_DEBUG") {
    await openDebugPanel();
    return { opened: true };
  }

  if (request.type !== "TRANSLATE_PAGE") {
    return null;
  }

  const actionVersion = ++pageActionVersion;
  const settings = await loadPageTranslationSettings();
  if (actionVersion !== pageActionVersion) return getPageTranslationState();
  return startPageTranslation(settings);
}
