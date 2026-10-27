// AI-01 — a revocation or a switch-off reaches every instance and cannot be undone by a stale copy:
// the two-instance hydration race, the cross-tab `storage` event, the back/forward-cache and visibility re-reads,
// a stale instance's unrelated write (narrow-only persistence), a revoke saved later by an ordinary write, and the
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

import {
  __resetConsentFailureForTests,
  __settingsBroadcastDeliveriesForTests,
  noteConsentRevokeNotSaved,
  persistAiConsentChange,
  SETTINGS_KEY,
  useSettings,
} from "./use-settings";
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
  persistAiConsentChange(next, []);
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

  it("a stale instance's unrelated settings change does not switch AI back on", async () => {
    storeConsented();
    const a = renderHook(() => useSettings());
    await waitFor(() => expect(a.result.current.hydrated).toBe(true));
    // Another tab switches AI off, and this tab has not heard of it yet.
    otherTabWrites({ expertMode: true, ai: { enabled: false, model: "claude-sonnet-5", consent: C, backgroundConsent: C } }, true);
    expect(a.result.current.settings.ai.enabled).toBe(true); // control: this instance is stale

    act(() => { a.result.current.setSettings((s) => ({ ...s, expertMode: false })); });
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as { expertMode?: boolean };
    expect(stored.expertMode).toBe(false); // control: the unrelated change was written
    expect(persistedAi().enabled).toBe(false);
  });

  it("an ordinary write cannot switch AI on; the explicit switch-on persists it", async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ai: { enabled: false, model: "claude-sonnet-5", consent: C } }));
    const a = renderHook(() => useSettings());
    await waitFor(() => expect(a.result.current.hydrated).toBe(true));
    act(() => { a.result.current.setSettings((s) => ({ ...s, ai: { ...s.ai, enabled: true } })); });
    expect(persistedAi().enabled).toBe(false);
    act(() => {
      a.result.current.setSettings((s) => {
        return persistAiConsentChange({ ...s, ai: { ...s.ai, enabled: true } }, ["enabled"]) ?? s;
      });
    });
    expect(persistedAi().enabled).toBe(true);
  });

  it("a page restored from the back/forward cache applies a switch-off made elsewhere while it was frozen", async () => {
    storeConsented();
    const a = renderHook(() => useSettings());
    await waitFor(() => expect(a.result.current.hydrated).toBe(true));
    otherTabWrites({ expertMode: true, ai: { enabled: false, model: "claude-sonnet-5", consent: C, backgroundConsent: C } }, true);
    act(() => { window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false })); });
    expect(a.result.current.settings.ai.enabled).toBe(true); // control: an ordinary page load is not a restore
    act(() => { window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })); });
    expect(a.result.current.settings.ai.enabled).toBe(false);
    expect(isInteractiveConsentLive()).toBe(false);
  });

  it("a page that becomes visible again applies a revocation made elsewhere", async () => {
    storeConsented();
    const a = renderHook(() => useSettings());
    await waitFor(() => expect(a.result.current.hydrated).toBe(true));
    otherTabWrites({ expertMode: true, ai: { enabled: true, model: "claude-sonnet-5" } }, true);
    const visibility = vi.spyOn(document, "visibilityState", "get");
    visibility.mockReturnValue("hidden");
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(a.result.current.settings.ai.consent).toBeDefined(); // control: hiding is not a re-read
    visibility.mockReturnValue("visible");
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    visibility.mockRestore();
    expect(a.result.current.settings.ai.consent).toBeUndefined();
    expect(isInteractiveConsentLive()).toBe(false);
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
        return persistAiConsentChange({ ...s, ai: { ...s.ai, enabled: true, consent: C } }, ["enabled", "consent"]) ?? s;
      });
    });
    expect(persistedAi().consent).toEqual(C);
    expect(isInteractiveConsentLive()).toBe(true);
    // An ordinary write afterwards keeps it.
    act(() => { a.result.current.setSettings((s) => ({ ...s, expertMode: true })); });
    expect(persistedAi().consent).toEqual(C);
  });
});

