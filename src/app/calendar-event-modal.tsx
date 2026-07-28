"use client";

// Meeting series editor — creates/edits a CalendarEvent (a single or
// recurring timed meeting on the resource calendar). Mirrors the six-modal
// convention (absence-edit-modal.tsx is the closest sibling): EditModalShell
// + useDraftState<CalendarEvent> + ModalFieldError + ModalEditFooter +
// useDraggable + useConfirm for delete.
//
// RecurrenceRule is a discriminated union whose `byDay` field means a
// DIFFERENT SHAPE per freq (Weekday[] for weekly; {ordinal,day} for
// monthly) — editing it piecemeal through the flat CalendarEvent draft would
// either fight the union's typing or silently drop a sub-form's values when
// the user switches freq and back. So recurrence sub-fields live in a
// SEPARATE RecurrenceDraft (a flat superset bag carrying every possible
// sub-field at once, regardless of which freq is active) and are only
// assembled into the real RecurrenceRule | undefined at submit time — the
// same "expand the single-field update() by hand for a field that can't be
// a flat patch" pattern absence-edit-modal.tsx uses for its start/end
// clamp, just at a larger scale. The draft type + its two converters
// (recurrenceDraftFrom/buildRecurrenceRule) live in recurrence-draft.ts —
// pure, so they're exhaustively testable directly rather than only through
// DOM simulation of this form.
//
// ★★ Submit routes the assembled draft through sanitizeCalendarEvent — the
// single validator — and calls onSave ONLY with its result. A null result
// (missing title/startDate) sets a field error and does not save, so this
// modal can never emit a shape storage would reject.
//
// NO attendees field: attendeeResourceIds/sendInvitations stay on the model
// and persist untouched, but get no UI until the Outlook invitations that
// give them purpose ship (0.203.0).

import { useState } from "react";
import { type Lang, type TranslationKey, t } from "./i18n";
import { clampRangeEnd } from "./date-range";
import { parseUtc } from "./calendar-window";
import { weekdayIndex } from "./recurrence";
import { EditModalShell, ModalFieldError, ModalEditFooter } from "./edit-modal-chrome";
import { FieldHint } from "./field-hint";
import { Checkbox, Input, Select } from "./form-controls";
import { SegmentedControl } from "./segmented-control";
import { useDraggable } from "./use-draggable";
import { useModalVisibility } from "./use-modal-visibility";
import { useConfirm } from "./confirm-dialog";
import { useDraftState } from "./use-draft-state";
import {
  WEEKDAYS,
  sanitizeCalendarEvent,
  type CalendarEvent,
  type Weekday,
} from "./calendar-event";
import {
  buildRecurrenceRule,
  recurrenceDraftFrom,
  type EndsMode,
  type MonthlyMode,
  type Ordinal,
  type RecurrenceDraft,
  type RepeatFreq,
} from "./recurrence-draft";

// Weekly's `byDay` is OPTIONAL, and when empty the recurrence engine
// (recurrence.ts) already recurs on the event's OWN start weekday — but an
// empty checkbox row then looks like "nothing is selected", which reads as
// broken rather than as "recurs on the day you picked above". Pre-checking
// that one day makes the default VISIBLE without changing what the rule
// produces (a single weekday matching the start date IS that same implicit
// default, just spelled out) — it only fires when nothing is checked yet, so
// a deliberate clear-back-to-implicit by the user is never undone.
function withVisibleStartWeekday(d: RecurrenceDraft, startDate: string): RecurrenceDraft {
  if (d.freq !== "weekly" || d.weeklyByDay.length > 0) return d;
  const start = parseUtc(startDate);
  if (!start) return d;
  return { ...d, weeklyByDay: [WEEKDAYS[weekdayIndex(start)]] };
}

interface Props {
  lang: Lang;
  /** When null the modal is hidden. */
  event: CalendarEvent | null;
  /** True when creating; false when editing an existing record. */
  isNew: boolean;
  /** `isNew` is echoed back (mirrors the modal's own prop) so the save
   *  handler can route create-vs-update through resolveEntitySave's explicit
   *  intent rather than falling back to id-existence — closing the same
   *  id-mint-race window entity-id-mint.ts documents for every other
   *  modal-driven entity save. */
  onSave: (next: CalendarEvent, isNew?: boolean) => void;
  onDelete: (id: number) => void;
  onClose: () => void;
}

