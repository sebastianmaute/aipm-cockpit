"use client";

import dynamic from "next/dynamic";
import { type RefObject, useState } from "react";
import { ComboInput } from "./combo-input";
import { ModalHeader } from "./modal-header";
import { useDraggable } from "./use-draggable";
import { ContactInput } from "./contact-input";
import type { listContacts } from "./contacts";
import { DependenciesEditor } from "./dependencies-editor";
import { formatDuration, parseDuration } from "./duration";
import {
  computeTaskHealth,
  HEALTH_VALUES,
  healthColorName,
  healthDot,
  type Health,
} from "./health";
import { type Lang, priorityLabel, t } from "./i18n";
import { LabelsInput } from "./labels-input";
import { Modal } from "./modal";
import {
  ASSIGNEE_MAX,
  EMAIL_MAX,
  GROUP_MAX,
  TASK_NAME_MAX,
  TEXTAREA_MAX,
  sanitizeVoiceTranscript,
} from "./sanitize";
import { SegmentedControl } from "./segmented-control";
import { useTaskForm } from "./task-form-context";
import { PRIORITIES, type Absence, type Task } from "./types";

// voice-button is lazy-loaded — it transitively pulls the Web Speech API
// shims in voice.ts which we only need when the user clicks the mic.
const InlineMicButton = dynamic(
  () => import("./voice-button").then((m) => m.InlineMicButton),
  { ssr: false },
);

// Same compact input class the rest of the form uses. Declared here to avoid
// a circular import back into task-manager.tsx.
const inputClass =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";

export interface TaskFormModalProps {
  lang: Lang;
  today: string;
  nextId: number;
  contactsList: ReturnType<typeof listContacts>;
  absences: Absence[];
  tasksForDeps: Task[];
  uniqueGroups: string[];
  uniqueLabels: string[];
  editingIsJiraLinked: boolean;
  jiraEnabled: boolean;
  error: string | null;
  holidaySet: Set<string>;
  jiraProjectKey: string | undefined;
  jiraDefaultIssueType: string | undefined;
  modalRef: RefObject<HTMLDivElement | null>;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  onRemoveContact: (name: string) => void;
  onShowToast: (kind: "info" | "error", text: string) => void;
  onAddAssigneeToAddressBook: (name: string, email: string) => void;
}

