import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RaciPanel } from "./raci-panel";
import { t } from "./i18n";
import { expectButtonOrder } from "../test/toolbar-order";
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
    fireEvent.click(screen.getByRole("button", { name: "R" }));
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

  it("disambiguates duplicate stakeholder names with (#id) so the second is selectable", () => {
    const dup: Stakeholder[] = [
      { id: 1, name: "Sam", category: "Sponsor", influence: "High", interest: "High", raci: { "10": "A" } },
      { id: 2, name: "Lee", category: "Internal", influence: "Medium", interest: "High", raci: { "10": "R" } },
      { id: 3, name: "Sam", category: "Internal", influence: "Low", interest: "Low", raci: { "10": "C" } },
    ];
    render(<RaciPanel lang="en-US" stakeholders={dup} milestones={milestones} onSave={vi.fn()} />);

    // The shared name is disambiguated in the picker; the unique one stays bare.
    expect(document.querySelector('option[value="Sam (#1)"]')).not.toBeNull();
    expect(document.querySelector('option[value="Sam (#3)"]')).not.toBeNull();
    expect(document.querySelector('option[value="Lee"]')).not.toBeNull();

    // Selecting the SECOND Sam filters to exactly that one column (was unreachable).
    const input = screen.getByRole("combobox", { name: /filter people/i });
    fireEvent.change(input, { target: { value: "Sam (#3)" } });
    expect(screen.getAllByRole("columnheader", { name: "Sam" })).toHaveLength(1);
    expect(screen.queryByRole("columnheader", { name: "Lee" })).not.toBeInTheDocument();
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
