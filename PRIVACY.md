# WuPage Privacy Policy

Effective date: October 28, 2026

WuPage is a Firefox, Microsoft Edge and Chromium-compatible browser extension that translates webpage text, selected text, recognized image text and PDF text using a translation provider selected and configured by the user.

## Data WuPage Processes

WuPage processes the following data only to provide its translation functionality:

- **Website content:** When the user requests a page or paragraph translation, WuPage reads the relevant text from the current webpage. Online providers receive that text for translation. With the experimental Firefox local provider selected, text is processed on the device using Bergamot; it is not sent to an online translation service. This content can include text the user is viewing on the page.
- **PDF documents:** Opening a PDF in the WuPage workspace by selecting or dropping a file, entering a document URL, or using the PDF translation entry point automatically starts translation of the configured reading range using the provider selected at the top of the workspace. Text is extracted locally; scrolling can translate additional nearby pages. Clicking "Download translation" translates the remaining pages before generating the exported PDF, reusing completed translations and edits for the same language and provider. With an online provider selected, text requiring translation is sent directly to that provider along with any configured authentication information. With Firefox local translation selected, that text is processed on the device. The PDF file and page images are not uploaded to the translation provider. Opening an online document first requests the PDF from its original host; selecting or dropping a local file does not upload the file to that host or to WuPage.
- **Selection translation:** Selecting text only displays an entry point. After the user clicks, a single alphabetic word of up to 100 characters is sent directly to the selected Youdao or Bing dictionary; pronunciation audio is requested only after another click. Dictionary requests omit cookies and saved translation API credentials. If the dictionary has no meanings, or the selection is not a single word, the selected text is processed by the currently configured translation provider using the saved language and cache preferences. Selections are limited to 5,000 characters. With Firefox local translation selected, these translation tasks stay on the device and do not fall back to another online translation provider; single-word dictionary queries still use the selected online dictionary. Selection requests do not include the rest of the webpage or its URL. Dictionary results and audio are not saved to the translation cache; translated results follow the normal translation cache setting. Selection translation can be disabled in settings.
- **Image content:** Image translation is off by default and requires an explicit OCR model installation. When the user clicks an image's translate button, WuPage reads that image (which may require a request to its original host using browser credentials), resizes it if necessary, and recognizes its text locally. Only recognized text is translated by the selected local or online translation provider. Image pixels and the image host's cookies are not forwarded to that provider. Translations are drawn as an overlay; the original image is not modified.
- **Optional OCR models:** Clicking the wrench downloads approximately 20.5 MB of model data from PaddleOCR's official model host (`paddle-model-ecology.bj.bcebos.com`), without cookies or provider credentials. Files are verified and stored in the browser's extension Cache Storage. The host receives a normal download request, including the network IP address, but no page content. Clicking the trash icon deletes these models and disables image translation. Clearing translation results does not remove models. Executable OCR libraries are bundled with the extension; only model data is downloaded.
- **Optional local translation models:** Only an explicit download action requests language model data from Mozilla's official CDN (`firefox-settings-attachments.cdn.mozilla.net`), without cookies or provider credentials. Each direction uses approximately 35–55 MB. The host receives normal download metadata, including the network IP address, but no page text. Verified files and partial download checkpoints are kept in extension Cache Storage for resuming and offline use. Files can also be imported from the user's device and are verified locally. Source language detection uses the browser's local language detection API. Executable Bergamot libraries are bundled with the extension. Users can delete models in settings; clearing translation results does not remove them.
- **Authentication information:** If a selected translation provider requires an API key or other authorization header, WuPage stores the credential in the browser's local extension storage and sends it only to the configured provider for authentication.
- **Doubao (experimental):** When translation runs with Doubao or the user explicitly checks its connection, WuPage contacts only the fixed Doubao launch and article translation endpoints. The browser may attach its existing Doubao login cookies according to browser policy. WuPage does not read, import, export, or store those cookies or the user's account password. It stores a locally generated random device identifier; temporary session configuration and connection status remain in background memory. A connection check sends a short built-in sample rather than the current page. Page URL/title metadata and image pixels are not attached to Doubao translation requests. This provider currently operates only on Chrome / Edge and does not automatically fall back to another provider.
- **Extension settings:** Language preferences, provider configurations, automatic translation site rules, performance settings, the floating control position, and related extension preferences are stored locally in the browser. Automatic webpage translation based on site or language rules is off by default. When enabled, user-selected site rules or local page-language detection may initiate translation without another click; text is processed by the currently selected provider under the same data flow as a manual translation. Site matching and language detection happen on the device. PDF documents opened in the workspace use the automatic translation behavior described above independently of this webpage setting.
- **Translation cache:** When local caching is enabled, translated text is stored locally with a hash of the source text. Users can disable or clear the cache from the extension interface.
- **Image translation cache:** When caching is enabled, recognized text, translations, region coordinates and colors are stored locally under a hash of the image and translation settings. Original image bytes are not persisted in the cache. The same cache controls clear these entries.
- **Debug information:** When translation tasks run, WuPage can display source text, translated text, request status, and errors in its Debug window. This information is held by the extension for troubleshooting and is not sent to the WuPage developer.

