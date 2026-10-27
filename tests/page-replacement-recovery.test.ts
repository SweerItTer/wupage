// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/shared/defaults";
import type { RuntimeRequest, TranslationDisplayMode } from "../src/shared/types";

vi.mock("../src/content/runtime", () => ({ sendRuntimeRequest: vi.fn() }));

import { sendRuntimeRequest } from "../src/content/runtime";
import {
  clearPageTranslation, getPageTranslationState, hidePageTranslation,
  setPageTranslationDisplayMode, startPageTranslation
} from "../src/content/page-translation";
import { injectContentStyles } from "../src/content/styles";

const prefix = "Reports and analysis from correspondents around the world";
const translation = "世界各地の記者がお届けする最新のニュースと詳しい解説を紹介します。";
const settings = { ...DEFAULT_SETTINGS, sourceLang: "en", targetLang: "ja", translationDisplayMode: "replace" as const };
const hostObservers: MutationObserver[] = [];

function mountTeaser(): HTMLElement {
  document.body.innerHTML = '<main><article><p class="teaser"><span style="display:block"></span></p></article></main>';
  const source = document.querySelector<HTMLElement>(".teaser > span")!;
  source.append(document.createTextNode(prefix), document.createTextNode("..."));
  return source;
}

function readSource(source: Element): string {
  return Array.from(source.childNodes).filter((node) => node instanceof Text)
    .map((node) => node.textContent).join("");
}

// BBC's React truncator restores its original text when clearing the source
// changes the observed span's height. Recreate the text and ellipsis nodes as
// that render does, with a cap so a regression fails instead of hanging CI.
function restoreHostTextWhenCleared(source: Element) {
  const state = { writes: 0 };
  const observer = new MutationObserver(() => {
    if (readSource(source).trim() || state.writes >= 8) return;
    state.writes += 1;
    source.replaceChildren(document.createTextNode(prefix), document.createTextNode("..."));
  });
  observer.observe(source, { subtree: true, characterData: true, childList: true });
  hostObservers.push(observer);
  return state;
}

function requestedTexts(): string[] {
  return vi.mocked(sendRuntimeRequest).mock.calls.flatMap(([request]) =>
    request.type === "TRANSLATE_BATCH" ? request.texts : []);
}

beforeEach(() => {
  vi.useFakeTimers();
  injectContentStyles();
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    width: 300, height: 24, top: 100, bottom: 124, left: 0, right: 300,
    x: 0, y: 100, toJSON: () => ({})
  } as DOMRect);
  vi.mocked(sendRuntimeRequest).mockImplementation(async (request: RuntimeRequest) => {
    if (request.type !== "TRANSLATE_BATCH") throw new Error("Unexpected request");
    return { translations: request.texts.map(() => translation), cached: request.texts.length };
  });
});

afterEach(() => {
  hostObservers.splice(0).forEach((observer) => observer.disconnect());
  clearPageTranslation();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.mocked(sendRuntimeRequest).mockReset();
  document.body.innerHTML = "";
  document.getElementById("wupage-translation-style")?.remove();
});

