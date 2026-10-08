import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ActivityLogPanel } from "./activity-log-panel";
import { DisplayTimezoneProvider } from "./display-timezone-context";
import { loadI18n, t, tPlural } from "./i18n";
import type { ActivityEntry } from "./activity-log";

// §5 activity log (owner decision 2026-10-08, after the probe measured the full
// log at +733 ms to open and +632 ms per search keystroke): the board's cap. The
// table renders at most ACTIVITY_LOG_PAGE rows of the filtered, sorted list, then
// a "Show more" button; printing renders every row.

const entriesOf = (n: number, label = "Task"): ActivityEntry[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `e${i}`,
    // Newest first under the default sort (timestamp, descending).
    timestamp: new Date(Date.UTC(2026, 5, 1) - i * 60_000).toISOString(),
    kind: "task.updated",
    args: [`${label} ${i}`],
  })) as ActivityEntry[];

function panel(entries: ActivityEntry[]) {
  return render(
    <DisplayTimezoneProvider effectiveTz="UTC">
      <ActivityLogPanel lang="en-US" entries={entries} onClear={() => {}} />
    </DisplayTimezoneProvider>,
  );
}

const rows = () => document.querySelectorAll("tbody tr");
const more = () => screen.queryByTestId("activity-show-more");

describe("ActivityLogPanel row cap (§5)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders every row and no button at exactly one page", () => {
    panel(entriesOf(100));
    expect(rows()).toHaveLength(100);
    expect(more()).toBeNull();
  });

  it("caps the table and names the hidden count", () => {
    panel(entriesOf(101));
    expect(rows()).toHaveLength(100);
    expect(more()).toHaveAccessibleName("Show 1 more (1 hidden)");
  });

  it("offers at most one page per click when more than a page is hidden", () => {
    panel(entriesOf(250));
    expect(more()).toHaveAccessibleName("Show 100 more (150 hidden)");
  });

  it("keeps the true total in the header count", () => {
    panel(entriesOf(250));
    expect(screen.getByText(tPlural("en-US", "activityEntriesLogged", 250, 250))).toBeInTheDocument();
  });

  it("each click shows up to one more page, and the last removes the button", () => {
    panel(entriesOf(250));
    fireEvent.click(more()!);
    expect(rows()).toHaveLength(200);
    expect(more()).toHaveAccessibleName("Show 50 more (50 hidden)");
    fireEvent.click(more()!);
    expect(rows()).toHaveLength(250);
    expect(more()).toBeNull();
  });

  it("moves focus to the first newly revealed row", () => {
    panel(entriesOf(150));
    const button = more()!;
    button.focus();
    fireEvent.click(button);
    expect(document.activeElement).toBe(rows()[100]);
  });

  it("caps the filtered list, so a search narrowing below a page shows every match", () => {
    panel([...entriesOf(150, "Alpha"), ...entriesOf(30, "Beta").map((e) => ({ ...e, id: `b-${e.id}` }))]);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Beta" } });
    expect(rows()).toHaveLength(30);
    expect(more()).toBeNull();
  });

  it("printing renders every row", () => {
    const listeners = new Set<() => void>();
    const printMql = {
      matches: false,
      addEventListener: (_type: string, l: () => void) => listeners.add(l),
      removeEventListener: (_type: string, l: () => void) => listeners.delete(l),
    };
    const otherMql = { matches: false, addEventListener: () => {}, removeEventListener: () => {} };
    vi.stubGlobal("matchMedia", (q: string) => (q === "print" ? printMql : otherMql));
    panel(entriesOf(250));
    expect(rows()).toHaveLength(100);
    printMql.matches = true;
    act(() => listeners.forEach((l) => l()));
    expect(rows()).toHaveLength(250);
    expect(more()).toBeNull();
  });

  describe("German", () => {
    beforeAll(async () => {
      await loadI18n("de");
    });

    it("names the button in German", () => {
      render(
        <DisplayTimezoneProvider effectiveTz="UTC">
          <ActivityLogPanel lang="de" entries={entriesOf(101)} onClear={() => {}} />
        </DisplayTimezoneProvider>,
      );
      const name = t("de", "activityShowMore", 1, 1);
      expect(name).not.toBe(t("en-US", "activityShowMore", 1, 1));
      expect(more()).toHaveAccessibleName(name);
    });
  });
});
