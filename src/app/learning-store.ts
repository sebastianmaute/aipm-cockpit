import type { LearningState, LearningOverrides } from "./action-learning";
export interface LearningSnapshot { state: LearningState; overrides: LearningOverrides }
export const EMPTY_SNAPSHOT: LearningSnapshot = { state: {}, overrides: {} };
export interface LearningStore {
  load(): Promise<LearningSnapshot>;
  save(snap: LearningSnapshot): Promise<void>;
}

import type { TursoConfig } from "./turso-config";
import type { NextActionsLearningConfig } from "./settings-types";
import { localLearningStore } from "./learning-store-local";
import { tursoLearningStore } from "./learning-store-turso";

export function pickLearningStore(cfg: NextActionsLearningConfig, tursoConfig: TursoConfig | null): LearningStore {
  if (cfg.store === "turso" && tursoConfig !== null) return tursoLearningStore(tursoConfig);
  return localLearningStore();
}