export function TaskFormModal({
  lang,
  today,
  nextId,
  contactsList,
  absences,
  tasksForDeps,
  uniqueGroups,
  uniqueLabels,
  editingIsJiraLinked,
  jiraEnabled,
  error,
  holidaySet,
  jiraProjectKey,
  jiraDefaultIssueType,
  modalRef,
  onSubmit,
  onCancel,
  onRemoveContact,
  onShowToast,
  onAddAssigneeToAddressBook,
}: TaskFormModalProps) {
  const { form, setForm, editingId, taskModalOpen } = useTaskForm();
  const isEditing = editingId !== null;
  const { offset, handleProps } = useDraggable(taskModalOpen);
  if (!taskModalOpen) return null;

  return (
    <Modal
      open
      onClose={onCancel}
      ariaLabel={
        isEditing ? t(lang, "tabEditTask", editingId!) : t(lang, "tabNewTask")
      }
      backdropClassName="bg-AIPM-dark-blue/40 overflow-y-auto"
    >
      <div
        ref={modalRef}
        data-modal-panel
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
        className="relative flex w-[700px] min-w-[460px] max-w-[95vw] resize flex-col overflow-hidden rounded-xl border border-AIPM-light-grey bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
      >
        <ModalHeader
          lang={lang}
          title={isEditing ? t(lang, "tabEditTask", editingId!) : t(lang, "tabNewTask")}
          onClose={onCancel}
          dragHandleProps={handleProps}
        />
        <form
          onSubmit={onSubmit}
          className="min-h-0 flex-1 overflow-y-auto grid grid-cols-1 gap-4 p-6 sm:grid-cols-2"
        >
          <Field label={t(lang, "id")}>
            <input
              type="text"
              value={`#${isEditing ? editingId : nextId}`}
              readOnly
              className="w-full cursor-not-allowed rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"
            />
          </Field>

          <Field label={t(lang, "priority")}>
            <SegmentedControl
              value={form.priority}
              ariaLabel={t(lang, "priority")}
              options={PRIORITIES.map((p) => ({
                value: p,
                label: priorityLabel(lang, p),
              }))}
              onChange={(p) => setForm({ ...form, priority: p })}
            />
          </Field>

          <Field
            label={t(lang, "taskName")}
            required
            className="sm:col-span-2"
          >
            <div className="relative">
              <input
                type="text"
                required
                maxLength={TASK_NAME_MAX}
                value={form.taskName}
                onChange={(e) => setForm({ ...form, taskName: e.target.value })}
                placeholder={t(lang, "placeholderTaskName")}
                className={`${inputClass} pr-10`}
              />
              <InlineMicButton
                lang={lang}
                onTranscript={(text) => {
                  const clean = sanitizeVoiceTranscript(text);
                  setForm((prev) => ({
                    ...prev,
                    taskName: (prev.taskName
                      ? `${prev.taskName} ${clean}`
                      : clean
                    ).slice(0, TASK_NAME_MAX),
                  }));
                }}
                onError={(msg) => onShowToast("error", msg)}
              />
            </div>
          </Field>

          <Field label={t(lang, "assignee")} required>
            {/*
              ContactInput renders a text input + autocomplete popover of
              previously-used (assignee, email) pairs. Picking a suggestion
              fills BOTH the assignee field and the email field in one go.
              Typing freely is still allowed; the suggestion is just a
              convenience. Each row carries its own × to remove it from the
              persisted address book.
            */}
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <ContactInput
                  lang={lang}
                  value={form.assignee}
                  contacts={contactsList}
                  onChangeName={(name) =>
                    setForm((prev) => ({ ...prev, assignee: name }))
                  }
                  onChangePair={(name, email) =>
                    setForm((prev) => ({
                      ...prev,
                      assignee: name,
                      assigneeEmail: email,
                    }))
                  }
                  onRemoveContact={onRemoveContact}
                  placeholder={t(lang, "placeholderAssignee")}
                  maxLength={ASSIGNEE_MAX}
                  disabled={editingIsJiraLinked}
                  title={
                    editingIsJiraLinked ? t(lang, "jiraManagedHint") : undefined
                  }
                />
              </div>
              <button
                type="button"
                onClick={() =>
                  onAddAssigneeToAddressBook(form.assignee, form.assigneeEmail)
                }
                disabled={editingIsJiraLinked}
                aria-label={t(lang, "taskAddAssigneeToAddressBook")}
                title={t(lang, "taskAddAssigneeToAddressBook")}
                className="shrink-0 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-AIPM-dark-grey shadow-sm hover:border-AIPM-dark-blue hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-AIPM-light-grey dark:hover:bg-zinc-800"
              >
                +
              </button>
            </div>
            {editingIsJiraLinked && (
              <p className="mt-1 text-xs italic text-AIPM-medium-grey">
                🔒 {t(lang, "jiraManagedHint")}
              </p>
            )}
          </Field>

          <Field label={t(lang, "email")}>
            <input
              type="email"
              maxLength={EMAIL_MAX}
              value={form.assigneeEmail}
              onChange={(e) =>
                setForm({ ...form, assigneeEmail: e.target.value })
              }
              placeholder={t(lang, "placeholderEmail")}
              className={inputClass}
            />
          </Field>

          <Field label={t(lang, "startDate")}>
            <input
              type="date"
              max={form.dueDate || undefined}
              value={form.startDate}
              onChange={(e) =>
                setForm({ ...form, startDate: e.target.value })
              }
              className={inputClass}
            />
            <p className="mt-1 text-xs text-AIPM-medium-grey">
              {t(lang, "startDateHint")}
            </p>
          </Field>

          <Field label={t(lang, "dueDate")} required>
            <input
              type="date"
              required
              min={today}
              value={form.dueDate}
              onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              className={inputClass}
            />
            {(() => {
              // Phase 5 — non-blocking absence warning: when the due date
              // falls inside any absence for the form's assignee, show a
              // hint. Multiple overlaps render as one line each.
              const assigneeKey = form.assignee.trim().toLowerCase();
              const due = form.dueDate.trim();
              if (!assigneeKey || !due) return null;
              const hits = absences.filter(
                (a) =>
                  a.assignee.trim().toLowerCase() === assigneeKey &&
                  due >= a.startDate &&
                  due <= a.endDate,
              );
              if (hits.length === 0) return null;
              return (
                <div className="mt-1 space-y-0.5">
                  {hits.map((a) => (
                    <p
                      key={a.id}
                      className="text-xs text-amber-700 dark:text-amber-400"
                    >
                      {t(
                        lang,
                        "taskDueDateAbsenceWarning",
                        a.assignee,
                        a.type,
                        a.startDate,
                        a.endDate,
                      )}
                    </p>
                  ))}
                </div>
              );
            })()}
          </Field>

          <Field label={t(lang, "lastUpdateDate")}>
            <input
              type="date"
              value={form.lastUpdateDate}
              onChange={(e) =>
                setForm({ ...form, lastUpdateDate: e.target.value })
              }
              className={inputClass}
            />
          </Field>

          <EffortField
            lang={lang}
            label={t(lang, "taskOriginalEstimate")}
            minutes={form.originalEstimateMinutes}
            onChange={(minutes) =>
              setForm((prev) => ({ ...prev, originalEstimateMinutes: minutes }))
            }
          />

          <EffortField
            lang={lang}
            label={t(lang, "taskTimeSpent")}
            minutes={form.timeSpentMinutes}
            onChange={(minutes) =>
              setForm((prev) => ({ ...prev, timeSpentMinutes: minutes }))
            }
          />

          <Field label={t(lang, "group")}>
            <ComboInput
              lang={lang}
              value={form.group}
              suggestions={uniqueGroups}
              onChange={(group) => setForm({ ...form, group })}
              placeholder={t(lang, "placeholderGroup")}
              maxLength={GROUP_MAX}
            />
          </Field>

          <Field label={t(lang, "labels")}>
            <LabelsInput
              lang={lang}
              value={form.labels}
              suggestions={uniqueLabels}
              onChange={(labels) => setForm({ ...form, labels })}
            />
          </Field>

          <Field label={t(lang, "depDependencies")} className="sm:col-span-2">
            <DependenciesEditor
              lang={lang}
              value={form.dependencies}
              allTasks={tasksForDeps}
              ownTaskId={editingId}
              onChange={(dependencies) =>
                setForm((prev) => ({ ...prev, dependencies }))
              }
            />
          </Field>

          <Field label={t(lang, "blockers")} className="sm:col-span-2">
            <textarea
              rows={2}
              maxLength={TEXTAREA_MAX}
              value={form.blockers}
              onChange={(e) => setForm({ ...form, blockers: e.target.value })}
              placeholder={t(lang, "placeholderBlockers")}
              className={inputClass}
            />
          </Field>

          <Field label={t(lang, "health")} className="sm:col-span-2">
            {(() => {
              // Show what the auto-rule would say so the user can decide
              // whether to override it. Recomputed each render — cheap.
              const previewTask: Task = {
                id: editingId ?? 0,
                taskName: form.taskName,
                assignee: form.assignee,
                assigneeEmail: form.assigneeEmail,
                startDate: form.startDate || undefined,
                dueDate: form.dueDate,
                lastUpdateDate: form.lastUpdateDate,
                priority: form.priority,
                blockers: form.blockers,
                notes: form.notes,
                group: form.group,
                labels: form.labels,
                dependencies: form.dependencies,
              };
              const autoHealth = computeTaskHealth(previewTask, today, holidaySet);
              const autoLabel = t(
                lang,
                "healthAutoCurrent",
                healthColorName(autoHealth.color, lang),
              );
              const chipBase =
                "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium focus:outline-none focus:ring-1";
              const chipInactive =
                "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800";
              const chipActive: Record<Health, string> = {
                R: "border-red-500 bg-red-50 text-red-700 dark:border-red-500 dark:bg-red-950/40 dark:text-red-300",
                A: "border-amber-500 bg-amber-50 text-amber-800 dark:border-amber-500 dark:bg-amber-950/40 dark:text-amber-200",
                G: "border-emerald-500 bg-emerald-50 text-emerald-800 dark:border-emerald-500 dark:bg-emerald-950/40 dark:text-emerald-200",
              };
              return (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, healthOverride: "" })}
                    aria-pressed={form.healthOverride === ""}
                    className={`${chipBase} ${
                      form.healthOverride === ""
                        ? "border-AIPM-dark-blue bg-AIPM-light-grey text-AIPM-dark-blue dark:border-AIPM-blue dark:bg-zinc-800 dark:text-AIPM-light-grey"
                        : chipInactive
                    }`}
                  >
                    {autoLabel}
                  </button>
                  {HEALTH_VALUES.map((h) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => setForm({ ...form, healthOverride: h })}
                      aria-pressed={form.healthOverride === h}
                      className={`${chipBase} ${
                        form.healthOverride === h ? chipActive[h] : chipInactive
                      }`}
                    >
                      <span
                        aria-hidden
                        className={`inline-block h-2 w-2 rounded-full ${healthDot[h]}`}
                      />
                      {healthColorName(h, lang)}
                    </button>
                  ))}
                </div>
              );
            })()}
          </Field>

          <Field label={t(lang, "notes")} className="sm:col-span-2">
            <textarea
              rows={3}
              maxLength={TEXTAREA_MAX}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder={t(lang, "placeholderNotes")}
              className={inputClass}
            />
          </Field>

          {error && (
            <p
              role="alert"
              className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300 sm:col-span-2"
            >
              {error}
            </p>
          )}

          {!isEditing &&
            jiraEnabled &&
            jiraProjectKey && (
              <label className="flex items-center gap-2 text-sm text-AIPM-dark-grey sm:col-span-2 dark:text-AIPM-light-grey">
                <input
                  type="checkbox"
                  checked={form.pushToJira}
                  onChange={(e) =>
                    setForm({ ...form, pushToJira: e.target.checked })
                  }
                  className="h-4 w-4 cursor-pointer rounded border-zinc-300 text-AIPM-dark-blue focus:ring-AIPM-dark-blue dark:border-zinc-600 dark:bg-zinc-800"
                />
                <span>
                  {t(
                    lang,
                    "jiraCreateOnSubmit",
                    jiraProjectKey,
                    // Inlined: same as jira-api's defaultIssueTypeForCreate.
                    jiraDefaultIssueType ?? "Task",
                  )}
                </span>
              </label>
            )}
          <div className="flex justify-end gap-2 sm:col-span-2">
            {isEditing && (
              <button
                type="button"
                onClick={onCancel}
                className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                {t(lang, "cancel")}
              </button>
            )}
            <button
              type="submit"
              className="rounded-md bg-AIPM-dark-blue px-4 py-2 text-sm font-medium text-white shadow-sm hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-AIPM-dark-blue focus:ring-offset-2"
            >
              {isEditing ? t(lang, "updateTask") : t(lang, "addTask")}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}

