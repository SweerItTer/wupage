import { BUILT_IN_PROVIDER_IDS, DEFAULT_SETTINGS } from "../shared/defaults";
import { SOURCE_LANGUAGES, TARGET_LANGUAGES } from "../shared/languages";
import { TRANSLATION_DISPLAY_MODES } from "../shared/display-modes";
import { sendRuntimeMessage } from "../shared/messaging";
import type { DoubaoStatus, ExtensionSettings, ProviderConfig } from "../shared/types";
import "./styles.css";
import { setImageTranslationToggle, setupOcrControl } from "../shared/ocr-control";
import { setupLocalModelControl } from "../local/control";
import { isDoubaoBrowserSupported } from "../shared/doubao";
import { formatDoubaoStatus, isDoubaoProviderUnavailable, readSourceLanguage, syncDoubaoLanguageControls } from "../shared/doubao-ui";

const targetLang = query<HTMLSelectElement>("#targetLang");
const sourceLang = query<HTMLSelectElement>("#sourceLang");
const chunkSize = query<HTMLInputElement>("#chunkSize");
const concurrency = query<HTMLInputElement>("#concurrency");
const pdfTranslationScope = query<HTMLSelectElement>("#pdfTranslationScope");
const pdfTranslationPageRadius = query<HTMLInputElement>("#pdfTranslationPageRadius");
const pdfTranslationPageRadiusField = query<HTMLElement>("#pdfTranslationPageRadiusField");
const pdfTranslationScopeDescription = query<HTMLElement>("#pdfTranslationScopeDescription");
const cacheEnabled = query<HTMLInputElement>("#cacheEnabled");
const floatingBallEnabled = query<HTMLInputElement>("#floatingBallEnabled");
const imageTranslationEnabled = query<HTMLInputElement>("#imageTranslationEnabled");
const translateCodeComments = query<HTMLInputElement>("#translateCodeComments");
const translationDisplayMode = query<HTMLSelectElement>("#translationDisplayMode");
const translationDisplayModeDescription = query<HTMLSpanElement>("#translationDisplayModeDescription");
const providerPicker = query<HTMLDivElement>("#providerPicker");
const providerTrigger = query<HTMLButtonElement>("#providerTrigger");
const providerTriggerLabel = query<HTMLSpanElement>("#providerTriggerLabel");
const providerMenu = query<HTMLDivElement>("#providerMenu");
const addProviderButton = query<HTMLButtonElement>("#addProvider");
const providerForm = query<HTMLDivElement>("#providerForm");
const providerDialog = query<HTMLDialogElement>("#providerDialog");
const providerDialogForm = query<HTMLFormElement>("#providerDialogForm");
const cancelProviderButton = query<HTMLButtonElement>("#cancelProvider");
const customProviderName = query<HTMLInputElement>("#customProviderName");
const customProviderKind = query<HTMLSelectElement>("#customProviderKind");
const customLlmFormatField = query<HTMLLabelElement>("#customLlmFormatField");
const customLlmFormat = query<HTMLSelectElement>("#customLlmFormat");
const saveButton = query<HTMLButtonElement>("#save");
const testButton = query<HTMLButtonElement>("#test");
const restoreButton = query<HTMLButtonElement>("#restore");
const status = query<HTMLParagraphElement>("#status");

const LLM_MODEL_OPTIONS = [
  "gpt-4o-mini",
  "glm-4-flash-250414",
  "glm-4.7-flash",
  "glm-4-flashx-250414"
];
const ZHIPU_MODEL_OPTIONS = [
  "glm-4-flash-250414",
  "glm-4.7-flash",
  "glm-4-flashx-250414"
];
const DEEPSEEK_MODEL_OPTIONS = [
  "deepseek-flash",
  "deepseek-v4-pro"
];
const DEFAULT_LLM_PROMPT =
  "You are a translation engine. Translate each input item into {{targetLang}}. Preserve meaning, numbers, links, code-like tokens, placeholders like ⟪WUPAGE0⟫, and formatting. Return only a JSON array of strings in the same order.";

let settings: ExtensionSettings;
let disposeLocalControl: (() => void) | undefined;
let providerFormVersion = 0;
let doubaoStatus: DoubaoStatus = { state: "unknown" };
let doubaoCheck: Promise<void> | undefined;
let doubaoStatusRevision = 0;
let doubaoRetryTimer: ReturnType<typeof setTimeout> | undefined;
let optionsClosed = false;

window.addEventListener("pagehide", () => {
  optionsClosed = true;
  clearTimeout(doubaoRetryTimer);
}, { once: true });

void init().catch((error: unknown) => {
  setStatus(error instanceof Error ? error.message : String(error));
});

