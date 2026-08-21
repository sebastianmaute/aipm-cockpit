# Push-to-Talk Dictation — SP1 (Web Speech) Design

**Goal:** Let the user dictate into the Claude chat input by holding a mic button (or holding a key on it) and speaking — transcript inserted as text, not parsed as a command — using the browser's Web Speech API.

**Context:** SP1 of sub-project C (the B→A→C thread). C is pluggable across two engines chosen in Settings; SP1 ships the full push-to-talk UX + the engine abstraction + the free Web Speech engine. SP2 adds an OpenAI-compatible STT engine (secret + `/api/stt` proxy + `MediaRecorder`) behind the same abstraction.

**Approved decisions:**
- Engine: reuse the Web Speech API (`voice.ts`), dictation mode; both engines will be Settings-selectable (SP2 adds the second).
- Trigger: hold the mic button (pointer) + hold-key on the button (Space/Enter) + tap-to-toggle fallback for accessibility.
- Additive: dictation targets the chat input only; no command parsing, no new secret/proxy/network in SP1.

---

## Architecture

```
mic button / hold-key ──▶ use-push-to-talk (hold state machine) ──▶ DictationEngine.start(handlers)
                                                │                          │
                          onFinal → append to chat `input`   ◀── web-speech-engine (voice.ts, continuous)
                          onInterim → live preview suffix
                          onError → toast (guard-feedback)
```

The **engine abstraction** is the seam SP2 slots into; SP1 provides one implementation.

## Components

### `voice.ts` — add a dictation flag (non-breaking)
`startRecognition`'s `StartOptions` gains an optional `continuous?: boolean` (default `false` = current command behavior). The web-speech engine passes `continuous: true` so recognition keeps running while the button is held. Everything else unchanged; the existing command callers are byte-unaffected (default preserves `recog.continuous = false`).

### `dictation-engine.ts` (pure interface)
```ts
export interface DictationHandlers {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (err: string) => void; // "not-allowed" (mic denied), "not-supported", or an SR error code
}
export interface DictationEngine {
  /** Begin capturing. Returns false if unsupported / failed to start. */
  start(handlers: DictationHandlers): boolean;
  /** Stop capturing. Idempotent. */
  stop(): void;
}
```

### `web-speech-engine.ts`
`createWebSpeechEngine(lang: Lang): DictationEngine`.
- `start(handlers)`: if `getCtor()` (from voice.ts) is null → call `handlers.onError("not-supported")` and return `false`. Else call `startRecognition({ lang, continuous: true, onInterim, onFinal, onEnd, onError })`, stash the returned stop fn. Track an `active` flag.
- **Keep-alive:** Web Speech ends after a silence gap even in `continuous` mode on some engines. In `onEnd`, if still `active`, restart (re-`startRecognition`) so a held button keeps recording; `stop()` sets `active = false` first so the final `onEnd` does NOT restart.
- `stop()`: `active = false`; call the stored stop fn; null it. Idempotent.
- Maps SR `onerror` codes through: `not-allowed`/`service-not-allowed` → `onError("not-allowed")`; others pass the code.

### `use-push-to-talk.ts`
`usePushToTalk({ lang, enabled, onAppendFinal, onInterim, onError })` → `{ listening, supported, buttonHandlers, toggle }`.
- Owns `listening` state + a single `DictationEngine` (memoized on `lang`; recreated when lang changes).
- `startHold()`: if `!enabled` → `onError("disabled")` (caller decides messaging) and return; else `engine.start({ onFinal: onAppendFinal, onInterim, onError })`; set `listening=true` only if start returned true.
- `stopHold()`: `engine.stop()`, `listening=false`, clear interim.
- **Hold vs tap (all three triggers):** a pointer/key press starts listening and records the press time. On release, if the press lasted **≥ `TAP_MS` (250ms)** it was a HOLD → stop (release-to-stop). If it lasted **< `TAP_MS`** it was a TAP → *stay listening* (latched); the next tap stops. This makes one component serve press-hold, key-hold, AND tap-to-toggle without a mode switch — accessible for users who can't sustain a hold.
- `buttonHandlers`: `onPointerDown` → `press()`; `onPointerUp`/`onPointerLeave`/`onPointerCancel` → `release()`; `onKeyDown` → if `(e.key===" "||e.key==="Enter") && !e.repeat` → `e.preventDefault(); press()`; `onKeyUp` (same keys) → `release()`. `press()` = record `pressedAt` + `startHold()` if not already listening; `release()` = if `now - pressedAt >= TAP_MS` → `stopHold()`, else leave listening latched (tap). A tap while already latched-listening → `stopHold()`.
- `toggle()`: exposed convenience = if listening `stopHold()` else `startHold()` (used by any explicit toggle affordance).
- `supported`: `getCtor() !== null` (from voice.ts).

