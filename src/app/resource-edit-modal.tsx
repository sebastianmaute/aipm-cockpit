"use client";

// Resource address-book editor modal — create / edit / delete a Resource.
// Mirrors AbsenceEditModal's structure: local `draft` state synced from prop
// via useEffect, `update(key, value)` helper, footer with Delete/Cancel/Save.
// Does NOT edit discipline/grade (those are owned by the Roles modal).

import { useState } from "react";
import { type Lang, t } from "./i18n";
import { EditModalShell, ModalFieldError, ModalEditFooter } from "./edit-modal-chrome";
import { Input, Textarea } from "./form-controls";
import type { Resource } from "./types";
import { useDraggable } from "./use-draggable";
import { birthdayHasYear, birthdayMonthDay } from "./birthdays";
import { CharCounter, useAdjustmentTracker } from "./field-feedback";
import { describeTextCap } from "./sanitize-report";
import { ASSIGNEE_MAX, EMAIL_MAX } from "./sanitize";
import { useToastContext } from "./toast-context";
import { useModalVisibility } from "./use-modal-visibility";
import { InfoTooltip } from "./info-tooltip";
import { FOCUS_RING, TRANSITION, INTERACTIVE } from "./interaction-styles";
import { useConfirm } from "./confirm-dialog";
import { useDraftState } from "./use-draft-state";

interface Props {
  lang: Lang;
  /** When null the modal is hidden. */
  resource: Resource | null;
  /** True when creating; false when editing an existing record. */
  isNew: boolean;
  onSave: (r: Resource) => void;
  onDelete: (id: number) => void;
  onClose: () => void;
}

// 2000 is a leap year, so an unknown-year Feb 29 stays representable in the picker.
const BIRTHDAY_ANCHOR_YEAR = "2000";

// "" | "MM-DD" | "YYYY-MM-DD"  ->  full "YYYY-MM-DD" for the <input type=date>
function birthdayToInput(b?: string): string {
  const md = birthdayMonthDay(b);
  if (!md) return "";
  return birthdayHasYear(b) ? b : `${BIRTHDAY_ANCHOR_YEAR}-${md}`;
}

// full "YYYY-MM-DD" from the input  ->  stored value honoring the year-unknown toggle
function inputToBirthday(input: string, yearUnknown: boolean): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return undefined;
  return yearUnknown ? input.slice(5) : input;
}