async function init(): Promise<void> {
  settings = await sendRuntimeMessage<ExtensionSettings>({ type: "GET_SETTINGS" });
  render();
  setupOcrControl(imageTranslationEnabled, () => { settings.imageTranslationEnabled = false; setImageTranslationToggle(imageTranslationEnabled, false); });
  const imageNotice = new URLSearchParams(location.search).get("imageTranslationNotice");
  if (imageNotice === "setup") setStatus("使用右键图片翻译前，请先点击扳手安装 OCR 模型，开启图片翻译并保存。");
  if (imageNotice === "refresh") setStatus("无法连接图片所在页面。请刷新刚才的网页，再右键点击图片翻译；部分嵌入页面暂不支持。");
  if (imageNotice) imageTranslationEnabled.closest(".image-feature")?.scrollIntoView?.({ block: "center" });

  providerTrigger.addEventListener("click", () => setProviderMenuOpen(providerMenu.hidden));
  providerMenu.addEventListener("click", (event) => {
    const button = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>("button[data-action]")
      : null;
    if (!button) return;
    void handleProviderAction(button.dataset.action ?? "", button.dataset.providerId ?? "");
  });
  addProviderButton.addEventListener("click", openProviderDialog);
  cancelProviderButton.addEventListener("click", () => providerDialog.close());
  customProviderKind.addEventListener("change", updateCustomProviderFields);
  providerDialogForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void addCustomProvider();
  });
  document.addEventListener("click", (event) => {
    if (event.target instanceof Node && !providerPicker.contains(event.target)) {
      setProviderMenuOpen(false);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setProviderMenuOpen(false);
  });
  saveButton.addEventListener("click", () => void save());
  testButton.addEventListener("click", testProvider);
  restoreButton.addEventListener("click", restoreDefaults);
  pdfTranslationScope.addEventListener("change", updatePdfTranslationScope);
  sourceLang.addEventListener("change", updateLocalControl);
  targetLang.addEventListener("change", updateLocalControl);
}

function render(): void {
  renderLanguageOptions(targetLang, settings.targetLang, TARGET_LANGUAGES);
  renderLanguageOptions(sourceLang, settings.sourceLang, SOURCE_LANGUAGES);
  chunkSize.value = String(settings.chunkSize);
  concurrency.value = String(settings.concurrency);
  pdfTranslationScope.value = settings.pdfTranslationPageRadius === null ? "unlimited" : "nearby";
  pdfTranslationPageRadius.value = String(settings.pdfTranslationPageRadius ?? DEFAULT_SETTINGS.pdfTranslationPageRadius);
  updatePdfTranslationScope();
  cacheEnabled.checked = settings.cacheEnabled;
  floatingBallEnabled.checked = settings.floatingBallEnabled;
  setImageTranslationToggle(imageTranslationEnabled, settings.imageTranslationEnabled === true);
  translateCodeComments.checked = settings.translateCodeComments;
  translationDisplayMode.innerHTML = TRANSLATION_DISPLAY_MODES
    .map((mode) => `<option value="${mode.value}">${mode.label}</option>`)
    .join("");
  translationDisplayMode.value = settings.translationDisplayMode;
  updateTranslationDisplayModeDescription();
  renderProviderPicker(false);
  renderProviderForm();
}

translationDisplayMode.addEventListener("change", updateTranslationDisplayModeDescription);

function updatePdfTranslationScope(): void {
  pdfTranslationPageRadiusField.hidden = pdfTranslationScope.value === "unlimited";
  pdfTranslationPageRadius.disabled = pdfTranslationPageRadiusField.hidden;
  pdfTranslationScopeDescription.textContent = pdfTranslationPageRadiusField.hidden
    ? "翻译整份 PDF，直到全部完成。已完成的同语言、同服务译文会保留。"
    : "开始翻译后，默认处理当前页及前后各 5 页，最多 11 页。滚动后自动补译新范围，范围内完成后等待继续阅读。0 表示仅翻译当前页。";
}

function updateTranslationDisplayModeDescription(): void {
  translationDisplayModeDescription.textContent = TRANSLATION_DISPLAY_MODES.find(
    (mode) => mode.value === translationDisplayMode.value
  )?.description ?? "";
}

function renderLanguageOptions(
  select: HTMLSelectElement,
  value: string,
  languages: ReadonlyArray<{ code: string; label: string }>
): void {
  const options = languages.some((entry) => entry.code === value)
    ? languages
    : [{ code: value, label: value }, ...languages];
  select.innerHTML = options
    .map((entry) => `<option value="${escapeHtml(entry.code)}">${escapeHtml(entry.label)}</option>`)
    .join("");
  select.value = value;
}

