import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RaciPanel } from "./raci-panel";
import { t } from "./i18n";
import { expectButtonOrder } from "../test/toolbar-order";
import { expectRowUniqueNames } from "../test/row-unique-names";
import type { Stakeholder, Milestone } from "./types";

// "Suggest RACI" (use-raci-suggest) reads settings.ai via useSettings(); mocked
// (mirrors resources-panel.test.tsx) so a single test can flip AI on without
// waiting on the real localStorage/secrets hydration path. Every OTHER test in
// this file gets the same default (AI off) the real hook would resolve to for
// an unseeded localStorage, so this is a no-op for them.
vi.mock("./use-settings", () => ({ useSettings: vi.fn() }));

import { useSettings } from "./use-settings";
import { defaultSettings, type Settings } from "./settings-types";
const mockUseSettings = useSettings as ReturnType<typeof vi.fn>;

function stubSettings(settings: Settings) {
  mockUseSettings.mockReturnValue({
    settings,
    setSettings: vi.fn(),
    hydrated: true,
    i18nReady: true,
    lang: "en-US" as const,
  });
}

const AI_ON: Settings = {
  ...defaultSettings,
  ai: { ...defaultSettings.ai, enabled: true, apiKey: "sk-ant-test", model: "claude-x" },
};

beforeEach(() => {
  stubSettings(defaultSettings);
});

const stakeholders: Stakeholder[] = [
  { id: 1, name: "Sam", category: "Sponsor", influence: "High", interest: "High", raci: { "10": "A" } },
  { id: 2, name: "Lee", category: "Internal", influence: "Medium", interest: "High", raci: { "10": "A" } },
];
const milestones: Milestone[] = [{ id: 10, name: "Go-Live", date: "2026-09-01", linkedTaskIds: [] }];

