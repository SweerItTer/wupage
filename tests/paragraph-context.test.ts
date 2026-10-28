// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { DEFAULT_SETTINGS, SETTINGS_KEY } from "../src/shared/defaults";
import type { ExtensionSettings, RuntimeRequest } from "../src/shared/types";
import { initParagraphContextTranslation } from "../src/content/paragraph-context";
import { clearPageTranslation, setPageTranslationDisplayMode } from "../src/content/page-translation";
import { sendRuntimeRequest } from "../src/content/runtime";

vi.mock("../src/content/runtime", () => ({ sendRuntimeRequest: vi.fn() }));
let stored: ExtensionSettings;
let changed: (changes: Record<string, chrome.storage.StorageChange>, area: string) => void;
let run: ReturnType<typeof initParagraphContextTranslation>;
let listeners: MockInstance<Document["addEventListener"]>;

beforeEach(async () => {
  document.body.innerHTML = '<main><p id="first">Read this <a href="#"><span>complete paragraph</span></a> before continuing.</p><p id="second">Leave this other paragraph alone.</p><p><input value="Private text"><button>Submit</button></p></main>';
  stored = { ...structuredClone(DEFAULT_SETTINGS), contextMenuTranslationEnabled: true };
  vi.mocked(sendRuntimeRequest).mockImplementation(async (request: RuntimeRequest) => {
    if (request.type === "GET_SETTINGS") return structuredClone(stored);
    if (request.type === "TRANSLATE_BATCH") return { translations: request.texts.map(() => "这是整段译文。"), cached: 0 };
  });
  vi.stubGlobal("chrome", { storage: { onChanged: { addListener: (listener: typeof changed) => { changed = listener; } } } });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ x: 10, y: 10, left: 10, top: 10, right: 610, bottom: 40, width: 600, height: 30, toJSON: () => ({}) });
  setPageTranslationDisplayMode("bilingual");
  listeners = vi.spyOn(document, "addEventListener");
  run = initParagraphContextTranslation();
  await Promise.resolve();
});
afterEach(() => {
  clearPageTranslation();
  for (const args of listeners.mock.calls) document.removeEventListener(...args);
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.mocked(sendRuntimeRequest).mockReset();
  document.body.replaceChildren(); document.getElementById("wupage-paragraph-notice")?.remove();
});

const capture = (selector: string) => document.querySelector(selector)!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 30, clientY: 40 }));
const requests = () => vi.mocked(sendRuntimeRequest).mock.calls.map(([request]) => request).filter(request => request.type === "TRANSLATE_BATCH");

describe("right-click paragraph translation", () => {
  it("translates the complete captured paragraph and preserves inline links", async () => {
    capture("#first span");
    document.querySelector("#second")!.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    await run("translate");
    expect(requests()).toHaveLength(1);
    expect(requests()[0]).toMatchObject({ sourceLang: stored.sourceLang, targetLang: stored.targetLang, providerId: stored.activeProviderId });
    expect(document.querySelector(".wupage-translation")?.textContent).toContain("这是整段译文");
    expect(document.querySelector("#first a")?.getAttribute("href")).toBe("#");
    expect(document.querySelector("#second .wupage-translation")).toBeNull();
    await run("translate");
    expect(requests()).toHaveLength(1);
    capture(".wupage-translation");
    await run("restore");
    expect(document.querySelector("#first")?.textContent).toBe("Read this complete paragraph before continuing.");
  });

  it("deduplicates a running paragraph and ignores its late result after restoration", async () => {
    let finish!: (value: unknown) => void;
    const pending = new Promise(resolve => { finish = resolve; });
    const original = vi.mocked(sendRuntimeRequest).getMockImplementation()!;
    vi.mocked(sendRuntimeRequest).mockImplementation(request => request.type === "TRANSLATE_BATCH" ? pending : original(request));
    capture("#first");
    const running = run("translate");
    await vi.waitFor(() => expect(requests()).toHaveLength(1));
    await run("translate");
    expect(requests()).toHaveLength(1);
    await run("restore");
    finish({ translations: ["迟到的译文。"], cached: 0 });
    await running;
    expect(document.querySelector(".wupage-translation")).toBeNull();
  });

  it.each(["replace", "bilingual", "bilingual-accent"] as const)("restores from the rendered translation in %s mode", async mode => {
    stored.translationDisplayMode = mode;
    setPageTranslationDisplayMode(mode);
    capture("#first");
    await run("translate");
    expect(document.querySelector(".wupage-translation")?.getAttribute("data-wupage-display-mode")).toBe(mode);
    capture(".wupage-translation");
    await run("restore");
    expect(document.querySelector(".wupage-translation")).toBeNull();
    expect(document.querySelector("#first")?.textContent).toBe("Read this complete paragraph before continuing.");
  });

  it("does not translate edited or detached paragraphs using an old result", async () => {
    let finish!: (value: unknown) => void;
    const pending = new Promise(resolve => { finish = resolve; });
    const original = vi.mocked(sendRuntimeRequest).getMockImplementation()!;
    vi.mocked(sendRuntimeRequest).mockImplementation(request => request.type === "TRANSLATE_BATCH" ? pending : original(request));
    capture("#second");
    const running = run("translate");
    await vi.waitFor(() => expect(requests()).toHaveLength(1));
    document.querySelector("#second")!.firstChild!.textContent = "A completely different paragraph.";
    finish({ translations: ["过期的译文。"], cached: 0 });
    await running;
    expect(document.querySelector("#second")?.textContent).toBe("A completely different paragraph.");
  });

  it.each(["input", "button", "body"])("excludes %s without falling back to another paragraph", async selector => {
    capture("#first");
    capture(selector);
    expect(await run("translate")).toEqual({ started: false });
    expect(requests()).toHaveLength(0);
  });

  it("disables immediately when saved settings change", async () => {
    capture("#first");
    stored.contextMenuTranslationEnabled = false;
    changed({ [SETTINGS_KEY]: { newValue: stored } }, "local");
    expect(await run("translate")).toEqual({ started: false });
    expect(requests()).toHaveLength(0);
  });

  it("cleans up failures and can retry the same paragraph", async () => {
    const original = vi.mocked(sendRuntimeRequest).getMockImplementation()!;
    let fail = true;
    vi.mocked(sendRuntimeRequest).mockImplementation(request => {
      if (request.type === "TRANSLATE_BATCH" && fail) return Promise.reject(new Error("服务暂不可用"));
      return original(request);
    });
    capture("#first");
    expect(await run("translate")).toEqual({ started: false });
    expect(document.querySelector("#wupage-paragraph-notice")?.textContent).toBe("服务暂不可用");
    expect(document.querySelector(".wupage-translation")).toBeNull();
    fail = false;
    expect(await run("translate")).toEqual({ started: true });
  });
});
