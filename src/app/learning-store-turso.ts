// src/app/learning-store-turso.ts — LearningStore backed by the shared Turso
// pipeline. Every call prepends LEARNING_DDL (CREATE TABLE IF NOT EXISTS); save
// is a full rewrite (DELETE then re-insert) of the GLOBAL action_learning table.
import { runTursoPipeline } from "./turso-pipeline";
import { LEARNING_DDL, learningSelect, learningUpsert, learningDeleteAll, rowsToSnapshot } from "./learning-schema";
import type { SqlStmt } from "./turso-schema";
import type { TursoConfig } from "./turso-config";
import type { LearningSnapshot, LearningStore } from "./learning-store";

const ddl = (): SqlStmt[] => LEARNING_DDL.map((sql) => ({ sql }));

export function tursoLearningStore(config: TursoConfig): LearningStore {
  return {
    async load(): Promise<LearningSnapshot> {
      const results = await runTursoPipeline(config, [...ddl(), ...learningSelect()]);
      const selected = results[LEARNING_DDL.length];
      // §781 — a missing SELECT result is a failed load, never an empty table: the
      // next save is a full rewrite and would replace every stored row.
      if (!selected) throw new Error("action_learning: the select result is missing");
      return rowsToSnapshot(selected);
    },
    async save(snap: LearningSnapshot): Promise<void> {
      const upserts = Object.entries(snap.state).flatMap(([kind, s]) =>
        learningUpsert(kind, s, snap.overrides[kind] ?? "auto"));
      const extra = Object.entries(snap.overrides)
        .filter(([k]) => !snap.state[k])
        .flatMap(([k, ov]) => learningUpsert(k, { acted: 0, snoozed: 0, dismissed: 0, lastAt: 0 }, ov));
      await runTursoPipeline(config, [...ddl(), ...learningDeleteAll(), ...upserts, ...extra]);
    },
  };
}
