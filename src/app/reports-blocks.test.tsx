import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import {
  ByPriorityBlock,
  CompletionOutcomesBlock,
  GroupHealthBlock,
  InquiriesBlock,
  OpenByStatusBlock,
  StatsBlock,
  type GroupHealthRow,
} from "./reports-blocks";
import { t } from "./i18n";
import type { HealthDriver } from "./health";
import type { TranslationKey } from "./i18n";

/**
 * ★★★ WHY THIS FILE EXISTS, given `reports.test.tsx` already renders the whole
 * panel. It does not pin the headline tile VALUES. Measured during the Task 11
 * extraction, not assumed: swapping `StatsBlock`'s Total tile to render `open`
 * instead of `total` left `reports.test.tsx` at **32 passed, exit 0**. The panel
 * suite asserts that the cancelled-count SUB sits in the Total tile, and the
 * headings, and the tables — never which number each tile shows.
 *
 * ★★ That gap PRE-DATES the extraction; the move did not cause it, it made it
 * visible and cheap to close, because these bodies are now standalone
 * presentational components. The tests below pin the value BINDINGS — which
 * datum reaches which tile — which is exactly the class of defect a copy-paste
 * of nine near-identical `<Tile>` blocks invites.
 *
 * ★ Deliberately NOT re-testing what `reports.test.tsx` already covers: the
 * table bodies, sorting, filtering and column resizing all belong to
 * `reports-tables.tsx` and are exercised through the panel.
 */

const KEYS = {
  total: t("en-US", "reportsTotal"),
  open: t("en-US", "reportsOpen"),
  completed: t("en-US", "reportsCompleted"),
  overdue: t("en-US", "reportsOverdue"),
};

/** The tile whose label is `label`, so a value assertion cannot match a
 *  neighbour's number. ★ Each `Tile` renders its label and value in one box;
 *  walking up from the label is what scopes the value to that tile. */
function tileFor(label: string): HTMLElement {
  const el = screen.getByText(label);
  return el.closest("div")!.parentElement!;
}

describe("StatsBlock — which datum reaches which tile", () => {
  it("renders each of the four figures in its OWN tile", () => {
    // ★★ The four values are deliberately DISTINCT primes-ish numbers. Equal
    // values would let a swapped binding pass: with total===open, rendering
    // `open` under the Total label is indistinguishable from correct.
    render(<StatsBlock lang="en-US" total={11} cancelled={0} open={7} completed={3} overdue={5} />);
    expect(within(tileFor(KEYS.total)).getByText("11")).toBeInTheDocument();
    expect(within(tileFor(KEYS.open)).getByText("7")).toBeInTheDocument();
    expect(within(tileFor(KEYS.completed)).getByText("3")).toBeInTheDocument();
    expect(within(tileFor(KEYS.overdue)).getByText("5")).toBeInTheDocument();
  });

  it("shows the cancelled sub only when there is a cancellation", () => {
    const { unmount } = render(
      <StatsBlock lang="en-US" total={11} cancelled={0} open={7} completed={3} overdue={5} />,
    );
    expect(screen.queryByText(t("en-US", "reportsCancelledCount", "0"))).toBeNull();
    unmount();

    render(<StatsBlock lang="en-US" total={11} cancelled={2} open={7} completed={3} overdue={5} />);
    const sub = screen.getByText(t("en-US", "reportsCancelledCount", "2"));
    // ★ In the TOTAL tile specifically — `reports.test.tsx` makes the same point
    // about the panel, and it is the reason the sub exists at all: Total is the
    // figure that stops reconciling with Open + Completed.
    expect(sub.parentElement?.textContent).toContain(KEYS.total);
  });
});

describe("OpenByStatusBlock and CompletionOutcomesBlock", () => {
  it("maps each open-status count to its own labelled segment", () => {
    // ★★ `StackedBar` renders each legend entry as `<li>{label}: <span>{n}</span>`,
    // so the label and its number are SEPARATE text nodes and `getByText(label)`
    // finds nothing. Read the list items' `textContent` instead — that is also
    // what pins the label-to-value PAIRING, which is the binding worth testing.
    render(
      <OpenByStatusBlock lang="en-US" openByStatus={{ red: 2, yellow: 3, green: 4 }} open={9} />,
    );
    const legend = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(legend).toContain(`${t("en-US", "alertCatOverdue")}: 2`);
    expect(legend).toContain(`${t("en-US", "reportsDueSoon")}: 3`);
    expect(legend).toContain(`${t("en-US", "reportsOnTrack")}: 4`);
  });

  it("shows the empty state when nothing has completed, and the bar when something has", () => {
    // ★★ The guard is on the SUM, so 0 + 0 is the only empty case. A block that
    // tested `completedOnTime === 0` alone would render an empty bar for a
    // project whose completions were all late — this seeds exactly that.
    const { unmount } = render(
      <CompletionOutcomesBlock lang="en-US" completedOnTime={0} completedLate={0} />,
    );
    expect(screen.getByText(t("en-US", "reportsNoCompletions"))).toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    unmount();

    render(<CompletionOutcomesBlock lang="en-US" completedOnTime={0} completedLate={4} />);
    expect(screen.queryByText(t("en-US", "reportsNoCompletions"))).toBeNull();
    expect(screen.getAllByRole("listitem").map((li) => li.textContent))
      .toContain(`${t("en-US", "reportsCompletedLate")}: 4`);
  });
});

