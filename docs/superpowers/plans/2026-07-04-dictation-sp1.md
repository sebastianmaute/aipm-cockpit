# Push-to-Talk Dictation SP1 (Web Speech) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dictate into the Claude chat input by holding a mic button (pointer or Space/Enter) or tapping to latch — via the browser Web Speech API — inserting transcript as text.

**Architecture:** A `DictationEngine` interface (the seam SP2's STT engine slots into) with one `web-speech-engine` impl over `voice.ts` (new non-breaking `continuous` flag). A `use-push-to-talk` hook runs a hold-vs-tap (250ms) state machine and appends final transcript to the chat `input`; a mic button in `chat-panel` wires it.

**Tech Stack:** TypeScript, React 19, Web Speech API, vitest. No new deps, no network, no secret.

**Verify:** tests `npm run test:run -- <file>` · typecheck `npx tsc --noEmit` (i18n EN/DE parity) · lint `npm run lint` · size `npm run size:check`.

★★ i18n.de.ts LANDMINE: patch `src/app/i18n.de.ts` via node utf8 write (\uXXXX umlauts, CRLF `\r\n`); never Edit it. `i18n.ts` (EN) is Edit-safe.

---

## File Structure
- Modify `src/app/voice.ts` — add optional `continuous?: boolean` to `StartOptions`.
- Create `src/app/dictation-engine.ts` — `DictationEngine`/`DictationHandlers` interface + pure `appendDictation` helper.
- Create `src/app/web-speech-engine.ts` — `createWebSpeechEngine(lang)`.
- Create `src/app/use-push-to-talk.ts` — the hold/tap hook.
- Modify `src/app/chat-panel.tsx` — mic button + append + interim preview.
- Modify `src/app/i18n.ts` + `i18n.de.ts` — `dictationHold`, `dictationListening`, `dictationMicDenied`.
- Modify `src/app/settings-types.ts` (or wherever `Settings` + `sanitizeSettings`/`defaultSettings` live) — `dictation?: { engine: "web-speech" | "stt" }`.

---

## Task 1: voice.ts continuous flag

**Files:** Modify `src/app/voice.ts`; Test `src/app/voice.test.ts` (create if absent)

- [ ] **Step 1:** In `src/app/voice.ts`: (a) add `continuous?: boolean;` to the `StartOptions` type; (b) change `recog.continuous = false;` to `recog.continuous = Boolean(opts.continuous);`; (c) ensure the internal `getCtor` function is EXPORTED (`export function getCtor()` — Task 3's hook imports it for its `supported` check). If it's already exported, leave it; if it's a `const`, add `export`.

- [ ] **Step 2: Test** — add/create `src/app/voice.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { startRecognition } from "./voice";

class FakeRecog {
  continuous = false; interimResults = false; maxAlternatives = 1; lang = "";
  onresult: unknown = null; onend: unknown = null; onerror: unknown = null;
  start = vi.fn(); stop = vi.fn(); abort = vi.fn();
}
beforeEach(() => { (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecog; });
afterEach(() => { delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition; });

describe("startRecognition continuous flag", () => {
  it("defaults continuous to false (command mode unchanged)", () => {
    let created: FakeRecog | undefined;
    const OrigCtor = FakeRecog;
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = class extends OrigCtor { constructor() { super(); created = this; } };
    startRecognition({ lang: "en-US", onFinal: () => {} });
    expect(created!.continuous).toBe(false);
  });
  it("sets continuous true when requested (dictation mode)", () => {
    let created: FakeRecog | undefined;
    const OrigCtor = FakeRecog;
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = class extends OrigCtor { constructor() { super(); created = this; } };
    startRecognition({ lang: "en-US", onFinal: () => {}, continuous: true });
    expect(created!.continuous).toBe(true);
  });
});
```

- [ ] **Step 3:** `npm run test:run -- voice.test` → PASS; `npx tsc --noEmit` → 0; `npm run lint` → 0. Confirm existing voice-command tests still pass: `npm run test:run -- voice`.
- [ ] **Step 4: Commit** `git add src/app/voice.ts src/app/voice.test.ts && git commit -m "feat(dictation): voice.ts continuous flag for dictation mode"`

---

## Task 2: dictation engine interface + web-speech engine

**Files:** Create `src/app/dictation-engine.ts`, `src/app/web-speech-engine.ts`; Test `src/app/dictation-engine.test.ts`, `src/app/web-speech-engine.test.ts`

- [ ] **Step 1:** Create `src/app/dictation-engine.ts`:
```ts
// The engine seam SP2's STT backend plugs into. Pure — no React, no DOM beyond
// what an engine impl needs. SP1 ships one impl (web-speech-engine).
export interface DictationHandlers {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (err: string) => void; // "not-allowed" | "not-supported" | SR error code
}
export interface DictationEngine {
  /** Begin capturing. Returns false if unsupported / failed to start. */
  start(handlers: DictationHandlers): boolean;
  /** Stop capturing. Idempotent. */
  stop(): void;
}

/** Space-aware append of a dictated segment to existing text. */
export function appendDictation(prev: string, text: string): string {
  const seg = text.trim();
  if (!seg) return prev;
  if (!prev) return seg;
  return /\s$/.test(prev) ? prev + seg : prev + " " + seg;
}
```

- [ ] **Step 2:** Test `src/app/dictation-engine.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { appendDictation } from "./dictation-engine";
describe("appendDictation", () => {
  it("returns the segment for empty prev", () => { expect(appendDictation("", "hello")).toBe("hello"); });
  it("adds a space when prev has no trailing space", () => { expect(appendDictation("hello", "world")).toBe("hello world"); });
  it("keeps the single space when prev already ends with one", () => { expect(appendDictation("hello ", "world")).toBe("hello world"); });
  it("ignores an empty/whitespace segment", () => { expect(appendDictation("hello", "   ")).toBe("hello"); });
});
```

- [ ] **Step 3:** Create `src/app/web-speech-engine.ts`:
```ts
import type { Lang } from "./i18n";
import { startRecognition } from "./voice";
import type { DictationEngine, DictationHandlers } from "./dictation-engine";

/** Web Speech API dictation engine. Restarts while active (Web Speech ends on a
 *  silence gap even in continuous mode) so a held button keeps recording. */
export function createWebSpeechEngine(lang: Lang): DictationEngine {
  let active = false;
  let stopFn: (() => void) | null = null;

  const begin = (handlers: DictationHandlers): boolean => {
    stopFn = startRecognition({
      lang,
      continuous: true,
      onInterim: handlers.onInterim,
      onFinal: handlers.onFinal,
      onError: (e) => handlers.onError(e === "service-not-allowed" ? "not-allowed" : e),
      onEnd: () => { if (active) begin(handlers); }, // keep-alive
    });
    return stopFn !== null;
  };

  return {
    start(handlers) {
      active = true;
      const ok = begin(handlers);
      if (!ok) { active = false; handlers.onError("not-supported"); }
      return ok;
    },
    stop() {
      active = false; // set BEFORE stopping so the final onEnd does not restart
      stopFn?.();
      stopFn = null;
    },
  };
}
```

- [ ] **Step 4:** Test `src/app/web-speech-engine.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createWebSpeechEngine } from "./web-speech-engine";

const stop = vi.fn();
let lastOpts: Record<string, unknown> | null = null;
let returnNull = false;
vi.mock("./voice", () => ({
  startRecognition: (opts: Record<string, unknown>) => { lastOpts = opts; return returnNull ? null : stop; },
}));

beforeEach(() => { stop.mockClear(); lastOpts = null; returnNull = false; });

describe("web-speech-engine", () => {
  it("starts continuous and routes handlers", () => {
    const h = { onInterim: vi.fn(), onFinal: vi.fn(), onError: vi.fn() };
    const eng = createWebSpeechEngine("en-US");
    expect(eng.start(h)).toBe(true);
    expect(lastOpts!.continuous).toBe(true);
    (lastOpts!.onFinal as (t: string) => void)("hi");
    expect(h.onFinal).toHaveBeenCalledWith("hi");
  });
  it("restarts on onEnd while active, not after stop", () => {
    const h = { onInterim: vi.fn(), onFinal: vi.fn(), onError: vi.fn() };
    const eng = createWebSpeechEngine("en-US");
    eng.start(h);
    const firstOnEnd = lastOpts!.onEnd as () => void;
    firstOnEnd(); // still active → restarts (startRecognition called again)
    eng.stop();
    const calls = stop.mock.calls.length;
    (lastOpts!.onEnd as () => void)(); // after stop → no restart
    expect(stop.mock.calls.length).toBe(calls); // stop not called again by a restart
  });
  it("reports not-supported when startRecognition returns null", () => {
    returnNull = true;
    const h = { onInterim: vi.fn(), onFinal: vi.fn(), onError: vi.fn() };
    expect(createWebSpeechEngine("en-US").start(h)).toBe(false);
    expect(h.onError).toHaveBeenCalledWith("not-supported");
  });
});
```

- [ ] **Step 5:** `npm run test:run -- dictation-engine web-speech-engine` → PASS; `npx tsc --noEmit` → 0; `npm run lint` → 0.
- [ ] **Step 6: Commit** `git add src/app/dictation-engine.ts src/app/web-speech-engine.ts src/app/dictation-engine.test.ts src/app/web-speech-engine.test.ts && git commit -m "feat(dictation): engine interface + web-speech engine"`

---

## Task 3: use-push-to-talk hook

**Files:** Create `src/app/use-push-to-talk.ts`; Test `src/app/use-push-to-talk.test.ts`

- [ ] **Step 1:** Create `src/app/use-push-to-talk.ts`. The press/release model: a press starts listening (if not already) and records the press time AND whether we were already listening. On release: a HOLD (`held ≥ TAP_MS`) stops; a TAP (`held < TAP_MS`) that began a fresh session LATCHES (stays listening); a TAP that began while already listening STOPS (second tap). `React` is imported for its event types.
```ts
import { useCallback, useMemo, useRef, useState } from "react";
import type { Lang } from "./i18n";
import { getCtor } from "./voice";
import { createWebSpeechEngine } from "./web-speech-engine";
import type { DictationEngine } from "./dictation-engine";

const TAP_MS = 250;

interface Args {
  lang: Lang;
  enabled: boolean;
  onAppendFinal: (text: string) => void;
  onInterim: (text: string) => void;
  onError: (err: string) => void;
}

export function usePushToTalk({ lang, enabled, onAppendFinal, onInterim, onError }: Args) {
  const [listening, setListening] = useState(false);
  const supported = useMemo(() => getCtor() !== null, []);
  const engineRef = useRef<DictationEngine | null>(null);
  const pressedAtRef = useRef(0);
  const wasListeningRef = useRef(false);
  const listeningRef = useRef(false);

  const engine = () => {
    if (!engineRef.current) engineRef.current = createWebSpeechEngine(lang);
    return engineRef.current;
  };

  const startHold = useCallback(() => {
    if (!enabled) { onError("disabled"); return; }
    if (listeningRef.current) return;
    const ok = engine().start({ onFinal: onAppendFinal, onInterim, onError });
    if (ok) { listeningRef.current = true; setListening(true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, lang, onAppendFinal, onInterim, onError]);

  const stopHold = useCallback(() => {
    engineRef.current?.stop();
    listeningRef.current = false;
    setListening(false);
  }, []);

  const press = useCallback(() => {
    pressedAtRef.current = Date.now();
    wasListeningRef.current = listeningRef.current;
    if (!listeningRef.current) startHold();
  }, [startHold]);

  const release = useCallback(() => {
    const held = Date.now() - pressedAtRef.current;
    if (held >= TAP_MS) { stopHold(); return; }   // HOLD → release stops
    if (wasListeningRef.current) stopHold();        // TAP while already latched → stop
    // else: first TAP → stay latched (no-op)
  }, [stopHold]);

  const toggle = useCallback(() => { if (listeningRef.current) stopHold(); else startHold(); }, [startHold, stopHold]);

  const buttonHandlers = useMemo(() => ({
    onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); press(); },
    onPointerUp: () => release(),
    onPointerLeave: () => { if (listeningRef.current) stopHold(); },
    onPointerCancel: () => { if (listeningRef.current) stopHold(); },
    onKeyDown: (e: React.KeyboardEvent) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); press(); } },
    onKeyUp: (e: React.KeyboardEvent) => { if (e.key === " " || e.key === "Enter") release(); },
  }), [press, release, stopHold]);

  return { listening, supported, buttonHandlers, toggle };
}
```

- [ ] **Step 2:** Test `src/app/use-push-to-talk.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePushToTalk } from "./use-push-to-talk";

const start = vi.fn(() => true);
const stop = vi.fn();
vi.mock("./web-speech-engine", () => ({ createWebSpeechEngine: () => ({ start, stop }) }));
vi.mock("./voice", () => ({ getCtor: () => function () {}, startRecognition: () => stop }));

beforeEach(() => { start.mockClear(); stop.mockClear(); start.mockReturnValue(true); vi.useFakeTimers(); });
afterEach(() => vi.useRealTimers());

const args = () => ({ lang: "en-US" as const, enabled: true, onAppendFinal: vi.fn(), onInterim: vi.fn(), onError: vi.fn() });

describe("usePushToTalk", () => {
  it("hold (>=250ms) starts on press and stops on release", () => {
    const { result } = renderHook(() => usePushToTalk(args()));
    act(() => result.current.buttonHandlers.onPointerDown({ preventDefault() {} } as never));
    expect(result.current.listening).toBe(true);
    act(() => { vi.advanceTimersByTime(300); result.current.buttonHandlers.onPointerUp(); });
    expect(result.current.listening).toBe(false);
    expect(stop).toHaveBeenCalled();
  });
  it("tap (<250ms) latches; a second tap stops", () => {
    const { result } = renderHook(() => usePushToTalk(args()));
    act(() => { result.current.buttonHandlers.onPointerDown({ preventDefault() {} } as never); vi.advanceTimersByTime(50); result.current.buttonHandlers.onPointerUp(); });
    expect(result.current.listening).toBe(true); // latched
    act(() => { result.current.buttonHandlers.onPointerDown({ preventDefault() {} } as never); vi.advanceTimersByTime(50); result.current.buttonHandlers.onPointerUp(); });
    expect(result.current.listening).toBe(false); // second tap stops
  });
  it("routes final transcript to onAppendFinal", () => {
    const a = args();
    const { result } = renderHook(() => usePushToTalk(a));
    act(() => result.current.buttonHandlers.onPointerDown({ preventDefault() {} } as never));
    const handlers = start.mock.calls[0][0] as { onFinal: (t: string) => void };
    act(() => handlers.onFinal("hello world"));
    expect(a.onAppendFinal).toHaveBeenCalledWith("hello world");
  });
});
```

- [ ] **Step 3:** Implement to make ALL Step-2 tests pass (adjust the `press`/`release`/latch logic until green). `npx tsc --noEmit` → 0; `npm run lint` → 0.
- [ ] **Step 4: Commit** `git add src/app/use-push-to-talk.ts src/app/use-push-to-talk.test.ts && git commit -m "feat(dictation): push-to-talk hold/tap hook"`

---

## Task 4: settings.dictation field

**Files:** Modify the module defining `Settings` + its sanitizer + defaults (grep `defaultSettings` / `sanitizeSettings` — likely `settings-types.ts` / `use-settings.ts`)

- [ ] **Step 1:** Add to the `Settings` type: `dictation?: { engine: "web-speech" | "stt" };`. In `defaultSettings`, add `dictation: { engine: "web-speech" }`. In the load sanitizer, coerce: `dictation: obj.dictation?.engine === "stt" ? { engine: "stt" } : { engine: "web-speech" }`.
- [ ] **Step 2: Test** — in the settings sanitize test, assert an unknown/absent engine defaults to `"web-speech"` and `"stt"` is preserved.
- [ ] **Step 3:** `npx tsc --noEmit` → 0; `npm run lint` → 0; `npm run test:run -- settings` → PASS.
- [ ] **Step 4: Commit** `git add <settings files> && git commit -m "feat(dictation): settings.dictation.engine field (default web-speech)"`

---

## Task 5: mic button in chat-panel

**Files:** Modify `src/app/chat-panel.tsx`; Modify `src/app/i18n.ts` + `i18n.de.ts`

- [ ] **Step 1:** Add i18n keys — EN (`i18n.ts`):
```ts
  dictationHold: "Hold to dictate",
  dictationListening: "Listening…",
  dictationMicDenied: "Microphone access was denied — allow it in your browser to dictate.",
```
DE (`i18n.de.ts`, node utf8 write):
```
  dictationHold: "Zum Diktieren gedrückt halten",
  dictationListening: "Hört zu …",
  dictationMicDenied: "Mikrofonzugriff wurde verweigert — erlauben Sie ihn im Browser, um zu diktieren.",
```

- [ ] **Step 2:** In `src/app/chat-panel.tsx`, near the `<textarea value={input} …>` (around line 579), add the hook + a mic button. Add imports: `usePushToTalk` from `./use-push-to-talk`, `appendDictation` from `./dictation-engine`, `useToastContext` from `./toast-context` (or reuse the panel's showToast if present), `reportCapabilityGap` from `./guard-feedback`, and an interim state. Wiring:
```tsx
  const [interim, setInterim] = useState("");
  const ptt = usePushToTalk({
    lang,
    enabled: true,
    onAppendFinal: (txt) => { setInput((prev) => appendDictation(prev, txt)); setInterim(""); },
    onInterim: (txt) => setInterim(txt),
    onError: (err) => {
      setInterim("");
      if (err === "not-allowed") reportCapabilityGap(showToast, lang, "dictation.micDenied", "dictationMicDenied");
    },
  });
```
Render the button only when `ptt.supported`, next to the send button:
```tsx
  {ptt.supported && (
    <button
      type="button"
      aria-pressed={ptt.listening}
      aria-label={t(lang, "dictationHold")}
      title={t(lang, "dictationHold")}
      className={`rounded-md border border-line px-2 py-1 ${INTERACTIVE} ${ptt.listening ? "text-AIPM-green-strong" : "text-muted-foreground"}`}
      {...ptt.buttonHandlers}
    >
      🎙
    </button>
  )}
```
And a live interim preview near the textarea, shown only while listening:
```tsx
  {ptt.listening && (
    <p className="text-xs text-muted-foreground" aria-live="polite">{t(lang, "dictationListening")}{interim ? ` ${interim}` : ""}</p>
  )}
```
`showToast` must be in scope — if the panel doesn't already have it, add `const showToast = useToastContext();`. Use an emoji/icon consistent with the app's icon set (if the app uses an icon component instead of an emoji, use that; grep how other chat buttons render icons). Keep it palette-safe (no raw shadow/gradient).

- [ ] **Step 3:** `npx tsc --noEmit` → 0 (i18n parity); `npm run test:run -- i18n-encoding chat-panel` → PASS; `npm run lint` → 0; `npm run size:check` → ok (chat-panel may grow; fold if it trips the ratchet).
- [ ] **Step 4:** Manual smoke note (in the commit body or PR): in Chromium, hold the mic → speak → words append to the input; release stops; deny mic → info toast; other browsers → button hidden.
- [ ] **Step 5: Commit** `git add src/app/chat-panel.tsx src/app/i18n.ts src/app/i18n.de.ts && git commit -m "feat(dictation): mic button + interim preview in chat"`

---

## Final verification (before finishing the branch)
- [ ] `npx tsc --noEmit` → 0 · `npm run lint` → 0 · `npm run test:run` → full green · `npm run size:check` → ok · `npm run dup:check` → within 2.4
- [ ] Grep: existing voice-command path (`voice-button.tsx` / `voice-command-context.tsx`) is UNTOUCHED (dictation is a separate path; `continuous` defaults false so commands are unaffected).
- [ ] Chat is NOT in the axe gate — eye-verify the mic button: `aria-pressed` reflects listening, `aria-label` present, keyboard Space/Enter hold works, palette-safe.

Then follow **superpowers:finishing-a-development-branch**.
