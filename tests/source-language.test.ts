import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectSourceLanguage } from "../src/background/source-language";

const detectLanguage = vi.fn();

beforeEach(() => {
  detectLanguage.mockReset();
  vi.stubGlobal("chrome", { i18n: { detectLanguage } });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("shared browser source-language detection", () => {
  it("samples joined input using the existing 12000-character limit and accepts the 50-percent threshold", async () => {
    detectLanguage.mockResolvedValue({ languages: [{ language: "en-US", percentage: 50 }] });
    expect(await detectSourceLanguage(["Heading", "a".repeat(13000)])).toBe("en-US");
    expect(detectLanguage).toHaveBeenCalledWith("Heading\n" + "a".repeat(11992));
  });

  it.each([
    { languages: [] },
    { languages: [{ language: "und", percentage: 100 }] },
    { languages: [{ language: "en", percentage: 49 }, { language: "fr", percentage: 40 }] }
  ])("leaves an unreliable result unresolved: %j", async ({ languages }) => {
    detectLanguage.mockResolvedValue({ languages });
    expect(await detectSourceLanguage(["x"])).toBeUndefined();
  });

  it("does not detect an empty or already-aborted request", async () => {
    expect(await detectSourceLanguage([])).toBeUndefined();
    const reason = new Error("Translation cancelled");
    await expect(detectSourceLanguage(["Hello"], AbortSignal.abort(reason))).rejects.toBe(reason);
    expect(detectLanguage).not.toHaveBeenCalled();
  });

  it("stops waiting promptly on cancellation and consumes a later detector rejection", async () => {
    let rejectDetection!: (reason: unknown) => void;
    detectLanguage.mockImplementation(() => new Promise((_resolve, reject) => { rejectDetection = reject; }));
    const controller = new AbortController();
    const pending = detectSourceLanguage(["Hello"], controller.signal);
    const reason = new Error("Translation deadline exceeded");
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    rejectDetection(new Error("Late detector failure"));
    await Promise.resolve();
  });

  it("propagates detector failures without substituting an online detector", async () => {
    const reason = new Error("Browser detection unavailable");
    detectLanguage.mockRejectedValue(reason);
    await expect(detectSourceLanguage(["Hello"])).rejects.toBe(reason);
  });
});
