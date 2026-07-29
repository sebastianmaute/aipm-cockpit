import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useRef, type ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { ChangeEditModal } from "./change-edit-modal";
import { applyTier } from "./field-visibility";
import { t } from "./i18n";
import { TEXTAREA_MAX } from "./sanitize";
import { htmlTextLength } from "./rich-text-plain";
import { ToastProvider } from "./toast-context";
import type { ChangeItem, Stakeholder } from "./types";

// ProseMirror (the three RichTextEditors) touches layout APIs jsdom lacks; stub
// them so the editors mount. Mirrors raid-edit-modal / milestone-edit-modal.
beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore jsdom polyfill
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore jsdom polyfill
  Range.prototype.getBoundingClientRect = () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) });
});

// Mock M365 hooks consumed by KnowledgeLinksFieldGated — default: SharePoint off.
vi.mock("./use-settings", () => ({
  useSettings: () => ({ settings: { integrations: { m365: { enabled: false, sharepoint: false } } }, setSettings: vi.fn(), hydrated: true, i18nReady: true, lang: "en-US" }),
}));
vi.mock("./use-ms-auth", () => ({
  useMsAuth: () => ({ account: null, ready: true, signIn: vi.fn(), signOut: vi.fn(), acquireToken: vi.fn(async () => "tok") }),
}));

const draft: ChangeItem = { id: 1, title: "Widen scope", description: "", type: "Scope", status: "Proposed", raisedDate: "2026-06-01", linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [] };
const base = {
  lang: "en-US" as const, tasks: [], raid: [], draft, isNew: false,
  onChange: vi.fn(), onApplyStatus: vi.fn(), onSave: vi.fn(), onCancel: vi.fn(), onDelete: vi.fn(),
};

function change(over: Partial<ChangeItem> = {}): ChangeItem {
  return { ...draft, ...over };
}
function s(id: number, name: string): Stakeholder {
  return { id, name, category: "Internal", influence: "Medium", interest: "Medium", raci: {} };
}

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
    setFieldVisibility(() => ({ change: applyTier("change", tier) }));
  }, [setFieldVisibility, tier]);
  return null;
}

function renderModal(over: Partial<React.ComponentProps<typeof ChangeEditModal>> = {}) {
  return render(<ChangeEditModal {...base} {...over} />, { wrapper });
}

/** Render with the Full tier seeded, so Full-only fields (links) are present. */
function renderModalFull(over: Partial<React.ComponentProps<typeof ChangeEditModal>> = {}) {
  return render(
    <>
      <Seed tier="full" />
      <ChangeEditModal {...base} {...over} />
    </>,
    { wrapper },
  );
}

describe("ChangeEditModal", () => {
  // ★★ Same as the stakeholder modal: this one stacked a window-level
  // `useEscapeKey(onCancel)` on top of Modal's own Escape handling. It ignored
  // `defaultPrevented`, and only avoided discarding drafts because the linked-
  // tasks picker ALSO calls stopPropagation — an accident, not a design.
  // Removing it left nothing asserting Escape still closes this modal.
  it("closes on Escape", () => {
    const onCancel = vi.fn();
    renderModal({ onCancel });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("does not close on an Escape a descendant already consumed", () => {
    const onCancel = vi.fn();
    renderModal({ onCancel });
    const consumed = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    consumed.preventDefault();
    document.dispatchEvent(consumed);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("renders the title field, a type select, and a status select", () => {
    const { getByDisplayValue } = renderModal();
    expect(getByDisplayValue("Widen scope")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: t("en-US", "changeFieldType") })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: t("en-US", "changeFieldStatus") })).toBeTruthy();
  });
  it("calls onApplyStatus when the status changes", () => {
    const onApplyStatus = vi.fn();
    renderModal({ onApplyStatus });
    const sel = screen.getByRole("combobox", { name: t("en-US", "changeFieldStatus") }) as HTMLSelectElement;
    sel.value = "Approved";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onApplyStatus).toHaveBeenCalledWith("Approved");
  });
  it("calls onSave / onCancel from the footer buttons", () => {
    const onSave = vi.fn(), onCancel = vi.fn();
    const { getByRole } = renderModal({ onSave, onCancel });
    getByRole("button", { name: /save/i }).click();
    getByRole("button", { name: /cancel/i }).click();
    expect(onSave).toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });
});

describe("ChangeEditModal — document links", () => {
  it("shows the SharePoint hint when M365 is off", () => {
    renderModal();
    expect(screen.getByText(/enable microsoft 365/i)).toBeInTheDocument();
  });
});

