"use client";

import { cloneElement, isValidElement, type ReactElement } from "react";
import { ComboInput } from "./combo-input";
import { fieldClass } from "./form-controls";
import { type Lang, priorityLabel, t } from "./i18n";
import { LabelsInput } from "./labels-input";
import {
  ASSIGNEE_MAX,
  EMAIL_MAX,
  GROUP_MAX,
  TEXTAREA_MAX,
} from "./sanitize";
import { useTaskForm } from "./task-form-context";
import { Button } from "./button";
import { statusLabelKey } from "./task-status-ui";
import { PRIORITIES, TASK_STATUSES, type BudgetBucket, type Priority, type TaskStatus } from "./types";

// Canonical field shell, single-sourced from the shared primitive (was a
// copy-declared ring-1 string; now the ring-2 ui-green standard).
const inputClass = fieldClass(false, "w-full");

export interface BulkEditModalProps {
  lang: Lang;
  today: string;
  selectedIds: Set<number>;
  selectedJiraCount: number;
  uniqueGroups: string[];
  uniqueLabels: string[];
  /** Budget buckets offered by the bucket row; empty hides the row entirely. */
  budgetBuckets: readonly BudgetBucket[];
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
  budgetBuckets,
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

      <div data-bulk-fields className="max-h-[60vh] space-y-4 overflow-y-auto pr-2">
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
          id="bulk-status"
          label={t(lang, "colTaskStatus")}
          enabled={bulkEdit.enabled.status}
          onToggle={() =>
            setBulkEdit((b) => ({
              ...b,
              enabled: { ...b.enabled, status: !b.enabled.status },
            }))
          }
        >
          <select
            value={bulkEdit.status}
            onChange={(e) =>
              setBulkEdit((b) => ({
                ...b,
                status: e.target.value as TaskStatus,
              }))
            }
            disabled={!bulkEdit.enabled.status}
            // Explicit name: this row has a sibling <p> note, so children is an
            // array and BulkEditFieldRow's aria-label clone is skipped.
            aria-label={t(lang, "colTaskStatus")}
            className={`${inputClass} disabled:opacity-50`}
          >
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(lang, statusLabelKey(s))}
              </option>
            ))}
          </select>
          {selectedJiraCount > 0 && (
            <p className="mt-1 text-xs italic text-muted-foreground">
              {t(lang, "jiraBulkManagedFieldsNote")}
            </p>
          )}
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
          enabled={bulkEdit.enabled.assignee}
          onToggle={() =>
            setBulkEdit((b) => ({
              ...b,
              enabled: { ...b.enabled, assignee: !b.enabled.assignee },
            }))
          }
        >
          <input
            type="text"
            maxLength={ASSIGNEE_MAX}
            value={bulkEdit.assignee}
            onChange={(e) =>
              setBulkEdit((b) => ({ ...b, assignee: e.target.value }))
            }
            placeholder={t(lang, "placeholderAssignee")}
            disabled={!bulkEdit.enabled.assignee}
            // Explicit name: this row has a sibling <p> note, so children is an
            // array and BulkEditFieldRow's aria-label clone is skipped.
            aria-label={t(lang, "assignee")}
            className={`${inputClass} disabled:opacity-50`}
          />
          {selectedJiraCount > 0 && (
            <p className="mt-1 text-xs italic text-muted-foreground">
              {t(lang, "jiraBulkManagedFieldsNote")}
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

        {budgetBuckets.length > 0 && (
        <BulkEditFieldRow
          id="bulk-budget-bucket"
          label={t(lang, "taskBudgetBucket")}
          enabled={bulkEdit.enabled.budgetBucket}
          onToggle={() =>
            setBulkEdit((b) => ({
              ...b,
              enabled: { ...b.enabled, budgetBucket: !b.enabled.budgetBucket },
            }))
          }
        >
          <select
            value={bulkEdit.budgetBucket}
            onChange={(e) =>
              setBulkEdit((b) => ({ ...b, budgetBucket: e.target.value }))
            }
            disabled={!bulkEdit.enabled.budgetBucket}
            className={`${inputClass} disabled:opacity-50`}
          >
            <option value="">{t(lang, "budgetBucketNone")}</option>
            {budgetBuckets.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </BulkEditFieldRow>
        )}

        {/* Nested INSIDE the scrolling field list (not a sibling) — `sticky`
            only has an effect relative to a scrolling ancestor, and this div
            is the only one in the tree above it (the panel itself is
            overflow-hidden and never scrolls). Its own bg-surface keeps field
            rows from showing through as they scroll underneath it. */}
        <div
          data-bulk-actions
          className="sticky bottom-0 mt-6 flex justify-end gap-2 border-t border-line bg-surface pt-4"
        >
          <Button variant="secondary" size="sm" onClick={onCancel}>
            {t(lang, "cancel")}
          </Button>
          <Button variant="primary" size="sm" onClick={onApply}>
            {selectedIds.size === 1
              ? t(lang, "bulkApplyOne")
              : t(lang, "bulkApplyMany", selectedIds.size)}
          </Button>
        </div>
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
        className="mt-2 h-4 w-4 cursor-pointer rounded border-line text-ui-dark-blue focus:ring-ui-green"
      />
      <div className="min-w-0 flex-1">
        <label
          htmlFor={id}
          className="mb-1 block cursor-pointer text-sm font-medium text-foreground"
        >
          {label}
        </label>
        {/* The visible label is bound to the enable checkbox (htmlFor=id), so
            give the field control its own accessible name. Native elements
            (input/select/textarea) accept aria-label; custom children keep
            their own labelling. */}
        {isValidElement(children) && typeof children.type === "string"
          ? cloneElement(children as ReactElement<{ "aria-label"?: string }>, {
              "aria-label":
                (children.props as { "aria-label"?: string })["aria-label"] ?? label,
            })
          : children}
      </div>
    </div>
  );
}
