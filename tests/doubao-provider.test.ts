import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DoubaoWebConfig, TranslateBatchRequest } from "../src/shared/types";

const config: DoubaoWebConfig = { type: "doubao-web", id: "doubao", label: "豆包" };
const request: TranslateBatchRequest = { texts: ["Hello", "World"], sourceLang: "en", targetLang: "zh-CN" };
let doubao: typeof import("../src/background/doubao");
let fetchMock: ReturnType<typeof vi.fn>;
let rules: chrome.declarativeNetRequest.Rule[];
let stored: Record<string, unknown>;

function launch(config: Record<string, unknown> = { ttwid: true, web_id: "server-device" }): Response {
  return Response.json({ code: 0, data: { config, country: "CN" } });
}

function sse(items: Array<{ index: number; res: string; detect_lang?: string }>): Response {
  return new Response("event: json\ndata: " + JSON.stringify({ code: 0, data: { items } }) + "\n\nevent: done\n\n", {
    headers: { "Content-Type": "text/event-stream; charset=utf-8" }
  });
}

function translation(values: string[]): Response {
  return sse(values.map((res, index) => ({ index, res, detect_lang: "en" })));
}

async function outcome(texts = request.texts): Promise<unknown> {
  const result = new doubao.DoubaoProvider(config).translateBatch({ ...request, texts }).catch((error) => error);
  await vi.runAllTimersAsync();
  return result;
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  rules = [];
  stored = {};
  vi.stubGlobal("chrome", {
    runtime: { getURL: (path: string) => `chrome-extension://wupage-test${path}` },
    storage: { local: {
      get: vi.fn(async (key: string) => ({ [key]: stored[key] })),
      set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(stored, values); })
    } },
    declarativeNetRequest: {
      getSessionRules: vi.fn(async () => [...rules]),
      updateSessionRules: vi.fn(async (options: Parameters<typeof chrome.declarativeNetRequest.updateSessionRules>[0]) => {
        rules = rules.filter((rule) => !options.removeRuleIds?.includes(rule.id));
        rules.push(...(options.addRules ?? []));
      })
    }
  });
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  doubao = await import("../src/background/doubao");
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Doubao web provider", () => {
  it("uses browser credentials with fixed endpoints and a native ordered article array", async () => {
    fetchMock.mockResolvedValueOnce(launch()).mockResolvedValueOnce(sse([
      { index: 1, res: "世界" }, { index: 0, res: "你好" }
    ]));
    expect(await outcome()).toEqual(["你好", "世界"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [launchUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [articleUrl, article] = fetchMock.mock.calls[1] as [string, RequestInit];
    const launchAddress = new URL(launchUrl);
    const articleAddress = new URL(articleUrl);
    expect(launchAddress.origin + launchAddress.pathname).toBe("https://www.doubao.com/alice/user/launch");
    expect(articleAddress.origin + articleAddress.pathname).toBe("https://www.doubao.com/samantha/plugin/stream_article_translate");
    expect(init).toMatchObject({ method: "POST", credentials: "include", redirect: "error" });
    expect(init.body).toBeUndefined();
    expect(init.headers).toMatchObject({ "Agw-Js-Conv": "str", "Content-Type": "application/json" });
    expect(article).toMatchObject({ method: "POST", credentials: "include", redirect: "error" });
    expect(JSON.parse(String(article.body))).toEqual({ raw_text: ["Hello", "World"], target_lang: "zh", translate_service: "1" });
    expect(new Headers(article.headers).has("Cookie")).toBe(false);
    expect(launchAddress.searchParams.get("device_id")).toBe("0");
    expect(articleAddress.searchParams.get("device_id")).toBe("server-device");
    expect(articleAddress.searchParams.get("region")).toBe("CN");
    expect(articleAddress.searchParams.get("sys_region")).toBe("CN");
    expect(articleAddress.searchParams.get("tea_uuid")).toMatch(/^\d{18}$/);
    expect(articleAddress.searchParams.get("web_id")).toBe(articleAddress.searchParams.get("tea_uuid"));
    expect(launchAddress.searchParams.get("web_tab_id")).toBe(articleAddress.searchParams.get("web_tab_id"));
    expect(Object.keys(stored)).toEqual(["wupage.doubao.device"]);
    expect(stored["wupage.doubao.device"]).toBe(articleAddress.searchParams.get("web_id"));
    expect(rules).toEqual([]);
  });

  it("uses device_id zero for anonymous launch and still validates a real translation", async () => {
    stored["wupage.doubao.device"] = "123456789123456789";
    fetchMock.mockResolvedValueOnce(launch({ ttwid: false, web_id: "not-a-login" }))
      .mockResolvedValueOnce(translation(["你好", "世界"]));
    expect(await outcome()).toEqual(["你好", "世界"]);
    expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get("device_id")).toBe("0");
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it("repairs only missing slots once, preserving duplicate inputs and original ordering", async () => {
    fetchMock.mockResolvedValueOnce(launch())
      .mockResolvedValueOnce(sse([{ index: 2, res: "丙" }, { index: 0, res: "甲" }]))
      .mockResolvedValueOnce(translation(["乙"]));
    expect(await outcome(["same", "same", "other"])).toEqual(["甲", "乙", "丙"]);
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).raw_text).toEqual(["same"]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries a transient article failure once", async () => {
    fetchMock.mockResolvedValueOnce(launch()).mockRejectedValueOnce(new TypeError("network offline"))
      .mockResolvedValueOnce(translation(["你好", "世界"]));
    expect(await outcome()).toEqual(["你好", "世界"]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each(["missing-then-5xx", "5xx-then-missing"])("shares one additional attempt between repair and retry: %s", async (order) => {
    fetchMock.mockResolvedValueOnce(launch());
    if (order === "missing-then-5xx") {
      fetchMock.mockResolvedValueOnce(sse([{ index: 0, res: "你好" }])).mockResolvedValueOnce(new Response(null, { status: 503 }));
    } else {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValueOnce(sse([{ index: 0, res: "你好" }]));
    }
    expect(await outcome()).toMatchObject({ errorCode: order === "missing-then-5xx" ? "network-error" : "incomplete" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not replenish retry budget for a later physical group", async () => {
    fetchMock.mockResolvedValueOnce(launch()).mockResolvedValueOnce(new Response(null, { status: 502 }))
      .mockResolvedValueOnce(translation(["第一段"]))
      .mockResolvedValueOnce(new Response(null, { status: 502 }));
    expect(await outcome(["a".repeat(2000), "b".repeat(2000)])).toMatchObject({ errorCode: "network-error" });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it.each([[401, "login-required"], [403, "service-rejected"], [429, "rate-limited"], [408, "timeout"]])
  ("does not retry HTTP %i", async (status, errorCode) => {
    fetchMock.mockResolvedValueOnce(launch()).mockResolvedValueOnce(new Response(null, { status: status as number }));
    expect(await outcome()).toMatchObject({ errorCode });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(rules).toEqual([]);
  });

  it.each([
    { code: 710012000, message: "private account information" },
    { code: 0, data: null },
    { code: "0", data: { config: {} } }
  ])("propagates initialization failure without sending article text: %j", async (payload) => {
    fetchMock.mockResolvedValueOnce(Response.json(payload));
    const result = await outcome();
    expect(result).toMatchObject({ errorCode: payload.code === 710012000 ? "login-required" : "protocol-changed" });
    expect(String(result)).not.toContain("private account information");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects HTML login pages without exposing the response content", async () => {
    fetchMock.mockResolvedValueOnce(launch()).mockResolvedValueOnce(new Response("<html>private account information</html>", {
      headers: { "Content-Type": "text/html" }
    }));
    const result = await outcome();
    expect(result).toMatchObject({ errorCode: "protocol-changed" });
    expect(String(result)).not.toContain("private account information");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps a JSON business error without treating it as malformed SSE or retrying", async () => {
    fetchMock.mockResolvedValueOnce(launch()).mockResolvedValueOnce(Response.json({ code: 710022002 }));
    expect(await outcome()).toMatchObject({ errorCode: "service-rejected" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("splits long paragraphs and rejoins their exact source boundaries", async () => {
    let translated = 0;
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      if (!init.body) return launch();
      const { raw_text } = JSON.parse(String(init.body)) as { raw_text: string[] };
      expect(raw_text.reduce((sum, text) => sum + text.length, 0)).toBeLessThanOrEqual(2000);
      expect(raw_text.length).toBeLessThanOrEqual(10);
      return translation(raw_text.map(() => `节${++translated}`));
    });
    expect(await outcome(["a".repeat(4001), " \n", "Hello"])).toEqual(["节1节2节3", " \n", "节4"]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("keeps empty and punctuation-only paragraphs local", async () => {
    expect(await outcome(["", " \n", "…", "⟪WUPAGE0⟫"])).toEqual(["", " \n", "…", "⟪WUPAGE0⟫"]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(chrome.storage.local.get).not.toHaveBeenCalled();
  });

  it("rejects unsupported targets before storage or network access", async () => {
    const result = new doubao.DoubaoProvider(config).translateBatch({ ...request, targetLang: "xx" }).catch((error) => error);
    expect(await result).toMatchObject({ errorCode: "unsupported-language" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(chrome.storage.local.get).not.toHaveBeenCalled();
  });

  it("keeps the Chromium experiment unavailable in Firefox", async () => {
    chrome.runtime.getURL = () => "moz-extension://test-uuid/";
    const provider = new doubao.DoubaoProvider(config);
    expect(provider.validateConfig().ok).toBe(false);
    expect(await provider.translateBatch(request).catch((error) => error)).toMatchObject({ errorCode: "unsupported-browser" });
    expect(await doubao.checkDoubao()).toMatchObject({ state: "unsupported-browser" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["invalid-utf8", "oversized-body"])("stops bounded response consumption for %s", async (kind) => {
    const data = kind === "invalid-utf8" ? Uint8Array.of(0xC3, 0x28) : new Uint8Array(1_000_001);
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(data); }, cancel });
    fetchMock.mockResolvedValueOnce(launch()).mockResolvedValueOnce(new Response(body, { headers: { "Content-Type": "text/event-stream" } }));
    expect(await outcome()).toMatchObject({ errorCode: "protocol-changed" });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(rules).toEqual([]);
  });

  it("decodes UTF-8 code points split between response chunks", async () => {
    const text = "event: json\ndata: " + JSON.stringify({ code: 0, data: { items: [{ index: 0, res: "你好🌏" }] } }) + "\n\n";
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      for (const byte of new TextEncoder().encode(text)) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    } });
    fetchMock.mockResolvedValueOnce(launch()).mockResolvedValueOnce(new Response(body, { headers: { "Content-Type": "text/event-stream" } }));
    expect(await outcome(["Hello"])).toEqual(["你好🌏"]);
  });
});
