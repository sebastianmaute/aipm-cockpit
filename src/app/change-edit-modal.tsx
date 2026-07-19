"use client";

// Change-control edit modal — create / edit / delete a ChangeItem. Mirrors
// RaidEditModal's structure (sticky/draggable header, two-column grid form,
// validation error alert, Delete-left / Cancel+Save-right footer, and the two
// autocomplete chip+dropdown link pickers — one over tasks, one over RAID).
// Built as a standalone component using the shared ModalHeader + useDraggable,
// like resource-edit-modal.tsx / absence-edit-modal.tsx.

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useEscapeKey } from "./use-escape-key";
import { type Lang, t, type TranslationKey } from "./i18n";
import {
  CHANGE_STATUSES,
  CHANGE_TYPES,
  RAID_SEVERITIES,
  type ChangeImpact,
  type ChangeItem,
  type ChangeStatus,
  type ChangeType,
  type RaidItem,
  type Stakeholder,
  type Task,
} from "./types";
import { useDraggable } from "./use-draggable";
import { useModalVisibility } from "./use-modal-visibility";
import { CharCounter, FieldNotice, useAdjustmentTracker } from "./field-feedback";
import { describeTextCap, describeClamp } from "./sanitize-report";
import { BUDGET_NAME_MAX, TEXTAREA_MAX, AMOUNT_MAX } from "./sanitize";
import { filterPickerOptions } from "./picker-filter";
import { TaskLinkPicker } from "./task-link-picker";
import { useToastContext } from "./toast-context";
import { KnowledgeLinksFieldGated } from "./knowledge-links-field-gated";
import { InfoTooltip } from "./info-tooltip";
import { INTERACTIVE } from "./interaction-styles";
import {
  EditModalShell,
  ModalFieldError,
  StakeholderChipPicker,
  ModalEditFooter,
} from "./edit-modal-chrome";
import { Input, Select, Textarea } from "./form-controls";
import { useDictationMic } from "./dictation-mic";
import { appendDictation } from "./dictation-engine";
import { useSettings } from "./use-settings";

export interface ChangeEditModalProps {
  lang: Lang;
  tasks: readonly Task[];
  raid: readonly RaidItem[];
  draft: ChangeItem;
  isNew: boolean;
  /** When false, the Linked RAID items editor is hidden. Default true. */
  raidEnabled?: boolean;
  /** When false, the Stakeholders picker is hidden. Default true. */
  stakeholdersEnabled?: boolean;
  /** Selectable stakeholders for the picker; empty when the module is off. */
  stakeholders?: readonly Stakeholder[];
  onChange: (next: ChangeItem) => void;
  onApplyStatus: (status: ChangeStatus) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
}

const TYPE_LABEL_KEYS: Record<ChangeType, TranslationKey> = {
  Scope: "changeTypeScope",
  Schedule: "changeTypeSchedule",
  Cost: "changeTypeCost",
  Quality: "changeTypeQuality",
  Other: "changeTypeOther",
};

const STATUS_LABEL_KEYS: Record<ChangeStatus, TranslationKey> = {
  Proposed: "changeStatusProposed",
  "Under Review": "changeStatusUnderReview",
  Approved: "changeStatusApproved",
  Rejected: "changeStatusRejected",
  Implemented: "changeStatusImplemented",
  Deferred: "changeStatusDeferred",
};

const IMPACT_LABEL_KEYS: Record<ChangeImpact, TranslationKey> = {
  Low: "raidSeverityLow",
  Medium: "raidSeverityMedium",
  High: "raidSeverityHigh",
  Critical: "raidSeverityCritical",
};

