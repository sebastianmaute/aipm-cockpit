import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AiSection } from "./ai-section";
import { defaultSettings } from "../settings-types";
import { t } from "../i18n";

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
});
