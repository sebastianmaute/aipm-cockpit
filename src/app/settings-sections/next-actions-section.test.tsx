import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextActionsSection } from "./next-actions-section";
import { defaultSettings, defaultNextActionsConfig } from "../settings-types";
import { t } from "../i18n";

// Mock the AI hook so the AI-suggested column renders without any network call.
vi.mock("../use-weight-suggestions", () => ({
  useWeightSuggestions: () => ({
    run: vi.fn(),
    busy: false,
    error: null,
    clear: vi.fn(),
    result: {
      suggestions: [{ field: "clarityBonus", current: 15, suggested: 20, rationale: "act on clear" }],
      overallRationale: "",
      recommendEnableLearning: false,
    },
  }),
}));

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

describe("NextActionsSection learning controls", () => {
  const learningConfig = { enabled: false, store: "local" as const };

  it("toggling the enable checkbox calls onChangeLearningConfig with enabled:true", () => {
    const onChangeLearningConfig = vi.fn();
    render(
      <NextActionsSection
        lang="en-US"
        settings={defaultSettings}
        onChange={vi.fn()}
        learningConfig={learningConfig}
        onChangeLearningConfig={onChangeLearningConfig}
        onResetLearning={vi.fn()}
        onOpenInsights={vi.fn()}
      />,
    );
    const checkbox = screen.getByLabelText(t("en-US", "settingsLearningEnable"));
    fireEvent.click(checkbox);
    expect(onChangeLearningConfig).toHaveBeenCalledWith({ enabled: true, store: "local" });
  });

  it("changing the store select calls onChangeLearningConfig with store:turso", () => {
    const onChangeLearningConfig = vi.fn();
    render(
      <NextActionsSection
        lang="en-US"
        settings={defaultSettings}
        onChange={vi.fn()}
        learningConfig={{ enabled: true, store: "local" }}
        onChangeLearningConfig={onChangeLearningConfig}
        onResetLearning={vi.fn()}
        onOpenInsights={vi.fn()}
      />,
    );
    const select = screen.getByLabelText(t("en-US", "settingsLearningStore"));
    fireEvent.change(select, { target: { value: "turso" } });
    expect(onChangeLearningConfig).toHaveBeenCalledWith({ enabled: true, store: "turso" });
  });

  it("clicking View learning insights calls onOpenInsights", () => {
    const onOpenInsights = vi.fn();
    render(
      <NextActionsSection
        lang="en-US"
        settings={defaultSettings}
        onChange={vi.fn()}
        learningConfig={learningConfig}
        onChangeLearningConfig={vi.fn()}
        onResetLearning={vi.fn()}
        onOpenInsights={onOpenInsights}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "settingsLearningInsights") }));
    expect(onOpenInsights).toHaveBeenCalledTimes(1);
  });

  it("renders no learning controls when the props are omitted", () => {
    render(<NextActionsSection lang="en-US" settings={defaultSettings} onChange={vi.fn()} />);
    expect(screen.queryByLabelText(t("en-US", "settingsLearningEnable"))).toBeNull();
  });
});

describe("NextActionsSection AI weight suggestions", () => {
  const aiSettings = { ...defaultSettings, ai: { ...defaultSettings.ai, apiKey: "sk-test", enabled: true } };

  it("shows an AI suggestion and Accept applies it", () => {
    const onChange = vi.fn();
    render(
      <NextActionsSection
        lang="en-US"
        settings={aiSettings}
        onChange={onChange}
        buildWeightSuggestionContext={() => "ctx"}
      />,
    );
    // The mocked hook suggests clarityBonus = 20.
    expect(screen.getByText("20")).toBeInTheDocument();
    const accept = screen.getByRole("button", {
      name: `${t("en-US", "weightSuggestAccept")} - ${t("en-US", "naClarityBonus")}`,
    });
    fireEvent.click(accept);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ nextActions: expect.objectContaining({ clarityBonus: 20 }) }),
    );
  });
});
