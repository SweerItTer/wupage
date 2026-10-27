// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import { DEFAULT_SETTINGS, SETTINGS_KEY } from "../src/shared/defaults";
import type { ExtensionSettings, RuntimeRequest } from "../src/shared/types";

vi.mock("../src/content/runtime", () => ({ sendRuntimeRequest: vi.fn() }));

import { initFloatingBall, setParagraphMode } from "../src/content/floating";
import { clearPageTranslation, getPageTranslationState, startPageTranslation } from "../src/content/page-translation";
import { sendRuntimeRequest } from "../src/content/runtime";
import { injectContentStyles } from "../src/content/styles";
import { ProviderError } from "../src/shared/errors";

describe("floating translation interactions", () => {
  let stored: ExtensionSettings;
  let storageChanged: (changes: Record<string, { newValue: unknown }>, area: string) => void;
  let documentListeners: MockInstance<Document["addEventListener"]>;
  let windowListeners: MockInstance<Window["addEventListener"]>;

  beforeEach(async () => {
    document.documentElement.innerHTML = "<head></head><body><main><p>Read this paragraph before continuing.</p></main></body>";
    stored = structuredClone(DEFAULT_SETTINGS);
    vi.mocked(sendRuntimeRequest).mockImplementation(async (request: RuntimeRequest) => {
      if (request.type === "GET_SETTINGS") return structuredClone(stored);
      if (request.type === "SAVE_SETTINGS") {
        stored = structuredClone(request.settings);
        return undefined;
      }
      if (request.type === "TRANSLATE_BATCH") {
        return { translations: request.texts.map(() => "继续之前，请阅读此段内容。"), cached: 0 };
      }
      return undefined;
    });
    vi.stubGlobal("chrome", {
      runtime: { id: "test" },
      storage: {
        local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) },
        onChanged: { addListener: (listener: typeof storageChanged) => { storageChanged = listener; } }
      }
    });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1200 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const hitbox = document.querySelector<HTMLElement>("#wupage-floating-hitbox");
      const left = this.id === "wupage-floating-ball" ? Number.parseFloat(hitbox?.style.left ?? "0") + 16 : 0;
      const top = this.id === "wupage-floating-ball" ? Number.parseFloat(hitbox?.style.top ?? "0") + 16 : 100;
      const width = this.id === "wupage-floating-ball" ? 42 : 600;
      return { left, top, right: left + width, bottom: top + 24, x: left, y: top, width, height: 24, toJSON: () => ({}) };
    });
    documentListeners = vi.spyOn(document, "addEventListener");
    windowListeners = vi.spyOn(window, "addEventListener");
    injectContentStyles();
    initFloatingBall();
    await vi.waitFor(() => expect(query<HTMLElement>("#wupage-floating-hitbox").hidden).toBe(false));
  });

  afterEach(() => {
    clearPageTranslation();
    for (const args of documentListeners.mock.calls) document.removeEventListener(...args);
    for (const args of windowListeners.mock.calls) window.removeEventListener(...args);
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.mocked(sendRuntimeRequest).mockReset();
    document.documentElement.replaceChildren();
  });

  function hover(): HTMLElement {
    query("#wupage-floating-hitbox").dispatchEvent(new Event("pointerenter"));
    return query<HTMLElement>("#wupage-floating-menu");
  }

  function translationRequests(): RuntimeRequest[] {
    return vi.mocked(sendRuntimeRequest).mock.calls.map(([request]) => request).filter((request) => request.type === "TRANSLATE_BATCH");
  }

  it("opens after 500 ms of hover and allows crossing the gap before closing on leave", () => {
    vi.useFakeTimers();
    const menu = hover();
    vi.advanceTimersByTime(499);
    expect(menu.hidden).toBe(true);
    vi.advanceTimersByTime(1);
    expect(menu.hidden).toBe(false);
    expect(query("#wupage-floating-ball").getAttribute("aria-expanded")).toBe("true");
    expect(translationRequests()).toHaveLength(0);
    query("#wupage-floating-hitbox").dispatchEvent(new Event("pointerleave"));
    vi.advanceTimersByTime(120);
    menu.dispatchEvent(new Event("pointerenter"));
    vi.advanceTimersByTime(400);
    expect(menu.hidden).toBe(false);
    menu.dispatchEvent(new Event("pointerleave"));
    vi.advanceTimersByTime(300);
    expect(menu.hidden).toBe(true);
    expect(query("#wupage-floating-ball").getAttribute("aria-expanded")).toBe("false");
  });

  it("cancels opening on leave and waits a full delay on the next hover", () => {
    vi.useFakeTimers();
    const menu = hover();
    vi.advanceTimersByTime(250);
    query("#wupage-floating-hitbox").dispatchEvent(new Event("pointerleave"));
    vi.advanceTimersByTime(600);
    expect(menu.hidden).toBe(true);
    hover();
    vi.advanceTimersByTime(499);
    expect(menu.hidden).toBe(true);
    vi.advanceTimersByTime(1);
    expect(menu.hidden).toBe(false);
  });

  it("cancels pending hover opening on drag or escape", () => {
    vi.useFakeTimers();
    const menu = hover();
    vi.advanceTimersByTime(250);
    const ball = query<HTMLButtonElement>("#wupage-floating-ball");
    ball.setPointerCapture = vi.fn();
    ball.dispatchEvent(pointer("pointerdown", 800, 600));
    ball.dispatchEvent(pointer("pointermove", 820, 620));
    ball.dispatchEvent(pointer("pointerup", 820, 620));
    ball.click();
    vi.advanceTimersByTime(600);
    expect(menu.hidden).toBe(true);
    expect(translationRequests()).toHaveLength(0);
    hover();
    vi.advanceTimersByTime(250);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    vi.advanceTimersByTime(600);
    expect(menu.hidden).toBe(true);
  });

  it("switches immediately between translation and original and can translate again", async () => {
    const ball = query<HTMLButtonElement>("#wupage-floating-ball");
    ball.click();
    expect(ball.textContent).toBe("原");
    await vi.waitFor(() => expect(ball.getAttribute("aria-busy")).toBe("false"));
    expect(translationRequests()).toHaveLength(1);
    expect(ball.textContent).toBe("原");
    ball.click();
    expect(ball.textContent).toBe("译");
    expect(document.querySelector(".wupage-translation")).toBeNull();
    ball.click();
    expect(ball.textContent).toBe("原");
    await vi.waitFor(() => expect(ball.getAttribute("aria-busy")).toBe("false"));
    expect(translationRequests()).toHaveLength(1);
    expect(query("[data-role='translation-status']").textContent).toContain("缓存命中 1 段");
    expect(ball.getAttribute("aria-label")).toBe("显示原文");
  });

  it("keeps the original action when the provider returns unchanged text", async () => {
    const runtime = vi.mocked(sendRuntimeRequest).getMockImplementation()!;
    vi.mocked(sendRuntimeRequest).mockImplementation(async (request) => request.type === "TRANSLATE_BATCH"
      ? { translations: request.texts, cached: 0 } : runtime(request));
    const ball = query<HTMLButtonElement>("#wupage-floating-ball");
    ball.click();
    await vi.waitFor(() => expect(ball.getAttribute("aria-busy")).toBe("false"));
    expect(document.querySelector(".wupage-translation")).toBeNull();
    expect(getPageTranslationState()).toMatchObject({ active: true, pending: 0, translated: 1 });
    expect(ball.textContent).toBe("原");
    expect(ball.getAttribute("aria-label")).toBe("显示原文");
    ball.click();
    expect(getPageTranslationState().active).toBe(false);
    expect(ball.textContent).toBe("译");
    expect(translationRequests()).toHaveLength(1);
  });

  it("keeps the original action while a dynamic feed replaces translated posts", async () => {
    const ball = query<HTMLButtonElement>("#wupage-floating-ball");
    ball.click();
    await vi.waitFor(() => expect(ball.getAttribute("aria-busy")).toBe("false"));
    query("main").replaceChildren();
    await new Promise((resolve) => setTimeout(resolve, 220));
    expect(document.querySelector(".wupage-translation")).toBeNull();
    expect(getPageTranslationState()).toMatchObject({ active: true, pending: 0 });
    expect(ball.textContent).toBe("原");
    ball.click();
    expect(getPageTranslationState().active).toBe(false);
    expect(ball.textContent).toBe("译");
    query("main").innerHTML = "<p>A newly loaded post after translation is stopped.</p>";
    await new Promise((resolve) => setTimeout(resolve, 220));
    expect(translationRequests()).toHaveLength(1);
  });

  it("keeps the ball enabled during translation and discards a response after stopping", async () => {
    let finish!: (value: unknown) => void;
    const runtime = vi.mocked(sendRuntimeRequest).getMockImplementation()!;
    vi.mocked(sendRuntimeRequest).mockImplementation((request) => request.type === "TRANSLATE_BATCH"
      ? new Promise((resolve) => { finish = resolve; }) : runtime(request));
    const ball = query<HTMLButtonElement>("#wupage-floating-ball");
    ball.click();
    await vi.waitFor(() => expect(translationRequests()).toHaveLength(1));
    expect(ball.textContent).toBe("原");
    expect(ball.getAttribute("aria-busy")).toBe("true");
    expect(ball.getAttribute("aria-disabled")).toBe("false");
    expect(getComputedStyle(ball).cursor).toBe("pointer");
    expect(getComputedStyle(ball).opacity).not.toBe("0.68");
    expect(query<HTMLButtonElement>("[data-action='page-toggle']").disabled).toBe(false);
    expect(query("[data-action='page-toggle']").textContent).toBe("停止翻译并显示原文");
    ball.click();
    expect(ball.textContent).toBe("译");
    expect(ball.getAttribute("aria-busy")).toBe("false");
    finish({ translations: ["迟到的译文"], cached: 0 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector(".wupage-translation")).toBeNull();
    expect(ball.getAttribute("aria-label")).toBe("翻译全文");
    expect(translationRequests()).toHaveLength(1);
  });

  it("can stop from the menu and restart before the old translation finishes", async () => {
    const completions: Array<(value: unknown) => void> = [];
    const runtime = vi.mocked(sendRuntimeRequest).getMockImplementation()!;
    vi.mocked(sendRuntimeRequest).mockImplementation((request) => request.type === "TRANSLATE_BATCH"
      ? new Promise((resolve) => { completions.push(resolve); }) : runtime(request));
    const ball = query<HTMLButtonElement>("#wupage-floating-ball");
    ball.click();
    await vi.waitFor(() => expect(completions).toHaveLength(1));
    query<HTMLButtonElement>("[data-action='page-toggle']").click();
    expect(ball.textContent).toBe("译");
    ball.click();
    await vi.waitFor(() => expect(completions).toHaveLength(2));
    completions[0]({ translations: ["旧译文"], cached: 0 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ball.textContent).toBe("原");
    expect(ball.getAttribute("aria-busy")).toBe("true");
    expect(document.body.textContent).not.toContain("旧译文");
    completions[1]({ translations: ["新译文"], cached: 0 });
    await vi.waitFor(() => expect(ball.getAttribute("aria-busy")).toBe("false"));
    expect(query(".wupage-translation").textContent).toBe("新译文");
  });

  it("does not restart a cancelled action when its settings arrive late", async () => {
    let finishSettings!: (value: unknown) => void;
    let delayNextSettings = true;
    const runtime = vi.mocked(sendRuntimeRequest).getMockImplementation()!;
    vi.mocked(sendRuntimeRequest).mockImplementation((request) => {
      if (request.type === "GET_SETTINGS" && delayNextSettings) {
        delayNextSettings = false;
        return new Promise((resolve) => { finishSettings = resolve; });
      }
      return runtime(request);
    });
    const ball = query<HTMLButtonElement>("#wupage-floating-ball");
    ball.click();
    await vi.waitFor(() => expect(finishSettings).toBeTypeOf("function"));
    ball.click();
    expect(ball.textContent).toBe("译");
    ball.click();
    await vi.waitFor(() => expect(ball.getAttribute("aria-busy")).toBe("false"));
    finishSettings(stored);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(translationRequests()).toHaveLength(1);
    expect(ball.textContent).toBe("原");
    expect(query(".wupage-translation").textContent).toBe("继续之前，请阅读此段内容。");
  });

  it("does not mistake small pointer jitter for a drag", async () => {
    const ball = query<HTMLButtonElement>("#wupage-floating-ball");
    ball.setPointerCapture = vi.fn();
    ball.dispatchEvent(pointer("pointerdown", 800, 600));
    ball.dispatchEvent(pointer("pointermove", 801, 601));
    ball.dispatchEvent(pointer("pointerup", 801, 601));
    ball.click();
    await vi.waitFor(() => expect(translationRequests()).toHaveLength(1));
  });

  it("shows translation failures and retries from the floating menu", async () => {
    const runtime = vi.mocked(sendRuntimeRequest).getMockImplementation()!;
    vi.mocked(sendRuntimeRequest).mockImplementation(async (request) => {
      if (request.type === "TRANSLATE_BATCH") throw new Error("服务暂不可用");
      return runtime(request);
    });
    query<HTMLButtonElement>("#wupage-floating-ball").click();
    await vi.waitFor(() => expect(query("[data-role='translation-status']").textContent).toContain("服务暂不可用"));
    expect(query<HTMLElement>("#wupage-floating-menu").hidden).toBe(false);
    expect(query<HTMLButtonElement>("[data-action='retranslate']").hidden).toBe(false);
    vi.mocked(sendRuntimeRequest).mockImplementation(runtime);
    query<HTMLButtonElement>("[data-action='retranslate']").click();
    await vi.waitFor(() => expect(query("[data-role='translation-status']").textContent).toContain("已翻译 1 段"));
    expect(query("[data-role='translation-status']").getAttribute("data-tone")).toBe("normal");
  });

  it("saves provider and display choices without retranslating existing text", async () => {
    stored.providers[0].label = '<img src=x onerror="alert(1)">';
    stored.providers[1].enabled = false;
    hover();
    await vi.waitFor(() => expect(query<HTMLSelectElement>("[data-role='provider']").options.length).toBe(stored.providers.length - 1));
    const provider = query<HTMLSelectElement>("[data-role='provider']");
    expect(provider.querySelector("img")).toBeNull();
    expect([...provider.options].some((option) => option.value === stored.providers[1].id)).toBe(false);
    provider.value = "deepseek";
    provider.dispatchEvent(new Event("change", { bubbles: true }));
    query<HTMLButtonElement>("[data-mode='replace']").click();
    await vi.waitFor(() => expect(stored).toMatchObject({ activeProviderId: "deepseek", translationDisplayMode: "replace" }));
    query<HTMLButtonElement>("#wupage-floating-ball").click();
    await vi.waitFor(() => expect(query(".wupage-translation").getAttribute("data-wupage-display-mode")).toBe("replace"));
    query<HTMLButtonElement>("[data-mode='bilingual-accent']").click();
    await vi.waitFor(() => expect(query(".wupage-translation").getAttribute("data-wupage-display-mode")).toBe("bilingual-accent"));
    expect(translationRequests()).toHaveLength(1);
  });

  it("waits for a pending language save before translating", async () => {
    let finishSave!: () => void;
    const runtime = vi.mocked(sendRuntimeRequest).getMockImplementation()!;
    vi.mocked(sendRuntimeRequest).mockImplementation(async (request) => {
      if (request.type === "SAVE_SETTINGS") await new Promise<void>((resolve) => { finishSave = resolve; });
      return runtime(request);
    });
    const target = query<HTMLSelectElement>("[data-role='target-lang']");
    target.value = "ja";
    target.dispatchEvent(new Event("change", { bubbles: true }));
    query<HTMLButtonElement>("#wupage-floating-ball").click();
    await vi.waitFor(() => expect(finishSave).toBeTypeOf("function"));
    expect(translationRequests()).toHaveLength(0);
    finishSave();
    await vi.waitFor(() => expect(translationRequests()[0]).toMatchObject({ targetLang: "ja" }));
  });

  it("recovers from a failed settings save without trapping subsequent actions", async () => {
    const runtime = vi.mocked(sendRuntimeRequest).getMockImplementation()!;
    vi.mocked(sendRuntimeRequest).mockImplementation(async (request) => {
      if (request.type === "SAVE_SETTINGS") throw new Error("设置保存失败");
      return runtime(request);
    });
    query<HTMLButtonElement>("[data-mode='replace']").click();
    await vi.waitFor(() => expect(query("[data-role='translation-status']").textContent).toContain("设置保存失败"));
    expect(stored.translationDisplayMode).toBe("bilingual");
    expect(query("[data-mode='bilingual']").getAttribute("aria-pressed")).toBe("true");
    query<HTMLButtonElement>("#wupage-floating-ball").click();
    await vi.waitFor(() => expect(query("[data-role='translation-status']").textContent).toContain("已翻译 1 段"));
  });

  it("follows translations started outside the floating menu", async () => {
    const runtime = vi.mocked(sendRuntimeRequest).getMockImplementation()!;
    vi.mocked(sendRuntimeRequest).mockImplementation(async (request) => {
      if (request.type === "TRANSLATE_BATCH") throw new Error("服务暂不可用");
      return runtime(request);
    });
    query<HTMLButtonElement>("#wupage-floating-ball").click();
    await vi.waitFor(() => expect(query("[data-role='translation-status']").getAttribute("data-tone")).toBe("error"));
    vi.mocked(sendRuntimeRequest).mockImplementation(runtime);
    await startPageTranslation(stored);
    expect(query("[data-role='translation-status']").textContent).toContain("已翻译 1 段");
    expect(query("[data-role='translation-status']").getAttribute("data-tone")).toBe("normal");
    expect(query("#wupage-floating-ball").getAttribute("aria-label")).toBe("显示原文");
    clearPageTranslation();
    expect(query("#wupage-floating-ball").getAttribute("aria-label")).toBe("翻译全文");
  });

  it("keeps the ball accessible when a small window needs a scrolling menu", () => {
    vi.useFakeTimers();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 320 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 320 });
    storageChanged({ "wupage.floating.position": { newValue: { left: 139, top: 139, edge: null } } }, "local");
    const menu = query<HTMLElement>("#wupage-floating-menu");
    Object.defineProperty(menu, "offsetHeight", { configurable: true, get: () => Number.parseFloat(menu.style.maxHeight) });
    Object.defineProperty(menu, "offsetWidth", { configurable: true, get: () => Number.parseFloat(menu.style.width) });
    hover();
    vi.advanceTimersByTime(500);
    const bottom = Number.parseFloat(menu.style.top) + menu.offsetHeight;
    expect(bottom).toBeLessThanOrEqual(131);
    expect(Number.parseFloat(menu.style.left)).toBeGreaterThanOrEqual(8);
    expect(Number.parseFloat(menu.style.left) + menu.offsetWidth).toBeLessThanOrEqual(312);
  });

  it("displays Doubao's automatic source without losing the saved language when changing services", async () => {
    Object.assign(chrome.runtime, { getURL: (path: string) => `chrome-extension://test/${path}` });
    stored = { ...stored, activeProviderId: "doubao-web", sourceLang: "en", targetLang: "pt" };
    storageChanged({ [SETTINGS_KEY]: { newValue: stored } }, "local");
    const source = query<HTMLSelectElement>("[data-role='source-lang']");
    const target = query<HTMLSelectElement>("[data-role='target-lang']");
    const provider = query<HTMLSelectElement>("[data-role='provider']");
    expect(source.disabled).toBe(true);
    expect(source.value).toBe("auto");
    expect(query("[data-role='source-lang-value']").textContent).toContain("自动识别");
    expect(target.value).toBe("pt");
    expect(target.selectedOptions[0]?.disabled).toBe(true);
    target.value = "ja";
    target.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => expect(stored.targetLang).toBe("ja"));
    expect(stored.sourceLang).toBe("en");
    provider.value = "google-web-translate";
    provider.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => expect(source.disabled).toBe(false));
    expect(stored.sourceLang).toBe("en");
    expect(source.value).toBe("en");
    expect(query("[data-role='source-lang-value']").textContent).toBe("English");
    expect(translationRequests()).toHaveLength(0);
  });

  it("offers an explicit settings action after Doubao requires login", async () => {
    Object.assign(chrome.runtime, { getURL: (path: string) => `chrome-extension://test/${path}` });
    stored.activeProviderId = "doubao-web";
    storageChanged({ [SETTINGS_KEY]: { newValue: stored } }, "local");
    const runtime = vi.mocked(sendRuntimeRequest).getMockImplementation()!;
    vi.mocked(sendRuntimeRequest).mockImplementation((request) => request.type === "TRANSLATE_BATCH"
      ? Promise.reject(new ProviderError("请登录豆包后重新检测。", "login-required")) : runtime(request));
    query<HTMLButtonElement>("#wupage-floating-ball").click();
    await vi.waitFor(() => expect(getPageTranslationState().errorCode).toBe("login-required"));
    const recover = query<HTMLButtonElement>("[data-action='doubao-settings']");
    expect(recover.hidden).toBe(false);
    expect(recover.textContent).toContain("登录豆包");
    expect(sendRuntimeRequest).not.toHaveBeenCalledWith({ type: "OPEN_OPTIONS_PAGE" });
    recover.click();
    expect(sendRuntimeRequest).toHaveBeenCalledWith({ type: "OPEN_OPTIONS_PAGE" });
    expect(translationRequests()).toHaveLength(1);
  });

  it("shows rate-limit waiting and prevents repeated retries, including after restoring the page", async () => {
    Object.assign(chrome.runtime, { getURL: (path: string) => `chrome-extension://test/${path}` });
    stored.activeProviderId = "doubao-web";
    storageChanged({ [SETTINGS_KEY]: { newValue: stored } }, "local");
    const runtime = vi.mocked(sendRuntimeRequest).getMockImplementation()!;
    vi.mocked(sendRuntimeRequest).mockImplementation((request) => request.type === "TRANSLATE_BATCH"
      ? Promise.reject(new ProviderError("豆包限流。", "rate-limited", 5000)) : runtime(request));
    const ball = query<HTMLButtonElement>("#wupage-floating-ball");
    ball.click();
    await vi.waitFor(() => expect(getPageTranslationState().errorCode).toBe("rate-limited"));
    const retry = query<HTMLButtonElement>("[data-action='retranslate']");
    expect(retry.disabled).toBe(true);
    expect(retry.textContent).toContain("等待");
    expect(query("[data-role='translation-status']").textContent).toContain("秒后再试");
    retry.click();
    ball.click(); // Restoring the page is still allowed.
    ball.click(); // Starting again waits for the same cooldown.
    await Promise.resolve();
    expect(translationRequests()).toHaveLength(1);
  });

  it("updates the cooldown after a paragraph error opens a previously hidden menu", async () => {
    vi.useFakeTimers();
    Object.assign(chrome.runtime, { getURL: (path: string) => `chrome-extension://test/${path}` });
    stored.activeProviderId = "doubao-web";
    storageChanged({ [SETTINGS_KEY]: { newValue: stored } }, "local");
    await setParagraphMode(true);
    const menu = query<HTMLElement>("#wupage-floating-menu");
    expect(menu.hidden).toBe(true);
    const runtime = vi.mocked(sendRuntimeRequest).getMockImplementation()!;
    vi.mocked(sendRuntimeRequest).mockImplementation((request) => request.type === "TRANSLATE_BATCH"
      ? Promise.reject(new ProviderError("豆包请求受限。", "rate-limited", 2000)) : runtime(request));
    query("main p").dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(menu.hidden).toBe(false);
    const retry = query<HTMLButtonElement>("[data-action='retranslate']");
    expect(retry.disabled).toBe(true);
    expect(retry.textContent).toContain("等待");
    await vi.advanceTimersByTimeAsync(2100);
    expect(retry.disabled).toBe(false);
    expect(retry.textContent).toBe("重试翻译");
    vi.mocked(sendRuntimeRequest).mockImplementation(runtime);
    retry.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(translationRequests()).toHaveLength(2);
    expect(query(".wupage-translation").textContent).toBe("继续之前，请阅读此段内容。");
    await setParagraphMode(false);
  });

  it("shows paragraph instructions inline without an extra confirmation", async () => {
    const alert = vi.spyOn(window, "alert");
    await setParagraphMode(true);
    expect(query("[data-action='paragraph-mode']").getAttribute("aria-pressed")).toBe("true");
    expect(query(".wupage-menu-hint").textContent).toContain("Ctrl");
    expect(alert).not.toHaveBeenCalled();
    await setParagraphMode(false);
  });

  it("supports keyboard access, escape, settings, and external visibility changes", async () => {
    const ball = query<HTMLButtonElement>("#wupage-floating-ball");
    ball.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    const menu = query<HTMLElement>("#wupage-floating-menu");
    expect(menu.hidden).toBe(false);
    expect(document.activeElement).toBe(query("[data-role='source-lang']"));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(menu.hidden).toBe(true);
    expect(document.activeElement).toBe(ball);
    hover();
    await vi.waitFor(() => expect(menu.hidden).toBe(false));
    query<HTMLButtonElement>("[data-action='settings']").click();
    expect(sendRuntimeRequest).toHaveBeenCalledWith({ type: "OPEN_OPTIONS_PAGE" });
    storageChanged({ [SETTINGS_KEY]: { newValue: { ...stored, floatingBallEnabled: false } } }, "local");
    expect(query<HTMLElement>("#wupage-floating-hitbox").hidden).toBe(true);
    expect(menu.hidden).toBe(true);
  });
});

function query<T extends Element = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

function pointer(type: string, clientX: number, clientY: number): Event {
  const event = new Event(type, { bubbles: true });
  Object.defineProperties(event, { clientX: { value: clientX }, clientY: { value: clientY }, pointerId: { value: 1 }, button: { value: 0 } });
  return event;
}