const ORDINALS: readonly Ordinal[] = [1, 2, 3, 4, -1];

// Reuses the existing weekday-abbreviation keys (shift-edit-modal's own
// weekday grid uses the same set) rather than minting a second copy.
const WEEKDAY_LABEL_KEY: Record<Weekday, TranslationKey> = {
  MO: "shiftDayMon",
  TU: "shiftDayTue",
  WE: "shiftDayWed",
  TH: "shiftDayThu",
  FR: "shiftDayFri",
  SA: "shiftDaySat",
  SU: "shiftDaySun",
};

const ORDINAL_LABEL_KEY: Record<Ordinal, TranslationKey> = {
  1: "calendarEventOrdinal1",
  2: "calendarEventOrdinal2",
  3: "calendarEventOrdinal3",
  4: "calendarEventOrdinal4",
  [-1]: "calendarEventOrdinalLast",
};

const INTERVAL_UNIT_KEY: Record<"daily" | "weekly" | "monthly", TranslationKey> = {
  daily: "calendarEventIntervalUnitDaily",
  weekly: "calendarEventIntervalUnitWeekly",
  monthly: "calendarEventIntervalUnitMonthly",
};

export function CalendarEventModal({ lang, event, isNew, onSave, onDelete, onClose }: Props) {
  const [prevEvent, setPrevEvent] = useState(event);
  const { draft, setDraft, update, error, setError } = useDraftState<CalendarEvent>(event);
  const [recurrence, setRecurrence] = useState<RecurrenceDraft>(() =>
    withVisibleStartWeekday(recurrenceDraftFrom(event?.recurrence), event?.startDate ?? ""),
  );

  const { isVisible } = useModalVisibility("calendarEvent");
  const confirm = useConfirm();

  if (prevEvent !== event) {
    setPrevEvent(event);
    setDraft(event);
    setRecurrence(withVisibleStartWeekday(recurrenceDraftFrom(event?.recurrence), event?.startDate ?? ""));
    setError(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    const raw = { ...draft, recurrence: buildRecurrenceRule(recurrence) };
    const sanitized = sanitizeCalendarEvent(raw);
    if (!sanitized) {
      setError(t(lang, "calendarEventErrorTitleRequired"));
      return;
    }
    onSave(sanitized, isNew);
  }

  async function handleDeleteClick() {
    if (!draft) return;
    if (await confirm({ message: t(lang, "calendarEventConfirmDelete") })) {
      onDelete(draft.id);
    }
  }

  const { offset, reset: dragReset, handleProps } = useDraggable(
    draft !== null,
    "aipm-cockpit:modal-pos:calendar-event",
  );

  if (!draft) return null;

  const title = isNew
    ? t(lang, "calendarEventNewItem")
    : t(lang, "calendarEventEditItem", draft.id);

  const repeating = recurrence.freq !== "none";
  const exceptionCount = draft.exceptions?.length ?? 0;

  return (
    <EditModalShell
      lang={lang}
      title={title}
      modalId="calendarEvent"
      onClose={onClose}
      onSubmit={handleSubmit}
      offset={offset}
      dragHandleProps={handleProps}
      onDragReset={dragReset}
      sizeKey="aipm-cockpit:modal-size:calendar-event"
      widthClassName="w-[560px] min-w-[320px]"
      formClassName="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-5 sm:grid-cols-2"
    >
      {isVisible("title") && (
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span className="font-medium text-foreground">{t(lang, "calendarEventTitle")} *</span>
          <Input required value={draft.title} onChange={(e) => update("title", e.target.value)} />
        </label>
      )}

      {isVisible("occurrence") && (
        <>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">
              {t(lang, "calendarEventFirstOccurrence")} *
            </span>
            <Input
              type="date"
              required
              value={draft.startDate}
              // Two-field write (start + the clamped "ends on" date, which
              // lives in the separate recurrence draft) — update() can only
              // patch one field, so this expands it by hand, including the
              // setError(null) it would otherwise give us for free.
              onChange={(e) => {
                const nextStart = e.target.value;
                setDraft((prev) => (prev ? { ...prev, startDate: nextStart } : prev));
                setRecurrence((prev) => ({ ...prev, until: clampRangeEnd(nextStart, prev.until) }));
                setError(null);
              }}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">{t(lang, "calendarEventStartTime")}</span>
            <Input
              type="time"
              value={draft.startTime}
              onChange={(e) => update("startTime", e.target.value)}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">{t(lang, "calendarEventDuration")}</span>
            <Input
              type="number"
              min={5}
              max={1440}
              value={draft.durationMinutes}
              onChange={(e) => update("durationMinutes", Number(e.target.value))}
            />
          </label>
        </>
      )}

      {isVisible("location") && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-foreground">{t(lang, "calendarEventLocation")}</span>
          <Input
            value={draft.location ?? ""}
            onChange={(e) => update("location", e.target.value || undefined)}
          />
        </label>
      )}

      {isVisible("repeat") && (
        <div className="flex flex-col gap-3 text-sm sm:col-span-2">
          <div className="flex flex-col gap-1">
            <span className="font-medium text-foreground">{t(lang, "calendarEventRepeat")}</span>
            <SegmentedControl<RepeatFreq>
              value={recurrence.freq}
              ariaLabel={t(lang, "calendarEventRepeat")}
              options={[
                { value: "none", label: t(lang, "calendarEventRepeatNever") },
                { value: "daily", label: t(lang, "calendarEventRepeatDaily") },
                { value: "weekly", label: t(lang, "calendarEventRepeatWeekly") },
                { value: "monthly", label: t(lang, "calendarEventRepeatMonthly") },
              ]}
              onChange={(freq) =>
                setRecurrence((prev) => withVisibleStartWeekday({ ...prev, freq }, draft.startDate))
              }
            />
          </div>

          {/* sanitizeCalendarEvent drops exceptions along with the rule, so
              this save really does discard them. Undo restores it in one step
              (CALENDAR_EVENT_UNDO_GROUPS), but silence is still wrong. A hint,
              not ModalFieldError — the save is legal, merely lossy. Reads the
              DRAFT because the repeat controls live in a separate recurrence
              state, so draft.exceptions survives until submit. */}
          {!repeating && exceptionCount > 0 && (
            <FieldHint>{t(lang, "calendarEventExceptionsDiscarded", exceptionCount)}</FieldHint>
          )}

          {repeating && (
            <>
              <label className="flex items-center gap-2">
                <span className="font-medium text-foreground">{t(lang, "calendarEventInterval")}</span>
                <Input
                  type="number"
                  min={1}
                  max={52}
                  value={recurrence.interval}
                  className="w-20"
                  onChange={(e) =>
                    setRecurrence((prev) => ({ ...prev, interval: Number(e.target.value) }))
                  }
                />
                <span className="text-muted-foreground">
                  {t(lang, INTERVAL_UNIT_KEY[recurrence.freq as "daily" | "weekly" | "monthly"])}
                </span>
              </label>

              {recurrence.freq === "weekly" && (
                <div className="flex flex-col gap-1">
                  <span className="font-medium text-foreground">{t(lang, "calendarEventWeekdays")}</span>
                  <div className="flex gap-2">
                    {WEEKDAYS.map((d) => (
                      <label key={d} className="flex flex-col items-center gap-1">
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          {t(lang, WEEKDAY_LABEL_KEY[d])}
                        </span>
                        <Checkbox
                          checked={recurrence.weeklyByDay.includes(d)}
                          onChange={() =>
                            setRecurrence((prev) => ({
                              ...prev,
                              weeklyByDay: prev.weeklyByDay.includes(d)
                                ? prev.weeklyByDay.filter((x) => x !== d)
                                : [...prev.weeklyByDay, d],
                            }))
                          }
                        />
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {recurrence.freq === "monthly" && (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-col gap-1">
                    <span className="font-medium text-foreground">
                      {t(lang, "calendarEventMonthlyMode")}
                    </span>
                    <SegmentedControl<MonthlyMode>
                      value={recurrence.monthlyMode}
                      ariaLabel={t(lang, "calendarEventMonthlyMode")}
                      options={[
                        { value: "dom", label: t(lang, "calendarEventMonthlyModeDayOfMonth") },
                        { value: "nth", label: t(lang, "calendarEventMonthlyModeNthWeekday") },
                      ]}
                      onChange={(monthlyMode) => setRecurrence((prev) => ({ ...prev, monthlyMode }))}
                    />
                  </div>

                  {recurrence.monthlyMode === "dom" ? (
                    <label className="flex flex-col gap-1">
                      <span className="font-medium text-foreground">
                        {t(lang, "calendarEventMonthlyDayLabel")}
                      </span>
                      <Input
                        type="number"
                        min={1}
                        max={31}
                        className="w-20"
                        value={recurrence.monthlyDom}
                        onChange={(e) =>
                          setRecurrence((prev) => ({ ...prev, monthlyDom: Number(e.target.value) }))
                        }
                      />
                    </label>
                  ) : (
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="flex flex-col gap-1">
                        <span className="font-medium text-foreground">
                          {t(lang, "calendarEventMonthlyOrdinalLabel")}
                        </span>
                        <SegmentedControl<string>
                          value={String(recurrence.monthlyOrdinal)}
                          ariaLabel={t(lang, "calendarEventMonthlyOrdinalLabel")}
                          options={ORDINALS.map((o) => ({
                            value: String(o),
                            label: t(lang, ORDINAL_LABEL_KEY[o]),
                          }))}
                          onChange={(v) =>
                            setRecurrence((prev) => ({ ...prev, monthlyOrdinal: Number(v) as Ordinal }))
                          }
                        />
                      </div>
                      <label className="flex flex-col gap-1">
                        <span className="font-medium text-foreground">
                          {t(lang, "calendarEventMonthlyWeekdayLabel")}
                        </span>
                        <Select
                          value={recurrence.monthlyWeekday}
                          onChange={(e) =>
                            setRecurrence((prev) => ({
                              ...prev,
                              monthlyWeekday: e.target.value as Weekday,
                            }))
                          }
                        >
                          {WEEKDAYS.map((d) => (
                            <option key={d} value={d}>
                              {t(lang, WEEKDAY_LABEL_KEY[d])}
                            </option>
                          ))}
                        </Select>
                      </label>
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-col gap-1">
                <span className="font-medium text-foreground">{t(lang, "calendarEventEnds")}</span>
                <SegmentedControl<EndsMode>
                  value={recurrence.ends}
                  ariaLabel={t(lang, "calendarEventEnds")}
                  options={[
                    { value: "never", label: t(lang, "calendarEventEndsNever") },
                    { value: "date", label: t(lang, "calendarEventEndsOnDate") },
                    { value: "count", label: t(lang, "calendarEventEndsAfterCount") },
                  ]}
                  onChange={(ends) => setRecurrence((prev) => ({ ...prev, ends }))}
                />
              </div>

              {recurrence.ends === "date" && (
                <label className="flex flex-col gap-1">
                  <span className="font-medium text-foreground">
                    {t(lang, "calendarEventEndsUntilLabel")}
                  </span>
                  <Input
                    type="date"
                    value={recurrence.until}
                    onChange={(e) => setRecurrence((prev) => ({ ...prev, until: e.target.value }))}
                  />
                </label>
              )}

              {recurrence.ends === "count" && (
                <label className="flex flex-col gap-1">
                  <span className="font-medium text-foreground">
                    {t(lang, "calendarEventEndsCountLabel")}
                  </span>
                  <Input
                    type="number"
                    min={1}
                    max={500}
                    className="w-24"
                    value={recurrence.count}
                    onChange={(e) => setRecurrence((prev) => ({ ...prev, count: Number(e.target.value) }))}
                  />
                </label>
              )}
            </>
          )}
        </div>
      )}

      {error && <ModalFieldError error={error} />}

      <ModalEditFooter
        lang={lang}
        hideDelete={isNew}
        onDelete={handleDeleteClick}
        onCancel={onClose}
        saveLabelKey="calendarEventSave"
      />
    </EditModalShell>
  );
}
