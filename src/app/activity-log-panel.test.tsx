import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActivityLogPanel } from "./activity-log-panel";
import { ConfirmProvider } from "./confirm-dialog";
import { DisplayTimezoneProvider } from "./display-timezone-context";
import { t } from "./i18n";
import { expectButtonOrder } from "../test/toolbar-order";
import { activityMessageKey, type ActivityEntry } from "./activity-log";

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

/**
 * The stored shapes the panel must survive without throwing, fed in RAW —
 * exactly as a bypassed or older `sanitizeActivityLog` would leave them. A
 * factory (not a const) so a test that sorts or filters cannot leak a mutated
 * array into the next one.
 *
 * ★ "Every stored shape" is what this said, and it was measurably FALSE at the
 * time: `timestamp` and `args` were two stored shapes the panel did NOT
 * survive, and neither was in the list. Rows `j` and `k` close that, so the
 * claim is now only as good as the non-throw test below — which is why the
 * wording is scoped to the list rather than to the universe of shapes. Adding a
 * shape to the CLAIM without adding a ROW is how it went wrong the first time.
 */
function hostileEntries(): ActivityEntry[] {
  const at = "2026-05-28T10:00:00.000Z";
  return [
    { id: "a", timestamp: at, kind: "totally.bogus", args: ["X"] },
    { id: "b", timestamp: at, args: ["Y"] },
    { id: "c", timestamp: at, kind: 42, args: ["Z"] },
    { id: "d", timestamp: at, kind: "toString", args: ["W"] },
    { id: "e", timestamp: at, kind: "task.updated", args: [], changes: "not-an-array" },
    { id: "f", timestamp: at, kind: { a: 1 }, args: [] },
    { id: "g", timestamp: at, kind: "task.updated", args: [], changes: [{ field: 7, from: "older", to: "newer" }] },
    { id: "h", timestamp: at, kind: "task.updated", args: [], changes: [null] },
    { id: "i", timestamp: at, kind: "task.updated", args: [], changes: [{ field: "status", from: { x: 1 }, to: ["y"] }] },
    { id: "j", timestamp: at, kind: "task.created", args: [{ toString: 1 }] },
    { id: "k", timestamp: { at: 1 }, kind: "task.created", args: ["Bad clock"] },
  ] as unknown as ActivityEntry[];
}

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

  // ★★★ THE ASSERTION THAT MATTERS. The activity log is shared workspace data
  // now — a hand-edited JSON file, a Turso row, or a log synced from a device
  // running a different build. `sanitizeActivityLog` is the load boundary, but
  // a throw HERE is not a blank panel: page.tsx wraps the app in the top-level
  // ErrorBoundary, so the user gets the full-screen "App crashed" page EVERY
  // time they open the Activity view, until the data is repaired by hand.
  // Each shape below was measured to throw before the fix:
  //   unknown kind + args  → "Cannot read properties of undefined (reading 'replace')"
  //   kind: 42             → "kind.startsWith is not a function"
  //   changes: "not-an-array" → "entry.changes.map is not a function"
  //   kind: {a:1}          → "Objects are not valid as a React child"
  //   changes: [{field: 7}] → "field.replace is not a function"
  //   changes: [null]      → "Cannot read properties of null (reading 'field')"
  //   changes: [{from:{}}] → "Objects are not valid as a React child"
  //   args: [{toString:1}] → "Cannot convert object to primitive value"
  //   timestamp: {}        → "a.entry.timestamp.localeCompare is not a function"
  // The panel is therefore defensive INDEPENDENTLY of the sanitizer: these
  // entries are fed in raw, exactly as a bypassed/older boundary would.
  // ★ The last FOUR were still live AFTER the first FIVE were fixed, because
  //   the coercion sat inside the MESSAGE lookup only — see `hostileEntries`
  //   below, reused by the search + sort tests that cover the other consumers.
  //   (Re-derive, do not trust: `git show c2d6949b~1:<this file>` has 5 fixture
  //   rows and 3 message rows, `git show adc1720c:<this file>` has 9 and 6. An
  //   earlier revision here said "last three / first four" — the arithmetic of
  //   a fixture it was sitting inside.)
  // ★ Two of the six pre-existing message rows describe the SAME string from
  //   DIFFERENT sites: `kind: {a:1}` throws in the kind CELL, `changes:
  //   [{from:{}}]` in the from/to CELL. The row for the latter was missing.
  it("does not throw on a hostile stored log (bad kind, timestamp, args or changes)", () => {
    expect(() =>
      renderPanel(<ActivityLogPanel lang="en-US" entries={hostileEntries()} onClear={() => {}} />),
    ).not.toThrow();
    // The coerced-cell path: a non-string `field` still renders its diff rather
    // than dropping the audit detail (7 → "7" through humanizeFieldName).
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("newer")).toBeInTheDocument();
    // Positive observable: the unknown kind is rendered, not silently blanked —
    // the raw kind stays visible so the record is still auditable.
    expect(screen.getAllByText("totally.bogus").length).toBeGreaterThan(0);
    expect(
      screen.getByText(t("en-US", "activityUnknownKind", "totally.bogus")),
    ).toBeInTheDocument();
    // `toString` is an INHERITED key on ACTIVITY_KIND_TO_KEY — a plain lookup
    // returns Function.prototype.toString and t() then throws.
    expect(screen.getByText(t("en-US", "activityUnknownKind", "toString"))).toBeInTheDocument();
  });

  // ★★ THE SEARCH MATCHER IS A SECOND CONSUMER OF `kind`, and the test above
  // cannot reach it: the default view has NO query, so `matcher` is null and the
  // filter is skipped entirely. `buildMatcher`'s literal mode calls
  // `h.toLowerCase()`, so a raw `kind: 42` threw "h.toLowerCase is not a
  // function" the moment a single character was typed — from a panel that had
  // rendered fine.
  it("does not throw when a query is typed against a non-string kind", async () => {
    const user = userEvent.setup();
    renderPanel(<ActivityLogPanel lang="en-US" entries={hostileEntries()} onClear={() => {}} />);
    // By ROLE, not by label: the search-mode SegmentedControl carries the same
    // aria-label, so getByLabelText matches two elements.
    const search = screen.getByRole("searchbox");
    await user.type(search, "bogus");
    // Positive observable: the query really ran (matching row kept, others gone).
    expect(screen.getAllByText("totally.bogus").length).toBeGreaterThan(0);
    expect(screen.queryByText(t("en-US", "activityUnknownKind", "toString"))).toBeNull();
  });

  // ★★ THE SORT COMPARATOR IS THE THIRD, and it needs ≥3 entries: with two,
  // V8's small-array sort may only ever put the STRING in the receiver position,
  // so `a.entry.kind.localeCompare(...)` never runs on the number and the test
  // passes over a live defect. Number.prototype has no localeCompare.
  it("sorts by Kind across a mix of string and numeric kinds", async () => {
    const user = userEvent.setup();
    const at = "2026-05-28T10:00:00.000Z";
    const mixed = [
      { id: "s1", timestamp: at, kind: "zeta.kind", args: [] },
      { id: "n1", timestamp: at, kind: 42, args: [] },
      { id: "s2", timestamp: at, kind: "alpha.kind", args: [] },
      { id: "n2", timestamp: at, kind: 7, args: [] },
      { id: "s3", timestamp: at, kind: "mid.kind", args: [] },
    ] as unknown as ActivityEntry[];
    renderPanel(<ActivityLogPanel lang="en-US" entries={mixed} onClear={() => {}} />);
    const kindHeader = screen
      .getAllByRole("button")
      .find((b) => b.textContent?.startsWith(t("en-US", "activityHeaderKind")));
    expect(kindHeader).toBeDefined();
    await user.click(kindHeader!);
    // Positive observable: the string kinds really are in ascending order, so
    // the comparator ran rather than being skipped.
    const rendered = screen
      .getAllByRole("row")
      .map((r) => r.textContent ?? "")
      .filter((txt) => txt.includes(".kind"));
    const order = rendered.map((txt) =>
      ["alpha.kind", "mid.kind", "zeta.kind"].find((k) => txt.includes(k)),
    );
    expect(order).toEqual(["alpha.kind", "mid.kind", "zeta.kind"]);
  });

  // ★★★ AN `args` ELEMENT IS THE ONE HOSTILE SHAPE THE LOAD BOUNDARY LETS
  // THROUGH, which is what separates it from every other row of
  // `hostileEntries`. `sanitizeActivityEntry` DROPS an entry whose `kind` or
  // `timestamp` is not a string and STRIPS a malformed `changes`, but for args
  // it checks `Array.isArray(e.args)` and never looks at the ELEMENTS — so a
  // hostile element arrives at the panel on a FULLY SANITIZED log, from every
  // backend, not merely on a bypassed boundary.
  // `t()` interpolates with `String(a)`, and `String({toString: 1})` throws
  // "Cannot convert object to primitive value": a non-callable own `toString`
  // makes ToPrimitive fall through to `Object.prototype.valueOf`, which returns
  // the object itself, so neither hint ever yields a primitive.
  // Reproduce: node -e 'try{String({toString:1})}catch(e){console.log(e.message)}'
  it("does not throw on a hostile args ELEMENT and keeps the honest args", () => {
    const key = activityMessageKey("raid.updated");
    expect(key).not.toBeNull();
    expect(() =>
      renderPanel(
        <ActivityLogPanel
          lang="en-US"
          entries={
            [
              {
                id: "j",
                timestamp: "2026-05-28T10:00:00.000Z",
                kind: "raid.updated",
                args: [5, { toString: 1 }, "Risk"],
              },
            ] as unknown as ActivityEntry[]
          }
          onClear={() => {}}
        />,
      ),
    ).not.toThrow();
    // Positive observable, and the reason a bare "did not throw" is not enough:
    // the two HONEST args still land in their placeholders and only the hostile
    // one blanks. A coercion that dropped every arg, or one that rendered
    // "[object Object]" into the audit trail, both fail this line.
    expect(screen.getByText(t("en-US", key!, 5, "", "Risk"))).toBeInTheDocument();
  });

  // ★★ `timestamp` IS THE SAME CLASS AS `kind` AND HAS THE WORST REACHABILITY
  // IN IT. The sanitizer guards both by the identical rule (`typeof !==
  // "string"` → drop the entry), but the panel coerced only `kind` — so on the
  // bypassed-boundary path a non-string timestamp threw
  // "a.entry.timestamp.localeCompare is not a function" from the SORT
  // COMPARATOR, which the DEFAULT sortKey is, on FIRST RENDER, with no
  // interaction at all. `kind` needed a click and `changes` needed a payload.
  // ≥3 entries for the same V8 reason as the kind-sort test: with two, the
  // small-array sort may only ever put the string in the receiver position.
  it("does not throw when sorting a log whose timestamp is not a string", () => {
    const mixed = [
      { id: "m1", timestamp: "2026-05-28T10:00:00.000Z", kind: "task.created", args: ["Early"] },
      { id: "m2", timestamp: 20260528, kind: "task.created", args: ["Bad one"] },
      { id: "m3", timestamp: "2026-05-30T10:00:00.000Z", kind: "task.created", args: ["Late"] },
      { id: "m4", timestamp: { at: 1 }, kind: "task.created", args: ["Bad two"] },
      { id: "m5", timestamp: "2026-05-29T10:00:00.000Z", kind: "task.created", args: ["Middle"] },
    ] as unknown as ActivityEntry[];
    expect(() =>
      renderPanel(<ActivityLogPanel lang="en-US" entries={mixed} onClear={() => {}} />),
    ).not.toThrow();
    // Positive observable: the default sort really ran (timestamp, descending),
    // so the three well-formed rows come back newest-first rather than in
    // input order — a comparator that had been skipped would give Early/Late/Middle.
    const order = screen
      .getAllByRole("row")
      .map((r) => r.textContent ?? "")
      .map((txt) => ["Early", "Late", "Middle"].find((n) => txt.includes(n)))
      .filter((n): n is string => n !== undefined);
    expect(order).toEqual(["Late", "Middle", "Early"]);
  });

  // ★ The load boundary caps `changes` at MAX_FIELD_CHANGES (12) per entry, but
  // the panel's own normalisation is what renders on the bypassed path — and it
  // dropped that cap, so a stored 10,000-element payload rendered 10,000 <li>.
  // The panel must not be the wider of the two.
  it("caps the rendered change list at the boundary's per-entry limit", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      field: `f${i}`,
      from: "old",
      to: "new",
    }));
    const { container } = renderPanel(
      <ActivityLogPanel
        lang="en-US"
        entries={[entry({ id: "cap", kind: "task.updated", args: ["T"], changes: many })]}
        onClear={() => {}}
      />,
    );
    expect(container.querySelectorAll("li")).toHaveLength(12);
    // Positive observable: it is the FIRST 12 that survive, in order — a cap
    // that kept the tail would still satisfy the count alone.
    expect(screen.getByText("f0")).toBeInTheDocument();
    expect(screen.getByText("f11")).toBeInTheDocument();
    expect(screen.queryByText("f12")).toBeNull();
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
