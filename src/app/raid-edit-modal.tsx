"use client";

// RAID edit modal — create / edit / delete a RaidItem: category/status
// segmented controls, the 5×5 risk matrix picker (Risk items only), the
// linked-task and caused-by autocomplete chip pickers, stakeholder
// checkboxes, and the "create mitigation task" shortcut. Extracted from
// raid-panel.tsx; unlike the standalone sibling modals
// (change-edit-modal.tsx / stakeholder-edit-modal.tsx) the panel owns the
// draft state and passes it down with change callbacks.

import { useMemo, useState } from "react";
import { useEscapeKey } from "./use-escape-key";
import { ModalFieldControls } from "./modal-field-controls";
import { useModalVisibility } from "./use-modal-visibility";
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
import { RiskMatrix } from "./raid-risk-matrix";
import { RaidCausedByField, RaidLinkedTasksField } from "./raid-edit-fields";
import { categoryLabel, severityLabel, statusLabel } from "./raid-labels";
import { CharCounter, useAdjustmentTracker } from "./field-feedback";
import { describeTextCap } from "./sanitize-report";
import { TASK_NAME_MAX, TEXTAREA_MAX, ASSIGNEE_MAX } from "./sanitize";
import { useToastContext } from "./toast-context";
import { InfoTooltip } from "./info-tooltip";
import { INTERACTIVE, FOCUS_RING, TRANSITION } from "./interaction-styles";
import { ModalFieldError, StakeholderChipPicker } from "./edit-modal-chrome";
import { useDictationMic } from "./dictation-mic";
import { appendDictation } from "./dictation-engine";
import { useSettings } from "./use-settings";

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
  const { isVisible } = useModalVisibility("raid");
  const adj = useAdjustmentTracker();
  const { settings } = useSettings();
  const { mic: descriptionMic, status: descriptionDictationStatus, registration: descriptionDictationReg } = useDictationMic({
    lang,
    dictation: settings.dictation,
    enabled: true,
    label: t(lang, "raidDescription"),
    onAppendFinal: (txt) =>
      onChange({ ...draft, description: appendDictation(draft.description ?? "", txt) || undefined }),
  });
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

  useEscapeKey(onCancel);

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
            className={`rounded-md p-2 text-foreground hover:bg-surface-muted hover:text-AIPM-dark-blue ${INTERACTIVE}`}
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

        <div className="flex justify-end border-b border-line px-4 py-2">
          <ModalFieldControls modalId="raid" lang={lang} />
        </div>

        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 overflow-y-auto p-6 sm:grid-cols-2">
          {isVisible("category") && (
          <div className="flex flex-col gap-1 text-sm">
            <label className="flex flex-col gap-1">
              <span className="flex items-center gap-1 font-medium text-foreground">
                {t(lang, "raidCategory")}
                <InfoTooltip text={t(lang, "raidFieldCategoryHint")} />
              </span>
              <SegmentedControl<RaidCategory>
                value={draft.category}
                disabled={!isNew && !categoryUnlocked}
                ariaLabel={t(lang, "raidCategory")}
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
                className={`self-start text-[11px] font-medium text-muted-foreground underline-offset-2 hover:text-AIPM-dark-blue hover:underline ${INTERACTIVE}`}
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
          )}

          {isVisible("status") && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="flex items-center gap-1 font-medium text-foreground">
              {t(lang, "raidStatus")}
              <InfoTooltip text={t(lang, "raidFieldStatusHint")} />
            </span>
            <SegmentedControl<RaidStatus>
              value={draft.status}
              ariaLabel={t(lang, "raidStatus")}
              options={statusOpts.map((s) => ({
                value: s,
                label: statusLabel(s, lang),
              }))}
              onChange={(s) => onApplyStatus(s)}
            />
          </label>
          )}

          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="flex items-center gap-1 font-medium text-foreground">
              {t(lang, "raidTitle")} *
              <InfoTooltip text={t(lang, "raidFieldTitleHint")} />
            </span>
            <input
              type="text"
              required
              value={draft.title}
              onChange={(e) => onChange({ ...draft, title: e.target.value })}
              onBlur={(e) => onChange({ ...draft, title: describeTextCap(e.target.value, TASK_NAME_MAX).value.trim() })}
              placeholder={t(lang, "raidPlaceholderTitle")}
              aria-describedby="raid-title-counter"
              className={`rounded-md border border-line bg-surface px-3 py-2 text-sm ${FOCUS_RING} ${TRANSITION}`}
            />
            <CharCounter value={draft.title} max={TASK_NAME_MAX} id="raid-title-counter" lang={lang} />
          </label>

          {isVisible("description") && (
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="flex items-center gap-1 font-medium text-foreground">
              {t(lang, "raidDescription")}
              <InfoTooltip text={t(lang, "raidFieldDescriptionHint")} />
              {descriptionMic}
            </span>
            <textarea
              rows={2}
              value={draft.description ?? ""}
              onChange={(e) =>
                onChange({ ...draft, description: e.target.value || undefined })
              }
              onFocus={descriptionDictationReg.onFocus}
              onBlur={(e) => {
                onChange({ ...draft, description: describeTextCap(e.target.value, TEXTAREA_MAX).value || undefined });
                descriptionDictationReg.onBlur();
              }}
              placeholder={t(lang, "raidPlaceholderDescription")}
              aria-describedby="raid-description-counter"
              className={`rounded-md border border-line bg-surface px-3 py-2 text-sm ${FOCUS_RING} ${TRANSITION}`}
            />
            <CharCounter value={draft.description ?? ""} max={TEXTAREA_MAX} id="raid-description-counter" lang={lang} />
            {descriptionDictationStatus}
          </label>
          )}

          {/* Risk scoring: for Risk items this is the matrix (full-only field
              `riskMatrix`); for non-Risk items it's the severity control
              (advanced field `scoring`). Each branch is guarded by its own id. */}
          {draft.category === "R"
            ? isVisible("riskMatrix") && (
            <div className="sm:col-span-2">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <span className="flex items-center gap-1 text-sm font-medium text-foreground">
                  {t(lang, "raidRiskMatrix")}
                  <InfoTooltip text={t(lang, "raidFieldRiskMatrixHint")} />
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
              )
            : isVisible("scoring") && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="flex items-center gap-1 font-medium text-foreground">
                {t(lang, "raidSeverity")}
                <InfoTooltip text={t(lang, "raidFieldSeverityHint")} />
              </span>
              <SegmentedControl<RaidSeverity>
                value={draft.severity ?? "Medium"}
                ariaLabel={t(lang, "raidSeverity")}
                options={RAID_SEVERITIES.map((s) => ({
                  value: s,
                  label: severityLabel(s, lang),
                }))}
                onChange={(s) => onChange({ ...draft, severity: s })}
              />
            </label>
              )}

          {isVisible("owner") && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="flex items-center gap-1 font-medium text-foreground">
              {t(lang, "raidOwner")}
              <InfoTooltip text={t(lang, "raidFieldOwnerHint")} />
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
              aria-describedby="raid-owner-counter"
            />
            <CharCounter value={draft.owner ?? ""} max={ASSIGNEE_MAX} id="raid-owner-counter" lang={lang} />
          </label>
          )}

          {/* Owner email travels with the owner field. */}
          {isVisible("owner") && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="flex items-center gap-1 font-medium text-foreground">
              {t(lang, "email")}
              <InfoTooltip text={t(lang, "raidFieldOwnerEmailHint")} />
            </span>
            <input
              type="email"
              value={draft.ownerEmail ?? ""}
              onChange={(e) =>
                onChange({ ...draft, ownerEmail: e.target.value || undefined })
              }
              className={`rounded-md border border-line bg-surface px-3 py-2 text-sm ${FOCUS_RING} ${TRANSITION}`}
            />
          </label>
          )}

          {isVisible("raisedDate") && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="flex items-center gap-1 font-medium text-foreground">
              {t(lang, "raidRaisedDate")}
              <InfoTooltip text={t(lang, "raidFieldRaisedDateHint")} />
            </span>
            <input
              type="date"
              value={draft.raisedDate}
              onChange={(e) => onChange({ ...draft, raisedDate: e.target.value })}
              className={`rounded-md border border-line bg-surface px-3 py-2 text-sm ${FOCUS_RING} ${TRANSITION}`}
            />
          </label>
          )}

          {isVisible("targetDate") && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="flex items-center gap-1 font-medium text-foreground">
              {t(lang, "raidTargetDate")}
              <InfoTooltip text={t(lang, "raidFieldTargetDateHint")} />
            </span>
            <input
              type="date"
              value={draft.targetDate ?? ""}
              onChange={(e) =>
                onChange({ ...draft, targetDate: e.target.value || undefined })
              }
              className={`rounded-md border border-line bg-surface px-3 py-2 text-sm ${FOCUS_RING} ${TRANSITION}`}
            />
          </label>
          )}

          {isVisible("mitigation") && (
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="flex items-center gap-1 font-medium text-foreground">
              {t(lang, "raidMitigation")}
              <InfoTooltip text={t(lang, "raidFieldMitigationHint")} />
            </span>
            <textarea
              rows={3}
              value={draft.mitigation ?? ""}
              onChange={(e) =>
                onChange({ ...draft, mitigation: e.target.value || undefined })
              }
              onBlur={(e) => onChange({ ...draft, mitigation: describeTextCap(e.target.value, TEXTAREA_MAX).value || undefined })}
              placeholder={t(lang, "raidPlaceholderMitigation")}
              aria-describedby="raid-mitigation-counter"
              className={`rounded-md border border-line bg-surface px-3 py-2 text-sm ${FOCUS_RING} ${TRANSITION}`}
            />
            <CharCounter value={draft.mitigation ?? ""} max={TEXTAREA_MAX} id="raid-mitigation-counter" lang={lang} />
          </label>
          )}

          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-foreground">{t(lang, "documents")}</span>
            <DocumentLinksFieldGated
              value={draft.documentLinks ?? []}
              onChange={(documentLinks) => onChange({ ...draft, documentLinks })}
              lang={lang}
            />
          </label>

          {isVisible("linkedTasks") && (
          <RaidLinkedTasksField
            lang={lang}
            linkedTaskIds={draft.linkedTaskIds}
            tasks={tasks}
            isNew={isNew}
            onCreateMitigationTask={onCreateMitigationTask}
            taskPickerQuery={taskPickerQuery}
            setTaskPickerQuery={setTaskPickerQuery}
            availableTasks={availableTasks}
            addLinked={addLinked}
            removeLinked={removeLinked}
          />
          )}

          {isVisible("linkedRaid") && (
          <RaidCausedByField
            lang={lang}
            parentItems={parentItems}
            causePickerQuery={causePickerQuery}
            setCausePickerQuery={setCausePickerQuery}
            availableCauses={availableCauses}
            addCausedBy={addCausedBy}
            removeCausedBy={removeCausedBy}
            onJumpToRaid={onJumpToRaid}
            causedChildren={causedChildren}
            isNew={isNew}
          />
          )}

          {/* Stakeholders ------------------------------------------- */}
          {stakeholdersEnabled && isVisible("linkedStakeholders") && (
            <StakeholderChipPicker
              lang={lang}
              stakeholders={stakeholders}
              selectedIds={draft.stakeholderIds ?? []}
              onToggle={toggleStakeholder}
            />
          )}

          {error && <ModalFieldError error={error} />}

          <div className="flex justify-between gap-2 sm:col-span-2">
            <span className="inline-flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(t(lang, "raidConfirmDelete"))) onDelete();
                }}
                disabled={isNew}
                className={`rounded-md border border-AIPM-pink/40 bg-surface px-3 py-2 text-sm font-medium text-AIPM-pink-strong hover:bg-AIPM-pink/10 disabled:cursor-not-allowed disabled:opacity-50 ${INTERACTIVE}`}
              >
                {t(lang, "raidDelete")}
              </button>
              <InfoTooltip text={t(lang, "raidFieldDeleteHint")} />
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onCancel}
                className={`rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-muted ${INTERACTIVE}`}
              >
                {t(lang, "cancel")}
              </button>
              <button
                type="submit"
                className={`rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-3 py-1.5 text-sm font-medium text-white hover:bg-AIPM-dark-blue/90 ${INTERACTIVE}`}
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
