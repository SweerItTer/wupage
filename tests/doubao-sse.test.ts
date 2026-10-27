import { describe, expect, it } from "vitest";
import { DoubaoSseParser, doubaoServiceError } from "../src/background/doubao-sse";
import { ProviderError } from "../src/shared/errors";

function frame(items: unknown[]): string {
  return "event: json\ndata: " + JSON.stringify({ code: 0, data: { items } }) + "\n\n";
}

function item(index: number, res: string, detect_lang = "en"): Record<string, unknown> {
  return { index, res, detect_lang };
}

describe("Doubao article SSE", () => {
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

  it("flushes a complete final frame without a done event or trailing newline", () => {
    const parser = new DoubaoSseParser(["hello"], "zh");
    parser.push(frame([item(0, "你好")]).trimEnd());
    expect(parser.done).toBe(false);
    expect(parser.finish()).toEqual(["你好"]);
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

  it("returns a detached result snapshot", () => {
    const parser = new DoubaoSseParser(["one"], "zh");
    parser.push(frame([item(0, "一")]));
    const result = parser.finish();
    result[0] = "changed";
    expect(parser.finish()).toEqual(["一"]);
  });

  it("classifies malformed business codes without coercing untrusted objects", () => {
    expect(doubaoServiceError({ toString: null })).toMatchObject({ errorCode: "protocol-changed" });
  });
});
