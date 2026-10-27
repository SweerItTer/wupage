import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let compatibility: typeof import("../src/background/doubao-compatibility");
let rules: chrome.declarativeNetRequest.Rule[];
let updateRules: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.resetModules();
  rules = [];
  updateRules = vi.fn(async (options: Parameters<typeof chrome.declarativeNetRequest.updateSessionRules>[0]) => {
    rules = rules.filter((rule) => !options.removeRuleIds?.includes(rule.id));
    rules.push(...(options.addRules ?? []));
  });
  vi.stubGlobal("chrome", {
    runtime: { getURL: (path: string) => `chrome-extension://wupage-test${path}` },
    declarativeNetRequest: { getSessionRules: vi.fn(async () => [...rules]), updateSessionRules: updateRules }
  });
  compatibility = await import("../src/background/doubao-compatibility");
});

afterEach(() => vi.unstubAllGlobals());

describe("Doubao narrowly scoped origin compatibility", () => {
  it.each([
    "https://www.doubao.com/alice/user/launch",
    "https://www.doubao.com/samantha/plugin/stream_article_translate"
  ])("holds only the exact endpoint for its own POST XHR while the response is consumed: %s", async (endpoint) => {
    const result = await compatibility.withDoubaoCompatibility(endpoint + "?device_id=123", async () => {
      expect(rules).toHaveLength(1);
      const rule = rules[0];
      expect(rule.id).toBeGreaterThanOrEqual(110_000);
      expect(rule.id).toBeLessThanOrEqual(110_015);
      expect(rule.condition).toMatchObject({
        initiatorDomains: ["wupage-test"], requestMethods: ["post"], resourceTypes: ["xmlhttprequest"],
        isUrlFilterCaseSensitive: true
      });
      expect(rule.action.requestHeaders).toEqual([{
        header: "origin", operation: "set", value: "chrome-extension://dbjibobgilijgolhjdcbdebjhejelffo"
      }]);
      const matches = new RegExp(rule.condition.regexFilter!);
      expect(matches.test(endpoint)).toBe(true);
      expect(matches.test(endpoint + "?device_id=123&language=zh")).toBe(true);
      for (const other of [endpoint + "/", endpoint + "evil", endpoint + "#fragment",
        endpoint.replace("https:", "http:"), endpoint.replace("www.doubao.com", "wwwXdoubaoXcom"),
        endpoint.replace("www.doubao.com", "other.example"), "https://www.doubao.com/samantha/chat/completion"]) {
        expect(matches.test(other)).toBe(false);
      }
      await Promise.resolve();
      expect(rules).toHaveLength(1);
      return "finished reading";
    });
    expect(result).toBe("finished reading");
    expect(rules).toEqual([]);
  });

  it("keeps one reference until the last overlapping reader has finished", async () => {
    let finishFirst!: () => void;
    let finishSecond!: () => void;
    const firstBody = new Promise<void>((resolve) => { finishFirst = resolve; });
    const secondBody = new Promise<void>((resolve) => { finishSecond = resolve; });
    let started = 0;
    const endpoint = compatibility.DOUBAO_TRANSLATE_ENDPOINT;
    const first = compatibility.withDoubaoCompatibility(endpoint, async () => { started++; await firstBody; });
    const second = compatibility.withDoubaoCompatibility(endpoint, async () => { started++; await secondBody; });
    await vi.waitFor(() => expect(started).toBe(2));
    expect(updateRules.mock.calls.filter(([change]) => change.addRules?.length)).toHaveLength(1);
    finishFirst();
    await first;
    expect(rules).toHaveLength(1);
    finishSecond();
    await second;
    expect(rules).toEqual([]);
  });

  it("recovers only its reserved rules after worker restart and preserves Ollama rules", async () => {
    rules = [{ id: 100_000 }, { id: 104_999 }, { id: 110_000 }, { id: 110_015 }, { id: 110_016 }, { id: 42 }] as chrome.declarativeNetRequest.Rule[];
    await compatibility.initializeDoubaoCompatibility();
    expect(rules.map((rule) => rule.id)).toEqual([100_000, 104_999, 110_016, 42]);
    await compatibility.initializeDoubaoCompatibility();
    expect(updateRules).toHaveBeenCalledTimes(1);
  });

  it("releases rules after body failure and allows a later request", async () => {
    await expect(compatibility.withDoubaoCompatibility(compatibility.DOUBAO_TRANSLATE_ENDPOINT, async () => {
      throw new DOMException("Cancelled", "AbortError");
    })).rejects.toThrow("Cancelled");
    expect(rules).toEqual([]);
    await expect(compatibility.withDoubaoCompatibility(compatibility.DOUBAO_LAUNCH_ENDPOINT, async () => "ok"))
      .resolves.toBe("ok");
    expect(rules).toEqual([]);
  });

  it("never runs a request when installation is denied", async () => {
    updateRules.mockRejectedValueOnce(new Error("Permission denied"));
    const send = vi.fn();
    await expect(compatibility.withDoubaoCompatibility(compatibility.DOUBAO_TRANSLATE_ENDPOINT, send))
      .rejects.toMatchObject({ errorCode: "permission-required" });
    expect(send).not.toHaveBeenCalled();
    expect(rules).toEqual([]);
  });

  it("does not install a rule or start work for an already cancelled task", async () => {
    const controller = new AbortController();
    controller.abort();
    const send = vi.fn();
    await expect(compatibility.withDoubaoCompatibility(compatibility.DOUBAO_LAUNCH_ENDPOINT, send, controller.signal))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(send).not.toHaveBeenCalled();
    expect(updateRules).not.toHaveBeenCalled();
  });

  it.each([
    "http://www.doubao.com/alice/user/launch",
    "https://www.doubao.com/alice/user/launch/",
    "https://www.doubao.com/samantha/chat/completion",
    "https://www.doubao.com.evil.test/alice/user/launch",
    "https://user:password@www.doubao.com/alice/user/launch",
    "https://www.doubao.com/alice/user/launch#fragment"
  ])("rejects unsupported URLs before any rule mutation: %s", async (endpoint) => {
    const send = vi.fn();
    await expect(compatibility.withDoubaoCompatibility(endpoint, send))
      .rejects.toMatchObject({ errorCode: "protocol-changed" });
    expect(updateRules).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
