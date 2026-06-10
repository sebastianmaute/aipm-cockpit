// Pure helpers for the project switch / create / load-from-file flows.
//
// The stateful functions (switchToProject / createProject / loadProjectFromFile)
// live inside `use-storage-backend.ts` because they need the active backend, the
// suppress refs, `setStorageConfig`, and every workspace setter — all of which
// are local to that hook. These pure helpers are extracted here so they can be
// unit-tested in isolation, with NO side-effects (no crypto, no IO, no Date).

import type { ProjectRegistryEntry } from "./projects-registry";
import type { LocalStorageFormat, StorageConfig } from "./storage";
import type { ProjectMeta } from "./types";

/** Maps a user-facing file format to the matching local storage kind. */
export function localKindForFormat(
  format: LocalStorageFormat,
): Extract<StorageConfig["kind"], "local-json" | "local-csv" | "local-md"> {
  switch (format) {
    case "json":
      return "local-json";
    case "csv":
      return "local-csv";
    case "md":
      return "local-md";
  }
}

/** Strips path / drive separators and a trailing extension from a picked file
 *  name so it can stand in as a human label when a workspace carries no project
 *  meta. Returns "" for an empty / undefined name. */
export function projectNameFromFileName(fileName: string | undefined): string {
  if (!fileName) return "";
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const dot = base.lastIndexOf(".");
  return (dot > 0 ? base.slice(0, dot) : base).trim();
}

/**
 * Build the registry entry for a project loaded from an arbitrary file.
 *
 * Name/code come from the loaded workspace's `project` meta when present;
 * otherwise the file name is used for the name and the code falls back to "".
 * The id and storageConfig are supplied by the caller (id via crypto in the UI
 * layer; storageConfig from the chosen local kind) so this stays pure.
 */
export function deriveRegistryEntry(args: {
  id: string;
  storageConfig: StorageConfig;
  project: ProjectMeta | undefined;
  fileName: string | undefined;
}): ProjectRegistryEntry {
  const { id, storageConfig, project, fileName } = args;
  const fallbackName = projectNameFromFileName(fileName);
  const name = project?.name?.trim() || fallbackName || "Untitled project";
  const code = project?.code?.trim() ?? "";
  return { id, name, code, storageConfig };
}
