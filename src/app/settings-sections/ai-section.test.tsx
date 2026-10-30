import "fake-indexeddb/auto";
import { useState } from "react";
import { cleanup, render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiSection } from "./ai-section";
import { hasUnsealedPassphraseSecret } from "../turso-token-marker";
import { __resetAiKeyStatusForTests, reportAiKeyResponse, reportAiKeyUnreadable } from "../ai-key-status";
import { defaultSettings as baseSettings, type Settings } from "../settings-types";
import {
  DEFAULT_SESSION_TOKEN_CAP,
  DEFAULT_WEEKLY_TOKEN_CAP,
  DEFAULT_INSIGHT_REC_INTERVAL_MIN,
  MIN_INSIGHT_REC_INTERVAL_MIN,
  MAX_INSIGHT_REC_INTERVAL_MIN,
  clampInsightRecInterval,
} from "../settings-types";

import { t } from "../i18n";
import { newConsent } from "../ai-consent";
import { setAiDeploymentState } from "../ai-deployment";
import { DIRECT_AI_STATUS } from "../../test/ai-status-fetch";
// The AI config UI is gated behind the "Enable AI assistant" master switch
// (default OFF), and the key field also behind a current consent (AI-01). These
// tests exercise the expanded config, so flip it on with a consent.
const defaultSettings = { ...baseSettings, ai: { ...baseSettings.ai, enabled: true, consent: newConsent(new Date(0)) } };
/** AI on, but the disclosure not accepted (or accepted at an older version). */
const onWithoutConsent = { ...baseSettings, ai: { ...baseSettings.ai, enabled: true } };
import { SETTINGS_KEY } from "../use-settings";
import { getSessionAiKey, setSessionAiKey } from "../session-ai-key";
import { readDeviceSecret, isPassphraseLocked, loadSealed, saveSealed } from "../secrets-store";
import * as secrets from "../secrets";
import { type SealedSecret, sealDevice, sealPassphrase } from "../secrets";
import { ToastProvider } from "../toast-context";
import { expectExactLabelNames, expectNoHintInNamingLabel } from "../../test/hint-label";

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
  // §650 — the 401 stub below now REPORTS into the module-level key verdict, which
  // outlives a test; start every test from "unknown" or a verdict from an earlier
  // test's key shows up as a notice in the next one.
  __resetAiKeyStatusForTests();
  // A well-formed key + enabled AI makes useChatModels fire a browser-direct
  // fetch to api.anthropic.com. Stub it for EVERY test so none hits the network
  // (the hook falls back to the registry options on the !ok response).
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
  // §717 — switching AI off forgets a key unlocked on this page too.
  it("switching AI off forgets a key unlocked on this page", () => {
    setSessionAiKey("sk-ant-unlocked");
    const on: Settings = { ...defaultSettings, ai: { ...defaultSettings.ai, enabled: true } };
    render(<AiSection lang="en-US" settings={on} onChange={vi.fn()} />);
    fireEvent.click(screen.getByLabelText(t("en-US", "aiEnable")));
    expect(getSessionAiKey()).toBe("");
  });

  // §717 — a passphrase key unlocked in the chat stops counting once the key is edited or removed here.
  it("editing the key forgets a key unlocked on this page", () => {
    setSessionAiKey("sk-ant-unlocked");
    render(<AiSection lang="en-US" settings={defaultSettings} onChange={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(t("en-US", "aiApiKeyPlaceholder")), { target: { value: "sk-new" } });
    expect(getSessionAiKey()).toBe("");
  });

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

  it("shows the review prompt and a Review button when AI is on but no consent is current", () => {
    render(<AiSection lang="en-US" settings={onWithoutConsent} onChange={vi.fn()} />);
    expect(screen.getByText(t("en-US", "aiConsentReviewPrompt"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "aiConsentReview") }));
    expect(screen.getByRole("dialog", { name: t("en-US", "aiConsentTitle") })).toBeInTheDocument();
  });

  // AI-01 — the key field appears once the disclosure is accepted, as the Help text says.
  it("with AI on and no current consent shows the review prompt, not the key field", () => {
    render(<AiSection lang="en-US" settings={onWithoutConsent} onChange={vi.fn()} />);
    expect(screen.getByText(t("en-US", "aiConsentReviewPrompt"))).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(t("en-US", "aiApiKeyPlaceholder"))).toBeNull();
    expect(screen.queryByLabelText(t("en-US", "secretLockPassphrase"))).toBeNull();
    const outdated = { ...onWithoutConsent, ai: { ...onWithoutConsent.ai, consent: { acceptedAt: "1970-01-01T00:00:00.000Z", disclosureVersion: 0 } } };
    cleanup();
    render(<AiSection lang="en-US" settings={outdated} onChange={vi.fn()} />);
    expect(screen.queryByPlaceholderText(t("en-US", "aiApiKeyPlaceholder"))).toBeNull();
    cleanup();
    render(<AiSection lang="en-US" settings={defaultSettings} onChange={vi.fn()} />); // control: consent current
    expect(screen.getByPlaceholderText(t("en-US", "aiApiKeyPlaceholder"))).toBeInTheDocument();
  });

  // AI-01 — deleting a stored key needs no consent: after a revoke or a switch-off it is still one click away.
  it("offers Remove stored secret, and only it, while a key is stored and the key field is hidden", async () => {
    saveSealed(await sealDevice("anthropicApiKey", "sk-ant-api03-stored000000000000"));
    const removeButton = () => screen.queryByRole("button", { name: t("en-US", "secretPassphraseRemove") });
    for (const settings of [onWithoutConsent, baseSettings]) {
      cleanup();
      render(<AiSection lang="en-US" settings={settings} onChange={vi.fn()} />);
      expect(screen.queryByPlaceholderText(t("en-US", "aiApiKeyPlaceholder"))).toBeNull();
      expect(screen.queryByLabelText(t("en-US", "secretLockPassphrase"))).toBeNull();
      expect(screen.queryByLabelText(/^passphrase$/i)).toBeNull();
      expect(removeButton()).toBeInTheDocument();
    }
    fireEvent.click(removeButton()!);
    await waitFor(() => expect(loadSealed("anthropicApiKey")).toBeNull());
    expect(removeButton()).toBeNull();
    cleanup();
    render(<AiSection lang="en-US" settings={onWithoutConsent} onChange={vi.fn()} />); // control: nothing stored
    expect(removeButton()).toBeNull();
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

  it("renders the weekly hard cap input blank by default, with a help line (AI-03)", () => {
    render(<AiSection lang="en-US" settings={defaultSettings} onChange={vi.fn()} />);
    const input = screen.getByLabelText(t("en-US", "aiWeeklyHardCap")) as HTMLInputElement;
    expect(input.type).toBe("number");
    expect(input.value).toBe("");
    expect(screen.getByText(t("en-US", "aiWeeklyHardCapHelp"))).toBeInTheDocument();
  });

  it("typing a weekly hard cap saves it through onChange; clearing it removes the cap (AI-03)", () => {
    const onChange = vi.fn();
    render(<AiSection lang="en-US" settings={defaultSettings} onChange={onChange} />);
    const input = screen.getByLabelText(t("en-US", "aiWeeklyHardCap"));
    fireEvent.change(input, { target: { value: "8" } });
    fireEvent.change(input, { target: { value: "800000" } });
    expect(onChange).not.toHaveBeenCalled(); // a half-typed number is only a draft
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls.at(-1)?.[0].ai.weeklyHardCap).toBe(800_000);
    cleanup();
    const withCap = { ...defaultSettings, ai: { ...defaultSettings.ai, weeklyHardCap: 800_000 } };
    render(<AiSection lang="en-US" settings={withCap} onChange={onChange} />);
    const again = screen.getByLabelText(t("en-US", "aiWeeklyHardCap"));
    fireEvent.change(again, { target: { value: "" } });
    fireEvent.keyDown(again, { key: "Enter" });
    expect(onChange.mock.calls.at(-1)?.[0].ai.weeklyHardCap).toBeUndefined();
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
    // WCAG 2.5.3 (label-in-name). The axe gate runs
    // `label-content-name-mismatch` since 4.14, but only over what the scanned
    // views render; this pins the pair wherever the section renders. Matching
    // the two strings at write time is the protection.
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

  // §609 M3: untick → the device re-seal is held open (the wrap flips only after it, so the
  // passphrase fields stay up); "Save passphrase" then starts a newer write, so the device seal
  // resolves false and must NOT flip the checkbox to device over the passphrase record.
  it("a superseded unlock re-seal leaves the newer passphrase lock in place", async () => {
    const key = "sk-ant-api03-have0000000000000";
    const deviceSealed = await sealDevice("anthropicApiKey", key); // real ciphertext, before the spy
    let releaseSeal: (s: SealedSecret) => void = () => {};
    vi.spyOn(secrets, "sealDevice").mockReturnValueOnce(
      new Promise<SealedSecret>((r) => {
        releaseSeal = r;
      }),
    );
    const settingsWithKey = { ...defaultSettings, ai: { ...defaultSettings.ai, apiKey: key } };
    render(<AiSection lang="en-US" settings={settingsWithKey} onChange={vi.fn()} />);
    const lock = () => screen.getByLabelText(/require a passphrase/i);
    fireEvent.click(lock()); // tick → passphrase fields
    fireEvent.change(screen.getByLabelText(/^passphrase$/i), { target: { value: "pw" } });
    fireEvent.change(screen.getByLabelText(/confirm passphrase/i), { target: { value: "pw" } });
    fireEvent.click(lock()); // untick → device re-seal starts, held open; wrap not flipped yet
    expect(secrets.sealDevice).toHaveBeenCalledWith("anthropicApiKey", key);
    expect(lock()).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: /save passphrase/i })); // newer write begins

    await act(async () => {
      releaseSeal(deviceSealed);
      await new Promise((r) => setTimeout(r, 0));
    });

    // Round 2: the superseded device seal shows what the store holds meanwhile; the passphrase
    // save sets the wrap back to passphrase when it lands, so the END state is the lock, ticked.
    await waitFor(() => {
      expect(isPassphraseLocked("anthropicApiKey")).toBe(true);
      expect(lock()).toBeChecked();
    });
  });

  // §609 round 2 M2: a CLEAR (emptying the field) supersedes the untick re-seal. The store then
  // holds nothing, so the lock shows device and nothing is marked stored — not stuck on passphrase.
  it("a clear during the unlock re-seal leaves the lock on device and nothing stored", async () => {
    const key = "sk-ant-api03-have0000000000000";
    const deviceSealed = await sealDevice("anthropicApiKey", key); // real ciphertext, before the spy
    let releaseSeal: (s: SealedSecret) => void = () => {};
    vi.spyOn(secrets, "sealDevice").mockReturnValueOnce(
      new Promise<SealedSecret>((r) => {
        releaseSeal = r;
      }),
    );
    function Harness() {
      const [s, setS] = useState<Settings>({ ...defaultSettings, ai: { ...defaultSettings.ai, apiKey: key } });
      return <AiSection lang="en-US" settings={s} onChange={setS} />;
    }
    render(<Harness />);
    const lock = () => screen.getByLabelText(/require a passphrase/i);
    fireEvent.click(lock()); // tick
    fireEvent.click(lock()); // untick → device re-seal starts, held open
    expect(secrets.sealDevice).toHaveBeenCalledWith("anthropicApiKey", key);
    fireEvent.change(screen.getByPlaceholderText(t("en-US", "aiApiKeyPlaceholder")), { target: { value: "" } });

    await act(async () => {
      releaseSeal(deviceSealed);
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(loadSealed("anthropicApiKey")).toBeNull();
    expect(lock()).not.toBeChecked();
    expect(screen.queryByRole("button", { name: /remove stored secret/i })).toBeNull();
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

  it("ticking Enable AI with no consent opens the dialog and does NOT set enabled", () => {
    const onChange = vi.fn();
    render(<AiSection lang="en-US" settings={baseSettings} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText(t("en-US", "aiEnable")));
    expect(screen.getByRole("dialog", { name: t("en-US", "aiConsentTitle") })).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Accept in the dialog sets enabled and a consent at the current disclosure version", () => {
    const onChange = vi.fn();
    render(<AiSection lang="en-US" settings={baseSettings} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText(t("en-US", "aiEnable")));
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "aiConsentAccept") }));
    const ai = onChange.mock.calls.at(-1)![0].ai;
    expect(ai.enabled).toBe(true);
    expect(ai.consent).toEqual({ acceptedAt: expect.any(String), disclosureVersion: 1, route: "direct" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Cancel in the dialog leaves enabled false", () => {
    const onChange = vi.fn();
    render(<AiSection lang="en-US" settings={baseSettings} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText(t("en-US", "aiEnable")));
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "cancel") }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByLabelText(t("en-US", "aiEnable"))).not.toBeChecked();
  });

  it("ticking Enable AI with a current consent enables at once, with no dialog", () => {
    const onChange = vi.fn();
    const withConsent = { ...baseSettings, ai: { ...baseSettings.ai, consent: newConsent(new Date(0)) } };
    render(<AiSection lang="en-US" settings={withConsent} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText(t("en-US", "aiEnable")));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onChange.mock.calls.at(-1)![0].ai.enabled).toBe(true);
    // AI-01 — switching on widens AI permission, so the action itself persists it (an ordinary write cannot).
    expect((JSON.parse(localStorage.getItem(SETTINGS_KEY)!) as Settings).ai.enabled).toBe(true);
  });

  it("Revoke clears both consent records and leaves the API key", () => {
    const onChange = vi.fn();
    const granted = {
      ...baseSettings,
      ai: {
        ...baseSettings.ai,
        enabled: true,
        apiKey: "sk-keep",
        consent: newConsent(new Date(0)),
        backgroundConsent: newConsent(new Date(0)),
      },
    };
    render(<AiSection lang="en-US" settings={granted} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "aiConsentRevoke") }));
    const ai = onChange.mock.calls.at(-1)![0].ai;
    expect(ai.consent).toBeUndefined();
    expect(ai.backgroundConsent).toBeUndefined();
    expect(ai.apiKey).toBe("sk-keep");
  });

  it("Revoke and Accept persist the consent records at once (AI-01: other writes may only narrow them)", () => {
    const granted = {
      ...baseSettings,
      ai: { ...baseSettings.ai, enabled: true, consent: newConsent(new Date(0)), backgroundConsent: newConsent(new Date(0)) },
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ai: granted.ai }));
    const { unmount } = render(<AiSection lang="en-US" settings={granted} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "aiConsentRevoke") }));
    const revoked = (JSON.parse(localStorage.getItem(SETTINGS_KEY)!) as Settings).ai;
    expect(revoked.consent).toBeUndefined();
    expect(revoked.backgroundConsent).toBeUndefined();
    expect(revoked.apiKey).toBe(""); // the at-rest key is blanked, as on every settings write
    unmount();
    render(<AiSection lang="en-US" settings={{ ...baseSettings }} onChange={vi.fn()} />);
    fireEvent.click(screen.getByLabelText(t("en-US", "aiEnable")));
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "aiConsentAccept") }));
    const accepted = (JSON.parse(localStorage.getItem(SETTINGS_KEY)!) as Settings).ai;
    expect(accepted.enabled).toBe(true);
    expect(accepted.consent?.disclosureVersion).toBe(newConsent(new Date(0)).disclosureVersion);
  });

  describe("background consent (AI-10)", () => {
    const interactiveOnly = {
      ...baseSettings,
      ai: { ...baseSettings.ai, enabled: true, apiKey: "sk-keep", consent: newConsent(new Date(0)) },
    };
    const bgToggle = () => screen.getByLabelText(t("en-US", "aiBackgroundConsentToggle")) as HTMLInputElement;
    /** What a hydrated instance has already persisted: the AI switch and records the section is shown with. */
    const storeAi = (s: Settings) => localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ai: { ...s.ai, apiKey: "" } }));

    it("is off by default and disables the insight-recommendations toggle with the reason", () => {
      render(<AiSection lang="en-US" settings={interactiveOnly} onChange={vi.fn()} />);
      expect(bgToggle().checked).toBe(false);
      expect(screen.getByLabelText(t("en-US", "aiInsightRecommendations"))).toBeDisabled();
      expect(screen.getByText(t("en-US", "aiBackgroundConsentNeeded"))).toBeInTheDocument();
    });

    it("a recommendations toggle left on from before can be switched off without the background consent (AI-01)", () => {
      const onChange = vi.fn();
      const leftOn = { ...interactiveOnly, ai: { ...interactiveOnly.ai, insightRecommendations: true } };
      render(<AiSection lang="en-US" settings={leftOn} onChange={onChange} />);
      const toggle = screen.getByLabelText(t("en-US", "aiInsightRecommendations")) as HTMLInputElement;
      expect(toggle).toBeEnabled();
      expect(toggle.checked).toBe(true);
      expect(toggle).not.toHaveAttribute("aria-describedby");
      expect(screen.getByText(t("en-US", "aiBackgroundConsentNeeded"))).toBeInTheDocument(); // why it will not run
      fireEvent.click(toggle);
      expect(onChange.mock.calls.at(-1)![0].ai.insightRecommendations).toBe(false);
    });

    it("links the reason to the disabled insight-recommendations toggle as its accessible description", () => {
      const { unmount } = render(<AiSection lang="en-US" settings={interactiveOnly} onChange={vi.fn()} />);
      expect(screen.getByLabelText(t("en-US", "aiInsightRecommendations"))).toHaveAccessibleDescription(
        t("en-US", "aiBackgroundConsentNeeded"),
      );
      unmount();
      const granted = { ...interactiveOnly, ai: { ...interactiveOnly.ai, backgroundConsent: newConsent(new Date(0)) } };
      render(<AiSection lang="en-US" settings={granted} onChange={vi.fn()} />);
      expect(screen.getByLabelText(t("en-US", "aiInsightRecommendations"))).not.toHaveAttribute("aria-describedby");
    });

    it("ticking it opens the background dialog, which lists the three runners, and stores nothing until Accept", () => {
      const onChange = vi.fn();
      render(<AiSection lang="en-US" settings={interactiveOnly} onChange={onChange} />);
      fireEvent.click(bgToggle());
      const dialog = screen.getByRole("dialog", { name: t("en-US", "aiConsentBackgroundTitle") });
      expect(dialog.querySelector("[data-consent-level]")).toHaveAttribute("data-consent-level", "background");
      for (const key of ["aiConsentBackgroundRunner1", "aiConsentBackgroundRunner2", "aiConsentBackgroundRunner3"] as const) {
        expect(within(dialog).getByText(t("en-US", key))).toBeInTheDocument();
      }
      expect(onChange).not.toHaveBeenCalled();
    });

    it("Accept stores backgroundConsent at the current disclosure version and leaves the interactive consent", () => {
      const onChange = vi.fn();
      storeAi(interactiveOnly);
      render(<AiSection lang="en-US" settings={interactiveOnly} onChange={onChange} />);
      fireEvent.click(bgToggle());
      fireEvent.click(screen.getByRole("button", { name: t("en-US", "aiConsentBackgroundAccept") }));
      const ai = onChange.mock.calls.at(-1)![0].ai;
      expect(ai.backgroundConsent).toEqual({ acceptedAt: expect.any(String), disclosureVersion: 1, route: "direct" });
      expect(ai.consent).toEqual(interactiveOnly.ai.consent);
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("Cancel stores nothing", () => {
      const onChange = vi.fn();
      render(<AiSection lang="en-US" settings={interactiveOnly} onChange={onChange} />);
      fireEvent.click(bgToggle());
      fireEvent.click(screen.getByRole("button", { name: t("en-US", "cancel") }));
      expect(onChange).not.toHaveBeenCalled();
    });

    it("with the consent granted the toggle is checked, the insight toggle is enabled, and unticking revokes it at once", () => {
      const onChange = vi.fn();
      const granted = { ...interactiveOnly, ai: { ...interactiveOnly.ai, backgroundConsent: newConsent(new Date(0)) } };
      storeAi(granted);
      render(<AiSection lang="en-US" settings={granted} onChange={onChange} />);
      expect(bgToggle().checked).toBe(true);
      expect(screen.getByLabelText(t("en-US", "aiInsightRecommendations"))).toBeEnabled();
      fireEvent.click(bgToggle());
      const ai = onChange.mock.calls.at(-1)![0].ai;
      expect(ai.backgroundConsent).toBeUndefined();
      expect(ai.consent).toEqual(granted.ai.consent);
    });
  });
});

