// The storage backend selector and its default. A LEAF: it imports nothing, so any module can import
// it without joining a cycle. It was moved out of `workspace.ts` (open-followups §92) because
// `settings-types.ts` needs the VALUE `defaultStorageConfig`, and importing it from `workspace.ts`
// closed the settings-types → workspace → document-model → settings-types cycle, in which a
// module-scope snapshot of an imported value captures it half-initialised. Keep it import-free.

export type StorageConfig =
  | { kind: "browser" }
  | { kind: "local-json" }
  | { kind: "local-csv" }
  | { kind: "local-md" }
  | {
      kind: "sp-json";
      hostname: string;
      sitePath: string;
      itemPath: string;
    }
  | {
      kind: "sp-csv";
      hostname: string;
      sitePath: string;
      itemPath: string;
    }
  | { kind: "turso" };

export const defaultStorageConfig: StorageConfig = { kind: "browser" };