### Mic button (in `chat-panel.tsx`)
- A small icon button beside the send control in the chat input row (near the `<textarea>` at ~line 579). `aria-pressed={listening}`, `aria-label={t(lang, "dictationHold")}` (e.g. "Hold to dictate"), title. Spread `buttonHandlers`. Palette-safe (AIPM tokens; `INTERACTIVE`). Hidden/disabled when `!supported` (or shown disabled with a "not supported in this browser" title).
- **Insertion:** `onAppendFinal(text)` → `setInput(prev => prev + (prev && !/\s$/.test(prev) ? " " : "") + text)`. Interim → a small live preview line ("🎙 …interim…") above/below the textarea (NOT written into `input`, so nothing uncommitted lands on send). Cleared on stop.
- **Errors:** `onError("not-allowed")` → `reportCapabilityGap`-style info toast "Microphone access denied — allow it in your browser to dictate." (`guard-feedback` from sub-project A); `"not-supported"` → the button is simply hidden/disabled (no toast spam). `"disabled"` handled by gating the button on the setting.

### Settings
- `settings.dictation?: { engine: "web-speech" | "stt" }` (default `"web-speech"`; `"stt"` reserved for SP2). Per-device via the `writeSettings` spread (no allowlist edit, mirrors `dashboardDensity`). A `SegmentedControl` in Settings → Appearance or Integrations (SP1 only shows web-speech meaningfully; the control is added now so SP2 just adds the option + its config). If showing a single option is odd, gate the control's second entry on SP2 — for SP1 the setting may default silently and the picker land in SP2. **SP1 decision:** add the `settings.dictation` field + default; DEFER the visible picker UI to SP2 (when there are two real engines to pick). SP1 wires the mic button unconditionally (web-speech is the only engine).

## Data flow / boundary
- No persistence of audio/transcript beyond the chat input the user sees. No network in SP1 (Web Speech is browser-local). No new secret, no proxy, no CSP host.
- Mic permission is browser-managed; the app only reacts to `not-allowed`.

## Error handling
- Unsupported browser → button hidden/disabled, no crash.
- Mic denied → single info toast, listening never starts.
- Engine keep-alive restart is guarded by `active` so `stop()` can't be out-raced into a zombie recognizer.

## Testing
- **`web-speech-engine.test.ts`:** mock `voice.ts` `startRecognition` (and `getCtor`); assert `start` wires `continuous:true`, routes interim vs final to the right handlers, `onEnd`-while-active restarts, `stop()` prevents restart + is idempotent, unsupported → `onError("not-supported")` + returns false.
- **`use-push-to-talk.test.ts`:** pointerDown → engine.start + listening true; pointerUp → stop + listening false; keyDown(Space,!repeat) → start, keyUp → stop; `onFinal` → `onAppendFinal` called; unsupported → `supported=false`, start no-ops.
- **Insertion unit:** the append helper spaces correctly (empty input, trailing-space input, no-trailing-space input).
- i18n EN/DE for the new keys (`dictationHold`, `dictationMicDenied`). Chat is NOT in the axe gate → mic-button a11y (aria-pressed/label, keyboard hold) eye-verified.

## Out of scope (SP1)
- The OpenAI-compatible STT engine, `MediaRecorder`, `/api/stt` proxy, `sttApiKey` secret, base-URL config — all **SP2**.
- The visible engine-picker UI (deferred to SP2, when there are two engines).
- A global (not-on-the-button) push-to-talk hotkey — possible later tweak.
- Dictation into inputs other than the chat textarea.
