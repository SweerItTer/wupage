import { describe, expect, it } from "vitest";
import { normalizeSettings } from "../src/shared/settings";

describe("normalizeSettings", () => {
  it("uses defaults for invalid input", () => {
    const settings = normalizeSettings({
      targetLang: "",
      chunkSize: 99999,
      concurrency: -1,
      providers: []
    });

    expect(settings.targetLang).toBe("zh-CN");
    expect(settings.activeProviderId).toBe("google-web-translate");
    expect(settings.chunkSize).toBe(4000);
    expect(settings.concurrency).toBe(1);
    expect(settings.translateCodeComments).toBe(true);
    expect(settings.imageTranslationEnabled).toBe(false);
    expect(settings.translationDisplayMode).toBe("bilingual");
    expect(settings.providers.length).toBeGreaterThan(0);
  });

  it("preserves a disabled code comment translation setting", () => {
    expect(normalizeSettings({ translateCodeComments: false }).translateCodeComments).toBe(false);
  });

  it("defaults older PDF settings to five pages on each side and supports current-page-only and unlimited", () => {
    expect(normalizeSettings({}).pdfTranslationPageRadius).toBe(5);
    expect(normalizeSettings({ pdfTranslationPageRadius: 0 }).pdfTranslationPageRadius).toBe(0);
    expect(normalizeSettings({ pdfTranslationPageRadius: 12 }).pdfTranslationPageRadius).toBe(12);
    expect(normalizeSettings({ pdfTranslationPageRadius: null }).pdfTranslationPageRadius).toBeNull();
    expect(normalizeSettings({ pdfTranslationPageRadius: -3 }).pdfTranslationPageRadius).toBe(0);
    expect(normalizeSettings({ pdfTranslationPageRadius: 2.7 }).pdfTranslationPageRadius).toBe(3);
    for (const invalid of ["unlimited", "5", false, NaN, Infinity]) {
      expect(normalizeSettings({ pdfTranslationPageRadius: invalid }).pdfTranslationPageRadius).toBe(5);
    }
  });
  it("only enables image translation with an explicit boolean switch", () => {
    expect(normalizeSettings({ imageTranslationEnabled: true }).imageTranslationEnabled).toBe(true);
    expect(normalizeSettings({ imageTranslationEnabled: "true" }).imageTranslationEnabled).toBe(false);
  });

  it("preserves valid translation display modes and rejects unknown values", () => {
    expect(normalizeSettings({ translationDisplayMode: "replace" }).translationDisplayMode)
      .toBe("replace");
    expect(normalizeSettings({ translationDisplayMode: "bilingual-accent" }).translationDisplayMode)
      .toBe("bilingual-accent");
    expect(normalizeSettings({ translationDisplayMode: "unknown" }).translationDisplayMode)
      .toBe("bilingual");
  });

  it("adds new built-in providers to older saved settings", () => {
    const settings = normalizeSettings({
      activeProviderId: "openai-compatible",
      providers: [
        {
          type: "openai-compatible",
          id: "openai-compatible",
          label: "OpenAI Compatible",
          baseURL: "https://example.com/v1",
          apiKey: "key",
          model: "model",
          systemPrompt: "Translate to {{targetLang}}"
        }
      ]
    });

    expect(settings.activeProviderId).toBe("openai-compatible");
    expect(settings.providers.find((provider) => provider.id === "openai-compatible"))
      .toMatchObject({
        performanceMode: "custom",
        chunkSize: 3200,
        concurrency: 3
      });
    expect(settings.providers.map((provider) => provider.id)).toEqual([
      "google-web-translate",
      "doubao-web",
      "microsoft-translator",
      "google-cloud-translation",
      "openai-compatible",
      "deepseek",
      "zhipu-glm",
      "http-template",
      "firefox-local"
    ]);
  });

  it("preserves an explicit inherited provider performance mode", () => {
    const settings = normalizeSettings({
      chunkSize: 900,
      concurrency: 2,
      providers: [
        {
          type: "zhipu-glm",
          id: "zhipu-glm",
          label: "Zhipu GLM",
          performanceMode: "inherit",
          chunkSize: 3900,
          concurrency: 8,
          baseURL: "https://open.bigmodel.cn/api/paas/v4",
          apiKey: "",
          model: "glm-4-flash-250414",
          systemPrompt: "Translate to {{targetLang}}"
        }
      ]
    });

    expect(settings.providers.find((provider) => provider.id === "zhipu-glm"))
      .toMatchObject({ performanceMode: "inherit" });
    expect(settings.providers.find((provider) => provider.id === "zhipu-glm")?.chunkSize)
      .toBeUndefined();
  });

  it.each([
    ["deepseek-v4-flash", "deepseek-flash"],
    ["deepseek-v4-flash-vision-exp", "deepseek-flash"],
    ["deepseek-flash", "deepseek-flash"],
    ["deepseek-v4-pro", "deepseek-v4-pro"],
    ["custom-model", "custom-model"]
  ])("normalizes saved DeepSeek model %s to %s", (model, expectedModel) => {
    const saved = normalizeSettings(undefined).providers.find((provider) => provider.type === "deepseek")!;
    const settings = normalizeSettings({
      activeProviderId: saved.id,
      providers: [{ ...saved, model, apiKey: "saved-key", baseURL: "https://example.com/v1" }]
    });

    expect(settings.activeProviderId).toBe(saved.id);
    expect(settings.providers.find((provider) => provider.id === saved.id)).toMatchObject({
      model: expectedModel,
      apiKey: "saved-key",
      baseURL: "https://example.com/v1"
    });
  });

  it("preserves custom providers and falls back when the active provider is disabled", () => {
    const settings = normalizeSettings({
      activeProviderId: "openai-compatible",
      providers: [
        {
          type: "openai-compatible",
          id: "openai-compatible",
          label: "OpenAI Compatible",
          enabled: false,
          baseURL: "https://api.openai.com/v1",
          apiKey: "",
          model: "gpt-4o-mini",
          systemPrompt: "Translate to {{targetLang}}"
        },
        {
          type: "anthropic-compatible",
          id: "custom-anthropic-test",
          label: "Custom Anthropic",
          enabled: true,
          baseURL: "https://api.anthropic.com/v1",
          apiKey: "secret",
          model: "claude-test",
          systemPrompt: "Translate to {{targetLang}}"
        }
      ]
    });

    expect(settings.providers.find((provider) => provider.id === "openai-compatible")?.enabled)
      .toBe(false);
    expect(settings.providers.some((provider) => provider.id === "custom-anthropic-test")).toBe(true);
    expect(settings.activeProviderId).toBe("google-web-translate");
  });

  it("keeps at least one provider enabled", () => {
    const disabledProviders = normalizeSettings(undefined).providers.map((provider) => ({
      ...provider,
      enabled: false
    }));
    const settings = normalizeSettings({ providers: disabledProviders });

    expect(settings.providers.filter((provider) => provider.enabled !== false)).toHaveLength(1);
    expect(settings.activeProviderId).toBe("google-web-translate");
  });

  it.each([true, false, undefined, "true"])("defaults Ollama compatibility on and preserves explicit opt-out: %s", (value) => {
    const saved = normalizeSettings(undefined).providers.find((provider) => provider.type === "openai-compatible")!;
    const settings = normalizeSettings({ providers: [{ ...saved, ollamaCompatibility: value }] });
    const provider = settings.providers.find((entry) => entry.type === "openai-compatible");
    expect(provider?.type === "openai-compatible" && provider.ollamaCompatibility)
      .toBe(value !== false);
  });
});
