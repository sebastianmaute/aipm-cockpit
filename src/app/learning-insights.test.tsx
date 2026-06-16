import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LearningInsights } from "./learning-insights";
import { loadI18n } from "./i18n";

beforeAll(async () => {
  await loadI18n("de");
});

const baseProps = () => ({
  lang: "en-US" as const,
  state: { "raid:actionRaidWhySeverity": { acted: 5, snoozed: 1, dismissed: 0, lastAt: 0 } },
  overrides: {} as Record<string, "auto" | "surface" | "suppress" | "off">,
  onSetOverride: vi.fn(),
  onReset: vi.fn(),
});

describe("LearningInsights", () => {
  it("renders a row per kind with counts", () => {
    render(<LearningInsights {...baseProps()} now={0} />);
    expect(screen.getByText("5")).toBeTruthy(); // acted count
  });
  it("changing the override select calls onSetOverride", () => {
    const p = baseProps();
    render(<LearningInsights {...p} now={0} />);
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "suppress" } });
    expect(p.onSetOverride).toHaveBeenCalledWith("raid:actionRaidWhySeverity", "suppress");
  });
  it("shows the empty state with no data", () => {
    render(<LearningInsights {...baseProps()} state={{}} now={0} />);
    expect(screen.getByText(/No learning data yet/i)).toBeTruthy();
  });
});
