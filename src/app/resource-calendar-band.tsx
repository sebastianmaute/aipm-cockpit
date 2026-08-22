"use client";

// Meetings band — lanes of recurring-event occurrences rendered as extra
// <tbody> rows ABOVE the assignee rows, INSIDE THE SAME <table> as the
// resource-calendar grid — that shared table is what keeps the band's day
// columns aligned with the day headers and the assignee rows below it.
//
// ★★ Band cells deliberately carry `data-band-cell`, NOT `data-cell`: the
// grid's roving-tabindex model (resource-calendar.tsx onGridKeyDown) indexes
// `data-cell` by row/column and treats exactly one such element as the tab
// stop. That invariant is scoped to the DAY-CELL MATRIX, not the whole table.
// A band cell wrongly caught by the `[data-cell]` selector would be a real bug
// (it would get folded into the roving model's row/column indexing and desync
// arrow-key navigation), which is why the separation matters.
//
// ★★ The band runs its OWN roving group over `[data-band-cell]` (band-roving.ts):
// exactly one chip is a tab stop and arrow keys walk the rest. It used to leave
// every chip natively tabbable, which put ~65 tab stops ahead of the grid on a
// quarter-wide window with one daily series. Two roving groups in one table
// (band + day-cell matrix) is a deliberate deviation from a strict
// single-tab-stop grid — see band-roving.ts's header for why folding the band
// into the matrix is worse. Row-header edit buttons remain ordinary tab stops,
// as they were long before the band existed.

import { useEffect, useMemo, useRef, useState } from "react";
import { ExclamationTriangleIcon } from "./icons";
import { type Lang, t } from "./i18n";
import { CalendarChip } from "./calendar-chip";
import type { CalendarEvent } from "./calendar-event";
import type { Occurrence } from "./recurrence";
import { resolveOccurrenceDrag } from "./occurrence-drag";
import { addIsoDays } from "./calendar-window";
import { moveBandFocus } from "./band-roving";
import { CELL_PX, ASSIGNEE_COL_PX, type CalendarDay } from "./resource-calendar-shared";

/** The gesture currently in flight — id, the grabbed chip's RENDERED date,
 *  AND its `originalDate` (rule-produced date). A ref (not state) so the
 *  drop handler reads it synchronously, mirroring resource-calendar-rows.tsx's
 *  dragRef for absences.
 *
 *  ★★ Neither eventId alone NOR (eventId, rendered date) can identify which
 *  occurrence was grabbed. Every occurrence of a recurring series shares the
 *  same eventId (a daily standup viewed over a week is one id, seven
 *  Occurrence objects) — that was the first bug. And a MOVED occurrence can
 *  render on a date a sibling occurrence of the SAME series already
 *  naturally occupies, so two occurrences can share both eventId and
 *  rendered date too — that was the narrower, second bug. `originalDate`
 *  (the rule-produced date) is unique per occurrence within a series by
 *  construction, so `(eventId, originalDate)` is what actually disambiguates
 *  — see occurrence-drag.ts's own doc comment for both bugs in detail. */
type DraggedOccurrence = {
  eventId: number;
  originDate: string;
  originalDate: string;
  /** The source chip's `lane-iso` key — the chip that will unmount on a
   *  committing drop, which is the only one whose focus restore should be
   *  suppressed. */
  originKey: string;
} | null;

/** Band rows are shorter than the assignee rows (CELL_PX) — a chip needs
 *  less vertical room than an absence cell's centered glyph. */
const BAND_ROW_PX = 22;

interface Props {
  lang: Lang;
  /** One lane per rendered <tr>, from packOccurrenceLanes — already windowed
   *  and sorted by the orchestrator. */
  lanes: readonly (readonly Occurrence[])[];
  days: readonly CalendarDay[];
  eventsById: ReadonlyMap<number, CalendarEvent>;
  onEditEvent: (event: CalendarEvent) => void;
  /** Reschedule an occurrence to a different date, by drag OR by the keyboard
   *  gesture below. Omit to make the band read-only (mirrors onMoveAbsence's
   *  popout convention) — with no handler, Alt+Arrow is left to the browser. */
  onMoveOccurrence?: (occurrence: Occurrence, toDate: string) => void;
  /** Reports the keyboard move gesture's state so the PARENT can announce it.
   *  The announcement cannot live here: this component renders a `<tbody>`,
   *  and a live region has to be an element the grid's row/cell structure does
   *  not have to accommodate — resource-calendar.tsx already owns one for the
   *  day grid's identical gesture, so this folds into it. */
  onMoveModeChange?: (mode: "armed" | "cancelled" | null) => void;
  /** True when the orchestrator's expansion hit its own iteration cap before
   *  covering the window (recurrence.ts's `ExpansionResult.truncated`,
   *  propagated by the caller) — reachable for a series whose `startDate` is
   *  far in the past. Must be surfaced: an empty band with no signal reads
   *  exactly like "no meetings", which may not be true — the search may
   *  simply have given up before reaching this window. */
  truncated?: boolean;
}