describe("ChangeEditModal — stakeholders", () => {
  it("edits linked stakeholders when stakeholders module is enabled", () => {
    const onChange = vi.fn();
    // Stakeholders live in the Full-only `links` group, so seed the Full tier.
    renderModalFull({ stakeholdersEnabled: true, stakeholders: [s(3, "Dana"), s(7, "Lee")], draft: change({ stakeholderIds: [] }), onChange });
    fireEvent.click(screen.getByLabelText("Dana"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ stakeholderIds: [3] }));
  });
  it("hides the stakeholder picker when the module is disabled", () => {
    renderModalFull({ stakeholdersEnabled: false, stakeholders: [s(3, "Dana")], draft: change({ stakeholderIds: [] }) });
    expect(screen.queryByText(t("en-US", "fieldStakeholders"))).not.toBeInTheDocument();
  });
});

describe("ChangeEditModal — field visibility", () => {
  // The modal body labels (changeFieldRequestedBy / changeFieldLinkedTasks)
  // double as cog-checklist labels, so target the BODY inputs/labels to stay
  // distinct from the cog popover (which is closed by default anyway).
  const REQUESTOR_LABEL = t("en-US", "changeFieldRequestedBy");
  const LINKED_TASKS_LABEL = t("en-US", "changeFieldLinkedTasks");

  it("shows advanced fields and hides Full-only links by default (Advanced)", () => {
    renderModal();
    // Advanced-tier field present.
    expect(screen.getByText(REQUESTOR_LABEL)).toBeTruthy();
    // Full-only `links` group (linked tasks) absent.
    expect(screen.queryByText(LINKED_TASKS_LABEL)).toBeNull();
    // Required Title input always rendered.
    expect(screen.getByDisplayValue("Widen scope")).toBeTruthy();
  });

  it("hides advanced fields like Requested-by when switched to Simple, keeping Title", async () => {
    const user = userEvent.setup();
    renderModal();
    expect(screen.getByText(REQUESTOR_LABEL)).toBeTruthy();

    await user.click(
      screen.getByRole("button", { name: t("en-US", "fieldViewSimple") }),
    );

    expect(screen.queryByText(REQUESTOR_LABEL)).toBeNull();
    expect(screen.getByDisplayValue("Widen scope")).toBeTruthy();
  });

  it("shows the Full-only linked-tasks group in Full tier", () => {
    renderModalFull();
    expect(screen.getByText(LINKED_TASKS_LABEL)).toBeTruthy();
  });
});

describe("ChangeEditModal — edit heading", () => {
  it("shows 'Edit change' heading when editing an existing item", () => {
    renderModal({ isNew: false });
    expect(screen.getByRole("heading", { name: t("en-US", "changeEditTitle") })).toBeInTheDocument();
  });
});