export function ChangeEditModal({
  lang,
  tasks,
  raid,
  draft,
  isNew,
  raidEnabled = true,
  stakeholdersEnabled = true,
  stakeholders = [],
  onChange,
  onApplyStatus,
  onSave,
  onCancel,
  onDelete,
}: ChangeEditModalProps) {
  const showToast = useToastContext();
  const { isVisible } = useModalVisibility("change");
  const [error, setError] = useState<string | null>(null);
  const [raidPickerQuery, setRaidPickerQuery] = useState("");
  const [notice, setNotice] = useState<Record<string, string>>({});
  const scheduleNoticeId = useId();
  const costNoticeId = useId();
  const adj = useAdjustmentTracker();
  const { settings } = useSettings();
  const draftRef = useRef(draft);
  useEffect(() => { draftRef.current = draft; });
  const { mic: descriptionMic, status: descriptionDictationStatus, registration: descriptionDictationReg } = useDictationMic({
    lang,
    dictation: settings.dictation,
    enabled: true,
    label: t(lang, "changeFieldDescription"),
    onAppendFinal: (txt) => update("description", appendDictation(draftRef.current.description ?? "", txt)),
  });
  const { mic: titleMic, status: titleDictationStatus, registration: titleDictationReg } = useDictationMic({
    lang,
    dictation: settings.dictation,
    enabled: true,
    label: t(lang, "changeFieldTitle"),
    onAppendFinal: (txt) =>
      update("title", describeTextCap(appendDictation(draftRef.current.title ?? "", txt), BUDGET_NAME_MAX).value),
  });

  const { offset, reset: dragReset, handleProps } = useDraggable(true, "aipm-cockpit:modal-pos:change-edit");

  useEscapeKey(onCancel);


  const availableRaid = useMemo(
    () =>
      filterPickerOptions(raid, {
        query: raidPickerQuery,
        excludeIds: new Set(draft.linkedRaidIds),
        getId: (r) => r.id,
        getText: (r) => r.title,
      }),
    [raid, draft.linkedRaidIds, raidPickerQuery],
  );

  function update<K extends keyof ChangeItem>(key: K, value: ChangeItem[K]) {
    setError(null);
    onChange({ ...draft, [key]: value });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.title.trim()) {
      setError(t(lang, "raidErrorTitleRequired"));
      return;
    }
    setError(null);
    adj.reset();
    // Route capped text fields through tracker so silent truncations are counted.
    adj.track(describeTextCap(draft.title, BUDGET_NAME_MAX));
    adj.track(describeTextCap(draft.description ?? "", TEXTAREA_MAX));
    adj.track(describeTextCap(draft.requestedBy ?? "", BUDGET_NAME_MAX));
    adj.track(describeTextCap(draft.decisionBy ?? "", BUDGET_NAME_MAX));
    adj.track(describeTextCap(draft.impactDescription ?? "", TEXTAREA_MAX));
    adj.track(describeTextCap(draft.resolutionNotes ?? "", TEXTAREA_MAX));
    if (adj.count() > 0) showToast("info", t(lang, "fieldsAdjusted", adj.count()));
    onSave();
  }

  function addLinkedTask(taskId: number) {
    if (draft.linkedTaskIds.includes(taskId)) return;
    onChange({ ...draft, linkedTaskIds: [...draft.linkedTaskIds, taskId] });
  }

  function removeLinkedTask(taskId: number) {
    onChange({
      ...draft,
      linkedTaskIds: draft.linkedTaskIds.filter((id) => id !== taskId),
    });
  }

  function addLinkedRaid(raidId: number) {
    if (draft.linkedRaidIds.includes(raidId)) return;
    onChange({ ...draft, linkedRaidIds: [...draft.linkedRaidIds, raidId] });
    setRaidPickerQuery("");
  }

  function removeLinkedRaid(raidId: number) {
    onChange({
      ...draft,
      linkedRaidIds: draft.linkedRaidIds.filter((id) => id !== raidId),
    });
  }

  function toggleStakeholder(stakeholderId: number) {
    const ids = draft.stakeholderIds ?? [];
    const next = ids.includes(stakeholderId)
      ? ids.filter((id) => id !== stakeholderId)
      : [...ids, stakeholderId];
    onChange({ ...draft, stakeholderIds: next });
  }

  function parseNumber(value: string): number | undefined {
    if (value.trim() === "") return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }

  const title = isNew
    ? t(lang, "changesAdd")
    : t(lang, "changeEditTitle");
  const saveDisabled = !draft.title.trim();

  return (
    <EditModalShell
      lang={lang}
      title={title}
      modalId="change"
      onClose={onCancel}
      onSubmit={handleSubmit}
      offset={offset}
      dragHandleProps={handleProps}
      onDragReset={dragReset}
      sizeKey="aipm-cockpit:modal-size:change-edit"
    >
          {/* Title */}
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="flex items-center gap-1 font-medium text-foreground">
              {t(lang, "changeFieldTitle")} *<InfoTooltip text={t(lang, "changeFieldTitleHint")} />
              {titleMic}
            </span>
            <Input
              type="text"
              required
              value={draft.title}
              onChange={(e) => update("title", e.target.value)}
              onFocus={titleDictationReg.onFocus}
              onBlur={(e) => { update("title", describeTextCap(e.target.value, BUDGET_NAME_MAX).value.trim()); titleDictationReg.onBlur(); }}
              aria-describedby="change-title-counter"
            />
            <CharCounter value={draft.title} max={BUDGET_NAME_MAX} id="change-title-counter" lang={lang} />
            {titleDictationStatus}
          </label>

          {/* Type */}
          {isVisible("type") && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="flex items-center gap-1 font-medium text-foreground">
              {t(lang, "changeFieldType")}<InfoTooltip text={t(lang, "changeFieldTypeHint")} />
            </span>
            <Select
              aria-label={t(lang, "changeFieldType")}
              value={draft.type}
              onChange={(e) => update("type", e.target.value as ChangeType)}
            >
              {CHANGE_TYPES.map((ty) => (
                <option key={ty} value={ty}>
                  {t(lang, TYPE_LABEL_KEYS[ty])}
                </option>
              ))}
            </Select>
          </label>
          )}

          {/* Status */}
          {isVisible("status") && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="flex items-center gap-1 font-medium text-foreground">
              {t(lang, "changeFieldStatus")}<InfoTooltip text={t(lang, "changeFieldStatusHint")} />
            </span>
            <Select
              aria-label={t(lang, "changeFieldStatus")}
              value={draft.status}
              onChange={(e) => onApplyStatus(e.target.value as ChangeStatus)}
            >
              {CHANGE_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {t(lang, STATUS_LABEL_KEYS[st])}
                </option>
              ))}
            </Select>
          </label>
          )}

          {/* Description */}
          {isVisible("description") && (
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="flex items-center gap-1 font-medium text-foreground">
              {t(lang, "changeFieldDescription")}<InfoTooltip text={t(lang, "changeFieldDescriptionHint")} />
              {descriptionMic}
            </span>
            <Textarea
              autoGrow
              rows={2}
              value={draft.description}
              onChange={(e) => update("description", e.target.value)}
              onFocus={descriptionDictationReg.onFocus}
              onBlur={(e) => {
                update("description", describeTextCap(e.target.value, TEXTAREA_MAX).value);
                descriptionDictationReg.onBlur();
              }}
              aria-describedby="change-description-counter"
            />
            <CharCounter value={draft.description ?? ""} max={TEXTAREA_MAX} id="change-description-counter" lang={lang} />
            {descriptionDictationStatus}
          </label>
          )}

          {/* Impact (level — part of the `impact` field group) */}
          {isVisible("impact") && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="flex items-center gap-1 font-medium text-foreground">
              {t(lang, "changeFieldImpact")}<InfoTooltip text={t(lang, "changeFieldImpactHint")} />
            </span>
            <Select
              aria-label={t(lang, "changeFieldImpact")}
              value={draft.impact ?? ""}
              onChange={(e) =>
                update(
                  "impact",
                  e.target.value === ""
                    ? undefined
                    : (e.target.value as ChangeImpact),
                )
              }
            >
              <option value="">—</option>
              {RAID_SEVERITIES.map((sev) => (
                <option key={sev} value={sev}>
                  {t(lang, IMPACT_LABEL_KEYS[sev])}
                </option>
              ))}
            </Select>
          </label>
          )}

          {/* Requested by */}
          {isVisible("requestor") && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="flex items-center gap-1 font-medium text-foreground">
              {t(lang, "changeFieldRequestedBy")}<InfoTooltip text={t(lang, "changeFieldRequestedByHint")} />
            </span>
            <Input
              type="text"
              value={draft.requestedBy ?? ""}
              onChange={(e) =>
                update("requestedBy", e.target.value || undefined)
              }
              onBlur={(e) => {
                const trimmed = describeTextCap(e.target.value, BUDGET_NAME_MAX).value.trim();
                update("requestedBy", trimmed || undefined);
              }}
              aria-describedby="change-requestedBy-counter"
            />
            <CharCounter value={draft.requestedBy ?? ""} max={BUDGET_NAME_MAX} id="change-requestedBy-counter" lang={lang} />
          </label>
          )}

          {/* Impact description (part of the `impact` field group) */}
          {isVisible("impact") && (
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="flex items-center gap-1 font-medium text-foreground">
              {t(lang, "changeFieldImpactDescription")}<InfoTooltip text={t(lang, "changeFieldImpactDescriptionHint")} />
            </span>
            <Textarea
              autoGrow
              rows={2}
              value={draft.impactDescription ?? ""}
              onChange={(e) =>
                update("impactDescription", e.target.value || undefined)
              }
              onBlur={(e) => update("impactDescription", describeTextCap(e.target.value, TEXTAREA_MAX).value || undefined)}
              aria-describedby="change-impactDescription-counter"
            />
            <CharCounter value={draft.impactDescription ?? ""} max={TEXTAREA_MAX} id="change-impactDescription-counter" lang={lang} />
          </label>
          )}

          {/* Schedule impact (days — part of the `deltas` field group) */}
          {isVisible("deltas") && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="flex items-center gap-1 font-medium text-foreground">
              {t(lang, "changeFieldScheduleImpact")}<InfoTooltip text={t(lang, "changeFieldScheduleImpactHint")} />
            </span>
            <Input
              type="number"
              value={draft.scheduleImpactDays ?? ""}
              onChange={(e) =>
                update("scheduleImpactDays", parseNumber(e.target.value))
              }
              onBlur={(e) => {
                const r = describeClamp(e.target.value, { min: 0, round: 0 });
                update("scheduleImpactDays", r.value);
                const clamped = r.adjustment?.kind === "clamped" ? r.adjustment : null;
                setNotice((n) => ({
                  ...n,
                  scheduleImpactDays: clamped
                    ? t(lang, clamped.bound === "max" ? "fieldAdjustedMax" : "fieldAdjustedMin", clamped.to)
                    : "",
                }));
              }}
              invalid={!!notice.scheduleImpactDays}
              aria-describedby={notice.scheduleImpactDays ? scheduleNoticeId : undefined}
            />
            <FieldNotice id={scheduleNoticeId}>{notice.scheduleImpactDays}</FieldNotice>
          </label>
          )}

          {/* Cost impact (part of the `deltas` field group) */}
          {isVisible("deltas") && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="flex items-center gap-1 font-medium text-foreground">
              {t(lang, "changeFieldCostImpact")}<InfoTooltip text={t(lang, "changeFieldCostImpactHint")} />
            </span>
            <Input
              type="number"
              value={draft.costImpact ?? ""}
              onChange={(e) =>
                update("costImpact", parseNumber(e.target.value))
              }
              onBlur={(e) => {
                const r = describeClamp(e.target.value, { min: 0, max: AMOUNT_MAX, round: 2 });
                update("costImpact", r.value);
                const clamped = r.adjustment?.kind === "clamped" ? r.adjustment : null;
                setNotice((n) => ({
                  ...n,
                  costImpact: clamped
                    ? t(lang, clamped.bound === "max" ? "fieldAdjustedMax" : "fieldAdjustedMin", clamped.to)
                    : "",
                }));
              }}
              invalid={!!notice.costImpact}
              aria-describedby={notice.costImpact ? costNoticeId : undefined}
            />
            <FieldNotice id={costNoticeId}>{notice.costImpact}</FieldNotice>
          </label>
          )}

          {/* Raised date — no registry id; always rendered. */}
          <label className="flex flex-col gap-1 text-sm">
            <span className="flex items-center gap-1 font-medium text-foreground">
              {t(lang, "changeFieldRaisedDate")}<InfoTooltip text={t(lang, "changeFieldRaisedDateHint")} />
            </span>
            <Input
              type="date"
              value={draft.raisedDate}
              onChange={(e) => update("raisedDate", e.target.value)}
            />
          </label>

          {/* Decided by */}
          <label className="flex flex-col gap-1 text-sm">
            <span className="flex items-center gap-1 font-medium text-foreground">
              {t(lang, "changeFieldDecisionBy")}<InfoTooltip text={t(lang, "changeFieldDecisionByHint")} />
            </span>
            <Input
              type="text"
              value={draft.decisionBy ?? ""}
              onChange={(e) =>
                update("decisionBy", e.target.value || undefined)
              }
              onBlur={(e) => {
                const trimmed = describeTextCap(e.target.value, BUDGET_NAME_MAX).value.trim();
                update("decisionBy", trimmed || undefined);
              }}
              aria-describedby="change-decisionBy-counter"
            />
            <CharCounter value={draft.decisionBy ?? ""} max={BUDGET_NAME_MAX} id="change-decisionBy-counter" lang={lang} />
          </label>

          {/* Decision date — read-only display when set (auto-filled by status). */}
          {isVisible("decisionDate") && draft.decisionDate && (
            <div className="flex flex-col gap-1 text-sm">
              <span className="flex items-center gap-1 font-medium text-foreground">
                {t(lang, "changeFieldDecisionDate")}<InfoTooltip text={t(lang, "changeFieldDecisionDateHint")} />
              </span>
              <span className="rounded-md border border-line bg-surface-muted px-3 py-2 text-sm text-muted-foreground">
                {draft.decisionDate}
              </span>
            </div>
          )}

          {/* Resolution / rationale */}
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="flex items-center gap-1 font-medium text-foreground">
              {t(lang, "changeFieldResolution")}<InfoTooltip text={t(lang, "changeFieldResolutionHint")} />
            </span>
            <Textarea
              autoGrow
              rows={2}
              value={draft.resolutionNotes ?? ""}
              onChange={(e) =>
                update("resolutionNotes", e.target.value || undefined)
              }
              onBlur={(e) => update("resolutionNotes", describeTextCap(e.target.value, TEXTAREA_MAX).value || undefined)}
              aria-describedby="change-resolutionNotes-counter"
            />
            <CharCounter value={draft.resolutionNotes ?? ""} max={TEXTAREA_MAX} id="change-resolutionNotes-counter" lang={lang} />
          </label>

          {/* Document links ------------------------------------------ */}
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-foreground">{t(lang, "documents")}</span>
            <KnowledgeLinksFieldGated
              value={draft.knowledgeLinks ?? []}
              onChange={(links) => update("knowledgeLinks", links)}
              lang={lang}
            />
          </label>

          {/* Linked tasks (part of the `links` field group) ----------- */}
          {isVisible("links") && <div className="sm:col-span-2">
            <span className="mb-2 flex items-center gap-1 text-sm font-medium text-foreground">
              {t(lang, "changeFieldLinkedTasks")}<InfoTooltip text={t(lang, "changeFieldLinkedTasksHint")} />
            </span>
            <TaskLinkPicker
              lang={lang}
              tasks={tasks}
              selectedIds={draft.linkedTaskIds}
              onAdd={addLinkedTask}
              onRemove={removeLinkedTask}
              label={t(lang, "changeFieldLinkedTasks")}
            />
          </div>}

          {/* Linked RAID items (part of the `links` field group) ------ */}
          {isVisible("links") && raidEnabled && <div className="sm:col-span-2">
            <span className="mb-2 flex items-center gap-1 text-sm font-medium text-foreground">
              {t(lang, "changeFieldLinkedRaid")}<InfoTooltip text={t(lang, "changeFieldLinkedRaidHint")} />
            </span>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {draft.linkedRaidIds.length === 0 && (
                <span className="text-xs italic text-muted-foreground">—</span>
              )}
              {draft.linkedRaidIds.map((rid) => {
                const r = raid.find((item) => item.id === rid);
                return (
                  <span
                    key={rid}
                    className="inline-flex items-center gap-1 rounded bg-surface-muted px-2 py-0.5 text-xs text-foreground"
                  >
                    <span className="font-mono">#{rid}</span>
                    <span className="max-w-[200px] truncate">
                      {r?.title ?? ""}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeLinkedRaid(rid)}
                      aria-label={t(lang, "changeUnlinkRaid")}
                      title={t(lang, "changeUnlinkRaid")}
                      className={`text-muted-foreground hover:text-ui-pink ${INTERACTIVE}`}
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
            <div className="relative">
              <Input
                type="text"
                value={raidPickerQuery}
                onChange={(e) => setRaidPickerQuery(e.target.value)}
                placeholder={t(lang, "raidLinkPickerPlaceholder")}
                className="w-full"
              />
              {raidPickerQuery.trim() !== "" && availableRaid.length > 0 && (
                <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-line bg-surface">
                  {availableRaid.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => addLinkedRaid(r.id)}
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-muted ${INTERACTIVE}`}
                      >
                        <span className="font-mono text-xs text-muted-foreground">
                          #{r.id}
                        </span>
                        <span className="truncate">{r.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>}

          {/* Stakeholders (part of the `links` field group) --------- */}
          {isVisible("links") && stakeholdersEnabled && (
            <StakeholderChipPicker
              lang={lang}
              stakeholders={stakeholders}
              selectedIds={draft.stakeholderIds ?? []}
              onToggle={toggleStakeholder}
            />
          )}

          {error && <ModalFieldError error={error} />}

          <ModalEditFooter
            lang={lang}
            onDelete={onDelete}
            deleteConfirmKey="raidConfirmDelete"
            deleteLabelKey="delete"
            deleteDisabled={isNew}
            onCancel={onCancel}
            saveDisabled={saveDisabled}
            saveLabelKey="raidSave"
          />
    </EditModalShell>
  );
}
