import { jsonToWorkspace, workspaceToJson, type Workspace } from "./workspace";
import { scaleWorkspace } from "./scale-workspace";

/**
 * The scaled demo datasets derived from `sample-workspace-small.json`.
 * Shared by `scripts/generate-sample-workspace.ts` (writes them) and
 * `sample-workspace-variants.test.ts` (checks the committed files against
 * them), so the two cannot disagree about the pipeline.
 */
export const SCALED_VARIANTS: ReadonlyArray<{ name: string; factor: number }> = [
  { name: "big", factor: 3 },
  { name: "huge", factor: 10 },
];

/** Decode the master strictly: a corrupt master must fail loudly. */
export function decodeSampleMaster(masterJson: string): Workspace {
  const ws = jsonToWorkspace(masterJson, { strict: true });
  if (!ws.tasks.length || !ws.raid.length) {
    throw new Error("jsonToWorkspace returned an empty workspace — check sample-workspace-small.json.");
  }
  return ws;
}

/** Scale the decoded master and encode it exactly as the generator writes it. */
export function scaleSample(ws: Workspace, factor: number): { scaled: Workspace; json: string } {
  const scaled = scaleWorkspace(ws, factor);
  return { scaled, json: workspaceToJson(scaled) };
}