describe("ChangeEditModal — rich-text description fields (slice B)", () => {
  // The lean editor names its contenteditable surface with its `label` prop
  // (editorProps.attributes sets role="textbox" + aria-label), so each query
  // uses the same i18n key the visible field label uses. All three strings are
  // distinct full names ("Description" / "Impact description" / "Resolution /
  // rationale"), and getByRole name matching is exact, so they cannot collide.
  const DESC_LABEL = t("en-US", "changeFieldDescription");
  const IMPACT_LABEL = t("en-US", "changeFieldImpactDescription");
  const RESOLUTION_LABEL = t("en-US", "changeFieldResolution");

  /** A bare element (not rendered) so a test can `rerender` the same tree. */
  function modalEl(over: Partial<ChangeItem> = {}) {
    return <ChangeEditModal {...base} draft={change(over)} />;
  }

  it("renders ALL THREE fields as rich-text editors, not textareas", async () => {
    render(
      modalEl({
        description: "<p>widen the scope</p>",
        impactDescription: "<p>two extra sprints</p>",
        resolutionNotes: "<p>board approved</p>",
      }),
      { wrapper },
    );

    const desc = await screen.findByRole("textbox", { name: DESC_LABEL });
    expect(desc).toHaveAttribute("contenteditable", "true");
    expect(desc).toHaveTextContent("widen the scope");

    const impact = await screen.findByRole("textbox", { name: IMPACT_LABEL });
    expect(impact).toHaveAttribute("contenteditable", "true");
    expect(impact).toHaveTextContent("two extra sprints");

    const resolution = await screen.findByRole("textbox", { name: RESOLUTION_LABEL });
    expect(resolution).toHaveAttribute("contenteditable", "true");
    expect(resolution).toHaveTextContent("board approved");
  });

  it("shows a legacy plain value as text in EACH field, not as escaped markup", async () => {
    // ★ The tag-shaped tokens are what make this able to fail: a bare
    // "cost < 5k" round-trips identically whether or not it was escaped (the
    // HTML tokenizer only opens a tag before an ASCII letter), so it would
    // prove nothing. A tag-shaped token is SWALLOWED as an unknown element when
    // the raw stored string is handed to the editor, and survives when
    // descriptionHtml escapes it first — exactly the upgrade under test. Each
    // field gets a DIFFERENT token so a copy-pasted assertion cannot pass by
    // accident against the wrong editor.
    render(
      modalEl({
        description: "migrate <legacy> DB & archive",
        impactDescription: "retire <adapter> shim & rewire",
        resolutionNotes: "approved <phase2> rollout & sign-off",
      }),
      { wrapper },
    );

    expect(await screen.findByRole("textbox", { name: DESC_LABEL })).toHaveTextContent(
      "migrate <legacy> DB & archive",
    );
    expect(await screen.findByRole("textbox", { name: IMPACT_LABEL })).toHaveTextContent(
      "retire <adapter> shim & rewire",
    );
    expect(await screen.findByRole("textbox", { name: RESOLUTION_LABEL })).toHaveTextContent(
      "approved <phase2> rollout & sign-off",
    );
  });

  it("shows the new bodies in all three fields when a different change is opened in place", async () => {
    // ★★ Proves the per-field `key`. Tiptap binds `content` at MOUNT only, and
    // the panel re-seeds this modal's draft in place (the modal itself never
    // unmounts) — so jumping to item 2 while item 1's editors are still mounted
    // would leave item 1's bodies on screen. This RERENDERS the same tree, so
    // only the key saves it.
    const { rerender } = render(
      modalEl({
        id: 1,
        description: "<p>alpha desc</p>",
        impactDescription: "<p>alpha impact</p>",
        resolutionNotes: "<p>alpha resolution</p>",
      }),
      { wrapper },
    );
    expect(await screen.findByRole("textbox", { name: DESC_LABEL })).toHaveTextContent("alpha desc");

    rerender(
      modalEl({
        id: 2,
        description: "<p>beta desc</p>",
        impactDescription: "<p>beta impact</p>",
        resolutionNotes: "<p>beta resolution</p>",
      }),
    );

    const desc = await screen.findByRole("textbox", { name: DESC_LABEL });
    expect(desc).toHaveTextContent("beta desc");
    expect(desc).not.toHaveTextContent("alpha desc");

    const impact = await screen.findByRole("textbox", { name: IMPACT_LABEL });
    expect(impact).toHaveTextContent("beta impact");
    expect(impact).not.toHaveTextContent("alpha impact");

    const resolution = await screen.findByRole("textbox", { name: RESOLUTION_LABEL });
    expect(resolution).toHaveTextContent("beta resolution");
    expect(resolution).not.toHaveTextContent("alpha resolution");
  });

  it("counts visible characters, not markup, in each of the three counters", async () => {
    // ★ The cap (sanitizeRichText) measures the VISIBLE text, so each counter
    // must too — otherwise markup charges against the user's 5000 and the two
    // disagree at the boundary. All three bodies sit above the counter's 80%
    // reveal threshold, and each raw-string length (text + 24 markup chars)
    // differs from its text length. Three DIFFERENT lengths, so a counter
    // reading the wrong field's value would also fail.
    const { container } = render(
      modalEl({
        description: `<p><strong>${"z".repeat(4996)}</strong></p>`,
        impactDescription: `<p><strong>${"w".repeat(4700)}</strong></p>`,
        resolutionNotes: `<p><strong>${"q".repeat(4300)}</strong></p>`,
      }),
      { wrapper },
    );
    await screen.findByRole("textbox", { name: DESC_LABEL });

    expect(container.querySelector("#change-description-counter")).toHaveTextContent(
      `4996 / ${TEXTAREA_MAX}`,
    );
    expect(container.querySelector("#change-impactDescription-counter")).toHaveTextContent(
      `4700 / ${TEXTAREA_MAX}`,
    );
    expect(container.querySelector("#change-resolutionNotes-counter")).toHaveTextContent(
      `4300 / ${TEXTAREA_MAX}`,
    );
  });

  it("keeps the editors mounted across successive edits of the same change", async () => {
    // ★★ This modal's draft is PARENT-OWNED and `onChange({...draft, …})` mints
    // a new draft object on every keystroke. The key must therefore depend only
    // on draft.id — keying on the draft object (or on a body) would remount
    // Tiptap on each character and destroy the caret. Two successive edits of
    // the same item must leave the very same DOM nodes in place.
    const { rerender } = render(
      modalEl({ id: 7, description: "<p>a</p>", impactDescription: "<p>i</p>", resolutionNotes: "<p>r</p>" }),
      { wrapper },
    );
    const firstDesc = await screen.findByRole("textbox", { name: DESC_LABEL });
    const firstImpact = await screen.findByRole("textbox", { name: IMPACT_LABEL });
    const firstResolution = await screen.findByRole("textbox", { name: RESOLUTION_LABEL });

    rerender(
      modalEl({ id: 7, description: "<p>ab</p>", impactDescription: "<p>im</p>", resolutionNotes: "<p>re</p>" }),
    );
    expect(await screen.findByRole("textbox", { name: DESC_LABEL })).toBe(firstDesc);
    expect(await screen.findByRole("textbox", { name: IMPACT_LABEL })).toBe(firstImpact);
    expect(await screen.findByRole("textbox", { name: RESOLUTION_LABEL })).toBe(firstResolution);

    rerender(
      modalEl({ id: 7, description: "<p>abc</p>", impactDescription: "<p>imp</p>", resolutionNotes: "<p>res</p>" }),
    );
    expect(await screen.findByRole("textbox", { name: DESC_LABEL })).toBe(firstDesc);
    expect(await screen.findByRole("textbox", { name: IMPACT_LABEL })).toBe(firstImpact);
    expect(await screen.findByRole("textbox", { name: RESOLUTION_LABEL })).toBe(firstResolution);
  });
});

