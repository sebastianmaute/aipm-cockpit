"use client";

// Change-control edit modal — create / edit / delete a ChangeItem. Mirrors
// RaidEditModal's structure (sticky/draggable header, two-column grid form,
// validation error alert, Delete-left / Cancel+Save-right footer, and the two
// autocomplete chip+dropdown link pickers — one over tasks, one over RAID).
// Built as a standalone component using the shared ModalHeader + useDraggable,
// like resource-edit-modal.tsx / absence-edit-modal.tsx.

import { useEffect, useId, useMemo, useRef, useState } from "react";
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
import { DocumentLinksGroup } from "./knowledge-links-field-gated";
import { InfoTooltip } from "./info-tooltip";
import { INTERACTIVE } from "./interaction-styles";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { IconButton } from "./icon-button";
import {
  EditModalShell,
  ModalFieldError,
  StakeholderChipPicker,
  ModalEditFooter,
} from "./edit-modal-chrome";
import { Input, Select } from "./form-controls";
import { RichTextEditor } from "./rich-text-editor";
import { capHtmlText, descriptionHtml, htmlPlainProjection } from "./rich-text-plain";
import { appendDictationToHtml } from "./rich-text-projection";
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
  /** Receives the item to commit. The modal caps its rich fields on the way
   *  out, so the parent MUST save what it is handed here — its own `draft`
   *  state is one render behind and still holds the uncapped value. */
  onSave: (item: ChangeItem) => void;
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
    onAppendFinal: (txt) => update("description", appendDictationToHtml(draftRef.current.description, txt)),
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

  // ★★ No Escape handling here — `Modal` owns it. See stakeholder-edit-modal
  // for the full reason. This modal had the same now-deleted `window`-level
  // listener, and only avoided losing drafts because the linked-tasks picker
  // ALSO calls stopPropagation, cutting propagation to `window` — an accident,
  // not a design.


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
    // ★★ Cap ON THE SAVED OBJECT, not count-only. Clicking Save blurs the field
    // first so the onBlur cap ran, but Enter inside a text input submits WITHOUT
    // firing blur: the value went out uncapped while this counted a truncation
    // and the toast announced one. The onBlur handlers stay — they keep the
    // draft and its counter honest while the user is still typing.
    const cappedTitle = describeTextCap(draft.title, BUDGET_NAME_MAX);
    const cappedRequestedBy = describeTextCap(draft.requestedBy ?? "", BUDGET_NAME_MAX);
    const cappedDecisionBy = describeTextCap(draft.decisionBy ?? "", BUDGET_NAME_MAX);
    adj.track(cappedTitle);
    adj.track(cappedRequestedBy);
    adj.track(cappedDecisionBy);
    const saved: ChangeItem = {
      ...draft,
      title: cappedTitle.value.trim(),
      // `requestedBy`/`decisionBy` are optional — an empty one collapses to
      // undefined, mirroring their own onBlur handlers.
      requestedBy: cappedRequestedBy.value.trim() || undefined,
      decisionBy: cappedDecisionBy.value.trim() || undefined,
      // `description` is required on ChangeItem — an empty body stays "" here
      // rather than collapsing to undefined the way the two optional ones do.
      description: capRich(draft.description),
      impactDescription: capRich(draft.impactDescription) || undefined,
      resolutionNotes: capRich(draft.resolutionNotes) || undefined,
    };
    if (adj.count() > 0) showToast("info", t(lang, "fieldsAdjusted", adj.count()));
    onSave(saved);
  }

  /** Cap a rich field ON THE WRITE PATH and count that same truncation.
   *
   *  ★★ These three fields lost their cap when they stopped being `<Textarea>`s:
   *  the old onBlur handler wrote the truncated value back into the draft, and
   *  only the COUNTING survived the swap. So the toast reported a truncation the
   *  save never made, and the real one landed invisibly on the next load, when
   *  sanitizeRichText finally capped it. Capping here — on the object handed to
   *  onSave — makes the counted adjustment and the applied one one operation.
   *
   *  ★ Both halves measure `htmlPlainProjection(upgraded)`, which is exactly what
   *  capHtmlText and sanitizeRichText measure: the VISIBLE text, so markup never
   *  eats the user's budget and the counter cannot drift from the cap. Upgrading
   *  first matches sanitizeRichText's own composition, so a legacy plain value
   *  is measured the way the loader will measure it rather than one tag short. */
  function capRich(html: string | undefined): string {
    const upgraded = descriptionHtml(html, "rich");
    adj.track(describeTextCap(htmlPlainProjection(upgraded), TEXTAREA_MAX));
    return capHtmlText(upgraded, TEXTAREA_MAX);
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
          {/* ★★ `htmlFor` is LOAD-BEARING — the dictation mic is a real
              `<button>` sitting in the caption ahead of the input, so an
              implicit binding named the MIC and left this required field with
              NO accessible name at all (it has no aria-label and no
              placeholder). jsdom has no SpeechRecognition, so the mic never
              renders in unit tests and none can catch this.
              See src/test/label-binding.ts. */}
          <label htmlFor="change-title" className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="flex items-center gap-1 font-medium text-foreground">
              {t(lang, "changeFieldTitle")} *<InfoTooltip text={t(lang, "changeFieldTitleHint")} />
              {titleMic}
            </span>
            <Input
              id="change-title"
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
          {/* ★★ The wrapper is a `<div>`, NOT a `<label>`. A contenteditable is
              not a labelable element, so a `<label>` here does not name the
              editor (its own `aria-label` does that) — it binds to the first
              labelable thing inside: the dictation mic when dictation is
              supported, otherwise the toolbar's Bold button. Hovering the text
              area paints whichever one it is (`:hover` matches a label's
              labeled control), and a click on the text area is FORWARDED to it.
              ★ The click half only bites Bold: the mic listens on
              pointerdown/keydown and has no `onClick`, so with dictation
              available the defect is hover-only. See src/test/label-binding.ts. */}
          {isVisible("description") && (
          <div className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="flex items-center gap-1 font-medium text-foreground">
              {t(lang, "changeFieldDescription")}<InfoTooltip text={t(lang, "changeFieldDescriptionHint")} />
              {descriptionMic}
            </span>
            {/* focus/blur bubble from the contenteditable, registering THIS
                field as the active dictation target for the hold-to-talk
                hotkey — the wrapper is per-field for exactly that reason. */}
            <div onFocus={descriptionDictationReg.onFocus} onBlur={descriptionDictationReg.onBlur}>
              {/* ★★ key is LOAD-BEARING. Tiptap binds `content` at MOUNT only
                  and never re-reads the prop, while the panel re-seeds this
                  modal's draft in place — so jumping to change 2 while change
                  1's editor is still mounted would leave change 1's body in the
                  field. ★ It depends only on draft.id: this draft is
                  PARENT-OWNED and onChange mints a new object per keystroke, so
                  a key derived from the draft itself would remount Tiptap on
                  every character and destroy the caret. */}
              <RichTextEditor
                key={`${draft.id}:description`}
                variant="lean"
                value={descriptionHtml(draft.description, "rich")}
                /* `description` is REQUIRED on ChangeItem (a plain string), so
                   an empty body stays "" here rather than collapsing to
                   undefined the way the two optional fields below do. */
                onChange={(html) => update("description", html)}
                label={t(lang, "changeFieldDescription")}
                lang={lang}
              />
            </div>
            {/* CharCounter measures `.length`, and the cap measures VISIBLE
                text — so it is fed the projection, not the markup. Upgrading
                FIRST is what makes it the same spelling capRich uses: for a
                legacy plain value descriptionHtml is not the identity, and the
                raw projection strips a "<b>" as inline markup the upgraded one
                counts as three visible characters. */}
            <CharCounter
              value={htmlPlainProjection(descriptionHtml(draft.description, "rich"))}
              max={TEXTAREA_MAX}
              id="change-description-counter"
              lang={lang}
            />
            {descriptionDictationStatus}
          </div>
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
          {/* `<div>`, not `<label>` — see Description above, except that this
              field has NO mic, so the button it adopted was always Bold. */}
          {isVisible("impact") && (
          <div className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="flex items-center gap-1 font-medium text-foreground">
              {t(lang, "changeFieldImpactDescription")}<InfoTooltip text={t(lang, "changeFieldImpactDescriptionHint")} />
            </span>
            {/* No dictation mic on this field (it never had one), so no
                registration wrapper — but the key is per-field all the same. */}
            <RichTextEditor
              key={`${draft.id}:impactDescription`}
              variant="lean"
              value={descriptionHtml(draft.impactDescription, "rich")}
              onChange={(html) => update("impactDescription", html || undefined)}
              label={t(lang, "changeFieldImpactDescription")}
              lang={lang}
            />
            <CharCounter
              value={htmlPlainProjection(descriptionHtml(draft.impactDescription, "rich"))}
              max={TEXTAREA_MAX}
              id="change-impactDescription-counter"
              lang={lang}
            />
          </div>
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
          {/* `<div>`, not `<label>` — see Description above, except that this
              field has NO mic, so the button it adopted was always Bold. */}
          <div className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="flex items-center gap-1 font-medium text-foreground">
              {t(lang, "changeFieldResolution")}<InfoTooltip text={t(lang, "changeFieldResolutionHint")} />
            </span>
            {/* No dictation mic here either — bare editor, per-field key. */}
            <RichTextEditor
              key={`${draft.id}:resolutionNotes`}
              variant="lean"
              value={descriptionHtml(draft.resolutionNotes, "rich")}
              onChange={(html) => update("resolutionNotes", html || undefined)}
              label={t(lang, "changeFieldResolution")}
              lang={lang}
            />
            <CharCounter
              value={htmlPlainProjection(descriptionHtml(draft.resolutionNotes, "rich"))}
              max={TEXTAREA_MAX}
              id="change-resolutionNotes-counter"
              lang={lang}
            />
          </div>

          {/* Document links ------------------------------------------ */}
          <DocumentLinksGroup
            value={draft.knowledgeLinks ?? []}
            onChange={(links) => update("knowledgeLinks", links)}
            lang={lang}
          />

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
                    <IconButton
                      variant="danger"
                      onClick={() => removeLinkedRaid(rid)}
                      label={t(lang, "changeUnlinkRaid")}
                      title={t(lang, "changeUnlinkRaid")}
                    >
                      <XMarkIcon aria-hidden="true" className="h-3 w-3" />
                    </IconButton>
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
