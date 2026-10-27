import { describe, expect, it } from "vitest";
import {
  groupDoubaoSegments,
  reassembleDoubaoSegments,
  segmentDoubaoTexts
} from "../src/background/doubao-segmentation";

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
  });

  it("enforces the character cap when the item count alone would fit", () => {
    const parts = segmentDoubaoTexts(["abcdefghij", "klmnopqrst", "uvwxyz"], 20);
    expect(groupDoubaoSegments(parts, 20, 10)).toEqual([[0, 1], [2]]);
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

  it("rejects invalid limits and invalid source mapping", () => {
    expect(() => segmentDoubaoTexts(["one"], 0)).toThrow(RangeError);
    expect(() => groupDoubaoSegments([], 2000, 0)).toThrow(RangeError);
    expect(() => groupDoubaoSegments([{ sourceIndex: 0, text: "long", translate: true }], 2)).toThrow();
    expect(() => reassembleDoubaoSegments(1, [{ sourceIndex: 1, text: "one", translate: false }], new Map())).toThrow();
  });
});
