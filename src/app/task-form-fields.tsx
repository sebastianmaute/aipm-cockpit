"use client";

import { useId, useState } from "react";
import { ComboInput } from "./combo-input";
import { KnowledgeLinksFieldGated } from "./knowledge-links-field-gated";
import { NoteLogPanel, type NoteLogPanelProps } from "./note-log-panel";
import { ResourcePicker } from "./resource-picker";
import type { listContacts } from "./contacts";
import { DependenciesEditor } from "./dependencies-editor";
import { formatDuration, parseDuration } from "./duration";
import { CharCounter, FieldError, FieldNotice } from "./field-feedback";
import { Field, TaskFormSection } from "./task-form-layout";
import { useDictationMic } from "./dictation-mic";
import { appendDictation } from "./dictation-engine";
import { RichTextEditor } from "./rich-text-editor";
import { appendDictationToHtml } from "./rich-text-projection";
import { useSettings } from "./use-settings";
import { INTERACTIVE } from "./interaction-styles";
import { Input, Select, Textarea } from "./form-controls";
import {
  computeTaskHealth,
  HEALTH_VALUES,
  healthColorName,
} from "./health";
import { RagDot } from "./rag-dot";
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
import type { TaskBudgetLink } from "./use-task-budget-link";
import { PRIORITIES, TASK_STATUSES, type Absence, type Resource, type Task, type TaskStatus } from "./types";
import { statusLabelKey } from "./task-status-ui";

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
  /** Opens the floating note-log window (wired by the host in Task E2). Optional
   *  so this component still compiles/renders standalone before that wiring. */
  onOpenNotes?: () => void;
  /** Live note-log panel props for the edited task. Present → the log renders
   *  INLINE here and writes straight through to the workspace; absent (an
   *  unsaved new task) → the disabled launcher button above is used instead.
   *  A PROP, not a context read: this component's own tests render it bare. */
  taskNotePanel?: NoteLogPanelProps;
  /** Budget-bucket link controls, absent when the budget module is off. A PROP,
   *  not a context read: this component's own tests render it bare, where a
   *  `useWorkspace()` call would throw. */
  budgetLink?: TaskBudgetLink;
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
  onOpenNotes,
  taskNotePanel,
  budgetLink,
}: TaskFormFieldsProps) {
  const { form, setForm, editingId } = useTaskForm();
  const isEditing = editingId !== null;
  const { isVisible } = useModalVisibility("task");
  const { settings } = useSettings();
  // Description is rich HTML but dictation yields plain text — appendDictationToHtml
  // owns that round-trip (and documents the formatting-flatten trade-off). The
  // functional setter is what lets it read the latest state on each of the
  // repeated onFinal calls Web Speech fires per hold.
  const { mic: descriptionMic, status: descriptionDictationStatus, registration: descriptionDictationReg } = useDictationMic({
    lang,
    dictation: settings.dictation,
    enabled: true,
    label: t(lang, "description"),
    onAppendFinal: (txt) =>
      setForm((prev) => ({
        ...prev,
        description: appendDictationToHtml(prev.description ?? "", txt),
      })),
  });
  const { mic: titleMic, status: titleDictationStatus, registration: titleDictationReg } = useDictationMic({
    lang,
    dictation: settings.dictation,
    enabled: true,
    label: t(lang, "taskName"),
    onAppendFinal: (txt) =>
      setForm((prev) => ({ ...prev, taskName: describeTextCap(appendDictation(prev.taskName ?? "", txt), TASK_NAME_MAX).value })),
  });

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
          <Field label={t(lang, "priority")} group>
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
          <Select
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value as TaskStatus })}
            className="w-full"
          >
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(lang, statusLabelKey(s))}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label={t(lang, "taskName")}
          required
          className="sm:col-span-2"
        >
          <div className="flex items-center gap-1">
            <Input
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
              invalid={errorFor("taskName") ? true : undefined}
              aria-describedby={describedBy("taskName", "taskName-counter")}
              className="w-full"
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
              className={`shrink-0 rounded-md border border-line bg-surface px-3 py-2 text-sm font-medium text-foreground hover:border-ui-dark-blue hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 dark:border-line dark:bg-surface dark:text-foreground dark:hover:bg-surface-muted ${INTERACTIVE}`}
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
          <Input
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
            invalid={errorFor("assigneeEmail") ? true : undefined}
            aria-describedby={describedBy("assigneeEmail", "email-counter")}
            className="w-full"
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
          <Input
            type="date"
            max={form.dueDate || undefined}
            value={form.startDate}
            onChange={(e) =>
              setForm({ ...form, startDate: e.target.value })
            }
            aria-describedby="startDate-hint"
            className="w-full"
          />
          <p id="startDate-hint" className="mt-1 text-xs text-muted-foreground">
            {t(lang, "startDateHint")}
          </p>
        </Field>
        )}

        {isVisible("dueDate") && (
        <Field label={t(lang, "dueDate")} required>
          <Input
            type="date"
            required
            min={today}
            value={form.dueDate}
            onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
            onBlur={() => markTouched("dueDate")}
            invalid={errorFor("dueDate") ? true : undefined}
            aria-describedby={describedBy("dueDate")}
            className="w-full"
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
                    className="text-xs text-ui-purple"
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
          <Input
            type="date"
            value={form.lastUpdateDate}
            onChange={(e) =>
              setForm({ ...form, lastUpdateDate: e.target.value })
            }
            className="w-full"
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
          <Field label={t(lang, "labels")} group>
            <LabelsInput
              lang={lang}
              value={form.labels}
              suggestions={uniqueLabels}
              onChange={(labels) => setForm({ ...form, labels })}
            />
          </Field>
        )}
      </TaskFormSection>

      {(isVisible("dependencies") || isVisible("blockers") || (budgetLink !== undefined && isVisible("budgetBucket"))) && (
      <TaskFormSection index={4} title={t(lang, "taskFormSectionRelationships")}>
        {/* `group`: once the task HAS a dependency, the chip list renders each
            one's remove ✕ ABOVE the type `<Select>`, so a plain caption adopts
            that ✕ and clicking "Dependencies" calls `remove(0)`. On an empty
            list the `<Select>` wins and the caption looks fine — which is why
            this survived the first sweep and a cold review found it. */}
        {isVisible("dependencies") && (
        <Field label={t(lang, "depDependencies")} hint={t(lang, "taskHintDependencies")} className="sm:col-span-2" group>
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
          <Textarea
            rows={2}
            value={form.blockers}
            onChange={(e) => setForm({ ...form, blockers: e.target.value })}
            onBlur={(e) =>
              setForm({ ...form, blockers: describeTextCap(e.target.value, TEXTAREA_MAX).value })
            }
            placeholder={t(lang, "placeholderBlockers")}
            aria-describedby="blockers-counter"
            className="w-full"
          />
          <CharCounter value={form.blockers} max={TEXTAREA_MAX} id="blockers-counter" lang={lang} />
        </Field>
        )}

        {budgetLink !== undefined && isVisible("budgetBucket") && (
        <Field label={t(lang, "taskBudgetBucket")}>
          <Select
            value={budgetLink.bucketId === null ? "" : String(budgetLink.bucketId)}
            onChange={(e) => budgetLink.onChange(e.target.value === "" ? null : Number(e.target.value))}
            className="w-full"
          >
            <option value="">{t(lang, "budgetBucketNone")}</option>
            {budgetLink.buckets.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </Select>
        </Field>
        )}
      </TaskFormSection>
      )}

      <TaskFormSection index={5} title={t(lang, "taskFormSectionStatus")}>
        {(isVisible("health") || isVisible("healthOverride")) && (
        <Field label={t(lang, "health")} hint={t(lang, "taskHintHealth")} className="sm:col-span-2" group>
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
              description: form.description,
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
                      ? "border-ui-dark-blue bg-surface-muted text-ui-dark-blue dark:border-ui-blue dark:bg-surface-muted dark:text-ui-light-grey"
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
                    <RagDot level={h} />
                    {healthColorName(h, lang)}
                  </button>
                ))}
              </div>
            );
          })()}
        </Field>
        )}

        {isVisible("notes") && (
        <div className="block sm:col-span-2">
          <span className="mb-1 flex items-center gap-1 text-sm font-medium text-foreground">
            {t(lang, "description")}
            {descriptionMic}
          </span>
          {/* focus/blur bubble from the contenteditable, registering this field
              as the active dictation target for the global hold-to-talk hotkey. */}
          <div onFocus={descriptionDictationReg.onFocus} onBlur={descriptionDictationReg.onBlur}>
            <RichTextEditor
              variant="lean"
              value={form.description}
              onChange={(html) => setForm((p) => ({ ...p, description: html }))}
              label={t(lang, "description")}
              lang={lang}
            />
          </div>
          {descriptionDictationStatus}
        </div>
        )}

        {/* Running dated note log. With a panel threaded (an existing task) it
            renders INLINE and writes straight through to the workspace — a note
            added here survives Cancel, which is correct for an append-only
            journal. Without one (an unsaved new task) the disabled button
            remains, as there is no id to write to. The count reads the LIVE
            panel entries — the form draft carries no note log at all
            (open-followups §29), so a write-through add moves the number
            immediately. */}
        {taskNotePanel ? (
          <details className="sm:col-span-2 rounded-md border border-line bg-surface p-2">
            {/* ★ `tabIndex={0}` is a no-op for a browser (a <summary> is already
                sequentially focusable at this DOM position, so no second tab
                stop appears) but it is NOT redundant here: `use-focus-trap`'s
                FOCUSABLE_SELECTOR — which drives this modal's Tab containment —
                has no `summary` arm, so a bare one is invisible to the trap.
                @testing-library/user-event's selector omits it too, which is why
                the keyboard test cannot pass without this. */}
            <summary
              tabIndex={0}
              className="cursor-pointer text-sm font-medium text-ui-dark-blue dark:text-ui-light-grey"
            >
              {t(lang, "noteLogTitle")} ({taskNotePanel.entries.length})
            </summary>
            {/* ★ NoteLogPanel's root is a FRAGMENT and its entry list relies on
                `min-h-0 flex-1`, so the consumer must supply the bounded flex
                column; without it the list grows unbounded inside the modal. */}
            <div className="mt-2 flex max-h-72 flex-col overflow-auto pr-2">
              <NoteLogPanel {...taskNotePanel} />
            </div>
          </details>
        ) : (
          <div className="sm:col-span-2">
            <button
              type="button"
              onClick={onOpenNotes}
              disabled={!onOpenNotes}
              title={t(lang, "noteLogOpenHint")}
              className={`inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-2 text-sm font-medium text-ui-dark-blue hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 dark:text-ui-light-grey ${INTERACTIVE}`}
            >
              {/* No count: this branch renders only for an UNSAVED task, which has
                  no id for the write-through path to append to. A hardcoded 0 would
                  be true only by WIRING (task-manager gates taskNotePanel on
                  `editingId !== null`), not by construction — so show no number at
                  all rather than one a future caller could falsify. */}
              {t(lang, "noteLogTitle")}
            </button>
          </div>
        )}

        {/* KnowledgeLinksField renders per-link ✕ buttons then an "add" button
            and NO input, so a `<label>` here bound the caption to the first ✕:
            clicking "Documents" deleted a link. */}
        <Field label={t(lang, "documents")} className="sm:col-span-2" group>
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
                className="h-4 w-4 cursor-pointer rounded border-line text-ui-dark-blue focus:ring-ui-green dark:border-line dark:bg-surface-muted"
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
      <Input
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
        invalid={invalid}
        aria-describedby={invalid ? noticeId : undefined}
        className="w-full"
      />
      {invalid && <FieldNotice id={noticeId}>{t(lang, "taskEffortInvalid")}</FieldNotice>}
    </Field>
  );
}
