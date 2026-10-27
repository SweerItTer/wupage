// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearTranslations, collectAdditionalTextSegments, collectTextSegments, invalidateStaleSegments,
  renderTranslations, setTranslationDisplayMode
} from "../src/content/dom";
import { injectContentStyles } from "../src/content/styles";

const original = "News and analysis from around the world.";
const translated = "世界各地のニュースと解説をお届けします。";

beforeEach(() => {
  injectContentStyles();
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    width: 300, height: 24, top: 0, bottom: 24, left: 0, right: 300,
    x: 0, y: 0, toJSON: () => ({})
  } as DOMRect);
});
afterEach(() => {
  clearTranslations();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  document.getElementById("wupage-translation-style")?.remove();
});

function mount(style = ""): HTMLElement {
  document.body.innerHTML = `<main><p class="host-wrapper" style="${style}"><span class="host-source" style="display:block">${original}</span></p></main>`;
  return document.querySelector<HTMLElement>(".host-source")!;
}

function recover(source: HTMLElement) {
  const [segment] = collectTextSegments();
  expect(segment.text).toBe(original);
  renderTranslations([{ id: segment.id, text: translated }], "replace");
  source.replaceChildren(document.createTextNode(original));
  expect(invalidateStaleSegments([source])).not.toContain(segment.id);
  return segment;
}