/** Pure presentational — all data and handlers come in as props, matching
 *  the CalendarRows / gantt-chrome split convention. Renders nothing when
 *  there are no lanes AND nothing was truncated, so a calendar with no
 *  events adds no empty band row — but a truncated search still renders a
 *  warning row even with zero lanes, precisely so "empty" and "truncated"
 *  never look identical. */
export function CalendarBand({ lang, lanes, days, eventsById, onEditEvent, onMoveOccurrence, onMoveModeChange, truncated }: Props) {
  const dragRef = useRef<DraggedOccurrence>(null);
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const [focusChip, setFocusChip] = useState(0);

  /** A keyboard move in flight: which occurrence, and how many days the
   *  preview has walked. Identified by `(eventId, originalDate)` — the same
   *  identity the drag path uses, and for the same reason (occurrence-drag.ts):
   *  every occurrence of a series shares an eventId, and a moved one can land
   *  on a date a sibling already occupies, so neither key alone is unique.
   *
   *  Committing only on Enter is deliberate, mirroring the day grid: ONE undo
   *  entry per intent, not one per arrow press. */
  const [pendingMove, setPendingMove] = useState<
    { eventId: number; originalDate: string; originDate: string; dayDelta: number } | null
  >(null);

  // Chips in RENDER order (lane-major, then ascending date, because `days` is
  // ascending) — the order band-roving.ts's arithmetic assumes. Keyed by
  // `lane-iso` so a chip can look up its own index without a scan.
  //
  // ★★ The condition here MUST be the same one the renderer uses below
  // (`occ && event`), hence the `eventsById` lookup and dep. If the index
  // counted a chip the renderer skips, `focusIndex` could point at a phantom
  // and NO rendered chip would get `tabIndex={0}` — a band unreachable by
  // keyboard entirely, strictly worse than the per-chip tab stops this
  // replaced. `lanes` and `eventsById` happen to derive from the same
  // `calendarEvents` today, but they arrive as INDEPENDENT props, so the
  // coupling has to be enforced here rather than assumed.
  const { chips, indexByKey, labelByKey } = useMemo(() => {
    const refs: { lane: number; iso: string }[] = [];
    const map = new Map<string, number>();
    // Base names, plus how many chips share each one. Title + date + time is
    // unique for almost every band, but two series with the same title at the
    // same slot — or one series landing twice on a date via a move exception —
    // announce identically without a discriminator (WCAG 2.4.6).
    const bases: { key: string; base: string; occ: Occurrence }[] = [];
    const baseCount = new Map<string, number>();
    lanes.forEach((lane, laneIndex) => {
      const byDate = new Map(lane.map((o) => [o.date, o] as const));
      days.forEach((d) => {
        // Deliberately the SAME expression the renderer evaluates, not an
        // equivalent one: `has()` and a truthy `get()` agree for every map the
        // type permits, but they are two different questions, and this pair
        // going out of step is what makes the band keyboard-unreachable.
        const occ = byDate.get(d.iso);
        const event = occ ? eventsById.get(occ.eventId) : undefined;
        if (!occ || !event) return;
        const key = `${laneIndex}-${d.iso}`;
        map.set(key, refs.length);
        refs.push({ lane: laneIndex, iso: d.iso });
        const base = `${event.title} – ${occ.date} ${occ.time}${occ.isMoved ? ` (${t(lang, "calendarOccurrenceMoved")})` : ""}`;
        bases.push({ key, base, occ });
        baseCount.set(base, (baseCount.get(base) ?? 0) + 1);
      });
    });

    // Two-stage, so the common case stays clean: only a colliding name earns a
    // discriminator, and only a name still colliding after the event id earns
    // the second one. The pair (eventId, originalDate) IS an occurrence's
    // identity — see occurrence-drag.ts — so stage two always separates them.
    const withId = bases.map((b) => ({
      ...b,
      name: (baseCount.get(b.base) ?? 0) > 1 ? `${b.base} (#${b.occ.eventId})` : b.base,
    }));
    const idCount = new Map<string, number>();
    for (const b of withId) idCount.set(b.name, (idCount.get(b.name) ?? 0) + 1);
    const labels = new Map<string, string>();
    for (const b of withId) {
      labels.set(b.key, (idCount.get(b.name) ?? 0) > 1 ? `${b.name} ${b.occ.originalDate}` : b.name);
    }
    return { chips: refs, indexByKey: map, labelByKey: labels };
  }, [lanes, days, eventsById, lang]);

  // Clamped on READ, exactly like the day grid's focusRow/focusCol: navigating
  // to a window with fewer chips must not strand the marker past the end,
  // which would leave NO chip tab-reachable.
  const focusIndex = chips.length > 0 ? Math.min(focusChip, chips.length - 1) : 0;

  // The chip that last held focus, by its `lane-iso` key. Never cleared — the
  // restore below is gated on that chip having DISAPPEARED, which is a
  // narrower and more reliable signal than trying to track focus leaving the
  // band (removing a focused node does not reliably fire blur, and a click on
  // dead space blurs with no relatedTarget to test).
  const lastFocusedKeyRef = useRef<string | null>(null);

  /** The `lane-iso` key of the chip a committing DROP just moved, so the
   *  focus-restore effect can tell a MOUSE drag apart from a keyboard
   *  reschedule — see that effect.
   *
   *  ★★ A KEY, not a boolean. A boolean says "a drag happened", which is not
   *  the question: the effect suppresses on behalf of the chip that VANISHED,
   *  and a drag re-packs lanes, so an unrelated chip can vanish in the same
   *  render. Dragging a one-off meeting out of a two-lane band collapses it to
   *  one lane and renames a keyboard user's focused chip from `1-<date>` to
   *  `0-<date>` — with a boolean the effect saw "dragged" and dropped THEM to
   *  `<body>`, which is the bug it exists to prevent, in its third distinct
   *  form. Comparing keys suppresses only the chip the mouse actually moved. */
  const justDraggedKeyRef = useRef<string | null>(null);

  // A reschedule or an edit that relocates an occurrence unmounts the focused
  // chip, and focus falls to <body> — a keyboard user is dropped out of the
  // band with no cue where they were. Put them back on the nearest surviving
  // chip.
  //
  // ★ Side effect only (a .focus() call), never setState — `set-state-in-effect`
  // is fatal here. ★ Both guards matter: `activeElement === body` means nothing
  // else has claimed focus (so this can never yank a user out of a control they
  // moved to), and the vanished-key check means a band re-render for any other
  // reason does not reach in and take focus.
  // ★ Restoring is for the KEYBOARD. A mouse drag also focuses the chip on
  // mousedown and unmounts it on drop, which looks identical to this effect —
  // but a mouse user did not ask for focus and gets an unexplained ring on a
  // neighbouring meeting. `justDraggedRef` is set by the drop handler and
  // consumed here, so the drag path skips the restore entirely.
  useEffect(() => {
    // ★★ CONSUME THE FLAG FIRST, before any early return. The set-site keys on
    // the DRAGGED chip but this effect keys on the LAST-FOCUSED one, and they
    // are frequently not the same chip — a mouse-only user has never focused
    // one at all (`lastFocusedKeyRef` is null), and Safari does not focus a
    // <button> on mousedown, so a drag never records one there either. With the
    // check below the early return, those cases left the flag set FOREVER, and
    // the user's first keyboard reschedule then had its focus restore silently
    // eaten — the very bug this effect exists to prevent, reintroduced by the
    // thing meant to refine it. Reading it unconditionally makes the flag mean
    // "the render I am reacting to came from a drag", which is all it ever
    // should have meant.
    const draggedKey = justDraggedKeyRef.current;
    justDraggedKeyRef.current = null;

    const key = lastFocusedKeyRef.current;
    if (key === null || indexByKey.has(key)) return;
    // Suppress ONLY when the chip that vanished is the one the mouse moved.
    // A drag re-packs lanes, so somebody else's chip can vanish in the same
    // render — and they still deserve their focus back.
    if (draggedKey === key) {
      lastFocusedKeyRef.current = null;
      return;
    }
    if (document.activeElement !== document.body) return;
    const target = chips[focusIndex];
    if (!target) return;
    bodyRef.current
      ?.querySelector<HTMLButtonElement>(`[data-band-cell="${target.lane}-${target.iso}"]`)
      // ★ preventScroll: the table sits in an `overflow-auto` scroller, so
      // focusing without it can yank the viewport sideways after a drop.
      ?.focus({ preventScroll: true });
  }, [chips, indexByKey, focusIndex]);

  /** The occurrence a chip key refers to, or undefined if it is gone. */
  function occurrenceAt(key: string): Occurrence | undefined {
    const idx = indexByKey.get(key);
    if (idx === undefined) return undefined;
    const ref = chips[idx];
    return lanes[ref.lane]?.find((o) => o.date === ref.iso);
  }

  function onBandKeyDown(e: React.KeyboardEvent<HTMLTableSectionElement>) {
    // ★★ Any keyboard interaction disarms the drag marker. The focus-restore
    // effect consumes it, but the effect only runs when `chips` changes — and a
    // committing drop the PARENT ignores (a rejected or no-op move upstream)
    // changes nothing, so the flag would sit armed until some later render
    // consumed it and wrongly suppressed a KEYBOARD restore. That is the third
    // distinct way this flag has leaked, so close it by construction: whatever
    // a drag left behind cannot outlive the user touching the keyboard, which
    // is the only thing it is allowed to affect.
    justDraggedKeyRef.current = null;

    // Only chips rove. Without this guard the handler would also swallow keys
    // aimed at anything else that ever lands inside the band.
    const active = document.activeElement as HTMLElement | null;
    if (!active?.matches?.("[data-band-cell]")) return;

    // A keyboard move is being previewed. Enter commits it, Escape discards,
    // Alt+Left/Right walk the preview. Every other key is left ALONE (not
    // preventDefault'd) rather than falling through to the roving switch
    // below — a plain arrow must not walk the focus cursor out from under an
    // armed move, or the preview and the cursor describe different chips.
    if (pendingMove) {
      if (e.key === "Escape") {
        e.preventDefault();
        setPendingMove(null);
        onMoveModeChange?.("cancelled");
        return;
      }
      if (e.key === "Enter") {
        // ★★ An armed move belongs to ONE chip in ONE place. Focus can move
        // within the band without leaving it (arrow keys, a click), and the
        // occurrence itself can be rescheduled underneath the gesture by another
        // path — the drag handler, the editor, an undo. So revalidate BOTH:
        //   identity — else Enter on a different chip commits the armed one's
        //     move (user presses Enter expecting the editor, another meeting
        //     silently jumps);
        //   position — `originDate` is captured at arm time and is what the
        //     delta is applied to, but identity is INVARIANT under a move, so an
        //     occurrence rescheduled while armed would still match on identity
        //     and then commit from where it USED to be. A +1 gesture on a chip
        //     the user is looking at on the 5th would land it on the 2nd.
        // Anything that fails abandons the gesture and SAYS so — a silent drop
        // leaves the user not knowing the move is gone.
        const focused = occurrenceAt(active.getAttribute("data-band-cell") ?? "");
        if (
          !focused ||
          focused.eventId !== pendingMove.eventId ||
          focused.originalDate !== pendingMove.originalDate ||
          focused.date !== pendingMove.originDate
        ) {
          setPendingMove(null);
          onMoveModeChange?.("cancelled");
          // NOT preventDefault'd: the user pressed Enter on a chip, and with no
          // gesture of ours left to commit, that should do what Enter on a chip
          // always does — open the editor.
          return;
        }
        e.preventDefault();
        // Resolve through the SAME function the drop handler uses, so the two
        // paths cannot disagree about which occurrence moved or about what
        // counts as a no-op (dropped back on the date it started from).
        const result = resolveOccurrenceDrag({
          occurrences: lanes.flat(),
          eventId: pendingMove.eventId,
          originDate: pendingMove.originDate,
          originalDate: pendingMove.originalDate,
          dropDate: addIsoDays(pendingMove.originDate, pendingMove.dayDelta),
        });
        if (result && onMoveOccurrence) onMoveOccurrence(result.occurrence, result.toDate);
        setPendingMove(null);
        onMoveModeChange?.(null);
        return;
      }
      if (e.altKey && !e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        setPendingMove((p) => p && { ...p, dayDelta: p.dayDelta + (e.key === "ArrowLeft" ? -1 : 1) });
      }
      // ★ Space is CLAIMED while armed, unlike every other unhandled key. It is
      // the chip's other native activation key, so leaving it alone would open
      // the editor in the middle of a gesture the user is still composing —
      // Enter is guarded against exactly that, and Space is the same door.
      if (e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        return;
      }
      // Occurrences are single-day and sit in packing lanes with no meaning of
      // their own, so there is no row axis and no resize gesture — Alt+Up/Down
      // are ignored rather than swallowed, matching how the grid treats an axis
      // its active gesture does not use.
      return;
    }

    // Alt+Left/Right on a chip ARMS a move, seeded with that press's own delta
    // (one press both starts the gesture and previews its first step).
    // ★ Gated on onMoveOccurrence: with no handler there is nothing to commit,
    // so Alt+Left must stay browser Back — which is what band-roving.ts's
    // modifier guard preserves for the read-only case.
    if (onMoveOccurrence && e.altKey && !e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      const key = active.getAttribute("data-band-cell") ?? "";
      const occ = occurrenceAt(key);
      if (occ) {
        e.preventDefault();
        setPendingMove({
          eventId: occ.eventId,
          originalDate: occ.originalDate,
          originDate: occ.date,
          dayDelta: e.key === "ArrowLeft" ? -1 : 1,
        });
        onMoveModeChange?.("armed");
        return;
      }
    }
    // Navigate from the chip that ACTUALLY has focus, not from the `focusChip`
    // marker: the two can disagree (a click focuses a chip directly, and the
    // marker's own state update has not necessarily been committed by the time
    // the next key arrives), and navigating from a stale marker would jump the
    // user somewhere they never were. The marker exists to place the tab stop;
    // the DOM is the authority on where focus is.
    const from = indexByKey.get(active.getAttribute("data-band-cell") ?? "") ?? focusIndex;
    const next = moveBandFocus(chips, from, e.key, e);
    if (next === null) return;
    e.preventDefault();
    setFocusChip(next);
    const target = chips[next];
    bodyRef.current
      ?.querySelector<HTMLButtonElement>(`[data-band-cell="${target.lane}-${target.iso}"]`)
      ?.focus();
  }

  /** Abandon an armed move when focus leaves the band entirely.
   *
   *  ★★ This is the ROOT fix for "the gesture outlives its context": an armed
   *  move that survives the user walking away is what makes every later
   *  revalidation necessary, and it also means the day grid's own gesture can
   *  overwrite the shared live region while a band move is still committable —
   *  so Enter back on that chip would reschedule with no cue that anything was
   *  armed. Cancelling here means only ONE gesture is ever live.
   *
   *  ★ `relatedTarget === null` (focus went to the document body, a window
   *  blur, or the focused chip was removed) deliberately also cancels: none of
   *  those is a state the user can still steer the gesture from. The in-band
   *  checks in the Enter branch stay as defence for focus moving BETWEEN chips,
   *  which does not blur out of the band at all. */
  function onBandBlur(e: React.FocusEvent<HTMLTableSectionElement>) {
    if (!pendingMove) return;
    const next = e.relatedTarget as Node | null;
    if (next && bodyRef.current?.contains(next)) return;
    setPendingMove(null);
    onMoveModeChange?.("cancelled");
  }

  if (lanes.length === 0 && !truncated) return null;
  return (
    <tbody data-calendar-band ref={bodyRef} onKeyDown={onBandKeyDown} onBlur={onBandBlur}>
      {truncated && (
        <tr role="row">
          {/* A perceivable, non-colour-only note (icon + real text, not a
              hover-only title) — see the Props doc comment above for why an
              empty band alone isn't enough signal. Spans the whole table so
              it reads as one banner rather than a mysterious first column. */}
          <td
            role="gridcell"
            colSpan={1 + days.length}
            className="border-b border-r border-line bg-surface-muted px-2 py-1 text-xs font-medium text-ui-pink-strong"
          >
            <span className="inline-flex items-center gap-1">
              <ExclamationTriangleIcon aria-hidden="true" className="h-3 w-3 shrink-0" />
              {t(lang, "calendarBandTruncated")}
            </span>
          </td>
        </tr>
      )}
      {lanes.map((lane, laneIndex) => {
        // One lookup per lane per render — lanes are small (a handful of
        // concurrent meetings at most), so a Map here is not worth memoizing.
        const byDate = new Map(lane.map((o) => [o.date, o] as const));
        return (
          <tr key={laneIndex} role="row">
            <td
              role="rowheader"
              className="sticky left-0 z-10 border-b border-r border-line bg-surface-muted px-2 py-1 text-xs font-medium text-muted-foreground"
              style={{ minWidth: ASSIGNEE_COL_PX, width: ASSIGNEE_COL_PX }}
            >
              {/* Lane 0 carries the visible column label. Lanes 2+ used to be
                  a literally EMPTY rowheader — tolerable while the only way in
                  was a mouse, but arrow keys now move BETWEEN lanes, so a
                  keyboard user can land in a row that announces nothing at all
                  (WCAG 1.3.1). Every lane therefore gets a real name; the extra
                  ones are visually hidden so the column still reads as one
                  label. Lanes are packing artefacts with no identity of their
                  own, so the number is all there is to say. */}
              {laneIndex === 0 ? (
                t(lang, "calendarMeetings")
              ) : (
                <span className="sr-only">{`${t(lang, "calendarMeetings")} ${laneIndex + 1}`}</span>
              )}
            </td>
            {days.map((d) => {
              const occ = byDate.get(d.iso);
              const event = occ ? eventsById.get(occ.eventId) : undefined;
              // Built in the chips memo above, which is the only place that
              // sees every rendered chip at once and can therefore tell a
              // colliding name from a unique one.
              const label = labelByKey.get(`${laneIndex}-${d.iso}`) ?? "";
              return (
                <td
                  key={d.iso}
                  role="gridcell"
                  className="border-b border-r border-line bg-surface-muted p-0"
                  style={{ minWidth: CELL_PX, width: CELL_PX, height: BAND_ROW_PX }}
                  onDragOver={(e) => { if (onMoveOccurrence) e.preventDefault(); }}
                  onDrop={(e) => {
                    const drag = dragRef.current;
                    dragRef.current = null;
                    if (!drag || !onMoveOccurrence) return;
                    e.preventDefault();
                    // Resolve by id + originalDate (the true per-occurrence
                    // identity — see occurrence-drag.ts); originDate carries
                    // only the no-op check. Search ALL lanes (not just this
                    // one) — the dragged chip may have started in a
                    // different lane than it lands in.
                    const result = resolveOccurrenceDrag({
                      occurrences: lanes.flat(),
                      eventId: drag.eventId,
                      originDate: drag.originDate,
                      originalDate: drag.originalDate,
                      dropDate: d.iso,
                    });
                    // ★ Marked ONLY on a committing drop — the one case that
                    // actually unmounts the dragged chip. Setting it for every
                    // drop would arm it on an early return or a no-op
                    // (dropped-back-where-it-started) drop, where nothing
                    // unmounts and so nothing consumes it; the stale flag would
                    // then suppress the NEXT genuine keyboard focus-restore.
                    if (result) {
                      justDraggedKeyRef.current = drag.originKey;
                      onMoveOccurrence(result.occurrence, result.toDate);
                    }
                  }}
                  onDragEnd={() => { dragRef.current = null; }}
                >
                  {occ && event ? (
                    <CalendarChip
                      data-band-cell={`${laneIndex}-${d.iso}`}
                      // Roving: exactly one chip is in the tab order; the rest
                      // are reachable by arrow key from it.
                      tabIndex={indexByKey.get(`${laneIndex}-${d.iso}`) === focusIndex ? 0 : -1}
                      // The marker FOLLOWS focus rather than only driving it.
                      // A chip can be focused without the arrow keys — a click
                      // focuses it directly — and without this the next arrow
                      // press would navigate from wherever the marker was last
                      // left, not from the chip the user is actually on.
                      onFocus={() => {
                        const key = `${laneIndex}-${d.iso}`;
                        lastFocusedKeyRef.current = key;
                        const idx = indexByKey.get(key);
                        if (idx !== undefined) setFocusChip(idx);
                      }}
                      draggable={!!onMoveOccurrence}
                      onDragStart={(e) => {
                        // `originKey` is the SOURCE chip's `lane-iso`, captured
                        // here because only the drag start knows which lane the
                        // grab came from — the drop handler runs on the TARGET
                        // cell and its `laneIndex` is a different lane.
                        dragRef.current = {
                          eventId: occ.eventId,
                          originDate: occ.date,
                          originalDate: occ.originalDate,
                          originKey: `${laneIndex}-${d.iso}`,
                        };
                        // Firefox requires data to be set or the drag never starts.
                        e.dataTransfer.setData("text/plain", String(occ.eventId));
                      }}
                      onClick={() => onEditEvent(event)}
                      ariaLabel={label}
                      time={occ.time}
                      title={event.title}
                      moved={occ.isMoved}
                    />
                  ) : null}
                </td>
              );
            })}
          </tr>
        );
      })}
    </tbody>
  );
}
