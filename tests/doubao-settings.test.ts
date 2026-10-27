import { afterEach, describe, expect, it, vi } from "vitest";
import { sendRuntimeRequest } from "../src/content/runtime";
import { DEFAULT_SETTINGS, SETTINGS_KEY } from "../src/shared/defaults";
import { ProviderError, runtimeErrorResponse } from "../src/shared/errors";
import { sendRuntimeMessage, sendTabMessage } from "../src/shared/messaging";
import { getEffectiveProviderPerformance } from "../src/shared/performance";
import { getSettings, normalizeSettings, saveSettings } from "../src/shared/settings";
import type { RuntimeRequest } from "../src/shared/types";

afterEach(() => { vi.unstubAllGlobals(); });

describe("Doubao settings migration", () => {
  it("adds Doubao to an older profile while keeping Google active and preserving existing API credentials and disabled providers", () => {
    const oldProviders = DEFAULT_SETTINGS.providers.filter((provider) => provider.type !== "doubao-web")
      .map((provider) => provider.type === "openai-compatible"
        ? { ...provider, apiKey: "stored-test-api-key", baseURL: "https://example.test/v1", enabled: false }
        : provider);
    const result = normalizeSettings({ activeProviderId: "google-web-translate", providers: oldProviders });

    expect(result.activeProviderId).toBe("google-web-translate");
    expect(result.providers.find((provider) => provider.type === "doubao-web"))
      .toMatchObject({ id: "doubao-web", enabled: true, chunkSize: 1200, concurrency: 1 });
    expect(result.providers.find((provider) => provider.id === "openai-compatible"))
      .toMatchObject({ apiKey: "stored-test-api-key", baseURL: "https://example.test/v1", enabled: false });
    expect(result.providers).toHaveLength(oldProviders.length + 1);
  });

  it("retains an explicitly selected Doubao configuration across normalization", () => {
    const normalized = normalizeSettings({
      activeProviderId: "my-doubao",
      providers: [{ type: "doubao-web", id: "my-doubao", label: "我的豆包", enabled: true }]
    });

    expect(normalized.activeProviderId).toBe("my-doubao");
    expect(normalized.providers.find((provider) => provider.id === "my-doubao"))
      .toMatchObject({ type: "doubao-web", label: "我的豆包", enabled: true });
    expect(normalizeSettings(normalized)).toEqual(normalized);
  });

  it("updates the previous built-in label without overwriting custom names", () => {
    const previousLabel = "豆包（网页登录，实验）";
    const result = normalizeSettings({
      activeProviderId: "doubao-web",
      providers: [
        { type: "doubao-web", id: "doubao-web", label: previousLabel, enabled: false },
        { type: "doubao-web", id: "my-doubao", label: previousLabel }
      ]
    });
    expect(result.providers.find((provider) => provider.id === "doubao-web"))
      .toMatchObject({ label: "豆包（实验性）", enabled: false });
    expect(result.providers.find((provider) => provider.id === "my-doubao")?.label).toBe(previousLabel);
    const renamed = normalizeSettings({
      providers: [{ type: "doubao-web", id: "doubao-web", label: "我的豆包" }]
    });
    expect(renamed.providers.find((provider) => provider.id === "doubao-web")?.label).toBe("我的豆包");
    expect(normalizeSettings(result)).toEqual(result);
  });

  it("preserves disabled Doubao through storage round trips and discards unsupported credential fields", async () => {
    let saved: unknown = {
      activeProviderId: "google-web-translate",
      providers: [{
        type: "doubao-web", id: "doubao-web", label: "豆包", enabled: false,
        apiKey: "not-a-supported-field", cookie: "not-a-supported-field", webId: "not-a-supported-field"
      }]
    };
    const set = vi.fn(async (value: Record<string, unknown>) => { saved = value[SETTINGS_KEY]; });
    vi.stubGlobal("chrome", { storage: { local: {
      get: vi.fn(async () => ({ [SETTINGS_KEY]: saved })), set
    } } });

    const loaded = await getSettings();
    await saveSettings(loaded);
    const reloaded = await getSettings();

    expect(reloaded.activeProviderId).toBe("google-web-translate");
    expect(reloaded.providers.find((provider) => provider.id === "doubao-web")).toEqual({
      type: "doubao-web", id: "doubao-web", label: "豆包", enabled: false,
      performanceMode: "custom", chunkSize: 1200, concurrency: 1
    });
    expect(reloaded).toEqual(loaded);
    expect(set).toHaveBeenCalledTimes(1);
  });

  it("keeps Doubao conservative when legacy global settings or edited provider fields request more concurrency", () => {
    const result = normalizeSettings({
      activeProviderId: "doubao-web", chunkSize: 4000, concurrency: 8,
      providers: [{
        type: "doubao-web", id: "doubao-web", label: "豆包", enabled: true,
        performanceMode: "inherit", chunkSize: 4000, concurrency: 8
      }]
    });

    expect(getEffectiveProviderPerformance(result)).toEqual({
      performanceMode: "custom", chunkSize: 1200, concurrency: 1
    });
    expect(result.chunkSize).toBe(4000);
    expect(result.concurrency).toBe(8);
    expect(getEffectiveProviderPerformance(result, "google-web-translate").concurrency).toBe(8);
  });
});

describe("structured Doubao errors across runtime messaging", () => {
  const callers = [
    ["settings and popup", (request: RuntimeRequest) => sendRuntimeMessage(request)],
    ["content scripts", (request: RuntimeRequest) => sendRuntimeRequest(request)],
    ["tab messages", (request: RuntimeRequest) => sendTabMessage(17, request)]
  ] as const;

  it.each(callers)("retains the rate-limit code and retry delay for %s", async (_label, send) => {
    const envelope = JSON.parse(JSON.stringify(runtimeErrorResponse(
      new ProviderError("豆包暂时限流", "rate-limited", 45_000)
    )));
    vi.stubGlobal("chrome", {
      runtime: { id: "test-extension", sendMessage: vi.fn().mockResolvedValue(envelope) },
      tabs: { sendMessage: vi.fn().mockResolvedValue(envelope) }
    });

    const error = await send({ type: "CHECK_DOUBAO" }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ message: "豆包暂时限流", errorCode: "rate-limited", retryAfterMs: 45_000 });
  });

  it.each(callers)("retains a login error without manufacturing a retry delay for %s", async (_label, send) => {
    const envelope = JSON.parse(JSON.stringify(runtimeErrorResponse(
      new ProviderError("需要重新登录豆包", "login-required")
    )));
    vi.stubGlobal("chrome", {
      runtime: { id: "test-extension", sendMessage: vi.fn().mockResolvedValue(envelope) },
      tabs: { sendMessage: vi.fn().mockResolvedValue(envelope) }
    });

    const error = await send({ type: "CHECK_DOUBAO" }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ message: "需要重新登录豆包", errorCode: "login-required" });
    expect((error as ProviderError).retryAfterMs).toBeUndefined();
  });
});
