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

const usesTurso = (cfg: NextActionsLearningConfig, tursoConfig: TursoConfig | null): tursoConfig is TursoConfig =>
  cfg.store === "turso" && tursoConfig !== null;

export function pickLearningStore(cfg: NextActionsLearningConfig, tursoConfig: TursoConfig | null): LearningStore {
  if (usesTurso(cfg, tursoConfig)) return tursoLearningStore(tursoConfig);
  return localLearningStore();
}

/** The identity of the store `pickLearningStore` picks: "local", or "turso:<url>".
 *  `useActionLearning` reloads when it changes (§781). */
export function learningStoreKey(cfg: NextActionsLearningConfig, tursoConfig: TursoConfig | null): string {
  return usesTurso(cfg, tursoConfig) ? `turso:${tursoConfig.httpUrl}` : "local";
}
