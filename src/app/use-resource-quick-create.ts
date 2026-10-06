// src/app/use-resource-quick-create.ts
//
// Creating a resource from outside the Resources view: the picker's "+ Add"
// row (a one-step create from a typed name and email), the task editor's
// "add assignee to address book" (opens the resource modal seeded from the
// typed name and, on save, writes the new person back into the task form as
// its assignee), and the save/close wrappers that clear that pending fill.
// Extracted from task-manager.tsx (§491); move-only.
//
// ★ It keeps the inline `useCallback` memoization on purpose, against
// Extraction convention 1 (non-memoized handlers): `handleCreateResource` is in
// the dependency arrays of the `assignOwnerBundle` and `escalateBundle` memos in
// `use-action-center-handlers.ts`, so an unstable one would rebuild both on every
// render. The dependency arrays are the inline ones, unchanged.
"use client";
import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import type { ActivityKind } from "./activity-log";
import type { Resource } from "./types";
import type { TaskFormDraft } from "./task-form-context";
import { splitName, resourceDisplayName } from "./resource-foundation";
import { creatableResourceEmail } from "./resource-create-email";
import { mintId } from "./id-mint-session";

export interface ResourceQuickCreateDeps {
  resources: readonly Resource[];
  setResources: Dispatch<SetStateAction<readonly Resource[]>>;
  logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;
  /** The resource directory's modal opener, seeded with a draft. */
  handleOpenAddResource: (seed?: Partial<Resource>) => void;
  handleSaveResource: (next: Resource) => void;
  handleCloseResourceModal: () => void;
  setForm: Dispatch<SetStateAction<TaskFormDraft>>;
}

export function useResourceQuickCreate(deps: ResourceQuickCreateDeps) {
  const { resources, setResources, logActivity, handleOpenAddResource, handleSaveResource, handleCloseResourceModal, setForm } = deps;

  const [fillTaskAssigneeOnSave, setFillTaskAssigneeOnSave] = useState(false);

  const handleAddAssigneeToAddressBook = useCallback((name: string, email: string) => {
    const { firstName, lastName } = splitName(name);
    setFillTaskAssigneeOnSave(true);
    handleOpenAddResource({ firstName, lastName, email: email.trim() || undefined });
  }, [handleOpenAddResource]);

  const handleCreateResource = useCallback(
    (name: string, email: string): number => {
      const { firstName, lastName } = splitName(name);
      const id = mintId("resource", resources);
      // Mirror handleSaveResource's new-resource commit: stamp localModifiedAt
      // (change-tracking / Turso sync) and log resource.created for activity-log
      // completeness — a picker-created person must behave like a Resources-view one.
      setResources((prev) => [
        ...prev,
        { id, firstName, lastName, email: creatableResourceEmail(email), roleId: null, utilizationMode: "percent", utilization: {}, localModifiedAt: new Date().toISOString() },
      ]);
      logActivity("resource.created", id, `${firstName} ${lastName}`.trim());
      return id;
    },
    [resources, setResources, logActivity],
  );

  const handleSaveResourceFromAnywhere = useCallback((next: Resource) => {
    handleSaveResource(next);
    if (fillTaskAssigneeOnSave) {
      setForm((prev) => ({ ...prev, assignee: resourceDisplayName(next), assigneeEmail: next.email ?? "" }));
      setFillTaskAssigneeOnSave(false);
    }
  }, [handleSaveResource, fillTaskAssigneeOnSave, setForm]);

  const handleCloseResourceFromAnywhere = useCallback(() => {
    handleCloseResourceModal();
    setFillTaskAssigneeOnSave(false);
  }, [handleCloseResourceModal]);

  return { handleAddAssigneeToAddressBook, handleCreateResource, handleSaveResourceFromAnywhere, handleCloseResourceFromAnywhere };
}
