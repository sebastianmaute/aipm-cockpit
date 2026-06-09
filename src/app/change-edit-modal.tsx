"use client";

// Change-control edit modal — create / edit / delete a ChangeItem. Mirrors
// RaidEditModal's structure (sticky/draggable header, two-column grid form,
// validation error alert, Delete-left / Cancel+Save-right footer, and the two
// autocomplete chip+dropdown link pickers — one over tasks, one over RAID).
// Built as a standalone component using the shared ModalHeader + useDraggable,
// like resource-edit-modal.tsx / absence-edit-modal.tsx.

import { useEffect, useMemo, useState } from "react";
import { type Lang, t, type TranslationKey } from "./i18n";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
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
import { CharCounter, FieldNotice, useAdjustmentTracker } from "./field-feedback";
import { describeTextCap, describeClamp } from "./sanitize-report";
import { BUDGET_NAME_MAX, TEXTAREA_MAX, AMOUNT_MAX } from "./sanitize";
import { useToastContext } from "./toast-context";

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

const INPUT_CLASS = "rounded-md border border-line bg-surface px-3 py-2 text-sm";

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
  const [error, setError] = useState<string | null>(null);
  const [taskPickerQuery, setTaskPickerQuery] = useState("");
  const [raidPickerQuery, setRaidPickerQuery] = useState("");
  const [notice, setNotice] = useState<Record<string, string>>({});
  const adj = useAdjustmentTracker();

  const { offset, handleProps } = useDraggable(true);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

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

  const availableRaid = useMemo(() => {
    const linked = new Set(draft.linkedRaidIds);
    const q = raidPickerQuery.trim().toLowerCase();
    return raid
      .filter((r) => !linked.has(r.id))
      .filter((r) => {
        if (!q) return true;
        if (String(r.id) === q) return true;
        return r.title.toLowerCase().includes(q);
      })
      .slice(0, 20);
  }, [raid, draft.linkedRaidIds, raidPickerQuery]);

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
    setTaskPickerQuery("");
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
    : t(lang, "changeReportTitle");
  const saveDisabled = !draft.title.trim();

  return (
    <Modal
      open
      onClose={onCancel}
      ariaLabel={title}
      align="center"
      backdropClassName="bg-AIPM-dark-blue/40"
      zIndex={50}
    >
      <div
        data-modal-panel
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
        className="relative flex w-[720px] min-w-[460px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-line bg-surface"
      >
        <ModalHeader
          lang={lang}
          title={title}
          onClose={onCancel}
          dragHandleProps={handleProps}
        />

        <form
          onSubmit={handleSubmit}
          className="grid grid-cols-1 gap-4 overflow-y-auto p-6 sm:grid-cols-2"
        >
          {/* Title */}
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-foreground">
              {t(lang, "changeFieldTitle")} *
            </span>
            <input
              type="text"
              required
              value={draft.title}
              onChange={(e) => update("title", e.target.value)}
              onBlur={(e) => update("title", describeTextCap(e.target.value, BUDGET_NAME_MAX).value.trim())}
              aria-describedby="change-title-counter"
              className={INPUT_CLASS}
            />
            <CharCounter value={draft.title} max={BUDGET_NAME_MAX} id="change-title-counter" lang={lang} />
          </label>

          {/* Type */}
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">
              {t(lang, "changeFieldType")}
            </span>
            <select
              aria-label={t(lang, "changeFieldType")}
              value={draft.type}
              onChange={(e) => update("type", e.target.value as ChangeType)}
              className={INPUT_CLASS}
            >
              {CHANGE_TYPES.map((ty) => (
                <option key={ty} value={ty}>
                  {t(lang, TYPE_LABEL_KEYS[ty])}
                </option>
              ))}
            </select>
          </label>

          {/* Status */}
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">
              {t(lang, "changeFieldStatus")}
            </span>
            <select
              aria-label={t(lang, "changeFieldStatus")}
              value={draft.status}
              onChange={(e) => onApplyStatus(e.target.value as ChangeStatus)}
              className={INPUT_CLASS}
            >
              {CHANGE_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {t(lang, STATUS_LABEL_KEYS[st])}
                </option>
              ))}
            </select>
          </label>

          {/* Description */}
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-foreground">
              {t(lang, "changeFieldDescription")}
            </span>
            <textarea
              rows={2}
              value={draft.description}
              onChange={(e) => update("description", e.target.value)}
              onBlur={(e) => update("description", describeTextCap(e.target.value, TEXTAREA_MAX).value)}
              aria-describedby="change-description-counter"
              className={INPUT_CLASS}
            />
            <CharCounter value={draft.description ?? ""} max={TEXTAREA_MAX} id="change-description-counter" lang={lang} />
          </label>

          {/* Impact */}
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">
              {t(lang, "changeFieldImpact")}
            </span>
            <select
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
              className={INPUT_CLASS}
            >
              <option value="">—</option>
              {RAID_SEVERITIES.map((sev) => (
                <option key={sev} value={sev}>
                  {t(lang, IMPACT_LABEL_KEYS[sev])}
                </option>
              ))}
            </select>
          </label>

          {/* Requested by */}
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">
              {t(lang, "changeFieldRequestedBy")}
            </span>
            <input
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
              className={INPUT_CLASS}
            />
            <CharCounter value={draft.requestedBy ?? ""} max={BUDGET_NAME_MAX} id="change-requestedBy-counter" lang={lang} />
          </label>

          {/* Impact description */}
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-foreground">
              {t(lang, "changeFieldImpactDescription")}
            </span>
            <textarea
              rows={2}
              value={draft.impactDescription ?? ""}
              onChange={(e) =>
                update("impactDescription", e.target.value || undefined)
              }
              onBlur={(e) => update("impactDescription", describeTextCap(e.target.value, TEXTAREA_MAX).value || undefined)}
              aria-describedby="change-impactDescription-counter"
              className={INPUT_CLASS}
            />
            <CharCounter value={draft.impactDescription ?? ""} max={TEXTAREA_MAX} id="change-impactDescription-counter" lang={lang} />
          </label>

          {/* Schedule impact (days) */}
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">
              {t(lang, "changeFieldScheduleImpact")}
            </span>
            <input
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
              className={INPUT_CLASS}
            />
            <FieldNotice>{notice.scheduleImpactDays}</FieldNotice>
          </label>

          {/* Cost impact */}
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">
              {t(lang, "changeFieldCostImpact")}
            </span>
            <input
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
              className={INPUT_CLASS}
            />
            <FieldNotice>{notice.costImpact}</FieldNotice>
          </label>

          {/* Raised date */}
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">
              {t(lang, "changeFieldRaisedDate")}
            </span>
            <input
              type="date"
              value={draft.raisedDate}
              onChange={(e) => update("raisedDate", e.target.value)}
              className={INPUT_CLASS}
            />
          </label>

          {/* Decided by */}
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">
              {t(lang, "changeFieldDecisionBy")}
            </span>
            <input
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
              className={INPUT_CLASS}
            />
            <CharCounter value={draft.decisionBy ?? ""} max={BUDGET_NAME_MAX} id="change-decisionBy-counter" lang={lang} />
          </label>

          {/* Decision date — read-only display when set (auto-filled by status). */}
          {draft.decisionDate && (
            <div className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-foreground">
                {t(lang, "changeFieldDecisionDate")}
              </span>
              <span className="rounded-md border border-line bg-surface-muted px-3 py-2 text-sm text-muted-foreground">
                {draft.decisionDate}
              </span>
            </div>
          )}

          {/* Resolution / rationale */}
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-foreground">
              {t(lang, "changeFieldResolution")}
            </span>
            <textarea
              rows={2}
              value={draft.resolutionNotes ?? ""}
              onChange={(e) =>
                update("resolutionNotes", e.target.value || undefined)
              }
              onBlur={(e) => update("resolutionNotes", describeTextCap(e.target.value, TEXTAREA_MAX).value || undefined)}
              aria-describedby="change-resolutionNotes-counter"
              className={INPUT_CLASS}
            />
            <CharCounter value={draft.resolutionNotes ?? ""} max={TEXTAREA_MAX} id="change-resolutionNotes-counter" lang={lang} />
          </label>

          {/* Linked tasks --------------------------------------------- */}
          <div className="sm:col-span-2">
            <span className="mb-2 block text-sm font-medium text-foreground">
              {t(lang, "changeFieldLinkedTasks")}
            </span>
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
                      onClick={() => removeLinkedTask(tid)}
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
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm"
              />
              {taskPickerQuery.trim() !== "" && availableTasks.length > 0 && (
                <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-line bg-surface">
                  {availableTasks.map((tk) => (
                    <li key={tk.id}>
                      <button
                        type="button"
                        onClick={() => addLinkedTask(tk.id)}
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

          {/* Linked RAID items ---------------------------------------- */}
          {raidEnabled && <div className="sm:col-span-2">
            <span className="mb-2 block text-sm font-medium text-foreground">
              {t(lang, "changeFieldLinkedRaid")}
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
                value={raidPickerQuery}
                onChange={(e) => setRaidPickerQuery(e.target.value)}
                placeholder={t(lang, "raidLinkPickerPlaceholder")}
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm"
              />
              {raidPickerQuery.trim() !== "" && availableRaid.length > 0 && (
                <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-line bg-surface">
                  {availableRaid.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => addLinkedRaid(r.id)}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-muted"
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

          <footer className="flex items-center justify-between gap-2 border-t border-line pt-3 sm:col-span-2">
            <div>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(t(lang, "raidConfirmDelete"))) onDelete();
                }}
                disabled={isNew}
                className="rounded-md border border-AIPM-pink/40 bg-surface px-3 py-1.5 text-sm font-medium text-AIPM-pink hover:bg-AIPM-pink/10 disabled:cursor-not-allowed disabled:opacity-50 dark:border-AIPM-pink/50"
              >
                {t(lang, "delete")}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onCancel}
                className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-muted"
              >
                {t(lang, "cancel")}
              </button>
              <button
                type="submit"
                disabled={saveDisabled}
                className="rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-3 py-1.5 text-sm font-medium text-white hover:bg-AIPM-dark-blue/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t(lang, "raidSave")}
              </button>
            </div>
          </footer>
        </form>
      </div>
    </Modal>
  );
}
