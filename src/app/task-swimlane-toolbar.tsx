"use client";
// src/app/task-swimlane-toolbar.tsx — the swimlane view's add-lane control.
// Extracted from tasks-section.tsx to keep that file under the size ratchet.
import { type Lang, t } from "./i18n";
import { Select } from "./form-controls";
import { resourceDisplayName } from "./resource-foundation";
import type { Resource } from "./types";

export function TaskSwimlaneToolbar({
  lang,
  resources,
  laneResourceIds,
  onAddLane,
}: {
  lang: Lang;
  resources: readonly Resource[];
  /** Resource ids that already have a lane — excluded from the options. */
  laneResourceIds: readonly number[];
  onAddLane: (resourceId: number) => void;
}) {
  const taken = new Set(laneResourceIds);
  const options = resources.filter((r) => !taken.has(r.id));
  return (
    <Select
      size="xs"
      value=""
      aria-label={t(lang, "swimlaneAddLane")}
      title={t(lang, "swimlaneAddLane")}
      onChange={(e) => {
        const id = Number(e.target.value);
        if (id) onAddLane(id);
      }}
    >
      <option value="">{t(lang, "swimlaneAddLane")}</option>
      {options.map((r) => (
        <option key={r.id} value={r.id}>{resourceDisplayName(r)}</option>
      ))}
    </Select>
  );
}
