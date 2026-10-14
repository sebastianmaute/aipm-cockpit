// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SPLASH_SLOW_MS, splashMessages, splashScript, splashSequence } from "./splash-status";

describe("splashMessages", () => {
  it.each(["de-DE", "de", "de-AT"])("returns German for %s", (locale) => {
    expect(splashMessages(locale).starting).toBe("Hintergrunddienst wird gestartet…");
  });

  it.each(["en-GB", "en-US", "fr-FR", ""])("returns English for %s", (locale) => {
    const m = splashMessages(locale);
    expect(m.starting).toBe("Starting the background service…");
    expect(m.opening).toBe("Opening…");
    expect(m.slow).toBe(
      "Still starting. The first start after installing or updating can take up to a minute — please wait.",
    );
  });

  it("is case-insensitive about the language prefix", () => {
    expect(splashMessages("DE-de").opening).toBe("Wird geöffnet…");
  });

  it("uses real umlauts and the en dash in German", () => {
    const m = splashMessages("de");
    expect(m.opening).toBe("Wird geöffnet…");
    expect(m.slow).toBe(
      "Startet noch. Der erste Start nach der Installation oder einem Update kann bis zu einer Minute dauern – bitte warten.",
    );
    expect(m.opening).toContain("ö");
    expect(m.slow).toContain(" – ");
  });

  it("sets the reassurance delay to 10 seconds", () => {
    expect(SPLASH_SLOW_MS).toBe(10_000);
  });
});

describe("splashScript", () => {
  const PREFIX = (kind: string) => `window.__splash && window.__splash.${kind}(`;
  const argumentOf = (script: string, kind: string): string => {
    expect(script.startsWith(PREFIX(kind))).toBe(true);
    expect(script.endsWith(")")).toBe(true);
    return script.slice(PREFIX(kind).length, -1);
  };

  it.each(["status", "slow"] as const)("calls %s with the text as a JSON string", (kind) => {
    expect(splashScript(kind, "Opening…")).toBe(`${PREFIX(kind)}"Opening…")`);
  });

  it("round-trips quotes, backslashes, a closing script tag and a newline", () => {
    const text = 'say "hi" \\ </script><b>\nnext line';
    expect(text).toContain("\\");
    const script = splashScript("status", text);
    expect(JSON.parse(argumentOf(script, "status"))).toBe(text);
    // The newline must be escaped, so the script stays on one line.
    expect(script).not.toContain("\n");
  });

  it("cannot be broken out of by text that looks like code", () => {
    const text = '");alert(1);("';
    const script = splashScript("slow", text);
    expect(JSON.parse(argumentOf(script, "slow"))).toBe(text);
  });
});

describe("splashSequence", () => {
  const TEXT = splashMessages("en-US");
  let sent: string[];
  const send = (kind: "status" | "slow", text: string): void => {
    sent.push(`${kind}:${text}`);
  };
  // Resolved at call time, so the fake timers installed in beforeEach are the ones used.
  const timers = {
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle),
  };

  beforeEach(() => {
    sent = [];
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("sends the status updates in order", () => {
    const splash = splashSequence(send, TEXT, timers);
    splash.starting();
    splash.opening();
    expect(sent).toEqual([`status:${TEXT.starting}`, `status:${TEXT.opening}`]);
  });

  it("shows the reassurance line once SPLASH_SLOW_MS has passed, not before", () => {
    const splash = splashSequence(send, TEXT, timers);
    splash.starting();
    vi.advanceTimersByTime(SPLASH_SLOW_MS - 1);
    expect(sent).toEqual([`status:${TEXT.starting}`]);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual([`status:${TEXT.starting}`, `slow:${TEXT.slow}`]);
  });

  it("clears the reassurance timer when the app opens", () => {
    const splash = splashSequence(send, TEXT, timers);
    vi.advanceTimersByTime(SPLASH_SLOW_MS - 1);
    splash.opening();
    vi.advanceTimersByTime(SPLASH_SLOW_MS * 3);
    expect(sent).toEqual([`status:${TEXT.opening}`]);
  });

  it("clears it on a failed start too, and a second stop is harmless", () => {
    const splash = splashSequence(send, TEXT, timers);
    splash.stop();
    splash.stop();
    vi.advanceTimersByTime(SPLASH_SLOW_MS * 3);
    expect(sent).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
