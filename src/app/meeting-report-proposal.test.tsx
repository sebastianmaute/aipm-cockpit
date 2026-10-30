import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { MeetingReportProposal } from "./meeting-report-proposal";
import { splitSections } from "./committee-report/report-sections";
import { loadI18n, t } from "./i18n";
import { expectRowUniqueNames } from "../test/row-unique-names";

// Opening text, two sections that share a heading, and one more.
const SECTIONS = splitSections(
  "<p>intro</p><h2>Risks</h2><p>a</p><h2>Risks</h2><p>b</p><h2>Next steps</h2><p>c</p>",
);

function renderProposal(overrides: Partial<Parameters<typeof MeetingReportProposal>[0]> = {}) {
  const props = {
    lang: "en-US" as const,
    sections: SECTIONS,
    taken: new Set<number>(),
    onTake: vi.fn(),
    onDiscard: vi.fn(),
    ...overrides,
  };
  render(<MeetingReportProposal {...props} />);
  return props;
}

describe("MeetingReportProposal", () => {
  it("renders one row per section, the level-0 one as Opening text", () => {
    renderProposal();
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent("Opening text");
    expect(rows[1]).toHaveTextContent("Risks");
    expect(rows[3]).toHaveTextContent("Next steps");
  });

  it("gives every Take button a row-unique name, also for two sections with one heading", () => {
    renderProposal();
    expect(screen.getByRole("button", { name: "Take – Opening text" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Take – Risks (1)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Take – Risks (2)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Take – Next steps" })).toBeInTheDocument();
    expectRowUniqueNames({ minControls: 4, scope: screen.getByRole("list"), requireCollisionSeed: true });
  });

  it("Take passes that row's index", () => {
    const p = renderProposal();
    fireEvent.click(screen.getByRole("button", { name: "Take – Risks (2)" }));
    expect(p.onTake).toHaveBeenCalledWith([2]);
  });

  it("Take all passes every section not yet taken, in order", () => {
    const p = renderProposal({ taken: new Set([1]) });
    fireEvent.click(screen.getByRole("button", { name: "Take all" }));
    expect(p.onTake).toHaveBeenCalledWith([0, 2, 3]);
  });

  it("a taken row says Taken in text and its Take stays enabled; Take all is disabled once all are taken", () => {
    const { rerender } = render(
      <MeetingReportProposal lang="en-US" sections={SECTIONS} taken={new Set([1])} onTake={vi.fn()} onDiscard={vi.fn()} />,
    );
    const row = screen.getAllByRole("listitem")[1];
    expect(within(row).getByText("Taken")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Take – Risks (1)" })).toBeEnabled();
    expect(within(screen.getAllByRole("listitem")[2]).queryByText("Taken")).toBeNull();
    expect(screen.getByRole("button", { name: "Take – Risks (2)" })).toBeEnabled();
    rerender(
      <MeetingReportProposal lang="en-US" sections={SECTIONS} taken={new Set([0, 1, 2, 3])} onTake={vi.fn()} onDiscard={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Take all" })).toBeDisabled();
  });

  it("Discard calls onDiscard", () => {
    const p = renderProposal();
    fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
    expect(p.onDiscard).toHaveBeenCalledTimes(1);
    expect(p.onTake).not.toHaveBeenCalled();
  });
});

describe("MeetingReportProposal (DE)", () => {
  beforeAll(async () => {
    await loadI18n("de");
  });

  it("uses the German labels with real umlauts", () => {
    render(<MeetingReportProposal lang="de" sections={SECTIONS} taken={new Set([1])} onTake={vi.fn()} onDiscard={vi.fn()} />);
    expect(t("de", "reportProposalTake")).toBe("Übernehmen");
    expect(screen.getByRole("button", { name: `Übernehmen – Next steps` })).toBeInTheDocument();
    expect(screen.getByText(t("de", "reportProposalTaken"))).toBeInTheDocument();
  });
});