function renderProviderPicker(keepOpen: boolean): void {
  const activeProvider = getActiveProvider();
  providerTriggerLabel.textContent = activeProvider.label;
  providerMenu.innerHTML = settings.providers.map(renderProviderMenuRow).join("");
  setProviderMenuOpen(keepOpen);
}

function renderProviderMenuRow(provider: ProviderConfig): string {
  const enabled = provider.enabled !== false;
  const unavailable = isDoubaoProviderUnavailable(provider);
  const builtIn = BUILT_IN_PROVIDER_IDS.has(provider.id);
  return `
    <div class="provider-menu-row" data-built-in="${builtIn}" role="group">
      <button
        class="provider-option"
        type="button"
        role="option"
        data-action="select"
        data-provider-id="${escapeAttr(provider.id)}"
        aria-selected="${provider.id === settings.activeProviderId}"
        ${enabled && !unavailable ? "" : "disabled"}
        ${unavailable ? 'title="此浏览器暂不支持豆包网页登录翻译"' : ""}
      >
        <span class="provider-option-label">${escapeHtml(provider.label)}</span>
      </button>
      <button
        class="provider-enable"
        type="button"
        data-action="toggle"
        data-provider-id="${escapeAttr(provider.id)}"
        aria-pressed="${enabled}"
        title="${enabled ? "停用" : "启用"} ${escapeAttr(provider.label)}"
        aria-label="${enabled ? "停用" : "启用"} ${escapeAttr(provider.label)}"
      ></button>
      ${builtIn ? "" : `
        <button
          class="provider-delete"
          type="button"
          data-action="delete"
          data-provider-id="${escapeAttr(provider.id)}"
          title="删除 ${escapeAttr(provider.label)}"
          aria-label="删除 ${escapeAttr(provider.label)}"
        >-</button>
      `}
    </div>
  `;
}

