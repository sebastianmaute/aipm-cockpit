"use client";

import dynamic from "next/dynamic";
import { useId, useState } from "react";
import { ComboInput } from "./combo-input";
import { DocumentLinksFieldGated } from "./document-links-field-gated";
import { ContactInput } from "./contact-input";
import type { listContacts } from "./contacts";
import { DependenciesEditor } from "./dependencies-editor";
import { formatDuration, parseDuration } from "./duration";
import { CharCounter, FieldError, FieldNotice } from "./field-feedback";
import {
  computeTaskHealth,
  HEALTH_VALUES,
  healthColorName,
  healthDot,
  type Health,
} from "./health";
import { type Lang, priorityLabel, t } from "./i18n";
import { LabelsInput } from "./labels-input";
import {
  ASSIGNEE_MAX,
  EMAIL_MAX,
  GROUP_MAX,
  TASK_NAME_MAX,
  TEXTAREA_MAX,
  sanitizeVoiceTranscript,
} from "./sanitize";
import { describeTextCap } from "./sanitize-report";
import { EffortProgressBar } from "./effort-progress-bar";
import { SegmentedControl } from "./segmented-control";
import { useTaskForm } from "./task-form-context";
import { type TaskErrorField, type TaskFieldErrors } from "./task-validation";
import { PRIORITIES, type Absence, type Task } from "./types";

// voice-button is lazy-loaded — it transitively pulls the Web Speech API
// shims in voice.ts which we only need when the user clicks the mic.
const InlineMicButton = dynamic(
  () => import("./voice-button").then((m) => m.InlineMicButton),
  { ssr: false },
);

// Same compact input class the rest of the form uses. Declared here to avoid
// a circular import back into task-form-modal.tsx.
export const inputClass =
  "w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-foreground focus:border-line focus:outline-none focus:ring-1 focus:ring-AIPM-green dark:border-line dark:bg-surface dark:text-foreground";

export interface TaskFormFieldsProps {
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
  fieldErrors: TaskFieldErrors;
  submitted: boolean;
  holidaySet: Set<string>;
  jiraProjectKey: string | undefined;
  jiraDefaultIssueType: string | undefined;
  onRemoveContact: (name: string) => void;
  onShowToast: (kind: "info" | "error", text: string) => void;
  onAddAssigneeToAddressBook: (name: string, email: string) => void;
}

