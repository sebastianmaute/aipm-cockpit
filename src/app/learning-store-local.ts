import { EMPTY_SNAPSHOT, type LearningSnapshot, type LearningStore } from "./learning-store";

const KEY = "aipm-cockpit:action-learning";

export function localLearningStore(): LearningStore {
  return {
    async load(): Promise<LearningSnapshot> {
      if (typeof localStorage === "undefined") return { ...EMPTY_SNAPSHOT };
      try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return { ...EMPTY_SNAPSHOT };
        const p = JSON.parse(raw);
        if (!p || typeof p !== "object") return { ...EMPTY_SNAPSHOT };
        return { state: p.state ?? {}, overrides: p.overrides ?? {} };
      } catch { return { ...EMPTY_SNAPSHOT }; }
    },
    async save(snap: LearningSnapshot): Promise<void> {
      if (typeof localStorage === "undefined") return;
      try { localStorage.setItem(KEY, JSON.stringify(snap)); } catch { /* quota — non-fatal */ }
    },
  };
}
