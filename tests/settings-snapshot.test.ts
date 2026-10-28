import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/shared/defaults";
import { createSettingsSnapshot } from "../src/shared/settings-snapshot";
import type { ExtensionSettings } from "../src/shared/types";

describe("settings snapshots", () => {
  it("uses a storage notification instead of an older in-flight read", async () => {
    let finish!: (settings: ExtensionSettings) => void;
    const snapshot = createSettingsSnapshot(() => new Promise(resolve => { finish = resolve; }));
    const read = snapshot.read();
    const incoming = { ...structuredClone(DEFAULT_SETTINGS), autoTranslation: { enabled: true, nonTargetLanguage: true, presetSites: [], customSites: [] } };
    snapshot.receive(incoming);
    finish(structuredClone(DEFAULT_SETTINGS));
    expect((await read).autoTranslation?.enabled).toBe(true);
    incoming.autoTranslation.enabled = false;
    expect(snapshot.current()?.autoTranslation?.enabled).toBe(true);
  });

  it("does not let an earlier request replace a later completed read", async () => {
    const replies: Array<(settings: ExtensionSettings) => void> = [];
    const snapshot = createSettingsSnapshot(() => new Promise(resolve => { replies.push(resolve); }));
    const earlier = snapshot.read();
    const later = snapshot.read();
    replies[1]({ ...structuredClone(DEFAULT_SETTINGS), targetLang: "ja" });
    await later;
    replies[0](structuredClone(DEFAULT_SETTINGS));
    expect((await earlier).targetLang).toBe("ja");
    const copy = snapshot.current()!;
    copy.targetLang = "fr";
    expect(snapshot.current()?.targetLang).toBe("ja");
  });
});
