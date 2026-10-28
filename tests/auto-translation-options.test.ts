// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { setupAutoTranslationControls } from "../src/options/auto-translation";
import { normalizeAutoTranslation } from "../src/shared/auto-translation";
import { normalizeSettings } from "../src/shared/settings";

afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  document.documentElement.replaceChildren();
});

it("preserves exclusions when editing site drafts and supports explicitly cancelling them", () => {
  document.open();
  document.write(readFileSync(resolve(process.cwd(), "options.html"), "utf8"));
  document.close();
  const controls = setupAutoTranslationControls(document.querySelector<HTMLElement>("#autoTranslationSettings")!);
  const original = normalizeAutoTranslation({ enabled: true, nonTargetLanguage: true, presetSites: ["github.com"],
    customSites: [{ id: "one", pattern: "example.com", enabled: true }], excludedSites: ["example.com", "localhost:4321"] });
  controls.render(original);
  expect(controls.read()).toEqual(original);
  const field = [...document.querySelectorAll<HTMLInputElement>(".auto-site-pattern")].find(input => input.value === "example.com")!;
  field.value = "other.test"; field.dispatchEvent(new Event("input", { bubbles: true }));
  const saved = normalizeSettings({ autoTranslation: controls.read() }).autoTranslation!;
  expect(saved.excludedSites).toEqual(original.excludedSites);
  expect(saved.customSites).toEqual([{ id: "one", pattern: "other.test", enabled: true }]);
  document.querySelector<HTMLButtonElement>('[aria-label="取消排除 example.com"]')!.click();
  expect(controls.read().excludedSites).toEqual(["localhost:4321"]);
  document.querySelector<HTMLButtonElement>('[aria-label="取消排除 localhost:4321"]')!.click();
  expect(controls.read().excludedSites).toBeUndefined();
  expect(controls.read().nonTargetLanguage).toBe(true);
});
