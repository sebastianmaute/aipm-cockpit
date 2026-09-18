// Pure, i18n-free: decide whether a JSON text is this app's native workspace.
// Uses the SAME strict decoder as "Load project from file", so the two paths
// cannot disagree on what a valid workspace file is.
import { jsonToWorkspace, WorkspaceParseError, type Workspace } from "./workspace";

export type NativeWorkspaceResult =
  | { kind: "workspace"; workspace: Workspace }
  | { kind: "not-workspace" }
  | { kind: "invalid"; reason: "parse" | "shape" };

/** Our shape = a JSON object that carries BOTH `tasks` and `raid` keys (the
 *  pair `jsonToWorkspace` requires). Any other JSON is a document for Claude. */
function looksLikeWorkspace(parsed: unknown): boolean {
  return !!parsed && typeof parsed === "object" && !Array.isArray(parsed)
    && "tasks" in parsed && "raid" in parsed;
}

export function parseNativeWorkspace(text: string): NativeWorkspaceResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: "invalid", reason: "parse" };
  }
  if (!looksLikeWorkspace(parsed)) return { kind: "not-workspace" };
  try {
    return { kind: "workspace", workspace: jsonToWorkspace(text, { strict: true }) };
  } catch (err) {
    return { kind: "invalid", reason: err instanceof WorkspaceParseError ? err.reason : "shape" };
  }
}

export function isJsonFile(file: { name: string; type: string }): boolean {
  return file.name.toLowerCase().endsWith(".json") || file.type.trim().toLowerCase() === "application/json";
}
