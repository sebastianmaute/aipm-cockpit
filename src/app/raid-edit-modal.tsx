"use client";

// RAID edit modal — create / edit / delete a RaidItem: category/status
// segmented controls, the 5×5 risk matrix picker (Risk items only), the
// linked-task and caused-by autocomplete chip pickers, stakeholder
// checkboxes, and the "create mitigation task" shortcut. Extracted from
// raid-panel.tsx; unlike the standalone sibling modals
// (change-edit-modal.tsx / stakeholder-edit-modal.tsx) the panel owns the
// draft state and passes it down with change callbacks.

import { useEffect, useMemo, useState } from "react";
import { SegmentedControl } from "./segmented-control";
import { DocumentLinksFieldGated } from "./document-links-field-gated";
import { type Lang, t } from "./i18n";
import {
  defaultStatusForCategory,
  riskSeverityFromMatrix,
  statusOptionsFor,
  wouldCreateCycle,
} from "./raid";
import {
  RAID_CATEGORIES,
  RAID_SEVERITIES,
  RISK_SCALES,
  type RaidCategory,
  type RaidItem,
  type RaidSeverity,
  type RaidStatus,
  type Resource,
  type RiskScale,
  type Stakeholder,
  type Task,
} from "./types";
import type { Contact } from "./contacts";
import { ResourcePicker } from "./resource-picker";
import { categoryLabel, severityLabel, statusLabel } from "./raid-labels";
import { CharCounter, useAdjustmentTracker } from "./field-feedback";
import { describeTextCap } from "./sanitize-report";
import { TASK_NAME_MAX, TEXTAREA_MAX, ASSIGNEE_MAX } from "./sanitize";
import { useToastContext } from "./toast-context";

export type RaidEditModalProps = {
  lang: Lang;
  tasks: readonly Task[];
  raid: readonly RaidItem[];
  stakeholdersEnabled: boolean;
  stakeholders: readonly Stakeholder[];
  resources: readonly Resource[];
  contacts: Contact[];
  onCreateResource: (name: string, email: string) => number;
  draft: RaidItem;
  isNew: boolean;
  onChange: (next: RaidItem) => void;
  onApplyStatus: (s: RaidStatus) => void;
  onApplyMatrix: (probability: RiskScale, impact: RiskScale) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onCreateMitigationTask: () => void;
  /** Switch the panel's modal to a different RAID item. Used by the
   *  "Caused by" link and the "Items caused by this" chips. */
  onJumpToRaid: (id: number) => void;
};