function renderProviderForm(): void {
  const version = ++providerFormVersion;
  clearTimeout(doubaoRetryTimer);
  disposeLocalControl?.(); disposeLocalControl = undefined;
  const provider = getActiveProvider();
  syncDoubaoLanguageControls(settings, sourceLang, targetLang);
  testButton.textContent = provider.type === "doubao-web" ? "重新检测豆包" : "测试服务";
  testButton.disabled = false;
  if (provider.type === "doubao-web") {
    providerForm.innerHTML = `
      <div class="grid"><label>显示名称 <input data-field="label" type="text" value="${escapeAttr(provider.label)}" /></label></div>
      <div class="doubao-setup">
        <h3>豆包网页登录翻译 · 实验功能</h3>
        <p>无需 API key。在当前浏览器打开豆包并完成登录后，即可直接翻译。扩展会自动准备连接；“重新检测”用于检查连接，不是每次翻译的必需步骤。</p>
        <p>豆包自动识别源语言。翻译时，待译文本会发送到豆包；检测只发送固定短文本。请求会按顺序串行执行，暂不保证所有浏览器和账号可用。</p>
        <div class="doubao-actions">
          <button type="button" data-action="open-doubao">打开豆包并登录</button>
          <button type="button" data-action="check-doubao">重新检测</button>
        </div>
        <p data-role="doubao-status" role="status" aria-live="polite"></p>
        <p class="hint">如提示登录失效，请重新登录后重试翻译，或点击重新检测；如遇限流，请等待。登录状态由浏览器管理，无需复制 Cookie。</p>
        <p class="hint">实现思路与协议研究参考 <a href="https://github.com/Haleclipse" target="_blank" rel="noopener noreferrer">Haleclipse</a> 的 CometixTranslate，来源：<a href="https://linux.do/t/topic/2910452" target="_blank" rel="noopener noreferrer">Linux.do 原帖</a>。</p>
      </div>`;
    providerForm.querySelector<HTMLButtonElement>("[data-action='open-doubao']")?.addEventListener("click", () => {
      void chrome.tabs.create({ url: "https://www.doubao.com/" }).catch((error: unknown) => setStatus(error instanceof Error ? error.message : String(error)));
    });
    providerForm.querySelector<HTMLButtonElement>("[data-action='check-doubao']")?.addEventListener("click", () => void checkDoubao());
    if (!isDoubaoBrowserSupported()) doubaoStatus = { state: "unsupported-browser" };
    renderDoubaoStatus();
    if (isDoubaoBrowserSupported() && !doubaoCheck) {
      const revision = doubaoStatusRevision;
      void sendRuntimeMessage<DoubaoStatus>({ type: "GET_DOUBAO_STATUS" }).then((result) => {
        if (version !== providerFormVersion || revision !== doubaoStatusRevision || !result) return;
        doubaoStatus = result;
        renderDoubaoStatus();
      }).catch(() => { /* Keep the actionable initial state if the background is restarting. */ });
    }
    return;
  }
  if (provider.type === "firefox-local") {
    providerForm.innerHTML = `<div class="grid"><label>显示名称 <input data-field="label" type="text" value="${escapeAttr(provider.label)}" /></label></div><div data-local-model-control></div>`;
    updateLocalControl();
    return;
  }
  if (provider.type === "google-web-translate") {
    setProviderFormMarkup(provider, `
      <div class="grid">
        <label>显示名称 <input data-field="label" type="text" value="${escapeAttr(provider.label)}" /></label>
      </div>
      <p class="hint">该服务使用非官方网页翻译接口，不需要 API key，但可能被限流或被厂商调整。</p>
    `);
    return;
  }

  if (provider.type === "microsoft-translator") {
    setProviderFormMarkup(provider, `
      <div class="grid">
        <label>显示名称 <input data-field="label" type="text" value="${escapeAttr(provider.label)}" /></label>
        <label>Endpoint <input data-field="endpoint" type="url" value="${escapeAttr(provider.endpoint)}" /></label>
        <label>API key <input data-field="apiKey" type="password" value="${escapeAttr(provider.apiKey)}" /></label>
        <label>区域 <input data-field="region" type="text" value="${escapeAttr(provider.region)}" placeholder="global 或 Azure 区域" /></label>
      </div>
    `);
    return;
  }

  if (provider.type === "google-cloud-translation") {
    setProviderFormMarkup(provider, `
      <div class="grid">
        <label>显示名称 <input data-field="label" type="text" value="${escapeAttr(provider.label)}" /></label>
        <label>API key <input data-field="apiKey" type="password" value="${escapeAttr(provider.apiKey)}" /></label>
      </div>
    `);
    return;
  }

  if (provider.type === "openai-compatible" || provider.type === "anthropic-compatible") {
    const isAnthropic = provider.type === "anthropic-compatible";
    setProviderFormMarkup(provider, `
      <div class="grid">
        <label>显示名称 <input data-field="label" type="text" value="${escapeAttr(provider.label)}" /></label>
        <label>Base URL <input data-field="baseURL" type="url" value="${escapeAttr(provider.baseURL)}" /></label>
        <label>API key（可选） <input data-field="apiKey" type="password" value="${escapeAttr(provider.apiKey)}" /></label>
        <label>模型
          <input data-field="model" type="text" ${isAnthropic ? "" : "list=\"wupage-model-options\""} value="${escapeAttr(provider.model)}" />
          ${isAnthropic ? "" : `
            <datalist id="wupage-model-options">
              ${LLM_MODEL_OPTIONS.map((model) => `<option value="${escapeAttr(model)}"></option>`).join("")}
            </datalist>
          `}
        </label>
      </div>
      <label>系统提示词 <textarea data-field="systemPrompt">${escapeHtml(provider.systemPrompt)}</textarea></label>
      ${isAnthropic ? "" : `
        <label>Ollama 兼容
          <select data-field="ollamaCompatibility">
            <option value="enabled" ${provider.type === "openai-compatible" && provider.ollamaCompatibility !== false ? "selected" : ""}>开启（默认）</option>
            <option value="disabled" ${provider.type === "openai-compatible" && provider.ollamaCompatibility === false ? "selected" : ""}>关闭</option>
          </select>
        </label>
        <p class="hint">默认开启，支持 IPv4、IPv6、自定义端口和完整 Chat Completions 地址。</p>
      `}
      <p class="hint">接口格式：${isAnthropic ? "Anthropic Messages" : "OpenAI Chat Completions"}。</p>
    `);
    return;
  }

  if (provider.type === "deepseek") {
    setProviderFormMarkup(provider, `
      <div class="grid">
        <label>显示名称 <input data-field="label" type="text" value="${escapeAttr(provider.label)}" /></label>
        <label>Base URL <input data-field="baseURL" type="url" value="${escapeAttr(provider.baseURL)}" /></label>
        <label>API key <input data-field="apiKey" type="password" value="${escapeAttr(provider.apiKey)}" /></label>
        <label>模型
          <select data-field="model">${renderOptions(DEEPSEEK_MODEL_OPTIONS, provider.model)}</select>
        </label>
      </div>
      <label>系统提示词 <textarea data-field="systemPrompt">${escapeHtml(provider.systemPrompt)}</textarea></label>
      <p class="hint">使用 DeepSeek Chat Completions，默认关闭思考模式以降低翻译延迟。API 地址默认使用 https://api.deepseek.com。</p>
    `);
    return;
  }

  if (provider.type === "zhipu-glm") {
    setProviderFormMarkup(provider, `
      <div class="grid">
        <label>显示名称 <input data-field="label" type="text" value="${escapeAttr(provider.label)}" /></label>
        <label>Base URL <input data-field="baseURL" type="url" value="${escapeAttr(provider.baseURL)}" /></label>
        <label>API key <input data-field="apiKey" type="password" value="${escapeAttr(provider.apiKey)}" /></label>
        <label>模型
          <select data-field="model">${renderOptions(ZHIPU_MODEL_OPTIONS, provider.model)}</select>
        </label>
      </div>
      <label>系统提示词 <textarea data-field="systemPrompt">${escapeHtml(provider.systemPrompt)}</textarea></label>
      <p class="hint">使用智谱 GLM Chat Completions。API 地址默认使用 https://open.bigmodel.cn/api/paas/v4。</p>
    `);
    return;
  }

  setProviderFormMarkup(provider, `
    <div class="grid">
      <label>显示名称 <input data-field="label" type="text" value="${escapeAttr(provider.label)}" /></label>
      <label>请求方法
        <select data-field="method">
          <option value="POST" ${provider.method === "POST" ? "selected" : ""}>POST</option>
          <option value="GET" ${provider.method === "GET" ? "selected" : ""}>GET</option>
        </select>
      </label>
      <label>URL <input data-field="url" type="url" value="${escapeAttr(provider.url)}" /></label>
      <label>响应路径 <input data-field="responsePath" type="text" value="${escapeAttr(provider.responsePath)}" /></label>
    </div>
    <label>请求头 JSON <textarea data-field="headers">${escapeHtml(JSON.stringify(provider.headers, null, 2))}</textarea></label>
    <label>请求体模板 <textarea data-field="bodyTemplate">${escapeHtml(provider.bodyTemplate)}</textarea></label>
  `);
}