describe("InquiriesBlock", () => {
  const rows = [
    { id: 7, taskName: "Alpha", inquiriesSent: 3 },
    { id: 9, taskName: "Beta", inquiriesSent: 1 },
  ];

  it("puts each figure in its own tile and formats the average to one decimal", () => {
    render(
      <InquiriesBlock
        lang="en-US"
        inquiriesTotal={4}
        inquiriesAvg={1.25}
        topInquiries={rows}
        colWidths={{ id: 60, task: 200, count: 80 }}
        onStartResize={vi.fn()}
      />,
    );
    expect(within(tileFor(t("en-US", "reportsInquiriesTotal"))).getByText("4")).toBeInTheDocument();
    expect(within(tileFor(t("en-US", "reportsInquiriesAvg"))).getByText("1.3")).toBeInTheDocument();
    // ★ The third tile counts the ROWS, not the total — two different numbers
    // here (2 vs 4) so a swapped binding cannot pass.
    expect(within(tileFor(t("en-US", "reportsInquiriesTasks"))).getByText("2")).toBeInTheDocument();
  });

  it("renders the table only when there are rows", () => {
    const { unmount } = render(
      <InquiriesBlock
        lang="en-US" inquiriesTotal={0} inquiriesAvg={0} topInquiries={[]}
        colWidths={{ id: 60, task: 200, count: 80 }} onStartResize={vi.fn()}
      />,
    );
    expect(screen.queryByRole("table")).toBeNull();
    unmount();

    render(
      <InquiriesBlock
        lang="en-US" inquiriesTotal={4} inquiriesAvg={2} topInquiries={rows}
        colWidths={{ id: 60, task: 200, count: 80 }} onStartResize={vi.fn()}
      />,
    );
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("#7")).toBeInTheDocument();
  });
});

describe("ByPriorityBlock", () => {
  it("renders one tile per priority, each showing its own count", () => {
    // ★★ THE `?? 0` IN THE SOURCE IS UNREACHABLE THROUGH THE TYPE, and I
    // initially wrote a test claiming otherwise. `Stats["byPriority"]` is a
    // TOTAL `Record<Priority, number>` seeded with all four keys at 0, so a
    // partial object is a compile error (`TS2739`) rather than a runtime
    // fallback. The fallback stays as runtime defence against a hand-built
    // object; it is NOT pinned, and nothing here should suggest it is.
    render(<ByPriorityBlock byPriority={{ Low: 1, Medium: 2, High: 5, Urgent: 0 }} />);
    expect(within(tileFor("High")).getByText("5")).toBeInTheDocument();
    expect(within(tileFor("Low")).getByText("1")).toBeInTheDocument();
    expect(within(tileFor("Urgent")).getByText("0")).toBeInTheDocument();
  });
});

describe("GroupHealthBlock", () => {
  const driverKey: Record<HealthDriver, TranslationKey> = {
    manual: "healthDriverManual",
    overdue: "healthDriverOverdue",
    blocked: "healthDriverBlocked",
    dueToday: "healthDriverDueToday",
    dueSoon: "healthDriverDueSoon",
    completed: "healthDriverCompleted",
    closed: "healthDriverClosed",
    cancelled: "healthDriverCancelled",
    onTrack: "healthDriverOnTrack",
  };
  const row = (over: Partial<GroupHealthRow> = {}): GroupHealthRow => ({
    name: "Workstream A",
    isUngrouped: false,
    health: { color: "R", counts: { R: 1, A: 2, G: 3 }, outOfScope: 0, drivers: [] },
    ...over,
  });

  it("names each group and translates its drivers through the injected map", () => {
    render(
      <GroupHealthBlock
        lang="en-US"
        rows={[row({ health: { color: "A", counts: { R: 0, A: 1, G: 0 }, outOfScope: 0, drivers: ["overdue", "blocked"] } })]}
        driverKey={driverKey}
      />,
    );
    expect(screen.getByText("Workstream A")).toBeInTheDocument();
    const drivers = `${t("en-US", "healthDriverOverdue")}, ${t("en-US", "healthDriverBlocked")}`;
    expect(screen.getByText(drivers)).toBeInTheDocument();
  });

  it("italicises the ungrouped row and appends the out-of-scope count only when non-zero", () => {
    const { unmount } = render(
      <GroupHealthBlock lang="en-US" rows={[row({ name: "Ungrouped", isUngrouped: true })]} driverKey={driverKey} />,
    );
    // ★★ NOT `queryByText(/·/)` — I tried that and it matches against CORRECT
    // code, because `reportsGroupCounts` is itself "{0} red · {1} amber · {2}
    // green" and already contains the separator. The out-of-scope clause has to
    // be matched by its own string.
    const outOfScope = (n: string) => t("en-US", "reportsGroupOutOfScope", n);
    expect(screen.getByText("Ungrouped").className).toContain("italic");
    expect(document.body.textContent).not.toContain(outOfScope("0"));
    unmount();

    render(
      <GroupHealthBlock
        lang="en-US"
        rows={[row({ health: { color: "G", counts: { R: 0, A: 0, G: 2 }, outOfScope: 3, drivers: [] } })]}
        driverKey={driverKey}
      />,
    );
    expect(document.body.textContent).toContain(outOfScope("3"));
  });
});