// Effort field — a controlled text input that parses Jira-style "w/d/h/m"
// into canonical minutes. Keeps a local string so the user can type freely
// (and so an existing task renders as "2w 3d"). Empty → unset (undefined);
// unparseable → keep the string, flag invalid, and DON'T write a value.
function EffortField({
  lang,
  label,
  minutes,
  onChange,
}: {
  lang: Lang;
  label: string;
  minutes: number | undefined;
  onChange: (minutes: number | undefined) => void;
}) {
  const [text, setText] = useState(() => formatDuration(minutes ?? 0));
  const [invalid, setInvalid] = useState(false);

  return (
    <Field label={label}>
      <input
        type="text"
        value={text}
        onChange={(e) => {
          const value = e.target.value;
          setText(value);
          if (value.trim() === "") {
            setInvalid(false);
            onChange(undefined);
            return;
          }
          const mins = parseDuration(value);
          if (mins === null) {
            setInvalid(true);
            return;
          }
          setInvalid(false);
          onChange(mins);
        }}
        placeholder={t(lang, "taskEffortHint")}
        className={inputClass}
      />
      {invalid && (
        <p className="mt-1 text-xs text-AIPM-pink">
          {t(lang, "taskEffortInvalid")}
        </p>
      )}
    </Field>
  );
}

// Field helper — moved verbatim from task-manager.tsx.
function Field({
  label,
  required,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </span>
      {children}
    </label>
  );
}
