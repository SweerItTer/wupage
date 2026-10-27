import type { ExtensionSettings, RuntimeRequest, RuntimeResponse } from "../shared/types";
import { hasPageTranslations } from "./dom";
import {
  getFloatingBallEnabled,
  getParagraphMode,
  initFloatingBall,
  openDebugPanel,
  setFloatingBallEnabled,
  setParagraphMode
} from "./floating";
import { addRuntimeMessageListener } from "./runtime";
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
initFloatingBall();
initImageTranslation();

chrome.storage.onChanged.addListener((changes, area) => {
  const change = changes[SETTINGS_KEY];
  if (area !== "local" || !change) return;
  const settings = change.newValue as ExtensionSettings | undefined;
  if (settings) updatePageTranslationSettings(settings);
});

async function handleMessage(request: RuntimeRequest): Promise<unknown> {
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