// AI-01 — an accept or a revoke whose write fails (storage full or unavailable) is never silent: a revoke still
// applies in memory and says it was not saved, with a "Save again"; an accept is not committed and says so.
describe("AiSection — a consent change that cannot be saved (AI-01)", () => {
  const C = newConsent(new Date(0));
  const granted = { ...baseSettings, ai: { ...baseSettings.ai, enabled: true, consent: C, backgroundConsent: C } };
  const interactiveOnly = { ...baseSettings, ai: { ...baseSettings.ai, enabled: true, consent: C } };
  const realSetItem = Storage.prototype.setItem;
  const failSettingsWrites = () =>
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === SETTINGS_KEY) throw new DOMException("full", "QuotaExceededError");
      realSetItem.call(this, key, value);
    });
  const persistedAi = () => (JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as Settings).ai;

  function renderWith(initial: Settings) {
    const onChange = vi.fn();
    const showToast = vi.fn();
    const showToastAction = vi.fn();
    function Harness() {
      const [s, setS] = useState<Settings>(initial);
      return (
        <ToastProvider value={{ showToast, showToastAction }}>
          <AiSection lang="en-US" settings={s} onChange={(next) => { onChange(next); setS(next); }} />
        </ToastProvider>
      );
    }
    render(<Harness />);
    return { onChange, showToast, showToastAction };
  }

  it("a revoke that cannot be saved still applies, says so, and can be saved again", () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ai: granted.ai }));
    const { onChange, showToast, showToastAction } = renderWith(granted);
    const spy = failSettingsWrites();
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "aiConsentRevoke") }));
    expect(onChange.mock.calls.at(-1)![0].ai.consent).toBeUndefined(); // in effect here
    expect(persistedAi().consent).toEqual(C); // control: the write did fail
    expect(showToast).not.toHaveBeenCalled();
    expect(showToastAction).toHaveBeenCalledTimes(1);
    const [kind, text, action] = showToastAction.mock.calls[0] as [string, string, { labelKey: string; run: () => void }];
    expect([kind, text, action.labelKey]).toEqual(["error", t("en-US", "aiConsentRevokeNotSaved"), "aiConsentRevokeRetry"]);

    act(() => action.run()); // still failing: reported again
    expect(showToastAction).toHaveBeenCalledTimes(2);

    spy.mockRestore();
    act(() => action.run());
    expect(persistedAi().consent).toBeUndefined();
    expect(persistedAi().backgroundConsent).toBeUndefined();
    expect(showToast).toHaveBeenCalledWith("success", t("en-US", "aiConsentRevokeSaved"));
  });

  it("a background revoke that cannot be saved still applies and says so", () => {
    const { onChange, showToastAction } = renderWith(granted);
    failSettingsWrites();
    fireEvent.click(screen.getByLabelText(t("en-US", "aiBackgroundConsentToggle")));
    expect(onChange.mock.calls.at(-1)![0].ai.backgroundConsent).toBeUndefined();
    expect(showToastAction.mock.calls[0]?.[1]).toBe(t("en-US", "aiConsentRevokeNotSaved"));
  });

  it("an accept that cannot be saved does not switch AI on, and says so", () => {
    const { onChange, showToast, showToastAction } = renderWith(baseSettings);
    failSettingsWrites();
    fireEvent.click(screen.getByLabelText(t("en-US", "aiEnable")));
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "aiConsentAccept") }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText(t("en-US", "aiEnable"))).not.toBeChecked();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(showToast).toHaveBeenCalledWith("error", t("en-US", "aiConsentAcceptNotSaved"));
    expect(showToastAction).not.toHaveBeenCalled();
  });

  it("a switch-on that cannot be saved leaves AI off, and says so", () => {
    const { onChange, showToast, showToastAction } = renderWith({ ...baseSettings, ai: { ...baseSettings.ai, consent: C } });
    failSettingsWrites();
    fireEvent.click(screen.getByLabelText(t("en-US", "aiEnable")));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText(t("en-US", "aiEnable"))).not.toBeChecked();
    expect(showToast).toHaveBeenCalledWith("error", t("en-US", "aiEnableNotSaved"));
    expect(showToastAction).not.toHaveBeenCalled();
  });

  it("a background accept that cannot be saved stores nothing, and says so", () => {
    const { onChange, showToast } = renderWith(interactiveOnly);
    failSettingsWrites();
    fireEvent.click(screen.getByLabelText(t("en-US", "aiBackgroundConsentToggle")));
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "aiConsentBackgroundAccept") }));
    expect(onChange).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith("error", t("en-US", "aiBackgroundConsentAcceptNotSaved"));
  });
});

