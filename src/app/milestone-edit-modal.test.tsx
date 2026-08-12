import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useRef, type ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { MilestoneEditModal } from "./milestone-edit-modal";
import { applyTier } from "./field-visibility";
import { t } from "./i18n";
import { selectFieldTier } from "../test/field-tier";
import { TEXTAREA_MAX } from "./sanitize";
import { htmlTextLength } from "./rich-text-plain";
import { expectNoLabelBoundToButton } from "../test/label-binding";

// Mock M365 hooks consumed by KnowledgeLinksFieldGated — default: SharePoint off.
vi.mock("./use-settings", () => ({
  useSettings: () => ({ settings: { integrations: { m365: { enabled: false, sharepoint: false } } }, setSettings: vi.fn(), hydrated: true, i18nReady: true, lang: "en-US" }),
}));
vi.mock("./use-ms-auth", () => ({
  useMsAuth: () => ({ account: null, ready: true, signIn: vi.fn(), signOut: vi.fn(), acquireToken: vi.fn(async () => "tok") }),
}));

// ProseMirror (the description RichTextEditor) touches layout APIs jsdom lacks;
// stub them so the editor mounts. Mirrors notes-window / rich-text-editor tests.
beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore jsdom polyfill
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore jsdom polyfill
  Range.prototype.getBoundingClientRect = () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) });
});

// ModalFieldControls (rendered in the modal header) reads field visibility from
// the workspace, so every render needs a WorkspaceProvider/FiltersProvider.
function wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </FiltersProvider>
  );
}

/** Seeds the workspace field-visibility config once on mount (e.g. Full view). */
function Seed({ tier }: { tier: "full" }) {
  const { setFieldVisibility } = useWorkspace();
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    setFieldVisibility(() => ({ milestone: applyTier("milestone", tier) }));
  }, [setFieldVisibility, tier]);
  return null;
}

/** Renders one milestone, optionally interacts with it, then clicks Save and
 *  returns the record the save handler received. Shared so the achieved-toggle
 *  block below asserts the PERSISTED value rather than growing a second copy. */
function save(
  description: string | undefined,
  beforeSave?: () => void,
) {
  const onSave = vi.fn();
  render(
    <MilestoneEditModal
      lang="en-US"
      milestone={{ id: 1, name: "M1", date: "2026-08-01", description, linkedTaskIds: [] }}
      isNew={false}
      tasks={[]}
      onSave={onSave}
      onDelete={vi.fn()}
      onClose={vi.fn()}
    />,
    { wrapper },
  );
  beforeSave?.();
  fireEvent.click(screen.getByRole("button", { name: t("en-US", "milestoneSave") }));
  return onSave.mock.calls[0][0] as { description?: string; achievedDate?: string };
}

describe("MilestoneEditModal rich-field write-path cap", () => {
  // ★★ Same regression as the RAID/change modals: `description` became a
  // RichTextEditor and nothing capped it on the way out, so an over-cap value
  // was persisted uncapped and only truncated on the NEXT load, inside
  // sanitizeRichText. This modal has no adjustment tracker, so the only
  // observable is the value handed to onSave.

  it("caps an over-cap description on the value it SAVES", () => {
    const saved = save(`<p>${"d".repeat(TEXTAREA_MAX + 40)}</p>`);
    expect(htmlTextLength(saved.description ?? "")).toBe(TEXTAREA_MAX);
  });

  it("leaves an under-cap description untouched", () => {
    expect(save("<p>fits fine</p>").description).toBe("<p>fits fine</p>");
  });
});

it("renders a new-milestone form without crashing", () => {
  render(
    <MilestoneEditModal
      lang="en-US"
      milestone={{ id: 1, name: "", date: "2026-08-01", linkedTaskIds: [] }}
      isNew
      tasks={[]}
      onSave={vi.fn()}
      onDelete={vi.fn()}
      onClose={vi.fn()}
    />,
    { wrapper },
  );
  expect(screen.getByText(/new milestone/i)).toBeTruthy();
});

