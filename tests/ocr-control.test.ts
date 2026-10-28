// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { setupOcrControl } from "../src/shared/ocr-control";
import type { OcrStatus } from "../src/shared/ocr";

afterEach(() => { window.dispatchEvent(new Event("pagehide")); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
describe("OCR installation controls", () => {
  it("gates the switch, shows progress, changes the wrench to trash, and disables after removal", async () => {
    document.body.innerHTML = '<button id="toggle" aria-pressed="false"></button><button id="ocrModelAction"></button><p id="ocrDescription"></p><p id="ocrModelStatus"></p><progress id="ocrModelProgress"></progress>';
    let state: OcrStatus = { state: "missing", total: 100, downloaded: 0 };
    const sendMessage = vi.fn(async ({ type }: { type: string }) => {
      if (type === "INSTALL_OCR") state = { ...state, state: "installing", downloaded: 50 };
      if (type === "REMOVE_OCR") state = { ...state, state: "missing", downloaded: 0 };
      return { ok: true, data: state };
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage } });
    const toggle = document.querySelector<HTMLButtonElement>("#toggle")!;
    const button = document.querySelector<HTMLButtonElement>("#ocrModelAction")!;
    const removed = vi.fn();
    setupOcrControl(toggle, removed);
    await vi.waitFor(() => expect(button.title).toContain("安装 OCR"));
    expect(toggle.disabled).toBe(true);
    expect(document.querySelector("#ocrDescription")?.textContent).toContain("20.5 MB");
    button.click();
    await vi.waitFor(() => expect(button.disabled).toBe(true));
    await vi.waitFor(() => expect(document.querySelector("#ocrModelStatus")?.textContent).toContain("50%"));
    expect(toggle.disabled).toBe(true);
    state = { ...state, state: "installed", downloaded: 100 };
    await vi.waitFor(() => expect(button.title).toContain("删除 OCR"), { timeout: 1800 });
    expect(toggle.disabled).toBe(false);
    toggle.setAttribute("aria-pressed", "true");
    button.click();
    await vi.waitFor(() => expect(toggle.disabled).toBe(true));
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(removed).toHaveBeenCalled();
    expect(button.title).toContain("安装 OCR");
  });
  it("keeps installation failures retryable without enabling the feature", async () => {
    document.body.innerHTML = '<input type="checkbox" id="toggle"><button id="ocrModelAction"></button><p id="ocrDescription"></p><p id="ocrModelStatus"></p><progress id="ocrModelProgress"></progress>';
    vi.stubGlobal("chrome", { runtime: { sendMessage: async () => ({ ok: true, data: { state: "error", total: 100, downloaded: 0, error: "网络不可用" } }) } });
    const toggle = document.querySelector<HTMLInputElement>("#toggle")!;
    setupOcrControl(toggle, vi.fn());
    await vi.waitFor(() => expect(document.querySelector("#ocrModelStatus")?.textContent).toContain("网络不可用"));
    expect(toggle.disabled).toBe(true);
    expect(document.querySelector<HTMLButtonElement>("#ocrModelAction")!.disabled).toBe(false);
  });

  it("scopes controls to the supplied menu and pauses polling while it is closed", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<button id="ocrModelAction">Host page</button><div id="menu" class="image-feature-row"><button id="toggle"></button><button id="model"></button><p id="description"></p><p id="status"></p><progress></progress></div>';
    let visible = true;
    const sendMessage = vi.fn(async () => ({ ok: true, data: { state: "installed", total: 100, downloaded: 100 } }));
    vi.stubGlobal("chrome", { runtime: { sendMessage } });
    const control = setupOcrControl(document.querySelector<HTMLButtonElement>("#toggle")!, vi.fn(), {
      helpId: "menu-help", shouldPoll: () => visible,
      elements: {
        action: document.querySelector<HTMLButtonElement>("#model")!,
        description: document.querySelector<HTMLElement>("#description")!,
        status: document.querySelector<HTMLElement>("#status")!,
        progress: document.querySelector<HTMLProgressElement>("progress")!
      }
    });
    await control.refresh();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(document.querySelector("#ocrModelAction")?.textContent).toBe("Host page");
    expect(document.querySelector("#menu-help")).not.toBeNull();
    visible = false; control.pause();
    await vi.advanceTimersByTimeAsync(10000);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    visible = true; await control.refresh();
    expect(sendMessage).toHaveBeenCalledTimes(2);
    control.dispose();
    await vi.advanceTimersByTimeAsync(10000);
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });
});
