import "fake-indexeddb/auto";
import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiSection } from "./ai-section";
import { defaultSettings as baseSettings, type Settings } from "../settings-types";
import { DEFAULT_SESSION_TOKEN_CAP, DEFAULT_WEEKLY_TOKEN_CAP } from "../settings-types";

// The AI config UI is gated behind the "Enable AI assistant" master switch
// (default OFF). These tests exercise the expanded config, so flip it on.
const defaultSettings = { ...baseSettings, ai: { ...baseSettings.ai, enabled: true } };
import { t } from "../i18n";
import type { UseOperatingGuidesResult } from "../use-operating-guides";
import { readDeviceSecret, isPassphraseLocked } from "../secrets-store";
import { ToastProvider } from "../toast-context";

// Stub AiUsagePanel — it reads from context which isn't wired in these unit tests.
vi.mock("./ai-usage-panel", () => ({
  AiUsagePanel: () => <div data-testid="ai-usage-panel" />,
}));

afterEach(async () => {
  // Editing the API key fires an un-awaited device-seal (handleApiKeyChange →
  // saveSecretValue, which encrypts then writes the ciphertext to localStorage).
  // Flush those pending writes BEFORE clearing, so a late seal from this test
  // cannot land in localStorage during the next test and race its own seal of
  // the same key — the cross-test "expected 'sk-typed' got 'sk-test'" flake.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  localStorage.clear();
});

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

  it("hides the usage panel when hideUsage is set (new-project config surface)", () => {
    render(<AiSection lang="en-US" settings={defaultSettings} onChange={vi.fn()} hideUsage />);
    expect(screen.queryByTestId("ai-usage-panel")).not.toBeInTheDocument();
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

  it("action suggestions toggle is checked by default (undefined = on)", () => {
    const settingsDefaultOn = {
      ...defaultSettings,
      ai: { ...defaultSettings.ai, actionSuggestions: undefined },
    };
    render(
      <AiSection
        lang="en-US"
        settings={settingsDefaultOn}
        onChange={vi.fn()}
        operatingGuides={stubGuides()}
      />,
    );
    const toggle = screen.getByLabelText(t("en-US", "settingsAiActionSuggestions"));
    expect(toggle).toBeChecked();
  });

  it("toggling action suggestions calls onChange with actionSuggestions false", () => {
    const onChange = vi.fn();
    const settingsDefaultOn = {
      ...defaultSettings,
      ai: { ...defaultSettings.ai, actionSuggestions: undefined },
    };
    render(
      <AiSection
        lang="en-US"
        settings={settingsDefaultOn}
        onChange={onChange}
        operatingGuides={stubGuides()}
      />,
    );
    const toggle = screen.getByLabelText(t("en-US", "settingsAiActionSuggestions"));
    fireEvent.click(toggle);
    const last = onChange.mock.calls.at(-1)?.[0];
    expect(last.ai.actionSuggestions).toBe(false);
  });

  // --- secret sealing + passphrase lock ---

  it("device-seals the API key when edited so it survives blanked settings", async () => {
    // Must be a well-formed key — sealing is now gated on isValidAnthropicApiKey.
    const validKey = "sk-ant-api03-typed000000000000";
    render(<AiSection lang="en-US" settings={defaultSettings} onChange={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(t("en-US", "aiApiKeyPlaceholder")), {
      target: { value: validKey },
    });
    await waitFor(async () => expect(await readDeviceSecret("anthropicApiKey")).toBe(validKey));
  });

  it("passphrase toggle locks the API key once the confirm matches", async () => {
    const settingsWithKey = {
      ...defaultSettings,
      ai: { ...defaultSettings.ai, apiKey: "sk-ant-api03-have0000000000000" },
    };
    render(<AiSection lang="en-US" settings={settingsWithKey} onChange={vi.fn()} />);
    fireEvent.click(screen.getByLabelText(/require a passphrase/i)); // reveal fields
    fireEvent.change(screen.getByLabelText(/^passphrase$/i), { target: { value: "pw" } });
    fireEvent.change(screen.getByLabelText(/confirm passphrase/i), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: /save passphrase/i }));
    await waitFor(() => expect(isPassphraseLocked("anthropicApiKey")).toBe(true));
  });

  it("a mismatched confirm disables Save and shows the mismatch message", () => {
    const settingsWithKey = {
      ...defaultSettings,
      ai: { ...defaultSettings.ai, apiKey: "sk-ant-api03-have0000000000000" },
    };
    render(<AiSection lang="en-US" settings={settingsWithKey} onChange={vi.fn()} />);
    fireEvent.click(screen.getByLabelText(/require a passphrase/i));
    fireEvent.change(screen.getByLabelText(/^passphrase$/i), { target: { value: "pw" } });
    fireEvent.change(screen.getByLabelText(/confirm passphrase/i), { target: { value: "nope" } });
    expect(screen.getByText(/passphrases do not match/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save passphrase/i })).toBeDisabled();
  });

  it("removing the stored key forgets the secret and clears the api key", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const settingsWithKey = {
      ...defaultSettings,
      ai: { ...defaultSettings.ai, apiKey: "sk-ant-api03-have0000000000000" },
    };
    const onChange = vi.fn();
    render(<AiSection lang="en-US" settings={settingsWithKey} onChange={onChange} />);
    // Lock under a passphrase first.
    fireEvent.click(screen.getByLabelText(/require a passphrase/i));
    fireEvent.change(screen.getByLabelText(/^passphrase$/i), { target: { value: "pw" } });
    fireEvent.change(screen.getByLabelText(/confirm passphrase/i), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: /save passphrase/i }));
    await waitFor(() => expect(isPassphraseLocked("anthropicApiKey")).toBe(true));
    // Remove it entirely → forgets the secret and blanks the in-memory key.
    fireEvent.click(screen.getByRole("button", { name: /remove stored secret/i }));
    await waitFor(() => expect(isPassphraseLocked("anthropicApiKey")).toBe(false));
    expect(onChange.mock.calls.at(-1)![0].ai.apiKey).toBe("");
  });

  // --- master enable switch ---

  it("collapses the config and hides the API key field when AI is disabled (default off)", () => {
    render(<AiSection lang="en-US" settings={baseSettings} onChange={vi.fn()} />);
    // The Enable switch is present and unchecked; the config below is hidden.
    expect(screen.getByLabelText(t("en-US", "aiEnable"))).not.toBeChecked();
    expect(screen.queryByPlaceholderText(t("en-US", "aiApiKeyPlaceholder"))).toBeNull();
  });

  it("ticking Enable AI calls onChange with ai.enabled true", () => {
    const onChange = vi.fn();
    render(<AiSection lang="en-US" settings={baseSettings} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText(t("en-US", "aiEnable")));
    expect(onChange.mock.calls.at(-1)![0].ai.enabled).toBe(true);
  });
});

