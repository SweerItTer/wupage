// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import { DEFAULT_SETTINGS, SETTINGS_KEY } from "../src/shared/defaults";
import type { ExtensionSettings, RuntimeRequest, RuntimeResponse, TranslateBatchResponse } from "../src/shared/types";

const { runtimeRequest, registerListener } = vi.hoisted(() => ({
  runtimeRequest: vi.fn(), registerListener: vi.fn()
}));
vi.mock("../src/content/runtime", () => ({
  sendRuntimeRequest: runtimeRequest, addRuntimeMessageListener: registerListener
}));
vi.mock("../src/content/image-translation", () => ({
  initImageTranslation: vi.fn(), translateContextImage: vi.fn()
}));

type BatchRequest = Extract<RuntimeRequest, { type: "TRANSLATE_BATCH" }>;
type StorageListener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => void;
const originalText = "Read this paragraph before continuing to the next article.";
const outputs: Record<string, string> = {
  ja: "次の記事に進む前に、この段落をお読みください。",
  "zh-CN": "继续阅读下一篇文章之前，请先阅读这一段。",
  fr: "Lisez ce paragraphe avant de poursuivre vers le prochain article."
};

describe("saved language changes on an active content page", () => {
  let stored: ExtensionSettings;
  let storageListeners: StorageListener[];
  let clearPageTranslation: () => void;
  let documentListeners: MockInstance<Document["addEventListener"]>;
  let windowListeners: MockInstance<Window["addEventListener"]>;
  let translate: (request: BatchRequest) => Promise<TranslateBatchResponse>;
  const detectLanguage = vi.fn<(text: string) => Promise<chrome.i18n.LanguageDetectionResult>>();

  function saveSettings(patch: Partial<ExtensionSettings>): void {
    const oldValue = structuredClone(stored);
    stored = { ...stored, ...structuredClone(patch) };
    for (const listener of storageListeners) {
      listener({ [SETTINGS_KEY]: { oldValue, newValue: structuredClone(stored) } }, "local");
    }
  }

  function requests(): BatchRequest[] {
    return runtimeRequest.mock.calls.map(([request]) => request as RuntimeRequest)
      .filter((request): request is BatchRequest => request.type === "TRANSLATE_BATCH");
  }

  function ball(): HTMLButtonElement {
    return document.querySelector<HTMLButtonElement>("#wupage-floating-ball")!;
  }

  function output(): string | null {
    return document.querySelector("main .wupage-translation")?.textContent ?? null;
  }

  async function sendPageMessage(request: RuntimeRequest): Promise<RuntimeResponse> {
    return new Promise((resolve) => registerListener.mock.calls[0][0](request, {}, resolve));
  }

  beforeEach(async () => {
    vi.resetModules();
    runtimeRequest.mockReset();
    registerListener.mockReset();
    detectLanguage.mockReset().mockResolvedValue({ isReliable: true, languages: [{ language: "en", percentage: 99 }] });
    vi.stubGlobal("location", new URL("https://example.com/docs/article"));
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    document.documentElement.innerHTML = `<head></head><body><main><p>${originalText}</p></main></body>`;
    stored = { ...structuredClone(DEFAULT_SETTINGS), sourceLang: "en", targetLang: "ja", translationDisplayMode: "replace" };
    storageListeners = [];
    translate = async (request) => ({
      translations: request.texts.map(() => outputs[request.targetLang!]), cached: 0
    });
    runtimeRequest.mockImplementation(async (request: RuntimeRequest) => {
      if (request.type === "GET_SETTINGS") return structuredClone(stored);
      if (request.type === "SAVE_SETTINGS") { saveSettings(request.settings); return undefined; }
      if (request.type === "TRANSLATE_BATCH") return translate(request);
      return undefined;
    });
    vi.stubGlobal("chrome", {
      runtime: { id: "test" },
      i18n: { detectLanguage },
      storage: {
        local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) },
        onChanged: {
          addListener: (listener: StorageListener) => storageListeners.push(listener),
          removeListener: (listener: StorageListener) => { storageListeners = storageListeners.filter(entry => entry !== listener); }
        }
      }
    });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 100, left: 0, top: 100, right: 600, bottom: 124,
      width: 600, height: 24, toJSON: () => ({})
    } as DOMRect);
    documentListeners = vi.spyOn(document, "addEventListener");
    windowListeners = vi.spyOn(window, "addEventListener");
    await import("../src/content/index");
    ({ clearPageTranslation } = await import("../src/content/page-translation"));
    await vi.waitFor(() => expect(document.querySelector<HTMLElement>("#wupage-floating-hitbox")?.hidden).toBe(false));
    saveSettings({});
  });

  afterEach(() => {
    window.dispatchEvent(new Event("pagehide"));
    clearPageTranslation?.();
    for (const args of documentListeners.mock.calls) document.removeEventListener(...args);
    for (const args of windowListeners.mock.calls) window.removeEventListener(...args);
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.documentElement.replaceChildren();
  });

  it.each(["replace", "bilingual", "bilingual-accent"] as const)(
    "retranslates from the original after changing the floating target in %s mode", async (mode) => {
      saveSettings({ translationDisplayMode: mode });
      ball().click();
      await vi.waitFor(() => expect(output()).toBe(outputs.ja));
      const target = document.querySelector<HTMLSelectElement>("[data-role='target-lang']")!;
      target.value = "zh-CN";
      target.dispatchEvent(new Event("change", { bubbles: true }));

      await vi.waitFor(() => expect(output()).toBe(outputs["zh-CN"]));
      expect(stored.targetLang).toBe("zh-CN");
      expect(requests().map((request) => request.targetLang)).toEqual(["ja", "zh-CN"]);
      expect(requests().map((request) => request.texts)).toEqual([[originalText], [originalText]]);
      expect(ball().getAttribute("aria-label")).toBe("显示原文");
    }
  );

  it("applies popup or options storage updates without restarting for repeated saves or display changes", async () => {
    await sendPageMessage({ type: "TRANSLATE_PAGE" });
    expect(output()).toBe(outputs.ja);

    saveSettings({ targetLang: "zh-CN" });
    await vi.waitFor(() => expect(output()).toBe(outputs["zh-CN"]));
    expect(document.querySelector<HTMLSelectElement>("[data-role='target-lang']")?.value).toBe("zh-CN");
    saveSettings({ targetLang: "zh-CN" });
    saveSettings({ floatingBallEnabled: false });
    saveSettings({ translationDisplayMode: "bilingual-accent" });
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(output()).toBe(outputs["zh-CN"]);
    expect(requests().map((request) => request.targetLang)).toEqual(["ja", "zh-CN"]);
  });

  it.each([
    { language: "source", patch: { sourceLang: "fr" }, target: "ja" },
    { language: "target", patch: { targetLang: "zh-CN" }, target: "zh-CN" }
  ])("keeps automatic translation stoppable after changing the $language language", async ({ patch, target }) => {
    vi.useFakeTimers();
    const automatic = {
      enabled: true, nonTargetLanguage: false, presetSites: [],
      customSites: [{ id: "docs", pattern: "example.com/docs/*", enabled: true }]
    };
    saveSettings({ autoTranslation: automatic });
    await vi.advanceTimersByTimeAsync(400);
    expect(output()).toBe(outputs.ja);

    saveSettings(patch);
    await vi.advanceTimersByTimeAsync(400);
    expect(output()).toBe(outputs[target]);
    expect(requests()).toHaveLength(2);
    expect(requests()[1]).toMatchObject({ ...patch, texts: [originalText] });
    saveSettings({ autoTranslation: { ...automatic, enabled: false } });
    expect(output()).toBeNull();

    saveSettings({ autoTranslation: automatic });
    await vi.advanceTimersByTimeAsync(400);
    expect(output()).toBe(outputs[target]);
    ball().click();
    saveSettings({ targetLang: "fr" });
    await vi.advanceTimersByTimeAsync(400);
    expect(output()).toBeNull();
    expect(requests()).toHaveLength(2);

    vi.stubGlobal("location", new URL("https://example.com/docs/next"));
    const next = "This is another article loaded after navigating to the next document.";
    document.querySelector("main p")!.textContent = next;
    await vi.advanceTimersByTimeAsync(400);
    expect(output()).toBe(outputs.fr);
    expect(requests()).toHaveLength(3);
    expect(requests()[2]).toMatchObject({ texts: [next], targetLang: "fr" });
  });

  it("keeps the last selected language when earlier requests finish or fail late", async () => {
    const pending = new Map<string, ReturnType<typeof deferred<TranslateBatchResponse>>>();
    translate = (request) => {
      const gate = deferred<TranslateBatchResponse>();
      pending.set(request.targetLang!, gate);
      return gate.promise;
    };
    ball().click();
    await vi.waitFor(() => expect(pending.has("ja")).toBe(true));
    saveSettings({ targetLang: "zh-CN" });
    await vi.waitFor(() => expect(pending.has("zh-CN")).toBe(true));
    saveSettings({ targetLang: "fr" });
    await vi.waitFor(() => expect(pending.has("fr")).toBe(true));
    pending.get("fr")!.resolve({ translations: [outputs.fr], cached: 0 });
    await vi.waitFor(() => expect(output()).toBe(outputs.fr));
    pending.get("ja")!.resolve({ translations: [outputs.ja], cached: 0 });
    pending.get("zh-CN")!.reject(new Error("An obsolete request failed"));
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(output()).toBe(outputs.fr);
    expect(requests().map((request) => request.targetLang)).toEqual(["ja", "zh-CN", "fr"]);
    expect(requests().every((request) => request.texts.join("") === originalText)).toBe(true);
    expect(document.querySelector("[data-role='translation-status']")?.textContent).not.toContain("obsolete");
    expect(ball().getAttribute("aria-busy")).toBe("false");
  });

  it.each(["floating control", "content message"])(
    "uses the latest saved language when the initial settings read arrives late through %s", async (entry) => {
      const previousSettings = structuredClone(stored);
      const settingsRead = deferred<ExtensionSettings>();
      const previousRuntime = runtimeRequest.getMockImplementation()!;
      let readingSettings = false;
      runtimeRequest.mockImplementation((request: RuntimeRequest) => {
        if (request.type === "GET_SETTINGS" && !readingSettings) {
          readingSettings = true;
          return settingsRead.promise;
        }
        return previousRuntime(request);
      });
      let pageResponse: Promise<RuntimeResponse> | undefined;
      if (entry === "floating control") ball().click();
      else pageResponse = sendPageMessage({ type: "TRANSLATE_PAGE" });
      await vi.waitFor(() => expect(readingSettings).toBe(true));

      saveSettings({ targetLang: "zh-CN" });
      settingsRead.resolve(previousSettings);
      await vi.waitFor(() => expect(output()).toBe(outputs["zh-CN"]));
      if (pageResponse) expect((await pageResponse).ok).toBe(true);
      expect(requests().map((request) => request.targetLang)).toEqual(["zh-CN"]);
      expect(requests()[0].texts).toEqual([originalText]);
      expect(requests()[0].sourceLang).toBe("en");
    }
  );

  it("keeps untranslated and explicitly restored pages idle until the user starts translation", async () => {
    saveSettings({ targetLang: "zh-CN" });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(requests()).toHaveLength(0);
    expect(document.querySelector("main")?.textContent).toBe(originalText);
    ball().click();
    await vi.waitFor(() => expect(output()).toBe(outputs["zh-CN"]));
    ball().click();
    expect(output()).toBeNull();
    saveSettings({ targetLang: "ja" });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(requests()).toHaveLength(1);
    expect(document.querySelector("main")?.textContent).toBe(originalText);

    ball().click();
    await vi.waitFor(() => expect(output()).toBe(outputs.ja));
    expect(requests().map((request) => request.targetLang)).toEqual(["zh-CN", "ja"]);
    expect(requests()[1].texts).toEqual([originalText]);
  });

  it.each(["floating control", "content message"])(
    "does not restart pending manual or automatic work after stopping through %s", async (entry) => {
      const detection = deferred<{ isReliable: boolean; languages: Array<{ language: string; percentage: number }> }>();
      detectLanguage.mockReturnValueOnce(detection.promise);
      saveSettings({ autoTranslation: { enabled: true, nonTargetLanguage: true, presetSites: [], customSites: [] } });
      await vi.waitFor(() => expect(chrome.i18n.detectLanguage).toHaveBeenCalledTimes(1));
      const oldSettings = structuredClone(stored);
      const settingsRead = deferred<ExtensionSettings>();
      const previousRuntime = runtimeRequest.getMockImplementation()!;
      let readingSettings = false;
      runtimeRequest.mockImplementation((request: RuntimeRequest) => {
        if (request.type === "GET_SETTINGS" && !readingSettings) {
          readingSettings = true;
          return settingsRead.promise;
        }
        return previousRuntime(request);
      });
      let pageResponse: Promise<RuntimeResponse> | undefined;
      if (entry === "floating control") ball().click();
      else pageResponse = sendPageMessage({ type: "TRANSLATE_PAGE" });
      await vi.waitFor(() => expect(readingSettings).toBe(true));
      saveSettings({ targetLang: "zh-CN" });
      if (entry === "floating control") ball().click();
      else await sendPageMessage({ type: "CLEAR_TRANSLATION" });
      settingsRead.resolve(oldSettings);
      detection.resolve({ isReliable: true, languages: [{ language: "en", percentage: 99 }] });
      if (pageResponse) await pageResponse;
      await new Promise((resolve) => setTimeout(resolve, 450));

      expect(requests()).toHaveLength(0);
      expect(output()).toBeNull();
      expect(document.querySelector("main")?.textContent).toBe(originalText);
      expect(ball().getAttribute("aria-busy")).toBe("false");
    }
  );
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
