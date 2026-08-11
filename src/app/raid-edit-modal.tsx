"use client";

// RAID edit modal — create / edit / delete a RaidItem: category/status
// segmented controls, the 5×5 risk matrix picker (Risk items only), the
// linked-task and caused-by autocomplete chip pickers, stakeholder
// checkboxes, and the "create mitigation task" shortcut. Extracted from
// raid-panel.tsx; unlike the standalone sibling modals
// (change-edit-modal.tsx / stakeholder-edit-modal.tsx) the panel owns the
// draft state and passes it down with change callbacks.

import { useEffect, useMemo, useRef, useState } from "react";
import { useDraggable } from "./use-draggable";
import { useModalVisibility } from "./use-modal-visibility";
import { SegmentedControl } from "./segmented-control";
import { DocumentLinksGroup } from "./knowledge-links-field-gated";
import { type Lang, t } from "./i18n";
import {
  defaultStatusForCategory,
  riskSeverityFromMatrix,
  statusOptionsFor,
  wouldCreateCycle,
} from "./raid";
import { isRaidActiveForReview } from "./raid-review";
import {
  RAID_CATEGORIES,
  RAID_SEVERITIES,
  type RaidCategory,
  type RaidItem,
  type RaidSeverity,
  type RaidStatus,
  type Resource,
  type RiskScale,
  type Stakeholder,
  type Task,
} from "./types";
import type { Contact } from "./contacts";
import { ResourcePicker } from "./resource-picker";
import { RiskMatrix } from "./raid-risk-matrix";
import { RaidCausedByField, RaidLinkedTasksField } from "./raid-edit-fields";
import { categoryLabel, severityLabel, statusLabel } from "./raid-labels";
import { CharCounter, useAdjustmentTracker } from "./field-feedback";
import { describeTextCap } from "./sanitize-report";
import { TASK_NAME_MAX, TEXTAREA_MAX, ASSIGNEE_MAX } from "./sanitize";
import { filterPickerOptions } from "./picker-filter";
import { useToastContext } from "./toast-context";
import { InfoTooltip } from "./info-tooltip";
import { INTERACTIVE } from "./interaction-styles";
import { EditModalShell, ModalFieldError, StakeholderChipPicker } from "./edit-modal-chrome";
import { Input } from "./form-controls";
import { RichTextEditor } from "./rich-text-editor";
import { capHtmlText, descriptionHtml, htmlPlainProjection } from "./rich-text-plain";
import { appendDictationToHtml } from "./rich-text-projection";
import { Button } from "./button";
import { useDictationMic } from "./dictation-mic";
import { appendDictation } from "./dictation-engine";
import { useSettings } from "./use-settings";
import { useConfirm } from "./confirm-dialog";

export type RaidEditModalProps = {
  lang: Lang;
  tasks: readonly Task[];
  raid: readonly RaidItem[];
  stakeholdersEnabled: boolean;
  stakeholders: readonly Stakeholder[];
  resources: readonly Resource[];
  contacts: Contact[];
  onCreateResource: (name: string, email: string) => number;
  draft: RaidItem;
  isNew: boolean;
  onChange: (next: RaidItem) => void;
  onApplyStatus: (s: RaidStatus) => void;
  onApplyMatrix: (probability: RiskScale, impact: RiskScale) => void;
  /** Receives the item to commit. The modal caps its rich fields on the way
   *  out, so the parent MUST save what it is handed here — its own `draft`
   *  state is one render behind and still holds the uncapped value. */
  onSave: (item: RaidItem) => void;
  onCancel: () => void;
  onDelete: () => void;
  onCreateMitigationTask: () => void;
  /** Switch the panel's modal to a different RAID item. Used by the
   *  "Caused by" link and the "Items caused by this" chips. */
  onJumpToRaid: (id: number) => void;
  /** Send a status-inquiry email to the item's owner. Absent in popouts; the
   *  footer button only renders for a saved, review-active item. */
  onSendInquiry?: (item: RaidItem) => void;
  /** Open the floating notes window (running note log) for the item. Absent in
   *  popouts; the button is also disabled for an unsaved (new) draft, which
   *  has no persisted id to resolve. */
  onOpenNotes?: (id: number) => void;
};