describe("MilestoneEditModal — document links", () => {
  it("shows the SharePoint hint when M365 is off", () => {
    // documentLinks is a Full-only registry field, hidden at the Advanced
    // default — seed the Full tier so the Documents block renders.
    render(
      <>
        <Seed tier="full" />
        <MilestoneEditModal
          lang="en-US"
          milestone={{ id: 1, name: "M", date: "2026-01-01", linkedTaskIds: [] }}
          isNew
          tasks={[]}
          onSave={vi.fn()}
          onDelete={vi.fn()}
          onClose={vi.fn()}
        />
      </>,
      { wrapper },
    );
    expect(screen.getByText(/enable microsoft 365/i)).toBeInTheDocument();
  });
});

describe("MilestoneEditModal — field visibility", () => {
  // The required Name input is always shown; "Achieved" (milestoneAchieved) is
  // an Advanced field shown by default; documentLinks is Full-only and hidden
  // at the Advanced default. The cog popover is closed, so body labels are safe.
  const ACHIEVED_LABEL = t("en-US", "milestoneAchieved");

  function renderModal() {
    return render(
      <MilestoneEditModal
        lang="en-US"
        milestone={{ id: 1, name: "M", date: "2026-01-01", linkedTaskIds: [] }}
        isNew
        tasks={[]}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
      { wrapper },
    );
  }

  it("shows advanced fields and hides Full-only document links at the Advanced default", () => {
    renderModal();
    // Required Name input is always present.
    expect(screen.getByDisplayValue("M")).toBeInTheDocument();
    // Advanced field visible by default.
    expect(screen.getByText(ACHIEVED_LABEL)).toBeInTheDocument();
    // Full-only document-links block hidden at the Advanced default.
    expect(screen.queryByText(t("en-US", "documents"))).not.toBeInTheDocument();
  });

  it("hides advanced fields when switching to Simple while keeping the required Name input", () => {
    renderModal();
    expect(screen.getByText(ACHIEVED_LABEL)).toBeInTheDocument();

    selectFieldTier("fieldViewSimple");

    // Advanced field gone, required Name input remains.
    expect(screen.queryByText(ACHIEVED_LABEL)).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("M")).toBeInTheDocument();
  });
});

/** Shared single-milestone render. Hoisted to module scope so the achieved-toggle
 *  block below reuses it rather than growing a second copy. */
function renderWith(milestone: {
  id: number;
  name: string;
  date: string;
  description?: string;
  achievedDate?: string;
}) {
  return render(
    <MilestoneEditModal
      lang="en-US"
      milestone={{ ...milestone, linkedTaskIds: [] }}
      isNew={false}
      tasks={[]}
      onSave={vi.fn()}
      onDelete={vi.fn()}
      onClose={vi.fn()}
    />,
    { wrapper },
  );
}

