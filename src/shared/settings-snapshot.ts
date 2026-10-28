import type { ExtensionSettings } from "./types";

/** Storage notifications take precedence over reads that were already in flight. */
export function createSettingsSnapshot(load: () => Promise<ExtensionSettings>): {
  read: () => Promise<ExtensionSettings>;
  receive: (settings: ExtensionSettings) => void;
  current: () => ExtensionSettings | undefined;
} {
  let latest: ExtensionSettings | undefined;
  let revision = 0;
  let nextRead = 0;
  let completedRead = 0;
  return {
    receive(settings) {
      latest = structuredClone(settings);
      revision++;
    },
    current: () => latest && structuredClone(latest),
    async read() {
      const started = revision;
      const request = ++nextRead;
      const settings = await load();
      if (started === revision && request > completedRead) {
        latest = structuredClone(settings);
        completedRead = request;
      }
      return structuredClone(latest ?? settings);
    }
  };
}
