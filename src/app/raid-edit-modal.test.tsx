import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { useEffect, useRef, type ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { RaidEditModal } from "./raid-edit-modal";
import { applyTier } from "./field-visibility";
import { t } from "./i18n";
import { TEXTAREA_MAX } from "./sanitize";
import type { RaidItem } from "./types";

// ProseMirror (the description + mitigation RichTextEditors) touches layout
// APIs jsdom lacks; stub them so the editors mount. Mirrors notes-window /
// milestone-edit-modal tests.
beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore jsdom polyfill
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore jsdom polyfill
  Range.prototype.getBoundingClientRect = () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) });
});

function makeDraft(over: Partial<RaidItem> = {}): RaidItem {
  return {
    id: 1,
    title: "Server outage risk",
    category: "R",
    status: "Open",
    raisedDate: "2026-01-01",
    probability: 3,
    impact: 3,
    severity: "Medium",
    linkedTaskIds: [],
    causedByRaidIds: [],
    stakeholderIds: [],
    ...over,
  };
}

function modalEl(over: Partial<RaidItem> = {}) {
  return (
    <RaidEditModal
      lang="en-US"
      tasks={[]}
      raid={[]}
      stakeholdersEnabled
      stakeholders={[]}
      resources={[]}
      contacts={[]}
      onCreateResource={vi.fn(() => 1)}
      draft={makeDraft(over)}
      isNew={false}
      onChange={vi.fn()}
      onApplyStatus={vi.fn()}
      onApplyMatrix={vi.fn()}
      onSave={vi.fn()}
      onCancel={vi.fn()}
      onDelete={vi.fn()}
      onCreateMitigationTask={vi.fn()}
      onJumpToRaid={vi.fn()}
    />
  );
}

/** Seeds the workspace field-visibility config once on mount (e.g. Full view). */
function Seed({ tier }: { tier: "full" }) {
  const { setFieldVisibility } = useWorkspace();
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    setFieldVisibility(() => ({ raid: applyTier("raid", tier) }));
  }, [setFieldVisibility, tier]);
  return null;
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </FiltersProvider>
  );
}

// The modal body renders the full field labels (raidMitigation / raidRiskMatrix),
// distinct from the cog checklist labels (mitigation / riskMatrix).
const MITIGATION_LABEL = t("en-US", "raidMitigation");
const RISK_MATRIX_LABEL = t("en-US", "raidRiskMatrix");
const TITLE_HINT = t("en-US", "raidFieldTitleHint");

describe("RaidEditModal InfoTooltip hints", () => {
  it("renders the Title field InfoTooltip reachable by accessible name", () => {
    render(modalEl(), { wrapper });
    // InfoTooltip renders a span[role=button] with aria-label = hint text
    expect(screen.getByRole("button", { name: TITLE_HINT })).toBeTruthy();
  });

  it("Title input no longer carries a native title attribute", () => {
    render(modalEl(), { wrapper });
    // The title input is identified by its placeholder text
    const input = screen.getByPlaceholderText(t("en-US", "raidPlaceholderTitle"));
    expect(input.getAttribute("title")).toBeNull();
  });

  it("Delete hint is an InfoTooltip, and the Delete button carries no native title", () => {
    render(modalEl(), { wrapper });
    // The hint now renders as an InfoTooltip span[role=button]…
    expect(screen.getByRole("button", { name: t("en-US", "raidFieldDeleteHint") })).toBeTruthy();
    // …and the Delete action button itself no longer has a native title attribute.
    const del = screen.getByRole("button", { name: t("en-US", "raidDelete") });
    expect(del.getAttribute("title")).toBeNull();
  });
});