// AI-01 — each action in Settings → AI widens only its own field in storage: a section shown with values that
// another tab has since narrowed (it missed that change) cannot write them back by accepting something else.
describe("AiSection — an action widens only its own field (AI-01)", () => {
  const C = newConsent(new Date(0));
  const OLD = { acceptedAt: "1970-01-01T00:00:00.000Z", disclosureVersion: 0 };
  const persistedAi = () => (JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as Settings).ai;
  const storeAi = (ai: Partial<Settings["ai"]>) => localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ai }));

  it("a background accept does not switch AI back on", () => {
    const shown = { ...baseSettings, ai: { ...baseSettings.ai, enabled: true, consent: C } };
    storeAi({ enabled: false, consent: C }); // switched off elsewhere
    const onChange = vi.fn();
    render(<AiSection lang="en-US" settings={shown} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText(t("en-US", "aiBackgroundConsentToggle")));
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "aiConsentBackgroundAccept") }));
    expect(persistedAi().backgroundConsent).toEqual({ acceptedAt: expect.any(String), disclosureVersion: 1, route: "direct" }); // control
    expect(persistedAi().enabled).toBe(false);
    expect(onChange.mock.calls.at(-1)![0].ai.enabled).toBe(false);
  });

  it("an accept does not bring back a background consent revoked elsewhere", () => {
    const shown = { ...baseSettings, ai: { ...baseSettings.ai, enabled: true, consent: OLD, backgroundConsent: C } };
    storeAi({ enabled: true, consent: OLD }); // background consent revoked elsewhere
    const onChange = vi.fn();
    render(<AiSection lang="en-US" settings={shown} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "aiConsentReview") }));
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "aiConsentAccept") }));
    expect(persistedAi().consent).toEqual({ acceptedAt: expect.any(String), disclosureVersion: 1, route: "direct" }); // control
    expect(persistedAi().enabled).toBe(true);
    expect(persistedAi().backgroundConsent).toBeUndefined();
    expect(onChange.mock.calls.at(-1)![0].ai.backgroundConsent).toBeUndefined();
  });

  it("switching on does not write back a consent revoked elsewhere", () => {
    const shown = { ...baseSettings, ai: { ...baseSettings.ai, enabled: false, consent: C, backgroundConsent: C } };
    storeAi({ enabled: false }); // both consents revoked elsewhere
    const onChange = vi.fn();
    render(<AiSection lang="en-US" settings={shown} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText(t("en-US", "aiEnable")));
    expect(persistedAi().enabled).toBe(true); // control: the switch-on was saved
    expect(persistedAi().consent).toBeUndefined();
    expect(persistedAi().backgroundConsent).toBeUndefined();
    expect(onChange.mock.calls.at(-1)![0].ai.consent).toBeUndefined();
  });
});

