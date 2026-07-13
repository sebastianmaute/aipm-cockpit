// src/app/undo/capture-field-changes.ts
import type { Dispatch, SetStateAction } from "react";
import type { ActivityKind } from "../activity-log";
import { changedFieldGroups, type FieldGroup } from "./field-groups";
import type { UndoStackApi } from "./use-undo-stack";

export interface CaptureFieldChangesOpts<T extends { id: number }> {
  setter: Dispatch<SetStateAction<readonly T[]>>;
  kind: ActivityKind;
  id: number;
  prev: T;
  next: T;
  groups: readonly FieldGroup<T>[];
  stampField?: keyof T & string;
}

/**
 * Diff prev→next, partition into logical field-groups, and push one undo entry
 * per changed group via captureFieldEdit. A no-op when captureFieldEdit is
 * undefined (popout / caller that opted out) or nothing changed.
 */
export function captureFieldChanges<T extends { id: number }>(
  captureFieldEdit: UndoStackApi["captureFieldEdit"] | undefined,
  opts: CaptureFieldChangesOpts<T>,
): void {
  if (!captureFieldEdit) return;
  const { setter, kind, id, prev, next, groups, stampField } = opts;
  for (const { before, after } of changedFieldGroups(prev, next, groups)) {
    captureFieldEdit({ setter, kind, id, before, after, stampField });
  }
}