export function ResourceEditModal({
  lang,
  resource,
  isNew,
  onSave,
  onDelete,
  onClose,
}: Props) {
  const [prevResource, setPrevResource] = useState(resource);
  const { draft, setDraft, update, error, setError } = useDraftState<Resource>(resource);
  const [yearUnknown, setYearUnknown] = useState(() => !birthdayHasYear(resource?.birthday));

  if (prevResource !== resource) {
    setPrevResource(resource);
    setDraft(resource);
    setError(null);
    setYearUnknown(!birthdayHasYear(resource?.birthday));
  }

  const showToast = useToastContext();
  const adj = useAdjustmentTracker();
  const { isVisible } = useModalVisibility("resource");
  const confirm = useConfirm();

  const { offset, reset: dragReset, handleProps } = useDraggable(
    draft !== null,
    "aipm-cockpit:modal-pos:resource-edit",
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    adj.reset();
    const firstName = adj.track(describeTextCap((draft.firstName ?? "").trim(), ASSIGNEE_MAX));
    const lastName = adj.track(describeTextCap((draft.lastName ?? "").trim(), ASSIGNEE_MAX));
    if (!firstName && !lastName) {
      setError(t(lang, "resourceErrorName"));
      return;
    }
    const email = adj.track(describeTextCap((draft.email ?? "").trim(), EMAIL_MAX)) || undefined;
    const emails = (draft.emails ?? [])
      .map((e) => e.trim())
      .filter((e) => e.length > 0);
    const clean: Resource = {
      ...draft,
      firstName,
      lastName,
      emails: emails.length > 0 ? emails : undefined,
      title: draft.title?.trim() || undefined,
      company: draft.company?.trim() || undefined,
      department: draft.department?.trim() || undefined,
      location: draft.location?.trim() || undefined,
      businessPhone: draft.businessPhone?.trim() || undefined,
      email,
      notes: draft.notes?.trim() || undefined,
    };
    if (adj.count() > 0) showToast("info", t(lang, "fieldsAdjusted", adj.count()));
    onSave(clean);
  }

  async function handleDeleteClick() {
    if (!draft) return;
    if (await confirm({ message: `${t(lang, "resourceConfirmDelete")} ${t(lang, "resourceDeleteCascadeNote")}` })) {
      onDelete(draft.id);
    }
  }

  if (!draft) return null;

  const title = isNew ? t(lang, "resourceNewTitle") : t(lang, "resourceEditTitle");

  return (
    <EditModalShell
      lang={lang}
      title={title}
      modalId="resource"
      onClose={onClose}
      onSubmit={handleSubmit}
      offset={offset}
      dragHandleProps={handleProps}
      onDragReset={dragReset}
      sizeKey="aipm-cockpit:modal-size:resource-edit"
      widthClassName="w-[560px] min-w-[320px]"
      /* Slightly under the shell's 720px default — ~11 rows in a two-column
         grid, several of them field-visibility gated. */
      heightClassName="h-[620px] min-h-[400px] max-h-[95vh]"
      formClassName="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-5 sm:grid-cols-2"
    >
          {/* First name */}
          <label className="flex flex-col gap-1 text-sm">
            <span className="flex items-center gap-1 font-medium text-foreground">
              {t(lang, "resourceFirstName")}<InfoTooltip text={t(lang, "resourceFirstNameHint")} />
            </span>
            <Input
              type="text"
              value={draft.firstName ?? ""}
              onChange={(e) => update("firstName", e.target.value)}
              onBlur={(e) => update("firstName", describeTextCap(e.target.value, ASSIGNEE_MAX).value.trim())}
              aria-describedby="resource-firstName-counter"
            />
            <CharCounter value={draft.firstName ?? ""} max={ASSIGNEE_MAX} id="resource-firstName-counter" lang={lang} />
          </label>

          {/* Last name */}
          <label className="flex flex-col gap-1 text-sm">
            <span className="flex items-center gap-1 font-medium text-foreground">
              {t(lang, "resourceLastName")}<InfoTooltip text={t(lang, "resourceLastNameHint")} />
            </span>
            <Input
              type="text"
              value={draft.lastName ?? ""}
              onChange={(e) => update("lastName", e.target.value)}
              onBlur={(e) => update("lastName", describeTextCap(e.target.value, ASSIGNEE_MAX).value.trim())}
              aria-describedby="resource-lastName-counter"
            />
            <CharCounter value={draft.lastName ?? ""} max={ASSIGNEE_MAX} id="resource-lastName-counter" lang={lang} />
          </label>

          {/* Job title */}
          {isVisible("jobTitle") && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="flex items-center gap-1 font-medium text-foreground">
                {t(lang, "resourceJobTitle")}<InfoTooltip text={t(lang, "resourceJobTitleHint")} />
              </span>
              <Input
                type="text"
                value={draft.title ?? ""}
                onChange={(e) => update("title", e.target.value || undefined)}
              />
            </label>
          )}

          {/* Company */}
          {isVisible("company") && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="flex items-center gap-1 font-medium text-foreground">
                {t(lang, "resourceCompany")}<InfoTooltip text={t(lang, "resourceCompanyHint")} />
              </span>
              <Input
                type="text"
                value={draft.company ?? ""}
                onChange={(e) => update("company", e.target.value || undefined)}
              />
            </label>
          )}

          {/* Department */}
          {isVisible("department") && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="flex items-center gap-1 font-medium text-foreground">
                {t(lang, "resourceDepartment")}<InfoTooltip text={t(lang, "resourceDepartmentHint")} />
              </span>
              <Input
                type="text"
                value={draft.department ?? ""}
                onChange={(e) => update("department", e.target.value || undefined)}
              />
            </label>
          )}

          {/* Location */}
          {isVisible("location") && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="flex items-center gap-1 font-medium text-foreground">
                {t(lang, "resourceLocation")}<InfoTooltip text={t(lang, "resourceLocationHint")} />
              </span>
              <Input
                type="text"
                value={draft.location ?? ""}
                onChange={(e) => update("location", e.target.value || undefined)}
              />
            </label>
          )}

          {/* Business phone */}
          {isVisible("businessPhone") && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="flex items-center gap-1 font-medium text-foreground">
                {t(lang, "resourcePhone")}<InfoTooltip text={t(lang, "resourcePhoneHint")} />
              </span>
              <Input
                type="tel"
                value={draft.businessPhone ?? ""}
                onChange={(e) =>
                  update("businessPhone", e.target.value || undefined)
                }
              />
            </label>
          )}

          {/* Email */}
          {isVisible("email") && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="flex items-center gap-1 font-medium text-foreground">
                {t(lang, "resourceEmail")}<InfoTooltip text={t(lang, "resourceEmailHint")} />
              </span>
              <Input
                type="email"
                value={draft.email ?? ""}
                onChange={(e) => update("email", e.target.value || undefined)}
                onBlur={(e) => {
                  const trimmed = describeTextCap(e.target.value, EMAIL_MAX).value.trim();
                  update("email", trimmed || undefined);
                }}
                aria-describedby="resource-email-counter"
              />
              <CharCounter value={draft.email ?? ""} max={EMAIL_MAX} id="resource-email-counter" lang={lang} />
            </label>
          )}

          {/* Additional emails — full width */}
          {isVisible("email") && (
            <div className="flex flex-col gap-1.5 text-sm sm:col-span-2">
              <span className="flex items-center gap-1 font-medium text-foreground">
                {t(lang, "resourceEmailsLabel")}<InfoTooltip text={t(lang, "resourceEmailsHint")} />
              </span>
              {(draft.emails ?? []).map((addr, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    type="email"
                    value={addr}
                    aria-label={`${t(lang, "resourceEmailsLabel")} ${i + 1}`}
                    onChange={(e) => {
                      const next = [...(draft.emails ?? [])];
                      next[i] = e.target.value;
                      update("emails", next);
                    }}
                    className="flex-1"
                  />
                  <button
                    type="button"
                    aria-label={`${t(lang, "resourceEmailRemove")} ${i + 1}`}
                    onClick={() => update("emails", (draft.emails ?? []).filter((_, j) => j !== i))}
                    className="rounded p-1 text-muted-foreground hover:bg-ui-pink/10 hover:text-ui-pink"
                  >×</button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => update("emails", [...(draft.emails ?? []), ""])}
                className={`self-start rounded-md border border-line bg-surface px-2.5 py-1 text-xs font-medium text-foreground hover:border-ui-dark-blue hover:bg-surface-muted ${INTERACTIVE}`}
              >
                + {t(lang, "resourceEmailAdd")}
              </button>
            </div>
          )}

          {/* External resource flag — full width */}
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              className={`${FOCUS_RING} ${TRANSITION}`}
              checked={draft.isExternal === true}
              onChange={(e) => update("isExternal", e.target.checked || undefined)}
            />
            <span className="flex items-center gap-1 font-medium text-foreground">
              {t(lang, "resourceExternal")}<InfoTooltip text={t(lang, "resourceExternalHint")} />
            </span>
          </label>

          {/* Birthday — native date picker with optional year */}
          {isVisible("birthday") && (
            <div className="flex flex-col gap-1 text-sm sm:col-span-2">
              <span className="flex items-center gap-1 font-medium text-foreground">
                {t(lang, "resourceBirthday")}<InfoTooltip text={t(lang, "resourceBirthdayHint")} />
              </span>
              <div className="flex flex-wrap items-center gap-3">
                <Input
                  type="date"
                  value={birthdayToInput(draft.birthday)}
                  onChange={(e) => update("birthday", inputToBirthday(e.target.value, yearUnknown))}
                  aria-label={t(lang, "resourceBirthday")}
                />
                <label className="flex items-center gap-1.5 text-sm text-foreground">
                  <input
                    type="checkbox"
                    className={`${FOCUS_RING} ${TRANSITION}`}
                    checked={yearUnknown}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setYearUnknown(checked);
                      // Re-normalize from the pending draft (not the render snapshot).
                      setDraft((prev) =>
                        prev
                          ? { ...prev, birthday: inputToBirthday(birthdayToInput(prev.birthday), checked) }
                          : prev,
                      );
                      setError(null);
                    }}
                  />
                  {t(lang, "resourceBirthdayYearUnknown")}
                </label>
              </div>
            </div>
          )}

          {/* Notes — full width textarea */}
          {isVisible("notes") && (
            <label className="flex flex-col gap-1 text-sm sm:col-span-2">
              <span className="flex items-center gap-1 font-medium text-foreground">
                {t(lang, "resourceNotes")}<InfoTooltip text={t(lang, "resourceNotesHint")} />
              </span>
              <Textarea
                autoGrow
                rows={3}
                value={draft.notes ?? ""}
                onChange={(e) => update("notes", e.target.value || undefined)}
              />
            </label>
          )}

          {error && <ModalFieldError error={error} />}

          <ModalEditFooter
            lang={lang}
            hideDelete={isNew}
            onDelete={handleDeleteClick}
            onCancel={onClose}
            saveLabelKey="resourceSave"
          />
    </EditModalShell>
  );
}
