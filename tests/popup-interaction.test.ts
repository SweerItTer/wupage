// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/shared/defaults";
import type { ExtensionSettings, RuntimeRequest, RuntimeResponse } from "../src/shared/types";

describe("popup translation interactions", () => {
  let translate: ReturnType<typeof vi.fn>;
  let save: ReturnType<typeof vi.fn>;
  let loadSettings: ReturnType<typeof vi.fn>;
  let paragraph: ReturnType<typeof vi.fn>;
  let stored: ExtensionSettings;

  beforeEach(async () => {
    vi.resetModules();
    document.open();
    document.write(readFileSync(resolve(process.cwd(), "popup.html"), "utf8"));
    document.close();
    translate = vi.fn(async () => ({ translated: 1, cached: 0 }));
    save = vi.fn(async () => undefined);
    paragraph = vi.fn(async (enabled: boolean) => ({ enabled }));
    stored = structuredClone(DEFAULT_SETTINGS);
    loadSettings = vi.fn(async () => structuredClone(stored));
    vi.stubGlobal("chrome", {
      runtime: { sendMessage: async (request: RuntimeRequest): Promise<RuntimeResponse> => {
        if (request.type === "GET_SETTINGS") return { ok: true, data: await loadSettings() };
        if (request.type === "GET_OCR_STATUS") return { ok: true, data: { state: "installed", downloaded: 100, total: 100 } };
        if (request.type === "SAVE_SETTINGS") { await save(request.settings); stored = structuredClone(request.settings); }
        return { ok: true };
      } },
      tabs: {
        query: async () => [{ id: 4, url: "https://example.com/article" }],
        sendMessage: vi.fn(async (_tabId: number, request: RuntimeRequest): Promise<RuntimeResponse> => {
          if (request.type === "GET_PARAGRAPH_MODE") return { ok: true, data: { enabled: false } };
          if (request.type === "GET_TRANSLATION_STATE") return { ok: true, data: { translated: false } };
          if (request.type === "SET_PARAGRAPH_MODE") return { ok: true, data: await paragraph(request.enabled) };
          if (request.type === "SET_FLOATING_BALL") return { ok: true, data: { enabled: request.enabled } };
          if (request.type === "TRANSLATE_PAGE") return { ok: true, data: await translate() };
          return { ok: true, data: { cleared: true } };
        })
      }
    });
    await import("../src/popup/index");
    await vi.waitFor(() => expect(button().disabled).toBe(false));
  });

  afterEach(() => {
    window.dispatchEvent(new Event("pagehide"));
    vi.unstubAllGlobals();
    document.documentElement.replaceChildren();
  });

  it("can stop a pending translation and ignores its late response", async () => {
    const pending = deferred();
    translate.mockImplementation(() => pending.promise);
    button().click();
    await vi.waitFor(() => expect(translate).toHaveBeenCalledTimes(1));
    expect(button().textContent).toBe("显示全文");
    expect(button().disabled).toBe(false);
    button().click();
    await vi.waitFor(() => expect(document.querySelector("#status")?.textContent).toBe("已显示原文。"));
    expect(button().textContent).toBe("翻译全文");
    pending.resolve({ translated: 1, cached: 0 });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(button().textContent).toBe("翻译全文");
    expect(button().classList.contains("is-loading")).toBe(false);
  });

  it("does not start a cancelled action after a delayed settings save", async () => {
    const pending = deferred();
    save.mockImplementationOnce(() => pending.promise);
    button().click();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    button().click();
    await vi.waitFor(() => expect(button().textContent).toBe("翻译全文"));
    pending.resolve(undefined);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(translate).not.toHaveBeenCalled();
    expect(button().disabled).toBe(false);
  });

  it("keeps a restarted translation busy when the previous result arrives", async () => {
    const old = deferred();
    const current = deferred();
    translate.mockImplementationOnce(() => old.promise).mockImplementationOnce(() => current.promise);
    button().click();
    await vi.waitFor(() => expect(translate).toHaveBeenCalledTimes(1));
    button().click();
    await vi.waitFor(() => expect(document.querySelector("#status")?.textContent).toBe("已显示原文。"));
    button().click();
    await vi.waitFor(() => expect(translate).toHaveBeenCalledTimes(2));
    old.resolve({ translated: 1, cached: 0 });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(button().textContent).toBe("显示全文");
    expect(button().classList.contains("is-loading")).toBe(true);
    current.resolve({ translated: 2, cached: 0 });
    await vi.waitFor(() => expect(button().classList.contains("is-loading")).toBe(false));
    expect(document.querySelector("#status")?.textContent).toContain("已翻译 2 段");
  });

  it("keeps the original action when the active page has no completed segments", async () => {
    translate.mockResolvedValue({ translated: 0, cached: 0 });
    button().click();
    await vi.waitFor(() => expect(document.querySelector("#status")?.textContent).toContain("已翻译 0 段"));
    expect(button().textContent).toBe("显示全文");
    expect(button().disabled).toBe(false);
  });

  it("restores the action after a settings error and permits another attempt", async () => {
    save.mockRejectedValueOnce(new Error("设置保存失败"));
    button().click();
    await vi.waitFor(() => expect(document.querySelector("#status")?.textContent).toBe("设置保存失败"));
    expect(button().textContent).toBe("翻译全文");
    expect(button().disabled).toBe(false);
    expect(translate).not.toHaveBeenCalled();
    button().click();
    await vi.waitFor(() => expect(document.querySelector("#status")?.textContent).toContain("已翻译 1 段"));
  });

  it("silently toggles paragraph mode without changing other controls during a translation", async () => {
    const translation = deferred();
    translate.mockImplementationOnce(() => translation.promise);
    button().click();
    await vi.waitFor(() => expect(translate).toHaveBeenCalledTimes(1));
    const toggle = document.querySelector<HTMLButtonElement>("#paragraphMode")!;
    const changes = observeOtherControls(toggle);
    const status = document.querySelector("#status")!;
    const statusChanges = vi.fn();
    const observer = new MutationObserver(statusChanges);
    observer.observe(status, { childList: true, subtree: true, characterData: true });
    try {
      for (const enabled of [true, false, true, false]) {
        const pending = deferred();
        paragraph.mockImplementationOnce(() => pending.promise);
        const calls = paragraph.mock.calls.length;
        toggle.click();
        await vi.waitFor(() => expect(paragraph).toHaveBeenCalledTimes(calls + 1));
        expect(paragraph).toHaveBeenLastCalledWith(enabled);
        expect(toggle.disabled).toBe(true);
        expect(toggle.getAttribute("aria-busy")).toBe("true");
        toggle.click();
        expect(paragraph).toHaveBeenCalledTimes(calls + 1);
        pending.resolve({ enabled });
        await vi.waitFor(() => expect(toggle.disabled).toBe(false));
        expect(toggle.getAttribute("aria-pressed")).toBe(String(enabled));
        expect(button().classList.contains("is-loading")).toBe(true);
        expect(status.textContent).toBe("正在翻译...");
      }
      expect(changes.records).toEqual([]);
      expect(statusChanges).not.toHaveBeenCalled();
    } finally {
      changes.disconnect();
      observer.disconnect();
      translation.resolve({ translated: 1, cached: 0 });
    }
    await vi.waitFor(() => expect(button().classList.contains("is-loading")).toBe(false));
  });

  it("keeps other controls stable when repeatedly toggling the floating ball", async () => {
    const toggle = document.querySelector<HTMLButtonElement>("#floatingBall")!;
    const changes = observeOtherControls(toggle);
    try {
      for (const enabled of [false, true, false, true]) {
        const pending = deferred();
        save.mockImplementationOnce(() => pending.promise);
        const calls = save.mock.calls.length;
        toggle.click();
        await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(calls + 1));
        toggle.click();
        expect(save).toHaveBeenCalledTimes(calls + 1);
        pending.resolve(undefined);
        await vi.waitFor(() => expect(toggle.disabled).toBe(false));
        expect(toggle.getAttribute("aria-pressed")).toBe(String(enabled));
      }
      expect(changes.records).toEqual([]);
    } finally {
      changes.disconnect();
    }
  });

  it("reports a failed paragraph change and allows a silent retry", async () => {
    paragraph.mockRejectedValueOnce(new Error("切换失败"));
    const toggle = document.querySelector<HTMLButtonElement>("#paragraphMode")!;
    toggle.click();
    await vi.waitFor(() => expect(toggle.disabled).toBe(false));
    expect(document.querySelector("#status")?.textContent).toBe("切换失败");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    toggle.click();
    await vi.waitFor(() => expect(toggle.getAttribute("aria-pressed")).toBe("true"));
    expect(paragraph).toHaveBeenLastCalledWith(true);
    expect(document.querySelector("#status")?.textContent).toBe("");
  });

  it("restores the floating ball value when saving fails", async () => {
    save.mockRejectedValueOnce(new Error("设置保存失败"));
    const toggle = document.querySelector<HTMLButtonElement>("#floatingBall")!;
    toggle.click();
    await vi.waitFor(() => expect(toggle.disabled).toBe(false));
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector("#status")?.textContent).toBe("设置保存失败");
    toggle.click();
    await vi.waitFor(() => expect(toggle.getAttribute("aria-pressed")).toBe("false"));
  });

  it("enables automatic translation directly and preserves its default language rule when disabled", async () => {
    const toggle = document.querySelector<HTMLButtonElement>("#autoTranslation")!;
    const changes = observeOtherControls(toggle);
    toggle.click();
    await vi.waitFor(() => expect(toggle.getAttribute("aria-pressed")).toBe("true"));
    expect(stored.autoTranslation).toEqual({ enabled: true, nonTargetLanguage: true, presetSites: [], customSites: [] });
    toggle.click();
    await vi.waitFor(() => expect(toggle.getAttribute("aria-pressed")).toBe("false"));
    expect(stored.autoTranslation?.nonTargetLanguage).toBe(true);
    expect(changes.records).toEqual([]);
    changes.disconnect();
  });

  it("uses the latest saved site rules instead of replacing them with language detection", async () => {
    stored.autoTranslation = { enabled: false, nonTargetLanguage: false, presetSites: ["github.com"],
      customSites: [{ id: "private", pattern: "example.com/docs/*", enabled: true }] };
    document.querySelector<HTMLButtonElement>("#autoTranslation")!.click();
    await vi.waitFor(() => expect(stored.autoTranslation?.enabled).toBe(true));
    expect(stored.autoTranslation).toEqual({ enabled: true, nonTargetLanguage: false, presetSites: ["github.com"],
      customSites: [{ id: "private", pattern: "example.com/docs/*", enabled: true }] });
  });

  it.each([
    ["floatingBall", "floatingBallEnabled"],
    ["imageTranslation", "imageTranslationEnabled"]
  ] as const)("keeps a %s change made while automatic translation reads settings", async (id, field) => {
    const latest = structuredClone(stored);
    latest.cacheEnabled = false;
    latest.autoTranslation = { enabled: false, nonTargetLanguage: false, presetSites: ["github.com"], customSites: [] };
    const pending = deferred();
    loadSettings.mockImplementationOnce(() => pending.promise);
    const automatic = document.querySelector<HTMLButtonElement>("#autoTranslation")!;
    automatic.click();
    await vi.waitFor(() => expect(loadSettings).toHaveBeenCalledTimes(2));
    const toggle = document.querySelector<HTMLButtonElement>(`#${id}`)!;
    const enabled = !latest[field];
    toggle.click();
    await vi.waitFor(() => expect(stored[field]).toBe(enabled));
    expect(automatic.disabled).toBe(true);
    pending.resolve(latest);
    await vi.waitFor(() => expect(automatic.disabled).toBe(false));
    expect(stored[field]).toBe(enabled);
    expect(toggle.getAttribute("aria-pressed")).toBe(String(enabled));
    expect(stored.cacheEnabled).toBe(false);
    expect(stored.autoTranslation).toEqual({ ...latest.autoTranslation, enabled: true });
  });

  it("prevents repeated automatic switch requests and restores its state when saving fails", async () => {
    const toggle = document.querySelector<HTMLButtonElement>("#autoTranslation")!;
    const pending = deferred();
    save.mockImplementationOnce(() => pending.promise);
    toggle.click();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    toggle.click(); expect(save).toHaveBeenCalledTimes(1);
    pending.resolve(undefined);
    await vi.waitFor(() => expect(toggle.disabled).toBe(false));
    save.mockRejectedValueOnce(new Error("自动翻译设置保存失败"));
    toggle.click();
    await vi.waitFor(() => expect(document.querySelector("#status")?.textContent).toBe("自动翻译设置保存失败"));
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(stored.autoTranslation?.enabled).toBe(true);
    toggle.click();
    await vi.waitFor(() => expect(toggle.getAttribute("aria-pressed")).toBe("false"));
    expect(document.querySelector("#status")?.textContent).toBe("");
  });
});

function observeOtherControls(except: HTMLButtonElement): { records: MutationRecord[]; disconnect: () => void } {
  const records: MutationRecord[] = [];
  const observer = new MutationObserver(changes => records.push(...changes));
  for (const control of document.querySelectorAll("button, select")) {
    if (control !== except) observer.observe(control, { attributes: true, childList: true, subtree: true });
  }
  observer.observe(document.body, { attributes: true });
  return { records, disconnect: () => observer.disconnect() };
}

function button(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>("#pageToggle")!;
}

function deferred(): { promise: Promise<unknown>; resolve: (value: unknown) => void } {
  let resolve!: (value: unknown) => void;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