describe("host-managed replacement recovery", () => {
  it("preserves a standalone segment identity when the host rebuilds the same source text", () => {
    const source = mount();
    const segment = recover(source);
    const output = document.querySelector<HTMLElement>(".wupage-translation")!;
    expect(source.textContent).toBe(original);
    expect(source.contains(output)).toBe(false);
    expect(output.parentElement).toBe(source.parentElement);
    expect(output.textContent).toBe(translated);
    expect(window.getComputedStyle(source).visibility).toBe("hidden");
    expect(window.getComputedStyle(source).alignSelf).toBe("start");
    expect(window.getComputedStyle(output).visibility).toBe("visible");
    source.replaceChildren(document.createTextNode(original.slice(0, 8)), document.createTextNode(original.slice(8)));
    expect(invalidateStaleSegments([source])).not.toContain(segment.id);
    expect(collectAdditionalTextSegments(document.body)).toEqual([]);
    expect(document.querySelectorAll(".wupage-translation")).toHaveLength(1);
  });

  it("does not write DOM mutations again when a recovered segment is unchanged", () => {
    const source = mount();
    recover(source);
    const observer = new MutationObserver(() => {});
    observer.observe(source.parentElement!, { attributes: true, characterData: true, childList: true, subtree: true });
    for (let index = 0; index < 5; index++) expect(invalidateStaleSegments([source])).toEqual([]);
    expect(observer.takeRecords()).toEqual([]);
    observer.disconnect();
  });

  it("restores host classes and inline styles exactly and remembers safe rendering after clearing results", () => {
    const source = mount("margin: 3px 0");
    const originalHtml = document.querySelector("main")!.innerHTML;
    recover(source);
    source.classList.add("host-updated");
    setTranslationDisplayMode("bilingual");
    expect(window.getComputedStyle(source).visibility).toBe("visible");
    expect(source.className).toBe("host-source host-updated");
    setTranslationDisplayMode("replace");
    expect(source.textContent).toBe(original);
    expect(window.getComputedStyle(source).visibility).toBe("hidden");
    source.classList.remove("host-updated");
    clearTranslations();
    expect(document.querySelector("main")!.innerHTML).toBe(originalHtml);

    const [fresh] = collectTextSegments();
    renderTranslations([{ id: fresh.id, text: "新的目标语言译文。" }], "replace");
    expect(source.textContent).toBe(original);
    expect(window.getComputedStyle(source).visibility).toBe("hidden");
    expect(source.contains(document.querySelector(".wupage-translation"))).toBe(false);
  });

  it("releases a genuinely updated source for collection and keeps safe rendering for its next result", () => {
    const source = mount();
    const old = recover(source);
    const updated = "A newly published story with different information.";
    source.replaceChildren(document.createTextNode(updated));
    expect(invalidateStaleSegments([source])).toContain(old.id);
    expect(window.getComputedStyle(source).visibility).toBe("visible");
    const [fresh] = collectAdditionalTextSegments(document.body);
    expect(fresh.text).toBe(updated);
    renderTranslations([{ id: fresh.id, text: "新しい記事の翻訳。" }], "replace");
    expect(source.textContent).toBe(updated);
    expect(window.getComputedStyle(source).visibility).toBe("hidden");
  });

  it("releases a recovered source moved into an unsafe wrapper even when its text nodes are unchanged", () => {
    const source = mount();
    const oldContainer = source.parentElement!;
    const segment = recover(source);
    const destination = document.createElement("div");
    destination.innerHTML = "<button>Another control</button>";
    document.querySelector("main")!.append(destination);
    destination.append(source);

    expect(invalidateStaleSegments()).toContain(segment.id);
    expect(document.querySelector(".wupage-translation")).toBeNull();
    expect(source.className).toBe("host-source");
    expect(oldContainer.className).toBe("host-wrapper");
    expect(window.getComputedStyle(source).visibility).toBe("visible");
    expect(destination.querySelector("button")!.textContent).toBe("Another control");
  });

  it("restores the host wrapper when unrelated content or a new layout makes isolation unsafe", () => {
    const source = mount();
    const segment = recover(source);
    const container = source.parentElement!;
    container.style.display = "flex";
    container.insertAdjacentHTML("beforeend", "<img alt='' src='new-image.png'>");

    expect(invalidateStaleSegments()).toContain(segment.id);
    expect(container.className).toBe("host-wrapper");
    expect(container.style.display).toBe("flex");
    expect(source.className).toBe("host-source");
    expect(container.querySelector("img")).not.toBeNull();
    expect(document.querySelector(".wupage-translation")).toBeNull();
  });

  it("does not retain a grouped segment's old viewport anchor after moving its source", () => {
    const source = mount();
    source.replaceChildren(document.createTextNode(original), document.createTextNode("..."));
    const [segment] = collectTextSegments();
    expect(segment.element).toBe(source.parentElement);
    renderTranslations([{ id: segment.id, text: translated }], "replace");
    source.replaceChildren(document.createTextNode(original), document.createTextNode("..."));
    expect(invalidateStaleSegments([source])).not.toContain(segment.id);
    const destination = document.createElement("p");
    document.querySelector("main")!.append(destination);
    destination.append(source);

    expect(invalidateStaleSegments()).toContain(segment.id);
    expect(window.getComputedStyle(source).visibility).toBe("visible");
    const [fresh] = collectAdditionalTextSegments(document.body);
    expect(fresh.id).not.toBe(segment.id);
    expect(fresh.element).toBe(destination);
    expect(fresh.text).toBe(original + "...");
  });

  it.each(["flex", "grid", "inline", "table"])("does not replace a host's existing %s layout", (display) => {
    const source = mount(`display:${display}`);
    const [segment] = collectTextSegments();
    renderTranslations([{ id: segment.id, text: translated }], "replace");
    source.replaceChildren(document.createTextNode(original));
    expect(invalidateStaleSegments([source])).toContain(segment.id);
    expect(source.parentElement!.className).toBe("host-wrapper");
    expect(source.className).toBe("host-source");
    expect(source.parentElement!.style.display).toBe(display);
  });

  it.each([
    '<img alt="Illustration" src="illustration.png">',
    '<button>Open story</button>',
    ' Other unrelated text.'
  ])("does not cover unrelated wrapper content: %s", (sibling) => {
    const source = mount();
    source.parentElement!.insertAdjacentHTML("beforeend", sibling);
    const segments = collectTextSegments();
    renderTranslations(segments.map(({ id }) => ({ id, text: translated })), "replace");
    source.replaceChildren(document.createTextNode(original));
    invalidateStaleSegments([source]);
    expect(source.parentElement!.classList.contains("wupage-stable-replacement")).toBe(false);
    expect(source.classList.contains("wupage-stable-source")).toBe(false);
    clearTranslations();
    expect(source.parentElement!.querySelector("img,button")?.outerHTML ?? source.parentElement!.textContent)
      .toContain(sibling.includes("<img") ? "illustration.png" : sibling.includes("<button") ? "Open story" : "Other unrelated text.");
  });
});
