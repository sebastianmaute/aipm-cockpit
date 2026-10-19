// src/app/chat-tools-project.ts — routing and the guards for `get_project` and `update_project` (§715).
// The dispatcher members are implemented in use-chat-dispatcher.ts; this module owns what stands in front of
// them, like chat-tools-forecast.ts: the token, and the per-field judge (`applyProjectPatch`).

import { entityToken } from "./ai-entity-token";
import { requireToken } from "./chat-tools-updates";
import { applyProjectPatch, PROJECT_AI_FIELDS, type ProjectAiField } from "./project-ai-fields";
import type { ProjectMeta } from "./types";

export type ProjectToolDispatcher = {
  /** The stored record, or null while no project is open. */
  getProjectMeta(): ProjectMeta | null;
  /** Writes the whole judged record and resolves with it as stored. Rejects with `Error(<message the model can
   *  relay>)` on failure, and in a read-only window. */
  updateProjectMeta(next: ProjectMeta): Promise<ProjectMeta>;
};

/** Returned by `runProjectTool` for a name it does not own. */
export const NOT_PROJECT_TOOL: unique symbol = Symbol("not-project-tool");

const NO_PROJECT_MESSAGE = "No project is open, so there is no project record to read or change.";

/** The offered fields only, so a read never hands out contact persons or the other hand-edited keys. An absent
 *  optional field reads as "", the value that clears it on a write. */
function offeredFields(meta: ProjectMeta): Record<ProjectAiField, unknown> {
  const out = {} as Record<ProjectAiField, unknown>;
  for (const field of PROJECT_AI_FIELDS) out[field] = meta[field] ?? "";
  return out;
}

function requireProject(d: ProjectToolDispatcher): ProjectMeta {
  const meta = d.getProjectMeta();
  if (!meta) throw new Error(NO_PROJECT_MESSAGE);
  return meta;
}

async function getProject(d: ProjectToolDispatcher) {
  const meta = requireProject(d);
  return { ...offeredFields(meta), expectedToken: entityToken("project", meta) };
}

/** ★ Token BEFORE the judge, so a stale call reports the token and nothing else. A patch whose every field is
 *  refused (or that names none) writes nothing: the stored record comes back unchanged with the reasons. */
async function updateProject(input: Record<string, unknown>, d: ProjectToolDispatcher) {
  const stored = requireProject(d);
  requireToken("project", stored, input, "project");
  const { next, rows, unknownKeys } = applyProjectPatch(stored, input);
  const refused = rows.flatMap((r) => (r.verdict.kind === "refused" ? [{ field: r.field, reason: r.verdict.reason }] : []));
  const writes = rows.some((r) => r.verdict.kind !== "refused");
  const project = writes ? await d.updateProjectMeta(next) : stored;
  return { project: offeredFields(project), refused, ignored: unknownKeys };
}

export function runProjectTool(
  name: string,
  input: Record<string, unknown>,
  d: ProjectToolDispatcher,
): Promise<unknown> | typeof NOT_PROJECT_TOOL {
  switch (name) {
    case "get_project":
      return getProject(d);
    case "update_project":
      return updateProject(input, d);
    default:
      return NOT_PROJECT_TOOL;
  }
}
