"use client";

// Stakeholder edit modal — create / edit / delete a Stakeholder with embedded
// RACI-by-milestone sub-section. Mirrors ChangeEditModal's structure (sticky/
// draggable header, two-column grid form, validation error alert, Delete-left /
// Cancel+Save-right footer). Built as a standalone component using the shared
// Modal + ModalHeader + useDraggable, like change-edit-modal.tsx.

import { useEffect, useRef, useState } from "react";
import { useEscapeKey } from "./use-escape-key";
import { type Lang, t, type TranslationKey } from "./i18n";
import {
  RACI_ROLES,
  STAKEHOLDER_CATEGORIES,
  type InfluenceInterest,
  type Milestone,
  type RaciRole,
  type Resource,
  type Stakeholder,
  type StakeholderCategory,
} from "./types";
import { InfluenceInterestMatrix } from "./influence-interest-matrix";
import { useDraggable } from "./use-draggable";
import { setRaciRole } from "./stakeholders";
import { ResourcePicker } from "./resource-picker";
import { CharCounter, useAdjustmentTracker } from "./field-feedback";
import { DocumentLinksFieldGated } from "./document-links-field-gated";
import { describeTextCap } from "./sanitize-report";
import { BUDGET_NAME_MAX, TEXTAREA_MAX } from "./sanitize";
import { useToastContext } from "./toast-context";
import { useModalVisibility } from "./use-modal-visibility";
import { InfoTooltip } from "./info-tooltip";
import { FOCUS_RING, TRANSITION } from "./interaction-styles";
import { EditModalShell, ModalFieldError, ModalEditFooter } from "./edit-modal-chrome";
import { useDictationMic } from "./dictation-mic";
import { appendDictation } from "./dictation-engine";
import { useSettings } from "./use-settings";

export interface StakeholderEditModalProps {
  lang: Lang;
  draft: Stakeholder;
  isNew: boolean;
  milestones: readonly Milestone[];
  resources: readonly Resource[];
  onChange: (next: Stakeholder) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
  /** Stakeholder ids with a pending stakeholder-comms next-action (drives the matrix icon). */
  commsPendingStakeholderIds?: ReadonlySet<number>;
  /** Jump to the Action Center for the given stakeholder. */
  onJumpToComms?: (stakeholderId: number) => void;
}

const CATEGORY_LABEL_KEYS: Record<StakeholderCategory, TranslationKey> = {
  Internal: "stakeholderCategoryInternal",
  Customer: "stakeholderCategoryCustomer",
  Vendor: "stakeholderCategoryVendor",
  Sponsor: "stakeholderCategorySponsor",
  Regulator: "stakeholderCategoryRegulator",
  Other: "stakeholderCategoryOther",
};

const LEVEL_LABEL_KEYS: Record<InfluenceInterest, TranslationKey> = {
  Low: "levelLow",
  Medium: "levelMedium",
  High: "levelHigh",
};

const RACI_LABEL_KEYS: Record<RaciRole, TranslationKey> = {
  R: "raciRoleR",
  A: "raciRoleA",
  C: "raciRoleC",
  I: "raciRoleI",
};

const INPUT_CLASS = `rounded-md border border-line bg-surface px-3 py-2 text-sm ${FOCUS_RING} ${TRANSITION}`;

