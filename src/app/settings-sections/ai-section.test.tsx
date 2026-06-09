import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AiSection } from "./ai-section";
import { defaultSettings } from "../settings-types";
import { DEFAULT_SESSION_TOKEN_CAP, DEFAULT_WEEKLY_TOKEN_CAP } from "../settings-types";
import { t } from "../i18n";

// Stub AiUsagePanel — it reads from context which isn't wired in these unit tests.
vi.mock("./ai-usage-panel", () => ({
  AiUsagePanel: () => <div data-testid="ai-usage-panel" />,
}));

describe("AiSection", () => {
  it("typing an API key persists ai.apiKey", () => {
    const onChange = vi.fn();
    render(<AiSection lang="en-US" settings={defaultSettings} onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText(t("en-US", "aiApiKeyPlaceholder")), {
      target: { value: "sk-test" },
    });
    const last = onChange.mock.calls.at(-1)?.[0];
    expect(last.ai.apiKey).toBe("sk-test");
  });

  it("shows the consent-required notice when consent not yet accepted", () => {
    render(<AiSection lang="en-US" settings={defaultSettings} onChange={vi.fn()} />);
    expect(screen.getByText(t("en-US", "aiConsentRequired"))).toBeInTheDocument();
  });

  it("renders session cap input with the default value", () => {
    render(<AiSection lang="en-US" settings={defaultSettings} onChange={vi.fn()} />);
    const input = screen.getByLabelText(t("en-US", "aiSessionCap")) as HTMLInputElement;
    expect(Number(input.value)).toBe(DEFAULT_SESSION_TOKEN_CAP);
  });

  it("renders weekly cap input with the default value", () => {
    render(<AiSection lang="en-US" settings={defaultSettings} onChange={vi.fn()} />);
    const input = screen.getByLabelText(t("en-US", "aiWeeklyCap")) as HTMLInputElement;
    expect(Number(input.value)).toBe(DEFAULT_WEEKLY_TOKEN_CAP);
  });

  it("editing session cap calls onChange with the new value", () => {
    const onChange = vi.fn();
    render(<AiSection lang="en-US" settings={defaultSettings} onChange={onChange} />);
    const input = screen.getByLabelText(t("en-US", "aiSessionCap"));
    fireEvent.change(input, { target: { value: "50000" } });
    const last = onChange.mock.calls.at(-1)?.[0];
    expect(last.ai.sessionTokenCap).toBe(50_000);
  });

  it("editing weekly cap calls onChange with the new value", () => {
    const onChange = vi.fn();
    render(<AiSection lang="en-US" settings={defaultSettings} onChange={onChange} />);
    const input = screen.getByLabelText(t("en-US", "aiWeeklyCap"));
    fireEvent.change(input, { target: { value: "500000" } });
    const last = onChange.mock.calls.at(-1)?.[0];
    expect(last.ai.weeklyTokenCap).toBe(500_000);
  });

  it("renders the usage panel", () => {
    render(<AiSection lang="en-US" settings={defaultSettings} onChange={vi.fn()} />);
    expect(screen.getByTestId("ai-usage-panel")).toBeInTheDocument();
  });
});
