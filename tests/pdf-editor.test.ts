// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createEditableTranslationBlock, fitTranslationBlock } from "../src/pdf/editor";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("editable PDF translation blocks", () => {
  it("does not turn an empty range at viewport origin into a large top inset", () => {
    const layer = createLayer();
    const block = createEditableTranslationBlock(layer, {
      id: "empty-range", text: "译文必须保持可见", color: "#222", fontFamily: "Arial", fontSize: 16,
      fontWeight: 400, lineHeight: 20, left: 0, top: 500, width: 200, height: 20
    });
    layer.append(block);
    const text = block.querySelector<HTMLElement>(".translation-block-text")!;
    Object.defineProperties(text, {
      clientWidth: { get: () => 200 }, clientHeight: { get: () => 20 }, scrollWidth: { get: () => 200 },
      scrollHeight: { get: () => 20 + (Number.parseFloat(text.style.paddingTop) || 0) }
    });
    vi.spyOn(text, "getBoundingClientRect").mockReturnValue({ width: 200, top: 500 } as DOMRect);
    vi.spyOn(document, "createRange").mockReturnValue({
      selectNodeContents: vi.fn(), getBoundingClientRect: () => new DOMRect()
    } as unknown as Range);
    fitTranslationBlock(block);
    expect(text.style.fontSize).toBe("16px");
    expect(text.style.paddingTop).toBe("0px");
  });

  it("restores readable text when no candidate size fits instead of committing the failed minimum", () => {
    const layer = createLayer();
    const block = createEditableTranslationBlock(layer, {
      id: "no-valid-size", text: "完整译文", color: "#222", fontFamily: "Arial", fontSize: 16,
      fontWeight: 400, lineHeight: 20, left: 0, top: 0, width: 200, height: 20
    });
    layer.append(block);
    const text = block.querySelector<HTMLElement>(".translation-block-text")!;
    Object.defineProperties(text, {
      clientWidth: { get: () => 200 }, clientHeight: { get: () => 20 }, scrollWidth: { get: () => 200 },
      scrollHeight: { get: () => 64 }
    });
    vi.spyOn(text, "getBoundingClientRect").mockReturnValue({ width: 200, top: 0 } as DOMRect);
    vi.spyOn(document, "createRange").mockReturnValue({
      selectNodeContents: vi.fn(), getBoundingClientRect: () => new DOMRect(0, 0, 200, 64)
    } as unknown as Range);
    fitTranslationBlock(block);
    expect(text.style.fontSize).toBe("16px");
    expect(text.style.lineHeight).toBe("20px");
    expect(text.textContent).toBe("完整译文");
    expect(block.dataset.layoutOverflow).toBe("true");
  });
  it("checks actual browser overflow after estimates and shrinks without dropping text", () => {
    const layer = createLayer();
    const block = createEditableTranslationBlock(layer, {
      id: "fallback-font", text: "Fallback fonts wrap differently from estimated text.", color: "#222",
      fontFamily: "Arial", fontSize: 16, fontWeight: 400, lineHeight: 20,
      left: 0, top: 0, width: 80, height: 20
    });
    layer.append(block);
    const text = block.querySelector<HTMLElement>(".translation-block-text")!;
    Object.defineProperties(text, {
      clientWidth: { get: () => 80 }, clientHeight: { get: () => 20 }, scrollWidth: { get: () => 80 },
      scrollHeight: { get: () => Number.parseFloat(text.style.fontSize) > 10 ? 40 : 20 }
    });
    vi.spyOn(text, "getBoundingClientRect").mockReturnValue({ width: 80, top: 0 } as DOMRect);
    vi.spyOn(document, "createRange").mockReturnValue({
      selectNodeContents: vi.fn(), getBoundingClientRect: () => ({ top: 0 })
    } as unknown as Range);
    fitTranslationBlock(block);
    expect(Number.parseFloat(text.style.fontSize)).toBeLessThanOrEqual(10);
    expect(text.scrollHeight).toBe(text.clientHeight);
    expect(text.textContent).toBe("Fallback fonts wrap differently from estimated text.");
  });

  it("does not halve the font when a tiny reduction removes one wrapped line", () => {
    const layer = createLayer();
    const block = createEditableTranslationBlock(layer, {
      id: "wrap-threshold", text: "边界附近的译文", color: "#222", fontFamily: "Arial", fontSize: 16,
      fontWeight: 400, lineHeight: 20, left: 0, top: 0, width: 80, height: 20
    });
    layer.append(block);
    const text = block.querySelector<HTMLElement>(".translation-block-text")!;
    Object.defineProperties(text, {
      clientWidth: { get: () => 80 }, clientHeight: { get: () => 20 }, scrollWidth: { get: () => 80 },
      scrollHeight: { get: () => Number.parseFloat(text.style.fontSize) > 15.8 ? 40 : 20 }
    });
    vi.spyOn(text, "getBoundingClientRect").mockReturnValue({ width: 80, top: 0 } as DOMRect);
    vi.spyOn(document, "createRange").mockReturnValue({
      selectNodeContents: vi.fn(), getBoundingClientRect: () => ({ top: 0 })
    } as unknown as Range);
    fitTranslationBlock(block);
    expect(Number.parseFloat(text.style.fontSize)).toBeGreaterThan(15.7);
    expect(Number.parseFloat(text.style.fontSize)).toBeLessThanOrEqual(15.8);
  });

  it("adjusts font size, line spacing and inline formulas together using the PDF scale", () => {
    const layer = createLayer();
    const block = createEditableTranslationBlock(layer, {
      id: "manual-font", text: "译文", color: "#222", fontFamily: "Arial", fontSize: 20, fontSizeStep: 2,
      fontWeight: 400, lineHeight: 24, left: 0, top: 0, width: 300, height: 80
    });
    layer.append(block);
    const text = block.querySelector<HTMLElement>(".translation-block-text")!;
    const formula = document.createElement("canvas");
    formula.className = "pdf-inline-formula";
    formula.style.cssText = "width: 40px; height: 24px; vertical-align: -4px";
    text.append(formula);
    block.querySelector<HTMLButtonElement>('[aria-label="增大字号"]')!.click();
    expect(Number.parseFloat(text.style.fontSize)).toBe(22);
    expect(Number.parseFloat(text.style.lineHeight)).toBeCloseTo(26.4);
    expect(Number.parseFloat(formula.style.width)).toBe(44);
    expect(Number.parseFloat(formula.style.verticalAlign)).toBeCloseTo(-4.4);
    block.querySelector<HTMLButtonElement>('[aria-label="减小字号"]')!.click();
    expect(Number.parseFloat(text.style.fontSize)).toBe(20);
    expect(Number.parseFloat(formula.style.width)).toBe(40);
  });

  it("uses spare vertical space on manual enlargement without entering the next block", () => {
    const layer = createLayer();
    const options = {
      text: "译文", color: "#222", fontFamily: "Arial", fontSize: 20, fontWeight: 400, lineHeight: 24,
      left: 0, top: 20, width: 300, height: 80
    };
    const block = createEditableTranslationBlock(layer, { ...options, id: "enlarge" });
    const next = createEditableTranslationBlock(layer, { ...options, top: 110, id: "next" });
    layer.append(block, next);
    Object.defineProperty(block.querySelector(".translation-block-text"), "scrollHeight", { get: () => 100 });
    block.querySelector<HTMLButtonElement>('[aria-label="增大字号"]')!.click();
    expect(block.style.height).toBe("89px");
    expect(next.style.top).toBe("110px");
  });

  it("keeps editor scrollbars hidden until the text is focused", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/pdf/styles.css"), "utf8");

    expect(styles).toMatch(/\.translation-block-text\s*{[^}]*overflow: hidden;[^}]*scrollbar-width: none;/s);
    expect(styles).toMatch(/\.translation-block-text:focus\s*{[^}]*overflow: auto;[^}]*scrollbar-width: thin;/s);
  });

  it("does not render page labels over the PDF", () => {
    const source = readFileSync(resolve(process.cwd(), "src/pdf/index.ts"), "utf8");
    const html = readFileSync(resolve(process.cwd(), "pdf.html"), "utf8");
    const styles = readFileSync(resolve(process.cwd(), "src/pdf/styles.css"), "utf8");

    expect(source).not.toContain("page-label");
    expect(source).not.toContain("createPageLabel");
    expect(html).not.toContain("column-headings");
    expect(styles).not.toContain(".column-headings");
  });

  it("uses compact horizontal spacing around the PDF columns", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/pdf/styles.css"), "utf8");

    expect(styles).toContain("padding: 0 clamp(6px, 0.8vw, 14px) 80px;");
    expect(styles).toContain("gap: clamp(8px, 1vw, 14px);");
  });

  it("shows the PDF filename and page count on one line", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/pdf/styles.css"), "utf8");

    expect(styles).toMatch(/\.document-summary\s*{[^}]*display: flex;[^}]*align-items: baseline;/s);
    expect(styles).toMatch(/\.document-summary span\s*{[^}]*white-space: nowrap;/s);
  });

  it("supports inline editing and deletion", () => {
    const layer = createLayer();
    const onTextChange = vi.fn();
    const onDelete = vi.fn();
    const block = createEditableTranslationBlock(layer, {
      id: "page-1-text-1",
      text: "初始译文",
      color: "#222",
      fontFamily: "Arial",
      fontSize: 18,
      fontWeight: 400,
      lineHeight: 22,
      left: 100,
      top: 120,
      width: 300,
      height: 80,
      onTextChange,
      onDelete
    });
    layer.append(block);

    const editor = block.querySelector<HTMLElement>(".translation-block-text")!;
    const moveHandle = block.querySelector<HTMLButtonElement>(".translation-block-move")!;
    expect(moveHandle.querySelector("svg")?.dataset.icon).toBe("cursor-move");
    expect(moveHandle.getAttribute("aria-label")).toBe("移动译文块");
    expect(editor.contentEditable).toBe("true");
    editor.textContent = "人工修订后的译文";
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onTextChange).toHaveBeenCalledWith("人工修订后的译文");

    block.querySelector<HTMLButtonElement>(".translation-block-delete")!.click();
    expect(onDelete).toHaveBeenCalledOnce();
    expect(layer.contains(block)).toBe(false);
  });

  it("moves and resizes in PDF-layer coordinates", () => {
    const layer = createLayer();
    const block = createEditableTranslationBlock(layer, {
      id: "page-1-text-2",
      text: "可移动译文",
      color: "#222",
      fontFamily: "Arial",
      fontSize: 18,
      fontWeight: 400,
      lineHeight: 22,
      left: 100,
      top: 120,
      width: 300,
      height: 80
    });
    layer.append(block);

    dispatchPointer(block.querySelector<HTMLElement>(".translation-block-move")!, "pointerdown", 100, 100);
    dispatchPointer(window, "pointermove", 150, 125);
    dispatchPointer(window, "pointerup", 150, 125);
    expect(block.style.left).toBe("200px");
    expect(block.style.top).toBe("170px");

    dispatchPointer(block.querySelector<HTMLElement>(".translation-block-resize")!, "pointerdown", 200, 200);
    dispatchPointer(window, "pointermove", 250, 225);
    dispatchPointer(window, "pointerup", 250, 225);
    expect(block.style.width).toBe("400px");
    expect(block.style.height).toBe("130px");
  });
});

function createLayer(): HTMLElement {
  const layer = document.createElement("div");
  layer.style.width = "1000px";
  layer.style.height = "1000px";
  vi.spyOn(layer, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    right: 500,
    bottom: 500,
    left: 0,
    width: 500,
    height: 500,
    toJSON: () => ({})
  });
  document.body.append(layer);
  return layer;
}

function dispatchPointer(
  target: EventTarget,
  type: string,
  clientX: number,
  clientY: number
): void {
  target.dispatchEvent(new MouseEvent(type, {
    bubbles: true,
    button: 0,
    clientX,
    clientY
  }));
}
