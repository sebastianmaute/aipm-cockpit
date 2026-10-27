// §717 — the page-only store for an Anthropic key unlocked with its passphrase, and the gates that read it.
import { afterEach, describe, expect, it, vi } from "vitest";
import { newConsent } from "./ai-consent";
import { clearSessionAiKey, getSessionAiKey, setSessionAiKey, subscribeSessionAiKey } from "./session-ai-key";
import { aiKeyIfEnabled, defaultSettings, isAiEnabled, liveAiKey } from "./settings-types";

afterEach(() => { clearSessionAiKey(); });

const ON_NO_KEY = { ...defaultSettings.ai, enabled: true, consent: newConsent(new Date(0)), apiKey: "" };

describe("session-ai-key", () => {
  it("holds a trimmed key until it is cleared, and tells its subscribers", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSessionAiKey(listener);
    setSessionAiKey("  sk-ant-unlocked  ");
    expect(getSessionAiKey()).toBe("sk-ant-unlocked");
    setSessionAiKey("sk-ant-unlocked"); // the same key: no second notice
    clearSessionAiKey();
    expect(getSessionAiKey()).toBe("");
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    setSessionAiKey("sk-ant-other");
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("the AI gates read a key unlocked on this page (§717)", () => {
  it("a passphrase key reads blank in settings, so nothing is enabled before the unlock", () => {
    expect(isAiEnabled(ON_NO_KEY)).toBe(false);
    expect(aiKeyIfEnabled(ON_NO_KEY)).toBe("");
  });

  it("after the unlock, AI is enabled and calls get the unlocked key", () => {
    setSessionAiKey("sk-ant-unlocked");
    expect(isAiEnabled(ON_NO_KEY)).toBe(true);
    expect(aiKeyIfEnabled(ON_NO_KEY)).toBe("sk-ant-unlocked");
    expect(liveAiKey(ON_NO_KEY)).toBe("sk-ant-unlocked");
  });

  it("the master switch still wins, and a stored key comes first", () => {
    setSessionAiKey("sk-ant-unlocked");
    expect(isAiEnabled({ ...ON_NO_KEY, enabled: false })).toBe(false);
    expect(aiKeyIfEnabled({ ...ON_NO_KEY, enabled: false })).toBe("");
    expect(liveAiKey({ ...ON_NO_KEY, apiKey: " sk-ant-stored " })).toBe("sk-ant-stored");
  });
});
