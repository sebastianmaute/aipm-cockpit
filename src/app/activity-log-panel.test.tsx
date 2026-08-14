import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActivityLogPanel } from "./activity-log-panel";
import { ConfirmProvider } from "./confirm-dialog";
import { DisplayTimezoneProvider } from "./display-timezone-context";
import { t } from "./i18n";
import { expectButtonOrder } from "../test/toolbar-order";
import type { ActivityEntry } from "./activity-log";

// Synchronous rAF so the confirm dialog's Modal focus-management effect runs
// immediately (the branded confirm is built on the shared Modal).
beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

// All panel renders go through the provider — the panel reads useDisplayTimezone().
// A non-UTC zone (Asia/Kolkata, +5:30) makes the zone conversion observable.
function renderPanel(ui: React.ReactNode) {
  return render(<DisplayTimezoneProvider effectiveTz="Asia/Kolkata">{ui}</DisplayTimezoneProvider>);
}

function entry(p: Partial<ActivityEntry>): ActivityEntry {
  return {
    id: "1",
    timestamp: "2026-05-28T10:00:00.000Z",
    kind: "task.created",
    args: ["Task A"],
    ...p,
  } as ActivityEntry;
}

const entries: ActivityEntry[] = [
  entry({ id: "1", kind: "task.created", args: ["Task A"] }),
  entry({ id: "2", kind: "task.updated", args: ["Task B"] }),
];

describe("ActivityLogPanel — toolbar order", () => {
  // Clear log leads; Print · reset-columns · reset-size stay one trailing
  // group. Clear used to sit after the resets, splitting them from Print.
  // (expectButtonOrder throws on a missing OR duplicated control, so a deleted
  // button can't degrade this into a vacuous comparison — see src/test.)
  it("puts Clear log ahead of the Print / reset group", () => {
    renderPanel(<ActivityLogPanel lang="en-US" entries={entries} onClear={() => {}} />);
    // Clear only has to LEAD; the trailing group must be adjacent.
    expectButtonOrder(["activityClear", "printHint"]);
    expectButtonOrder(["printHint", "colResetWidthsHint", "tableResetSizeHint"], { contiguous: true });
  });
});

describe("ActivityLogPanel", () => {
  it("renders the per-field change diff under an update entry (#22)", () => {
    renderPanel(
      <ActivityLogPanel
        lang="en-US"
        entries={[
          entry({
            id: "9",
            kind: "raid.updated",
            args: [5, "R", "Risk"],
            changes: [
              { field: "status", from: "Open", to: "Closed" },
              { field: "targetDate", from: "", to: "2026-08-01" },
            ],
          }),
        ]}
        onClear={() => {}}
      />,
    );
    // Field key humanized, from → to rendered; empty "from" shows an em dash.
    expect(screen.getByText("status")).toBeInTheDocument();
    expect(screen.getByText("Closed")).toBeInTheDocument();
    expect(screen.getByText("target date")).toBeInTheDocument();
    expect(screen.getByText("2026-08-01")).toBeInTheDocument();
  });

  it("renders timestamps in the display timezone (not the raw ISO)", () => {
    // 2026-05-28T10:00:00Z in Asia/Kolkata (+5:30) is 15:30 → "03:30 PM".
    renderPanel(<ActivityLogPanel lang="en-US" entries={[entry({ id: "1" })]} onClear={() => {}} />);
    const time = screen.getByText(/05\/28\/2026/);
    expect(time.textContent).toContain("03:30");
    expect(time.textContent).not.toContain("2026-05-28T10:00:00.000Z");
  });

  it("marks the pane as a print-root for scoped printing", () => {
    const { container } = renderPanel(
      <ActivityLogPanel lang="en-US" entries={entries} onClear={() => {}} />,
    );
    expect((container.firstElementChild as HTMLElement).className).toContain("print-root");
    // Activity Log prints portrait — it must NOT opt into the reports' landscape page.
    expect((container.firstElementChild as HTMLElement).className).not.toContain("print-landscape");
  });

  it("renders a print button in the header", () => {
    renderPanel(<ActivityLogPanel lang="en-US" entries={entries} onClear={() => {}} />);
    expect(screen.getByRole("button", { name: /print/i })).toBeInTheDocument();
  });

  it("wraps header controls in a print:hidden container so they are hidden when printing", () => {
    const { container } = renderPanel(
      <ActivityLogPanel lang="en-US" entries={entries} onClear={() => {}} />,
    );
    // Tailwind encodes print:hidden as the class string "print:hidden".
    const allDivs = Array.from(container.querySelectorAll("div, header > div"));
    const hiddenContainers = allDivs.filter((el) =>
      el.className.includes("print:hidden"),
    );
    expect(hiddenContainers.length).toBeGreaterThanOrEqual(2);
  });

  it("does NOT mark the log table inside a print:hidden container", () => {
    const { container } = renderPanel(
      <ActivityLogPanel lang="en-US" entries={entries} onClear={() => {}} />,
    );
    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    // Walk up from table — none of the ancestors up to print-root should be print:hidden.
    let el: HTMLElement | null = table as HTMLElement;
    while (el && !el.className.includes("print-root")) {
      expect(el.className).not.toContain("print:hidden");
      el = el.parentElement;
    }
  });

  // Regression guard: the Clear button routes through the branded ConfirmProvider
  // (not the removed hook-level confirm), so onClear fires ONLY after the user
  // confirms in the dialog. Rendered through a REAL provider — a mocked confirm
  // would hide a provider-placement bug.
  it("clears the log only after confirming in the branded dialog", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    render(
      <ConfirmProvider lang="en-US">
        <DisplayTimezoneProvider effectiveTz="Asia/Kolkata">
          <ActivityLogPanel lang="en-US" entries={entries} onClear={onClear} />
        </DisplayTimezoneProvider>
      </ConfirmProvider>,
    );
    await user.click(screen.getByRole("button", { name: t("en-US", "activityClear") }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onClear).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: t("en-US", "confirm") }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("does not clear when the confirm dialog is cancelled", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    render(
      <ConfirmProvider lang="en-US">
        <DisplayTimezoneProvider effectiveTz="Asia/Kolkata">
          <ActivityLogPanel lang="en-US" entries={entries} onClear={onClear} />
        </DisplayTimezoneProvider>
      </ConfirmProvider>,
    );
    await user.click(screen.getByRole("button", { name: t("en-US", "activityClear") }));
    await user.click(screen.getByRole("button", { name: t("en-US", "cancel") }));
    expect(onClear).not.toHaveBeenCalled();
  });

  // The field is queried by ROLE, not by label: the search-mode SegmentedControl
  // beside it carries the SAME `activitySearchPlaceholder` string as its group
  // aria-label, so getByLabelText matches two elements here.
  it("clears the search box from a labelled button", async () => {
    const user = userEvent.setup();
    renderPanel(<ActivityLogPanel lang="en-US" entries={entries} onClear={() => {}} />);
    const field = screen.getByRole("searchbox", {
      name: t("en-US", "activitySearchPlaceholder"),
    }) as HTMLInputElement;
    await user.type(field, "jira");
    expect(field.value).toBe("jira");
    await user.click(
      screen.getByRole("button", {
        name: `${t("en-US", "clear")} – ${t("en-US", "activitySearchPlaceholder")}`,
      }),
    );
    expect(field.value).toBe("");
  });
});
