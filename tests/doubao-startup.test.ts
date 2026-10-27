import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DoubaoWebConfig } from "../src/shared/types";

const config: DoubaoWebConfig = { type: "doubao-web", id: "doubao", label: "豆包" };
let doubao: typeof import("../src/background/doubao");
let fetchMock: ReturnType<typeof vi.fn>;
let rules: chrome.declarativeNetRequest.Rule[];

function launch(device = "server-device"): Response {
  return Response.json({ code: 0, data: { config: { ttwid: true, web_id: device }, country: "CN" } });
}

function translated(text = "你好"): Response {
  return new Response(`event: json\ndata: ${JSON.stringify({ code: 0, data: { items: [{ index: 0, res: text }] } })}\n\nevent: done\n\n`, {
    headers: { "Content-Type": "text/event-stream" }
  });
}

function translate(text = "Hello", signal?: AbortSignal): Promise<unknown> {
  return new doubao.DoubaoProvider(config).translateBatch({ texts: [text], targetLang: "zh-CN" }, signal)
    .catch((error: unknown) => error);
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-27T00:00:00Z"));
  rules = [];
  vi.stubGlobal("chrome", {
    runtime: { getURL: (path: string) => `chrome-extension://wupage-test${path}` },
    storage: { local: {
      get: vi.fn(async () => ({ "wupage.doubao.device": "123456789123456789" })),
      set: vi.fn(async () => undefined)
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

describe("Doubao startup and fresh user requests", () => {
  it("translates directly on cold start and records successful article health without a settings check", async () => {
    fetchMock.mockResolvedValueOnce(launch()).mockResolvedValueOnce(translated());
    const result = translate("Actual page paragraph");
    await vi.runAllTimersAsync();

    expect(await result).toEqual(["你好"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).raw_text).toEqual(["Actual page paragraph"]);
    expect(doubao.getDoubaoStatus()).toMatchObject({ state: "ready", checkedAt: Date.now() });
    expect(rules).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([[401, "login-required"], [403, "service-rejected"]] as const)
  ("recovers a new ordinary request after HTTP %i while keeping old queued work failed", async (httpStatus, errorCode) => {
    let resumeOld!: () => void;
    const oldGate = new Promise<void>((resolve) => { resumeOld = resolve; });
    // The signal is created before failure, just as it is when waiting in the
    // shared translation scheduler before reaching the Doubao provider.
    const old = doubao.withDoubaoDeadline(async (signal) => {
      await oldGate;
      return translate("Old queued paragraph", signal);
    }).catch((error: unknown) => error);

    fetchMock.mockResolvedValueOnce(launch("stale-device"))
      .mockResolvedValueOnce(new Response(null, { status: httpStatus }));
    const first = translate("Failed paragraph");
    await vi.advanceTimersByTimeAsync(1000);
    expect(await first).toMatchObject({ errorCode });
    // The failed task does not silently retry an authorization/rejection error.
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockResolvedValueOnce(launch("refreshed-device"))
      .mockResolvedValueOnce(translated("新的第一段"))
      .mockResolvedValueOnce(translated("新的第二段"));
    const freshA = translate("Fresh paragraph A");
    const freshB = translate("Fresh paragraph B");
    await vi.advanceTimersByTimeAsync(5000);
    const freshResults = await Promise.all([freshA, freshB]);
    const recoveredStatus = doubao.getDoubaoStatus();
    const callsBeforeOld = fetchMock.mock.calls.length;

    resumeOld();
    await vi.advanceTimersByTimeAsync(0);
    const oldResult = await old;

    expect(freshResults).toEqual([["新的第一段"], ["新的第二段"]]);
    expect(recoveredStatus.state).toBe("ready");
    expect(fetchMock.mock.calls.filter(([_url, init]) => !init.body)).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls.slice(3).map(([url]) => new URL(url).searchParams.get("device_id")))
      .toEqual(["refreshed-device", "refreshed-device"]);
    expect(oldResult).toMatchObject({ errorCode });
    expect(fetchMock.mock.calls).toHaveLength(callsBeforeOld);
    expect(doubao.getDoubaoStatus()).toEqual(recoveredStatus);
    expect(rules).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps a real rate limit in force for new requests and checks until cooldown expires", async () => {
    fetchMock.mockResolvedValueOnce(launch())
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "Retry-After": "60" } }));
    const first = translate();
    await vi.runAllTimersAsync();
    expect(await first).toMatchObject({ errorCode: "rate-limited" });
    expect(await translate()).toMatchObject({ errorCode: "rate-limited" });
    expect(await doubao.checkDoubao()).toMatchObject({ state: "rate-limited" });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockResolvedValueOnce(translated());
    const retry = translate();
    await vi.runAllTimersAsync();
    expect(await retry).toEqual(["你好"]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(doubao.getDoubaoStatus()).toMatchObject({ state: "ready" });
    expect(doubao.getDoubaoStatus().retryAt).toBeUndefined();
  });

  it("recovers a transient launch failure once using the original text and normal request spacing", async () => {
    const starts: number[] = [];
    fetchMock.mockImplementationOnce(async () => {
      starts.push(Date.now());
      throw new TypeError("connection interrupted");
    }).mockImplementationOnce(async () => { starts.push(Date.now()); return launch(); })
      .mockImplementationOnce(async () => { starts.push(Date.now()); return translated(); });
    const result = translate("Original page text");
    await vi.runAllTimersAsync();

    expect(await result).toEqual(["你好"]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.filter(([_url, init]) => !init.body)).toHaveLength(2);
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).raw_text).toEqual(["Original page text"]);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(1000);
    expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(1000);
    expect(doubao.getDoubaoStatus()).toMatchObject({ state: "ready" });
    expect(rules).toEqual([]);
  });

  it("shares the launch retry budget with article retries instead of multiplying attempts", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(launch())
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    const result = translate();
    await vi.runAllTimersAsync();

    expect(await result).toMatchObject({ errorCode: "network-error" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.filter(([_url, init]) => init.body)).toHaveLength(1);
    expect(rules).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops a stalled launch retry on timeout without a third attempt or delayed article", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("connection interrupted"))
      .mockImplementationOnce(() => new Promise<Response>(() => undefined));
    const result = translate();
    await vi.runAllTimersAsync();

    expect(await result).toMatchObject({ errorCode: "timeout" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([_url, init]) => !init.body)).toBe(true);
    expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(true);
    expect(rules).toEqual([]);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("replaces a transient article error status after its bounded retry succeeds", async () => {
    fetchMock.mockResolvedValueOnce(launch())
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(translated());
    const result = translate();
    await vi.runAllTimersAsync();

    expect(await result).toEqual(["你好"]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(doubao.getDoubaoStatus()).toMatchObject({ state: "ready", checkedAt: Date.now() });
  });

  it("preserves a timeout while cancelling launch and lets an immediate fresh task initialize again", async () => {
    const { ProviderError } = await import("../src/shared/errors");
    fetchMock.mockImplementationOnce(() => new Promise<Response>(() => undefined))
      .mockResolvedValueOnce(launch())
      .mockResolvedValueOnce(translated());
    const parent = new AbortController();
    const first = doubao.withDoubaoDeadline((signal) => new doubao.DoubaoProvider(config).translateBatch({
      texts: ["Timed out paragraph"], targetLang: "zh-CN"
    }, signal), parent.signal).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    parent.abort(new ProviderError("Task deadline reached", "timeout"));
    expect(await first).toMatchObject({ errorCode: "timeout" });
    // Start immediately, before the abandoned initializer's final Promise
    // continuations run. A new task must not inherit that cancelled Promise.
    const fresh = translate("Fresh paragraph after timeout");
    await vi.advanceTimersByTimeAsync(0);
    expect(doubao.getDoubaoStatus()).toMatchObject({ state: "timeout" });

    await vi.runAllTimersAsync();
    expect(await fresh).toEqual(["你好"]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(doubao.getDoubaoStatus()).toMatchObject({ state: "ready" });
    expect(rules).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
