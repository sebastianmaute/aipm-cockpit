import "fake-indexeddb/auto";
import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiSection } from "./ai-section";
import { defaultSettings as baseSettings, type Settings } from "../settings-types";
import {
  DEFAULT_SESSION_TOKEN_CAP,
  DEFAULT_WEEKLY_TOKEN_CAP,
  DEFAULT_INSIGHT_REC_INTERVAL_MIN,
  MIN_INSIGHT_REC_INTERVAL_MIN,
  MAX_INSIGHT_REC_INTERVAL_MIN,
  clampInsightRecInterval,
} from "../settings-types";

// The AI config UI is gated behind the "Enable AI assistant" master switch
// (default OFF). These tests exercise the expanded config, so flip it on.
const defaultSettings = { ...baseSettings, ai: { ...baseSettings.ai, enabled: true } };
import { t } from "../i18n";
import { readDeviceSecret, isPassphraseLocked } from "../secrets-store";
import { ToastProvider } from "../toast-context";

// Stub AiUsagePanel — it reads from context which isn't wired in these unit tests.
vi.mock("./ai-usage-panel", () => ({
  AiUsagePanel: () => <div data-testid="ai-usage-panel" />,
}));

// Remove-secret now routes through the branded useConfirm() (async) instead of
// window.confirm; no ConfirmProvider here, so mock the hook to auto-confirm.
vi.mock("../confirm-dialog", () => ({
  useConfirm: () => () => Promise.resolve(true),
}));

beforeEach(() => {
  // A well-formed key + enabled AI makes useChatModels fire a browser-direct
  // fetch to api.anthropic.com. Stub it for EVERY test so none hits the network
  // (the hook swallows the !ok response → falls back to the registry options).
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: false,
    status: 401,
    json: async () => ({}),
  } as Response);
});