describe("RaciPanel", () => {
  it("flags milestones with multiple Accountable", () => {
    render(<RaciPanel lang="en-US" stakeholders={stakeholders} milestones={milestones} onSave={vi.fn()} />);
    expect(screen.getByText(/multiple accountable/i)).toBeInTheDocument();
  });
  it("edits a cell and saves the stakeholder", () => {
    const onSave = vi.fn();
    render(<RaciPanel lang="en-US" stakeholders={stakeholders} milestones={milestones} onSave={onSave} />);
    // Collapsed trigger aria-label: "{milestone} · {stakeholder} — {currentRoleLabel}".
    // Sam's cell holds "A", so expand it then pick the "R" role chip in the popover.
    const trigger = screen.getByRole("button", { name: /Go-Live · Sam.*Accountable/i });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "R" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ id: 1, raci: { "10": "R" } }));
  });
  it("shows an empty state when there are no milestones", () => {
    render(<RaciPanel lang="en-US" stakeholders={stakeholders} milestones={[]} onSave={vi.fn()} />);
    expect(screen.getByText(/add milestones/i)).toBeInTheDocument();
  });
  it("renders a reset-size button (resizable pane)", () => {
    render(<RaciPanel lang="en-US" stakeholders={stakeholders} milestones={milestones} onSave={vi.fn()} />);
    expect(screen.getByRole("button", { name: /reset back to the default size/i })).toBeInTheDocument();
  });

  it("additive person filter: add narrows columns, remove and clear restore all", () => {
    render(<RaciPanel lang="en-US" stakeholders={stakeholders} milestones={milestones} onSave={vi.fn()} />);

    // (a) initially all stakeholder columns show
    expect(screen.getByRole("columnheader", { name: "Sam" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Lee" })).toBeInTheDocument();

    // (b) adding one person narrows visibleStakeholders to just them
    const input = screen.getByRole("combobox", { name: /filter people/i });
    fireEvent.change(input, { target: { value: "Sam" } });
    expect(screen.getByRole("columnheader", { name: "Sam" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Lee" })).not.toBeInTheDocument();

    // (c) removing the chip restores all columns
    fireEvent.click(screen.getByRole("button", { name: /remove sam from filter/i }));
    expect(screen.getByRole("columnheader", { name: "Sam" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Lee" })).toBeInTheDocument();

    // (d) Clear empties the set → all shown again
    fireEvent.change(input, { target: { value: "Lee" } });
    expect(screen.queryByRole("columnheader", { name: "Sam" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /clear filter/i }));
    expect(screen.getByRole("columnheader", { name: "Sam" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Lee" })).toBeInTheDocument();
  });

  // The add field auto-adds on an exact-label onChange match, so the ✕ must go
  // through the state setter and NOT re-enter that handler.
  it("clears the add field without adding anyone", async () => {
    render(<RaciPanel lang="en-US" stakeholders={stakeholders} milestones={milestones} onSave={vi.fn()} />);
    const field = screen.getByLabelText("Filter people…") as HTMLInputElement;
    await userEvent.type(field, "Ann");
    await userEvent.click(screen.getByRole("button", { name: "Clear – Filter people…" }));
    // ★ Headline claim FIRST: a weaker assertion placed ahead of it becomes the
    //   reported failure and the real claim never runs. One chip = one added
    //   person, so zero remove-buttons means nobody was added.
    expect(screen.queryAllByRole("button", { name: /from filter/i })).toHaveLength(0);
    expect(field.value).toBe("");
  });

  it("disambiguates duplicate stakeholder names with a row token so the second is selectable", () => {
    const dup: Stakeholder[] = [
      { id: 1, name: "Sam", category: "Sponsor", influence: "High", interest: "High", raci: { "10": "A" } },
      { id: 2, name: "Lee", category: "Internal", influence: "Medium", interest: "High", raci: { "10": "R" } },
      { id: 3, name: "Sam", category: "Internal", influence: "Low", interest: "Low", raci: { "10": "C" } },
    ];
    render(<RaciPanel lang="en-US" stakeholders={dup} milestones={milestones} onSave={vi.fn()} />);

    // The shared name is disambiguated in the picker; the unique one stays bare.
    expect(document.querySelector('option[value="Sam (1)"]')).not.toBeNull();
    expect(document.querySelector('option[value="Sam (2)"]')).not.toBeNull();
    expect(document.querySelector('option[value="Lee"]')).not.toBeNull();

    // Selecting the SECOND Sam filters to exactly that one column (was unreachable).
    const input = screen.getByRole("combobox", { name: /filter people/i });
    fireEvent.change(input, { target: { value: "Sam (2)" } });
    expect(screen.getAllByRole("columnheader", { name: "Sam" })).toHaveLength(1);
    // It is the SECOND Sam (id 3), named on its chip exactly as the picker offered it.
    expect(screen.getByRole("button", { name: t("en-US", "raciFilterRemove", "Sam (2)") })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Lee" })).not.toBeInTheDocument();
  });

  // §669 — two "Sam" columns with no role set gave both grid cells one name.
  it("names the grid cells of two same-named people apart", () => {
    const dup: Stakeholder[] = [
      { id: 1, name: "Sam", category: "Sponsor", influence: "High", interest: "High", raci: {} },
      { id: 3, name: "Sam", category: "Internal", influence: "Low", interest: "Low", raci: {} },
    ];
    render(<RaciPanel lang="en-US" stakeholders={dup} milestones={milestones} onSave={vi.fn()} />);
    const set = t("en-US", "raciSetLabel");
    expect(screen.getByRole("button", { name: `Go-Live · Sam (1) — ${set}` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Go-Live · Sam (2) — ${set}` })).toBeInTheDocument();
    expectRowUniqueNames({ minControls: 2, scope: screen.getByRole("table") });
  });

  // §669 review 4/5 — the old "Name (#id)" form left "Sam  Lee" (two spaces) bare
  // beside "Sam Lee", and a first token version left "Ana" bare beside "ana".
  // Row tokens fold whitespace and case and escalate past a taken token.
  it("names cells apart for whitespace twins, case twins and a name that looks like a token", () => {
    const odd: Stakeholder[] = [
      { id: 1, name: "Sam  Lee", category: "Sponsor", influence: "High", interest: "High", raci: {} },
      { id: 2, name: "Sam Lee", category: "Internal", influence: "Low", interest: "Low", raci: {} },
      { id: 3, name: "Kim", category: "Internal", influence: "Low", interest: "Low", raci: {} },
      { id: 4, name: "Kim", category: "Internal", influence: "Low", interest: "Low", raci: {} },
      { id: 5, name: "Kim (1)", category: "Internal", influence: "Low", interest: "Low", raci: {} },
      { id: 6, name: "Ana", category: "Internal", influence: "Low", interest: "Low", raci: {} },
      { id: 7, name: "ana", category: "Internal", influence: "Low", interest: "Low", raci: {} },
    ];
    render(<RaciPanel lang="en-US" stakeholders={odd} milestones={milestones} onSave={vi.fn()} />);
    expectRowUniqueNames({ minControls: 7, scope: screen.getByRole("table") });
    // expectRowUniqueNames compares case-sensitively, so pin the case pair by name.
    const set = t("en-US", "raciSetLabel");
    expect(screen.getByRole("button", { name: `Go-Live · Ana (1) — ${set}` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Go-Live · ana (2) — ${set}` })).toBeInTheDocument();
  });

  // §669 — two milestones with one name gave their cells (same person) one name.
  it("names the grid cells of two same-named milestones apart", () => {
    const twins: Milestone[] = [
      { id: 10, name: "Release", date: "2026-09-01", linkedTaskIds: [] },
      { id: 11, name: "Release", date: "2026-12-01", linkedTaskIds: [] },
    ];
    const sam: Stakeholder[] = [{ id: 1, name: "Sam", category: "Sponsor", influence: "High", interest: "High", raci: {} }];
    render(<RaciPanel lang="en-US" stakeholders={sam} milestones={twins} onSave={vi.fn()} />);
    const set = t("en-US", "raciSetLabel");
    expect(screen.getByRole("button", { name: `Release (2) · Sam — ${set}` })).toBeInTheDocument();
    expectRowUniqueNames({ minControls: 2, scope: screen.getByRole("table") });
  });

  // §669 — with both Sams in the filter, their two remove chips read alike.
  it("names the remove chips of two same-named people in the filter apart", () => {
    const dup: Stakeholder[] = [
      { id: 1, name: "Sam", category: "Sponsor", influence: "High", interest: "High", raci: {} },
      { id: 3, name: "Sam", category: "Internal", influence: "Low", interest: "Low", raci: {} },
    ];
    render(<RaciPanel lang="en-US" stakeholders={dup} milestones={milestones} onSave={vi.fn()} />);
    const input = screen.getByRole("combobox", { name: /filter people/i });
    fireEvent.change(input, { target: { value: "Sam (1)" } });
    fireEvent.change(input, { target: { value: "Sam (2)" } });
    const removes = screen.getAllByRole("button", { name: /from filter/i });
    expect(removes.map((b) => b.getAttribute("aria-label"))).toEqual([
      t("en-US", "raciFilterRemove", "Sam (1)"),
      t("en-US", "raciFilterRemove", "Sam (2)"),
    ]);
  });

  it("offers the Suggest RACI trigger when AI is configured", () => {
    stubSettings(AI_ON);
    render(<RaciPanel lang="en-US" stakeholders={stakeholders} milestones={milestones} onSave={vi.fn()} />);
    expect(screen.getByRole("button", { name: t("en-US", "raciSuggest") })).toBeTruthy();
  });

  it("hides the trigger in a popout", () => {
    stubSettings(AI_ON);
    render(<RaciPanel lang="en-US" stakeholders={stakeholders} milestones={milestones} onSave={vi.fn()} isPopout />);
    expect(screen.queryByRole("button", { name: t("en-US", "raciSuggest") })).toBeNull();
  });

  it("shows the empty state, and so no trigger, when there are no milestones", () => {
    // NAMED FOR WHAT IT ACTUALLY PROVES. The panel early-returns an empty state
    // at raci-panel.tsx:144 when milestones is empty, so the toolbar — and with
    // it the trigger — never mounts. That happens whatever useRaciSuggest's own
    // `enabled` guard says, so this test canNOT observe that guard: deleting
    // `milestones.length > 0` from the hook leaves it green (verified by
    // mutation). The hook's guard is covered directly in use-raci-suggest.test.tsx.
    stubSettings(AI_ON);
    render(<RaciPanel lang="en-US" stakeholders={stakeholders} milestones={[]} onSave={vi.fn()} />);
    expect(screen.queryByRole("button", { name: t("en-US", "raciSuggest") })).toBeNull();
  });

  it("hides the trigger when AI is not configured", () => {
    render(<RaciPanel lang="en-US" stakeholders={stakeholders} milestones={milestones} onSave={vi.fn()} />);
    expect(screen.queryByRole("button", { name: t("en-US", "raciSuggest") })).toBeNull();
  });

  it("renders Suggest RACI ahead of the person filter, with Print/Reset still trailing", () => {
    stubSettings(AI_ON);
    render(<RaciPanel lang="en-US" stakeholders={stakeholders} milestones={milestones} onSave={vi.fn()} />);

    // ★ Button order rides the SHARED helper, not a local compareDocumentPosition
    //   walk: it fails loudly when a key matches zero or several buttons, where a
    //   hand-rolled `findIndex` would silently take the first and let the
    //   assertion pass against the wrong control.
    // `contiguous` is the part that actually pins the convention — plain ordering
    // still holds if Suggest drifts back BETWEEN Print and Reset.
    expectButtonOrder(["raciSuggest", "printHint", "tableResetSizeHint"], { contiguous: false });
    expectButtonOrder(["printHint", "tableResetSizeHint"], { contiguous: true });

    // The filter is a combobox, not a button, so the shared helper cannot place
    // it — this one comparison stays hand-rolled of necessity.
    const suggest = screen.getByRole("button", { name: t("en-US", "raciSuggest") });
    const filter = screen.getByRole("combobox", { name: /filter people/i });
    expect(suggest.compareDocumentPosition(filter) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // The button is null when AI is off, so the filter must simply become first —
  // no placeholder, no reserved gap.
  // ★ Asserting only "trigger absent AND filter present" would duplicate the
  //   existing "hides the trigger when AI is not configured" test and prove
  //   nothing about the gap: a spacer <div> rendered in the trigger's place
  //   would satisfy it. Checking that the filter lives in the group's FIRST
  //   child is what actually rules that out.
  it("leaves the filter first when the Suggest trigger is absent", () => {
    render(<RaciPanel lang="en-US" stakeholders={stakeholders} milestones={milestones} onSave={vi.fn()} />);
    expect(screen.queryByRole("button", { name: t("en-US", "raciSuggest") })).toBeNull();

    const filter = screen.getByRole("combobox", { name: /filter people/i });
    const group = filter.closest("div.flex-1");
    expect(group).not.toBeNull();
    expect(group?.firstElementChild).toContainElement(filter);
  });
});