// open-followups §386: the hinted key field and model select are named by
// their captions alone; the storage notice is the key field's description.
describe("AiSection — hinted field names (§386)", () => {
  it("names the key field and model select with their captions alone", () => {
    render(<AiSection lang="en-US" settings={defaultSettings} onChange={vi.fn()} />);
    expectNoHintInNamingLabel({ minHints: 2 });
    expectExactLabelNames([t("en-US", "aiApiKey"), t("en-US", "aiModel")]);
    expect(screen.getByLabelText(t("en-US", "aiApiKey"))).toHaveAccessibleDescription(
      t("en-US", "credentialStorageNote"),
    );
  });
});

describe("AiSection API-key validation", () => {
  // The api-key field is a CONTROLLED input: a bare vi.fn() onChange never lifts
  // state, so React resets the DOM value to "" and the blur sees an empty key.
  // Lift state through a harness (the live SettingsView does the same) so the
  // typed value reaches the blur handler, while still spying every onChange call.
  function renderAi(showToast = vi.fn(), apiKey = "") {
    const onChange = vi.fn();
    function Harness() {
      const [s, setS] = useState<Settings>({
        ...defaultSettings,
        ai: { ...defaultSettings.ai, enabled: true, apiKey },
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

  // §565 blank-first rule (§609 M4): emptying the field removes a stored device key — it used to
  // stay sealed and rehydrate on the next load. A passphrase key is exempt (see below).
  it("emptying the field removes a stored device-sealed key and hides Remove", async () => {
    const key = "sk-ant-api03-have0000000000000";
    saveSealed(await sealDevice("anthropicApiKey", key));
    renderAi(vi.fn(), key);
    const remove = () => screen.queryByRole("button", { name: /remove stored secret/i });
    expect(remove()).not.toBeNull(); // control: the stored badge starts on
    fireEvent.change(screen.getByPlaceholderText("sk-ant-..."), { target: { value: "" } });
    expect(loadSealed("anthropicApiKey")).toBeNull();
    expect(remove()).toBeNull();
  });

  // A LOCKED passphrase key shows "" here (its plaintext is never hydrated into settings), so a
  // stray keystroke deleted again must not destroy it; "Remove stored secret" stays the way out.
  it("typing into a locked key's blank field and deleting it keeps the passphrase record", async () => {
    saveSealed(await sealPassphrase("anthropicApiKey", "sk-ant-api03-have0000000000000", "pw"));
    renderAi(); // locked: settings hold ""
    const input = screen.getByPlaceholderText("sk-ant-...");
    expect(screen.getByLabelText(/require a passphrase/i)).toBeChecked();
    fireEvent.change(input, { target: { value: "x" } });
    fireEvent.change(input, { target: { value: "" } });
    expect(isPassphraseLocked("anthropicApiKey")).toBe(true);
    expect(screen.getByRole("button", { name: /remove stored secret/i })).toBeInTheDocument();
  });

  // §609: the typed key's device seal is still awaiting WebCrypto when the field is emptied
  // (removeSealed). The late seal must neither write the ciphertext back nor re-arm "stored".
  it("a key cleared while its seal is in flight stays cleared when the seal lands", async () => {
    const validKey = "sk-ant-api03-race0000000000000";
    const sealed = await sealDevice("anthropicApiKey", validKey); // real ciphertext, before the spy
    let releaseSeal: (s: SealedSecret) => void = () => {};
    vi.spyOn(secrets, "sealDevice").mockReturnValueOnce(
      new Promise<SealedSecret>((r) => {
        releaseSeal = r;
      }),
    );
    renderAi();
    const input = screen.getByPlaceholderText("sk-ant-...");
    fireEvent.change(input, { target: { value: validKey } }); // seal starts, held open
    expect(secrets.sealDevice).toHaveBeenCalledWith("anthropicApiKey", validKey);
    fireEvent.change(input, { target: { value: "" } }); // emptied → removeSealed

    await act(async () => {
      releaseSeal(sealed);
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(loadSealed("anthropicApiKey")).toBeNull();
    expect(screen.queryByRole("button", { name: /remove stored secret/i })).toBeNull();
  });
});

describe("AiSection — §650 the key verdict next to the key field", () => {
  const KEY = "sk-ant-api03-SettingsNoticeKey000000";
  const withKey = { ...defaultSettings, ai: { ...defaultSettings.ai, apiKey: KEY } };
  const NO_KEY_HINT = t("en-US", "aiModelNeedsKey");

  beforeEach(() => __resetAiKeyStatusForTests());

  function keyField() {
    return screen.getByPlaceholderText(t("en-US", "aiApiKeyPlaceholder"));
  }

  it.each([
    [401, "aiKeyRejected"],
    [403, "aiKeyForbidden"],
  ] as const)("a %i verdict shows its notice, described on the key field", async (status, key) => {
    reportAiKeyResponse(KEY, status);
    render(<AiSection lang="en-US" settings={withKey} onChange={vi.fn()} />);
    const notice = screen.getByRole("alert");
    expect(notice).toHaveTextContent(t("en-US", key));
    expect(keyField()).toHaveAccessibleDescription(expect.stringContaining(t("en-US", key)));
    expect(keyField()).toHaveAttribute("aria-invalid", "true");
  });

  it("a rejected key does NOT get the 'enter a valid key' model hint — it gets the key message", async () => {
    reportAiKeyResponse(KEY, 401);
    render(<AiSection lang="en-US" settings={withKey} onChange={vi.fn()} />);
    const select = screen.getByRole("combobox", { name: t("en-US", "aiModel") });
    expect(select).not.toHaveAccessibleDescription(NO_KEY_HINT);
    expect(select).toHaveAccessibleDescription(t("en-US", "aiKeyRejected"));
  });

  it("with no key at all the model hint stays the no-key hint (control for the test above)", async () => {
    render(<AiSection lang="en-US" settings={defaultSettings} onChange={vi.fn()} />);
    const select = screen.getByRole("combobox", { name: t("en-US", "aiModel") });
    expect(select).toHaveAccessibleDescription(NO_KEY_HINT);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("an unreadable key shows the unreadable notice", async () => {
    reportAiKeyUnreadable();
    render(<AiSection lang="en-US" settings={defaultSettings} onChange={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent(t("en-US", "aiKeyUnreadable"));
  });

  it("an accepted key shows no notice", async () => {
    reportAiKeyResponse(KEY, 200);
    render(<AiSection lang="en-US" settings={withKey} onChange={vi.fn()} />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(keyField()).not.toHaveAttribute("aria-invalid", "true");
  });
});

// §749 — the Claude key, under the passphrase lock, is the same hazard §715 closed for the Turso token: a
// keystroke commits the key to settings, but nothing seals it until "Save passphrase", and every reload path
// blanks it (`writeSettings`). The key is held as UNSEALED until a seal covers it, so the reload paths can
// refuse; and the lock a section shows is derived from the store and that marker, so a second mounted section
// (Settings under the setup wizard) cannot device-seal over a passphrase record the other one saved.
describe("AiSection — a key typed under the passphrase lock (§749)", () => {
  const KEY = "sk-ant-api03-typed000000000000";
  const keyField = () => screen.getByPlaceholderText(t("en-US", "aiApiKeyPlaceholder"));
  const lock = () => screen.getAllByLabelText(/require a passphrase/i)[0];

  function Controlled({ initial = defaultSettings }: { initial?: Settings }) {
    const [s, setS] = useState<Settings>(initial);
    return <AiSection lang="en-US" settings={s} onChange={setS} />;
  }

  it("is held as unsealed until Save passphrase seals it, and is never device-sealed meanwhile", async () => {
    render(<Controlled />);
    fireEvent.click(lock()); // the lock first, then the key
    fireEvent.change(keyField(), { target: { value: KEY } });
    expect(hasUnsealedPassphraseSecret("anthropicApiKey", KEY)).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(await readDeviceSecret("anthropicApiKey")).toBeNull();
    fireEvent.change(screen.getByLabelText(/^passphrase$/i), { target: { value: "pw" } });
    fireEvent.change(screen.getByLabelText(/confirm passphrase/i), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: /save passphrase/i }));
    await waitFor(() => expect(isPassphraseLocked("anthropicApiKey")).toBe(true));
    expect(hasUnsealedPassphraseSecret("anthropicApiKey", KEY)).toBe(false);
  });

  it("the positive control: with the lock off, a typed key is device-sealed and never held", async () => {
    render(<Controlled />);
    fireEvent.change(keyField(), { target: { value: KEY } });
    expect(hasUnsealedPassphraseSecret("anthropicApiKey", KEY)).toBe(false);
    await waitFor(async () => expect(await readDeviceSecret("anthropicApiKey")).toBe(KEY));
  });

  it("Remove stored secret forgets a held key", async () => {
    render(<Controlled />);
    fireEvent.click(lock());
    fireEvent.change(keyField(), { target: { value: KEY } });
    fireEvent.change(screen.getByLabelText(/^passphrase$/i), { target: { value: "pw" } });
    fireEvent.change(screen.getByLabelText(/confirm passphrase/i), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: /save passphrase/i }));
    await waitFor(() => expect(isPassphraseLocked("anthropicApiKey")).toBe(true));
    fireEvent.change(keyField(), { target: { value: `${KEY}9` } }); // typed again, under the lock
    expect(hasUnsealedPassphraseSecret("anthropicApiKey", `${KEY}9`)).toBe(true);
    setSessionAiKey("sk-ant-unlocked"); // §717 — as if the chat had unlocked it on this page
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "secretPassphraseRemove") }));
    await waitFor(() => expect(hasUnsealedPassphraseSecret("anthropicApiKey", `${KEY}9`)).toBe(false));
    expect(getSessionAiKey()).toBe(""); // a removed key does not keep working from memory
  });

  // Settings keeps its section mounted under the wizard, which mounts a second one. A passphrase saved in
  // one must not leave the other on its mount-time "device", whose next keystroke would device-seal over it.
  it("a passphrase saved in one mounted section keeps the other's next keystroke off the device wrap", async () => {
    const withKey: Settings = { ...defaultSettings, ai: { ...defaultSettings.ai, apiKey: KEY } };
    const first = render(<AiSection lang="en-US" settings={withKey} onChange={vi.fn()} />);
    const second = render(<Controlled initial={withKey} />); // mounted while the record is still device-or-none
    const one = within(first.container);
    fireEvent.click(one.getByLabelText(/require a passphrase/i));
    fireEvent.change(one.getByLabelText(/^passphrase$/i), { target: { value: "pw" } });
    fireEvent.change(one.getByLabelText(/confirm passphrase/i), { target: { value: "pw" } });
    fireEvent.click(one.getByRole("button", { name: /save passphrase/i }));
    await waitFor(() => expect(isPassphraseLocked("anthropicApiKey")).toBe(true));
    const record = loadSealed("anthropicApiKey");
    const secondKeyField = within(second.container).getByPlaceholderText(t("en-US", "aiApiKeyPlaceholder"));
    fireEvent.change(secondKeyField, { target: { value: `${KEY}2` } });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(isPassphraseLocked("anthropicApiKey")).toBe(true);
    expect(loadSealed("anthropicApiKey")).toEqual(record); // not replaced by a device seal
    expect(hasUnsealedPassphraseSecret("anthropicApiKey", `${KEY}2`)).toBe(true);
  });
});

describe("AiSection — the lock's records survive a blur and an untick (§749 review)", () => {
  const KEY = "sk-ant-api03-have0000000000000";
  const keyField = () => screen.getByPlaceholderText(t("en-US", "aiApiKeyPlaceholder"));

  // A passphrase-locked key is never hydrated, so the field shows "" — one stray character then Tab would make
  // the blur's invalid-key discard destroy a key the user never saw. KILLED BY: dropping the blur's lock check.
  it("a malformed key blurred over a passphrase record leaves the record", async () => {
    saveSealed(await sealPassphrase("anthropicApiKey", KEY, "pw"));
    expect(isPassphraseLocked("anthropicApiKey")).toBe(true);
    const record = loadSealed("anthropicApiKey");
    function Controlled() {
      const [s, setS] = useState<Settings>(defaultSettings);
      return <AiSection lang="en-US" settings={s} onChange={setS} />;
    }
    render(<Controlled />);
    fireEvent.change(keyField(), { target: { value: "x" } });
    fireEvent.blur(keyField());
    expect(loadSealed("anthropicApiKey")).toEqual(record);
  });

  // A key typed while the untick's device re-seal is awaited is held under the still-ticked lock; the re-seal of
  // the EARLIER key landing must not clear it. KILLED BY: clearing the marker unconditionally after the re-seal.
  it("a key typed during the untick's re-seal stays held after it lands", async () => {
    const deviceSealed = await sealDevice("anthropicApiKey", KEY);
    let releaseSeal: (s: SealedSecret) => void = () => {};
    vi.spyOn(secrets, "sealDevice").mockReturnValueOnce(new Promise<SealedSecret>((r) => { releaseSeal = r; }));
    function Controlled() {
      const [s, setS] = useState<Settings>({ ...defaultSettings, ai: { ...defaultSettings.ai, apiKey: KEY } });
      return <AiSection lang="en-US" settings={s} onChange={setS} />;
    }
    render(<Controlled />);
    const lock = () => screen.getByLabelText(/require a passphrase/i);
    fireEvent.click(lock()); // tick
    fireEvent.click(lock()); // untick → device re-seal of KEY, held open
    fireEvent.change(keyField(), { target: { value: `${KEY}2` } }); // under the still-ticked lock
    expect(hasUnsealedPassphraseSecret("anthropicApiKey", `${KEY}2`)).toBe(true);
    await act(async () => { releaseSeal(deviceSealed); await new Promise((r) => setTimeout(r, 0)); });
    expect(hasUnsealedPassphraseSecret("anthropicApiKey", `${KEY}2`)).toBe(true);
  });
});

describe("AiSection — deployment notice", () => {
  afterEach(() => setAiDeploymentState(DIRECT_AI_STATUS));
  it("off: shows the notice, disables the master switch and changes nothing", () => {
    setAiDeploymentState({ off: true, route: "direct", invalid: false });
    const onChange = vi.fn();
    const settings = { ...defaultSettings, ai: { ...defaultSettings.ai, apiKey: "sk-ant-keep", backgroundConsent: newConsent(new Date(0)) } };
    const before = structuredClone(settings.ai);
    render(<AiSection lang="en-US" settings={settings} onChange={onChange} />);
    expect(screen.getByText(t("en-US", "aiDeploymentOff"))).toBeInTheDocument();
    const master = screen.getByRole("checkbox", { name: t("en-US", "aiEnable") });
    expect(master).toBeDisabled();
    fireEvent.click(master);
    expect(onChange).not.toHaveBeenCalled();
    expect(settings.ai.apiKey).toBe(before.apiKey);
    expect(settings.ai.consent).toEqual(before.consent);
    expect(settings.ai.backgroundConsent).toEqual(before.backgroundConsent);
  });
  it("invalid: shows the invalid notice", () => {
    setAiDeploymentState({ off: false, route: "direct", invalid: true });
    render(<AiSection lang="en-US" settings={defaultSettings} onChange={vi.fn()} />);
    expect(screen.getByText(t("en-US", "aiDeploymentInvalid"))).toBeInTheDocument();
  });

  it("blocked: the master switch reads unticked, names the notice, and the stored switch is untouched", () => {
    setAiDeploymentState({ off: true, route: "direct", invalid: false });
    const onChange = vi.fn();
    const settings = { ...defaultSettings, ai: { ...defaultSettings.ai } };
    render(<AiSection lang="en-US" settings={settings} onChange={onChange} />);
    const master = screen.getByRole("checkbox", { name: t("en-US", "aiEnable") });
    expect(master).not.toBeChecked();
    const describedBy = master.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy ?? "")).toHaveTextContent(t("en-US", "aiDeploymentOff"));
    expect(settings.ai.enabled).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("not blocked: the master switch carries no deployment description (control)", () => {
    render(<AiSection lang="en-US" settings={defaultSettings} onChange={vi.fn()} />);
    const master = screen.getByRole("checkbox", { name: t("en-US", "aiEnable") });
    expect(master).toBeChecked();
    expect(master).not.toHaveAttribute("aria-describedby");
  });

  const GATEWAY_CONSENT = { ...newConsent(new Date(0)), route: "gateway" as const };
  const DIRECT_KEYS = ["aiApiKeyHint", "aiConsentDataIntro", "aiConsentBackgroundDataIntro", "aiConsentBullet2"] as const;

  it.each([
    ["invalid, gateway consent current", { off: false, route: "gateway" as const, invalid: true, invalidReason: "url" as const }],
    ["off, consent for the other route", { off: true, route: "direct" as const, invalid: false }],
    ["invalid, consent for the other route", { off: false, route: "direct" as const, invalid: true }],
  ])("blocked (%s) with AI stored on and a key: no AI controls, no review, no direct text; Remove stays", async (_label, state) => {
    saveSealed(await sealDevice("anthropicApiKey", "sk-ant-api03-stored000000000000"));
    setAiDeploymentState(state);
    const onChange = vi.fn();
    const settings = { ...defaultSettings, ai: { ...defaultSettings.ai, consent: GATEWAY_CONSENT, backgroundConsent: undefined } };
    const before = structuredClone(settings);
    const { container } = render(<AiSection lang="en-US" settings={settings} onChange={onChange} />);
    expect(screen.getByRole("button", { name: t("en-US", "secretPassphraseRemove") })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(t("en-US", "aiApiKeyPlaceholder"))).toBeNull();
    expect(screen.queryByLabelText(t("en-US", "aiGroundInGuides"))).toBeNull();
    expect(screen.queryByLabelText(t("en-US", "aiSessionCap"))).toBeNull();
    expect(screen.queryByRole("checkbox", { name: t("en-US", "aiBackgroundConsentToggle") })).toBeNull();
    expect(screen.queryByRole("button", { name: t("en-US", "aiConsentReview") })).toBeNull();
    expect(screen.queryByText(t("en-US", "aiConsentReviewPrompt"))).toBeNull();
    for (const key of DIRECT_KEYS) expect(container.textContent).not.toContain(t("en-US", key));
    expect(onChange).not.toHaveBeenCalled();
    expect(settings).toEqual(before);
  });

  it("on with a stale consent: the review entry point is there (control)", () => {
    setAiDeploymentState(DIRECT_AI_STATUS);
    const settings = { ...defaultSettings, ai: { ...defaultSettings.ai, consent: GATEWAY_CONSENT } };
    render(<AiSection lang="en-US" settings={settings} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: t("en-US", "aiConsentReview") })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: t("en-US", "aiBackgroundConsentToggle") })).toBeEnabled();
  });
});

