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

/** FNV-1a (32-bit) of the token: it tells two tokens apart without holding either. */
function tokenFingerprint(token: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

/** The identity of the learning store (§781): "local", or "turso:<url>#<token fingerprint>",
 *  so a rotated token is a new identity and `useActionLearning` reads the store again
 *  with it. The token itself is never part of the key. `null` when Turso is CHOSEN but
 *  has no usable config yet (a passphrase-locked token, a secret-merge timeout): the hook
 *  then queues writes instead of falling back to the local store, as `pickLearningStore`
 *  would. */
export function learningStoreKey(cfg: NextActionsLearningConfig, tursoConfig: TursoConfig | null): string | null {
  if (cfg.store !== "turso") return "local";
  if (!usesTurso(cfg, tursoConfig)) return null;
  return `turso:${tursoConfig.httpUrl}#${tokenFingerprint(tursoConfig.authToken)}`;
}