describe("replacement mode with host-managed news teasers", () => {
  it("settles a source-restoration feedback cycle without new translations or growing counters", async () => {
    const source = mountTeaser();
    const host = restoreHostTextWhenCleared(source);
    await startPageTranslation(settings);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(host.writes).toBe(1);
    expect(sendRuntimeRequest).toHaveBeenCalledTimes(1);
    expect(getPageTranslationState()).toMatchObject({ translated: 1, cached: 1, pending: 0, remaining: 0, failed: 0 });
    expect(readSource(source)).toBe(prefix + "...");
    const output = document.querySelector<HTMLElement>(".wupage-translation")!;
    expect(output.textContent).toBe(translation);
    expect(source.contains(output)).toBe(false);
    expect(window.getComputedStyle(source).visibility).toBe("hidden");
    expect(window.getComputedStyle(output).visibility).toBe("visible");

    for (let index = 0; index < 5; index++) {
      window.dispatchEvent(new Event("scroll"));
      await vi.advanceTimersByTimeAsync(200);
    }
    expect(sendRuntimeRequest).toHaveBeenCalledTimes(1);
    expect(getPageTranslationState()).toMatchObject({ translated: 1, cached: 1, pending: 0 });
    expect(requestedTexts().every((text) => !text.includes(translation))).toBe(true);
  });

  it("keeps a restored same-source segment when React replaces its text nodes again", async () => {
    const source = mountTeaser();
    restoreHostTextWhenCleared(source);
    await startPageTranslation(settings);
    await vi.advanceTimersByTimeAsync(500);
    for (let index = 0; index < 3; index++) {
      source.replaceChildren(document.createTextNode(prefix), document.createTextNode("..."));
      await vi.advanceTimersByTimeAsync(250);
    }
    expect(sendRuntimeRequest).toHaveBeenCalledTimes(1);
    expect(getPageTranslationState()).toMatchObject({ translated: 1, cached: 1, pending: 0 });
    expect(document.querySelectorAll(".wupage-translation")).toHaveLength(1);
  });

  it("still translates real news updates and newly inserted cards after recovery", async () => {
    const source = mountTeaser();
    const host = restoreHostTextWhenCleared(source);
    await startPageTranslation(settings);
    await vi.advanceTimersByTimeAsync(500);
    const updated = "A different report with new details and a new headline";
    source.replaceChildren(document.createTextNode(updated), document.createTextNode("..."));
    await vi.advanceTimersByTimeAsync(500);

    expect(requestedTexts()).toHaveLength(2);
    expect(requestedTexts()[1]).toContain(updated);
    expect(readSource(source)).toBe(updated + "...");
    expect(host.writes).toBe(1);
    document.querySelector("article")!.insertAdjacentHTML("beforeend", "<p>A newly published story.</p>");
    await vi.advanceTimersByTimeAsync(500);
    expect(requestedTexts()).toHaveLength(3);
    expect(requestedTexts()[2]).toBe("A newly published story.");
    expect(getPageTranslationState().pending).toBe(0);
  });

  it("restores the original view and changes display modes without restarting the feedback cycle", async () => {
    const source = mountTeaser();
    const originalStyle = source.getAttribute("style");
    const host = restoreHostTextWhenCleared(source);
    await startPageTranslation(settings);
    await vi.advanceTimersByTimeAsync(500);

    for (const mode of ["bilingual", "bilingual-accent", "replace"] satisfies TranslationDisplayMode[]) {
      setPageTranslationDisplayMode(mode);
      await vi.advanceTimersByTimeAsync(300);
      expect(readSource(source)).toBe(prefix + "...");
      expect(window.getComputedStyle(source).visibility).toBe(mode === "replace" ? "hidden" : "visible");
    }
    hidePageTranslation();
    expect(source.getAttribute("style")).toBe(originalStyle);
    expect(window.getComputedStyle(source).visibility).toBe("visible");
    expect(document.querySelector(".wupage-translation")).toBeNull();
    await startPageTranslation(settings);
    await vi.advanceTimersByTimeAsync(500);
    expect(host.writes).toBe(1);
    expect(sendRuntimeRequest).toHaveBeenCalledTimes(1);
    expect(getPageTranslationState()).toMatchObject({ translated: 1, cached: 1, pending: 0 });
  });

  it("keeps the safe rendering strategy when translating the same card to a different language", async () => {
    const source = mountTeaser();
    const host = restoreHostTextWhenCleared(source);
    await startPageTranslation(settings);
    await vi.advanceTimersByTimeAsync(500);
    await startPageTranslation({ ...settings, targetLang: "fr" }, false);
    await vi.advanceTimersByTimeAsync(500);

    expect(host.writes).toBe(1);
    expect(sendRuntimeRequest).toHaveBeenCalledTimes(2);
    expect(vi.mocked(sendRuntimeRequest).mock.calls[1][0]).toMatchObject({ targetLang: "fr" });
    expect(readSource(source)).toBe(prefix + "...");
    expect(window.getComputedStyle(source).visibility).toBe("hidden");
    expect(getPageTranslationState()).toMatchObject({ translated: 1, cached: 1, pending: 0 });
  });

  it.each(["bilingual", "bilingual-accent"] as const)("keeps normal %s behavior", async (translationDisplayMode) => {
    const source = mountTeaser();
    const host = restoreHostTextWhenCleared(source);
    await startPageTranslation({ ...settings, translationDisplayMode });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(host.writes).toBe(0);
    expect(readSource(source)).toBe(prefix + "...");
    expect(window.getComputedStyle(source).visibility).toBe("visible");
    expect(sendRuntimeRequest).toHaveBeenCalledTimes(1);
    expect(getPageTranslationState()).toMatchObject({ translated: 1, cached: 1, pending: 0 });
  });
});