function renderDoubaoStatus(): void {
  if (optionsClosed || getActiveProvider().type !== "doubao-web") return;
  const statusElement = providerForm.querySelector<HTMLElement>("[data-role='doubao-status']");
  const checkButton = providerForm.querySelector<HTMLButtonElement>("[data-action='check-doubao']");
  const retryIn = Math.max(0, (doubaoStatus.retryAt ?? 0) - Date.now());
  if (statusElement) {
    statusElement.textContent = formatDoubaoStatus(doubaoStatus);
    statusElement.dataset.state = doubaoStatus.state;
  }
  const disabled = Boolean(doubaoCheck) || doubaoStatus.state === "checking" || !isDoubaoBrowserSupported() || retryIn > 0;
  if (checkButton) checkButton.disabled = disabled;
  testButton.disabled = disabled;
  clearTimeout(doubaoRetryTimer);
  if (retryIn > 0) doubaoRetryTimer = setTimeout(renderDoubaoStatus, Math.min(retryIn + 10, 1000));
  else if (doubaoStatus.state === "checking" && !doubaoCheck) {
    const version = providerFormVersion;
    const revision = doubaoStatusRevision;
    doubaoRetryTimer = setTimeout(() => {
      void sendRuntimeMessage<DoubaoStatus>({ type: "GET_DOUBAO_STATUS" }).then((result) => {
        if (version !== providerFormVersion || revision !== doubaoStatusRevision || !result) return;
        doubaoStatus = result;
        renderDoubaoStatus();
      }).catch(() => {
        if (version !== providerFormVersion || revision !== doubaoStatusRevision) return;
        doubaoStatus = { state: "network-error" };
        renderDoubaoStatus();
      });
    }, 1000);
  }
}

function checkDoubao(): Promise<void> {
  if (doubaoCheck) return doubaoCheck;
  if (!isDoubaoBrowserSupported()) {
    doubaoStatus = { state: "unsupported-browser" };
    renderDoubaoStatus();
    return Promise.resolve();
  }
  if ((doubaoStatus.retryAt ?? 0) > Date.now()) return Promise.resolve();
  doubaoStatusRevision += 1;
  doubaoStatus = { state: "checking" };
  doubaoCheck = sendRuntimeMessage<DoubaoStatus>({ type: "CHECK_DOUBAO" })
    .then((result) => { doubaoStatus = result; })
    .catch(() => { doubaoStatus = { state: "network-error", checkedAt: Date.now() }; })
    .finally(() => {
      doubaoCheck = undefined;
      renderDoubaoStatus();
    });
  renderDoubaoStatus();
  return doubaoCheck;
}