describe("RaidEditModal field visibility", () => {
  it("shows advanced fields and hides Full-only fields by default (Advanced)", () => {
    // Use a non-Risk draft so the matrix only appears via the riskMatrix field
    // guard (Full-only), not the category branch.
    render(modalEl({ category: "I" }), { wrapper });
    expect(screen.getByText(MITIGATION_LABEL)).toBeTruthy();
    expect(screen.queryByText(RISK_MATRIX_LABEL)).toBeNull();
    expect(screen.getByText(/Title/)).toBeTruthy();
  });

  it("hides advanced fields like Mitigation when switched to Simple, keeping Title", async () => {
    const user = userEvent.setup();
    render(modalEl({ category: "I" }), { wrapper });
    expect(screen.getByText(MITIGATION_LABEL)).toBeTruthy();

    await user.click(
      screen.getByRole("button", { name: t("en-US", "fieldViewSimple") }),
    );

    expect(screen.queryByText(MITIGATION_LABEL)).toBeNull();
    expect(screen.getByText(/Title/)).toBeTruthy();
  });

  it("shows the risk matrix for a Risk item in Full tier", () => {
    render(
      <>
        <Seed tier="full" />
        {modalEl({ category: "R" })}
      </>,
      { wrapper },
    );
    expect(screen.getByText(RISK_MATRIX_LABEL)).toBeTruthy();
  });
});

