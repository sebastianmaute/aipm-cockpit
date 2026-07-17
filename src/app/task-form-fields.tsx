"use client";

import { useId, useRef, useState } from "react";
import { ComboInput } from "./combo-input";
import { KnowledgeLinksFieldGated } from "./knowledge-links-field-gated";
import { ResourcePicker } from "./resource-picker";
import type { listContacts } from "./contacts";
import { DependenciesEditor } from "./dependencies-editor";
import { formatDuration, parseDuration } from "./duration";
import { CharCounter, FieldError, FieldNotice } from "./field-feedback";
import { InfoTooltip } from "./info-tooltip";
import { useDictationMic } from "./dictation-mic";
import { appendDictation } from "./dictation-engine";
import { useAutogrow } from "./use-autogrow";
import { useSettings } from "./use-settings";
import { FOCUS_RING, INTERACTIVE, TRANSITION } from "./interaction-styles";
import {
  computeTaskHealth,
  HEALTH_VALUES,
  healthColorName,
  healthDot,
} from "./health";
import { HEALTH_CHIP_ACTIVE_CLASS } from "./task-health-chip-style";
import { type Lang, priorityLabel, t } from "./i18n";
import { LabelsInput } from "./labels-input";
import {
  ASSIGNEE_MAX,
  EMAIL_MAX,
  GROUP_MAX,
  TASK_NAME_MAX,
  TEXTAREA_MAX,
} from "./sanitize";
import { describeTextCap } from "./sanitize-report";
import { EffortProgressBar } from "./effort-progress-bar";
import { SegmentedControl } from "./segmented-control";
import { useTaskForm } from "./task-form-context";
import { useModalVisibility } from "./use-modal-visibility";
import { type TaskErrorField, type TaskFieldErrors } from "./task-validation";
import { PRIORITIES, TASK_STATUSES, type Absence, type NoteLogEntry, type Resource, type Task, type TaskStatus } from "./types";
import { statusLabelKey } from "./task-status-ui";
import { resourceDisplayName } from "./resource-foundation";

// Same compact input class the rest of the form uses. Declared here to avoid
// a circular import back into task-form-modal.tsx.
export const inputClass =
  `w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-foreground focus:border-line focus:outline-none dark:border-line dark:bg-surface dark:text-foreground ${FOCUS_RING} ${TRANSITION}`;

export interface TaskFormFieldsProps {
  lang: Lang;
  today: string;
  nextId: number;
  contactsList: ReturnType<typeof listContacts>;
  resources: readonly Resource[];
  onCreateResource: (name: string, email: string) => number;
  absences: readonly Absence[];
  tasksForDeps: readonly Task[];
  uniqueGroups: string[];
  uniqueLabels: string[];
  editingIsJiraLinked: boolean;
  jiraEnabled: boolean;
  fieldErrors: TaskFieldErrors;
  submitted: boolean;
  holidaySet: Set<string>;
  jiraProjectKey: string | undefined;
  jiraDefaultIssueType: string | undefined;
  /** Retained for the parent prop chain; unused here since the assignee field moved to ResourcePicker. Full removal is deferred to the contacts-retirement slice (SP4). */
  onRemoveContact: (name: string) => void;
  onAddAssigneeToAddressBook: (name: string, email: string) => void;
}