function updateLocalControl(): void {
  const container = providerForm.querySelector<HTMLElement>("[data-local-model-control]");
  if (!container) return;
  disposeLocalControl?.();
  disposeLocalControl = setupLocalModelControl(container, sourceLang.value, targetLang.value);
}

function setProviderFormMarkup(provider: ProviderConfig, markup: string): void {
  providerForm.innerHTML = `${markup}${renderProviderPerformance(provider)}`;
  const inherit = providerForm.querySelector<HTMLInputElement>("[data-field='inheritPerformance']");
  inherit?.addEventListener("change", updateProviderPerformanceFields);
  updateProviderPerformanceFields();
}

function renderProviderPerformance(provider: ProviderConfig): string {
  const inherited = provider.performanceMode !== "custom";
  return `
    <fieldset class="provider-performance">
      <legend>性能设置</legend>
      <label class="setting-toggle performance-inherit">
        <span>继承通用性能设置</span>
        <input data-field="inheritPerformance" type="checkbox" role="switch" ${inherited ? "checked" : ""} />
        <span class="setting-toggle-control" aria-hidden="true"></span>
      </label>
      <div class="grid performance-overrides" data-role="performanceOverrides" ${inherited ? "hidden" : ""}>
        <label>分块大小
          <input data-field="chunkSize" type="number" min="200" max="4000" value="${provider.chunkSize ?? settings.chunkSize}" />
        </label>
        <label>服务商并发数
          <input data-field="concurrency" type="number" min="1" max="${settings.concurrency}" value="${provider.concurrency ?? settings.concurrency}" />
        </label>
      </div>
      <p class="hint">服务商并发数不会超过通用设置中的全局最大并发数。</p>
    </fieldset>
  `;
}

function updateProviderPerformanceFields(): void {
  const inherit = providerForm.querySelector<HTMLInputElement>("[data-field='inheritPerformance']");
  const overrides = providerForm.querySelector<HTMLElement>("[data-role='performanceOverrides']");
  if (!inherit || !overrides) return;
  overrides.hidden = inherit.checked;
  overrides.querySelectorAll<HTMLInputElement>("input").forEach((input) => {
    input.disabled = inherit.checked;
  });
}