export function RaidEditModal({
  lang,
  tasks,
  raid,
  stakeholdersEnabled,
  stakeholders,
  resources,
  contacts,
  onCreateResource,
  draft,
  isNew,
  onChange,
  onApplyStatus,
  onApplyMatrix,
  onSave,
  onCancel,
  onDelete,
  onCreateMitigationTask,
  onJumpToRaid,
}: RaidEditModalProps) {
  const showToast = useToastContext();
  const adj = useAdjustmentTracker();
  const [error, setError] = useState<string | null>(null);
  const [taskPickerQuery, setTaskPickerQuery] = useState("");
  const [causePickerQuery, setCausePickerQuery] = useState("");
  // Category is locked after creation by default (changing it can lose
  // status / matrix data). Users can unlock it with the inline "Advanced"
  // affordance. Re-locks whenever the user navigates to a different item.
  const [categoryUnlocked, setCategoryUnlocked] = useState(false);
  const [prevDraftId, setPrevDraftId] = useState(draft.id);
  if (prevDraftId !== draft.id) {
    setPrevDraftId(draft.id);
    setCategoryUnlocked(false);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const statusOpts = statusOptionsFor(draft.category);

  const availableTasks = useMemo(() => {
    const linked = new Set(draft.linkedTaskIds);
    const q = taskPickerQuery.trim().toLowerCase();
    return tasks
      .filter((tk) => !linked.has(tk.id))
      .filter((tk) => {
        if (!q) return true;
        if (String(tk.id) === q) return true;
        return tk.taskName.toLowerCase().includes(q);
      })
      .slice(0, 20);
  }, [tasks, draft.linkedTaskIds, taskPickerQuery]);

  // RAID items eligible to be added as a cause of this draft. Excludes the
  // draft itself, already-selected parents, and any item whose selection
  // would close a cycle. Filtering happens before the search query is
  // applied so typing can't bring an invalid pick back into view.
  const availableCauses = useMemo(() => {
    const q = causePickerQuery.trim().toLowerCase();
    const selected = new Set(draft.causedByRaidIds);
    return raid
      .filter((r) => r.id !== draft.id)
      .filter((r) => !selected.has(r.id))
      .filter((r) => !wouldCreateCycle(raid, draft.id, r.id))
      .filter((r) => {
        if (!q) return true;
        if (String(r.id) === q) return true;
        return r.title.toLowerCase().includes(q);
      })
      .slice(0, 20);
  }, [raid, draft.id, draft.causedByRaidIds, causePickerQuery]);

  // Items whose `causedByRaidIds` includes this draft — only meaningful for
  // saved items (a brand-new draft can't have caused anything yet).
  const causedChildren = useMemo(() => {
    if (isNew) return [];
    return raid.filter((r) => r.causedByRaidIds.includes(draft.id));
  }, [raid, draft.id, isNew]);

  const parentItems = useMemo(
    () =>
      draft.causedByRaidIds
        .map((id) => raid.find((r) => r.id === id))
        .filter((r): r is RaidItem => !!r),
    [draft.causedByRaidIds, raid],
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.title.trim()) {
      setError(t(lang, "raidErrorTitleRequired"));
      return;
    }
    setError(null);
    adj.reset();
    adj.track(describeTextCap(draft.title, TASK_NAME_MAX));
    adj.track(describeTextCap(draft.description ?? "", TEXTAREA_MAX));
    adj.track(describeTextCap(draft.owner ?? "", ASSIGNEE_MAX));
    adj.track(describeTextCap(draft.mitigation ?? "", TEXTAREA_MAX));
    if (adj.count() > 0) showToast("info", t(lang, "fieldsAdjusted", adj.count()));
    onSave();
  }

  function addLinked(taskId: number) {
    if (draft.linkedTaskIds.includes(taskId)) return;
    onChange({ ...draft, linkedTaskIds: [...draft.linkedTaskIds, taskId] });
    setTaskPickerQuery("");
  }

  function removeLinked(taskId: number) {
    onChange({
      ...draft,
      linkedTaskIds: draft.linkedTaskIds.filter((id) => id !== taskId),
    });
  }

  function addCausedBy(parentId: number) {
    if (parentId === draft.id) {
      setError(t(lang, "raidErrorCausedBySelf"));
      return;
    }
    if (draft.causedByRaidIds.includes(parentId)) return;
    if (wouldCreateCycle(raid, draft.id, parentId)) {
      setError(t(lang, "raidErrorCausedByCycle"));
      return;
    }
    setError(null);
    onChange({
      ...draft,
      causedByRaidIds: [...draft.causedByRaidIds, parentId],
    });
    setCausePickerQuery("");
  }

  function removeCausedBy(parentId: number) {
    onChange({
      ...draft,
      causedByRaidIds: draft.causedByRaidIds.filter((id) => id !== parentId),
    });
  }

  function toggleStakeholder(stakeholderId: number) {
    const ids = draft.stakeholderIds ?? [];
    const next = ids.includes(stakeholderId)
      ? ids.filter((id) => id !== stakeholderId)
      : [...ids, stakeholderId];
    onChange({ ...draft, stakeholderIds: next });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={
        isNew ? t(lang, "raidNewItem") : t(lang, "raidEditItem", draft.id)
      }
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-AIPM-dark-blue/40 p-4 sm:p-10"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex w-[720px] min-w-[460px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-line bg-surface"
      >
        <header className="sticky top-0 z-10 flex shrink-0 items-center justify-between gap-4 border-b border-line bg-surface px-6 py-4">
          <h2 className="text-lg font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
            {isNew ? t(lang, "raidNewItem") : t(lang, "raidEditItem", draft.id)}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label={t(lang, "cancel")}
            className="rounded-md p-2 text-foreground hover:bg-surface-muted hover:text-AIPM-dark-blue"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4">
              <path
                fillRule="evenodd"
                d="M4.28 4.28a.75.75 0 011.06 0L10 8.94l4.66-4.66a.75.75 0 111.06 1.06L11.06 10l4.66 4.66a.75.75 0 11-1.06 1.06L10 11.06l-4.66 4.66a.75.75 0 01-1.06-1.06L8.94 10 4.28 5.34a.75.75 0 010-1.06z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </header>

        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 overflow-y-auto p-6 sm:grid-cols-2">
          <div className="flex flex-col gap-1 text-sm">
            <label className="flex flex-col gap-1">
              <span className="font-medium text-foreground">
                {t(lang, "raidCategory")}
              </span>
              <SegmentedControl<RaidCategory>
                value={draft.category}
                disabled={!isNew && !categoryUnlocked}
                ariaLabel={t(lang, "raidCategory")}
                title={t(lang, "raidFieldCategoryHint")}
                options={RAID_CATEGORIES.map((c) => ({
                  value: c,
                  label: categoryLabel(c, lang),
                }))}
                onChange={(c) => {
                  // Smart status mapping: keep the current status when the
                  // new category still permits it (common values like
                  // "Open", "Closed", "In Progress" appear in multiple
                  // enums). Otherwise fall back to the new category's
                  // default. This makes "change category" feel non-lossy
                  // in the common case (R↔I↔D), while still being correct
                  // for Assumption transitions.
                  const validStatuses = statusOptionsFor(c);
                  const newStatus = validStatuses.includes(draft.status)
                    ? draft.status
                    : defaultStatusForCategory(c);
                  // Risk-only matrix fields: initialize when becoming R,
                  // clear when leaving R.
                  let probability = draft.probability;
                  let impact = draft.impact;
                  let severity = draft.severity;
                  if (c === "R" && (probability === undefined || impact === undefined)) {
                    probability = 3;
                    impact = 3;
                    severity = riskSeverityFromMatrix(probability, impact);
                  } else if (c !== "R" && (probability !== undefined || impact !== undefined)) {
                    probability = undefined;
                    impact = undefined;
                  }
                  onChange({
                    ...draft,
                    category: c,
                    status: newStatus,
                    probability,
                    impact,
                    severity,
                  });
                }}
              />
            </label>
            {!isNew && !categoryUnlocked && (
              <button
                type="button"
                onClick={() => setCategoryUnlocked(true)}
                className="self-start text-[11px] font-medium text-muted-foreground underline-offset-2 hover:text-AIPM-dark-blue hover:underline"
              >
                {t(lang, "raidAdvancedChangeCategory")}
              </button>
            )}
            {!isNew && categoryUnlocked && (
              <span className="text-[11px] italic text-AIPM-purple">
                {t(lang, "raidCategoryChangedWarning")}
              </span>
            )}
          </div>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">
              {t(lang, "raidStatus")}
            </span>
            <SegmentedControl<RaidStatus>
              value={draft.status}
              ariaLabel={t(lang, "raidStatus")}
              title={t(lang, "raidFieldStatusHint")}
              options={statusOpts.map((s) => ({
                value: s,
                label: statusLabel(s, lang),
              }))}
              onChange={(s) => onApplyStatus(s)}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-foreground">
              {t(lang, "raidTitle")} *
            </span>
            <input
              type="text"
              required
              value={draft.title}
              onChange={(e) => onChange({ ...draft, title: e.target.value })}
              onBlur={(e) => onChange({ ...draft, title: describeTextCap(e.target.value, TASK_NAME_MAX).value.trim() })}
              placeholder={t(lang, "raidPlaceholderTitle")}
              title={t(lang, "raidFieldTitleHint")}
              aria-describedby="raid-title-counter"
              className="rounded-md border border-line bg-surface px-3 py-2 text-sm"
            />
            <CharCounter value={draft.title} max={TASK_NAME_MAX} id="raid-title-counter" lang={lang} />
          </label>

          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-foreground">
              {t(lang, "raidDescription")}
            </span>
            <textarea
              rows={2}
              value={draft.description ?? ""}
              onChange={(e) =>
                onChange({ ...draft, description: e.target.value || undefined })
              }
              onBlur={(e) => onChange({ ...draft, description: describeTextCap(e.target.value, TEXTAREA_MAX).value || undefined })}
              placeholder={t(lang, "raidPlaceholderDescription")}
              title={t(lang, "raidFieldDescriptionHint")}
              aria-describedby="raid-description-counter"
              className="rounded-md border border-line bg-surface px-3 py-2 text-sm"
            />
            <CharCounter value={draft.description ?? ""} max={TEXTAREA_MAX} id="raid-description-counter" lang={lang} />
          </label>

          {draft.category === "R" ? (
            <div className="sm:col-span-2" title={t(lang, "raidFieldRiskMatrixHint")}>
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-foreground">
                  {t(lang, "raidRiskMatrix")}
                </span>
                <span className="text-xs text-muted-foreground">
                  {draft.probability && draft.impact
                    ? `${draft.probability} × ${draft.impact} = ${draft.probability * draft.impact} → ${draft.severity ? severityLabel(draft.severity, lang) : ""}`
                    : ""}
                </span>
              </div>
              <RiskMatrix
                probability={draft.probability ?? 3}
                impact={draft.impact ?? 3}
                onPick={onApplyMatrix}
                lang={lang}
              />
            </div>
          ) : (
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-foreground">
                {t(lang, "raidSeverity")}
              </span>
              <SegmentedControl<RaidSeverity>
                value={draft.severity ?? "Medium"}
                ariaLabel={t(lang, "raidSeverity")}
                title={t(lang, "raidFieldSeverityHint")}
                options={RAID_SEVERITIES.map((s) => ({
                  value: s,
                  label: severityLabel(s, lang),
                }))}
                onChange={(s) => onChange({ ...draft, severity: s })}
              />
            </label>
          )}

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">
              {t(lang, "raidOwner")}
            </span>
            <ResourcePicker
              lang={lang}
              value={{ name: draft.owner ?? "", email: draft.ownerEmail ?? "", resourceId: draft.ownerResourceId }}
              resources={resources}
              contacts={contacts}
              onCreateResource={onCreateResource}
              onChange={(next) =>
                onChange({
                  ...draft,
                  owner: next.name || undefined,
                  ownerEmail: next.email || undefined,
                  ownerResourceId: next.resourceId,
                })
              }
              onBlur={(e) => {
                const trimmed = describeTextCap(e.target.value, ASSIGNEE_MAX).value.trim();
                onChange({ ...draft, owner: trimmed || undefined });
              }}
              maxLength={ASSIGNEE_MAX}
              title={t(lang, "raidFieldOwnerHint")}
              aria-describedby="raid-owner-counter"
            />
            <CharCounter value={draft.owner ?? ""} max={ASSIGNEE_MAX} id="raid-owner-counter" lang={lang} />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">
              {t(lang, "email")}
            </span>
            <input
              type="email"
              value={draft.ownerEmail ?? ""}
              onChange={(e) =>
                onChange({ ...draft, ownerEmail: e.target.value || undefined })
              }
              title={t(lang, "raidFieldOwnerEmailHint")}
              className="rounded-md border border-line bg-surface px-3 py-2 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">
              {t(lang, "raidRaisedDate")}
            </span>
            <input
              type="date"
              value={draft.raisedDate}
              onChange={(e) => onChange({ ...draft, raisedDate: e.target.value })}
              title={t(lang, "raidFieldRaisedDateHint")}
              className="rounded-md border border-line bg-surface px-3 py-2 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">
              {t(lang, "raidTargetDate")}
            </span>
            <input
              type="date"
              value={draft.targetDate ?? ""}
              onChange={(e) =>
                onChange({ ...draft, targetDate: e.target.value || undefined })
              }
              title={t(lang, "raidFieldTargetDateHint")}
              className="rounded-md border border-line bg-surface px-3 py-2 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-foreground">
              {t(lang, "raidMitigation")}
            </span>
            <textarea
              rows={3}
              value={draft.mitigation ?? ""}
              onChange={(e) =>
                onChange({ ...draft, mitigation: e.target.value || undefined })
              }
              onBlur={(e) => onChange({ ...draft, mitigation: describeTextCap(e.target.value, TEXTAREA_MAX).value || undefined })}
              placeholder={t(lang, "raidPlaceholderMitigation")}
              title={t(lang, "raidFieldMitigationHint")}
              aria-describedby="raid-mitigation-counter"
              className="rounded-md border border-line bg-surface px-3 py-2 text-sm"
            />
            <CharCounter value={draft.mitigation ?? ""} max={TEXTAREA_MAX} id="raid-mitigation-counter" lang={lang} />
          </label>

          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-foreground">{t(lang, "documents")}</span>
            <DocumentLinksFieldGated
              value={draft.documentLinks ?? []}
              onChange={(documentLinks) => onChange({ ...draft, documentLinks })}
              lang={lang}
            />
          </label>

          <div className="sm:col-span-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-foreground">
                {t(lang, "raidLinkedTasks")}
              </span>
              <button
                type="button"
                onClick={onCreateMitigationTask}
                disabled={isNew}
                title={t(lang, "raidCreateMitigationTaskHint")}
                className="rounded-md border border-AIPM-dark-blue bg-surface px-2 py-1 text-xs font-medium text-AIPM-dark-blue hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 dark:border-AIPM-blue dark:text-AIPM-blue"
              >
                {t(lang, "raidCreateMitigationTask")}
              </button>
            </div>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {draft.linkedTaskIds.length === 0 && (
                <span className="text-xs italic text-muted-foreground">—</span>
              )}
              {draft.linkedTaskIds.map((tid) => {
                const tk = tasks.find((task) => task.id === tid);
                return (
                  <span
                    key={tid}
                    className="inline-flex items-center gap-1 rounded bg-surface-muted px-2 py-0.5 text-xs text-foreground"
                  >
                    <span className="font-mono">#{tid}</span>
                    <span className="max-w-[200px] truncate">
                      {tk?.taskName ?? ""}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeLinked(tid)}
                      aria-label={t(lang, "raidUnlinkTask")}
                      title={t(lang, "raidUnlinkTask")}
                      className="text-muted-foreground hover:text-AIPM-pink"
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
            <div className="relative">
              <input
                type="text"
                value={taskPickerQuery}
                onChange={(e) => setTaskPickerQuery(e.target.value)}
                placeholder={t(lang, "raidLinkPickerPlaceholder")}
                title={t(lang, "raidFieldLinkedTasksHint")}
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm"
              />
              {taskPickerQuery.trim() !== "" && availableTasks.length > 0 && (
                <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-line bg-surface">
                  {availableTasks.map((tk) => (
                    <li key={tk.id}>
                      <button
                        type="button"
                        onClick={() => addLinked(tk.id)}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-muted"
                      >
                        <span className="font-mono text-xs text-muted-foreground">
                          #{tk.id}
                        </span>
                        <span className="truncate">{tk.taskName}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Caused by ----------------------------------------------- */}
          <div className="sm:col-span-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-foreground">
                {t(lang, "raidCausedBy")}
              </span>
            </div>
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              {parentItems.length === 0 && (
                <span className="text-xs italic text-muted-foreground">—</span>
              )}
              {parentItems.map((p) => (
                <span
                  key={p.id}
                  className="inline-flex items-center gap-1 rounded bg-surface-muted px-2 py-0.5 text-xs text-foreground"
                >
                  <button
                    type="button"
                    onClick={() => onJumpToRaid(p.id)}
                    title={p.title}
                    className="inline-flex items-center gap-1 hover:underline"
                  >
                    <span className="font-mono">
                      ↩ {p.category}#{p.id}
                    </span>
                    <span className="max-w-[220px] truncate">{p.title}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => removeCausedBy(p.id)}
                    aria-label={t(lang, "raidCausedByClear")}
                    title={t(lang, "raidCausedByClear")}
                    className="text-muted-foreground hover:text-AIPM-pink"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="relative">
              <input
                type="text"
                value={causePickerQuery}
                onChange={(e) => setCausePickerQuery(e.target.value)}
                placeholder={t(lang, "raidCausedByPlaceholder")}
                title={t(lang, "raidFieldCausedByHint")}
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm"
              />
              {causePickerQuery.trim() !== "" && availableCauses.length > 0 && (
                <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-line bg-surface">
                  {availableCauses.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => addCausedBy(r.id)}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-muted"
                      >
                        <span className="font-mono text-xs text-muted-foreground">
                          {r.category}#{r.id}
                        </span>
                        <span className="truncate">{r.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Items caused by this — read-only. The user breaks the link by
              editing the child. Only shown for saved items with children. */}
          {!isNew && causedChildren.length > 0 && (
            <div className="sm:col-span-2">
              <span className="mb-2 block text-sm font-medium text-foreground">
                {t(lang, "raidCausedThis")}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {causedChildren.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onJumpToRaid(c.id)}
                    title={c.title}
                    className="inline-flex items-center gap-1 rounded bg-AIPM-purple/10 px-2 py-0.5 text-xs text-AIPM-purple hover:bg-AIPM-purple/20 dark:bg-AIPM-purple/15 dark:hover:bg-AIPM-purple/25"
                  >
                    <span className="font-mono">{c.category}#{c.id}</span>
                    <span className="max-w-[220px] truncate">{c.title}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Stakeholders ------------------------------------------- */}
          {stakeholdersEnabled && (
            <div className="sm:col-span-2">
              <span className="mb-2 block text-sm font-medium text-foreground">
                {t(lang, "fieldStakeholders")}
              </span>
              {stakeholders.length === 0 ? (
                <span className="text-xs italic text-muted-foreground">—</span>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {stakeholders.map((sh) => (
                    <label
                      key={sh.id}
                      className="inline-flex items-center gap-1.5 rounded border border-line bg-surface px-2 py-1 text-xs text-foreground"
                    >
                      <input
                        type="checkbox"
                        checked={(draft.stakeholderIds ?? []).includes(sh.id)}
                        onChange={() => toggleStakeholder(sh.id)}
                        aria-label={sh.name}
                        className="accent-AIPM-green"
                      />
                      <span className="max-w-[200px] truncate">{sh.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {error && (
            <p
              role="alert"
              className="rounded-md bg-AIPM-pink/10 px-3 py-2 text-sm text-AIPM-pink dark:bg-AIPM-pink/15 sm:col-span-2"
            >
              {error}
            </p>
          )}

          <div className="flex justify-between gap-2 sm:col-span-2">
            <button
              type="button"
              onClick={() => {
                if (window.confirm(t(lang, "raidConfirmDelete"))) onDelete();
              }}
              disabled={isNew}
              title={t(lang, "raidFieldDeleteHint")}
              className="rounded-md border border-AIPM-pink/40 bg-surface px-3 py-2 text-sm font-medium text-AIPM-pink hover:bg-AIPM-pink/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t(lang, "raidDelete")}
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onCancel}
                className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-muted"
              >
                {t(lang, "cancel")}
              </button>
              <button
                type="submit"
                className="rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-3 py-1.5 text-sm font-medium text-white hover:bg-AIPM-dark-blue/90"
              >
                {t(lang, "raidSave")}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

// --- 5×5 risk matrix --------------------------------------------------

function RiskMatrix({
  probability,
  impact,
  onPick,
  lang,
}: {
  probability: RiskScale;
  impact: RiskScale;
  onPick: (probability: RiskScale, impact: RiskScale) => void;
  lang: Lang;
}) {
  function cellColor(p: RiskScale, i: RiskScale): string {
    const score = p * i;
    if (score <= 5)
      return "bg-AIPM-green/20 hover:bg-AIPM-green/30 dark:bg-AIPM-green/20 dark:hover:bg-AIPM-green/30";
    if (score <= 10)
      return "bg-AIPM-blue/20 hover:bg-AIPM-blue/30 dark:bg-AIPM-blue/20 dark:hover:bg-AIPM-blue/30";
    if (score <= 15)
      return "bg-AIPM-purple/25 hover:bg-AIPM-purple/35 dark:bg-AIPM-purple/25 dark:hover:bg-AIPM-purple/35";
    return "bg-AIPM-pink/30 hover:bg-AIPM-pink/40 dark:bg-AIPM-pink/30 dark:hover:bg-AIPM-pink/40";
  }

  return (
    <div className="inline-flex items-center gap-1">
      {/* Vertical probability axis label — mirrors the horizontal "← Impact →"
          footer. Rotated -90deg so the arrows end up pointing ↓ (low) at the
          bottom and ↑ (high) at the top, matching the matrix orientation
          (5 at the top, 1 at the bottom). */}
      <div className="flex w-4 items-center justify-center">
        <span
          className="whitespace-nowrap text-[10px] text-muted-foreground"
          style={{ transform: "rotate(-90deg)" }}
        >
          ← {t(lang, "raidProbability")} →
        </span>
      </div>
      <div className="inline-block">
      <div className="mb-1 grid grid-cols-[auto_repeat(5,2rem)] gap-0.5 text-[10px] text-muted-foreground">
        <span />
        {RISK_SCALES.map((i) => (
          <span key={`imp-${i}`} className="text-center">
            {i}
          </span>
        ))}
      </div>
      {/* Probability rows from 5 (top) down to 1 (bottom) so higher risk
          appears in the top-right corner, matching standard risk-matrix
          orientation. */}
      {([5, 4, 3, 2, 1] as RiskScale[]).map((p) => (
        <div
          key={`row-${p}`}
          className="grid grid-cols-[auto_repeat(5,2rem)] gap-0.5"
        >
          <span className="self-center pr-1 text-[10px] text-muted-foreground">
            {p}
          </span>
          {RISK_SCALES.map((i) => {
            const isSelected = probability === p && impact === i;
            return (
              <button
                key={`cell-${p}-${i}`}
                type="button"
                onClick={() => onPick(p, i)}
                aria-label={`${t(lang, "raidProbability")} ${p}, ${t(lang, "raidImpact")} ${i}`}
                className={`h-8 w-8 rounded text-[10px] font-medium text-foreground ${cellColor(p, i)} ${
                  isSelected ? "ring-2 ring-AIPM-green ring-offset-1" : ""
                }`}
              >
                {p * i}
              </button>
            );
          })}
        </div>
      ))}
      <div className="mt-1 grid grid-cols-[auto_repeat(5,2rem)] gap-0.5">
        <span />
        <span className="col-span-5 text-center text-[10px] text-muted-foreground">
          ← {t(lang, "raidImpact")} →
        </span>
      </div>
      </div>
    </div>
  );
}
