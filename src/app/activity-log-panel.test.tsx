import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
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

  // --- the actor column + filter (B2b) ---
  //
  // `ActivityEntry.actor` is OPTIONAL and its absence is NOT "user": every
  // entry written before this release has a genuinely unknown actor, so the
  // cell shows an em dash rather than guessing.

  it("renders the actor for each entry and a dash when it is absent", () => {
    renderPanel(
      <ActivityLogPanel
        lang="en-US"
        entries={[
          entry({ id: "a1", kind: "task.created", args: ["By AI"], actor: "ai" }),
          entry({ id: "a2", kind: "task.created", args: ["By user"], actor: "user" }),
          entry({ id: "a3", kind: "task.created", args: ["By Outlook"], actor: "integration" }),
          entry({ id: "a4", kind: "task.created", args: ["Pre-B2b"] }),
        ]}
        onClear={() => {}}
      />,
    );
    // Each label appears TWICE — once in the filter's radio, once in a cell —
    // so scope the cell assertion to the row carrying that entry's message.
    function actorCellOf(message: string): string {
      const row = screen
        .getAllByRole("row")
        .find((r) => (r.textContent ?? "").includes(message));
      expect(row).toBeDefined();
      const cells = Array.from(row!.querySelectorAll("td"));
      // timestamp · kind · actor · message
      return cells[2]?.textContent ?? "";
    }
    expect(actorCellOf("By AI")).toBe(t("en-US", "activityActorAi"));
    expect(actorCellOf("By user")).toBe(t("en-US", "activityActorUser"));
    expect(actorCellOf("By Outlook")).toBe(t("en-US", "activityActorIntegration"));
    // Absence is unknown, never a default.
    expect(actorCellOf("Pre-B2b")).toBe("—");
  });

  it("filters rows by actor", async () => {
    const user = userEvent.setup();
    renderPanel(
      <ActivityLogPanel
        lang="en-US"
        entries={[
          entry({ id: "f1", kind: "task.created", args: ["Made by AI"], actor: "ai" }),
          entry({ id: "f2", kind: "task.created", args: ["Made by hand"], actor: "user" }),
          entry({ id: "f3", kind: "task.created", args: ["Made by Outlook"], actor: "integration" }),
        ]}
        onClear={() => {}}
      />,
    );
    const group = screen.getByRole("radiogroup", { name: t("en-US", "activityHeaderActor") });
    await user.click(
      within(group).getByRole("radio", { name: t("en-US", "activityActorAi") }),
    );
    expect(screen.getByText(/Made by AI/)).toBeInTheDocument();
    expect(screen.queryByText(/Made by hand/)).toBeNull();
    expect(screen.queryByText(/Made by Outlook/)).toBeNull();
  });

  // ★★★ THE "USER" OPTION AGAINST REAL DATA, and it is a different claim from
  // the AI case above. That option was DEAD until the actor-stamping slice: no
  // production call site wrote `actor: "user"` at all, so selecting it emptied
  // the table for every project ever created. What made it live was a data-layer
  // change, and it was proved at the data layer only — nothing had rendered this
  // panel against a log containing a `"user"` row.
  //
  // ★★★ THE ACTOR-LESS ROW IS THE POINT, not decoration. `actor` is optional and
  // its absence is NOT "user": a pre-release entry, or one written by a path
  // that cannot see its cause (`task-manager`'s debounced settings logger), has
  // a genuinely unknown origin. A filter written as `e.actor !== "ai"`, or one
  // defaulting an absent actor to "user", passes every AI-filter assertion above
  // and silently attributes anonymous history to the person reading it — which
  // is worse than showing nothing, because it reads as a fact.
  it("filters to user-initiated rows, excluding the actor-less ones", async () => {
    const user = userEvent.setup();
    renderPanel(
      <ActivityLogPanel
        lang="en-US"
        entries={[
          entry({ id: "u1", kind: "task.created", args: ["Typed by hand"], actor: "user" }),
          entry({ id: "u2", kind: "task.created", args: ["Written by the AI"], actor: "ai" }),
          entry({ id: "u3", kind: "task.created", args: ["Pulled from Outlook"], actor: "integration" }),
          entry({ id: "u4", kind: "task.created", args: ["Origin unknown"] }),
        ]}
        onClear={() => {}}
      />,
    );
    // ★ CONTROL: unfiltered, all four are on screen — so the exclusions below
    //   cannot pass because a row never rendered in the first place.
    for (const msg of [/Typed by hand/, /Written by the AI/, /Pulled from Outlook/, /Origin unknown/]) {
      expect(screen.getByText(msg)).toBeInTheDocument();
    }

    const group = screen.getByRole("radiogroup", { name: t("en-US", "activityHeaderActor") });
    await user.click(
      within(group).getByRole("radio", { name: t("en-US", "activityActorUser") }),
    );

    expect(screen.getByText(/Typed by hand/)).toBeInTheDocument();
    expect(screen.queryByText(/Written by the AI/)).toBeNull();
    expect(screen.queryByText(/Pulled from Outlook/)).toBeNull();
    expect(screen.queryByText(/Origin unknown/)).toBeNull();
  });

  // ★★ The surviving row must still render as a USER row — a filter that kept
  //    the right row while the cell rendered a dash would mean the column and
  //    the filter disagree about the same entry, and only one of them can be
  //    right. Asserts the CELL, scoped to the row, since the label also appears
  //    in the filter's own radio.
  it("shows the actor cell, not a dash, on the row the User filter keeps", async () => {
    const user = userEvent.setup();
    renderPanel(
      <ActivityLogPanel
        lang="en-US"
        entries={[
          entry({ id: "u5", kind: "task.created", args: ["Typed by hand"], actor: "user" }),
          entry({ id: "u6", kind: "task.created", args: ["Origin unknown"] }),
        ]}
        onClear={() => {}}
      />,
    );
    const cellOf = (message: string) => {
      const row = screen
        .getAllByRole("row")
        .find((r) => (r.textContent ?? "").includes(message));
      expect(row, `no row for ${message}`).toBeDefined();
      // timestamp · kind · actor · message
      return Array.from(row!.querySelectorAll("td"))[2]?.textContent ?? "";
    };
    // Before filtering: the pair the filter has to tell apart.
    expect(cellOf("Typed by hand")).toBe(t("en-US", "activityActorUser"));
    expect(cellOf("Origin unknown")).toBe("—");

    await user.click(
      within(
        screen.getByRole("radiogroup", { name: t("en-US", "activityHeaderActor") }),
      ).getByRole("radio", { name: t("en-US", "activityActorUser") }),
    );
    expect(cellOf("Typed by hand")).toBe(t("en-US", "activityActorUser"));
    expect(screen.queryByText(/Origin unknown/)).toBeNull();
  });

  // ★★ The two filters must COMPOSE, not override — the memo applies them in
  // sequence. A cut that reassigned `result` from `enriched` in the second
  // clause would drop the first, and each filter alone would still look right.
  it("composes the actor filter with the group filter", async () => {
    const user = userEvent.setup();
    renderPanel(
      <ActivityLogPanel
        lang="en-US"
        entries={[
          entry({ id: "c1", kind: "task.created", args: ["AI task"], actor: "ai" }),
          entry({ id: "c2", kind: "raid.created", args: [1, "R", "AI risk"], actor: "ai" }),
          entry({ id: "c3", kind: "task.created", args: ["Human task"], actor: "user" }),
        ]}
        onClear={() => {}}
      />,
    );
    await user.click(
      within(
        screen.getByRole("radiogroup", { name: t("en-US", "activityHeaderActor") }),
      ).getByRole("radio", { name: t("en-US", "activityActorAi") }),
    );
    await user.click(
      within(
        // The group filter's radiogroup is named "Category", NOT "All" — see
        // the distinct-names test below for why that changed.
        screen.getByRole("radiogroup", { name: t("en-US", "activityGroupFilterLabel") }),
      ).getByRole("radio", { name: t("en-US", "activityFilterTasks") }),
    );
    // Only the row satisfying BOTH survives.
    expect(screen.getByText(/AI task/)).toBeInTheDocument();
    expect(screen.queryByText(/AI risk/)).toBeNull();
    expect(screen.queryByText(/Human task/)).toBeNull();
  });

  // ★★★ `sanitizeActivityEntry` KEEPS an unknown-but-string actor (same trade
  // as `kind`), so `actor: "toString"` reaches the panel on a FULLY sanitized
  // log. A bare index into the label map resolves Function.prototype.toString,
  // which React then throws on — and a throw here is not a blank table, it is
  // the full-screen ErrorBoundary page on every Activity visit until the
  // project data is repaired by hand.
  it("renders an unknown-but-string actor without crashing", () => {
    expect(() =>
      renderPanel(
        <ActivityLogPanel
          lang="en-US"
          entries={
            [
              {
                id: "u1",
                timestamp: "2026-05-28T10:00:00.000Z",
                kind: "task.created",
                args: ["Odd actor"],
                actor: "toString",
              },
            ] as unknown as ActivityEntry[]
          }
          onClear={() => {}}
        />,
      ),
    ).not.toThrow();
    // Positive observable: the row still renders and the unknown actor falls
    // back to the same em dash an absent one gets.
    const row = screen
      .getAllByRole("row")
      .find((r) => (r.textContent ?? "").includes("Odd actor"));
    expect(row).toBeDefined();
    expect(Array.from(row!.querySelectorAll("td"))[2]?.textContent).toBe("—");
  });

  // ★★★ THE FILTER PREDICATE MUST BE THE DISPLAY PREDICATE, and "actor is
  // absent" is only HALF of it. `sanitizeActivityEntry` deliberately KEEPS an
  // unknown-but-string actor so a newer release's value is not destroyed by an
  // older client, and the test directly above pins that such a row renders as
  // the SAME em dash an actor-less one gets. So a filter written as
  // `entry.actor === undefined` would leave a row DISPLAYED as unattributed out
  // of the filter that claims to select unattributed rows — the column and the
  // filter disagreeing about one entry, which is the defect the shared
  // `actorKeyOf` derivation exists to make impossible.
  //
  // ★★ BOTH shapes are seeded on purpose: with only the actor-less row this
  // test passes against that weaker predicate, i.e. it would be vacuous for the
  // property it is named for. `"scheduler"` is the realistic case (a value a
  // future release stamps and this build has never heard of); `"toString"` is
  // the hostile one that also probes the own-property guard.
  it("filters to the unattributed rows — absent AND unknown-but-string actors", async () => {
    const user = userEvent.setup();
    renderPanel(
      <ActivityLogPanel
        lang="en-US"
        entries={
          [
            entry({ id: "n1", kind: "task.created", args: ["Origin unknown"] }),
            {
              id: "n2",
              timestamp: "2026-05-28T10:00:00.000Z",
              kind: "task.created",
              args: ["Odd actor"],
              actor: "toString",
            },
            {
              id: "n3",
              timestamp: "2026-05-28T10:00:00.000Z",
              kind: "task.created",
              args: ["Future actor"],
              actor: "scheduler",
            },
            entry({ id: "n4", kind: "task.created", args: ["Typed by hand"], actor: "user" }),
            entry({ id: "n5", kind: "task.created", args: ["Written by the AI"], actor: "ai" }),
          ] as unknown as ActivityEntry[]
        }
        onClear={() => {}}
      />,
    );
    // ★ CONTROL: unfiltered, all five are on screen — so the exclusions below
    //   cannot pass because a row never rendered in the first place.
    for (const msg of [
      /Origin unknown/,
      /Odd actor/,
      /Future actor/,
      /Typed by hand/,
      /Written by the AI/,
    ]) {
      expect(screen.getByText(msg)).toBeInTheDocument();
    }

    await user.click(
      within(
        screen.getByRole("radiogroup", { name: t("en-US", "activityHeaderActor") }),
      ).getByRole("radio", { name: t("en-US", "activityActorUnknown") }),
    );

    expect(screen.getByText(/Origin unknown/)).toBeInTheDocument();
    expect(screen.getByText(/Odd actor/)).toBeInTheDocument();
    expect(screen.getByText(/Future actor/)).toBeInTheDocument();
    expect(screen.queryByText(/Typed by hand/)).toBeNull();
    expect(screen.queryByText(/Written by the AI/)).toBeNull();

    // ★ And every kept row is one the COLUMN also calls unattributed — the
    //   display and the filter answering the same question about the same row.
    for (const msg of ["Origin unknown", "Odd actor", "Future actor"]) {
      const row = screen
        .getAllByRole("row")
        .find((r) => (r.textContent ?? "").includes(msg));
      expect(row, `no row for ${msg}`).toBeDefined();
      // timestamp · kind · actor · message
      expect(Array.from(row!.querySelectorAll("td"))[2]?.textContent).toBe("—");
    }
  });

  // ★★★ TWO CONTROLS SHARING AN ACCESSIBLE NAME IS NOT A PROPERTY EITHER ONE
  // HAS, so no single-control fixture can express it — this test must render
  // BOTH filters. And no gate can express it either: of axe-core 4.12.1's 105
  // rules, the 69 carrying one of the four tags `e2e/a11y.spec.ts` requests
  // include NONE that flags a duplicate accessible name (the only adjacent
  // rule, `identical-links-same-purpose`, is links-only and tagged `wcag2aaa`,
  // which the spec never asks for). Activity IS in `A11Y_VIEWS`, so a fully
  // green axe run said nothing while the group filter's own radiogroup was
  // named "All" — a group named after one of its options — sitting beside an
  // actor group whose first radio was also "All" (WCAG 2.4.6).
  it("names the filter radiogroups and their All radios distinctly", () => {
    renderPanel(<ActivityLogPanel lang="en-US" entries={entries} onClear={() => {}} />);

    // Search mode · category · actor.
    expect(screen.getAllByRole("radiogroup")).toHaveLength(3);
    // `getByRole` THROWS on more than one match, so three names each matching
    // exactly one of three groups IS the distinctness assertion.
    const searchGroup = screen.getByRole("radiogroup", {
      name: t("en-US", "activitySearchPlaceholder"),
    });
    const categoryGroup = screen.getByRole("radiogroup", {
      name: t("en-US", "activityGroupFilterLabel"),
    });
    const actorGroup = screen.getByRole("radiogroup", {
      name: t("en-US", "activityHeaderActor"),
    });
    expect(new Set([searchGroup, categoryGroup, actorGroup]).size).toBe(3);

    // ★ And at the RADIO level, which is what survives an AT that does not
    //   announce the containing group: exactly ONE radio in the whole panel is
    //   named "All", and it is the category one.
    expect(
      screen.getAllByRole("radio", { name: t("en-US", "activityFilterAll") }),
    ).toHaveLength(1);
    expect(
      within(categoryGroup).getByRole("radio", { name: t("en-US", "activityFilterAll") }),
    ).toBeInTheDocument();
    const actorAll = within(actorGroup).getByRole("radio", {
      name: t("en-US", "activityActorFilterAll"),
    });

    // ★ WCAG 2.5.3 (label-in-name): the VISIBLE label stays "All" and must be
    //   CONTAINED in the accessible name. axe cannot check this either —
    //   `label-content-name-mismatch` is tagged `experimental`, which axe's
    //   default `tagExclude` drops, so a tag-only run never executes it.
    expect(actorAll.textContent).toBe(t("en-US", "activityFilterAll"));
    expect(t("en-US", "activityActorFilterAll")).toContain(
      t("en-US", "activityFilterAll"),
    );
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

describe("ActivityLogPanel sortable column headers", () => {
  // This table announced its sort state NOWHERE: three hand-rolled sortable
  // headers and zero aria-sort attributes. Its source held exactly two matches
  // for the string and BOTH were prose inside a JSX comment saying the headers
  // lacked it — so a grep of the file read as covered. axe has NO rule for a
  // missing aria-sort, in any view at any seed size, so these two tests are the
  // only detector that will ever exist for this.

  // Scoped to the log table and anchored on the NON-sortable actor header, so
  // the scope itself can never move with the sort state.
  const table = () =>
    screen.getByRole("columnheader", { name: t("en-US", "activityHeaderActor") }).closest("table")!;

  // Reached through the BUTTON rather than matched by name: before the
  // conversion the ACTIVE header named itself "When ↓" (measured with
  // computeAccessibleName), glyph and all, so an exact lookup for "When" could
  // not find it. The primitive's arrow is aria-hidden, so the name is the label.
  const headerFor = (label: string) =>
    within(table()).getByRole("button", { name: label }).closest("th");

  // A string `name` is an EXACT match, so each lookup also pins that column's
  // i18n label KEY — note the sort key is `timestamp` while the label key is
  // `activityHeaderWhen`, and a header wired to the wrong string fails here.
  const SORTABLE = [
    ["timestamp", t("en-US", "activityHeaderWhen")],
    ["kind", t("en-US", "activityHeaderKind")],
    ["actor", t("en-US", "activityHeaderActor")],
    ["message", t("en-US", "activityHeaderMessage")],
  ] as const;

  it("announces sort state through aria-sort, which it did not carry at all before", async () => {
    const user = userEvent.setup();
    renderPanel(<ActivityLogPanel lang="en-US" entries={entries} onClear={() => {}} />);
    // The panel mounts sorted by "when", DESCENDING — so one header already
    // reports a real state, and the other two must SAY "none" rather than leave
    // the attribute off entirely.
    expect(headerFor(t("en-US", "activityHeaderWhen"))).toHaveAttribute("aria-sort", "descending");
    expect(headerFor(t("en-US", "activityHeaderKind"))).toHaveAttribute("aria-sort", "none");
    expect(headerFor(t("en-US", "activityHeaderActor"))).toHaveAttribute("aria-sort", "none");
    expect(headerFor(t("en-US", "activityHeaderMessage"))).toHaveAttribute("aria-sort", "none");
    // The actor column BECAME sortable once the row moved onto the primitive -
    // it was held back only because a fourth hand-rolled sort button would have
    // deepened the aria-sort debt. It now carries a button and a real state,
    // asserted above; the assertion that it had NO aria-sort lived here and is
    // deliberately gone rather than relaxed.

    const kind = () => within(table()).getByRole("button", { name: t("en-US", "activityHeaderKind") });
    await user.click(kind());
    // Re-queried after every click: a stale node would report the state the
    // header had before the render that changed it.
    expect(headerFor(t("en-US", "activityHeaderKind"))).toHaveAttribute("aria-sort", "ascending");
    // toggleSort flips the direction when the key is unchanged.
    await user.click(kind());
    expect(headerFor(t("en-US", "activityHeaderKind"))).toHaveAttribute("aria-sort", "descending");
  });

  // The explicit <SortKey> generic stops a GARBAGE sortCol, but not one real
  // column's key pasted onto another header: every key is still a valid SortKey,
  // tsc exits 0, that column silently missorts, and nothing else here sees it.
  //
  // The detector falls out of the primitive's own `active` rule
  // (`sortKey === sortCol && sortDir !== "off"`): two headers sharing one
  // sortCol both light up on a single click. So after clicking a column, exactly
  // ONE header may report a non-"none" aria-sort, and it must be that column's
  // own — the count alone would miss a swap onto a hidden column, the identity
  // alone would miss the duplicate.
  //
  // ★ Known limit: this catches a PASTE (one key duplicated onto a second
  // header), not a full EXCHANGE of two headers' keys — an exchange leaves no
  // duplicate and passes here.
  it("wires each sortable header to its own column, not a neighbour's", async () => {
    const user = userEvent.setup();
    renderPanel(<ActivityLogPanel lang="en-US" entries={entries} onClear={() => {}} />);
    const sorted = () =>
      within(table())
        .getAllByRole("columnheader")
        .filter((th) => (th.getAttribute("aria-sort") ?? "none") !== "none");

    for (const [key, label] of SORTABLE) {
      await user.click(within(table()).getByRole("button", { name: label }));
      const own = headerFor(label);
      expect(sorted(), "clicking " + key + " lit up the wrong number of headers").toHaveLength(1);
      expect(sorted()[0], "clicking " + key + " sorted a different column").toBe(own);
    }
  });
  // ★★ The ROW-ORDER assertion is the load-bearing half. aria-sort alone
  // passes with the comparator's actor branch deleted entirely — the header
  // would announce a sort that never happened.
  // ★ Labels come from t(), not hardcoded: the comparator sorts on the
  // DERIVED actorLabel (what the cell renders), so the expected order is
  // computed the same way rather than assuming how AI/User collate.
  it("sorts by actor, and actually reorders the rows", async () => {
    const user = userEvent.setup();
    const aiLabel = t("en-US", "activityActorAi");
    const userLabel = t("en-US", "activityActorUser");
    const [firstLabel] = [aiLabel, userLabel].sort((a, b) => a.localeCompare(b));
    renderPanel(
      <ActivityLogPanel
        lang="en-US"
        entries={[
          entry({ id: "1", actor: "user" }),
          entry({ id: "2", actor: "ai" }),
        ]}
        onClear={() => {}}
      />,
    );
    const actorLabel = t("en-US", "activityHeaderActor");
    await user.click(within(table()).getByRole("button", { name: actorLabel }));
    expect(headerFor(actorLabel)).toHaveAttribute("aria-sort", "ascending");

    // Header order is When, Kind, Actor, Message - so the actor cell is index 2.
    const firstRow = within(table()).getAllByRole("row")[1];
    const cells = Array.from(firstRow.querySelectorAll("td"));
    expect(cells[2]?.textContent).toContain(firstLabel);
  });
  // ★★★ e2e CANNOT SEE THIS PANEL. `e2e/seed.ts` never seeds `activityLog`, so the
  // Activity view renders its empty state with no table — measured: the
  // header-row-uniformity spec reported 11 cells for it, and all 11 were the
  // unconditionally-mounted RAID panel's, not this one's. This is the only
  // detector for either property below.
  //
  // ★ A class assertion is weaker than the computed weight that spec reads. Note
  // this panel now has NO raw `<th>` — all four headers are `SortResizeTh` since
  // the actor column became sortable — so today the only way to fail this is to
  // change the PRIMITIVE, which is what it was mutation-proved against. It still
  // earns its place: it catches a future raw cell added to this row without
  // `font-medium`, and it pins the absence of the `uppercase tracking-wide` these
  // three sort labels carried as the last such headers in the app.
  it("keeps every header on one weight and none of them shouting", () => {
    renderPanel(
      <ActivityLogPanel lang="en-US" entries={[entry({ id: "1" }), entry({ id: "2" })]} onClear={() => {}} />,
    );
    const headers = screen.getAllByRole("columnheader");
    // Positive observable: the empty state renders no headers at all, which is
    // exactly how the e2e version of this check went vacuous.
    expect(headers).toHaveLength(4);
    for (const th of headers) {
      const label = th.textContent?.trim() || "(blank)";
      expect(th.className, `header ${label} is off the row weight`).toContain("font-medium");
      expect(th.className, `header ${label} is still uppercase`).not.toContain("uppercase");
      const btn = th.querySelector("button");
      if (btn) {
        expect(btn.className, `sort button ${label} is still uppercase`).not.toContain("uppercase");
      }
    }
  });
});
