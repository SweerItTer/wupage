// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { sendRuntimeRequest } from "../src/content/runtime";
import { ProviderError, runtimeErrorResponse } from "../src/shared/errors";
import { sendRuntimeMessage, sendTabMessage } from "../src/shared/messaging";
import type { RuntimeRequest } from "../src/shared/types";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); document.body.replaceChildren(); });

describe("local inference runtime host", () => {
  it("accepts download heartbeats only from internal extension pages", async () => {
    vi.stubEnv("MODE", "firefox");
    const addListener = vi.fn();
    vi.stubGlobal("chrome", { runtime: { id: "test", getURL: (path: string) => `moz-extension://test/${path}`, onMessage: { addListener } } });
    await import("../src/background/offscreen");
    const receive = addListener.mock.calls[0][0];
    const sender = { id: "test", url: "moz-extension://test/ocr-offscreen.html" };
    const hold = { target: "inference-lifetime" };
    expect(receive(hold, { ...sender, tab: { id: 1 } })).toBeUndefined();
    expect(receive(hold, { ...sender, id: "other-extension" })).toBeUndefined();
    await expect(receive(hold, sender)).resolves.toBeNull();
  });

  it("keeps Chromium's shared offscreen document and deduplicates creation", async () => {
    const createDocument = vi.fn(async () => undefined);
    vi.stubGlobal("chrome", { offscreen: { hasDocument: async () => false, createDocument, Reason: { IFRAME_SCRIPTING: "IFRAME_SCRIPTING", WORKERS: "WORKERS" } } });
    const { ensureOffscreenDocument } = await import("../src/background/offscreen");
    await Promise.all([ensureOffscreenDocument(), ensureOffscreenDocument()]);
    expect(createDocument).toHaveBeenCalledOnce();
    expect(createDocument.mock.calls[0]).toEqual([expect.objectContaining({ url: "ocr-offscreen.html" })]);
  });

  it("waits for Firefox's runtime frame to load and reuses it", async () => {
    vi.stubEnv("MODE", "firefox");
    vi.stubGlobal("chrome", { runtime: { getURL: (path: string) => `moz-extension://test/${path}`, onMessage: { addListener: vi.fn() } } });
    const { ensureOffscreenDocument } = await import("../src/background/offscreen");
    let ready = false;
    const requests = Promise.all([ensureOffscreenDocument(), ensureOffscreenDocument()]).then(() => { ready = true; });
    await Promise.resolve();
    expect(ready).toBe(false);
    const frames = document.querySelectorAll("iframe");
    expect(frames).toHaveLength(1);
    expect(frames[0].hidden).toBe(true);
    frames[0].dispatchEvent(new Event("load"));
    await requests;
    await ensureOffscreenDocument();
    expect(document.querySelectorAll("iframe")).toHaveLength(1);
  });

  it("removes a failed Firefox frame so a later request can retry", async () => {
    vi.stubEnv("MODE", "firefox");
    vi.stubGlobal("chrome", { runtime: { getURL: (path: string) => `moz-extension://test/${path}`, onMessage: { addListener: vi.fn() } } });
    const { ensureOffscreenDocument } = await import("../src/background/offscreen");
    const first = ensureOffscreenDocument();
    const failure = expect(first).rejects.toThrow("加载失败");
    document.querySelector("iframe")!.dispatchEvent(new Event("error"));
    await failure;
    expect(document.querySelector("iframe")).toBeNull();
    const retry = ensureOffscreenDocument();
    document.querySelector("iframe")!.dispatchEvent(new Event("load"));
    await retry;
  });
});

describe("provider errors across runtime messaging", () => {
  const callers = [
    ["settings and popup", (request: RuntimeRequest) => sendRuntimeMessage(request)],
    ["content scripts", (request: RuntimeRequest) => sendRuntimeRequest(request)],
    ["tab messages", (request: RuntimeRequest) => sendTabMessage(17, request)]
  ] as const;

  describe.each(callers)("%s", (_label, send) => {
    it.each([
      new ProviderError("豆包暂时限流", "rate-limited", 45_000),
      new ProviderError("需要重新登录豆包", "login-required")
    ])("preserves error details: $errorCode", async (expected) => {
      const envelope = JSON.parse(JSON.stringify(runtimeErrorResponse(expected)));
      vi.stubGlobal("chrome", {
        runtime: { id: "test-extension", sendMessage: vi.fn().mockResolvedValue(envelope) },
        tabs: { sendMessage: vi.fn().mockResolvedValue(envelope) }
      });
      const error = await send({ type: "CHECK_DOUBAO" }).catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(ProviderError);
      expect(error).toMatchObject({ message: expected.message, errorCode: expected.errorCode });
      expect((error as ProviderError).retryAfterMs).toBe(expected.retryAfterMs);
    });
  });
});
