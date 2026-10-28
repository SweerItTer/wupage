import { getSettings, saveSettings } from "../shared/settings";
import type { RuntimeRequest, RuntimeResponse } from "../shared/types";
import { createProvider } from "./providers";
import { loadImageData, translateImageWithSettings } from "./image-translation";
import { clearTranslationCache, getTranslationDebugSnapshot, translateWithSettings } from "./translation";
import { requestOcr } from "./ocr";
import { installedRevision } from "../ocr/model-store";
import { initImageContextMenu } from "./image-context-menu";
import { initParagraphContextMenu } from "./paragraph-context-menu";
import { initializeOllamaCompatibility } from "./ollama-compatibility";
import { requestLocal } from "./local";
import { lookupDictionary, playDictionaryAudio, stopDictionaryAudio } from "./dictionary";
import { normalizeSelectionTranslation } from "../shared/dictionary";
import { checkDoubao, getDoubaoStatus } from "./doubao";
import { initializeDoubaoCompatibility } from "./doubao-compatibility";
import { runtimeErrorResponse } from "../shared/errors";

chrome.runtime.onMessage.addListener((request: RuntimeRequest, sender, sendResponse) => {
  if ("target" in request) return;
  handleMessage(request, sender)
    .then((data): RuntimeResponse => ({ ok: true, data }))
    .catch(runtimeErrorResponse)
    .then(sendResponse);

  return true;
});

// Auxiliary browser integrations must not prevent settings and translation
// messages from being handled when a Chromium fork lacks one of these APIs.
try {
  initImageContextMenu();
} catch (error: unknown) {
  console.warn("WuPage image menu:", error);
}
void initializeOllamaCompatibility().catch((error: unknown) => console.warn("WuPage Ollama compatibility:", error));
void initializeDoubaoCompatibility().catch((error: unknown) => console.warn("WuPage Doubao compatibility:", error));
try {
  initParagraphContextMenu();
} catch (error: unknown) {
  console.warn("WuPage paragraph menu:", error);
}

async function handleMessage(request: RuntimeRequest, sender: chrome.runtime.MessageSender): Promise<unknown> {
  switch (request.type) {
    case "LOOKUP_DICTIONARY":
    case "PLAY_DICTIONARY_AUDIO": {
      const settings = normalizeSelectionTranslation((await getSettings()).selectionTranslation);
      if (!settings.enabled) throw new Error("请先在设置中开启划词翻译。");
      if (request.type === "LOOKUP_DICTIONARY") return lookupDictionary(request.provider, request.query);
      return playDictionaryAudio(request.provider, request.url, `${sender.tab?.id ?? "extension"}:${sender.frameId ?? 0}`);
    }
    case "STOP_DICTIONARY_AUDIO":
      return stopDictionaryAudio(`${sender.tab?.id ?? "extension"}:${sender.frameId ?? 0}`);
    case "GET_DOUBAO_STATUS":
      return getDoubaoStatus();
    case "CHECK_DOUBAO": {
      const settings = await getSettings();
      if (!settings.providers.some((entry) => entry.type === "doubao-web" && entry.enabled !== false)) {
        throw new Error("请先启用豆包翻译服务。");
      }
      return checkDoubao();
    }
    case "GET_LOCAL_MODEL_STATUS":
      return requestLocal("status");
    case "INSTALL_LOCAL_MODEL":
      return requestLocal("install", request.modelId);
    case "CANCEL_LOCAL_MODEL_DOWNLOAD":
      return requestLocal("cancel");
    case "REMOVE_LOCAL_MODEL":
      return requestLocal("remove", request.modelId);
    case "OPEN_OPTIONS_PAGE":
      await chrome.runtime.openOptionsPage();
      return null;
    case "GET_SETTINGS": {
      let settings = await getSettings();
      if (settings.imageTranslationEnabled) {
        const installed = await installedRevision();
        // Model checks may finish after another page has saved new settings.
        // Return that version and only change its image toggle when needed.
        settings = await getSettings();
        if (!installed && settings.imageTranslationEnabled) {
          settings.imageTranslationEnabled = false;
          await saveSettings(settings);
        }
      }
      return settings;
    }
    case "SAVE_SETTINGS":
      if (request.settings.imageTranslationEnabled && !await installedRevision()) throw new Error("请先点击图片翻译旁的扳手安装 OCR 模型。");
      await saveSettings(request.settings);
      return null;
    case "GET_OCR_STATUS":
      return requestOcr("status");
    case "INSTALL_OCR":
      return requestOcr("install");
    case "REMOVE_OCR": {
      const result = await requestOcr("remove");
      const settings = await getSettings();
      await saveSettings({ ...settings, imageTranslationEnabled: false });
      return result;
    }
    case "TRANSLATE_BATCH": {
      const settings = await getSettings();
      return translateWithSettings(settings, request);
    }
    case "LOAD_IMAGE": {
      const settings = await getSettings();
      if (!settings.imageTranslationEnabled) throw new Error("请先开启图片翻译。");
      return loadImageData(request.url);
    }
    case "TRANSLATE_IMAGE":
      return translateImageWithSettings(await getSettings(), request);
    case "GET_TRANSLATION_DEBUG":
      return getTranslationDebugSnapshot();
    case "CLEAR_CACHE":
      return clearTranslationCache();
    case "TEST_PROVIDER": {
      const settings = await getSettings();
      const providerConfig = settings.providers.find(
        (provider) => provider.id === (request.providerId ?? settings.activeProviderId)
      );
      if (!providerConfig) throw new Error("Provider not found.");
      // An explicit settings test can validate a service before it is enabled.
      const provider = createProvider(providerConfig);
      const validation = provider.validateConfig();
      if (!validation.ok) throw new Error(validation.message);
      const [translation] = await provider.translateBatch({
        texts: ["Hello world"],
        sourceLang: "en",
        targetLang: settings.targetLang
      });
      return { translation };
    }
    case "TRANSLATE_PAGE":
    case "EXECUTE_TRANSLATION_SHORTCUT":
    case "TRANSLATE_CONTEXT_IMAGE":
    case "TRANSLATE_CONTEXT_PARAGRAPH":
    case "CLEAR_TRANSLATION":
    case "GET_TRANSLATION_STATE":
    case "GET_PARAGRAPH_MODE":
    case "SET_PARAGRAPH_MODE":
    case "GET_FLOATING_BALL":
    case "SET_FLOATING_BALL":
    case "OPEN_TRANSLATION_DEBUG":
      throw new Error(`${request.type} must be sent to the active tab.`);
    default:
      return assertNever(request);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled message: ${JSON.stringify(value)}`);
}