export function TaskFormFields({
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
  fieldErrors,
  submitted,
  holidaySet,
  jiraProjectKey,
  jiraDefaultIssueType,
  onRemoveContact,
  onShowToast,
  onAddAssigneeToAddressBook,
}: TaskFormFieldsProps) {
  const { form, setForm, editingId } = useTaskForm();
  const isEditing = editingId !== null;

  // A field's error shows once it's been blurred (touched) or a submit was
  // attempted — a pristine form stays quiet. Reset when switching tasks via the
  // "adjust state during render" pattern (same idiom as contact-input.tsx) — an
  // effect would trip react-hooks/set-state-in-effect.
  const [touched, setTouched] = useState<Set<TaskErrorField>>(() => new Set());
  const [prevEditingId, setPrevEditingId] = useState(editingId);
  if (prevEditingId !== editingId) {
    setPrevEditingId(editingId);
    setTouched(new Set());
  }
  const markTouched = (field: TaskErrorField) =>
    setTouched((prev) => (prev.has(field) ? prev : new Set(prev).add(field)));
  const errorFor = (field: TaskErrorField): string | null => {
    const key = fieldErrors[field];
    if (!key || !(submitted || touched.has(field))) return null;
    return t(lang, key);
  };
  /** aria-describedby: the field's base id(s) plus its error id when shown.
   *  `base` is optional — dueDate has no CharCounter, so it passes none and is
   *  described only by its error id (when active). */
  const describedBy = (field: TaskErrorField, base?: string): string | undefined =>
    [base, errorFor(field) ? `${field}-error` : ""].filter(Boolean).join(" ") || undefined;

  return (
    <>
      <TaskFormSection index={1} title={t(lang, "taskFormSectionDetails")}>
        <Field label={t(lang, "id")}>
          <input
            type="text"
            value={`#${isEditing ? editingId : nextId}`}
            readOnly
            className="w-full cursor-not-allowed rounded-md border border-line bg-surface-muted px-3 py-2 text-sm text-muted-foreground dark:border-line dark:bg-surface-muted dark:text-muted-foreground"
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
              value={form.taskName}
              onChange={(e) => setForm({ ...form, taskName: e.target.value })}
              onBlur={(e) => {
                setForm({ ...form, taskName: describeTextCap(e.target.value, TASK_NAME_MAX).value.trim() });
                markTouched("taskName");
              }}
              placeholder={t(lang, "placeholderTaskName")}
              aria-invalid={errorFor("taskName") ? true : undefined}
              aria-describedby={describedBy("taskName", "taskName-counter")}
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
          <CharCounter value={form.taskName} max={TASK_NAME_MAX} id="taskName-counter" lang={lang} />
          <FieldError id="taskName-error">{errorFor("taskName")}</FieldError>
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
                onBlur={(e) => {
                  setForm((prev) => ({ ...prev, assignee: describeTextCap(e.target.value, ASSIGNEE_MAX).value.trim() }));
                  markTouched("assignee");
                }}
                aria-invalid={errorFor("assignee") ? true : undefined}
                aria-describedby={describedBy("assignee", "assignee-counter")}
                aria-required
                placeholder={t(lang, "placeholderAssignee")}
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
              className="shrink-0 rounded-md border border-line bg-surface px-3 py-2 text-sm font-medium text-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 dark:border-line dark:bg-surface dark:text-foreground dark:hover:bg-surface-muted"
            >
              +
            </button>
          </div>
          <CharCounter value={form.assignee} max={ASSIGNEE_MAX} id="assignee-counter" lang={lang} />
          <FieldError id="assignee-error">{errorFor("assignee")}</FieldError>
          {editingIsJiraLinked && (
            <p className="mt-1 text-xs italic text-muted-foreground">
              🔒 {t(lang, "jiraManagedHint")}
            </p>
          )}
        </Field>

        <Field label={t(lang, "email")}>
          <input
            type="email"
            value={form.assigneeEmail}
            onChange={(e) =>
              setForm({ ...form, assigneeEmail: e.target.value })
            }
            onBlur={(e) => {
              setForm({ ...form, assigneeEmail: describeTextCap(e.target.value, EMAIL_MAX).value.trim() });
              markTouched("assigneeEmail");
            }}
            placeholder={t(lang, "placeholderEmail")}
            aria-invalid={errorFor("assigneeEmail") ? true : undefined}
            aria-describedby={describedBy("assigneeEmail", "email-counter")}
            className={inputClass}
          />
          <CharCounter value={form.assigneeEmail} max={EMAIL_MAX} id="email-counter" lang={lang} />
          <FieldError id="assigneeEmail-error">{errorFor("assigneeEmail")}</FieldError>
        </Field>
      </TaskFormSection>

      <TaskFormSection index={2} title={t(lang, "taskFormSectionScheduling")}>
        <Field label={t(lang, "startDate")}>
          <input
            type="date"
            max={form.dueDate || undefined}
            value={form.startDate}
            onChange={(e) =>
              setForm({ ...form, startDate: e.target.value })
            }
            aria-describedby="startDate-hint"
            className={inputClass}
          />
          <p id="startDate-hint" className="mt-1 text-xs text-muted-foreground">
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
            onBlur={() => markTouched("dueDate")}
            aria-invalid={errorFor("dueDate") ? true : undefined}
            aria-describedby={describedBy("dueDate")}
            className={inputClass}
          />
          <FieldError id="dueDate-error">{errorFor("dueDate")}</FieldError>
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
                    className="text-xs text-AIPM-purple"
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
      </TaskFormSection>

      <TaskFormSection index={3} title={t(lang, "taskFormSectionEffort")}>
        <Field label={t(lang, "group")}>
          <ComboInput
            lang={lang}
            value={form.group}
            suggestions={uniqueGroups}
            onChange={(group) => setForm({ ...form, group })}
            onBlur={(e) =>
              setForm((prev) => ({ ...prev, group: describeTextCap(e.target.value, GROUP_MAX).value.trim() }))
            }
            aria-describedby="group-counter"
            placeholder={t(lang, "placeholderGroup")}
          />
          <CharCounter value={form.group} max={GROUP_MAX} id="group-counter" lang={lang} />
        </Field>

        <EffortField
          key={`estimate-${editingId ?? "new"}`}
          lang={lang}
          label={t(lang, "taskOriginalEstimate")}
          minutes={form.originalEstimateMinutes}
          onChange={(minutes) =>
            setForm((prev) => ({ ...prev, originalEstimateMinutes: minutes }))
          }
        />

        <EffortField
          key={`spent-${editingId ?? "new"}`}
          lang={lang}
          label={t(lang, "taskTimeSpent")}
          minutes={form.timeSpentMinutes}
          onChange={(minutes) =>
            setForm((prev) => ({ ...prev, timeSpentMinutes: minutes }))
          }
        />

        <EffortProgressBar
          lang={lang}
          estimateMin={form.originalEstimateMinutes}
          spentMin={form.timeSpentMinutes}
        />

        <Field label={t(lang, "labels")}>
          <LabelsInput
            lang={lang}
            value={form.labels}
            suggestions={uniqueLabels}
            onChange={(labels) => setForm({ ...form, labels })}
          />
        </Field>
      </TaskFormSection>

      <TaskFormSection index={4} title={t(lang, "taskFormSectionRelationships")}>
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
            value={form.blockers}
            onChange={(e) => setForm({ ...form, blockers: e.target.value })}
            onBlur={(e) =>
              setForm({ ...form, blockers: describeTextCap(e.target.value, TEXTAREA_MAX).value })
            }
            placeholder={t(lang, "placeholderBlockers")}
            aria-describedby="blockers-counter"
            className={inputClass}
          />
          <CharCounter value={form.blockers} max={TEXTAREA_MAX} id="blockers-counter" lang={lang} />
        </Field>
      </TaskFormSection>

      <TaskFormSection index={5} title={t(lang, "taskFormSectionStatus")}>
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
              "border-line bg-surface text-foreground hover:bg-surface-muted dark:border-line dark:bg-surface dark:text-foreground dark:hover:bg-surface-muted";
            const chipActive: Record<Health, string> = {
              R: "border-AIPM-pink bg-AIPM-pink/10 text-AIPM-pink dark:border-AIPM-pink dark:bg-AIPM-pink/15",
              A: "border-AIPM-purple bg-AIPM-purple/10 text-AIPM-purple dark:border-AIPM-purple dark:bg-AIPM-purple/15",
              G: "border-AIPM-green bg-AIPM-green/10 text-AIPM-green dark:border-AIPM-green dark:bg-AIPM-green/15",
            };
            return (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, healthOverride: "" })}
                  aria-pressed={form.healthOverride === ""}
                  className={`${chipBase} ${
                    form.healthOverride === ""
                      ? "border-AIPM-dark-blue bg-surface-muted text-AIPM-dark-blue dark:border-AIPM-blue dark:bg-surface-muted dark:text-AIPM-light-grey"
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
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            onBlur={(e) =>
              setForm({ ...form, notes: describeTextCap(e.target.value, TEXTAREA_MAX).value })
            }
            placeholder={t(lang, "placeholderNotes")}
            aria-describedby="notes-counter"
            className={inputClass}
          />
          <CharCounter value={form.notes} max={TEXTAREA_MAX} id="notes-counter" lang={lang} />
        </Field>

        <Field label={t(lang, "documents")} className="sm:col-span-2">
          <DocumentLinksFieldGated
            value={form.documentLinks}
            onChange={(documentLinks) => setForm((prev) => ({ ...prev, documentLinks }))}
            lang={lang}
          />
        </Field>

        {!isEditing &&
          jiraEnabled &&
          jiraProjectKey && (
            <label className="flex items-center gap-2 text-sm text-foreground sm:col-span-2">
              <input
                type="checkbox"
                checked={form.pushToJira}
                onChange={(e) =>
                  setForm({ ...form, pushToJira: e.target.checked })
                }
                className="h-4 w-4 cursor-pointer rounded border-line text-AIPM-dark-blue focus:ring-AIPM-green dark:border-line dark:bg-surface-muted"
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
      </TaskFormSection>
    </>
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
  const noticeId = useId();

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
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? noticeId : undefined}
        className={inputClass}
      />
      {invalid && <FieldNotice id={noticeId}>{t(lang, "taskEffortInvalid")}</FieldNotice>}
    </Field>
  );
}

// One titled, numbered section of the task form. Owns its own two-column grid so
// fields with `sm:col-span-2` keep spanning. Heading uses the AIPM dark-blue token.
export function TaskFormSection({
  index,
  title,
  children,
}: {
  index: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-3 border-b border-line pb-2 text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
        {index}. {title}
      </h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

// Field helper — moved verbatim from task-form-modal.tsx.
export function Field({
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
      <span className="mb-1 block text-sm font-medium text-foreground">
        {label}
        {required && <span className="ml-0.5 text-AIPM-pink">*</span>}
      </span>
      {children}
    </label>
  );
}
