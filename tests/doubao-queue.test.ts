import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DoubaoWebConfig } from "../src/shared/types";

const config: DoubaoWebConfig = { type: "doubao-web", id: "doubao", label: "豆包" };
const request = { texts: ["Hello"], targetLang: "zh-CN" };
let doubao: typeof import("../src/background/doubao");
let fetchMock: ReturnType<typeof vi.fn>;
let rules: chrome.declarativeNetRequest.Rule[];

function launch(): Response {
  return Response.json({ code: 0, data: { config: { ttwid: true, web_id: "server-id" }, country: "CN" } });
}

function streamText(): string {
  return "event: json\ndata: " + JSON.stringify({ code: 0, data: { items: [{ index: 0, res: "你好" }] } }) + "\n\nevent: done\n\n";
}

function translated(): Response {
  return new Response(streamText(), { headers: { "Content-Type": "text/event-stream" } });
}

function translate(signal?: AbortSignal): Promise<unknown> {
  return new doubao.DoubaoProvider(config).translateBatch(request, signal).catch((error) => error);
}

/** A slow response that stays alive until the body finishes or is cancelled. */
function delayedStream(duration: number, onFinish: () => void): Response {
  let finish: ReturnType<typeof setTimeout>;
  let heartbeat: ReturnType<typeof setInterval>;
  let closed = false;
  const cleanup = () => {
    clearTimeout(finish);
    clearInterval(heartbeat);
    if (!closed) { closed = true; onFinish(); }
  };
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      heartbeat = setInterval(() => controller.enqueue(new TextEncoder().encode(": ping\n\n")), 10_000);
      finish = setTimeout(() => {
        controller.enqueue(new TextEncoder().encode(streamText()));
        controller.close();
        cleanup();
      }, duration);
    },
    cancel: cleanup
  });
  return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  rules = [];
  vi.stubGlobal("chrome", {
    runtime: { getURL: (path: string) => `chrome-extension://wupage-test${path}` },
    storage: { local: {
      get: vi.fn(async () => ({ "wupage.doubao.device": "123456789123456789" })), set: vi.fn(async () => undefined)
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

describe("Doubao shared queue and recovery", () => {
  it("shares initialization and one full-body network slot across provider instances and probes", async () => {
    const starts: number[] = [];
    let active = 0;
    let maximum = 0;
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      starts.push(Date.now());
      if (!init.body) return launch();
      active++;
      maximum = Math.max(maximum, active);
      expect(rules).toHaveLength(1);
      return delayedStream(1500, () => { active--; });
    });
    const first = translate();
    const second = translate();
    const probe = doubao.checkDoubao();
    await vi.runAllTimersAsync();
    expect(await first).toEqual(["你好"]);
    expect(await second).toEqual(["你好"]);
    expect(await probe).toMatchObject({ state: "ready" });
    expect(fetchMock.mock.calls.filter(([_url, init]) => !init.body)).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(maximum).toBe(1);
    for (let index = 1; index < starts.length; index++) expect(starts[index] - starts[index - 1]).toBeGreaterThanOrEqual(1000);
    expect(active).toBe(0);
    expect(rules).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([[401, "login-required"], [403, "service-rejected"]])
  ("rejects queued ordinary jobs after HTTP %i and permits a deduplicated recovery check", async (httpStatus, errorCode) => {
    fetchMock.mockResolvedValueOnce(launch()).mockResolvedValueOnce(new Response(null, { status: httpStatus as number }));
    const first = translate();
    const waiting = translate();
    await vi.runAllTimersAsync();
    expect(await first).toMatchObject({ errorCode });
    expect(await waiting).toMatchObject({ errorCode });
    expect(await translate()).toMatchObject({ errorCode });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    if (httpStatus === 401) fetchMock.mockResolvedValueOnce(launch());
    fetchMock.mockResolvedValueOnce(translated());
    const probe = doubao.checkDoubao();
    expect(doubao.checkDoubao()).toBe(probe);
    expect(doubao.getDoubaoStatus().state).toBe("checking");
    await vi.runAllTimersAsync();
    expect(await probe).toMatchObject({ state: "ready", checkedAt: Date.now() });
    expect(fetchMock.mock.calls.filter(([_url, init]) => !init.body)).toHaveLength(httpStatus === 401 ? 2 : 1);
    const afterCheck = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(afterCheck);
    fetchMock.mockResolvedValueOnce(translated());
    const manual = translate();
    await vi.runAllTimersAsync();
    expect(await manual).toEqual(["你好"]);
    expect(fetchMock).toHaveBeenCalledTimes(afterCheck + 1);
  });

  it("honors Retry-After, rejects waiting jobs, and only runs new manual work after cooldown", async () => {
    fetchMock.mockResolvedValueOnce(launch()).mockResolvedValueOnce(new Response(null, {
      status: 429, headers: { "Retry-After": "120" }
    }));
    const first = translate();
    const waiting = translate();
    await vi.runAllTimersAsync();
    expect(await first).toMatchObject({ errorCode: "rate-limited", retryAfterMs: 120_000 });
    expect(await waiting).toMatchObject({ errorCode: "rate-limited" });
    expect(doubao.getDoubaoStatus().retryAt).toBe(Date.now() + 120_000);
    expect(await doubao.checkDoubao()).toMatchObject({ state: "rate-limited", checkedAt: Date.now() });
    await vi.advanceTimersByTimeAsync(119_999);
    expect(await translate()).toMatchObject({ errorCode: "rate-limited", retryAfterMs: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockResolvedValueOnce(translated());
    const manual = translate();
    await vi.runAllTimersAsync();
    expect(await manual).toEqual(["你好"]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each(["invalid", "5", "-1"])("uses at least the default cooldown for Retry-After %s", async (value) => {
    fetchMock.mockResolvedValueOnce(launch()).mockResolvedValueOnce(new Response(null, { status: 429, headers: { "Retry-After": value } }));
    const pending = translate();
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ errorCode: "rate-limited", retryAfterMs: 60_000 });
    expect(doubao.getDoubaoStatus().retryAt).toBe(Date.now() + 60_000);
  });

  it("accepts a future Retry-After HTTP date", async () => {
    const until = Date.now() + 180_000;
    fetchMock.mockResolvedValueOnce(launch()).mockResolvedValueOnce(new Response(null, {
      status: 429, headers: { "Retry-After": new Date(until).toUTCString() }
    }));
    const pending = translate();
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ errorCode: "rate-limited", retryAfterMs: until - Date.now() });
    expect(doubao.getDoubaoStatus().retryAt).toBe(until);
  });

  it("does not cancel shared launch while another caller still needs it", async () => {
    let completeLaunch!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { completeLaunch = resolve; }))
      .mockResolvedValueOnce(translated());
    const controller = new AbortController();
    const first = translate(controller.signal);
    const second = translate();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    controller.abort();
    expect(await first).toMatchObject({ errorCode: "cancelled" });
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(false);
    completeLaunch(launch());
    await vi.runAllTimersAsync();
    expect(await second).toEqual(["你好"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("removes a cancelled queued job before it can send source text", async () => {
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => !init.body ? launch() : delayedStream(5000, () => undefined));
    const first = translate();
    await vi.advanceTimersByTimeAsync(1000);
    const controller = new AbortController();
    const waiting = translate(controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    controller.abort();
    expect(await waiting).toMatchObject({ errorCode: "cancelled" });
    await vi.runAllTimersAsync();
    expect(await first).toEqual(["你好"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(rules).toEqual([]);
  });

  it("records a new checkedAt on failed checks and does not mistake launch for ready", async () => {
    fetchMock.mockResolvedValueOnce(launch()).mockResolvedValueOnce(translated());
    const first = doubao.checkDoubao();
    await vi.advanceTimersByTimeAsync(0);
    expect(doubao.getDoubaoStatus().state).toBe("checking");
    await vi.runAllTimersAsync();
    const ready = await first;
    expect(ready.state).toBe("ready");
    await vi.advanceTimersByTimeAsync(30_000);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 403 }));
    const second = doubao.checkDoubao();
    await vi.runAllTimersAsync();
    expect(await second).toMatchObject({ state: "service-rejected", checkedAt: Date.now() });
    expect((await second).checkedAt).toBeGreaterThan(ready.checkedAt!);
  });
});

describe("Doubao physical and logical deadlines", () => {
  it.each(["headers", "idle", "total"])("cancels a %s timeout and releases the full-body queue slot and DNR rule", async (stage) => {
    const began = Date.now();
    const cancel = vi.fn();
    fetchMock.mockResolvedValueOnce(launch());
    if (stage === "headers") fetchMock.mockImplementationOnce(() => new Promise<Response>(() => undefined));
    else if (stage === "idle") fetchMock.mockImplementationOnce(async () => new Response(new ReadableStream({ cancel }), {
      headers: { "Content-Type": "text/event-stream" }
    }));
    else fetchMock.mockImplementationOnce(async () => delayedStream(90_000, cancel));
    const pending = translate();
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ errorCode: "timeout" });
    expect(Date.now() - began).toBe(stage === "headers" ? 26_000 : stage === "idle" ? 21_000 : 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(true);
    if (stage !== "headers") expect(cancel).toHaveBeenCalledTimes(1);
    expect(rules).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    fetchMock.mockResolvedValueOnce(translated());
    const later = translate();
    await vi.runAllTimersAsync();
    expect(await later).toEqual(["你好"]);
  });

  it("counts queue waits and prior groups in 110 seconds and never sends the expired remainder", async () => {
    const began = Date.now();
    let finished = 0;
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => !init.body ? launch()
      : delayedStream(55_000, () => { finished++; }));
    const first = new doubao.DoubaoProvider(config).translateBatch({ ...request, texts: ["a".repeat(2000), "b".repeat(2000)] })
      .catch((error) => error);
    const second = translate();
    await vi.advanceTimersByTimeAsync(110_000);
    expect(await first).toMatchObject({ errorCode: "timeout" });
    expect(await second).toMatchObject({ errorCode: "timeout" });
    expect(Date.now() - began).toBe(110_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(finished).toBe(2);
    expect(rules).toEqual([]);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels the shared initializer after its last caller leaves and can initialize again", async () => {
    fetchMock.mockImplementationOnce(() => new Promise<Response>(() => undefined));
    const controller = new AbortController();
    const first = translate(controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    expect(await first).toMatchObject({ errorCode: "cancelled" });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    expect(rules).toEqual([]);
    fetchMock.mockResolvedValueOnce(launch()).mockResolvedValueOnce(translated());
    const second = translate();
    await vi.runAllTimersAsync();
    expect(await second).toEqual(["你好"]);
    expect(fetchMock.mock.calls.filter(([_url, init]) => !init.body)).toHaveLength(2);
  });
});
