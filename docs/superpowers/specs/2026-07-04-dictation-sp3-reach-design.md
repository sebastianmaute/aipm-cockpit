# Push-to-Talk Dictation — SP3 (Reach) Design

**Goal:** Extend dictation beyond the chat: a reusable mic affordance on the high-value prose textareas, plus a configurable global push-to-talk hotkey that dictates into whichever dictation-enabled field is focused.

**Context:** SP3 of sub-project C. SP1 (Web Speech) + SP2 (STT) shipped `usePushToTalk`, the engine abstraction (`resolveDictationEngine`), `appendDictation`, and `settings.dictation`. SP3 reuses all of it — no new engine/secret/proxy/network.

**Approved decisions:** reusable mic on prose fields (task notes, RAID description, change/milestone/stakeholder notes) + a **configurable** global hold-to-talk hotkey (default `F4`).

---

## Architecture

```
DictationMic (reusable) ── wraps usePushToTalk ── appends via appendDictation to its field
        │ on focus: registers {press, release, label} as the ACTIVE dictation target
        ▼
dictation-target (one active target)
        ▲
use-dictation-hotkey (mounted once) ── configured key down/up ── drives the active target's press/release
```

The hotkey **remote-triggers the focused field's own mic** (no separate engine, no fragile `activeElement.value` injection into React-controlled inputs).

## Components

### `dictation-mic.tsx` (reusable, extracted from chat-panel)
`<DictationMic lang dictation enabled onAppendFinal fieldRef? />`:
- Calls `usePushToTalk({ lang, enabled, dictation, onAppendFinal, onInterim, onError })`.
- Renders the `aria-pressed` mic button (`supported`-gated) + the interim/transcribing preview line (the exact markup SP1/SP2 has in chat-panel, moved here). Palette-safe.
- `onError`: `not-allowed` → info toast (`dictationMicDenied`); `stt-*` → `dictationTranscribeFailed`; `not-supported` → hidden/no toast — same as chat today.
- **Registers as the active dictation target** while its associated field is focused (see below), exposing the hook's `press`/`release` so the hotkey can drive it.
- **`chat-panel.tsx` is refactored to use `<DictationMic>`** (DRY — the SP1 inline mic + preview become this component; chat behavior byte-unchanged).

### `usePushToTalk` (extend, non-breaking)
Expose `press`/`release` (the existing internal hold handlers) in the return alongside `buttonHandlers`, so `DictationMic` can register them for the hotkey. No behavior change to existing consumers.

### `dictation-target.ts` (focus registration)
A tiny module (context or a module-level ref + subscribe): `setActiveDictationTarget({ press, release, label } | null)` + `getActiveDictationTarget()`. `DictationMic` sets it on the field's `focus`, clears it on `blur` (only if it's still the active one). One target at a time; the hotkey reads it.

### `use-dictation-hotkey.ts` (mounted once in task-manager)
- Reads the configured hotkey from `settings.dictation.hotkey` (default `"F4"`; a combo string, e.g. `"F4"` or `"Ctrl+Shift+D"`).
- A document `keydown`(`!repeat`)/`keyup` listener: when the event matches the configured combo AND there is an active dictation target → `e.preventDefault()`; keydown → `target.press()`, keyup → `target.release()`. No active target → no-op (let the key through).
- Pure matcher `matchesHotkey(e, combo)` (in the module, testable): parses the combo string and compares key + modifiers.
- Disabled when `!isPopout`-style gating isn't needed here, but skip in popouts (mirror other global listeners) and when dictation is unsupported.

### Settings — configurable hotkey
- `settings.dictation.hotkey?: string` (per-device, via the `writeSettings` spread; sanitized to a safe combo string, capped length). Default `"F4"` (function keys don't insert text → safe while a field is focused).
- In `dictation-section.tsx`: a "Push-to-talk hotkey" capture control — a button that, when armed, records the next key-combo (`e.key` + modifiers → the combo string) and stores it; shows the current combo; a reset-to-default. Labeled (Settings axe-scanned). A note that a bare printable key will type into fields (recommend a function key or a modifier combo).

## Prose fields wired
Add `<DictationMic ... onAppendFinal={(txt) => setX((prev) => ({ ...prev, notes: appendDictation(prev.notes ?? "", txt) }))} />` next to the textarea in: `task-form-fields.tsx` (notes), `raid-edit-modal.tsx` (description), `change-edit-modal.tsx` (description/notes), `milestone-edit-modal.tsx` (notes), `stakeholder-edit-modal.tsx` (notes). Each uses that surface's existing draft setter. `enabled` = the same gating chat uses (dictation supported). The field wires `onFocus`/`onBlur` to register/clear the active target (DictationMic exposes an `onFieldFocus`/`onFieldBlur` the field spreads onto its textarea, OR DictationMic renders the textarea itself — see below).

### Wiring shape (keep it simple)
`DictationMic` is a **button + preview only** (it does NOT own the textarea — the fields keep their own textareas/validation). The field passes the textarea's `onFocus`/`onBlur` through to `DictationMic`'s registration, or spreads a `registrationHandlers` object `DictationMic` returns. Chosen: `DictationMic` returns/accepts `onTargetFocus`/`onTargetBlur` the field attaches to its textarea, so the mic + the field's textarea stay decoupled.

## Data flow / boundary
- No persisted field beyond `settings.dictation.hotkey` (per-device). No new engine/secret/proxy/network. Dictation still routes through `resolveDictationEngine(settings.dictation, lang)`.
- Transcript appends to the target field's in-memory draft (the field persists via its existing save path — nothing new).

## Error handling
- Same as SP1/SP2 (mic-denied toast, unsupported hidden, transcribe-failed toast) — centralized in `DictationMic`.
- Hotkey with no active target → no-op (doesn't swallow the key).
- Popout → hotkey + mic gated off (mirror SP1 chat popout handling).

## Testing
- `DictationMic` (renders mic + preview, appends via onAppendFinal, supported-gate, registers/clears target on focus/blur).
- `dictation-target` (set/get/clear, only-clear-if-active).
- `matchesHotkey` (parses `"F4"`, `"Ctrl+Shift+D"`; matches key+modifiers; rejects mismatches).
- `use-dictation-hotkey` (keydown→active target.press, keyup→release, no target→no-op, popout gated).
- settings coercion (hotkey sanitized/defaulted).
- chat-panel unchanged after the refactor (existing chat + dictation tests green).
- Chat/modals NOT in axe gate → mic a11y eye-verified; dictation-section IS axe-scanned (hotkey control labeled).

## Out of scope
- Mic on ALL textareas (only the 5 prose fields this slice; others later).
- Dictating into non-textarea inputs (single-line fields).
- Streaming; multi-language auto-detect.
- Chord recording beyond a single key + modifiers.