describe("MilestoneEditModal — rich-text description (slice B)", () => {
  // The lean editor names its contenteditable surface with its `label` prop
  // (editorProps.attributes sets role="textbox" + aria-label), so the query is
  // by the same i18n key the visible field label uses.
  const DESC_LABEL = t("en-US", "milestoneDescription");

  it("renders the description in a rich-text editor, not a textarea", async () => {
    renderWith({ id: 1, name: "M", date: "2026-01-01", description: "<p>cutover</p>" });

    const editor = await screen.findByRole("textbox", { name: DESC_LABEL });
    expect(editor).toHaveAttribute("contenteditable", "true");
    expect(editor).toHaveTextContent("cutover");
  });

  it("shows a legacy plain description as text, not as escaped markup", async () => {
    // ★ The `<legacy>` token is what makes this test able to fail: a bare
    // "cost < 5k" round-trips identically whether or not it was escaped (the
    // HTML tokenizer emits "< " as literal text), so it would prove nothing.
    // A tag-shaped token is SWALLOWED as an unknown element when the raw
    // stored string is handed to the editor, and survives when descriptionHtml
    // escapes it first — which is exactly the upgrade under test.
    renderWith({
      id: 1,
      name: "M",
      date: "2026-01-01",
      description: "migrate <legacy> DB & archive",
    });

    const editor = await screen.findByRole("textbox", { name: DESC_LABEL });
    expect(editor).toHaveTextContent("migrate <legacy> DB & archive");
  });

  it("shows the new body when a different milestone is opened in place", async () => {
    // ★★ Proves `key={draft.id}`. Tiptap binds `content` at MOUNT only, and the
    // modal re-seeds its draft in a render-time reconcile without unmounting —
    // so opening B while A's editor is still mounted would leave A's body on
    // screen. This RERENDERS the same tree (it does not remount the modal), so
    // only the key can save it.
    const { rerender } = renderWith({ id: 1, name: "A", date: "2026-01-01", description: "<p>alpha</p>" });
    expect(await screen.findByRole("textbox", { name: DESC_LABEL })).toHaveTextContent("alpha");

    rerender(
      <MilestoneEditModal
        lang="en-US"
        milestone={{ id: 2, name: "B", date: "2026-02-01", description: "<p>beta</p>", linkedTaskIds: [] }}
        isNew={false}
        tasks={[]}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const editor = await screen.findByRole("textbox", { name: DESC_LABEL });
    expect(editor).toHaveTextContent("beta");
    expect(editor).not.toHaveTextContent("alpha");
  });
});

describe("achieved toggle", () => {
  const NAME = t("en-US", "milestoneAchieved");

  it("renders achieved as a toggle button reflecting the draft", () => {
    renderWith({ id: 1, name: "Go live", date: "2026-06-30" });
    expect(screen.getByRole("button", { name: NAME })).toHaveAttribute("aria-pressed", "false");
  });

  it("clears the date when an achieved milestone is unpressed", () => {
    renderWith({ id: 1, name: "Go live", date: "2026-06-30", achievedDate: "2026-06-28" });
    expect(screen.getByRole("button", { name: NAME })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: NAME }));
    expect(screen.getByRole("button", { name: NAME })).toHaveAttribute("aria-pressed", "false");
  });

  // ★★ The other direction, and the only test that sees the STORED VALUE.
  //    aria-pressed alone cannot catch the date shape: dropping `.slice(0, 10)`
  //    from `new Date().toISOString().slice(0, 10)` (milestone-edit-modal.tsx)
  //    persists a full timestamp into a date-only field across all six write
  //    paths while every aria-pressed assertion stays green. Replacing the
  //    handler's value with `undefined` fails the aria-pressed step instead.
  it("stamps a date-only value when an unachieved milestone is pressed", () => {
    const saved = save(undefined, () => {
      expect(screen.getByRole("button", { name: NAME })).toHaveAttribute("aria-pressed", "false");
      fireEvent.click(screen.getByRole("button", { name: NAME }));
      expect(screen.getByRole("button", { name: NAME })).toHaveAttribute("aria-pressed", "true");
    });
    expect(saved.achievedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("MilestoneEditModal — field wrappers", () => {
  // ★★ See src/test/label-binding.ts: a contenteditable is not labelable, so
  // the description `<label>` bound to the first BUTTON inside it instead —
  // the dictation mic in a real browser, Bold here.
  // ★★★ Two rows are FIXED but invisible to this test, so a REGRESSION in
  // either would leave it green: the Name row (fixed with `htmlFor`; the mic
  // outranks the `<Input>`, and jsdom has no SpeechRecognition so none renders)
  // and the document-links row (now `DocumentLinksGroup`; SharePoint mocked
  // off ⇒ bare `<p>`). `label-binding.guard.test.ts` reads SOURCE and covers both.
  it("binds no field label to a button", () => {
    render(
      <>
        <Seed tier="full" />
        <MilestoneEditModal
          lang="en-US"
          milestone={{ id: 1, name: "M", date: "2026-01-01", description: "<p>d</p>", linkedTaskIds: [] }}
          isNew={false}
          tasks={[]}
          onSave={vi.fn()}
          onDelete={vi.fn()}
          onClose={vi.fn()}
        />
      </>,
      { wrapper },
    );
    expectNoLabelBoundToButton();
  });
});

describe("milestone-edit-modal panel size", () => {
  it("opens at 1280x960, keeping the existing resize floor and viewport cap", () => {
    renderWith({ id: 1, name: "M1", date: "2026-06-01" });
    const panel = document.querySelector("[data-modal-panel]");
    expect(panel?.className).toContain("w-[1280px]");
    expect(panel?.className).toContain("h-[960px]");
    expect(panel?.className).toContain("min-w-[320px]");
    expect(panel?.className).toContain("min-h-[380px]");
    expect(panel?.className).toContain("max-h-[95vh]");
  });
});