describe("RaidEditModal — rich-text description and mitigation (slice B)", () => {
  // The lean editor names its contenteditable surface with its `label` prop
  // (editorProps.attributes sets role="textbox" + aria-label), so both queries
  // use the same i18n keys the visible field labels use.
  const DESC_LABEL = t("en-US", "raidDescription");
  const MIT_LABEL = t("en-US", "raidMitigation");

  it("renders BOTH fields as rich-text editors, not textareas", async () => {
    render(modalEl({ description: "<p>slipped</p>", mitigation: "<p>escalate</p>" }), { wrapper });

    for (const [name, body] of [[DESC_LABEL, "slipped"], [MIT_LABEL, "escalate"]] as const) {
      const editor = await screen.findByRole("textbox", { name });
      expect(editor).toHaveAttribute("contenteditable", "true");
      expect(editor).toHaveTextContent(body);
    }
  });

  it("shows a legacy plain value as text in EACH field, not as escaped markup", async () => {
    // ★ The `<legacy>` / `<vendor>` tokens are what make this able to fail: a
    // bare "cost < 5k" round-trips identically whether or not it was escaped
    // (the HTML tokenizer only opens a tag before an ASCII letter), so it would
    // prove nothing. A tag-shaped token is SWALLOWED as an unknown element when
    // the raw stored string is handed to the editor, and survives when
    // descriptionHtml escapes it first — exactly the upgrade under test.
    render(
      modalEl({
        description: "migrate <legacy> DB & archive",
        mitigation: "call <vendor> now",
      }),
      { wrapper },
    );

    expect(await screen.findByRole("textbox", { name: DESC_LABEL })).toHaveTextContent(
      "migrate <legacy> DB & archive",
    );
    expect(await screen.findByRole("textbox", { name: MIT_LABEL })).toHaveTextContent(
      "call <vendor> now",
    );
  });

  it("shows the new bodies when a different RAID item is opened in place", async () => {
    // ★★ Proves the per-field `key`. Tiptap binds `content` at MOUNT only, and
    // the panel re-seeds this modal's draft in place (the modal itself only
    // re-runs a render-time reconcile, it does not unmount) — so jumping to
    // item 2 while item 1's editors are still mounted would leave item 1's
    // bodies on screen. This RERENDERS the same tree, so only the key saves it.
    const { rerender } = render(
      modalEl({ id: 1, description: "<p>alpha desc</p>", mitigation: "<p>alpha mit</p>" }),
      { wrapper },
    );
    expect(await screen.findByRole("textbox", { name: DESC_LABEL })).toHaveTextContent("alpha desc");
    expect(await screen.findByRole("textbox", { name: MIT_LABEL })).toHaveTextContent("alpha mit");

    rerender(modalEl({ id: 2, description: "<p>beta desc</p>", mitigation: "<p>beta mit</p>" }));

    const desc = await screen.findByRole("textbox", { name: DESC_LABEL });
    expect(desc).toHaveTextContent("beta desc");
    expect(desc).not.toHaveTextContent("alpha desc");

    const mit = await screen.findByRole("textbox", { name: MIT_LABEL });
    expect(mit).toHaveTextContent("beta mit");
    expect(mit).not.toHaveTextContent("alpha mit");
  });

  it("counts visible characters, not markup, in each counter", async () => {
    // ★ The cap (sanitizeRichText) measures the VISIBLE text, so the counter
    // must too — otherwise markup charges against the user's 5000 and the two
    // disagree at the boundary. Both bodies sit above the counter's 80% reveal
    // threshold; the raw-string lengths (4996+24 and 4500+24) differ from the
    // text lengths, and 5020 would additionally read as at-cap.
    const { container } = render(
      modalEl({
        description: `<p><strong>${"z".repeat(4996)}</strong></p>`,
        mitigation: `<p><strong>${"y".repeat(4500)}</strong></p>`,
      }),
      { wrapper },
    );
    await screen.findByRole("textbox", { name: DESC_LABEL });

    expect(container.querySelector("#raid-description-counter")).toHaveTextContent(
      `4996 / ${TEXTAREA_MAX}`,
    );
    expect(container.querySelector("#raid-mitigation-counter")).toHaveTextContent(
      `4500 / ${TEXTAREA_MAX}`,
    );
  });

  it("keeps the editors mounted across successive edits of the same item", async () => {
    // ★★ RAID's draft is PARENT-OWNED and `onChange({...draft, …})` mints a new
    // draft object on every keystroke. The key must therefore depend only on
    // draft.id — keying on the draft object (or on its body) would remount
    // Tiptap on each character and destroy the caret. Two successive edits of
    // the same item must leave the very same DOM node in place.
    const { rerender } = render(modalEl({ id: 7, description: "<p>a</p>", mitigation: "<p>m</p>" }), {
      wrapper,
    });
    const firstDesc = await screen.findByRole("textbox", { name: DESC_LABEL });
    const firstMit = await screen.findByRole("textbox", { name: MIT_LABEL });

    rerender(modalEl({ id: 7, description: "<p>ab</p>", mitigation: "<p>mi</p>" }));
    expect(await screen.findByRole("textbox", { name: DESC_LABEL })).toBe(firstDesc);
    expect(await screen.findByRole("textbox", { name: MIT_LABEL })).toBe(firstMit);

    rerender(modalEl({ id: 7, description: "<p>abc</p>", mitigation: "<p>mit</p>" }));
    expect(await screen.findByRole("textbox", { name: DESC_LABEL })).toBe(firstDesc);
    expect(await screen.findByRole("textbox", { name: MIT_LABEL })).toBe(firstMit);
  });
});

describe("RaidEditModal drag/resize chrome", () => {
  it("restores the saved position + size and the reset button clears both", () => {
    window.localStorage.setItem("aipm-cockpit:modal-pos:raid-edit", JSON.stringify({ x: 30, y: 40 }));
    window.localStorage.setItem("aipm-cockpit:modal-size:raid-edit", JSON.stringify({ width: 600, height: 500 }));
    const { container } = render(modalEl(), { wrapper });
    const panel = container.querySelector("[data-modal-panel]") as HTMLElement;
    expect(panel.style.transform).toContain("translate(30px, 40px)");
    expect(panel.style.width).toBe("600px");
    expect(panel.style.height).toBe("500px");

    fireEvent.click(screen.getByRole("button", { name: t("en-US", "modalResetSize") }));
    expect(window.localStorage.getItem("aipm-cockpit:modal-pos:raid-edit")).toBeNull();
    expect(window.localStorage.getItem("aipm-cockpit:modal-size:raid-edit")).toBeNull();
    expect(panel.style.transform).toContain("translate(0px, 0px)");
    expect(panel.style.width).toBe("");
    expect(panel.style.height).toBe("");
  });
});
