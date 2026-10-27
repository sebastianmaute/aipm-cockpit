// AI-01 — a revocation reaches every instance and cannot be undone by a stale copy:
// the two-instance hydration race, the cross-tab `storage` event, a stale instance's unrelated write, and the
// publish wiring (`if (hydrated)` guard + publish effect) that the request path reads.
import "fake-indexeddb/auto";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A merge that waits for `release()` when `hold` is set, so a second instance can be kept loading.
const gate = vi.hoisted(() => ({ hold: false, release: () => {} }));

vi.mock("./secrets-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./secrets-store")>();
  return {
    ...actual,
    migratePlaintextSecrets: async (input: Parameters<typeof actual.migratePlaintextSecrets>[0]) => {
      if (gate.hold) await new Promise<void>((resolve) => { gate.release = resolve; });
      return actual.migratePlaintextSecrets(input);
    },
  };
});

import { __settingsBroadcastDeliveriesForTests, persistAiConsentChange, SETTINGS_KEY, useSettings } from "./use-settings";
import { assertBackgroundConsentLive, isInteractiveConsentLive, newConsent, publishAiConsentState } from "./ai-consent";
import type { Settings } from "./settings-types";

const C = newConsent(new Date(0));

function storeConsented(extra: Record<string, unknown> = {}) {
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({ expertMode: true, ai: { enabled: true, model: "claude-sonnet-5", consent: C, backgroundConsent: C }, ...extra }),
  );
}

function persistedAi(): Record<string, unknown> {
  return (JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as { ai?: Record<string, unknown> }).ai ?? {};
}

/** What another tab does: persist a blob, then (unless `silent`) fire the `storage` event this tab receives. */
function otherTabWrites(blob: Record<string, unknown> | null, silent = false) {
  const newValue = blob === null ? null : JSON.stringify(blob);
  if (newValue === null) localStorage.removeItem(SETTINGS_KEY);
  else localStorage.setItem(SETTINGS_KEY, newValue);
  if (!silent) act(() => { window.dispatchEvent(new StorageEvent("storage", { key: SETTINGS_KEY, newValue })); });
}

/** The revoke button in Settings → AI, as `AiSection` commits it. */
function revoke(settings: Settings): Settings {
  const next = { ...settings, ai: { ...settings.ai, consent: undefined, backgroundConsent: undefined } };
  persistAiConsentChange(next);
  return next;
}

beforeEach(() => {
  localStorage.clear();
  gate.hold = false;
  publishAiConsentState(undefined);
});

describe("useSettings — the published consent state (AI-01)", () => {
  it("a hydrated instance publishes its consent; an instance still loading does not publish its defaults", async () => {
    storeConsented();
    const a = renderHook(() => useSettings());
    await waitFor(() => expect(a.result.current.hydrated).toBe(true));
    // The publish effect ran: the request path sees the consent.
    expect(isInteractiveConsentLive()).toBe(true);

    gate.hold = true;
    const b = renderHook(() => useSettings());
    expect(b.result.current.hydrated).toBe(false); // control: B is still loading, holding the defaults
    expect(b.result.current.settings.ai.consent).toBeUndefined();
    // The `if (hydrated)` guard: B's defaults (no consent) are not published.
    expect(isInteractiveConsentLive()).toBe(true);
    await act(async () => { gate.release(); });
    await waitFor(() => expect(b.result.current.hydrated).toBe(true));
    expect(isInteractiveConsentLive()).toBe(true);
  });
});