describe("AiSection — the key note follows the AI route", () => {
  afterEach(() => setAiDeploymentState(DIRECT_AI_STATUS));
  it("direct: says calls go directly to api.anthropic.com (control)", () => {
    render(<AiSection lang="en-US" settings={defaultSettings} onChange={vi.fn()} />);
    expect(screen.getByText(t("en-US", "aiApiKeyHint"))).toBeInTheDocument();
  });
  it("gateway: names the app's server and the gateway instead", () => {
    setAiDeploymentState({ off: false, route: "gateway", invalid: false });
    const settings = { ...defaultSettings, ai: { ...defaultSettings.ai, consent: { ...newConsent(new Date(0)), route: "gateway" as const } } };
    render(<AiSection lang="en-US" settings={settings} onChange={vi.fn()} />);
    expect(screen.getByText(t("en-US", "aiApiKeyHintGateway"))).toBeInTheDocument();
    expect(screen.queryByText(t("en-US", "aiApiKeyHint"))).toBeNull();
  });
});

describe("AiSection — withdrawing while the deployment blocks AI", () => {
  const C = newConsent(new Date(0));
  const persistedAi = () => (JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as Settings).ai;
  afterEach(() => setAiDeploymentState(DIRECT_AI_STATUS));

  function renderWith(initial: Settings) {
    const onChange = vi.fn();
    function Harness() {
      const [s, setS] = useState<Settings>(initial);
      return (
        <ToastProvider value={{ showToast: vi.fn(), showToastAction: vi.fn() }}>
          <AiSection lang="en-US" settings={s} onChange={(next) => { onChange(next); setS(next); }} />
        </ToastProvider>
      );
    }
    render(<Harness />);
    return { onChange };
  }

  it.each([
    ["off", { off: true, route: "direct" as const, invalid: false }],
    ["invalid", { off: false, route: "direct" as const, invalid: true }],
  ])("%s: a current interactive consent can be withdrawn, and nothing can be accepted", (_label, state) => {
    setAiDeploymentState(state);
    const granted = { ...baseSettings, ai: { ...baseSettings.ai, enabled: true, consent: C, backgroundConsent: C } };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ai: granted.ai }));
    renderWith(granted);
    expect(screen.queryByRole("button", { name: t("en-US", "aiConsentReview") })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "aiConsentRevoke") }));
    expect(persistedAi().consent).toBeUndefined();
    expect(persistedAi().backgroundConsent).toBeUndefined();
    // Withdrawn: neither withdraw control remains, and no accept or review control takes its place.
    expect(screen.queryByRole("button", { name: t("en-US", "aiConsentRevoke") })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: t("en-US", "aiBackgroundConsentToggle") })).toBeNull();
    expect(screen.queryByRole("button", { name: t("en-US", "aiConsentReview") })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("off: a current background consent can be withdrawn on its own", () => {
    setAiDeploymentState({ off: true, route: "direct", invalid: false });
    const granted = { ...baseSettings, ai: { ...baseSettings.ai, enabled: true, consent: C, backgroundConsent: C } };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ai: granted.ai }));
    renderWith(granted);
    const background = screen.getByRole("checkbox", { name: t("en-US", "aiBackgroundConsentToggle") });
    expect(background).toBeChecked();
    fireEvent.click(background);
    expect(persistedAi().backgroundConsent).toBeUndefined();
    expect(persistedAi().consent).toEqual(C);
    expect(screen.queryByRole("checkbox", { name: t("en-US", "aiBackgroundConsentToggle") })).toBeNull();
    expect(screen.getByRole("button", { name: t("en-US", "aiConsentRevoke") })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("off with no current consent: no withdraw and no accept control (control)", () => {
    setAiDeploymentState({ off: true, route: "direct", invalid: false });
    renderWith({ ...baseSettings, ai: { ...baseSettings.ai, enabled: true } });
    expect(screen.queryByRole("button", { name: t("en-US", "aiConsentRevoke") })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: t("en-US", "aiBackgroundConsentToggle") })).toBeNull();
    expect(screen.queryByRole("button", { name: t("en-US", "aiConsentReview") })).toBeNull();
  });
});
