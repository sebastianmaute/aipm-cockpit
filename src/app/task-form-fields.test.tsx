import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { TestProviders } from "./test-providers";
import { ModalFieldControls } from "./modal-field-controls";
import { TaskFormFields } from "./task-form-fields";
import { HEALTH_CHIP_ACTIVE_CLASS } from "./task-health-chip-style";
import { loadI18n, t, type Lang } from "./i18n";
import { EMAIL_MAX } from "./sanitize";
import { useTaskForm } from "./task-form-context";
import { fieldTierTrigger, selectFieldTier } from "../test/field-tier";
import type { TaskBudgetLink } from "./use-task-budget-link";
import type { BudgetBucket, Task } from "./types";
import { expectRowUniqueNames } from "../test/row-unique-names";

// The Description field renders a Tiptap/ProseMirror editor, which touches
// layout APIs jsdom lacks; stub them so the editor mounts (mirrors rich-text-editor.test.tsx).
beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore jsdom polyfill
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore jsdom polyfill
  Range.prototype.getBoundingClientRect = () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) });
});

function Harness(
  over: {
    onOpenNotes?: () => void;
    onOpenBlockers?: () => void;
    budgetLink?: TaskBudgetLink;
    tasksForDeps?: Task[];
    withAddressBook?: boolean;
    lang?: Lang;
  } = {},
) {
  return (
    <form aria-label="form">
      <TaskFormFields
        lang={over.lang ?? "en-US"}
        today="2026-05-29"
        nextId={1}
        contactsList={[]}
        resources={[]}
        onCreateResource={vi.fn(() => 1)}
        absences={[]}
        tasksForDeps={over.tasksForDeps ?? []}
        uniqueGroups={[]}
        uniqueLabels={[]}
        editingIsJiraLinked={false}
        jiraEnabled={false}
        fieldErrors={{}}
        submitted={false}
        holidaySet={new Set()}
        jiraProjectKey={undefined}
        jiraDefaultIssueType={undefined}
        onRemoveContact={vi.fn()}
        onAddAssigneeToAddressBook={over.withAddressBook === false ? undefined : vi.fn()}
        onOpenNotes={over.onOpenNotes}
        onOpenBlockers={over.onOpenBlockers}
        budgetLink={over.budgetLink}
      />
    </form>
  );
}

describe("HEALTH_CHIP_ACTIVE_CLASS (manual health-override chip tint)", () => {
  it("uses canonical --rag-* tokens (R=red, A=amber, G=green), not raw brand classes", () => {
    expect(HEALTH_CHIP_ACTIVE_CLASS.R).toContain("bg-[var(--rag-red)]");
    expect(HEALTH_CHIP_ACTIVE_CLASS.A).toContain("bg-[var(--rag-amber)]");
    expect(HEALTH_CHIP_ACTIVE_CLASS.G).toContain("bg-[var(--rag-green)]");
    for (const cls of Object.values(HEALTH_CHIP_ACTIVE_CLASS)) {
      expect(cls).not.toContain("bg-ui-purple");
      expect(cls).not.toContain("bg-ui-pink");
      expect(cls).not.toContain("bg-ui-green");
    }
  });

  // open-followups §55 (WCAG 1.4.1). The active RAG border measured 1.34-2.34
  // (amber) and 2.47-2.96 (green) against the inactive `--line` in the light
  // schemes, so the hue alone cannot carry the selected state. §331 made the
  // group a real radio group and moved the non-colour cue to the shared check
  // marker, which every chip ("Auto" included) renders in BOTH states — so an
  // ON-only assertion would pass against a conditional-render regression.
  it("each health chip carries the non-colour selected marker in both states", async () => {
    const user = userEvent.setup();
    render(<Harness />, { wrapper: TestProviders });
    const markerState = (name: string) => {
      const marker = screen.getByRole("radio", { name }).querySelector("[data-selected-marker]");
      expect(marker).not.toBeNull();
      return marker?.getAttribute("data-selected-marker");
    };
    // No override is set, so every RAG chip is off — and each still renders a marker.
    for (const name of ["Red", "Amber", "Green"]) expect(markerState(name)).toBe("off");
    await user.click(screen.getByRole("radio", { name: "Amber" }));
    expect(markerState("Amber")).toBe("on");
    expect(markerState("Red")).toBe("off");
    expect(markerState("Green")).toBe("off");
  });

  // ★★★ ONE-OF-N, so a pick must not shift the row: the marker is always
  //  RENDERED and only `invisible` when off. ANTI-VACUITY: asserted on the OFF
  //  chips (a selected marker looks the same either way) with the COUNT pinned.
  it("keeps every chip's marker in the layout, so a pick cannot shift the row", async () => {
    const user = userEvent.setup();
    render(<Harness />, { wrapper: TestProviders });
    const group = screen.getByRole("radiogroup", { name: t("en-US", "health") });
    // COUNT: Auto + Red + Amber + Green.
    expect(group.querySelectorAll("[data-selected-marker]")).toHaveLength(4);
    const markerClass = (name: string) =>
      screen.getByRole("radio", { name }).querySelector("[data-selected-marker]")?.getAttribute("class") ?? "";
    for (const name of ["Red", "Amber", "Green"]) expect(markerClass(name)).toContain("invisible");
    await user.click(screen.getByRole("radio", { name: "Amber" }));
    for (const name of ["Red", "Green"]) expect(markerClass(name)).toContain("invisible");
    expect(markerClass("Amber")).not.toContain("invisible");
  });

  // §331 — one Tab stop, and arrow keys move the choice (APG radiogroup).
  it("is one radio group with a single Tab stop that arrow keys move", async () => {
    const user = userEvent.setup();
    render(<Harness />, { wrapper: TestProviders });
    const group = screen.getByRole("radiogroup", { name: t("en-US", "health") });
    const radios = Array.from(group.querySelectorAll<HTMLElement>('[role="radio"]'));
    expect(radios).toHaveLength(4);
    expect(radios.filter((r) => r.tabIndex === 0)).toEqual([radios[0]]); // Auto is checked
    radios[0].focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Red" })).toHaveAttribute("aria-checked", "true");
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Red" }));
  });
});