// AI-01 — an explicit action widens only its own field(s); in a tab that missed a change made elsewhere, the
// stale values it holds for the other fields can only narrow what is stored.
describe("useSettings — an explicit action widens only its own field (AI-01)", () => {
  const OLD = { acceptedAt: "1970-01-01T00:00:00.000Z", disclosureVersion: 0 }; // accepted at an older version

  it("a background accept in a tab that missed a switch-off elsewhere does not switch AI back on", async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ai: { enabled: true, model: "claude-sonnet-5", consent: C } }));
    const a = renderHook(() => useSettings());
    await waitFor(() => expect(a.result.current.hydrated).toBe(true));
    otherTabWrites({ ai: { enabled: false, model: "claude-sonnet-5", consent: C } }, true);
    expect(a.result.current.settings.ai.enabled).toBe(true); // control: this tab is stale
    act(() => {
      a.result.current.setSettings((s) =>
        persistAiConsentChange({ ...s, ai: { ...s.ai, backgroundConsent: C } }, ["backgroundConsent"]) ?? s);
    });
    expect(persistedAi().backgroundConsent).toEqual(C); // control: the accept itself was saved
    expect(persistedAi().enabled).toBe(false);
    expect(a.result.current.settings.ai.enabled).toBe(false); // what is committed is what was stored
    expect(isInteractiveConsentLive()).toBe(false);
  });

  it("an accept in a tab that missed a background revoke elsewhere does not bring the background consent back", async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ai: { enabled: true, model: "claude-sonnet-5", consent: OLD, backgroundConsent: C } }));
    const a = renderHook(() => useSettings());
    await waitFor(() => expect(a.result.current.hydrated).toBe(true));
    otherTabWrites({ ai: { enabled: true, model: "claude-sonnet-5", consent: OLD } }, true);
    expect(a.result.current.settings.ai.backgroundConsent).toEqual(C); // control: this tab is stale
    act(() => {
      a.result.current.setSettings((s) =>
        persistAiConsentChange({ ...s, ai: { ...s.ai, enabled: true, consent: C } }, ["enabled", "consent"]) ?? s);
    });
    expect(persistedAi().consent).toEqual(C); // control: the accept itself was saved
    expect(persistedAi().backgroundConsent).toBeUndefined();
    expect(a.result.current.settings.ai.backgroundConsent).toBeUndefined();
    expect(isInteractiveConsentLive()).toBe(true);
    expect(() => assertBackgroundConsentLive()).toThrow();
  });

  it("a switch-on in a tab that missed a revoke elsewhere does not write the withdrawn consent back", async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ai: { enabled: false, model: "claude-sonnet-5", consent: C, backgroundConsent: C } }));
    const a = renderHook(() => useSettings());
    await waitFor(() => expect(a.result.current.hydrated).toBe(true));
    otherTabWrites({ ai: { enabled: false, model: "claude-sonnet-5" } }, true);
    act(() => {
      a.result.current.setSettings((s) => persistAiConsentChange({ ...s, ai: { ...s.ai, enabled: true } }, ["enabled"]) ?? s);
    });
    expect(persistedAi().enabled).toBe(true); // control: the switch-on itself was saved
    expect(persistedAi().consent).toBeUndefined();
    expect(persistedAi().backgroundConsent).toBeUndefined();
    expect(isInteractiveConsentLive()).toBe(false);
  });
});