async function handleProviderAction(action: string, providerId: string): Promise<void> {
  try {
    if (action === "select") await selectProvider(providerId);
    if (action === "toggle") await toggleProvider(providerId);
    if (action === "delete") await deleteProvider(providerId);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
}

async function selectProvider(providerId: string): Promise<void> {
  const provider = settings.providers.find((entry) => entry.id === providerId);
  if (!provider || provider.enabled === false || isDoubaoProviderUnavailable(provider)) return;
  settings = readSettingsFromForm();
  settings.activeProviderId = providerId;
  await persistSettings(false);
  renderProviderPicker(false);
  renderProviderForm();
  setStatus("已切换当前服务。");
}

async function toggleProvider(providerId: string): Promise<void> {
  settings = readSettingsFromForm();
  const provider = settings.providers.find((entry) => entry.id === providerId);
  if (!provider) return;
  const nextEnabled = provider.enabled === false;
  if (!nextEnabled) {
    const hasOtherEnabled = settings.providers.some(
      (entry) => entry.id !== providerId && entry.enabled !== false
    );
    if (!hasOtherEnabled) {
      setStatus("至少需要启用一个翻译服务。");
      return;
    }
  }
  settings.providers = settings.providers.map((entry) =>
    entry.id === providerId ? { ...entry, enabled: nextEnabled } : entry
  );
  if (!nextEnabled && settings.activeProviderId === providerId) {
    settings.activeProviderId = settings.providers.find((entry) => entry.enabled !== false)!.id;
  }
  await persistSettings(false);
  renderProviderPicker(true);
  renderProviderForm();
  setStatus(nextEnabled ? "已启用服务。" : "已停用服务。");
}

async function deleteProvider(providerId: string): Promise<void> {
  if (BUILT_IN_PROVIDER_IDS.has(providerId)) return;
  const provider = settings.providers.find((entry) => entry.id === providerId);
  if (!provider || !window.confirm(`删除“${provider.label}”？`)) return;
  settings = readSettingsFromForm();
  settings.providers = settings.providers.filter((entry) => entry.id !== providerId);
  if (settings.activeProviderId === providerId) {
    settings.activeProviderId = settings.providers.find((entry) => entry.enabled !== false)?.id
      ?? DEFAULT_SETTINGS.activeProviderId;
  }
  await persistSettings(false);
  renderProviderPicker(true);
  renderProviderForm();
  setStatus("已删除自定义服务。");
}

function openProviderDialog(): void {
  setProviderMenuOpen(false);
  customProviderName.value = "";
  customProviderKind.value = "http";
  customLlmFormat.value = "openai";
  updateCustomProviderFields();
  providerDialog.showModal();
  window.setTimeout(() => customProviderName.focus(), 0);
}

function updateCustomProviderFields(): void {
  customLlmFormatField.hidden = customProviderKind.value !== "llm";
}

async function addCustomProvider(): Promise<void> {
  try {
    settings = readSettingsFromForm();
    const provider = createCustomProvider(
      customProviderName.value.trim(),
      customProviderKind.value,
      customLlmFormat.value
    );
    settings.providers = [...settings.providers, provider];
    settings.activeProviderId = provider.id;
    await persistSettings(false);
    providerDialog.close();
    render();
    setStatus("已添加自定义服务，请完成配置后保存。");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
}

function createCustomProvider(name: string, kind: string, llmFormat: string): ProviderConfig {
  const id = createCustomProviderId(kind === "llm" ? llmFormat : kind);
  if (kind === "http") {
    return {
      type: "http-template",
      id,
      label: name || "自定义 HTTP",
      enabled: true,
      performanceMode: "inherit",
      method: "POST",
      url: "",
      headers: { "Content-Type": "application/json" },
      bodyTemplate: "{\"q\":{{json texts}},\"source\":\"{{sourceLang}}\",\"target\":\"{{targetLang}}\"}",
      responsePath: "translations"
    };
  }
  if (llmFormat === "anthropic") {
    return {
      type: "anthropic-compatible",
      id,
      label: name || "自定义 Anthropic LLM",
      enabled: true,
      performanceMode: "custom",
      chunkSize: 3200,
      concurrency: settings.concurrency,
      baseURL: "https://api.anthropic.com/v1",
      apiKey: "",
      model: "claude-3-5-haiku-latest",
      systemPrompt: DEFAULT_LLM_PROMPT
    };
  }
  return {
    type: "openai-compatible",
    id,
    label: name || "自定义 OpenAI LLM",
    enabled: true,
    performanceMode: "custom",
    chunkSize: 3200,
    concurrency: settings.concurrency,
    baseURL: "https://api.openai.com/v1",
    ollamaCompatibility: true,
    apiKey: "",
    model: "gpt-4o-mini",
    systemPrompt: DEFAULT_LLM_PROMPT
  };
}

function createCustomProviderId(kind: string): string {
  return `custom-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function save(showSavedStatus = true): Promise<void> {
  try {
    settings = readSettingsFromForm();
    await persistSettings(false);
    render();
    if (showSavedStatus) setStatus("已保存。");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
    throw error;
  }
}

async function persistSettings(showSavedStatus: boolean): Promise<void> {
  await sendRuntimeMessage({ type: "SAVE_SETTINGS", settings });
  settings = await sendRuntimeMessage<ExtensionSettings>({ type: "GET_SETTINGS" });
  if (showSavedStatus) setStatus("已保存。");
}

async function testProvider(): Promise<void> {
  if (getActiveProvider().type === "doubao-web") {
    await checkDoubao();
    return;
  }
  try {
    setStatus("测试中...");
    settings = readSettingsFromForm();
    await persistSettings(false);
    const result = await sendRuntimeMessage<{ translation: string }>({
      type: "TEST_PROVIDER",
      providerId: settings.activeProviderId
    });
    setStatus(`测试通过：${result.translation}`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
}

async function restoreDefaults(): Promise<void> {
  try {
    settings = cloneSettings(DEFAULT_SETTINGS);
    await persistSettings(false);
    render();
    setStatus("已恢复默认设置。");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
}

function readSettingsFromForm(): ExtensionSettings {
  const activeProvider = {
    ...readProviderFromForm(getActiveProvider()),
    ...(getActiveProvider().type === "firefox-local" ? { performanceMode: "custom", chunkSize: 800, concurrency: 1 }
      : getActiveProvider().type === "doubao-web" ? { performanceMode: "custom", chunkSize: 1200, concurrency: 1 }
        : readProviderPerformance())
  } as ProviderConfig;
  return {
    ...settings,
    targetLang: targetLang.value.trim() || "zh-CN",
    sourceLang: readSourceLanguage(sourceLang, settings),
    activeProviderId: settings.activeProviderId,
    chunkSize: Number(chunkSize.value),
    concurrency: Number(concurrency.value),
    pdfTranslationPageRadius: pdfTranslationScope.value === "unlimited" ? null
      : pdfTranslationPageRadius.value === "" ? DEFAULT_SETTINGS.pdfTranslationPageRadius : Number(pdfTranslationPageRadius.value),
    cacheEnabled: cacheEnabled.checked,
    floatingBallEnabled: floatingBallEnabled.checked,
    imageTranslationEnabled: imageTranslationEnabled.checked,
    translateCodeComments: translateCodeComments.checked,
    translationDisplayMode: translationDisplayMode.value as ExtensionSettings["translationDisplayMode"],
    providers: settings.providers.map((provider) =>
      provider.id === activeProvider.id ? activeProvider : provider
    )
  };
}

function readProviderPerformance(): Pick<
  ProviderConfig,
  "performanceMode" | "chunkSize" | "concurrency"
> {
  const inherit = providerForm.querySelector<HTMLInputElement>("[data-field='inheritPerformance']");
  if (!inherit || inherit.checked) {
    return {
      performanceMode: "inherit",
      chunkSize: undefined,
      concurrency: undefined
    };
  }
  const providerChunkSize = providerForm.querySelector<HTMLInputElement>("[data-field='chunkSize']");
  const providerConcurrency = providerForm.querySelector<HTMLInputElement>("[data-field='concurrency']");
  return {
    performanceMode: "custom",
    chunkSize: Number(providerChunkSize?.value),
    concurrency: Number(providerConcurrency?.value)
  };
}

function readProviderFromForm(provider: ProviderConfig): ProviderConfig {
  const field = (name: string) =>
    providerForm.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      `[data-field="${name}"]`
    )?.value ?? "";

  if (provider.type === "google-web-translate" || provider.type === "firefox-local" || provider.type === "doubao-web") {
    return { ...provider, label: field("label").trim() || provider.label };
  }
  if (provider.type === "microsoft-translator") {
    return {
      ...provider,
      label: field("label").trim() || provider.label,
      endpoint: field("endpoint").trim() || "https://api.cognitive.microsofttranslator.com",
      apiKey: field("apiKey"),
      region: field("region").trim()
    };
  }
  if (provider.type === "google-cloud-translation") {
    return {
      ...provider,
      label: field("label").trim() || provider.label,
      apiKey: field("apiKey")
    };
  }
  if (provider.type === "openai-compatible" || provider.type === "anthropic-compatible") {
    return {
      ...provider,
      label: field("label").trim() || provider.label,
      baseURL: field("baseURL").trim(),
      apiKey: field("apiKey"),
      model: field("model").trim(),
      systemPrompt: field("systemPrompt"),
      ...(provider.type === "openai-compatible" ? {
        ollamaCompatibility: field("ollamaCompatibility") === "enabled"
      } : {})
    };
  }
  if (provider.type === "deepseek") {
    return {
      ...provider,
      label: field("label").trim() || provider.label,
      baseURL: field("baseURL").trim() || "https://api.deepseek.com",
      apiKey: field("apiKey"),
      model: field("model").trim() || "deepseek-flash",
      systemPrompt: field("systemPrompt")
    };
  }
  if (provider.type === "zhipu-glm") {
    return {
      ...provider,
      label: field("label").trim() || provider.label,
      baseURL: field("baseURL").trim() || "https://open.bigmodel.cn/api/paas/v4",
      apiKey: field("apiKey"),
      model: field("model").trim() || "glm-4-flash-250414",
      systemPrompt: field("systemPrompt")
    };
  }
  return {
    ...provider,
    label: field("label").trim() || provider.label,
    method: field("method") === "GET" ? "GET" : "POST",
    url: field("url").trim(),
    responsePath: field("responsePath").trim(),
    headers: parseHeaders(field("headers")),
    bodyTemplate: field("bodyTemplate")
  };
}

function parseHeaders(value: string): Record<string, string> {
  const parsed = JSON.parse(value || "{}") as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("请求头必须是 JSON 对象。");
  }
  if (!Object.values(parsed).every((entry) => typeof entry === "string")) {
    throw new Error("请求头的值必须是字符串。");
  }
  return parsed as Record<string, string>;
}

function getActiveProvider(): ProviderConfig {
  const provider = settings.providers.find((entry) => entry.id === settings.activeProviderId);
  if (!provider) throw new Error("找不到当前翻译服务。");
  return provider;
}

function setProviderMenuOpen(open: boolean): void {
  providerMenu.hidden = !open;
  providerTrigger.setAttribute("aria-expanded", String(open));
}

function setStatus(value: string): void {
  status.textContent = value;
}

function query<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };
    return entities[char];
  });
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}

function renderOptions(values: string[], selected: string): string {
  const options = values.includes(selected) ? values : [selected, ...values];
  return options
    .map((value) =>
      `<option value="${escapeAttr(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(value)}</option>`
    )
    .join("");
}

function cloneSettings(value: ExtensionSettings): ExtensionSettings {
  return JSON.parse(JSON.stringify(value)) as ExtensionSettings;
}
