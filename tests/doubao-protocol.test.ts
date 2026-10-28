import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  groupDoubaoSegments,
  reassembleDoubaoSegments,
  segmentDoubaoTexts
} from "../src/background/doubao-segmentation";
import { DoubaoSseParser, doubaoServiceError } from "../src/background/doubao-sse";
import { ProviderError } from "../src/shared/errors";

describe("Doubao source segmentation", () => {
  it.each([16, 19, 32, 2000])("preserves source characters, protected tokens and surrogate pairs with limit %s", (limit) => {
    const source = [
      "  First sentence. Second one! 🌏🌏\nThird paragraph ⟪WUPAGE123⟫ is protected.\t",
      "无空格文本".repeat(450) + "🌏".repeat(50),
      "⟪WUPAGE0⟫  ⟪WUPAGE1⟫\n---",
      " \t\n",
      ""
    ];
    const parts = segmentDoubaoTexts(source, limit);
    for (const [index, text] of source.entries()) {
      expect(parts.filter((part) => part.sourceIndex === index).map((part) => part.text).join("")).toBe(text);
    }
    for (const part of parts) {
      expect(part.text.length).toBeLessThanOrEqual(limit);
      expect(part.text).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u);
      const withoutTokens = part.text.replace(/⟪WUPAGE\d+⟫/gu, "");
      expect(withoutTokens).not.toContain("⟪");
      expect(withoutTokens).not.toContain("⟫");
    }
  });

  it("prefers a sentence boundary without losing the intervening whitespace", () => {
    const parts = segmentDoubaoTexts(["First sentence. Second one is longer."], 24);
    expect(parts.filter((part) => part.translate).map((part) => part.text)).toEqual([
      "First sentence.", "Second one is longer."
    ]);
    expect(parts.map((part) => part.text).join("")).toBe("First sentence. Second one is longer.");
  });

  it("keeps pure protected tokens, whitespace and delimiters local", () => {
    const parts = segmentDoubaoTexts([" \t⟪WUPAGE0⟫  ⟪WUPAGE1⟫\n---", "🌏", ""]);
    expect(parts.every((part) => !part.translate)).toBe(true);
    expect(groupDoubaoSegments(parts)).toEqual([]);
    expect(reassembleDoubaoSegments(3, parts, new Map())).toEqual([
      " \t⟪WUPAGE0⟫  ⟪WUPAGE1⟫\n---", "🌏", ""
    ]);
  });

  it("reassembles translated pieces by original input index and keeps boundary whitespace", () => {
    const sources = [" Hello world. Second part. ", "\nDuplicate", "\tDuplicate\n"];
    const parts = segmentDoubaoTexts(sources, 16);
    const translations = new Map<number, string>();
    for (const [index, part] of parts.entries()) {
      if (part.translate) translations.set(index, " [" + part.text + "] ");
    }
    expect(reassembleDoubaoSegments(sources.length, parts, translations)).toEqual([
      " [Hello world.] [Second part.] ", "\n[Duplicate]", "\t[Duplicate]\n"
    ]);
  });

  it("groups only translatable segment indexes within both item and character limits", () => {
    const parts = segmentDoubaoTexts(Array.from({ length: 25 }, () => " one "), 20);
    const groups = groupDoubaoSegments(parts, 20, 3);
    expect(groups).toHaveLength(9);
    for (const group of groups) {
      expect(group.length).toBeLessThanOrEqual(3);
      expect(group.every((index) => parts[index].translate)).toBe(true);
      expect(group.reduce((sum, index) => sum + parts[index].text.length, 0)).toBeLessThanOrEqual(20);
    }
    expect(groups.flat()).toEqual(parts.flatMap((part, index) => part.translate ? [index] : []));
    const longParts = segmentDoubaoTexts(["abcdefghij", "klmnopqrst", "uvwxyz"], 20);
    expect(groupDoubaoSegments(longParts, 20, 10)).toEqual([[0, 1], [2]]);
  });

  it("rejects a protected token or atomic character too large for the chosen limit", () => {
    expect(() => segmentDoubaoTexts(["⟪WUPAGE12345⟫"], 8))
      .toThrowError(expect.objectContaining({ errorCode: "input-too-long" }));
    expect(() => segmentDoubaoTexts(["🌏"], 1)).toThrow();
  });

  it("fails rather than substituting source text for an absent or blank translation", () => {
    const parts = segmentDoubaoTexts(["One sentence. Another one."], 16);
    const translated = parts.flatMap((part, index) => part.translate ? [index] : []);
    expect(translated).toHaveLength(2);
    for (const missing of [undefined, "", " \n"]) {
      const values = new Map<number, string>([[translated[0], "一"]]);
      if (missing !== undefined) values.set(translated[1], missing);
      expect(() => reassembleDoubaoSegments(1, parts, values))
        .toThrowError(expect.objectContaining({ errorCode: "incomplete" }));
    }
  });

  it("does not overwrite local fragments with unexpected response entries", () => {
    const parts = segmentDoubaoTexts(["  Hello"]);
    expect(reassembleDoubaoSegments(1, parts, new Map([[0, "wrong"], [1, "你好"]])))
      .toEqual(["  你好"]);
  });

  it("does not repair or guess protected tokens before the shared recovery layer", () => {
    const parts = segmentDoubaoTexts(["Hello ⟪WUPAGE0⟫ world"]);
    expect(reassembleDoubaoSegments(1, parts, new Map([[0, "标记丢失"]]))).toEqual(["标记丢失"]);
  });
});

