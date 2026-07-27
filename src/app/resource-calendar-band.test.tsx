import { it, expect, describe, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { CalendarBand } from "./resource-calendar-band";
import type { CalendarEvent } from "./calendar-event";
import type { Occurrence } from "./recurrence";
import type { CalendarDay } from "./resource-calendar-shared";

it("the truncation banner cell is a gridcell, not a rowheader", () => {
  // rowheader asserts "this cell is the label for its row"; the full-width
  // banner labels nothing. The per-lane sticky first cell keeps rowheader —
  // that one genuinely does label its lane.
  const { container } = render(
    <table>
      <CalendarBand
        lang="en-US"
        lanes={[]}
        days={[{ iso: "2026-06-01", dayOfMonth: 1, weekdayLabel: "Mon", isoWeek: 23, monthLabel: "Jun", isWeekend: false, isHoliday: false, isToday: false }]}
        eventsById={new Map()}
        onEditEvent={() => {}}
        truncated
      />
    </table>,
  );
  const banner = container.querySelector("[data-calendar-band] td");
  expect(banner).not.toBeNull();
  expect(banner!.getAttribute("role")).toBe("gridcell");
});

/** jsdom fires dragStart with NO dataTransfer, so a handler calling
 *  `e.dataTransfer.setData(...)` throws inside React's dispatch. Vitest reports
 *  that as an UNHANDLED ERROR and exits 1 while still printing "passed" — a
 *  suite that looks green and fails CI. Same stub the sibling calendar suite
 *  uses; grep `dataTransfer` in resource-calendar.test.tsx. */
function makeDataTransfer() {
  return {
    data: {} as Record<string, string>,
    setData(k: string, v: string) { this.data[k] = v; },
    getData(k: string) { return this.data[k] ?? ""; },
    effectAllowed: "",
    dropEffect: "",
  };
}

describe("band chip roving", () => {
  const day = (iso: string, dayOfMonth: number): CalendarDay => ({
    iso,
    dayOfMonth,
    weekdayLabel: "Mon",
    isoWeek: 23,
    monthLabel: "Jun",
    isWeekend: false,
    isHoliday: false,
    isToday: false,
  });
  const days = [day("2026-06-01", 1), day("2026-06-02", 2), day("2026-06-03", 3)];

  const occ = (eventId: number, date: string): Occurrence => ({
    eventId,
    date,
    time: "09:00",
    durationMinutes: 30,
    originalDate: date,
    isMoved: false,
  });

  const event = (id: number, title: string): CalendarEvent => ({
    id,
    title,
    startDate: "2026-06-01",
    startTime: "09:00",
    durationMinutes: 30,
  });

  function renderBand(lanes: readonly (readonly Occurrence[])[]) {
    const eventsById = new Map([
      [1, event(1, "Standup")],
      [2, event(2, "Retro")],
    ]);
    return render(
      <table>
        <CalendarBand
          lang="en-US"
          lanes={lanes}
          days={days}
          eventsById={eventsById}
          onEditEvent={() => {}}
        />
      </table>,
    );
  }

  /** Chips in DOM order with their resolved tab-order membership. `.tabIndex`
   *  (the IDL property), never a `[tabindex="0"]` attribute match — a native
   *  <button> without the attribute is still tabbable, so an attribute query
   *  would report the pre-roving state as correct. */
  function chipStops(container: HTMLElement) {
    return Array.from(container.querySelectorAll<HTMLElement>("[data-band-cell]"))
      .map((c) => c.tabIndex);
  }

  it("exposes exactly one chip to Tab regardless of how many are rendered", () => {
    const { container } = renderBand([[occ(1, "2026-06-01"), occ(1, "2026-06-02"), occ(1, "2026-06-03")]]);
    expect(container.querySelectorAll("[data-band-cell]")).toHaveLength(3);
    expect(chipStops(container).filter((t) => t === 0)).toHaveLength(1);
  });

  it("moves focus and the tab stop to the next chip on ArrowRight", () => {
    const { container } = renderBand([[occ(1, "2026-06-01"), occ(1, "2026-06-03")]]);
    const first = container.querySelector<HTMLElement>('[data-band-cell="0-2026-06-01"]')!;
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });

    const second = container.querySelector<HTMLElement>('[data-band-cell="0-2026-06-03"]')!;
    expect(document.activeElement).toBe(second);
    // The tab stop MOVES with focus — otherwise tabbing away and back would
    // return the user to the chip they navigated away from.
    expect(second.tabIndex).toBe(0);
    expect(first.tabIndex).toBe(-1);
  });

  it("navigates from the chip that actually has focus, not from the stale marker", () => {
    // A click focuses a chip directly. If the handler navigated from the
    // roving marker instead of `document.activeElement`, the next arrow press
    // would jump from wherever the marker was last left — somewhere the user
    // never was. (The marker's own onFocus update is not necessarily committed
    // by the time the next keypress reads it, which is why the DOM is the
    // authority here.)
    const { container } = renderBand([[occ(1, "2026-06-01"), occ(1, "2026-06-02"), occ(1, "2026-06-03")]]);
    const at = (iso: string) => container.querySelector<HTMLElement>(`[data-band-cell="0-${iso}"]`)!;

    at("2026-06-01").focus();
    fireEvent.keyDown(at("2026-06-01"), { key: "ArrowRight" }); // marker -> index 1

    at("2026-06-03").focus(); // a click lands here, skipping the marker
    fireEvent.keyDown(at("2026-06-03"), { key: "ArrowLeft" });
    // From the FOCUSED chip (index 2) Left is index 1. From the marker it
    // would have been index 0.
    expect(document.activeElement).toBe(at("2026-06-02"));
  });

  it("leaves modifier chords to the browser, all the way through the component", () => {
    // band-roving.test.ts pins the pure guard, but that says nothing about the
    // WIRING: dropping the 4th argument (`moveBandFocus(chips, from, e.key)`)
    // leaves both suites green while Alt+Left is swallowed from a chip again.
    // Per-hop coverage passing while the chain is dead is the failure mode this
    // batch has already hit once.
    const { container } = renderBand([[occ(1, "2026-06-01"), occ(1, "2026-06-02")]]);
    const second = container.querySelector<HTMLElement>('[data-band-cell="0-2026-06-02"]')!;
    second.focus();

    const notPrevented = fireEvent.keyDown(second, { key: "ArrowLeft", altKey: true });
    expect(notPrevented).toBe(true); // false would mean we called preventDefault
    expect(document.activeElement).toBe(second); // Alt+Left is Back, not "move"
  });

  it("crosses lanes with ArrowDown, landing date-anchored rather than at the lane start", () => {
    const { container } = renderBand([
      [occ(1, "2026-06-01"), occ(1, "2026-06-03")],
      [occ(2, "2026-06-02"), occ(2, "2026-06-03")],
    ]);
    const start = container.querySelector<HTMLElement>('[data-band-cell="0-2026-06-03"]')!;
    start.focus();
    fireEvent.keyDown(start, { key: "ArrowDown" });
    expect(document.activeElement).toBe(
      container.querySelector('[data-band-cell="1-2026-06-03"]'),
    );
  });

  it("does not consume Enter, leaving native button activation intact", () => {
    // Asserts only that the roving model declines the event — jsdom does not
    // synthesise a click from keyDown, so activation itself is native <button>
    // behaviour and is not (and cannot be) exercised here. Swallowing Enter
    // would make every chip keyboard-dead.
    const { container } = renderBand([[occ(1, "2026-06-01"), occ(1, "2026-06-02")]]);
    const first = container.querySelector<HTMLElement>('[data-band-cell="0-2026-06-01"]')!;
    first.focus();
    const notPrevented = fireEvent.keyDown(first, { key: "Enter" });
    expect(notPrevented).toBe(true); // fireEvent returns false only when defaultPrevented
    expect(document.activeElement).toBe(first);
  });

  it("keeps a tab stop when an occurrence's event is missing from eventsById", () => {
    // The index model and the renderer must agree on what counts as a chip.
    // If the index counted this lane's occurrence (which has no event) the
    // marker could point at an index that renders nothing, leaving NO chip
    // with tabIndex 0 — a band unreachable by keyboard, strictly worse than
    // the per-chip tab stops the roving group replaced.
    //
    // ★★ The ORPHAN LANE MUST COME FIRST — this ordering is load-bearing, not
    // incidental. With the real chip first, a buggy index puts the phantom at
    // index 1 while `focusChip` is still 0, which happens to point at the real
    // chip, so a tab stop survives BY LUCK and this test passes against the
    // bug. Orphan-first puts the surviving chip at index 1 with the marker at
    // 0, so nothing gets tabIndex 0 and the assertion actually bites. Verified
    // by mutation: reverting the memo guard to `if (!occ) return;` fails this
    // test only in this order. Do not "tidy" the lanes back.
    const { container } = render(
      <table>
        <CalendarBand
          lang="en-US"
          lanes={[[occ(99, "2026-06-01")], [occ(1, "2026-06-02")]]}
          days={days}
          eventsById={new Map([[1, event(1, "Standup")]])}
          onEditEvent={() => {}}
        />
      </table>,
    );
    const rendered = container.querySelectorAll("[data-band-cell]");
    expect(rendered).toHaveLength(1); // the orphaned occurrence renders nothing
    expect(chipStops(container).filter((t) => t === 0)).toHaveLength(1);
  });

  it("names every lane's row header, not just the first", () => {
    // Arrow keys move between lanes, so a keyboard user can land in lane 2+.
    // An empty rowheader there announces nothing about where they are.
    const { container } = renderBand([
      [occ(1, "2026-06-01")],
      [occ(2, "2026-06-02")],
    ]);
    const headers = Array.from(container.querySelectorAll('[role="rowheader"]'));
    expect(headers).toHaveLength(2);
    for (const h of headers) expect(h.textContent?.trim()).not.toBe("");
  });

  describe("chip accessible names", () => {
    const names = (container: HTMLElement) =>
      Array.from(container.querySelectorAll<HTMLElement>("[data-band-cell]"))
        .map((c) => c.getAttribute("aria-label") ?? "");

    it("stays terse when nothing collides", () => {
      // Guard against fixing 2.4.6 by suffixing everything: a discriminator on
      // every chip makes every announcement noisier to solve a rare case.
      const { container } = renderBand([[occ(1, "2026-06-01"), occ(1, "2026-06-02")]]);
      for (const n of names(container)) expect(n).not.toContain("#");
    });

    it("distinguishes two different series that share a title, date and time", () => {
      // Reachable by duplicating a series. Title + date + time was the whole
      // name, so both chips announced identically (WCAG 2.4.6) and a screen
      // reader user could not tell which one they were about to open.
      const { container } = render(
        <table>
          <CalendarBand
            lang="en-US"
            lanes={[[occ(1, "2026-06-01")], [occ(2, "2026-06-01")]]}
            days={days}
            eventsById={new Map([
              [1, event(1, "Standup")],
              [2, event(2, "Standup")],
            ])}
            onEditEvent={() => {}}
          />
        </table>,
      );
      const rendered = names(container);
      expect(rendered).toHaveLength(2);
      expect(new Set(rendered).size).toBe(2);
    });

    it("distinguishes two occurrences of the SAME series landing on one date", () => {
      // The event id cannot separate these — both chips are series 1. A move
      // exception can drop an occurrence onto a date its own series already
      // occupies, which is exactly why occurrence identity is
      // (eventId, originalDate) and not (eventId, renderedDate).
      const moved: Occurrence = {
        eventId: 1,
        date: "2026-06-01",
        time: "09:00",
        durationMinutes: 30,
        originalDate: "2026-06-02",
        isMoved: false,
      };
      const { container } = render(
        <table>
          <CalendarBand
            lang="en-US"
            lanes={[[occ(1, "2026-06-01")], [moved]]}
            days={days}
            eventsById={new Map([[1, event(1, "Standup")]])}
            onEditEvent={() => {}}
          />
        </table>,
      );
      const rendered = names(container);
      expect(rendered).toHaveLength(2);
      expect(new Set(rendered).size).toBe(2);
    });
  });

  describe("focus after the focused chip unmounts", () => {
    // A reschedule (drag, or the keyboard move) and an edit that relocates an
    // occurrence both re-render the band with that chip gone. Focus then falls
    // to <body>, dropping a keyboard user out of the band with no indication
    // of where they were.
    const twoChips = () => [[occ(1, "2026-06-01"), occ(1, "2026-06-02")]];

    function rerenderWith(
      rerender: (ui: React.ReactElement) => void,
      lanes: readonly (readonly Occurrence[])[],
    ) {
      rerender(
        <table>
          <CalendarBand
            lang="en-US"
            lanes={lanes}
            days={days}
            eventsById={new Map([[1, event(1, "Standup")]])}
            onEditEvent={() => {}}
          />
        </table>,
      );
    }

    it("returns focus to a surviving chip", () => {
      const { container, rerender } = renderBand(twoChips());
      container.querySelector<HTMLElement>('[data-band-cell="0-2026-06-02"]')!.focus();
      rerenderWith(rerender, [[occ(1, "2026-06-01")]]);
      expect(document.activeElement).toBe(
        container.querySelector('[data-band-cell="0-2026-06-01"]'),
      );
    });

    it("lands on the clamped focus index, not simply the first chip", () => {
      // ★ With only one chip left, "focus chips[focusIndex]" and "focus the
      // first chip" are the same element, so the single-survivor case above
      // cannot tell them apart. Dropping a MIDDLE chip with three rendered
      // leaves the marker at index 2 and pins which one is chosen.
      const { container, rerender } = renderBand([
        [occ(1, "2026-06-01"), occ(1, "2026-06-02"), occ(1, "2026-06-03")],
      ]);
      const last = container.querySelector<HTMLElement>('[data-band-cell="0-2026-06-03"]')!;
      last.focus();
      rerenderWith(rerender, [[occ(1, "2026-06-01"), occ(1, "2026-06-02")]]);
      // Marker was 2; two chips remain, so the clamp lands on index 1 (06-02).
      expect(document.activeElement).toBe(
        container.querySelector('[data-band-cell="0-2026-06-02"]'),
      );
    });

    it("leaves focus alone when it sits on something outside the band", () => {
      // Restoring here would YANK focus out of whatever the user moved to —
      // far worse than the drop it is meant to fix.
      const { container, rerender } = renderBand(twoChips());
      container.querySelector<HTMLElement>('[data-band-cell="0-2026-06-02"]')!.focus();
      const outside = document.createElement("button");
      document.body.appendChild(outside);
      outside.focus();
      try {
        rerenderWith(rerender, [[occ(1, "2026-06-01")]]);
        expect(document.activeElement).toBe(outside);
      } finally {
        outside.remove();
      }
    });

    it("does not restore focus after a committing DRAG", () => {
      // A mouse user did not ask for focus; restoring lands a ring on whichever
      // meeting now occupies that index. Deleting either half of the drag
      // marker used to leave every suite green.
      const onMove = vi.fn();
      const { container, rerender } = render(
        <table>
          <CalendarBand
            lang="en-US"
            lanes={[[occ(1, "2026-06-01"), occ(1, "2026-06-02")]]}
            days={days}
            eventsById={new Map([[1, event(1, "Standup")]])}
            onEditEvent={() => {}}
            onMoveOccurrence={onMove}
          />
        </table>,
      );
      const chip = container.querySelector<HTMLElement>('[data-band-cell="0-2026-06-02"]')!;
      chip.focus();
      // A real drag: dragstart records the grab, drop commits it.
      fireEvent.dragStart(chip, { dataTransfer: makeDataTransfer() });
      fireEvent.drop(
        container.querySelector<HTMLElement>('[data-band-cell="0-2026-06-01"]')!,
      );
      expect(onMove).toHaveBeenCalledTimes(1);

      rerenderWith(rerender, [[occ(1, "2026-06-01")]]);
      expect(document.activeElement).toBe(document.body);
    });

    it("does not let a drag by a never-focused user eat a later keyboard restore", () => {
      // ★★ The set-site keys on the DRAGGED chip, this effect on the LAST-FOCUSED
      // one. A mouse-only user has never focused a chip (and Safari does not
      // focus a <button> on mousedown at all), so the marker used to be set and
      // never consumed — arming it indefinitely, until the user's FIRST keyboard
      // reschedule had its restore silently eaten.
      const onMove = vi.fn();
      const { container, rerender } = render(
        <table>
          <CalendarBand
            lang="en-US"
            lanes={[[occ(1, "2026-06-01"), occ(1, "2026-06-02"), occ(1, "2026-06-03")]]}
            days={days}
            eventsById={new Map([[1, event(1, "Standup")]])}
            onEditEvent={() => {}}
            onMoveOccurrence={onMove}
          />
        </table>,
      );
      // Drag WITHOUT ever focusing a chip.
      const source = container.querySelector<HTMLElement>('[data-band-cell="0-2026-06-03"]')!;
      fireEvent.dragStart(source, { dataTransfer: makeDataTransfer() });
      fireEvent.drop(container.querySelector<HTMLElement>('[data-band-cell="0-2026-06-02"]')!);
      rerenderWith(rerender, [[occ(1, "2026-06-01"), occ(1, "2026-06-02")]]);

      // NOW a keyboard user focuses a chip and it later unmounts: the restore
      // must still happen.
      const chip = container.querySelector<HTMLElement>('[data-band-cell="0-2026-06-02"]')!;
      chip.focus();
      rerenderWith(rerender, [[occ(1, "2026-06-01")]]);
      expect(document.activeElement).toBe(
        container.querySelector('[data-band-cell="0-2026-06-01"]'),
      );
    });

    it("restores after a drag the parent IGNORED, once the keyboard is used", () => {
      // ★ The residual leak in the effect-consumes-it design: the effect only
      // runs when `chips` changes, so a committing drop whose move the parent
      // rejects (or no-ops upstream) leaves the marker armed with nothing to
      // consume it — and it would then eat a later KEYBOARD restore. Any
      // keydown disarms it, which is the only window in which it may act.
      const ignoredMove = vi.fn(); // parent accepts the call, changes nothing
      const { container, rerender } = render(
        <table>
          <CalendarBand
            lang="en-US"
            lanes={[[occ(1, "2026-06-01"), occ(1, "2026-06-02")]]}
            days={days}
            eventsById={new Map([[1, event(1, "Standup")]])}
            onEditEvent={() => {}}
            onMoveOccurrence={ignoredMove}
          />
        </table>,
      );
      const source = container.querySelector<HTMLElement>('[data-band-cell="0-2026-06-02"]')!;
      fireEvent.dragStart(source, { dataTransfer: makeDataTransfer() });
      fireEvent.drop(container.querySelector<HTMLElement>('[data-band-cell="0-2026-06-01"]')!);
      expect(ignoredMove).toHaveBeenCalledTimes(1);
      // Parent ignored it: no rerender, so the effect never ran to consume it.

      // Now a keyboard user works in the band and their chip later unmounts.
      const chip = container.querySelector<HTMLElement>('[data-band-cell="0-2026-06-02"]')!;
      chip.focus();
      fireEvent.keyDown(chip, { key: "ArrowLeft" });
      rerenderWith(rerender, [[occ(1, "2026-06-01")]]);
      expect(document.activeElement).toBe(
        container.querySelector('[data-band-cell="0-2026-06-01"]'),
      );
    });

    it("restores a KEYBOARD user's focus when a mouse drag re-packs lanes under them", () => {
      // ★★ Why the marker is a KEY and not a boolean. A drag re-packs lanes, so
      // a chip belonging to someone else can vanish in the same render: drag the
      // one-off out of a two-lane band and it collapses to one lane, renaming
      // the keyboard user's focused chip from `1-<date>` to `0-<date>`. A
      // boolean marker said "a drag happened" and suppressed THEIR restore too,
      // dropping them to <body> — the bug this effect exists to prevent, in its
      // third form. Comparing keys suppresses only the chip the mouse moved.
      const onMove = vi.fn();
      const eventsById = new Map([
        [1, event(1, "One-off")],
        [2, event(2, "Standup")],
      ]);
      const twoLanes = [
        [occ(1, "2026-06-01")],
        [occ(2, "2026-06-01"), occ(2, "2026-06-02")],
      ];
      const { container, rerender } = render(
        <table>
          <CalendarBand
            lang="en-US"
            lanes={twoLanes}
            days={days}
            eventsById={eventsById}
            onEditEvent={() => {}}
            onMoveOccurrence={onMove}
          />
        </table>,
      );
      // Keyboard user is on the STANDUP chip, in lane 1.
      container.querySelector<HTMLElement>('[data-band-cell="1-2026-06-01"]')!.focus();

      // Mouse drags the unrelated one-off (lane 0) to a free date.
      fireEvent.dragStart(
        container.querySelector<HTMLElement>('[data-band-cell="0-2026-06-01"]')!,
        { dataTransfer: makeDataTransfer() },
      );
      // Drop onto lane 0's 06-03 CELL. `data-band-cell` marks rendered chips
      // only, and that date is empty in this lane — the drop handler lives on
      // the <td>, so address it positionally (td 1 is the lane's row header).
      fireEvent.drop(
        container.querySelector<HTMLElement>(
          '[data-calendar-band] tr:nth-child(1) td:nth-child(4)',
        )!,
      );
      expect(onMove).toHaveBeenCalledTimes(1);

      // Lanes collapse: the standup is now lane 0, so the keyboard user's chip
      // key vanished even though THEIR meeting did not move.
      rerender(
        <table>
          <CalendarBand
            lang="en-US"
            lanes={[[occ(2, "2026-06-01"), occ(2, "2026-06-02"), occ(1, "2026-06-03")]]}
            days={days}
            eventsById={eventsById}
            onEditEvent={() => {}}
            onMoveOccurrence={onMove}
          />
        </table>,
      );
      expect(document.activeElement).not.toBe(document.body);
    });

    it("still restores after a no-op drop, which arms nothing", () => {
      // ★ The drag marker that suppresses the restore is set ONLY on a
      // committing drop. Setting it for every drop would arm it on a drop that
      // resolves to nothing — where no chip unmounts, so nothing consumes it —
      // and the stale flag would then eat the NEXT genuine keyboard restore.
      const { container, rerender } = renderBand(twoChips());
      const chip = container.querySelector<HTMLElement>('[data-band-cell="0-2026-06-02"]')!;
      chip.focus();
      // A drop with no drag in flight: the handler early-returns.
      fireEvent.drop(chip);

      rerenderWith(rerender, [[occ(1, "2026-06-01")]]);
      expect(document.activeElement).toBe(
        container.querySelector('[data-band-cell="0-2026-06-01"]'),
      );
    });

    it("does not grab focus when the band was never focused", () => {
      const { rerender } = renderBand(twoChips());
      expect(document.activeElement).toBe(document.body);
      rerenderWith(rerender, [[occ(1, "2026-06-01")]]);
      expect(document.activeElement).toBe(document.body);
    });
  });

  describe("keyboard reschedule", () => {
    // Drag was the only way to move an occurrence (WCAG 2.1.1). This mirrors
    // the day grid's own model one row below: Alt+Arrow arms and previews,
    // Enter commits as ONE call (one undo entry per intent, not one per
    // keypress), Escape cancels.
    function renderMovable(
      onMoveOccurrence?: (o: Occurrence, to: string) => void,
      onMoveModeChange?: (m: "armed" | "cancelled" | null) => void,
    ) {
      const r = render(
        <table>
          <CalendarBand
            lang="en-US"
            lanes={[[occ(1, "2026-06-01"), occ(1, "2026-06-03")]]}
            days={days}
            eventsById={new Map([[1, event(1, "Standup")]])}
            onEditEvent={() => {}}
            onMoveOccurrence={onMoveOccurrence}
            onMoveModeChange={onMoveModeChange}
          />
        </table>,
      );
      const chip = r.container.querySelector<HTMLElement>('[data-band-cell="0-2026-06-01"]')!;
      chip.focus();
      return { ...r, chip };
    }

    it("commits an armed move once, on Enter", () => {
      const onMove = vi.fn();
      const { chip } = renderMovable(onMove);
      fireEvent.keyDown(chip, { key: "ArrowRight", altKey: true });
      expect(onMove).not.toHaveBeenCalled(); // arming previews, it does not write
      fireEvent.keyDown(chip, { key: "Enter" });
      expect(onMove).toHaveBeenCalledTimes(1);
      expect(onMove.mock.calls[0][1]).toBe("2026-06-02");
    });

    it("accumulates the preview across presses and still writes once", () => {
      const onMove = vi.fn();
      const { chip } = renderMovable(onMove);
      fireEvent.keyDown(chip, { key: "ArrowRight", altKey: true });
      fireEvent.keyDown(chip, { key: "ArrowRight", altKey: true });
      fireEvent.keyDown(chip, { key: "Enter" });
      expect(onMove).toHaveBeenCalledTimes(1);
      expect(onMove.mock.calls[0][1]).toBe("2026-06-03");
    });

    it("identifies the occurrence being moved, not merely its series", () => {
      // (eventId, originalDate) is an occurrence's identity — a series has many
      // occurrences sharing an id, so a move keyed on the id alone would
      // reschedule whichever one happened to be found first.
      const onMove = vi.fn();
      const { container } = render(
        <table>
          <CalendarBand
            lang="en-US"
            lanes={[[occ(1, "2026-06-01"), occ(1, "2026-06-03")]]}
            days={days}
            eventsById={new Map([[1, event(1, "Standup")]])}
            onEditEvent={() => {}}
            onMoveOccurrence={onMove}
          />
        </table>,
      );
      const second = container.querySelector<HTMLElement>('[data-band-cell="0-2026-06-03"]')!;
      second.focus();
      fireEvent.keyDown(second, { key: "ArrowLeft", altKey: true });
      fireEvent.keyDown(second, { key: "Enter" });
      expect(onMove).toHaveBeenCalledTimes(1);
      expect(onMove.mock.calls[0][0].originalDate).toBe("2026-06-03");
      expect(onMove.mock.calls[0][1]).toBe("2026-06-02");
    });

    it("resolves the armed occurrence by (eventId, originalDate), not by rendered date", () => {
      // ★ Every OTHER fixture in this describe uses occ(), whose originalDate
      // EQUALS its date — so they all pass even if the arming code sends
      // `occ.date` as the identity. This one has to differ, or the identity
      // claim in the code comment is untested. A move exception is exactly how
      // the two come apart: rendered 06-02, rule-produced 06-03.
      const onMove = vi.fn();
      const moved: Occurrence = {
        eventId: 1,
        date: "2026-06-02",
        time: "09:00",
        durationMinutes: 30,
        originalDate: "2026-06-03",
        isMoved: true,
      };
      const { container } = render(
        <table>
          <CalendarBand
            lang="en-US"
            lanes={[[occ(1, "2026-06-01"), moved]]}
            days={days}
            eventsById={new Map([[1, event(1, "Standup")]])}
            onEditEvent={() => {}}
            onMoveOccurrence={onMove}
          />
        </table>,
      );
      const chip = container.querySelector<HTMLElement>('[data-band-cell="0-2026-06-02"]')!;
      chip.focus();
      fireEvent.keyDown(chip, { key: "ArrowRight", altKey: true });
      fireEvent.keyDown(chip, { key: "Enter" });

      // Sending occ.date as the identity finds NO occurrence with
      // originalDate "2026-06-02", so resolveOccurrenceDrag returns null and
      // this call never happens.
      expect(onMove).toHaveBeenCalledTimes(1);
      expect(onMove.mock.calls[0][0].originalDate).toBe("2026-06-03");
      expect(onMove.mock.calls[0][0].date).toBe("2026-06-02");
      // The step is off the RENDERED date, which is where the user sees it.
      expect(onMove.mock.calls[0][1]).toBe("2026-06-03");
    });

    it("abandons an armed move when focus leaves the band", () => {
      // ★ The ROOT of the "gesture outlives its context" class. While an armed
      // move could survive the user walking away, the day grid's own gesture
      // could overwrite the shared live region and Enter back on the chip would
      // then reschedule with no cue anything was armed.
      const onMove = vi.fn();
      const onMode = vi.fn();
      const { chip } = renderMovable(onMove, onMode);
      const outside = document.createElement("button");
      document.body.appendChild(outside);
      try {
        fireEvent.keyDown(chip, { key: "ArrowRight", altKey: true });
        expect(onMode).toHaveBeenLastCalledWith("armed");

        fireEvent.blur(chip, { relatedTarget: outside });
        expect(onMode).toHaveBeenLastCalledWith("cancelled");

        chip.focus();
        fireEvent.keyDown(chip, { key: "Enter" });
        expect(onMove).not.toHaveBeenCalled();
      } finally {
        outside.remove();
      }
    });

    it("keeps the gesture alive when focus moves BETWEEN chips of the band", () => {
      // The blur guard must not fire for in-band movement, or the arrow keys
      // could never walk while armed... and more importantly a legitimate
      // gesture would die on any focus change inside the band.
      const onMode = vi.fn();
      const { container, chip } = renderMovable(vi.fn(), onMode);
      const other = container.querySelector<HTMLElement>('[data-band-cell="0-2026-06-03"]')!;
      fireEvent.keyDown(chip, { key: "ArrowRight", altKey: true });
      fireEvent.blur(chip, { relatedTarget: other });
      expect(onMode).not.toHaveBeenLastCalledWith("cancelled");
    });

    it("abandons the move if the armed occurrence was rescheduled underneath it", () => {
      // ★ Identity is INVARIANT under a move — (eventId, originalDate) survives
      // a reschedule by design — so an identity-only revalidation still passes
      // after another path (drag, editor, undo) has moved the occurrence. The
      // delta would then be applied to where it USED to be: a +1 gesture on a
      // chip the user sees on the 3rd committing it to the 2nd.
      const onMove = vi.fn();
      const onMode = vi.fn();
      const { container, rerender } = renderMovable(onMove, onMode);
      const first = container.querySelector<HTMLElement>('[data-band-cell="0-2026-06-01"]')!;
      first.focus();
      fireEvent.keyDown(first, { key: "ArrowRight", altKey: true });

      // Same occurrence (same originalDate), now rendered on a different date.
      const moved: Occurrence = {
        eventId: 1,
        date: "2026-06-02",
        time: "09:00",
        durationMinutes: 30,
        originalDate: "2026-06-01",
        isMoved: true,
      };
      rerender(
        <table>
          <CalendarBand
            lang="en-US"
            lanes={[[moved, occ(1, "2026-06-03")]]}
            days={days}
            eventsById={new Map([[1, event(1, "Standup")]])}
            onEditEvent={() => {}}
            onMoveOccurrence={onMove}
            onMoveModeChange={onMode}
          />
        </table>,
      );
      const relocated = container.querySelector<HTMLElement>('[data-band-cell="0-2026-06-02"]')!;
      relocated.focus();
      fireEvent.keyDown(relocated, { key: "Enter" });
      expect(onMove).not.toHaveBeenCalled();
      expect(onMode).toHaveBeenLastCalledWith("cancelled");
    });

    it("abandons the move, loudly, if Enter arrives on a different chip", () => {
      // ★ Nothing outside the band's own handler clears an armed move, and the
      // band is not remounted by a window navigation — so focus can leave and
      // come back onto a DIFFERENT chip with the gesture still armed. Enter
      // there used to commit the ORIGINAL chip's move: the user presses Enter
      // expecting the editor and a meeting they are not looking at is
      // rescheduled. Abandoning silently would be almost as bad, so it
      // announces.
      const onMove = vi.fn();
      const onMode = vi.fn();
      const { container } = render(
        <table>
          <CalendarBand
            lang="en-US"
            lanes={[[occ(1, "2026-06-01"), occ(1, "2026-06-03")]]}
            days={days}
            eventsById={new Map([[1, event(1, "Standup")]])}
            onEditEvent={() => {}}
            onMoveOccurrence={onMove}
            onMoveModeChange={onMode}
          />
        </table>,
      );
      const first = container.querySelector<HTMLElement>('[data-band-cell="0-2026-06-01"]')!;
      const second = container.querySelector<HTMLElement>('[data-band-cell="0-2026-06-03"]')!;

      first.focus();
      fireEvent.keyDown(first, { key: "ArrowRight", altKey: true });
      expect(onMode).toHaveBeenLastCalledWith("armed");

      second.focus(); // focus moved on while the gesture is still armed
      fireEvent.keyDown(second, { key: "Enter" });
      expect(onMove).not.toHaveBeenCalled();
      expect(onMode).toHaveBeenLastCalledWith("cancelled");

      // And the gesture really is gone — a second Enter cannot resurrect it.
      fireEvent.keyDown(second, { key: "Enter" });
      expect(onMove).not.toHaveBeenCalled();
    });

    it("abandons the move when Enter lands on a DIFFERENT series", () => {
      // ★ The sibling test above uses two occurrences of ONE series, so it pins
      // only the originalDate half of the guard — dropping the eventId
      // comparison survives it. Two series sharing a date is the routine case
      // that half exists for.
      const onMove = vi.fn();
      const onMode = vi.fn();
      const { container } = render(
        <table>
          <CalendarBand
            lang="en-US"
            lanes={[[occ(1, "2026-06-01")], [occ(2, "2026-06-01")]]}
            days={days}
            eventsById={new Map([
              [1, event(1, "Standup")],
              [2, event(2, "Retro")],
            ])}
            onEditEvent={() => {}}
            onMoveOccurrence={onMove}
            onMoveModeChange={onMode}
          />
        </table>,
      );
      const lane0 = container.querySelector<HTMLElement>('[data-band-cell="0-2026-06-01"]')!;
      const lane1 = container.querySelector<HTMLElement>('[data-band-cell="1-2026-06-01"]')!;

      lane0.focus();
      fireEvent.keyDown(lane0, { key: "ArrowRight", altKey: true });
      // Same date, same originalDate — ONLY the event id differs.
      lane1.focus();
      fireEvent.keyDown(lane1, { key: "Enter" });
      expect(onMove).not.toHaveBeenCalled();
      expect(onMode).toHaveBeenLastCalledWith("cancelled");
    });

    it("claims Space while armed, so the editor cannot open mid-gesture", () => {
      // ★ A chip is a <button>, so Space is its OTHER native activation key.
      // Enter is guarded; leaving Space alone would open the editor in the
      // middle of a gesture the user is still composing. This was the one guard
      // in the batch that shipped with no coverage.
      const onMove = vi.fn();
      const { chip } = renderMovable(onMove);
      fireEvent.keyDown(chip, { key: "ArrowRight", altKey: true });
      const prevented = fireEvent.keyDown(chip, { key: " " });
      expect(prevented).toBe(false); // false ⇒ preventDefault was called
      // The gesture is untouched and still commits on Enter.
      fireEvent.keyDown(chip, { key: "Enter" });
      expect(onMove).toHaveBeenCalledTimes(1);
    });

    it("leaves Space alone when no move is armed", () => {
      // Outside a gesture a chip must activate normally.
      const { chip } = renderMovable(vi.fn());
      const notPrevented = fireEvent.keyDown(chip, { key: " " });
      expect(notPrevented).toBe(true);
    });

    it("discards the move on Escape", () => {
      const onMove = vi.fn();
      const onMode = vi.fn();
      const { chip } = renderMovable(onMove, onMode);
      fireEvent.keyDown(chip, { key: "ArrowRight", altKey: true });
      expect(onMode).toHaveBeenLastCalledWith("armed");
      fireEvent.keyDown(chip, { key: "Escape" });
      expect(onMode).toHaveBeenLastCalledWith("cancelled");
      fireEvent.keyDown(chip, { key: "Enter" });
      expect(onMove).not.toHaveBeenCalled();
    });

    it("writes nothing when the preview lands back where it started", () => {
      // resolveOccurrenceDrag treats that as a no-op, and a no-op must not
      // produce an undo entry for a move that did not happen.
      const onMove = vi.fn();
      const { chip } = renderMovable(onMove);
      fireEvent.keyDown(chip, { key: "ArrowRight", altKey: true });
      fireEvent.keyDown(chip, { key: "ArrowLeft", altKey: true });
      fireEvent.keyDown(chip, { key: "Enter" });
      expect(onMove).not.toHaveBeenCalled();
    });

    it("suspends the roving walk while a move is armed", () => {
      // Otherwise the preview and the focus cursor drift apart and the user is
      // previewing a move on a chip they are no longer standing on.
      const { container, chip } = renderMovable(vi.fn());
      fireEvent.keyDown(chip, { key: "ArrowRight", altKey: true });
      fireEvent.keyDown(chip, { key: "ArrowRight" });
      expect(document.activeElement).toBe(chip);
      expect(container.querySelector('[data-band-cell="0-2026-06-03"]')).not.toBe(
        document.activeElement,
      );
    });

    it("stays read-only without a move handler, leaving Alt+Arrow to the browser", () => {
      // Popout mirrors pass no handler. Claiming Alt+Left there would break
      // browser Back for no reason — there is nothing to commit.
      const onMode = vi.fn();
      const { chip } = renderMovable(undefined, onMode);
      const notPrevented = fireEvent.keyDown(chip, { key: "ArrowLeft", altKey: true });
      expect(notPrevented).toBe(true);
      // ★ Not-prevented alone is weak: a mode could still have been armed and
      // announced. Assert nothing was armed, and that a following Enter is
      // therefore inert rather than committing a phantom move.
      expect(onMode).not.toHaveBeenCalled();
      const enterNotPrevented = fireEvent.keyDown(chip, { key: "Enter" });
      expect(enterNotPrevented).toBe(true);
    });
  });

  it("keeps exactly one tab stop after the window shrinks under the focus marker", () => {
    // Navigating to a window with fewer chips must not strand the marker past
    // the end — that would leave NO chip reachable by Tab at all.
    const { container, rerender } = renderBand([[occ(1, "2026-06-01"), occ(1, "2026-06-02"), occ(1, "2026-06-03")]]);
    const last = container.querySelector<HTMLElement>('[data-band-cell="0-2026-06-03"]')!;
    last.focus();
    fireEvent.keyDown(last, { key: "End" });

    rerender(
      <table>
        <CalendarBand
          lang="en-US"
          lanes={[[occ(1, "2026-06-01")]]}
          days={days}
          eventsById={new Map([[1, event(1, "Standup")]])}
          onEditEvent={() => {}}
        />
      </table>,
    );
    expect(chipStops(container).filter((t) => t === 0)).toHaveLength(1);
  });
});
