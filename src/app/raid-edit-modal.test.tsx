import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { useEffect, useRef, type ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { RaidEditModal } from "./raid-edit-modal";
import { applyTier } from "./field-visibility";
import { t } from "./i18n";
import { selectFieldTier } from "../test/field-tier";
import { ASSIGNEE_MAX, TASK_NAME_MAX, TEXTAREA_MAX } from "./sanitize";
import { htmlTextLength } from "./rich-text-plain";
import { ToastProvider } from "./toast-context";
import type { RaidItem } from "./types";
import { expectNoLabelBoundToButton } from "../test/label-binding";

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

function modalEl(over: Partial<RaidItem> = {}, onSave: (item: RaidItem) => void = vi.fn()) {
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
      onSave={onSave}
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

  it("hides advanced fields like Mitigation when switched to Simple, keeping Title", () => {
    render(modalEl({ category: "I" }), { wrapper });
    expect(screen.getByText(MITIGATION_LABEL)).toBeTruthy();

    selectFieldTier("fieldViewSimple");

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

  it("counts a legacy plain value the way the cap will measure it", async () => {
    // ★ The counter measured the RAW draft while capRich measures the UPGRADED
    // one. Identical for anything reachable today, because every load goes
    // through sanitizeRichText and the editor only emits "<p>…". They diverge
    // wherever descriptionHtml is NOT the identity — a legacy plain value, which
    // the "rich" sink's isHtmlStart test rejects (no `b` on
    // RICH_ALLOWED_TAGS — the list has `strong`, not `b`), so plainToHtml escapes its angle brackets and every
    // "<b>" becomes three VISIBLE characters instead of a stripped inline tag.
    //
    // ★★ Both fixtures have to be NEAR THE CAP. CharCounter renders a hidden
    // empty span below 80% of max (WARN_RATIO 0.8, TEXTAREA_MAX 5000 → 4000), so
    // a short value shows nothing either way and the test would be vacuous.
    //
    //   raw projection:      the tag stripped as inline markup     → 1 char
    //   upgraded projection: "&lt;b&gt;" decoded back to "<b>"     → 4202 / 4502
    //
    // So the bug renders NO counter at all and the fix renders one. Presence is
    // the assertion; the number confirms which projection produced it.
    const { container } = render(
      modalEl({
        description: "a " + "<b>".repeat(1400),
        mitigation: "m " + "<i>".repeat(1500),
      }),
      { wrapper },
    );
    await screen.findByRole("textbox", { name: DESC_LABEL });

    for (const [id, len] of [
      ["raid-description-counter", 4202],
      ["raid-mitigation-counter", 4502],
    ] as const) {
      const counter = container.querySelector(`#${id}`);
      expect(counter).not.toBeNull();
      expect(counter!.hasAttribute("hidden")).toBe(false);
      expect(counter).toHaveTextContent(`${len} / ${TEXTAREA_MAX}`);
    }
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

describe("RaidEditModal rich-field write-path cap", () => {
  /** Renders with a toast spy so the "N fields adjusted" count is observable. */
  function renderWithSpies(over: Partial<RaidItem>) {
    const onSave = vi.fn();
    const showToast = vi.fn();
    render(
      <ToastProvider value={{ showToast, showToastAction: vi.fn() }}>
        {modalEl(over, onSave)}
      </ToastProvider>,
      { wrapper },
    );
    return { onSave, showToast };
  }

  function submit() {
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "raidSave") }));
  }

  it("caps an over-cap rich field on the value it SAVES, and counts exactly that", async () => {
    // ★★ THE REGRESSION THIS PINS: when description/mitigation became
    // RichTextEditors they lost the `<Textarea onBlur>` handler that wrote the
    // truncated value back into the draft — only the COUNTING survived. So the
    // toast announced a truncation the save never made, the uncapped value went
    // to the workspace (handleSaveRaidItem does not sanitize), and the real
    // truncation landed invisibly on the NEXT load, inside sanitizeRichText.
    const { onSave, showToast } = renderWithSpies({
      description: `<p>${"d".repeat(TEXTAREA_MAX + 40)}</p>`,
      mitigation: "<p>short</p>",
    });
    await screen.findByRole("textbox", { name: t("en-US", "raidDescription") });
    submit();

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0] as RaidItem;
    // The SAVED value is capped — not merely counted. Measured as VISIBLE text,
    // which is what capHtmlText and sanitizeRichText both measure.
    expect(htmlTextLength(saved.description ?? "")).toBe(TEXTAREA_MAX);
    // ★ The under-cap sibling is byte-identical, so the count below can only
    // mean the one field that really was truncated.
    expect(saved.mitigation).toBe("<p>short</p>");
    expect(showToast).toHaveBeenCalledWith("info", t("en-US", "fieldsAdjusted", 1));
  });

  it("saves an under-cap draft untouched and announces nothing", async () => {
    // The other half of "the count matches reality": no truncation, no toast.
    // Without this, a capRich that always reported an adjustment would pass the
    // test above on its count assertion alone.
    const { onSave, showToast } = renderWithSpies({
      description: "<p>fits fine</p>",
      mitigation: "<p>also fine</p>",
    });
    await screen.findByRole("textbox", { name: t("en-US", "raidDescription") });
    submit();

    const saved = onSave.mock.calls[0][0] as RaidItem;
    expect(saved.description).toBe("<p>fits fine</p>");
    expect(saved.mitigation).toBe("<p>also fine</p>");
    expect(showToast).not.toHaveBeenCalled();
  });
});

describe("RaidEditModal plain-field cap on Enter-submit", () => {
  /** Renders with a toast spy so the "N fields adjusted" count is observable. */
  function renderWithSpies(over: Partial<RaidItem>) {
    const onSave = vi.fn();
    const showToast = vi.fn();
    render(
      <ToastProvider value={{ showToast, showToastAction: vi.fn() }}>
        {modalEl(over, onSave)}
      </ToastProvider>,
      { wrapper },
    );
    return { onSave, showToast };
  }

  /** ★★ Submit from INSIDE the title input. A click on Save blurs the field
   *  first, so the onBlur cap runs and the bug is invisible on that path —
   *  Enter is the one that submits without ever firing blur. */
  async function submitWithEnter() {
    await userEvent.click(screen.getByPlaceholderText(t("en-US", "raidPlaceholderTitle")));
    await userEvent.keyboard("{Enter}");
  }

  it("applies the title cap when the form is submitted with Enter", async () => {
    // ★★ THE REGRESSION THIS PINS: title/owner were capped only in onBlur, and
    // handleSubmit merely COUNTED the truncation. Enter-submit does not blur, so
    // the uncapped value went to onSave while the toast announced a truncation
    // that had not happened.
    const { onSave, showToast } = renderWithSpies({ title: "x".repeat(TASK_NAME_MAX + 20) });
    await screen.findByRole("textbox", { name: t("en-US", "raidDescription") });
    await submitWithEnter();

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0] as RaidItem;
    expect(saved.title.length).toBe(TASK_NAME_MAX);
    // The count and the save now describe the SAME operation.
    expect(showToast).toHaveBeenCalledWith("info", t("en-US", "fieldsAdjusted", 1));
  });

  it("applies the owner cap when the form is submitted with Enter", async () => {
    // ★ A non-blank title is deliberate: handleSubmit returns early on a blank
    // one, so onSave would never fire and the assertion would fail for the
    // wrong reason.
    const { onSave, showToast } = renderWithSpies({ title: "ok", owner: "y".repeat(ASSIGNEE_MAX + 20) });
    await screen.findByRole("textbox", { name: t("en-US", "raidDescription") });
    await submitWithEnter();

    const saved = onSave.mock.calls[0][0] as RaidItem;
    expect(saved.owner?.length).toBe(ASSIGNEE_MAX);
    expect(showToast).toHaveBeenCalledWith("info", t("en-US", "fieldsAdjusted", 1));
  });

  it("trims on Enter, and collapses a whitespace-only owner to undefined", async () => {
    // ★★ The cap fix ALSO changed the write path in a way no cap test can see:
    // the saved object went from `...draft` (verbatim) to `.trim()` and
    // `|| undefined`, so "  ok  " now saves as "ok" and a blank owner saves as
    // undefined rather than "". That is the same normalisation the onBlur
    // handlers already applied — which is exactly why it must be pinned HERE:
    // every cap fixture is already trimmed and non-empty, so deleting either
    // .trim() or the `|| undefined` leaves all of them green.
    const { onSave } = renderWithSpies({ title: "  ok  ", owner: "   " });
    await screen.findByRole("textbox", { name: t("en-US", "raidDescription") });
    await submitWithEnter();

    const saved = onSave.mock.calls[0][0] as RaidItem;
    expect(saved.title).toBe("ok");
    expect(saved.owner).toBeUndefined();
  });

  it("announces nothing on Enter when every plain field fits", async () => {
    // The other half of "the count matches reality" for this path: a capping
    // handleSubmit that always tracked an adjustment would pass the two tests
    // above on their toast assertion alone.
    const { onSave, showToast } = renderWithSpies({ title: "ok", owner: "Bob" });
    await screen.findByRole("textbox", { name: t("en-US", "raidDescription") });
    await submitWithEnter();

    const saved = onSave.mock.calls[0][0] as RaidItem;
    expect(saved.title).toBe("ok");
    expect(saved.owner).toBe("Bob");
    expect(showToast).not.toHaveBeenCalled();
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

describe("RaidEditModal — field wrappers", () => {
  // ★★ See src/test/label-binding.ts. Converted here: Category · Status ·
  // Severity (radiogroups — the severe case, a forwarded click WROTE the
  // field) plus description + mitigation (contenteditable — the click toggles
  // Bold). None of those five is a labelable element, so each `<label>`
  // adopted the first BUTTON inside it.
  // ★★★ Two rows are FIXED but invisible to this test, so a REGRESSION in
  // either would leave it green: the Title row (fixed with `htmlFor`; the mic
  // outranks the `<Input>`, and jsdom has no SpeechRecognition so none renders)
  // and the document-links row (now `DocumentLinksGroup`; SharePoint off ⇒
  // bare `<p>`). `label-binding.guard.test.ts` reads SOURCE and covers both.
  it("binds no field label to a button", () => {
    render(
      <>
        <Seed tier="full" />
        {modalEl({ category: "R" })}
      </>,
      { wrapper },
    );
    expectNoLabelBoundToButton();
  });
});

describe("raid-edit-modal panel size", () => {
  it("opens at 1280x960, keeping the existing resize floor and viewport cap", () => {
    render(modalEl(), { wrapper });
    const panel = document.querySelector("[data-modal-panel]");
    expect(panel?.className).toContain("w-[1280px]");
    expect(panel?.className).toContain("h-[960px]");
    expect(panel?.className).toContain("min-w-[460px]");
    expect(panel?.className).toContain("min-h-[420px]");
    expect(panel?.className).toContain("max-w-[95vw]");
    expect(panel?.className).toContain("max-h-[95vh]");
  });
});
