// src/app/demo-start-card.test.tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { t } from "./i18n";
import { DemoStartCard } from "./demo-start-card";

const NAME = "Customer Identity Platform (demo)";

function renderCard(over: Partial<React.ComponentProps<typeof DemoStartCard>> = {}) {
  const props: React.ComponentProps<typeof DemoStartCard> = {
    lang: "en-US",
    variant: { kind: "local" },
    weeks: 27,
    connectedNote: false,
    onExplore: vi.fn(),
    onSetUpTurso: vi.fn(),
    ...over,
  };
  render(<DemoStartCard {...props} />);
  return props;
}

describe("DemoStartCard", () => {
  it("is a section named by its heading", () => {
    renderCard();
    expect(screen.getByRole("region", { name: t("en-US", "demoCardTitle") })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: t("en-US", "demoCardTitle") })).toBeInTheDocument();
    expect(screen.getByText(t("en-US", "demoCardBody"))).toBeInTheDocument();
  });

  it("local: says Trends needs Turso, with the week count, and offers both actions", () => {
    renderCard();
    expect(screen.getByText(t("en-US", "demoCardTrendsNeedsTurso", 27))).toBeInTheDocument();
    expect(screen.queryByText(t("en-US", "demoCardTrendsIncluded", 27, NAME))).toBeNull();
    expect(screen.getByRole("button", { name: t("en-US", "demoCardTitle") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("en-US", "demoCardSetUpTurso") })).toBeInTheDocument();
  });

  it("turso: says the history is included and names the project, with no setup action", () => {
    renderCard({ variant: { kind: "turso", projectName: NAME } });
    expect(screen.getByText(t("en-US", "demoCardTrendsIncluded", 27, NAME))).toBeInTheDocument();
    expect(screen.queryByText(t("en-US", "demoCardTrendsNeedsTurso", 27))).toBeNull();
    expect(screen.queryByRole("button", { name: t("en-US", "demoCardSetUpTurso") })).toBeNull();
  });

  it("reads the week count from its prop", () => {
    renderCard({ weeks: 5 });
    expect(screen.getByText(t("en-US", "demoCardTrendsNeedsTurso", 5))).toBeInTheDocument();
  });

  it("shows the connected note only when asked", () => {
    renderCard({ variant: { kind: "turso", projectName: NAME }, connectedNote: true });
    expect(screen.getByText(t("en-US", "demoTursoConnectedNote", 27))).toBeInTheDocument();
  });

  it("hides the connected note by default", () => {
    renderCard({ variant: { kind: "turso", projectName: NAME } });
    expect(screen.queryByText(t("en-US", "demoTursoConnectedNote", 27))).toBeNull();
  });

  it("calls each handler once", () => {
    const p = renderCard();
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "demoCardTitle") }));
    expect(p.onExplore).toHaveBeenCalledTimes(1);
    expect(p.onSetUpTurso).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "demoCardSetUpTurso") }));
    expect(p.onSetUpTurso).toHaveBeenCalledTimes(1);
    expect(p.onExplore).toHaveBeenCalledTimes(1);
  });

  it("local without a setup handler offers only the explore action", () => {
    renderCard({ onSetUpTurso: undefined });
    expect(screen.queryByRole("button", { name: t("en-US", "demoCardSetUpTurso") })).toBeNull();
  });
});