export function StakeholderEditModal({
  lang,
  draft,
  isNew,
  milestones,
  resources,
  onChange,
  onSave,
  onCancel,
  onDelete,
  commsPendingStakeholderIds,
  onJumpToComms,
}: StakeholderEditModalProps) {
  const [error, setError] = useState<string | null>(null);
  const showToast = useToastContext();
  const adj = useAdjustmentTracker();
  const { isVisible } = useModalVisibility("stakeholder");
  const { settings } = useSettings();
  const draftRef = useRef(draft);
  useEffect(() => { draftRef.current = draft; });
  const { mic: notesMic, status: notesDictationStatus, registration: notesDictationReg } = useDictationMic({
    lang,
    dictation: settings.dictation,
    enabled: true,
    label: t(lang, "stakeholderFieldNotes"),
    onAppendFinal: (txt) => update("notes", appendDictation(draftRef.current.notes ?? "", txt)),
  });
  const { mic: nameMic, status: nameDictationStatus, registration: nameDictationReg } = useDictationMic({
    lang,
    dictation: settings.dictation,
    enabled: true,
    label: t(lang, "stakeholderFieldName"),
    onAppendFinal: (txt) =>
      update("name", describeTextCap(appendDictation(draftRef.current.name ?? "", txt), BUDGET_NAME_MAX).value),
  });
  const { mic: orgMic, status: orgDictationStatus, registration: orgDictationReg } = useDictationMic({
    lang,
    dictation: settings.dictation,
    enabled: true,
    label: t(lang, "stakeholderFieldOrganization"),
    onAppendFinal: (txt) =>
      update("organization", describeTextCap(appendDictation(draftRef.current.organization ?? "", txt), BUDGET_NAME_MAX).value),
  });
  const { mic: titleMic, status: titleDictationStatus, registration: titleDictationReg } = useDictationMic({
    lang,
    dictation: settings.dictation,
    enabled: true,
    label: t(lang, "stakeholderFieldTitle"),
    onAppendFinal: (txt) =>
      update("title", describeTextCap(appendDictation(draftRef.current.title ?? "", txt), BUDGET_NAME_MAX).value),
  });

  const { offset, reset: dragReset, handleProps } = useDraggable(true, "aipm-cockpit:modal-pos:stakeholder-edit");

  useEscapeKey(onCancel);

  function update<K extends keyof Stakeholder>(key: K, value: Stakeholder[K]) {
    setError(null);
    onChange({ ...draft, [key]: value });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.name.trim()) {
      setError(t(lang, "raidErrorTitleRequired"));
      return;
    }
    setError(null);
    adj.reset();
    adj.track(describeTextCap(draft.name, BUDGET_NAME_MAX));
    adj.track(describeTextCap(draft.organization ?? "", BUDGET_NAME_MAX));
    adj.track(describeTextCap(draft.title ?? "", BUDGET_NAME_MAX));
    adj.track(describeTextCap(draft.email ?? "", BUDGET_NAME_MAX));
    adj.track(describeTextCap(draft.notes ?? "", TEXTAREA_MAX));
    if (adj.count() > 0) showToast("info", t(lang, "fieldsAdjusted", adj.count()));
    onSave();
  }

  const title = isNew ? t(lang, "stakeholdersAdd") : t(lang, "stakeholderEditTitle");
  const saveDisabled = !draft.name.trim();

  return (
    <EditModalShell
      lang={lang}
      title={title}
      modalId="stakeholder"
      onClose={onCancel}
      onSubmit={handleSubmit}
      offset={offset}
      dragHandleProps={handleProps}
      onDragReset={dragReset}
      sizeKey="aipm-cockpit:modal-size:stakeholder-edit"
    >
          {/* Name */}
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="flex items-center gap-1 font-medium text-foreground">
              {t(lang, "stakeholderFieldName")} *<InfoTooltip text={t(lang, "stakeholderFieldNameHint")} />
              {nameMic}
            </span>
            <div onFocus={nameDictationReg.onFocus}>
              <ResourcePicker
                lang={lang}
                value={{ name: draft.name, email: draft.email ?? "", resourceId: draft.resourceId }}
                resources={resources}
                contacts={[]}
                onChange={(next) =>
                  onChange({ ...draft, name: next.name, resourceId: next.resourceId })
                }
                onBlur={(e) => {
                  onChange({ ...draft, name: describeTextCap(e.target.value, BUDGET_NAME_MAX).value.trim(), resourceId: draft.resourceId });
                  nameDictationReg.onBlur();
                }}
                maxLength={BUDGET_NAME_MAX}
                aria-required
                aria-describedby="stakeholder-name-counter"
              />
            </div>
            <CharCounter value={draft.name} max={BUDGET_NAME_MAX} id="stakeholder-name-counter" lang={lang} />
            {nameDictationStatus}
          </label>

          {/* Organization */}
          {isVisible("organization") && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="flex items-center gap-1 font-medium text-foreground">
                {t(lang, "stakeholderFieldOrganization")}<InfoTooltip text={t(lang, "stakeholderFieldOrganizationHint")} />
                {orgMic}
              </span>
              <input
                type="text"
                value={draft.organization ?? ""}
                onChange={(e) => update("organization", e.target.value || undefined)}
                onFocus={orgDictationReg.onFocus}
                onBlur={(e) => {
                  const trimmed = describeTextCap(e.target.value, BUDGET_NAME_MAX).value.trim();
                  update("organization", trimmed || undefined);
                  orgDictationReg.onBlur();
                }}
                aria-describedby="stakeholder-organization-counter"
                className={INPUT_CLASS}
              />
              <CharCounter value={draft.organization ?? ""} max={BUDGET_NAME_MAX} id="stakeholder-organization-counter" lang={lang} />
              {orgDictationStatus}
            </label>
          )}

          {/* Title + Email — the `contact` registry field */}
          {isVisible("contact") && (
            <>
              {/* Title */}
              <label className="flex flex-col gap-1 text-sm">
                <span className="flex items-center gap-1 font-medium text-foreground">
                  {t(lang, "stakeholderFieldTitle")}<InfoTooltip text={t(lang, "stakeholderFieldTitleHint")} />
                  {titleMic}
                </span>
                <input
                  type="text"
                  value={draft.title ?? ""}
                  onChange={(e) => update("title", e.target.value || undefined)}
                  onFocus={titleDictationReg.onFocus}
                  onBlur={(e) => {
                    const trimmed = describeTextCap(e.target.value, BUDGET_NAME_MAX).value.trim();
                    update("title", trimmed || undefined);
                    titleDictationReg.onBlur();
                  }}
                  aria-describedby="stakeholder-title-counter"
                  className={INPUT_CLASS}
                />
                <CharCounter value={draft.title ?? ""} max={BUDGET_NAME_MAX} id="stakeholder-title-counter" lang={lang} />
                {titleDictationStatus}
              </label>

              {/* Email */}
              <label className="flex flex-col gap-1 text-sm">
                <span className="flex items-center gap-1 font-medium text-foreground">
                  {t(lang, "stakeholderFieldEmail")}<InfoTooltip text={t(lang, "stakeholderFieldEmailHint")} />
                </span>
                <input
                  type="text"
                  value={draft.email ?? ""}
                  onChange={(e) => update("email", e.target.value || undefined)}
                  onBlur={(e) => {
                    const trimmed = describeTextCap(e.target.value, BUDGET_NAME_MAX).value.trim();
                    update("email", trimmed || undefined);
                  }}
                  aria-describedby="stakeholder-email-counter"
                  className={INPUT_CLASS}
                />
                <CharCounter value={draft.email ?? ""} max={BUDGET_NAME_MAX} id="stakeholder-email-counter" lang={lang} />
              </label>
            </>
          )}

          {/* Category */}
          {isVisible("category") && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="flex items-center gap-1 font-medium text-foreground">
                {t(lang, "stakeholderFieldCategory")}<InfoTooltip text={t(lang, "stakeholderFieldCategoryHint")} />
              </span>
              <select
                aria-label={t(lang, "stakeholderFieldCategory")}
                value={draft.category}
                onChange={(e) => update("category", e.target.value as StakeholderCategory)}
                className={INPUT_CLASS}
              >
                {STAKEHOLDER_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {t(lang, CATEGORY_LABEL_KEYS[cat])}
                  </option>
                ))}
              </select>
            </label>
          )}

          {/* Influence / Interest matrix — one click sets both */}
          {isVisible("influenceInterest") && (
            <div className="flex flex-col gap-1 text-sm sm:col-span-2">
              <span className="flex items-center gap-1 font-medium text-foreground">
                {t(lang, "stakeholderFieldInfluence")}<InfoTooltip text={t(lang, "stakeholderFieldInfluenceHint")} />
                {" / "}
                {t(lang, "stakeholderFieldInterest")}<InfoTooltip text={t(lang, "stakeholderFieldInterestHint")} />
              </span>
              <InfluenceInterestMatrix
                lang={lang}
                influence={draft.influence}
                interest={draft.interest}
                onPick={(influence, interest) => onChange({ ...draft, influence, interest })}
                stakeholderId={draft.id}
                commsPendingStakeholderIds={commsPendingStakeholderIds}
                onJumpToComms={onJumpToComms}
              />
              <span className="text-xs text-muted-foreground">
                {t(lang, "stakeholderFieldInfluence")}: {t(lang, LEVEL_LABEL_KEYS[draft.influence])}
                {" · "}
                {t(lang, "stakeholderFieldInterest")}: {t(lang, LEVEL_LABEL_KEYS[draft.interest])}
              </span>
            </div>
          )}

          {/* Notes */}
          {isVisible("notes") && (
            <label className="flex flex-col gap-1 text-sm sm:col-span-2">
              <span className="flex items-center gap-1 font-medium text-foreground">
                {t(lang, "stakeholderFieldNotes")}<InfoTooltip text={t(lang, "stakeholderFieldNotesHint")} />
                {notesMic}
              </span>
              <textarea
                rows={2}
                value={draft.notes ?? ""}
                onChange={(e) => update("notes", e.target.value || undefined)}
                onFocus={notesDictationReg.onFocus}
                onBlur={(e) => {
                  const capped = describeTextCap(e.target.value, TEXTAREA_MAX).value;
                  update("notes", capped || undefined);
                  notesDictationReg.onBlur();
                }}
                aria-describedby="stakeholder-notes-counter"
                className={INPUT_CLASS}
              />
              <CharCounter value={draft.notes ?? ""} max={TEXTAREA_MAX} id="stakeholder-notes-counter" lang={lang} />
              {notesDictationStatus}
            </label>
          )}

          {/* Document links */}
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-foreground">{t(lang, "documents")}</span>
            <DocumentLinksFieldGated
              value={draft.documentLinks ?? []}
              onChange={(links) => update("documentLinks", links)}
              lang={lang}
            />
          </label>

          {/* RACI by milestone — Full-only registry field */}
          {isVisible("raci") && (
            <div className="sm:col-span-2">
              <span className="mb-2 block text-sm font-medium text-foreground">
                {t(lang, "raciSectionTitle")}
              </span>
              {milestones.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t(lang, "raciNoMilestones")}
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {milestones.map((m) => (
                    <div key={m.id} className="flex items-center gap-3 text-sm">
                      <span className="w-40 truncate text-foreground">{m.name}</span>
                      <select
                        aria-label={`${m.name} (RACI)`}
                        value={draft.raci[String(m.id)] ?? ""}
                        onChange={(e) => {
                          const val = e.target.value;
                          onChange(
                            setRaciRole(draft, m.id, val === "" ? null : (val as RaciRole)),
                          );
                        }}
                        className={INPUT_CLASS}
                      >
                        <option value="">{t(lang, "raciNone")}</option>
                        {RACI_ROLES.map((role) => (
                          <option key={role} value={role}>
                            {t(lang, RACI_LABEL_KEYS[role])}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {error && <ModalFieldError error={error} />}

          <ModalEditFooter
            lang={lang}
            onDelete={onDelete}
            deleteConfirmKey="stakeholderConfirmDelete"
            deleteLabelKey="delete"
            deleteAriaLabelKey="stakeholdersDelete"
            deleteDisabled={isNew}
            onCancel={onCancel}
            saveDisabled={saveDisabled}
            saveLabelKey="raidSave"
          />
    </EditModalShell>
  );
}