afterEach(async () => {
  // Editing the API key fires an un-awaited device-seal (handleApiKeyChange →
  // saveSecretValue, which encrypts then writes the ciphertext to localStorage).
  // Flush those pending writes BEFORE clearing, so a late seal from this test
  // cannot land in localStorage during the next test and race its own seal of
  // the same key — the cross-test "expected 'sk-typed' got 'sk-test'" flake.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  localStorage.clear();
  vi.restoreAllMocks();
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

  it("exposes the AI Assistant section as a named group", () => {
    render(<AiSection lang="en-US" settings={defaultSettings} onChange={vi.fn()} />);
    expect(screen.getByRole("group", { name: t("en-US", "aiAssistant") })).toBeInTheDocument();
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

  // --- ground-in-guides toggle ---
  //
  // ★★ This control ALSO lives in ai-guides-section.tsx, and these two cases
  // are the only thing standing between that duplication and a silent loss.
  // The toggle disappeared from AiSection entirely when the guides block was
  // extracted, and every suite stayed green — settings-menu.tsx, the setup
  // wizard's AI step and project-empty-state.tsx all mount AiSection and have
  // no other route to this setting. Do not delete these because
  // ai-guides-section.test.tsx "already covers it"; it covers the OTHER copy.

  it("renders the labelled ground-in-guides toggle once AI is enabled", () => {
    render(<AiSection lang="en-US" settings={defaultSettings} onChange={vi.fn()} />);
    const toggle = screen.getByLabelText(t("en-US", "aiGroundInGuides"));
    expect(toggle).toBeInTheDocument();
    // defaultAiConfig.groundInGuides is true, so the control must reflect that
    // rather than merely existing.
    expect(toggle).toBeChecked();
  });

  it("toggling ground-in-guides calls onChange with the flag flipped", () => {
    const onChange = vi.fn();
    render(
      <AiSection
        lang="en-US"
        settings={{ ...defaultSettings, ai: { ...defaultSettings.ai, groundInGuides: true } }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByLabelText(t("en-US", "aiGroundInGuides")));
    expect(onChange.mock.calls.at(-1)?.[0].ai.groundInGuides).toBe(false);
  });

  it("hides the ground-in-guides toggle while the AI master switch is off", () => {
    // It sits inside the `settings.ai.enabled === true` fragment; a copy placed
    // outside it would leak a guides setting onto a collapsed AI panel.
    render(<AiSection lang="en-US" settings={baseSettings} onChange={vi.fn()} />);
    expect(screen.queryByLabelText(t("en-US", "aiGroundInGuides"))).toBeNull();
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
      />,
    );
    const toggle = screen.getByLabelText(t("en-US", "settingsAiActionSuggestions"));
    fireEvent.click(toggle);
    const last = onChange.mock.calls.at(-1)?.[0];
    expect(last.ai.actionSuggestions).toBe(false);
  });

  // --- the two AI-recall kill switches (B2a/B2b) ---
  //
  // Both are DEFAULT ON BY ABSENCE: `sanitizeAiConfig` stores only an explicit
  // `false`, so `undefined` must render CHECKED. A `checked={!!flag}` binding
  // would render an unchecked box over a live feature, and clicking it would
  // then write `true` — a no-op the user reads as "I just turned this on".
  // That is why each pair asserts the undefined case explicitly rather than
  // relying on `defaultSettings`.

  it("history-search toggle is checked by default (undefined = on)", () => {
    render(
      <AiSection
        lang="en-US"
        settings={{ ...defaultSettings, ai: { ...defaultSettings.ai, historySearch: undefined } }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(t("en-US", "settingsAiHistorySearch"))).toBeChecked();
  });

  it("toggling history search calls onChange with historySearch false", () => {
    const onChange = vi.fn();
    render(
      <AiSection
        lang="en-US"
        settings={{ ...defaultSettings, ai: { ...defaultSettings.ai, historySearch: undefined } }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByLabelText(t("en-US", "settingsAiHistorySearch")));
    expect(onChange.mock.calls.at(-1)?.[0].ai.historySearch).toBe(false);
  });

  it("re-enabling history search from an explicit false clears the flag", () => {
    // The other direction of the same binding: from `false` the click must
    // write `true`, not `false` again. A `=== false` typo on the WRITE side
    // (rather than the read side) leaves the box permanently off.
    const onChange = vi.fn();
    render(
      <AiSection
        lang="en-US"
        settings={{ ...defaultSettings, ai: { ...defaultSettings.ai, historySearch: false } }}
        onChange={onChange}
      />,
    );
    const toggle = screen.getByLabelText(t("en-US", "settingsAiHistorySearch"));
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(onChange.mock.calls.at(-1)?.[0].ai.historySearch).toBe(true);
  });

  it("activity-recap toggle is checked by default (undefined = on)", () => {
    render(
      <AiSection
        lang="en-US"
        settings={{ ...defaultSettings, ai: { ...defaultSettings.ai, activityRecap: undefined } }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(t("en-US", "settingsAiActivityRecap"))).toBeChecked();
  });

  it("toggling the activity recap calls onChange with activityRecap false", () => {
    const onChange = vi.fn();
    render(
      <AiSection
        lang="en-US"
        settings={{ ...defaultSettings, ai: { ...defaultSettings.ai, activityRecap: undefined } }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByLabelText(t("en-US", "settingsAiActivityRecap")));
    expect(onChange.mock.calls.at(-1)?.[0].ai.activityRecap).toBe(false);
  });

  it("re-enabling the activity recap from an explicit false clears the flag", () => {
    const onChange = vi.fn();
    render(
      <AiSection
        lang="en-US"
        settings={{ ...defaultSettings, ai: { ...defaultSettings.ai, activityRecap: false } }}
        onChange={onChange}
      />,
    );
    const toggle = screen.getByLabelText(t("en-US", "settingsAiActivityRecap"));
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(onChange.mock.calls.at(-1)?.[0].ai.activityRecap).toBe(true);
  });

  it("chat-search toggle is checked by default (undefined = on)", () => {
    render(
      <AiSection
        lang="en-US"
        settings={{ ...defaultSettings, ai: { ...defaultSettings.ai, chatSearch: undefined } }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(t("en-US", "settingsAiChatSearch"))).toBeChecked();
  });

  it("toggling chat search calls onChange with chatSearch false", () => {
    const onChange = vi.fn();
    render(
      <AiSection
        lang="en-US"
        settings={{ ...defaultSettings, ai: { ...defaultSettings.ai, chatSearch: undefined } }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByLabelText(t("en-US", "settingsAiChatSearch")));
    expect(onChange.mock.calls.at(-1)?.[0].ai.chatSearch).toBe(false);
  });

  it("re-enabling chat search from an explicit false clears the flag", () => {
    const onChange = vi.fn();
    render(
      <AiSection
        lang="en-US"
        settings={{ ...defaultSettings, ai: { ...defaultSettings.ai, chatSearch: false } }}
        onChange={onChange}
      />,
    );
    const toggle = screen.getByLabelText(t("en-US", "settingsAiChatSearch"));
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(onChange.mock.calls.at(-1)?.[0].ai.chatSearch).toBe(true);
  });

  it("hides all three recall toggles while the AI master switch is off", () => {
    // They sit inside the `settings.ai.enabled === true` fragment; a copy placed
    // outside it would leak AI settings onto a collapsed panel.
    render(<AiSection lang="en-US" settings={baseSettings} onChange={vi.fn()} />);
    expect(screen.queryByLabelText(t("en-US", "settingsAiHistorySearch"))).toBeNull();
    expect(screen.queryByLabelText(t("en-US", "settingsAiActivityRecap"))).toBeNull();
    expect(screen.queryByLabelText(t("en-US", "settingsAiChatSearch"))).toBeNull();
  });

  it("gives each recall toggle a visible label matching its accessible name", () => {
    // WCAG 2.5.3 (label-in-name). The axe gate CANNOT see a violation here —
    // `label-content-name-mismatch` is tagged `experimental` and axe's default
    // tagExclude drops it, so a tag-only runOnly never runs the rule. Matching
    // the two strings at write time is the only protection, and this is the
    // only thing that pins it.
    render(<AiSection lang="en-US" settings={defaultSettings} onChange={vi.fn()} />);
    for (const key of [
      "settingsAiHistorySearch",
      "settingsAiActivityRecap",
      "settingsAiChatSearch",
    ] as const) {
      const label = screen.getByLabelText(t("en-US", key)).closest("label");
      expect(label?.textContent).toBe(t("en-US", key));
    }
  });

  // --- background recommendation cadence (SP4) ---

  function withRecs(ai: Partial<Settings["ai"]>): Settings {
    return {
      ...defaultSettings,
      ai: { ...defaultSettings.ai, insightRecommendations: true, ...ai },
    };
  }

  it("hides the cadence input while insight recommendations are off", () => {
    render(
      <AiSection
        lang="en-US"
        settings={{
          ...defaultSettings,
          ai: { ...defaultSettings.ai, insightRecommendations: false },
        }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText(t("en-US", "aiInsightRecInterval"))).toBeNull();
  });

  it("shows a labelled cadence input with the stored value once recommendations are on", () => {
    render(
      <AiSection
        lang="en-US"
        settings={withRecs({ insightRecommendationIntervalMinutes: 120 })}
        onChange={vi.fn()}
      />,
    );
    const input = screen.getByLabelText(
      t("en-US", "aiInsightRecInterval"),
    ) as HTMLInputElement;
    expect(Number(input.value)).toBe(120);
  });

  it("falls back to the 60-minute default when the cadence field is absent", () => {
    render(
      <AiSection
        lang="en-US"
        settings={withRecs({ insightRecommendationIntervalMinutes: undefined })}
        onChange={vi.fn()}
      />,
    );
    const input = screen.getByLabelText(
      t("en-US", "aiInsightRecInterval"),
    ) as HTMLInputElement;
    expect(Number(input.value)).toBe(DEFAULT_INSIGHT_REC_INTERVAL_MIN);
  });

  it("clamps a directly-typed out-of-range cadence before it reaches onChange", () => {
    const onChange = vi.fn();
    render(
      <AiSection
        lang="en-US"
        settings={withRecs({ insightRecommendationIntervalMinutes: 60 })}
        onChange={onChange}
      />,
    );
    const input = screen.getByLabelText(t("en-US", "aiInsightRecInterval"));
    const committed = () =>
      onChange.mock.calls.at(-1)?.[0].ai.insightRecommendationIntervalMinutes;

    // Above the 1440 ceiling — this drives BILLED background calls, so it must
    // never reach the runner raw.
    fireEvent.change(input, { target: { value: "5000" } });
    expect(committed()).toBe(MAX_INSIGHT_REC_INTERVAL_MIN);

    // Below the 15-minute floor — the floor is what stops the setting being
    // used to hammer the API.
    fireEvent.change(input, { target: { value: "2" } });
    expect(committed()).toBe(MIN_INSIGHT_REC_INTERVAL_MIN);

    // Whatever is typed, the committed value survives the shared clamp
    // unchanged — i.e. it is always already in range.
    for (const typed of ["5000", "2", "0", "-30", "abc", "37.6"]) {
      fireEvent.change(input, { target: { value: typed } });
      expect(committed()).toBe(clampInsightRecInterval(committed()));
    }
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
        <ToastProvider value={{ showToast, showToastAction: showToast }}>
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