describe("TaskFormFields — budget bucket", () => {
  const BUCKETS = [{ id: 1, name: "Design" }, { id: 2, name: "Build" }] as unknown as BudgetBucket[];

  it("renders the budget-bucket select and reports the chosen id", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness budgetLink={{ buckets: BUCKETS, bucketId: 1, onChange }} />, { wrapper: TestProviders });
    await user.selectOptions(screen.getByLabelText("Budget bucket"), "2");
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it("reports null when the none option is chosen", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness budgetLink={{ buckets: BUCKETS, bucketId: 1, onChange }} />, { wrapper: TestProviders });
    await user.selectOptions(screen.getByLabelText("Budget bucket"), "");
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("renders no budget field at all when no budgetLink is supplied", () => {
    render(<Harness />, { wrapper: TestProviders });
    expect(screen.queryByLabelText("Budget bucket")).toBeNull();
  });
});

describe("TaskFormFields", () => {
  it("renders the core task fields", () => {
    render(<Harness />, { wrapper: TestProviders });
    expect(screen.getByText("Task name")).toBeTruthy();
    expect(screen.getByText("Assignee")).toBeTruthy();
    expect(screen.getByText("Due date")).toBeTruthy();
  });

  it("puts the dictation control in the task-name caption and keeps the input separately named", () => {
    // ★★ `voice.ts` `getCtor()` reads `window.SpeechRecognition`, which jsdom
    //    does not define — so `useDictationMic` returns `mic: null` and
    //    `captionAction={titleMic}` would be NULL. `Field` forces `group` on
    //    `group || captionAction`, so a null mic does NOT force it and the
    //    whole shape under test would be invisible here. Stub the ctor so the
    //    mic really renders; without this the test passes for the wrong reason
    //    in the label branch, or fails against correct code.
    vi.stubGlobal("SpeechRecognition", class {});
    try {
      render(<Harness />, { wrapper: TestProviders });
      const group = screen.getByRole("group", { name: t("en-US", "taskName") });
      // The mic is INSIDE the caption group, not a sibling of the input.
      expect(within(group).getByRole("button", { name: /dictate/i })).toBeInTheDocument();
      // And the input still has its own accessible name, which the named group
      // does NOT give it — an unlabeled form control is an axe-critical failure.
      expect(screen.getByRole("textbox", { name: t("en-US", "taskName") })).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("renders all 5 numbered section headings", () => {
    render(<Harness />, { wrapper: TestProviders });
    expect(screen.getByText("1. Details")).toBeTruthy();
    expect(screen.getByText("2. Scheduling")).toBeTruthy();
    expect(screen.getByText("3. Status & Notes")).toBeTruthy();
    expect(screen.getByText("4. Effort & Classification")).toBeTruthy();
    expect(screen.getByText("5. Relationships")).toBeTruthy();
  });

  // The heading order is the reworked one -- Status & Notes moved from fifth to
  // third. Section headings are `<h3>` (task-form-layout.tsx's `TaskFormSection`)
  // rendering `${index}. ${title}`; titles come from `t()` rather than hardcoded
  // English so a copy change doesn't silently defeat this. All 5 sections render
  // under the plain Harness with no tier switch -- confirmed by the test above,
  // which uses the same harness.
  it("renders the five sections in the reworked order", () => {
    render(<Harness />, { wrapper: TestProviders });
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual([
      `1. ${t("en-US", "taskFormSectionDetails")}`,
      `2. ${t("en-US", "taskFormSectionScheduling")}`,
      `3. ${t("en-US", "taskFormSectionStatus")}`,
      `4. ${t("en-US", "taskFormSectionEffort")}`,
      `5. ${t("en-US", "taskFormSectionRelationships")}`,
    ]);
  });

  it("gives the group field the `sm:col-start-1` that starts a new grid row", () => {
    // ★★ This pins the CLASS, not the geometry -- jsdom has no layout, which is
    //   exactly how the defect it guards reached a real browser with the whole
    //   suite green. MEASURED in Chromium: without `sm:col-start-1`, grid
    //   auto-flow packed Group into the cell beside Budget bucket and stranded
    //   Labels alone on the row below. DOM ORDER was correct either way, so the
    //   ordering test above could not see it.
    // ★★ AND IT PINS THE CLASS IN THE CONFIGURATION WHERE THE DEFECT IS INERT.
    //   The plain `Harness` passes no `budgetLink`, and the budget field renders
    //   only when one is supplied ("renders no budget field at all when no
    //   budgetLink is supplied", above) — so the Budget bucket neighbour whose
    //   empty cell motivated `sm:col-start-1` is NOT ON SCREEN here. This test
    //   is therefore a class-presence regression pin, not a reproduction of the
    //   packing bug; the test name used to promise the latter. Reproducing it
    //   needs a `budgetLink` harness AND a real layout engine, which jsdom is
    //   not.
    render(<Harness />, { wrapper: TestProviders });
    // ★ Since §672 ComboInput names its own input (aria-label = fieldLabel), so the
    // "Group" name below no longer proves the hinted <label> names the control; §386
    // (the hint's tooltip no longer joins the label's text) is pinned in
    // form-field.test.tsx and the per-modal suites. This stays a layout pin.
    // ★ A HINTED Field's `<label>` is `display: contents`,
    // so the grid item carrying `className` is the label's PARENT wrapper — the
    // label itself generates no box and a class on it would place nothing.
    const group = screen.getByRole("combobox", { name: "Group" });
    expect(group.closest("label")?.className).toBe("contents");
    expect(group.closest("label")?.parentElement?.className).toContain("sm:col-start-1");
  });

  it("places the Due date field within the Scheduling section", () => {
    render(<Harness />, { wrapper: TestProviders });
    const section = screen.getByText("2. Scheduling").closest("section");
    expect(section).not.toBeNull();
    expect(section!.textContent).toContain("Due date");
  });

  it("shows a per-field error (role=alert) when a field error is set and submitted", () => {
    function ErrHarness() {
      return (
        <form aria-label="form">
          <TaskFormFields
            lang="en-US" today="2026-05-29" nextId={1} contactsList={[]}
            resources={[]} onCreateResource={vi.fn(() => 1)}
            absences={[]} tasksForDeps={[]} uniqueGroups={[]} uniqueLabels={[]}
            editingIsJiraLinked={false} jiraEnabled={false}
            fieldErrors={{ taskName: "errorTaskNameRequired" }} submitted
            holidaySet={new Set()} jiraProjectKey={undefined} jiraDefaultIssueType={undefined}
            onRemoveContact={vi.fn()} onAddAssigneeToAddressBook={vi.fn()}
          />
        </form>
      );
    }
    render(<ErrHarness />, { wrapper: TestProviders });
    expect(screen.getByRole("alert").textContent).toContain("Task name is required");
  });

  describe("field visibility", () => {
    function VisHarness(over: { budgetLink?: TaskBudgetLink } = {}) {
      return (
        <>
          <ModalFieldControls modalId="task" lang="en-US" />
          <form aria-label="form">
            <TaskFormFields
              lang="en-US" today="2026-05-29" nextId={1} contactsList={[]}
              resources={[]} onCreateResource={vi.fn(() => 1)}
              absences={[]} tasksForDeps={[]} uniqueGroups={[]} uniqueLabels={[]}
              editingIsJiraLinked={false} jiraEnabled={false}
              fieldErrors={{}} submitted={false}
              holidaySet={new Set()} jiraProjectKey={undefined} jiraDefaultIssueType={undefined}
              onRemoveContact={vi.fn()} onAddAssigneeToAddressBook={vi.fn()}
              budgetLink={over.budgetLink}
            />
          </form>
        </>
      );
    }

    it("shows Advanced fields and hides Full-only fields by default", () => {
      render(<VisHarness />, { wrapper: TestProviders });
      // Advanced default: priority (advanced) present, email (full) absent.
      expect(screen.getByText("Priority")).toBeTruthy();
      expect(screen.queryByText("Email")).toBeNull();
    });

    // The flag judges the value a submit would STORE (capped at EMAIL_MAX, then
    // `sanitizeEmail`), exactly as `use-task-submit.ts` does — so a delimiter
    // that the cap cuts off never flags, while one inside the cap still does.
    it("flags the capped stored email, not the raw typed one", () => {
      render(<VisHarness />, { wrapper: TestProviders });
      selectFieldTier("fieldViewFull");
      const input = screen.getByPlaceholderText(t("en-US", "placeholderEmail"));
      const delimiterMessage = t("en-US", "errorEmailDelimiter");
      fireEvent.change(input, { target: { value: `a@b.${"c".repeat(EMAIL_MAX - 4)},zz` } });
      expect(screen.queryByText(delimiterMessage)).toBeNull();
      expect(input.getAttribute("aria-invalid")).not.toBe("true");
      // Positive control: a delimiter inside the cap still flags.
      fireEvent.change(input, { target: { value: "a,b@x.com" } });
      expect(screen.getByText(delimiterMessage)).toBeTruthy();
    });

    // M-C4 — the submit stores the `Name <addr>`-unwrapped address, so the flag
    //  judges that value too.
    it("M-C4: does not flag a Name <addr> whose inner address is write-safe", () => {
      render(<VisHarness />, { wrapper: TestProviders });
      selectFieldTier("fieldViewFull");
      const input = screen.getByPlaceholderText(t("en-US", "placeholderEmail"));
      fireEvent.change(input, { target: { value: "Ann Lee <ann@x.com>" } });
      expect(screen.queryByText(t("en-US", "errorInvalidEmail"))).toBeNull();
      expect(input.getAttribute("aria-invalid")).not.toBe("true");
      // Positive control: a shape that does not unwrap still flags.
      fireEvent.change(input, { target: { value: "Dee <not-an-email>" } });
      expect(screen.getByText(t("en-US", "errorInvalidEmail"))).toBeTruthy();
    });

    it("hides advanced fields like Priority when switched to Simple, keeping Task name", () => {
      render(<VisHarness />, { wrapper: TestProviders });
      expect(screen.getByText("Priority")).toBeTruthy();

      // `selectFieldTier` drives the popover with `fireEvent`, not `userEvent`
      // like the rest of this file — the three-step open/pick/close sequence and
      // its close assertion live in one shared helper, and it is synchronous.
      selectFieldTier("fieldViewSimple");

      expect(screen.queryByText("Priority")).toBeNull();
      expect(screen.getByText("Task name")).toBeTruthy();
    });

    // Lives in THIS describe because only `VisHarness` mounts the
    // `ModalFieldControls` trigger `selectFieldTier` needs.
    // ★ `timeSpent` is an ADVANCED-tier field (`modal-fields.ts`), so the
    //   tracking button ALREADY renders at this harness's default tier — the
    //   Full switch is not what reveals it. It is kept because Full mounts the
    //   widest field set, which makes the NEGATIVE assertion below strictly
    //   stronger: a standalone "Time spent" textbox at ANY tier renders here.
    //   (This comment previously called the field FULL-tier; it moved.)
    it("replaces the standalone Time spent field with the Time tracking button", () => {
      render(<VisHarness />, { wrapper: TestProviders });
      selectFieldTier("fieldViewFull");

      expect(screen.getByRole("button", { name: /time tracking/i })).toBeTruthy();
      // Spent is edited only in the dialog now. A testing-library string `name`
      // is a WHOLE-STRING match, so this cannot be satisfied by the dialog's own
      // "Time spent" box even once that is mounted.
      expect(screen.queryByRole("textbox", { name: t("en-US", "taskTimeSpent") })).toBeNull();
    });

    // DOM ORDER is all this asserts, and all jsdom can see. The VISUAL row
    // placement (half width, empty right cell) is the eye-verify task's job —
    // a green run here is not proof the layout is right.
    // ★ Lives in THIS describe for the same reason as the test above: only
    //   `VisHarness` mounts the `ModalFieldControls` that `selectFieldTier`
    //   drives. BOTH anchors are ADVANCED-tier (`timeSpent`, `budgetBucket`),
    //   so both render at the default tier and the Full switch is not what
    //   makes this assertion reachable — it asserts the ordering at the widest
    //   tier. (This comment previously called the button FULL-tier.)
    it("renders budget bucket between the tracking button and the group field", () => {
      const buckets = [{ id: 1, name: "Design" }, { id: 2, name: "Build" }] as unknown as BudgetBucket[];
      render(
        <VisHarness budgetLink={{ buckets, bucketId: 1, onChange: vi.fn() }} />,
        { wrapper: TestProviders },
      );
      selectFieldTier("fieldViewFull");

      const tracking = screen.getByRole("button", { name: /time tracking/i });
      // Both are `role="combobox"`: the bucket is a `<Select>`, the group a
      // `ComboInput` that sets the role explicitly.
      // ★ The group caption carries a `hint`. That once polluted the name
      //   ("Groupi") and forced a prefix regex here; `Field` now renders the
      //   tooltip OUTSIDE the `<label>` (open-followups §386), so the name is
      //   the whole-string label and this query pins that.
      const bucket = screen.getByRole("combobox", { name: t("en-US", "taskBudgetBucket") });
      const group = screen.getByRole("combobox", { name: t("en-US", "group") });

      expect(tracking.compareDocumentPosition(bucket) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(bucket.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    // open-followups §387. Relationships holds the dependency pickers only:
    // budget bucket lives in Effort, and the Blockers control moved beside the
    // Notes control (blocker log). Hiding dependencies while budget bucket and
    // blockers stay shown must drop the whole section — an extra `budgetBucket`
    // or `blockers` disjunct in the guard would leave an empty numbered heading.
    // ★ Not a TIER test: all three fields are `advanced`, so a tier switch moves
    //   them together and can never reach this mixed state. It drives the
    //   per-field checklist, the only way a user gets here.
    describe("Relationships section guard", () => {
      const buckets = [{ id: 1, name: "Design" }] as unknown as BudgetBucket[];
      const relationships = `5. ${t("en-US", "taskFormSectionRelationships")}`;
      const headings = () => screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);

      function hideFields(labelKeys: ("dependencies" | "blockers")[]) {
        fireEvent.click(fieldTierTrigger());
        const panel = screen.getByRole("dialog", { name: t("en-US", "configureFields") });
        for (const k of labelKeys) {
          fireEvent.click(within(panel).getByRole("checkbox", { name: t("en-US", k) }));
        }
        fireEvent.click(fieldTierTrigger());
        expect(screen.queryByRole("dialog", { name: t("en-US", "configureFields") })).toBeNull();
      }

      it("drops the section when dependencies are hidden but budget bucket and blockers are shown", () => {
        render(<VisHarness budgetLink={{ buckets, bucketId: 1, onChange: vi.fn() }} />, { wrapper: TestProviders });
        expect(headings()).toContain(relationships);
        hideFields(["dependencies"]);
        // Budget bucket and the Blockers control are still rendered…
        expect(screen.getByRole("combobox", { name: t("en-US", "taskBudgetBucket") })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: t("en-US", "blockerLogTitle") })).toBeInTheDocument();
        // …and the Relationships heading is gone rather than left empty.
        expect(headings()).not.toContain(relationships);
      });

      it("keeps the section while dependencies are shown, with blockers hidden", () => {
        render(<VisHarness budgetLink={{ buckets, bucketId: 1, onChange: vi.fn() }} />, { wrapper: TestProviders });
        hideFields(["blockers"]);
        expect(headings()).toContain(relationships);
        expect(screen.queryByRole("button", { name: t("en-US", "blockerLogTitle") })).toBeNull();
      });
    });
  });
});

describe("TaskFormFields description + notes button", () => {
  it("renders the rich Description editor (a labelled textbox)", async () => {
    render(<Harness />, { wrapper: TestProviders });
    // NoteEditor mounts a contenteditable with role=textbox + aria-label "Description".
    // ★ MUST be findBy, not getBy: the editor loads through the
    //   rich-text-editor-lazy next/dynamic boundary, so the FIRST render paints
    //   the Skeleton fallback and a synchronous getBy sees no textbox at all.
    //   The skeleton carries no role, so this query still cannot be satisfied by
    //   the placeholder -- swapping the render site for RichTextEditorFallback
    //   still fails this test.
    expect(await screen.findByRole("textbox", { name: "Description" })).toBeTruthy();
  });

  it("no longer renders the in-form note-log composer (author select + note input + add button)", async () => {
    render(<Harness />, { wrapper: TestProviders });
    // ★★★ THE await IS LOAD-BEARING AND IT IS NOT ABOUT THE Description EDITOR.
    //   `noteLogPlaceholder` labels the COMPOSER's RichTextEditor textbox, which
    //   now sits behind the rich-text-editor-lazy `next/dynamic` boundary. Assert
    //   its absence synchronously and the query is satisfied by a fallback that
    //   has not swapped yet — it would pass with the composer fully restored.
    //   Worse than plain vacuity: `next/dynamic` builds its `React.lazy` ONCE per
    //   MODULE evaluation, so after any earlier test in this file has resolved it,
    //   later renders are synchronous again and the line is live. `test:shuffle`
    //   shuffles WITHIN a file, so this assertion was alive or dead depending on
    //   order — and BOTH orders were green. Awaiting a positive observable that
    //   only exists once the lazy chunk has resolved removes the order dependence.
    expect(await screen.findByRole("textbox", { name: "Description" })).toBeTruthy();
    expect(screen.queryByLabelText(t("en-US", "noteLogAuthor"))).toBeNull();
    expect(screen.queryByLabelText(t("en-US", "noteLogPlaceholder"))).toBeNull();
    expect(screen.queryByRole("button", { name: t("en-US", "noteLogAdd") })).toBeNull();
  });

  it("renders a 'Notes (N)' button that opens the note-log window when clicked", async () => {
    const onOpenNotes = vi.fn();
    const user = userEvent.setup();
    render(<Harness onOpenNotes={onOpenNotes} />, { wrapper: TestProviders });

    // The unsaved-task fallback renders no count at all (a hardcoded 0 would only
    // be true by wiring, not by construction) — label is bare "Notes log".
    const btn = screen.getByRole("button", {
      name: t("en-US", "noteLogTitle"),
    });
    await user.click(btn);
    expect(onOpenNotes).toHaveBeenCalledTimes(1);
  });
});

describe("TaskFormFields — Blockers button (blocker log)", () => {
  const STORED: Task = {
    id: 7,
    taskName: "Draft charter",
    assignee: "",
    assigneeEmail: "",
    dueDate: "2026-06-01",
    lastUpdateDate: "2026-05-29",
    priority: "Medium",
    status: "To Do",
    blockers: "Vendor\nLegal",
    blockerLog: [
      { id: 1, text: "Vendor", createdAt: "2026-05-01T09:00:00.000Z" },
      { id: 2, text: "Legal", createdAt: "2026-05-02T09:00:00.000Z" },
      { id: 3, text: "Old", createdAt: "2026-04-01T09:00:00.000Z", resolvedAt: "2026-04-02T09:00:00.000Z" },
    ],
    description: "",
  };

  /** Puts the editor on the stored task the way `openEditModal` does (sets
   *  `editingId`), from a click so no state is set during render or in an effect. */
  function EditTask() {
    const { setEditingId } = useTaskForm();
    return (
      <button type="button" onClick={() => setEditingId(STORED.id)}>
        edit-task
      </button>
    );
  }

  it("editor Blockers button opens the window and shows the open count", async () => {
    const onOpenBlockers = vi.fn();
    const user = userEvent.setup();
    render(
      <>
        <EditTask />
        <Harness onOpenBlockers={onOpenBlockers} tasksForDeps={[STORED]} />
      </>,
      { wrapper: TestProviders },
    );
    await user.click(screen.getByRole("button", { name: "edit-task" }));

    // The count is the STORED row's OPEN entries (2), read live — the form draft
    // carries no blockers at all.
    const btn = screen.getByRole("button", { name: `${t("en-US", "blockerLogTitle")} (2)` });
    expect(btn).toBeEnabled();
    await user.click(btn);
    expect(onOpenBlockers).toHaveBeenCalledTimes(1);
  });

  it("for a new task the Blockers button is disabled with no count, like Notes", () => {
    render(<Harness />, { wrapper: TestProviders });
    const btn = screen.getByRole("button", { name: t("en-US", "blockerLogTitle") });
    expect(btn).toBeDisabled();
    const notes = screen.getByRole("button", { name: t("en-US", "noteLogTitle") });
    expect(notes).toBeDisabled();
  });

  it("editor no longer renders a blockers textarea", () => {
    render(<Harness />, { wrapper: TestProviders });
    // Positive floor: the Blockers control itself renders (field visible)…
    expect(screen.getByRole("button", { name: t("en-US", "blockerLogTitle") })).toBeInTheDocument();
    // …but no text box is labelled Blockers and the old placeholder is gone.
    expect(screen.queryByRole("textbox", { name: t("en-US", "blockers") })).toBeNull();
    expect(screen.queryByPlaceholderText(t("en-US", "placeholderBlockers"))).toBeNull();
  });
});

// ★★★ THE SEAM NOBODY ELSE WATCHES. The two `DependencyLinkGroup`s are
// identical apart from four characters: which draft slice each one READS
// (`form.dependencies` vs `form.successorLinks`) and which one it WRITES back.
// Swap either half and the successor picker becomes a second PREDECESSOR editor
// — the exact reverse of the feature — with no type error and, until this test,
// no red suite. Every neighbouring suite structurally misses it:
// `dependencies-editor.test.tsx` renders the group directly with explicit
// `links`/`onChange` props (so the wiring under test is supplied BY the test),
// `use-task-submit.test.ts` is handed a `form` object and never renders a field,
// the other `task-form-fields` tests all pass `tasksForDeps={[]}` (so no option
// is ever offered and no add can fire), and `label-binding.guard.test.ts` is a
// regex source scan. Mutation-verified in BOTH directions — a one-directional
// assertion survives the mutation aimed the other way.
describe("TaskFormFields — successor/predecessor draft wiring", () => {
  function depTask(id: number, taskName: string): Task {
    return {
      id,
      taskName,
      assignee: "",
      assigneeEmail: "",
      dueDate: "2026-01-01",
      lastUpdateDate: "2026-01-01",
      priority: "Medium",
      status: "To Do",
      blockers: "",
      description: "",
      group: "",
      labels: [],
      inquiriesSent: 0,
      createdDate: "2026-01-01",
      dependencies: [],
    } as unknown as Task;
  }

  // Distinctive names: `role="option"` also matches the type `<select>`'s
  // FS/SS/FF/SF options, so the fixture must not share words with those labels.
  const DEP_TASKS = [depTask(41, "Zeta groundwork"), depTask(42, "Omega rollout")];

  /** Renders the two draft slices under test so they can be asserted from the
   *  DOM. Pure render — no callback fired during render, which the repo's
   *  react-hooks purity rule would reject. */
  function FormProbe() {
    const { form } = useTaskForm();
    return (
      <>
        <output data-testid="probe-dependencies">{JSON.stringify(form.dependencies)}</output>
        <output data-testid="probe-successors">{JSON.stringify(form.successorLinks)}</output>
      </>
    );
  }

  function DepsHarness() {
    return (
      <>
        <FormProbe />
        <form aria-label="form">
          <TaskFormFields
            lang="en-US" today="2026-05-29" nextId={1} contactsList={[]}
            resources={[]} onCreateResource={vi.fn(() => 1)}
            absences={[]} tasksForDeps={DEP_TASKS} uniqueGroups={[]} uniqueLabels={[]}
            editingIsJiraLinked={false} jiraEnabled={false}
            fieldErrors={{}} submitted={false}
            holidaySet={new Set()} jiraProjectKey={undefined} jiraDefaultIssueType={undefined}
            onRemoveContact={vi.fn()} onAddAssigneeToAddressBook={vi.fn()}
          />
        </form>
      </>
    );
  }

  /** Type into one group's search box and click the offered task. The two
   *  comboboxes carry direction-unique accessible names, which is the only
   *  reason a single rendered modal can be driven per-direction at all. */
  async function addVia(
    user: ReturnType<typeof userEvent.setup>,
    searchLabel: string,
    optionText: string,
  ) {
    await user.type(screen.getByRole("combobox", { name: searchLabel }), optionText.slice(0, 4));
    await user.click(screen.getByRole("option", { name: new RegExp(optionText) }));
  }

  // ★★★ TWO adds, not one, and the reason is measured rather than reasoned. The
  // group's add is `onChange([...links, picked])` — it READS the slice it is
  // handed and appends. Both draft slices start EMPTY, so a single add cannot
  // tell `links={form.successorLinks}` from `links={form.dependencies}`:
  // appending to either empty array yields the same one-element result, and the
  // write-back (which is a separate prop) still lands in the right place. The
  // read-side mutation was applied and MEASURED to survive the one-add version
  // of this test. The SECOND add is what makes the read observable — by then the
  // correct slice holds an entry and the wrong one does not, so a misread drops
  // the first link instead of accumulating.
  it("routes SUCCESSOR picks to form.successorLinks and leaves form.dependencies alone", async () => {
    const user = userEvent.setup();
    render(<DepsHarness />, { wrapper: TestProviders });

    // Vacuity guard: both slices start empty, so the assertions below measure a
    // change rather than a pre-existing value.
    expect(screen.getByTestId("probe-successors").textContent).toBe("[]");
    expect(screen.getByTestId("probe-dependencies").textContent).toBe("[]");

    await addVia(user, "Search successor tasks", "Zeta groundwork");
    await addVia(user, "Search successor tasks", "Omega rollout");

    // Both links present ⇒ the group read back its OWN slice each time.
    expect(screen.getByTestId("probe-successors").textContent).toBe(
      JSON.stringify([{ taskId: 41, type: "FS" }, { taskId: 42, type: "FS" }]),
    );
    // …and the write-back never touched the predecessor slice.
    expect(screen.getByTestId("probe-dependencies").textContent).toBe("[]");
  });

  it("routes PREDECESSOR picks to form.dependencies and leaves form.successorLinks alone", async () => {
    const user = userEvent.setup();
    render(<DepsHarness />, { wrapper: TestProviders });

    expect(screen.getByTestId("probe-successors").textContent).toBe("[]");
    expect(screen.getByTestId("probe-dependencies").textContent).toBe("[]");

    await addVia(user, "Search predecessor tasks", "Omega rollout");
    await addVia(user, "Search predecessor tasks", "Zeta groundwork");

    expect(screen.getByTestId("probe-dependencies").textContent).toBe(
      JSON.stringify([{ taskId: 42, type: "FS" }, { taskId: 41, type: "FS" }]),
    );
    expect(screen.getByTestId("probe-successors").textContent).toBe("[]");
  });
});

// ★★★ Once a link exists, the chip's remove ✕ is the `Field`'s first LABELABLE
// descendant — so the default `<label>` branch would bind the "Predecessors"
// caption to it and clicking the caption would DELETE a link. `group` is what
// prevents that, and this is the only behavioural test that says so. Dropping
// `sm:col-span-2` to pair the two pickers is a hair away from also dropping
// `group`, which is why it is pinned here rather than left to the source scan.
// ★★★ IT IS VACUOUS WITHOUT A REAL CHIP. The default `tasksForDeps={[]}` offers
// no option, nothing can be added, `before` is 0, and the assertion then holds
// against ANY implementation — the mutation proof cannot go red. The link is
// seeded through the picker rather than as a prop because `TaskFormProvider`
// always starts from `emptyForm` and exposes no way to seed a draft.
describe("TaskFormFields — dependency caption binding", () => {
  const DEP_TASK = { id: 41, taskName: "Zeta groundwork", dependencies: [] } as unknown as Task;

  it("does not remove a dependency chip when the predecessors caption is clicked", async () => {
    const user = userEvent.setup();
    render(<Harness tasksForDeps={[DEP_TASK]} />, { wrapper: TestProviders });

    await user.type(screen.getByRole("combobox", { name: "Search predecessor tasks" }), "Zeta");
    await user.click(screen.getByRole("option", { name: /Zeta groundwork/ }));

    // `EntityLinkPicker`'s inert branch names each remove button
    // `<removeLabel> <code> <label>` — "Remove predecessor FS #41 Zeta
    // groundwork" — so a bare `/remove/i` would also catch the successor
    // group's chips if the fixture ever grew one.
    const removes = () => screen.queryAllByRole("button", { name: /^Remove predecessor/ });
    const before = removes().length;
    expect(before).toBeGreaterThan(0);

    // `Field` builds the caption once and hands the SAME `<span>` to either
    // branch, so this locator resolves identically under the mutant and the
    // click really lands on the caption either way. The `InfoTooltip` glyph
    // joins the span's text, hence the prefix regex rather than the literal.
    await user.click(screen.getByText(/^Predecessors/, { selector: "span" }));

    expect(removes()).toHaveLength(before);
  });
});

describe("TaskFormFields — add-to-address-book button (open-followups §90)", () => {
  it("renders the button when onAddAssigneeToAddressBook is passed (positive control)", () => {
    render(<Harness />, { wrapper: TestProviders });
    expect(screen.getByRole("button", { name: t("en-US", "taskAddAssigneeToAddressBook") })).toBeInTheDocument();
  });

  it("renders no button when it is absent (a popout)", () => {
    render(<Harness withAddressBook={false} />, { wrapper: TestProviders });
    expect(screen.queryByRole("button", { name: t("en-US", "taskAddAssigneeToAddressBook") })).toBeNull();
  });
});

describe("TaskFormFields — every choice has its own name (§672)", () => {
  beforeAll(() => loadI18n("de"));

  // Budget bucket names are free text with no uniqueness rule, so two buckets can share one. The
  // select's options are the only way to tell them apart, so a repeated name must still read as
  // two distinct options; the fixture repeats one name, once with different case and spacing.
  const BUCKETS = [
    { id: 1, name: "Design" },
    { id: 2, name: "Build" },
    { id: 3, name: "design" },
    { id: 4, name: "Build" },
  ] as unknown as BudgetBucket[];

  // Without the German dictionary the de case would silently re-run en-US, so pin that it loaded.
  it("renders real German for the de case", () => {
    expect(t("de", "budgetBucketNone")).not.toBe(t("en-US", "budgetBucketNone"));
  });

  it.each(["en-US", "de"] as const)("names every budget bucket option distinctly when two buckets share a name in %s", (lang) => {
    render(<Harness lang={lang} budgetLink={{ buckets: BUCKETS, bucketId: 1, onChange: vi.fn() }} />, { wrapper: TestProviders });
    const select = screen.getByRole("combobox", { name: t(lang, "taskBudgetBucket") });
    // "None" plus one option per bucket.
    expectRowUniqueNames({ minControls: BUCKETS.length + 1, scope: select, roles: ["option"], requireCollisionSeed: true });
  });

  it("keeps a repeated bucket's option value its own id, so picking the second one reports it", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness budgetLink={{ buckets: BUCKETS, bucketId: 1, onChange }} />, { wrapper: TestProviders });
    await user.selectOptions(screen.getByLabelText("Budget bucket"), "4");
    expect(onChange).toHaveBeenCalledWith(4);
  });

  // The Budget panel lists buckets by `order ?? id`, so the occurrence numbers have to follow that
  // order rather than the stored array, or "Build (1)" here would be the panel's "Build (2)".
  it("numbers and lists repeated buckets in the Budget panel's order, not the stored array order", () => {
    const REORDERED = [
      { id: 2, name: "Build", order: 2 },
      { id: 4, name: "Build", order: 1 },
      { id: 1, name: "Design", order: 3 },
    ] as unknown as BudgetBucket[];
    render(<Harness budgetLink={{ buckets: REORDERED, bucketId: null, onChange: vi.fn() }} />, { wrapper: TestProviders });
    const options = within(screen.getByLabelText("Budget bucket")).getAllByRole("option") as HTMLOptionElement[];
    expect(options.map((o) => [o.textContent, o.value])).toEqual([
      [t("en-US", "budgetBucketNone"), ""],
      ["Build (1)", "4"],
      ["Build (2)", "2"],
      ["Design", "1"],
    ]);
  });

  it.each(["en-US", "de"] as const)("names every health choice distinctly in %s", (lang) => {
    render(<Harness lang={lang} />, { wrapper: TestProviders });
    expectRowUniqueNames({ minControls: 4, scope: screen.getByRole("radiogroup", { name: t(lang, "health") }), roles: ["radio"] });
  });
});
