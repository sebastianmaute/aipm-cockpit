import { it, expect, describe } from "vitest";
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