describe("Doubao article SSE", () => {
  function frame(items: unknown[]): string {
    return "event: json\ndata: " + JSON.stringify({ code: 0, data: { items } }) + "\n\n";
  }

  function item(index: number, res: string, detect_lang = "en"): Record<string, unknown> {
    return { index, res, detect_lang };
  }

  it("maps out-of-order results to the original positions and preserves repeated source texts", () => {
    const parser = new DoubaoSseParser(["same", "same", "other"], "zh");
    parser.push(frame([item(2, "其他"), item(0, "相同"), item(1, "相同")]));
    parser.push("event: done\n\n");
    expect(parser.done).toBe(true);
    expect(parser.finish()).toEqual(["相同", "相同", "其他"]);
  });

  it("accepts UTF-8 characters, CRLF and multiple data lines split at every byte", () => {
    const parser = new DoubaoSseParser(["hello"], "zh");
    const stream = "\uFEFF: heartbeat\r\n\r\nevent: json\r\n"
      + "data: {\"code\":0,\r\n"
      + "data: \"data\":{\"items\":[{\"index\":0,\"res\":\"你好🌏\",\"detect_lang\":\"en\"}]}}\r\n\r\n"
      + "event: done\r\ndata: {}\r\n\r\n";
    const decoder = new TextDecoder("utf-8", { fatal: true });
    for (const byte of new TextEncoder().encode(stream)) {
      parser.push(decoder.decode(Uint8Array.of(byte), { stream: true }));
    }
    parser.push(decoder.decode());
    expect(parser.finish()).toEqual(["你好🌏"]);
  });

  it("flushes a final frame without a done event or newline and returns stable snapshots", () => {
    const parser = new DoubaoSseParser(["hello"], "zh");
    parser.push(frame([item(0, "你好")]).trimEnd());
    expect(parser.done).toBe(false);
    const result = parser.finish();
    expect(result).toEqual(["你好"]);
    result[0] = "changed";
    expect(parser.finish()).toEqual(["你好"]);
  });

  it("ignores heartbeats and unknown event types without assigning result slots", () => {
    const parser = new DoubaoSseParser(["one", "two"], "zh");
    parser.push(": ping\n\nevent: ping\ndata: {}\n\nretry: 1000\n\n");
    parser.push(frame([item(1, "二")]));
    expect(parser.finish()).toEqual([undefined, "二"]);
  });

  it("treats done without a body as terminal and ignores trailing bytes", () => {
    const parser = new DoubaoSseParser(["one"], "zh");
    parser.push(frame([item(0, "一")]) + "event: done\n\n" + frame([item(0, "覆盖")]));
    parser.push(frame([item(0, "覆盖")]));
    expect(parser.finish()).toEqual(["一"]);
  });

  it("accepts identical duplicate results and rejects conflicting duplicates", () => {
    const parser = new DoubaoSseParser(["one"], "zh");
    parser.push(frame([item(0, "一"), item(0, "一")]));
    expect(() => parser.push(frame([item(0, "不同")]))).toThrow(ProviderError);
  });

  it("keeps the original for the protocol's empty same-language response", () => {
    const parser = new DoubaoSseParser(["原文"], "zh");
    parser.push(frame([item(0, "", "zh")]));
    expect(parser.finish()).toEqual(["原文"]);
  });

  it("does not let server language metadata replace a nonempty translation", () => {
    const parser = new DoubaoSseParser(["English and 中文"], "zh");
    parser.push(frame([item(0, "英文和中文", "zh")]));
    expect(parser.finish()).toEqual(["英文和中文"]);
  });

  it.each([
    item(-1, "错"),
    item(1, "错"),
    item(0.5, "错"),
    { index: "0", res: "错" },
    { index: 0, res: null },
    { index: 0, res: "错", detect_lang: 3 },
    item(0, "  "),
    null
  ])("rejects malformed or empty translation items: %j", (invalid) => {
    const parser = new DoubaoSseParser(["one"], "zh");
    expect(() => parser.push(frame([invalid]))).toThrow(ProviderError);
  });

  it.each([
    "event: json\ndata: [DONE]\n\n",
    "event: json\ndata: {\"code\":\"0\",\"data\":{\"items\":[]}}\n\n",
    "event: json\ndata: {\"code\":0,\"data\":{\"items\":{}}}\n\n",
    "event: json\ndata: <html>Login</html>\n\n",
    "event: json\ndata: null\n\n"
  ])("rejects invalid article envelopes", (stream) => {
    const parser = new DoubaoSseParser(["one"], "zh");
    expect(() => parser.push(stream)).toThrow(ProviderError);
  });

  it("rejects a truncated JSON event at EOF", () => {
    const parser = new DoubaoSseParser(["one"], "zh");
    parser.push("event: json\ndata: {\"code\":0,");
    expect(() => parser.finish()).toThrow(ProviderError);
  });

  it("propagates business errors from both json and err events without echoing service text", () => {
    for (const event of ["json", "err"]) {
      const parser = new DoubaoSseParser(["one"], "zh");
      const operation = () => parser.push("event: " + event
        + "\ndata: {\"code\":710012000,\"message\":\"private service text\"}\n\n");
      expect(operation).toThrowError(expect.objectContaining({ errorCode: "login-required" }));
      expect(operation).not.toThrow("private service text");
    }
  });

  it("bounds retained decoded text even when no event boundary arrives", () => {
    const parser = new DoubaoSseParser(["one"], "zh");
    expect(() => parser.push("x".repeat(1_000_001))).toThrow(ProviderError);
  });

  it.each([
    [710012000, "login-required"],
    [710012001, "login-required"],
    [710022013, "login-required"],
    [710012007, "rate-limited"],
    [676010003, "rate-limited"],
    [710022002, "service-rejected"],
    [710022004, "service-rejected"],
    [999999, "protocol-changed"]
  ])("maps business code %s to %s", (code, errorCode) => {
    expect(doubaoServiceError(code)).toMatchObject({ errorCode });
  });

  it("classifies malformed business codes without coercing untrusted objects", () => {
    expect(doubaoServiceError({ toString: null })).toMatchObject({ errorCode: "protocol-changed" });
  });
});

describe("Doubao narrowly scoped origin compatibility", () => {
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
