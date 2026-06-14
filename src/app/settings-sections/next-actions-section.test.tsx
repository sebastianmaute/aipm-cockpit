import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextActionsSection } from "./next-actions-section";
import { defaultSettings, defaultNextActionsConfig } from "../settings-types";
import { t } from "../i18n";

describe("NextActionsSection", () => {
  it("renders a number input per threshold and edits patch settings.nextActions", () => {
    const onChange = vi.fn();
    render(<NextActionsSection lang="en-US" settings={defaultSettings} onChange={onChange} />);
    const input = screen.getByLabelText(t("en-US", "naScopePendingRed")) as HTMLInputElement;
    expect(input.value).toBe(String(defaultNextActionsConfig.scopePendingRed));
    fireEvent.change(input, { target: { value: "9" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ nextActions: expect.objectContaining({ scopePendingRed: 9 }) }),
    );
  });

  it("renders the three ranking-weight inputs and edits clarity bonus", () => {
    const onChange = vi.fn();
    render(<NextActionsSection lang="en-US" settings={defaultSettings} onChange={onChange} />);
    const clarity = screen.getByLabelText("Clarity bonus");
    fireEvent.change(clarity, { target: { value: "20" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ nextActions: expect.objectContaining({ clarityBonus: 20 }) }),
    );
  });

  it("edits the static penalty input", () => {
    const onChange = vi.fn();
    render(<NextActionsSection lang="en-US" settings={defaultSettings} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Static penalty"), { target: { value: "30" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ nextActions: expect.objectContaining({ staticPenalty: 30 }) }),
    );
  });

  it("renders the formula explainer block below the reset button", () => {
    render(<NextActionsSection lang="en-US" settings={defaultSettings} onChange={vi.fn()} />);
    expect(screen.getByText(/how actions are ranked/i)).toBeInTheDocument();
    expect(screen.getByText(/score = urgency \+ risk \+ impact/i)).toBeInTheDocument();
  });

  it("reset button is disabled at defaults and restores defaults when overridden", () => {
    const onChange = vi.fn();
    const overridden = {
      ...defaultSettings,
      nextActions: { ...defaultNextActionsConfig, scopePendingRed: 2 },
    };
    render(<NextActionsSection lang="en-US" settings={overridden} onChange={onChange} />);
    const reset = screen.getByRole("button", { name: t("en-US", "nextActionsReset") });
    expect(reset).not.toBeDisabled();
    fireEvent.click(reset);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ nextActions: defaultNextActionsConfig }),
    );
  });
});