describe("AiSection API-key validation", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    } as Response);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The api-key field is a CONTROLLED input: a bare vi.fn() onChange never lifts
  // state, so React resets the DOM value to "" and the blur sees an empty key.
  // Lift state through a harness (the live SettingsView does the same) so the
  // typed value reaches the blur handler, while still spying every onChange call.
  function renderAi(showToast = vi.fn()) {
    const onChange = vi.fn();
    function Harness() {
      const [s, setS] = useState<Settings>({
        ...defaultSettings,
        ai: { ...defaultSettings.ai, enabled: true },
      });
      return (
        <ToastProvider value={showToast}>
          <AiSection
            lang="en-US"
            settings={s}
            onChange={(next) => {
              onChange(next);
              setS(next);
            }}
          />
        </ToastProvider>
      );
    }
    render(<Harness />);
    return { showToast, onChange };
  }

  it("discards an invalid key on blur and toasts", () => {
    const { showToast, onChange } = renderAi();
    const input = screen.getByPlaceholderText("sk-ant-...");
    fireEvent.change(input, { target: { value: "garbage-key" } });
    fireEvent.blur(input);
    expect(showToast).toHaveBeenCalledWith("error", expect.stringContaining("Anthropic"));
    const lastCall = onChange.mock.calls.at(-1)?.[0];
    expect(lastCall.ai.apiKey).toBe("");
  });

  it("keeps a valid key on blur with no toast", () => {
    const { showToast } = renderAi();
    const input = screen.getByPlaceholderText("sk-ant-...");
    fireEvent.change(input, { target: { value: "sk-ant-api03-AbC123_def-456GHI789jkl" } });
    fireEvent.blur(input);
    expect(showToast).not.toHaveBeenCalled();
  });
});
