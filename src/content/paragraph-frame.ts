import { setupAppearance } from "../shared/appearance-runtime";
import { SETTINGS_KEY } from "../shared/defaults";
import type { ExtensionSettings } from "../shared/types";
import { refreshTranslationColors } from "./dom";
import { initParagraphContextTranslation } from "./paragraph-context";
import { addRuntimeMessageListener, sendRuntimeRequest } from "./runtime";
import { injectContentStyles } from "./styles";
import { setPageTranslationDisplayMode } from "./page-translation";

// Embedded documents get paragraph translation without additional floating UI.
if (window !== window.top) {
  const translate = initParagraphContextTranslation();
  injectContentStyles();
  const appearance = setupAppearance(undefined, { extensionPage: false, onChange: scheme => {
    refreshTranslationColors({ light: scheme.colors["translation-light"], dark: scheme.colors["translation-dark"] });
  } });
  let appearanceRevision = 0;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[SETTINGS_KEY]) return;
    appearanceRevision++;
    const mode = (changes[SETTINGS_KEY].newValue as ExtensionSettings | undefined)?.translationDisplayMode;
    if (mode === "replace" || mode === "bilingual" || mode === "bilingual-accent") setPageTranslationDisplayMode(mode);
  });
  void sendRuntimeRequest<ExtensionSettings>({ type: "GET_SETTINGS" }).then(settings => {
    if (!appearanceRevision) appearance.update(settings.appearance);
  }).catch(() => undefined);
  addRuntimeMessageListener((request, _sender, respond) => {
    if (request.type !== "TRANSLATE_CONTEXT_PARAGRAPH") return;
    void translate(request.action).then(data => respond({ ok: true, data }))
      .catch(error => respond({ ok: false, error: String(error) }));
    return true;
  });
}
