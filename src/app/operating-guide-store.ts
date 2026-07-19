// src/app/operating-guide-store.ts — dual-backend CRUD for operating guides.
// config === null  -> localStorage (always-available default)
// config !== null  -> global Turso table (cross-device), out of TABLE_NAMES.
import { readDeviceJson } from "./device-store";
import { runTursoPipeline } from "./turso-pipeline";
import {
  OPERATING_GUIDE_DDL, guideSelect, upsertStatements, deleteStatements, rowsToGuides,
} from "./operating-guide-schema";
import type { SqlStmt } from "./turso-schema";
import type { TursoConfig } from "./turso-config";
import type { OperatingGuide } from "./operating-guide";

export const LOCAL_KEY = "aipm-cockpit:operating-guides";

const ddl = (): SqlStmt[] => OPERATING_GUIDE_DDL.map((sql) => ({ sql }));

function readLocal(): OperatingGuide[] {
  const v = readDeviceJson<unknown>(LOCAL_KEY, null);
  return Array.isArray(v) ? (v as OperatingGuide[]) : [];
}
function writeLocal(list: OperatingGuide[]): void {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(list));
}

export async function loadGuides(config: TursoConfig | null): Promise<OperatingGuide[]> {
  if (!config) return readLocal();
  const results = await runTursoPipeline(config, [...ddl(), ...guideSelect()]);
  return rowsToGuides(results[OPERATING_GUIDE_DDL.length]);
}

export async function saveGuide(config: TursoConfig | null, g: OperatingGuide): Promise<void> {
  if (!config) {
    const list = readLocal().filter((x) => x.id !== g.id);
    writeLocal([...list, g]);
    return;
  }
  const now = new Date().toISOString();
  await runTursoPipeline(config, [...ddl(), ...upsertStatements(g, now)]);
}

export async function removeGuide(config: TursoConfig | null, id: string): Promise<void> {
  if (!config) {
    writeLocal(readLocal().filter((x) => x.id !== id));
    return;
  }
  await runTursoPipeline(config, [...ddl(), ...deleteStatements(id)]);
}