export function TaskFormFields({
  lang,
  today,
  nextId,
  contactsList,
  resources,
  onCreateResource,
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
  onAddAssigneeToAddressBook,
}: TaskFormFieldsProps) {
  const { form, setForm, editingId } = useTaskForm();
  const isEditing = editingId !== null;
  const { isVisible } = useModalVisibility("task");
  const { settings } = useSettings();
  const notesRef = useRef<HTMLTextAreaElement>(null);
  useAutogrow(notesRef, form.notes);
  const { mic: notesMic, status: notesDictationStatus, registration: notesDictationReg } = useDictationMic({
    lang,
    dictation: settings.dictation,
    enabled: true,
    label: t(lang, "notes"),
    onAppendFinal: (txt) =>
      setForm((prev) => ({ ...prev, notes: appendDictation(prev.notes ?? "", txt) })),
  });
  const { mic: titleMic, status: titleDictationStatus, registration: titleDictationReg } = useDictationMic({
    lang,
    dictation: settings.dictation,
    enabled: true,
    label: t(lang, "taskName"),
    onAppendFinal: (txt) =>
      setForm((prev) => ({ ...prev, taskName: describeTextCap(appendDictation(prev.taskName ?? "", txt), TASK_NAME_MAX).value })),
  });

  // Running note-log composer. The author defaults to the configured "me"
  // resource (`settings.selfResourceId`) but is overridable per note. The value
  // is DERIVED (not seeded state) so it tracks settings hydration without an
  // effect; once the user picks an author, `chosenAuthor` pins it.
  const [noteText, setNoteText] = useState("");
  const [chosenAuthor, setChosenAuthor] = useState<number | "" | undefined>(undefined);
  const noteAuthorValue: number | "" =
    chosenAuthor === undefined ? (settings.selfResourceId ?? "") : chosenAuthor;
  const addNote = () => {
    const text = noteText.trim();
    if (!text) return;
    const authorId = noteAuthorValue === "" ? undefined : noteAuthorValue;
    const author = authorId != null ? resources.find((r) => r.id === authorId) : undefined;
    // `new Date()` lives HERE (event handler), never in the render body (purity).
    const entry: NoteLogEntry = {
      timestamp: new Date().toISOString(),
      text,
      ...(authorId != null ? { authorResourceId: authorId } : {}),
      ...(author ? { authorName: resourceDisplayName(author) } : {}),
    };
    setForm((prev) => ({ ...prev, noteLog: [...(prev.noteLog ?? []), entry] }));
    setNoteText("");
  };

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

        {isVisible("priority") && (
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
        )}

        {/* Status is a core workflow field — always shown (not gated by fieldVisibility). */}
        <Field label={t(lang, "colTaskStatus")}>
          <select
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value as TaskStatus })}
            className={inputClass}
          >
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(lang, statusLabelKey(s))}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label={t(lang, "taskName")}
          required
          className="sm:col-span-2"
        >
          <div className="flex items-center gap-1">
            <input
              type="text"
              required
              value={form.taskName}
              onChange={(e) => setForm({ ...form, taskName: e.target.value })}
              onFocus={titleDictationReg.onFocus}
              onBlur={(e) => {
                setForm({ ...form, taskName: describeTextCap(e.target.value, TASK_NAME_MAX).value.trim() });
                markTouched("taskName");
                titleDictationReg.onBlur();
              }}
              placeholder={t(lang, "placeholderTaskName")}
              aria-invalid={errorFor("taskName") ? true : undefined}
              aria-describedby={describedBy("taskName", "taskName-counter")}
              className={inputClass}
            />
            {titleMic}
          </div>
          <CharCounter value={form.taskName} max={TASK_NAME_MAX} id="taskName-counter" lang={lang} />
          {titleDictationStatus}
          <FieldError id="taskName-error">{errorFor("taskName")}</FieldError>
        </Field>

        {isVisible("assignee") && (
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
              <ResourcePicker
                lang={lang}
                value={{ name: form.assignee, email: form.assigneeEmail, resourceId: form.resourceId }}
                resources={resources}
                contacts={contactsList}
                onChange={(next) =>
                  setForm((prev) => ({
                    ...prev,
                    assignee: next.name,
                    assigneeEmail: next.email,
                    resourceId: next.resourceId,
                  }))
                }
                onCreateResource={onCreateResource}
                placeholder={t(lang, "assignee")}
                maxLength={ASSIGNEE_MAX}
                onBlur={(e) => {
                  setForm((prev) => ({ ...prev, assignee: describeTextCap(e.target.value, ASSIGNEE_MAX).value.trim() }));
                  markTouched("assignee");
                }}
                disabled={editingIsJiraLinked}
                title={editingIsJiraLinked ? t(lang, "jiraManagedHint") : undefined}
                aria-required
                aria-invalid={errorFor("assignee") ? true : undefined}
                aria-describedby={describedBy("assignee", "assignee-counter")}
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
              className={`shrink-0 rounded-md border border-line bg-surface px-3 py-2 text-sm font-medium text-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 dark:border-line dark:bg-surface dark:text-foreground dark:hover:bg-surface-muted ${INTERACTIVE}`}
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
        )}

        {isVisible("email") && (
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
        )}
      </TaskFormSection>

      {(isVisible("startDate") || isVisible("dueDate") || isVisible("lastUpdate")) && (
      <TaskFormSection index={2} title={t(lang, "taskFormSectionScheduling")}>
        {isVisible("startDate") && (
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
        )}

        {isVisible("dueDate") && (
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
        )}

        {isVisible("lastUpdate") && (
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
        )}
      </TaskFormSection>
      )}

      <TaskFormSection index={3} title={t(lang, "taskFormSectionEffort")}>
        <Field label={t(lang, "group")} hint={t(lang, "taskHintGroup")}>
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

        {isVisible("estimate") && (
          <EffortField
            key={`estimate-${editingId ?? "new"}`}
            lang={lang}
            label={t(lang, "taskOriginalEstimate")}
            minutes={form.originalEstimateMinutes}
            onChange={(minutes) =>
              setForm((prev) => ({ ...prev, originalEstimateMinutes: minutes }))
            }
          />
        )}

        {isVisible("timeSpent") && (
          <>
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
          </>
        )}

        {isVisible("labels") && (
          <Field label={t(lang, "labels")}>
            <LabelsInput
              lang={lang}
              value={form.labels}
              suggestions={uniqueLabels}
              onChange={(labels) => setForm({ ...form, labels })}
            />
          </Field>
        )}
      </TaskFormSection>

      {(isVisible("dependencies") || isVisible("blockers")) && (
      <TaskFormSection index={4} title={t(lang, "taskFormSectionRelationships")}>
        {isVisible("dependencies") && (
        <Field label={t(lang, "depDependencies")} hint={t(lang, "taskHintDependencies")} className="sm:col-span-2">
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
        )}

        {isVisible("blockers") && (
        <Field label={t(lang, "blockers")} hint={t(lang, "taskHintBlockers")} className="sm:col-span-2">
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
        )}
      </TaskFormSection>
      )}

      <TaskFormSection index={5} title={t(lang, "taskFormSectionStatus")}>
        {(isVisible("health") || isVisible("healthOverride")) && (
        <Field label={t(lang, "health")} hint={t(lang, "taskHintHealth")} className="sm:col-span-2">
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
              // Preview-only object for health derivation; status is not displayed, so a fixed seed is fine.
              status: "To Do",
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
              `inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium ${INTERACTIVE}`;
            const chipInactive =
              "border-line bg-surface text-foreground hover:bg-surface-muted dark:border-line dark:bg-surface dark:text-foreground dark:hover:bg-surface-muted";
            const chipActive = HEALTH_CHIP_ACTIVE_CLASS;
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
        )}

        {isVisible("notes") && (
        <label className="block sm:col-span-2">
          <span className="mb-1 flex items-center gap-1 text-sm font-medium text-foreground">
            {t(lang, "notes")}
            {notesMic}
          </span>
          <textarea
            ref={notesRef}
            rows={3}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            onFocus={notesDictationReg.onFocus}
            onBlur={(e) => {
              setForm({ ...form, notes: describeTextCap(e.target.value, TEXTAREA_MAX).value });
              notesDictationReg.onBlur();
            }}
            placeholder={t(lang, "placeholderNotes")}
            aria-describedby="notes-counter"
            className={`resize-none ${inputClass}`}
          />
          <CharCounter value={form.notes} max={TEXTAREA_MAX} id="notes-counter" lang={lang} />
          {notesDictationStatus}
        </label>
        )}

        <div className="sm:col-span-2">
          <span className="mb-1 block text-sm font-medium text-foreground">{t(lang, "noteLogTitle")}</span>
          {(form.noteLog ?? []).length > 0 && (
            <ul className="mb-2 flex flex-col gap-1">
              {(form.noteLog ?? []).map((n, i) => (
                <li
                  key={i}
                  className="rounded-md border border-line bg-surface-muted px-2 py-1 text-xs"
                >
                  <span className="font-medium text-foreground">
                    {n.authorName ?? t(lang, "noteLogNoAuthor")}
                  </span>{" "}
                  <span className="text-muted-foreground">
                    {n.timestamp.slice(0, 16).replace("T", " ")}
                  </span>
                  <span className="text-foreground">: {n.text}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[10rem] flex-1">
              <input
                type="text"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addNote();
                  }
                }}
                placeholder={t(lang, "noteLogPlaceholder")}
                aria-label={t(lang, "noteLogPlaceholder")}
                className={inputClass}
              />
            </div>
            <select
              value={noteAuthorValue === "" ? "" : String(noteAuthorValue)}
              onChange={(e) => setChosenAuthor(e.target.value === "" ? "" : Number(e.target.value))}
              aria-label={t(lang, "noteLogAuthor")}
              className={`rounded-md border border-line bg-surface px-2 py-2 text-sm text-foreground ${FOCUS_RING} ${TRANSITION}`}
            >
              <option value="">{t(lang, "noteLogNoAuthor")}</option>
              {resources.map((r) => (
                <option key={r.id} value={r.id}>
                  {resourceDisplayName(r)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={addNote}
              disabled={!noteText.trim()}
              className={`rounded-md border border-line bg-surface px-3 py-2 text-sm font-medium text-AIPM-dark-blue hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 dark:text-AIPM-light-grey ${INTERACTIVE}`}
            >
              {t(lang, "noteLogAdd")}
            </button>
          </div>
        </div>

        <Field label={t(lang, "documents")} className="sm:col-span-2">
          <KnowledgeLinksFieldGated
            value={form.knowledgeLinks}
            onChange={(knowledgeLinks) => setForm((prev) => ({ ...prev, knowledgeLinks }))}
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
  hint,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  /** Optional explanatory tooltip shown via an InfoTooltip beside the label. */
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="mb-1 flex items-center gap-1 text-sm font-medium text-foreground">
        {label}
        {required && <span className="ml-0.5 text-AIPM-pink-strong">*</span>}
        {hint && (
          // preventDefault stops the wrapping <label> from also focusing/toggling
          // its control when the tooltip trigger is clicked.
          <span onClick={(e) => e.preventDefault()} className="inline-flex">
            <InfoTooltip text={hint} />
          </span>
        )}
      </span>
      {children}
    </label>
  );
}
