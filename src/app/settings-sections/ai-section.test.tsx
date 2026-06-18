import "fake-indexeddb/auto";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiSection } from "./ai-section";
import { defaultSettings } from "../settings-types";
import { DEFAULT_SESSION_TOKEN_CAP, DEFAULT_WEEKLY_TOKEN_CAP } from "../settings-types";
import { t } from "../i18n";
import type { UseOperatingGuidesResult } from "../use-operating-guides";
import { readDeviceSecret, isPassphraseLocked } from "../secrets-store";

// Stub AiUsagePanel — it reads from context which isn't wired in these unit tests.
vi.mock("./ai-usage-panel", () => ({
  AiUsagePanel: () => <div data-testid="ai-usage-panel" />,
}));

afterEach(() => localStorage.clear());

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

  // --- operating-guide library UI ---

  function stubGuides(over: Partial<UseOperatingGuidesResult> = {}): UseOperatingGuidesResult {
    return {
      guides: [
        {
          id: "builtin-leadership",
          name: "Project Leadership Operating Guide",
          content: "x",
          enabled: true,
          priority: 1,
          scope: {},
          builtIn: true,
        },
        {
          id: "g2",
          name: "My Guide",
          content: "y",
          enabled: true,
          priority: 2,
          scope: {},
          builtIn: false,
        },
      ],
      busy: false,
      ready: true,
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      refresh: vi.fn(),
      ...over,
    };
  }

  it("renders guides heading, description, and a labelled master toggle", () => {
    render(
      <AiSection
        lang="en-US"
        settings={defaultSettings}
        onChange={vi.fn()}
        operatingGuides={stubGuides()}
      />,
    );
    expect(screen.getByText(t("en-US", "aiGuidesHeading"))).toBeInTheDocument();
    expect(screen.getByText(t("en-US", "aiGuidesDesc"))).toBeInTheDocument();
    expect(
      screen.getByLabelText(t("en-US", "aiGroundInGuides")),
    ).toBeInTheDocument();
  });

  it("lists both guides; built-in shows badge and no Delete button; user guide has Delete", () => {
    render(
      <AiSection
        lang="en-US"
        settings={defaultSettings}
        onChange={vi.fn()}
        operatingGuides={stubGuides()}
      />,
    );
    expect(screen.getByText("Project Leadership Operating Guide")).toBeInTheDocument();
    expect(screen.getByText("My Guide")).toBeInTheDocument();
    expect(screen.getByText(t("en-US", "aiGuideBuiltInBadge"))).toBeInTheDocument();
    // Delete buttons: only user guide has one. The accessible name is
    // qualified per-row with the guide name, so match by prefix.
    const deleteBtns = screen.getAllByRole("button", {
      name: new RegExp(`^${t("en-US", "aiGuideDelete")}`),
    });
    expect(deleteBtns).toHaveLength(1);
    expect(deleteBtns[0]).toHaveAccessibleName(`${t("en-US", "aiGuideDelete")} – My Guide`);
  });

  it("toggling master toggle calls onChange with groundInGuides flipped", () => {
    const onChange = vi.fn();
    const settingsWithGrounding = {
      ...defaultSettings,
      ai: { ...defaultSettings.ai, groundInGuides: true },
    };
    render(
      <AiSection
        lang="en-US"
        settings={settingsWithGrounding}
        onChange={onChange}
        operatingGuides={stubGuides()}
      />,
    );
    const toggle = screen.getByLabelText(t("en-US", "aiGroundInGuides"));
    fireEvent.click(toggle);
    const last = onChange.mock.calls.at(-1)?.[0];
    expect(last.ai.groundInGuides).toBe(false);
  });

  // --- secret sealing + passphrase lock ---

  it("device-seals the API key when edited so it survives blanked settings", async () => {
    render(<AiSection lang="en-US" settings={defaultSettings} onChange={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(t("en-US", "aiApiKeyPlaceholder")), {
      target: { value: "sk-typed" },
    });
    await waitFor(async () => expect(await readDeviceSecret("anthropicApiKey")).toBe("sk-typed"));
  });

  it("passphrase toggle locks the API key under a passphrase", async () => {
    const settingsWithKey = {
      ...defaultSettings,
      ai: { ...defaultSettings.ai, apiKey: "sk-have" },
    };
    render(<AiSection lang="en-US" settings={settingsWithKey} onChange={vi.fn()} />);
    fireEvent.click(screen.getByLabelText(/require a passphrase/i)); // reveal field
    fireEvent.change(screen.getByLabelText(/^passphrase$/i), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: /require a passphrase/i })); // confirm
    await waitFor(() => expect(isPassphraseLocked("anthropicApiKey")).toBe(true));
  });
});
