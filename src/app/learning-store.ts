import type { LearningState, LearningOverrides } from "./action-learning";
export interface LearningSnapshot { state: LearningState; overrides: LearningOverrides }
export const EMPTY_SNAPSHOT: LearningSnapshot = { state: {}, overrides: {} };
export interface LearningStore {
  load(): Promise<LearningSnapshot>;
  save(snap: LearningSnapshot): Promise<void>;
}
