import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLocalRoute, LOCAL_MODELS } from "../src/local/models";
import { translateLocally } from "../src/background/local";
import { getEffectiveProviderPerformance } from "../src/shared/performance";
import { normalizeSettings } from "../src/shared/settings";

vi.mock("../src/background/offscreen", () => ({ ensureOffscreenDocument: vi.fn(async () => undefined) }));
const sendMessage = vi.fn();
const detectLanguage = vi.fn();
beforeEach(() => {
  vi.stubGlobal("chrome", { runtime: { sendMessage }, i18n: { detectLanguage } });
  sendMessage.mockResolvedValue({ ok: true, data: ["你好"] });
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("Firefox local translation", () => {
  it("finds direct models and English pivot routes, with regional language aliases", () => {
    expect(getLocalRoute("en-US", "zh-CN").map((model) => model.id)).toEqual(["en-zh-Hans"]);
    expect(getLocalRoute("ja", "zh-CN").map((model) => model.id)).toEqual(["ja-en", "en-zh-Hans"]);
    expect(getLocalRoute("en", "en-GB")).toEqual([]);
    expect(() => getLocalRoute("en", "zh-TW")).toThrow("更换语言");
    expect(() => getLocalRoute("ko", "zh-CN")).toThrow("更换语言");
    for (const model of LOCAL_MODELS) {
      expect(model.files.some((file) => file.role === "model")).toBe(true);
      expect(model.files.some((file) => file.role === "lex")).toBe(true);
      expect(model.files.some((file) => file.role === "vocab")
        || model.files.some((file) => file.role === "srcvocab") && model.files.some((file) => file.role === "trgvocab")).toBe(true);
      for (const file of model.files) expect(file.url).toMatch(/^https:\/\/firefox-settings-attachments\.cdn\.mozilla\.net\//);
    }
  });
  it("detects language using the local browser API and sends only a local inference request", async () => {
    detectLanguage.mockResolvedValue({ languages: [{ language: "en", percentage: 95 }] });
    expect(await translateLocally({ texts: ["Hello"], sourceLang: "auto", targetLang: "zh-CN" })).toEqual(["你好"]);
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ target: "bergamot-offscreen", action: "translate",
      data: expect.objectContaining({ sourceLang: "en" }) }));
  });
  it("asks for manual source selection when detection is uncertain", async () => {
    detectLanguage.mockResolvedValue({ languages: [{ language: "en", percentage: 40 }] });
    await expect(translateLocally({ texts: ["x"], targetLang: "zh-CN" })).rejects.toThrow("手动选择");
    expect(sendMessage).not.toHaveBeenCalled();
  });
  it("propagates missing model errors and does not substitute an online provider", async () => {
    sendMessage.mockResolvedValue({ ok: false, error: "请先下载或导入模型" });
    await expect(translateLocally({ texts: ["Hello"], sourceLang: "en", targetLang: "zh-CN" })).rejects.toThrow("下载或导入");
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(detectLanguage).not.toHaveBeenCalled();
  });
  it("avoids inference for empty input and identical languages, and respects pre-aborted requests", async () => {
    expect(await translateLocally({ texts: [], targetLang: "zh-CN" })).toEqual([]);
    expect(await translateLocally({ texts: ["Hello"], sourceLang: "en", targetLang: "en" })).toEqual(["Hello"]);
    await expect(translateLocally({ texts: ["Hello"], sourceLang: "en", targetLang: "zh-CN" }, AbortSignal.abort())).rejects.toThrow();
    expect(sendMessage).not.toHaveBeenCalled();
  });
  it("adds the experiment to old settings without switching providers and limits inference concurrency", () => {
    const settings = normalizeSettings({ activeProviderId: "google-web-translate", concurrency: 8, chunkSize: 4000 });
    expect(settings.activeProviderId).toBe("google-web-translate");
    const local = settings.providers.find((provider) => provider.type === "firefox-local")!;
    local.performanceMode = "inherit";
    expect(getEffectiveProviderPerformance(settings, local.id)).toMatchObject({ concurrency: 1, chunkSize: 800 });
  });
});