describe("ChangeEditModal rich-field write-path cap", () => {
  /** Renders with a toast spy so the "N fields adjusted" count is observable. */
  function renderWithSpies(over: Partial<ChangeItem>) {
    const onSave = vi.fn();
    const showToast = vi.fn();
    render(
      <ToastProvider value={{ showToast, showToastAction: vi.fn() }}>
        <ChangeEditModal {...base} draft={change(over)} onSave={onSave} />
      </ToastProvider>,
      { wrapper },
    );
    return { onSave, showToast };
  }

  function submit() {
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "raidSave") }));
  }

  it("caps an over-cap rich field on the value it SAVES, and counts exactly that", async () => {
    // ★★ THE REGRESSION THIS PINS: when the three rich fields became
    // RichTextEditors they lost the `<Textarea onBlur>` handler that wrote the
    // truncated value back into the draft — only the COUNTING survived. So the
    // toast announced a truncation the save never made, the uncapped value went
    // to the workspace, and the real truncation landed invisibly on the NEXT
    // load, inside sanitizeRichText.
    const { onSave, showToast } = renderWithSpies({
      description: `<p>${"d".repeat(TEXTAREA_MAX + 40)}</p>`,
      resolutionNotes: "<p>short</p>",
    });
    await screen.findByRole("textbox", { name: t("en-US", "changeFieldDescription") });
    submit();

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0] as ChangeItem;
    // The SAVED value is capped — not merely counted. Measured as VISIBLE text,
    // which is what capHtmlText and sanitizeRichText both measure.
    expect(htmlTextLength(saved.description)).toBe(TEXTAREA_MAX);
    // ★ The under-cap sibling is byte-identical, so the count below can only
    // mean the one field that really was truncated.
    expect(saved.resolutionNotes).toBe("<p>short</p>");
    expect(showToast).toHaveBeenCalledWith("info", t("en-US", "fieldsAdjusted", 1));
  });

  it("saves an under-cap draft untouched and announces nothing", async () => {
    // The other half of "the count matches reality": no truncation, no toast.
    const { onSave, showToast } = renderWithSpies({
      description: "<p>fits fine</p>",
      resolutionNotes: "<p>also fine</p>",
    });
    await screen.findByRole("textbox", { name: t("en-US", "changeFieldDescription") });
    submit();

    const saved = onSave.mock.calls[0][0] as ChangeItem;
    expect(saved.description).toBe("<p>fits fine</p>");
    expect(saved.resolutionNotes).toBe("<p>also fine</p>");
    expect(showToast).not.toHaveBeenCalled();
  });
});

describe("ChangeEditModal — field tooltips", () => {
  it("renders an InfoTooltip for the Title field (accessible by hint text as aria-label)", () => {
    renderModal();
    expect(screen.getByRole("button", { name: t("en-US", "changeFieldTitleHint") })).toBeInTheDocument();
  });
});
