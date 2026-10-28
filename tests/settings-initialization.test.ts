// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/shared/defaults";
import type { RuntimeRequest, RuntimeResponse } from "../src/shared/types";

afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
  document.documentElement.replaceChildren();
});

describe.each(["popup", "options"] as const)("%s image translation initialization", (page) => {
  function loadPage(): Promise<unknown> {
    return page === "popup" ? import("../src/popup/index") : import("../src/options/index");
  }

  function mount(): { feature: HTMLElement; toggle: HTMLButtonElement | HTMLInputElement; control: HTMLElement } {
    document.open();
    document.write(readFileSync(resolve(process.cwd(), `${page}.html`), "utf8"));
    document.close();
    const style = document.createElement("style");
    style.textContent = readFileSync(resolve(process.cwd(), `src/${page}/styles.css`), "utf8")
      + readFileSync(resolve(process.cwd(), "src/shared/ocr-control.css"), "utf8");
    document.head.append(style);
    return {
      feature: document.querySelector<HTMLElement>(".image-feature")!,
      toggle: document.querySelector<HTMLButtonElement | HTMLInputElement>(page === "popup" ? "#imageTranslation" : "#imageTranslationEnabled")!,
      control: document.querySelector<HTMLElement>(page === "popup" ? "#imageTranslation" : ".image-feature .setting-toggle-control")!
    };
  }

  function mockRuntime(settingsResponse: Promise<RuntimeResponse>): ReturnType<typeof vi.fn> {
    const sendMessage = vi.fn(async (request: RuntimeRequest): Promise<RuntimeResponse> => {
      if (request.type === "GET_SETTINGS") return settingsResponse;
      if (request.type === "GET_OCR_STATUS") {
        return { ok: true, data: { state: "installed", total: 100, downloaded: 100 } };
      }
      return { ok: true };
    });
    vi.stubGlobal("chrome", {
      runtime: { sendMessage },
      tabs: {
        query: vi.fn(async () => [{ id: 1, url: "https://example.com/article" }]),
        sendMessage: vi.fn(async () => ({ ok: true, data: { enabled: false, translated: false } }))
      }
    });
    return sendMessage;
  }

  it.each([true, false])("reveals the saved value %s after a delayed settings read", async (enabled) => {
    const { feature, toggle, control } = mount();
    let finishSettings!: (response: RuntimeResponse) => void;
    const pending = new Promise<RuntimeResponse>((resolve) => { finishSettings = resolve; });
    const sendMessage = mockRuntime(pending);
    expect(getComputedStyle(control).visibility).toBe("hidden");
    expect(toggle.disabled).toBe(true);
    await loadPage();
    expect(feature.getAttribute("aria-busy")).toBe("true");
    expect(getComputedStyle(control).visibility).toBe("hidden");
    if (toggle instanceof HTMLButtonElement) expect(toggle.hasAttribute("aria-pressed")).toBe(false);

    finishSettings({ ok: true, data: { ...structuredClone(DEFAULT_SETTINGS), imageTranslationEnabled: enabled } });
    await vi.waitFor(() => {
      expect(feature.hasAttribute("data-loading")).toBe(false);
      expect(getComputedStyle(control).visibility).toBe("visible");
      expect(toggle.disabled).toBe(false);
    });
    if (toggle instanceof HTMLInputElement) expect(toggle.checked).toBe(enabled);
    else expect(toggle.getAttribute("aria-pressed")).toBe(String(enabled));
    expect(feature.hasAttribute("aria-busy")).toBe(false);
    expect(sendMessage.mock.calls.some(([request]) => request.type === "SAVE_SETTINGS")).toBe(false);
  });

  it("does not present a false off state if reading settings fails", async () => {
    const { toggle, control } = mount();
    mockRuntime(Promise.resolve({ ok: false, error: "设置读取失败" }));
    await loadPage();
    await vi.waitFor(() => expect(document.querySelector("#status")?.textContent).toBe("设置读取失败"));
    expect(getComputedStyle(control).visibility).toBe("hidden");
    expect(toggle.disabled).toBe(true);
  });
});