// AI-01 — Settings → AI reports a failed consent write itself (a revoke that is in effect but not saved), so the
// generic "settings could not be saved" notice that the next ordinary write would raise is not shown over it.
describe("useSettings — a consent write that failed (AI-01)", () => {
  const realSetItem = Storage.prototype.setItem;
  function failSettingsWrites() {
    return vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === SETTINGS_KEY) throw new DOMException("full", "QuotaExceededError");
      realSetItem.call(this, key, value);
    });
  }
  function countGenericNotices() {
    const seen = { n: 0 };
    const on = () => { seen.n += 1; };
    window.addEventListener("aipm-cockpit-settings-write-failed", on);
    return { seen, stop: () => window.removeEventListener("aipm-cockpit-settings-write-failed", on) };
  }
  /** The revoke in Settings → AI, as `AiSection` commits it when the write fails: noted, then committed anyway. */
  function revokeNotSaved(settings: Settings): Settings {
    const next = { ...settings, ai: { ...settings.ai, consent: undefined, backgroundConsent: undefined } };
    if (!persistAiConsentChange(next, [])) noteConsentRevokeNotSaved(next);
    return next;
  }
  // Each test starts with no noted revoke, whatever an earlier test left behind.
  beforeEach(() => __resetConsentFailureForTests());

  it("a revoke whose write failed raises no generic notice; the revoke is in effect", async () => {
    storeConsented();
    const a = renderHook(() => useSettings());
    await waitFor(() => expect(a.result.current.hydrated).toBe(true));
    const spy = failSettingsWrites();
    const notices = countGenericNotices();
    act(() => { a.result.current.setSettings((s) => revokeNotSaved(s)); });
    notices.stop();
    spy.mockRestore();
    expect(a.result.current.settings.ai.consent).toBeUndefined();
    expect(isInteractiveConsentLive()).toBe(false);
    expect(persistedAi().consent).toBeDefined(); // control: nothing was saved
    expect(notices.seen.n).toBe(0);
  });

  it("a revoke that could not be saved is saved by the next ordinary write once storage works again", async () => {
    storeConsented();
    const a = renderHook(() => useSettings());
    await waitFor(() => expect(a.result.current.hydrated).toBe(true));
    const spy = failSettingsWrites();
    act(() => { a.result.current.setSettings((s) => revokeNotSaved(s)); });
    spy.mockRestore(); // storage works again
    expect(persistedAi().consent).toBeDefined(); // control: the revoke itself was not saved
    act(() => { a.result.current.setSettings((s) => ({ ...s, expertMode: false })); });
    expect(persistedAi().consent).toBeUndefined();
    expect(persistedAi().backgroundConsent).toBeUndefined();
    expect(persistedAi().enabled).toBe(true); // control: a revoke leaves the switch as it was
  });

  it("while writes fail, a re-read does not undo a revoke that could not be saved", async () => {
    storeConsented();
    const a = renderHook(() => useSettings());
    await waitFor(() => expect(a.result.current.hydrated).toBe(true));
    const spy = failSettingsWrites();
    act(() => { a.result.current.setSettings((s) => revokeNotSaved(s)); });
    act(() => { window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })); });
    spy.mockRestore();
    expect(persistedAi().consent).toBeDefined(); // control: storage still holds the consent
    expect(a.result.current.settings.ai.consent).toBeUndefined();
    expect(isInteractiveConsentLive()).toBe(false);
  });

  it("an ordinary write that fails still raises the generic notice", async () => {
    storeConsented();
    const a = renderHook(() => useSettings());
    await waitFor(() => expect(a.result.current.hydrated).toBe(true));
    const spy = failSettingsWrites();
    const notices = countGenericNotices();
    act(() => { a.result.current.setSettings((s) => ({ ...s, expertMode: false })); });
    notices.stop();
    spy.mockRestore();
    expect(notices.seen.n).toBe(1);
  });

  it("a failed accept does not hide the generic notice of a later, unrelated failed write", async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ai: { model: "claude-sonnet-5" } }));
    const a = renderHook(() => useSettings());
    await waitFor(() => expect(a.result.current.hydrated).toBe(true));
    const spy = failSettingsWrites();
    const notices = countGenericNotices();
    // The accept in Settings → AI: its write fails, so it is not committed (Settings → AI says so itself).
    const accepted = { ...a.result.current.settings, ai: { ...a.result.current.settings.ai, enabled: true, consent: C } };
    expect(persistAiConsentChange(accepted, ["enabled", "consent"])).toBeNull();
    expect(notices.seen.n).toBe(0); // control: nothing committed, nothing raised yet
    // Later, with storage still failing, an unrelated edit.
    act(() => { a.result.current.setSettings((s) => ({ ...s, language: "de" })); });
    notices.stop();
    spy.mockRestore();
    expect(a.result.current.settings.ai.consent).toBeUndefined(); // control: the accept stayed out
    expect(notices.seen.n).toBe(1);
  });
});
