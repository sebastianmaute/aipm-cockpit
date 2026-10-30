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

// Review item 1 — each row can be read before it is taken: a closed-by-default, read-only preview.
describe("MeetingReportProposal — section preview", () => {
  const previews = (c: HTMLElement) => [...c.querySelectorAll<HTMLDetailsElement>("details[data-section-preview]")];
  const summaryOf = (d: HTMLDetailsElement) => d.querySelector("summary") as HTMLElement;

  it("gives every row a preview, closed by default, its text not visible", () => {
    const { container } = render(
      <MeetingReportProposal lang="en-US" sections={SECTIONS} taken={new Set()} onTake={vi.fn()} onDiscard={vi.fn()} />,
    );
    const ds = previews(container);
    expect(ds).toHaveLength(4);
    for (const d of ds) expect(d.open).toBe(false);
    expect(within(ds[1]).getByText("a")).not.toBeVisible();
  });

  it("expanding shows that section's text, without moving focus or taking anything", () => {
    const onTake = vi.fn();
    const { container } = render(
      <MeetingReportProposal lang="en-US" sections={SECTIONS} taken={new Set()} onTake={onTake} onDiscard={vi.fn()} />,
    );
    const d = previews(container)[2];
    const summary = summaryOf(d);
    summary.focus();
    fireEvent.click(summary);
    expect(d.open).toBe(true);
    expect(within(d).getByText("b")).toBeVisible();
    expect(document.activeElement).toBe(summary);
    expect(onTake).not.toHaveBeenCalled();
    expect(within(screen.getAllByRole("listitem")[2]).queryByText("Taken")).toBeNull();
  });

  it("names every preview toggle row-uniquely, also for two sections with one heading", () => {
    const { container } = render(
      <MeetingReportProposal lang="en-US" sections={SECTIONS} taken={new Set()} onTake={vi.fn()} onDiscard={vi.fn()} />,
    );
    const names = previews(container).map((d) => summaryOf(d).getAttribute("aria-label"));
    expect(names).toEqual([
      "Preview – Opening text",
      "Preview – Risks (1)",
      "Preview – Risks (2)",
      "Preview – Next steps",
    ]);
    // Label in name (WCAG 2.5.3): the visible text starts the accessible name.
    for (const d of previews(container)) expect(summaryOf(d).getAttribute("aria-label")).toMatch(new RegExp(`^${summaryOf(d).textContent}`));
  });

  it("renders a section's markup as text, never raw tags, and drops a script", () => {
    const sections = splitSections(
      `<h2>Status</h2><p>on <strong>track</strong></p><script>window.__pwned = 1</script><img src=x onerror="window.__pwned = 1">`,
    );
    const { container } = render(
      <MeetingReportProposal lang="en-US" sections={sections} taken={new Set()} onTake={vi.fn()} onDiscard={vi.fn()} />,
    );
    const d = previews(container)[0];
    fireEvent.click(summaryOf(d));
    const body = d.querySelector("[data-section-preview-body]") as HTMLElement;
    expect(body).toHaveTextContent("on track");
    expect(body.textContent).not.toMatch(/<\/?(p|strong|h2)>/);
    expect(body.querySelector("strong")).not.toBeNull();
    expect(body.querySelector("script")).toBeNull();
    expect(body.querySelector("[onerror]")).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });
});

describe("MeetingReportProposal — preview omits the section heading", () => {
  it("an opened preview holds no heading element and does not repeat the row heading", () => {
    const { container } = render(
      <MeetingReportProposal lang="en-US" sections={SECTIONS} taken={new Set()} onTake={vi.fn()} onDiscard={vi.fn()} />,
    );
    const bodies = [...container.querySelectorAll<HTMLElement>("[data-section-preview-body]")];
    for (const b of bodies) expect(b.querySelector("h1,h2,h3,h4")).toBeNull();
    expect(bodies[1].textContent).toBe("a");
    expect(bodies[3].textContent).toBe("c");
  });

  it("a section that is only a heading shows the muted no-text line", () => {
    const { container } = render(
      <MeetingReportProposal lang="en-US" sections={splitSections("<h2>Empty</h2>")} taken={new Set()} onTake={vi.fn()} onDiscard={vi.fn()} />,
    );
    const body = container.querySelector("[data-section-preview-body]") as HTMLElement;
    expect(body.textContent).toBe(t("en-US", "reportProposalPreviewEmpty"));
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
