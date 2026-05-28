"use client";

import { ComboInput } from "./combo-input";
import { type Lang, priorityLabel, t } from "./i18n";
import { LabelsInput } from "./labels-input";
import {
  ASSIGNEE_MAX,
  EMAIL_MAX,
  GROUP_MAX,
  TEXTAREA_MAX,
} from "./sanitize";
import { useTaskForm } from "./task-form-context";
import { PRIORITIES, type Priority } from "./types";

// Same compact input class the rest of the form uses. Duplicated here to
// avoid a circular import back into task-manager.tsx.
const inputClass =
  "w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-foreground focus:border-line focus:outline-none focus:ring-1 focus:ring-AIPM-green";

export interface BulkEditModalProps {
  lang: Lang;
  today: string;
  selectedIds: Set<number>;
  selectedJiraCount: number;
  uniqueGroups: string[];
  uniqueLabels: string[];
  onApply: () => void;
  onCancel: () => void;
}

export function BulkEditModal({
  lang,
  today,
  selectedIds,
  selectedJiraCount,
  uniqueGroups,
  uniqueLabels,
  onApply,
  onCancel,
}: BulkEditModalProps) {
  const { bulkEdit, setBulkEdit, bulkEditOpen } = useTaskForm();
  if (!bulkEditOpen) return null;
  if (selectedIds.size === 0) return null;

  return (
    <div className="mb-4 rounded-xl border border-line bg-surface p-6">
      <h3 className="mb-4 text-lg font-medium text-foreground">
        {selectedIds.size === 1
          ? t(lang, "bulkEditTitleOne")
          : t(lang, "bulkEditTitleMany", selectedIds.size)}
      </h3>

      <div className="space-y-4">
        <BulkEditFieldRow
          id="bulk-priority"
          label={t(lang, "priority")}
          enabled={bulkEdit.enabled.priority}
          onToggle={() =>
            setBulkEdit((b) => ({
              ...b,
              enabled: { ...b.enabled, priority: !b.enabled.priority },
            }))
          }
        >
          <select
            value={bulkEdit.priority}
            onChange={(e) =>
              setBulkEdit((b) => ({
                ...b,
                priority: e.target.value as Priority,
              }))
            }
            disabled={!bulkEdit.enabled.priority}
            className={`${inputClass} disabled:opacity-50`}
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {priorityLabel(lang, p)}
              </option>
            ))}
          </select>
        </BulkEditFieldRow>

        <BulkEditFieldRow
          id="bulk-due-date"
          label={t(lang, "dueDate")}
          enabled={bulkEdit.enabled.dueDate}
          onToggle={() =>
            setBulkEdit((b) => ({
              ...b,
              enabled: { ...b.enabled, dueDate: !b.enabled.dueDate },
            }))
          }
        >
          <input
            type="date"
            min={today}
            value={bulkEdit.dueDate}
            onChange={(e) =>
              setBulkEdit((b) => ({ ...b, dueDate: e.target.value }))
            }
            disabled={!bulkEdit.enabled.dueDate}
            className={`${inputClass} disabled:opacity-50`}
          />
        </BulkEditFieldRow>

        <BulkEditFieldRow
          id="bulk-last-update"
          label={t(lang, "lastUpdateDate")}
          enabled={bulkEdit.enabled.lastUpdateDate}
          onToggle={() =>
            setBulkEdit((b) => ({
              ...b,
              enabled: {
                ...b.enabled,
                lastUpdateDate: !b.enabled.lastUpdateDate,
              },
            }))
          }
        >
          <input
            type="date"
            value={bulkEdit.lastUpdateDate}
            onChange={(e) =>
              setBulkEdit((b) => ({
                ...b,
                lastUpdateDate: e.target.value,
              }))
            }
            disabled={!bulkEdit.enabled.lastUpdateDate}
            className={`${inputClass} disabled:opacity-50`}
          />
        </BulkEditFieldRow>

        <BulkEditFieldRow
          id="bulk-assignee"
          label={t(lang, "assignee")}
          enabled={bulkEdit.enabled.assignee && selectedJiraCount === 0}
          onToggle={() => {
            if (selectedJiraCount > 0) {
              window.alert(
                t(lang, "jiraBulkAssigneeBlocked", selectedJiraCount),
              );
              return;
            }
            setBulkEdit((b) => ({
              ...b,
              enabled: { ...b.enabled, assignee: !b.enabled.assignee },
            }));
          }}
        >
          <input
            type="text"
            maxLength={ASSIGNEE_MAX}
            value={bulkEdit.assignee}
            onChange={(e) =>
              setBulkEdit((b) => ({ ...b, assignee: e.target.value }))
            }
            placeholder={t(lang, "placeholderAssignee")}
            disabled={
              !bulkEdit.enabled.assignee || selectedJiraCount > 0
            }
            className={`${inputClass} disabled:opacity-50`}
          />
          {selectedJiraCount > 0 && (
            <p className="mt-1 text-xs italic text-muted-foreground">
              🔒 {t(lang, "jiraBulkAssigneeBlocked", selectedJiraCount)}
            </p>
          )}
        </BulkEditFieldRow>

        <BulkEditFieldRow
          id="bulk-email"
          label={t(lang, "email")}
          enabled={bulkEdit.enabled.assigneeEmail}
          onToggle={() =>
            setBulkEdit((b) => ({
              ...b,
              enabled: {
                ...b.enabled,
                assigneeEmail: !b.enabled.assigneeEmail,
              },
            }))
          }
        >
          <input
            type="email"
            maxLength={EMAIL_MAX}
            value={bulkEdit.assigneeEmail}
            onChange={(e) =>
              setBulkEdit((b) => ({
                ...b,
                assigneeEmail: e.target.value,
              }))
            }
            placeholder={t(lang, "placeholderEmail")}
            disabled={!bulkEdit.enabled.assigneeEmail}
            className={`${inputClass} disabled:opacity-50`}
          />
        </BulkEditFieldRow>

        <BulkEditFieldRow
          id="bulk-blockers"
          label={t(lang, "blockers")}
          enabled={bulkEdit.enabled.blockers}
          onToggle={() =>
            setBulkEdit((b) => ({
              ...b,
              enabled: { ...b.enabled, blockers: !b.enabled.blockers },
            }))
          }
        >
          <textarea
            rows={2}
            maxLength={TEXTAREA_MAX}
            value={bulkEdit.blockers}
            onChange={(e) =>
              setBulkEdit((b) => ({ ...b, blockers: e.target.value }))
            }
            placeholder={t(lang, "placeholderBlockers")}
            disabled={!bulkEdit.enabled.blockers}
            className={`${inputClass} disabled:opacity-50`}
          />
        </BulkEditFieldRow>

        <BulkEditFieldRow
          id="bulk-notes"
          label={t(lang, "notes")}
          enabled={bulkEdit.enabled.notes}
          onToggle={() =>
            setBulkEdit((b) => ({
              ...b,
              enabled: { ...b.enabled, notes: !b.enabled.notes },
            }))
          }
        >
          <textarea
            rows={3}
            maxLength={TEXTAREA_MAX}
            value={bulkEdit.notes}
            onChange={(e) =>
              setBulkEdit((b) => ({ ...b, notes: e.target.value }))
            }
            placeholder={t(lang, "placeholderNotes")}
            disabled={!bulkEdit.enabled.notes}
            className={`${inputClass} disabled:opacity-50`}
          />
        </BulkEditFieldRow>

        <BulkEditFieldRow
          id="bulk-group"
          label={t(lang, "group")}
          enabled={bulkEdit.enabled.group}
          onToggle={() =>
            setBulkEdit((b) => ({
              ...b,
              enabled: { ...b.enabled, group: !b.enabled.group },
            }))
          }
        >
          <ComboInput
            lang={lang}
            value={bulkEdit.group}
            suggestions={uniqueGroups}
            onChange={(group) =>
              setBulkEdit((b) => ({ ...b, group }))
            }
            placeholder={t(lang, "placeholderGroup")}
            maxLength={GROUP_MAX}
            disabled={!bulkEdit.enabled.group}
          />
        </BulkEditFieldRow>

        <BulkEditFieldRow
          id="bulk-labels"
          label={t(lang, "labels")}
          enabled={bulkEdit.enabled.labels}
          onToggle={() =>
            setBulkEdit((b) => ({
              ...b,
              enabled: { ...b.enabled, labels: !b.enabled.labels },
            }))
          }
        >
          <LabelsInput
            lang={lang}
            value={bulkEdit.labels}
            suggestions={uniqueLabels}
            onChange={(labels) =>
              setBulkEdit((b) => ({ ...b, labels }))
            }
            disabled={!bulkEdit.enabled.labels}
          />
        </BulkEditFieldRow>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-muted"
        >
          {t(lang, "cancel")}
        </button>
        <button
          type="button"
          onClick={onApply}
          className="rounded-md bg-AIPM-dark-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          {selectedIds.size === 1
            ? t(lang, "bulkApplyOne")
            : t(lang, "bulkApplyMany", selectedIds.size)}
        </button>
      </div>
    </div>
  );
}

// BulkEditFieldRow helper — moved verbatim from task-manager.tsx.
function BulkEditFieldRow({
  id,
  label,
  enabled,
  onToggle,
  children,
}: {
  id: string;
  label: string;
  enabled: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        checked={enabled}
        onChange={onToggle}
        className="mt-2 h-4 w-4 cursor-pointer rounded border-line text-AIPM-dark-blue focus:ring-AIPM-green"
      />
      <div className="min-w-0 flex-1">
        <label
          htmlFor={id}
          className="mb-1 block cursor-pointer text-sm font-medium text-foreground"
        >
          {label}
        </label>
        {children}
      </div>
    </div>
  );
}
