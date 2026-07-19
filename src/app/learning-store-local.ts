import { readDeviceJson, writeDeviceJson } from "./device-store";
import { EMPTY_SNAPSHOT, type LearningSnapshot, type LearningStore } from "./learning-store";

const KEY = "aipm-cockpit:action-learning";

export function localLearningStore(): LearningStore {
  return {
    async load(): Promise<LearningSnapshot> {
      const p = readDeviceJson<unknown>(KEY, null);
      if (!p || typeof p !== "object") return { ...EMPTY_SNAPSHOT };
      const obj = p as { state?: LearningSnapshot["state"]; overrides?: LearningSnapshot["overrides"] };
      return { state: obj.state ?? {}, overrides: obj.overrides ?? {} };
    },
    async save(snap: LearningSnapshot): Promise<void> {
      writeDeviceJson(KEY, snap);
    },
  };
}