The source text in a selection card can be edited. Edits remain in memory and do not alter the webpage or send requests until the user submits them with the lookup/translate button or Ctrl+Enter. Submitted edits follow the same dictionary and translation data flow described above.

WuPage does not intentionally collect names, email addresses, health information, financial information, precise location, browsing history, or user activity for analytics, advertising, profiling, or tracking.

## How Data Is Used and Shared

WuPage has no developer-operated translation proxy or analytics server. Online translation requests are sent directly from the user's browser to the translation provider that the user selects or configures. Microsoft, Google, Tencent, Yandex, Volcengine and MyMemory default to their free browser, web or public translation services. Users can explicitly select API mode and configure Azure Translator, Google Cloud Translation, Tencent TokenHub, Yandex Cloud Translate, Volcengine Machine Translation or MyMemory through RapidAPI. In API mode, user-provided API keys, access key identifiers, request signatures and optional region or folder identifiers are sent to the selected API service; RapidAPI processes MyMemory API requests. Saved API credentials are not sent in free mode, and failures do not automatically switch modes or providers. Other options include Doubao (experimental), DeepSeek, Zhipu GLM, an OpenAI-compatible service, an Anthropic-compatible service, or a custom HTTP service. MyMemory's free mode is anonymous and sends no email address; automatic source-language detection runs locally in the browser. The experimental Firefox local provider processes text on the user's device and does not automatically fall back to an online provider.

When an online provider is selected, website content is shared with that provider solely to return the translation requested by the user. Single-word dictionary lookup separately shares the explicitly selected word with Youdao or Bing to return word information and pronunciation. Words without dictionary meanings and other selected text use the currently configured local or online translation provider. Authentication information is shared only with the corresponding translation provider to authorize that request. Each online provider, including the selected dictionary and DeepSeek when selected, processes data under its own terms and privacy policy. Users should not translate sensitive content through a provider they do not trust.

WuPage does not sell user data. WuPage does not transfer user data for advertising, creditworthiness, lending, or any purpose unrelated to webpage translation.

## Storage and Retention

Settings, provider credentials, and optional translation cache entries are stored locally through the browser's extension storage. They remain until the user changes or clears them, resets the extension settings, clears extension data, or uninstalls WuPage. Debug task information is temporary and is discarded when the extension's background context is reset.

Provider responses and request metadata can be retained by the selected provider according to that provider's policies. WuPage does not control a provider's retention practices.

## Security

WuPage sends translation requests over HTTPS unless the user explicitly configures a custom HTTP provider with a different URL. API credentials are not included in WuPage source code and are not sent to the WuPage developer. Users are responsible for choosing trusted providers and securely configuring custom endpoints.

## User Controls

Users can:

- choose, configure, enable, disable, or remove translation providers;
- choose the provider, languages and reading range used for PDF translation;
- remove stored provider credentials by clearing the relevant configuration;
- disable the local translation cache or clear cached translations;
- pause local model downloads, resume them, import model files offline, or remove downloaded models;
- clear displayed translations from a webpage;
- reset extension settings; and
- remove all locally stored extension data by uninstalling WuPage.

## Changes to This Policy

This policy may be updated when WuPage's data practices or features change. Material changes will be reflected in this document and its effective date.

## Contact

For privacy questions or requests, open an issue at <https://github.com/mr-wuliu/wupage/issues>.