describe("useSettings — revocation reaches every instance (AI-01)", () => {
  it("an instance whose load finishes after a revoke takes the persisted state, not the copy it read at mount", async () => {
    storeConsented();
    const a = renderHook(() => useSettings());
    await waitFor(() => expect(a.result.current.hydrated).toBe(true));

    gate.hold = true;
    const b = renderHook(() => useSettings()); // read the consented blob at mount; its merge is held
    expect(b.result.current.hydrated).toBe(false);

    act(() => { a.result.current.setSettings((s) => revoke(s)); });
    expect(persistedAi().consent).toBeUndefined();
    expect(isInteractiveConsentLive()).toBe(false);

    await act(async () => { gate.release(); });
    await waitFor(() => expect(b.result.current.hydrated).toBe(true));
    expect(b.result.current.settings.ai.consent).toBeUndefined();
    expect(b.result.current.settings.ai.backgroundConsent).toBeUndefined();
    expect(b.result.current.settings.expertMode).toBe(true); // control: the rest of B's load did commit
    expect(isInteractiveConsentLive()).toBe(false);
    expect(persistedAi().consent).toBeUndefined();
  });

  it("a revocation persisted by another tab applies here at once, and is not written back", async () => {
    storeConsented();
    const a = renderHook(() => useSettings());
    await waitFor(() => expect(a.result.current.hydrated).toBe(true));
    expect(isInteractiveConsentLive()).toBe(true);

    // The other tab also changed its language earlier; this tab must not overwrite that with its own copy.
    otherTabWrites({ expertMode: true, language: "de", ai: { enabled: true, model: "claude-sonnet-5" } });
    expect(a.result.current.settings.ai.consent).toBeUndefined();
    expect(a.result.current.settings.ai.backgroundConsent).toBeUndefined();
    expect(a.result.current.settings.ai.enabled).toBe(true);
    expect(isInteractiveConsentLive()).toBe(false);
    expect(a.result.current.settings.language).not.toBe("de"); // only the AI switch and consents are taken
    expect((JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as { language?: string }).language).toBe("de");
  });

  it("a switch-off in another tab stops AI here at once, the consent kept", async () => {
    storeConsented();
    const a = renderHook(() => useSettings());
    await waitFor(() => expect(a.result.current.hydrated).toBe(true));
    otherTabWrites({ ai: { enabled: false, model: "claude-sonnet-5", consent: C, backgroundConsent: C } });
    expect(a.result.current.settings.ai.enabled).toBe(false);
    expect(isInteractiveConsentLive()).toBe(false);
  });

  it("a background revocation in another tab stops background sends here", async () => {
    storeConsented();
    const a = renderHook(() => useSettings());
    await waitFor(() => expect(a.result.current.hydrated).toBe(true));
    expect(() => assertBackgroundConsentLive()).not.toThrow();
    otherTabWrites({ ai: { enabled: true, model: "claude-sonnet-5", consent: C } });
    expect(a.result.current.settings.ai.backgroundConsent).toBeUndefined();
    expect(() => assertBackgroundConsentLive()).toThrow();
    expect(isInteractiveConsentLive()).toBe(true);
  });

  it("settings removed by another tab (a reset) read as no consent here", async () => {
    storeConsented();
    const a = renderHook(() => useSettings());
    await waitFor(() => expect(a.result.current.hydrated).toBe(true));
    otherTabWrites(null);
    expect(a.result.current.settings.ai.consent).toBeUndefined();
    expect(a.result.current.settings.ai.enabled).toBe(false);
    expect(isInteractiveConsentLive()).toBe(false);
  });

  it("a stale instance's unrelated settings change does not write a withdrawn consent back", async () => {
    storeConsented();
    const a = renderHook(() => useSettings());
    await waitFor(() => expect(a.result.current.hydrated).toBe(true));
    // Another tab revokes, and this tab has not heard of it yet.
    otherTabWrites({ expertMode: true, ai: { enabled: true, model: "claude-sonnet-5" } }, true);
    expect(a.result.current.settings.ai.consent).toBeDefined(); // control: this instance is stale

    act(() => { a.result.current.setSettings((s) => ({ ...s, expertMode: false })); });
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as { expertMode?: boolean };
    expect(stored.expertMode).toBe(false); // control: the unrelated change was written
    expect(persistedAi().consent).toBeUndefined();
    expect(persistedAi().backgroundConsent).toBeUndefined();
  });

  it("a local edit made just before another tab's revocation arrives is kept and saved", async () => {
    storeConsented();
    const a = renderHook(() => useSettings());
    await waitFor(() => expect(a.result.current.hydrated).toBe(true));
    const b = renderHook(() => useSettings()); // a second instance in this tab
    await waitFor(() => expect(b.result.current.hydrated).toBe(true));
    // Another tab revokes; its `storage` event lands right after this tab's edit, before that edit's effects.
    otherTabWrites({ expertMode: true, ai: { enabled: true, model: "claude-sonnet-5" } }, true);
    act(() => {
      a.result.current.setSettings((s) => ({ ...s, expertMode: false }));
      window.dispatchEvent(new StorageEvent("storage", { key: SETTINGS_KEY }));
    });
    expect(a.result.current.settings.expertMode).toBe(false); // the local edit is kept…
    expect(a.result.current.settings.ai.consent).toBeUndefined(); // …and the revocation applied with it
    expect(isInteractiveConsentLive()).toBe(false);
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as { expertMode?: boolean };
    expect(stored.expertMode).toBe(false); // …and saved
    expect(persistedAi().consent).toBeUndefined();
    expect(persistedAi().backgroundConsent).toBeUndefined();
    expect(b.result.current.settings.expertMode).toBe(false); // …and sent to this tab's other instance
  });

  it("a revocation from another tab after this tab's edit was saved is neither written back nor broadcast", async () => {
    storeConsented();
    const a = renderHook(() => useSettings());
    await waitFor(() => expect(a.result.current.hydrated).toBe(true));
    const b = renderHook(() => useSettings());
    await waitFor(() => expect(b.result.current.hydrated).toBe(true));
    act(() => { a.result.current.setSettings((s) => ({ ...s, expertMode: false })); });
    const deliveriesBefore = __settingsBroadcastDeliveriesForTests();
    const spy = vi.spyOn(Storage.prototype, "setItem");
    otherTabWrites({ language: "de", ai: { enabled: true, model: "claude-sonnet-5" } });
    const writesAfterEvent = spy.mock.calls.filter(([key]) => key === SETTINGS_KEY).length;
    spy.mockRestore();
    expect(a.result.current.settings.ai.consent).toBeUndefined();
    expect(b.result.current.settings.ai.consent).toBeUndefined(); // each instance took it from its own event
    expect(writesAfterEvent).toBe(1); // control: the other tab's own write, and none from this tab
    expect(__settingsBroadcastDeliveriesForTests() - deliveriesBefore).toBe(0);
  });

  it("an accept is persisted by the accept action itself", async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ai: { model: "claude-sonnet-5" } }));
    const a = renderHook(() => useSettings());
    await waitFor(() => expect(a.result.current.hydrated).toBe(true));
    act(() => {
      a.result.current.setSettings((s) => {
        const next = { ...s, ai: { ...s.ai, enabled: true, consent: C } };
        persistAiConsentChange(next);
        return next;
      });
    });
    expect(persistedAi().consent).toEqual(C);
    expect(isInteractiveConsentLive()).toBe(true);
    // An ordinary write afterwards keeps it.
    act(() => { a.result.current.setSettings((s) => ({ ...s, expertMode: true })); });
    expect(persistedAi().consent).toEqual(C);
  });
});