export function RaidEditModal({
  lang,
  tasks,
  raid,
  stakeholdersEnabled,
  stakeholders,
  resources,
  contacts,
  onCreateResource,
  draft,
  isNew,
  onChange,
  onApplyStatus,
  onApplyMatrix,
  onSave,
  onCancel,
  onDelete,
  onCreateMitigationTask,
  onJumpToRaid,
  onSendInquiry,
  onOpenNotes,
}: RaidEditModalProps) {
  const showToast = useToastContext();
  const { isVisible } = useModalVisibility("raid");
  const adj = useAdjustmentTracker();
  const { settings } = useSettings();
  const confirm = useConfirm();
  const draftRef = useRef(draft);
  useEffect(() => { draftRef.current = draft; });
  const { mic: descriptionMic, status: descriptionDictationStatus, registration: descriptionDictationReg } = useDictationMic({
    lang,
    dictation: settings.dictation,
    enabled: true,
    label: t(lang, "raidDescription"),
    onAppendFinal: (txt) =>
      onChange({ ...draftRef.current, description: appendDictationToHtml(draftRef.current.description, txt) || undefined }),
  });
  const { mic: titleMic, status: titleDictationStatus, registration: titleDictationReg } = useDictationMic({
    lang,
    dictation: settings.dictation,
    enabled: true,
    label: t(lang, "raidTitle"),
    onAppendFinal: (txt) =>
      onChange({ ...draftRef.current, title: describeTextCap(appendDictation(draftRef.current.title ?? "", txt), TASK_NAME_MAX).value }),
  });
  const [error, setError] = useState<string | null>(null);
  const [causePickerQuery, setCausePickerQuery] = useState("");
  const { offset, reset: dragReset, handleProps } = useDraggable(true, "aipm-cockpit:modal-pos:raid-edit");
  // Category is locked after creation by default (changing it can lose
  // status / matrix data). Users can unlock it with the inline "Advanced"
  // affordance. Re-locks whenever the user navigates to a different item.
  const [categoryUnlocked, setCategoryUnlocked] = useState(false);
  const [prevDraftId, setPrevDraftId] = useState(draft.id);
  if (prevDraftId !== draft.id) {
    setPrevDraftId(draft.id);
    setCategoryUnlocked(false);
  }

  const statusOpts = statusOptionsFor(draft.category);

  // RAID items eligible to be added as a cause of this draft. Excludes the
  // draft itself, already-selected parents, and any item whose selection
  // would close a cycle (via extraFilter, applied before the search query so
  // typing can't bring an invalid pick back into view).
  const availableCauses = useMemo(
    () =>
      filterPickerOptions(raid, {
        query: causePickerQuery,
        excludeIds: new Set(draft.causedByRaidIds),
        getId: (r) => r.id,
        getText: (r) => r.title,
        extraFilter: (r) => r.id !== draft.id && !wouldCreateCycle(raid, draft.id, r.id),
      }),
    [raid, draft.id, draft.causedByRaidIds, causePickerQuery],
  );

  // Items whose `causedByRaidIds` includes this draft — only meaningful for
  // saved items (a brand-new draft can't have caused anything yet).
  const causedChildren = useMemo(() => {
    if (isNew) return [];
    return raid.filter((r) => r.causedByRaidIds.includes(draft.id));
  }, [raid, draft.id, isNew]);

  const parentItems = useMemo(
    () =>
      draft.causedByRaidIds
        .map((id) => raid.find((r) => r.id === id))
        .filter((r): r is RaidItem => !!r),
    [draft.causedByRaidIds, raid],
  );

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
    // ★★★ This is the ONLY cap on `title`/`owner` for a human editor, not a
    // duplicate of a storage-side one. `sanitizeRaidItem` LOOKS like the storage
    // boundary and is not on one: `use-resource-planner.ts` stores the item
    // directly, `workspace.ts`'s JSON load is a bare cast plus
    // `sanitizeRaidRichFields` (rich fields only), and `buildRaidItemFromObj`
    // hand-builds `title` with `obj.title?.trim() ?? ""` — no cap on ANY path.
    // Change is the opposite (its decoder and JSON load both route through
    // `sanitizeChangeItem`), so do not reason about the two registers together.
    // open-followups.md §37. ★ Side effect worth keeping: the auto-issue derivation
    // below copies `title` verbatim, so it now inherits the capped value.
    const cappedTitle = describeTextCap(draft.title, TASK_NAME_MAX);
    const cappedOwner = describeTextCap(draft.owner ?? "", ASSIGNEE_MAX);
    adj.track(cappedTitle);
    adj.track(cappedOwner);
    const saved: RaidItem = {
      ...draft,
      title: cappedTitle.value.trim(),
      owner: cappedOwner.value.trim() || undefined,
      description: capRich(draft.description) || undefined,
      mitigation: capRich(draft.mitigation) || undefined,
    };
    if (adj.count() > 0) showToast("info", t(lang, "fieldsAdjusted", adj.count()));
    onSave(saved);
  }

  /** Cap a rich field ON THE WRITE PATH and count that same truncation.
   *
   *  ★★ These two fields lost their cap when they stopped being `<Textarea>`s:
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

  function addLinked(taskId: number) {
    if (draft.linkedTaskIds.includes(taskId)) return;
    onChange({ ...draft, linkedTaskIds: [...draft.linkedTaskIds, taskId] });
  }

  function removeLinked(taskId: number) {
    onChange({
      ...draft,
      linkedTaskIds: draft.linkedTaskIds.filter((id) => id !== taskId),
    });
  }

  function addCausedBy(parentId: number) {
    if (parentId === draft.id) {
      setError(t(lang, "raidErrorCausedBySelf"));
      return;
    }
    if (draft.causedByRaidIds.includes(parentId)) return;
    if (wouldCreateCycle(raid, draft.id, parentId)) {
      setError(t(lang, "raidErrorCausedByCycle"));
      return;
    }
    setError(null);
    onChange({
      ...draft,
      causedByRaidIds: [...draft.causedByRaidIds, parentId],
    });
    setCausePickerQuery("");
  }

  function removeCausedBy(parentId: number) {
    onChange({
      ...draft,
      causedByRaidIds: draft.causedByRaidIds.filter((id) => id !== parentId),
    });
  }

  function toggleStakeholder(stakeholderId: number) {
    const ids = draft.stakeholderIds ?? [];
    const next = ids.includes(stakeholderId)
      ? ids.filter((id) => id !== stakeholderId)
      : [...ids, stakeholderId];
    onChange({ ...draft, stakeholderIds: next });
  }

  return (
    <EditModalShell
      lang={lang}
      title={isNew ? t(lang, "raidNewItem") : t(lang, "raidEditItem", draft.id)}
      modalId="raid"
      onClose={onCancel}
      onSubmit={handleSubmit}
      offset={offset}
      dragHandleProps={handleProps}
      onDragReset={dragReset}
      sizeKey="aipm-cockpit:modal-size:raid-edit"
      align="start"
      backdropScroll
    >
          {isVisible("category") && (
          <div className="flex flex-col gap-1 text-sm">
            {/* ★★ A `<div>`, NOT a `<label>`. Neither a radiogroup nor a
                contenteditable is a labelable element, so a `<label>` around
                one binds to the first BUTTON inside it instead — here the
                "Risk" radio. Hovering the caption then paints that radio's
                hover state, and clicking the caption SETS the category — ★ but
                only while the group is enabled (`!isNew && !categoryUnlocked`
                disables it, and a disabled labeled control receives no
                forwarded click), so the data-write reached new items and
                unlocked ones. Status and Severity carry no such guard. The
                group names itself via `ariaLabel`. See
                src/test/label-binding.ts. */}
            <div className="flex flex-col gap-1">
              <span className="flex items-center gap-1 font-medium text-foreground">
                {t(lang, "raidCategory")}
                <InfoTooltip text={t(lang, "raidFieldCategoryHint")} />
              </span>
              <SegmentedControl<RaidCategory>
                value={draft.category}
                disabled={!isNew && !categoryUnlocked}
                ariaLabel={t(lang, "raidCategory")}
                options={RAID_CATEGORIES.map((c) => ({
                  value: c,
                  label: categoryLabel(c, lang),
                }))}
                onChange={(c) => {
                  // Smart status mapping: keep the current status when the
                  // new category still permits it (common values like
                  // "Open", "Closed", "In Progress" appear in multiple
                  // enums). Otherwise fall back to the new category's
                  // default. This makes "change category" feel non-lossy
                  // in the common case (R↔I↔D), while still being correct
                  // for Assumption transitions.
                  const validStatuses = statusOptionsFor(c);
                  const newStatus = validStatuses.includes(draft.status)
                    ? draft.status
                    : defaultStatusForCategory(c);
                  // Risk-only matrix fields: initialize when becoming R,
                  // clear when leaving R.
                  let probability = draft.probability;
                  let impact = draft.impact;
                  let severity = draft.severity;
                  if (c === "R" && (probability === undefined || impact === undefined)) {
                    probability = 3;
                    impact = 3;
                    severity = riskSeverityFromMatrix(probability, impact);
                  } else if (c !== "R" && (probability !== undefined || impact !== undefined)) {
                    probability = undefined;
                    impact = undefined;
                  }
                  onChange({
                    ...draft,
                    category: c,
                    status: newStatus,
                    probability,
                    impact,
                    severity,
                  });
                }}
              />
            </div>
            {!isNew && !categoryUnlocked && (
              <button
                type="button"
                onClick={() => setCategoryUnlocked(true)}
                className={`self-start text-[11px] font-medium text-muted-foreground underline-offset-2 hover:text-ui-dark-blue hover:underline ${INTERACTIVE}`}
              >
                {t(lang, "raidAdvancedChangeCategory")}
              </button>
            )}
            {!isNew && categoryUnlocked && (
              <span className="text-[11px] italic text-ui-purple">
                {t(lang, "raidCategoryChangedWarning")}
              </span>
            )}
          </div>
          )}

          {/* `<div>`, not `<label>` — see Category above. */}
          {isVisible("status") && (
          <div className="flex flex-col gap-1 text-sm">
            <span className="flex items-center gap-1 font-medium text-foreground">
              {t(lang, "raidStatus")}
              <InfoTooltip text={t(lang, "raidFieldStatusHint")} />
            </span>
            <SegmentedControl<RaidStatus>
              value={draft.status}
              ariaLabel={t(lang, "raidStatus")}
              options={statusOpts.map((s) => ({
                value: s,
                label: statusLabel(s, lang),
              }))}
              onChange={(s) => onApplyStatus(s)}
            />
          </div>
          )}

          {/* ★★ `htmlFor` is LOAD-BEARING. The dictation mic is a real
              `<button>` and sits in the caption AHEAD of the input, so an
              implicit binding made this label name the MIC — demoting the
              required Title field to its `placeholder`, which HTML-AAM treats
              as the fallback name (a poor name, not none; the change and
              milestone rows have no placeholder and were left with NO name at
              all) in any browser that
              supports SpeechRecognition (jsdom has none, so no unit test can
              see it). See src/test/label-binding.ts. */}
          <label htmlFor="raid-title" className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="flex items-center gap-1 font-medium text-foreground">
              {t(lang, "raidTitle")} *
              <InfoTooltip text={t(lang, "raidFieldTitleHint")} />
              {titleMic}
            </span>
            <Input
              id="raid-title"
              type="text"
              required
              value={draft.title}
              onChange={(e) => onChange({ ...draft, title: e.target.value })}
              onFocus={titleDictationReg.onFocus}
              onBlur={(e) => { onChange({ ...draft, title: describeTextCap(e.target.value, TASK_NAME_MAX).value.trim() }); titleDictationReg.onBlur(); }}
              placeholder={t(lang, "raidPlaceholderTitle")}
              aria-describedby="raid-title-counter"
            />
            <CharCounter value={draft.title} max={TASK_NAME_MAX} id="raid-title-counter" lang={lang} />
            {titleDictationStatus}
          </label>

          {/* `<div>`, not `<label>` — see Category above. Here the adopted
              button was the dictation mic when dictation is supported, else the
              editor's Bold control; unlike Category, the forwarded CLICK only
              bites Bold (the mic has no `onClick`), while the hover bleed
              applies to either. */}
          {isVisible("description") && (
          <div className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="flex items-center gap-1 font-medium text-foreground">
              {t(lang, "raidDescription")}
              <InfoTooltip text={t(lang, "raidFieldDescriptionHint")} />
              {descriptionMic}
            </span>
            {/* focus/blur bubble from the contenteditable, registering THIS
                field as the active dictation target for the hold-to-talk
                hotkey — the wrapper is per-field for exactly that reason. */}
            <div onFocus={descriptionDictationReg.onFocus} onBlur={descriptionDictationReg.onBlur}>
              {/* ★★ key is LOAD-BEARING. Tiptap binds `content` at MOUNT only
                  and never re-reads the prop, while the panel re-seeds this
                  modal's draft in place — so jumping to item 2 while item 1's
                  editor is still mounted would leave item 1's body in the
                  field. ★ It depends only on draft.id: this draft is
                  PARENT-OWNED and onChange mints a new object per keystroke, so
                  a key derived from the draft itself would remount Tiptap on
                  every character and destroy the caret. */}
              <RichTextEditor
                key={`${draft.id}:description`}
                variant="lean"
                value={descriptionHtml(draft.description, "rich")}
                onChange={(html) => onChange({ ...draft, description: html || undefined })}
                label={t(lang, "raidDescription")}
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
              id="raid-description-counter"
              lang={lang}
            />
            {descriptionDictationStatus}
          </div>
          )}

          {/* Running note log — opens the shared floating notes window. Disabled
              for an unsaved draft (no persisted id yet) or in popouts (no
              handler threaded). */}
          <div className="flex items-center gap-2 sm:col-span-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onOpenNotes?.(draft.id)}
              disabled={!onOpenNotes || isNew}
            >
              {t(lang, "noteLogTitle")} ({draft.noteLog?.length ?? 0})
            </Button>
          </div>

          {/* Risk scoring: for Risk items this is the matrix (full-only field
              `riskMatrix`); for non-Risk items it's the severity control
              (advanced field `scoring`). Each branch is guarded by its own id. */}
          {draft.category === "R"
            ? isVisible("riskMatrix") && (
            <div className="sm:col-span-2">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <span className="flex items-center gap-1 text-sm font-medium text-foreground">
                  {t(lang, "raidRiskMatrix")}
                  <InfoTooltip text={t(lang, "raidFieldRiskMatrixHint")} />
                </span>
                <span className="text-xs text-muted-foreground">
                  {draft.probability && draft.impact
                    ? `${draft.probability} × ${draft.impact} = ${draft.probability * draft.impact} → ${draft.severity ? severityLabel(draft.severity, lang) : ""}`
                    : ""}
                </span>
              </div>
              <RiskMatrix
                probability={draft.probability ?? 3}
                impact={draft.impact ?? 3}
                onPick={onApplyMatrix}
                lang={lang}
              />
            </div>
              )
            : isVisible("scoring") && (
            <div className="flex flex-col gap-1 text-sm">
              {/* `<div>`, not `<label>` — see Category above. */}
              <span className="flex items-center gap-1 font-medium text-foreground">
                {t(lang, "raidSeverity")}
                <InfoTooltip text={t(lang, "raidFieldSeverityHint")} />
              </span>
              <SegmentedControl<RaidSeverity>
                value={draft.severity ?? "Medium"}
                ariaLabel={t(lang, "raidSeverity")}
                options={RAID_SEVERITIES.map((s) => ({
                  value: s,
                  label: severityLabel(s, lang),
                }))}
                onChange={(s) => onChange({ ...draft, severity: s })}
              />
            </div>
              )}

          {isVisible("owner") && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="flex items-center gap-1 font-medium text-foreground">
              {t(lang, "raidOwner")}
              <InfoTooltip text={t(lang, "raidFieldOwnerHint")} />
            </span>
            <ResourcePicker
              lang={lang}
              value={{ name: draft.owner ?? "", email: draft.ownerEmail ?? "", resourceId: draft.ownerResourceId }}
              resources={resources}
              contacts={contacts}
              onCreateResource={onCreateResource}
              onChange={(next) =>
                onChange({
                  ...draft,
                  owner: next.name || undefined,
                  ownerEmail: next.email || undefined,
                  ownerResourceId: next.resourceId,
                })
              }
              onBlur={(e) => {
                const trimmed = describeTextCap(e.target.value, ASSIGNEE_MAX).value.trim();
                onChange({ ...draft, owner: trimmed || undefined });
              }}
              maxLength={ASSIGNEE_MAX}
              aria-describedby="raid-owner-counter"
            />
            <CharCounter value={draft.owner ?? ""} max={ASSIGNEE_MAX} id="raid-owner-counter" lang={lang} />
          </label>
          )}

          {/* Owner email travels with the owner field. */}
          {isVisible("owner") && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="flex items-center gap-1 font-medium text-foreground">
              {t(lang, "email")}
              <InfoTooltip text={t(lang, "raidFieldOwnerEmailHint")} />
            </span>
            <Input
              type="email"
              value={draft.ownerEmail ?? ""}
              onChange={(e) =>
                onChange({ ...draft, ownerEmail: e.target.value || undefined })
              }
            />
          </label>
          )}

          {isVisible("raisedDate") && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="flex items-center gap-1 font-medium text-foreground">
              {t(lang, "raidRaisedDate")}
              <InfoTooltip text={t(lang, "raidFieldRaisedDateHint")} />
            </span>
            <Input
              type="date"
              value={draft.raisedDate}
              onChange={(e) => onChange({ ...draft, raisedDate: e.target.value })}
            />
          </label>
          )}

          {isVisible("targetDate") && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="flex items-center gap-1 font-medium text-foreground">
              {t(lang, "raidTargetDate")}
              <InfoTooltip text={t(lang, "raidFieldTargetDateHint")} />
            </span>
            <Input
              type="date"
              value={draft.targetDate ?? ""}
              onChange={(e) =>
                onChange({ ...draft, targetDate: e.target.value || undefined })
              }
            />
          </label>
          )}

          {/* `<div>`, not `<label>` — see Category above. */}
          {isVisible("mitigation") && (
          <div className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="flex items-center gap-1 font-medium text-foreground">
              {t(lang, "raidMitigation")}
              <InfoTooltip text={t(lang, "raidFieldMitigationHint")} />
            </span>
            {/* No dictation mic on this field (it never had one), so no
                registration wrapper — but the key is per-field all the same. */}
            <RichTextEditor
              key={`${draft.id}:mitigation`}
              variant="lean"
              value={descriptionHtml(draft.mitigation, "rich")}
              onChange={(html) => onChange({ ...draft, mitigation: html || undefined })}
              label={t(lang, "raidMitigation")}
              lang={lang}
            />
            <CharCounter
              value={htmlPlainProjection(descriptionHtml(draft.mitigation, "rich"))}
              max={TEXTAREA_MAX}
              id="raid-mitigation-counter"
              lang={lang}
            />
          </div>
          )}

          <DocumentLinksGroup
            value={draft.knowledgeLinks ?? []}
            onChange={(knowledgeLinks) => onChange({ ...draft, knowledgeLinks })}
            lang={lang}
          />

          {isVisible("linkedTasks") && (
          <RaidLinkedTasksField
            lang={lang}
            linkedTaskIds={draft.linkedTaskIds}
            tasks={tasks}
            isNew={isNew}
            onCreateMitigationTask={onCreateMitigationTask}
            addLinked={addLinked}
            removeLinked={removeLinked}
          />
          )}

          {isVisible("linkedRaid") && (
          <RaidCausedByField
            lang={lang}
            parentItems={parentItems}
            causePickerQuery={causePickerQuery}
            setCausePickerQuery={setCausePickerQuery}
            availableCauses={availableCauses}
            addCausedBy={addCausedBy}
            removeCausedBy={removeCausedBy}
            onJumpToRaid={onJumpToRaid}
            causedChildren={causedChildren}
            isNew={isNew}
          />
          )}

          {/* Stakeholders ------------------------------------------- */}
          {stakeholdersEnabled && isVisible("linkedStakeholders") && (
            <StakeholderChipPicker
              lang={lang}
              stakeholders={stakeholders}
              selectedIds={draft.stakeholderIds ?? []}
              onToggle={toggleStakeholder}
            />
          )}

          {error && <ModalFieldError error={error} />}

          <div className="flex justify-between gap-2 sm:col-span-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={async () => {
                    if (await confirm({ message: t(lang, "raidConfirmDelete") })) onDelete();
                  }}
                  disabled={isNew}
                >
                  {t(lang, "raidDelete")}
                </Button>
                <InfoTooltip text={t(lang, "raidFieldDeleteHint")} />
              </span>
              {!isNew && onSendInquiry && isRaidActiveForReview(draft) && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onSendInquiry(draft)}
                >
                  {t(lang, "sendInquiry")}
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={onCancel}>
                {t(lang, "cancel")}
              </Button>
              <Button type="submit" size="sm">
                {t(lang, "raidSave")}
              </Button>
            </div>
          </div>
    </EditModalShell>
  );
}
