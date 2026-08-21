# Push-to-Talk Dictation SP3 (Reach) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reusable `DictationMic` on 5 prose textareas + a configurable global push-to-talk hotkey that remote-triggers the focused field's mic — all reusing the SP1/SP2 dictation machinery.

**Architecture:** `DictationMic` wraps `usePushToTalk` (now exposing `press`/`release`) and, while its field is focused, registers `{press, release}` as the single active target in `dictation-target.ts`; `use-dictation-hotkey` drives that target on the configured key. Chat-panel refactors to `DictationMic` (DRY).

**Tech Stack:** TypeScript, React 19, vitest. No new engine/secret/proxy/network.

**Verify:** tests `npm run test:run -- <file>` · typecheck `npx tsc --noEmit` · lint `npm run lint` · size `npm run size:check`. ★★ i18n.de.ts: node utf8 write.

---

## File Structure
- Modify `src/app/use-push-to-talk.ts` — expose `press`/`release`.
- Create `src/app/dictation-target.ts` — active-target registry + tests.
- Create `src/app/dictation-mic.tsx` — reusable mic button + preview + focus registration.
- Modify `src/app/chat-panel.tsx` — use `<DictationMic>` (DRY).
- Create `src/app/dictation-hotkey.ts` (`matchesHotkey`) + `src/app/use-dictation-hotkey.ts` (listener).
- Modify `src/app/settings-types.ts` + `use-settings.ts` — `dictation.hotkey`.
- Modify `src/app/settings-sections/dictation-section.tsx` — hotkey capture control + i18n.
- Modify `src/app/task-manager.tsx` — mount `use-dictation-hotkey`.
- Modify `task-form-fields.tsx`, `raid-edit-modal.tsx`, `change-edit-modal.tsx`, `milestone-edit-modal.tsx`, `stakeholder-edit-modal.tsx` — add `<DictationMic>` to the notes/description textareas.

---

## Task 1: expose press/release + dictation-target registry

**Files:** Modify `src/app/use-push-to-talk.ts`; Create `src/app/dictation-target.ts` + `src/app/dictation-target.test.ts`

- [ ] **Step 1:** In `src/app/use-push-to-talk.ts`, add `press` and `release` (the existing internal `press`/`release` callbacks) to the returned object: `return { listening, transcribing, supported, buttonHandlers, toggle, press, release };`. No other change (existing consumers ignore the new fields).

- [ ] **Step 2:** Create `src/app/dictation-target.ts`:
```ts
// The single active dictation target — the focused field a global hotkey drives.
export interface DictationTarget { press: () => void; release: () => void; label: string; }

let active: DictationTarget | null = null;

export function setActiveDictationTarget(t: DictationTarget | null): void { active = t; }
export function getActiveDictationTarget(): DictationTarget | null { return active; }
/** Clear ONLY if `t` is still the active target (avoids a stale blur clearing a newer focus). */
export function clearDictationTargetIf(t: DictationTarget): void { if (active === t) active = null; }
```

- [ ] **Step 3:** Test `src/app/dictation-target.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { setActiveDictationTarget, getActiveDictationTarget, clearDictationTargetIf } from "./dictation-target";

beforeEach(() => setActiveDictationTarget(null));

describe("dictation-target", () => {
  it("set/get the active target", () => {
    const t = { press: () => {}, release: () => {}, label: "Notes" };
    setActiveDictationTarget(t);
    expect(getActiveDictationTarget()).toBe(t);
  });
  it("clearDictationTargetIf clears only when it is the active one", () => {
    const a = { press: () => {}, release: () => {}, label: "A" };
    const b = { press: () => {}, release: () => {}, label: "B" };
    setActiveDictationTarget(a);
    clearDictationTargetIf(b); // b is not active → no-op
    expect(getActiveDictationTarget()).toBe(a);
    clearDictationTargetIf(a);
    expect(getActiveDictationTarget()).toBeNull();
  });
});
```

- [ ] **Step 4:** `npm run test:run -- dictation-target use-push-to-talk` → PASS; `npx tsc --noEmit` → 0; `npm run lint` → 0.
- [ ] **Step 5: Commit** `git add src/app/use-push-to-talk.ts src/app/dictation-target.ts src/app/dictation-target.test.ts && git commit -m "feat(dictation): expose press/release + active-target registry"`

---

## Task 2: DictationMic reusable component

**Files:** Create `src/app/dictation-mic.tsx` + `src/app/dictation-mic.test.tsx`

- [ ] **Step 1:** Create `src/app/dictation-mic.tsx`. It is a **hook** `useDictationMic(...)` returning `{ mic, status, registration, supported }` (a hook, not a component, so a field can render `{mic}`/`{status}` inline and spread `registration` onto its own textarea — keeping the mic decoupled from the field's textarea/validation). The mic markup mirrors chat-panel's SP1/SP2 button + preview:
```tsx
"use client";
import { useMemo } from "react";
import type { Lang } from "./i18n";
import { t } from "./i18n";
import type { Settings } from "./settings-types";
import { usePushToTalk } from "./use-push-to-talk";
import { reportCapabilityGap } from "./guard-feedback";
import { useToastContext } from "./toast-context";
import { INTERACTIVE } from "./interaction-styles";
import { setActiveDictationTarget, clearDictationTargetIf, type DictationTarget } from "./dictation-target";

interface UseDictationMicArgs {
  lang: Lang;
  dictation?: Settings["dictation"];
  enabled?: boolean;
  label: string;
  onAppendFinal: (text: string) => void;
}

export function useDictationMic({ lang, dictation, enabled = true, label, onAppendFinal }: UseDictationMicArgs) {
  const showToast = useToastContext();
  const ptt = usePushToTalk({ lang, enabled, dictation, onAppendFinal, onInterim: () => {}, onError: (err) => {
    if (err === "not-allowed") reportCapabilityGap(showToast, lang, "dictation.micDenied", "dictationMicDenied");
    else if (err.startsWith("stt-")) showToast("error", t(lang, "dictationTranscribeFailed"));
    else if (err === "not-supported") showToast("error", t(lang, "dictationRecordUnsupported"));
  } });
  const target = useMemo<DictationTarget>(() => ({ press: ptt.press, release: ptt.release, label }), [ptt.press, ptt.release, label]);
  const registration = { onFocus: () => setActiveDictationTarget(target), onBlur: () => clearDictationTargetIf(target) };
  const mic = ptt.supported ? (
    <button type="button" aria-pressed={ptt.listening} aria-label={t(lang, "dictationHold")} title={t(lang, "dictationHold")}
      className={`rounded-md border border-line px-2 py-1 ${INTERACTIVE} ${ptt.listening ? "text-AIPM-green-strong" : "text-muted-foreground"}`}
      {...ptt.buttonHandlers}>🎙</button>
  ) : null;
  const status = (ptt.listening || ptt.transcribing)
    ? <span className="text-xs text-muted-foreground" aria-live="polite">{ptt.transcribing ? t(lang,"dictationTranscribing") : t(lang,"dictationListening")}</span>
    : null;
  return { mic, status, registration, supported: ptt.supported };
}
```
Implement the HOOK form (`useDictationMic`) in `dictation-mic.tsx`. (Delete the broken component sketch above.)

- [ ] **Step 2:** Test `src/app/dictation-mic.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useDictationMic } from "./dictation-mic";
import { getActiveDictationTarget } from "./dictation-target";
vi.mock("./use-push-to-talk", () => ({ usePushToTalk: () => ({ listening: false, transcribing: false, supported: true, buttonHandlers: {}, toggle: () => {}, press: vi.fn(), release: vi.fn() }) }));

describe("useDictationMic", () => {
  it("registers/clears the active target on focus/blur", () => {
    const { result } = renderHook(() => useDictationMic({ lang: "en-US", label: "Notes", onAppendFinal: vi.fn() }));
    result.current.registration.onFocus();
    expect(getActiveDictationTarget()?.label).toBe("Notes");
    result.current.registration.onBlur();
    expect(getActiveDictationTarget()).toBeNull();
  });
  it("exposes a mic element when supported", () => {
    const { result } = renderHook(() => useDictationMic({ lang: "en-US", label: "Notes", onAppendFinal: vi.fn() }));
    expect(result.current.mic).not.toBeNull();
  });
});
```

- [ ] **Step 3:** `npm run test:run -- dictation-mic` → PASS; `npx tsc --noEmit` → 0; `npm run lint` → 0.
- [ ] **Step 4: Commit** `git add src/app/dictation-mic.tsx src/app/dictation-mic.test.tsx && git commit -m "feat(dictation): reusable useDictationMic (button + preview + target registration)"`

---

## Task 3: refactor chat-panel to useDictationMic (DRY)

**Files:** Modify `src/app/chat-panel.tsx`

- [ ] **Step 1:** In `chat-panel.tsx`, replace the inline `usePushToTalk(...)` + the mic `<button>` + the listening/transcribing `<p>` with `useDictationMic(...)`: call `const { mic, status, registration } = useDictationMic({ lang, dictation: settings.dictation, enabled: true, label: t(lang,"chatPlaceholder") /* or a chat label */, onAppendFinal: (txt) => setInput((prev) => appendDictation(prev, txt)) });`. Render `{mic}` where the mic button was and `{status}` where the preview `<p>` was. Attach `onFocus={registration.onFocus} onBlur={registration.onBlur}` to the chat `<textarea>`. Remove the now-unused `interim` state + the old `onError`/`ptt` wiring (the hook centralizes it). Keep the chat's own `not-allowed`/`stt-` toast behavior — now inside the hook, so drop the duplicate in chat.
- [ ] **Step 2:** Verify chat behavior unchanged: `npm run test:run -- chat-panel` → PASS (update the test only if it asserted the old inline structure; keep intent). `npx tsc --noEmit` → 0; `npm run lint` → 0; `npm run size:check` → ok (chat-panel should SHRINK).
- [ ] **Step 3: Commit** `git add src/app/chat-panel.tsx && git commit -m "refactor(dictation): chat mic uses the shared useDictationMic"`

---

## Task 4: settings.dictation.hotkey + matchesHotkey + use-dictation-hotkey

**Files:** Modify `src/app/settings-types.ts` + `use-settings.ts`; Create `src/app/dictation-hotkey.ts` + `src/app/use-dictation-hotkey.ts` + tests; Modify `src/app/task-manager.tsx`

- [ ] **Step 1:** `settings-types.ts` — add `hotkey?: string` to `dictation`: `dictation?: { engine: "web-speech"|"stt"; sttBaseUrl?: string; sttModel?: string; sttApiKey?: string; hotkey?: string }`. Default in `defaultSettings.dictation`: `hotkey: "F4"`. In the load sanitizer, coerce `hotkey` to a trimmed string capped at 40 chars, default `"F4"` when blank.

- [ ] **Step 2:** Create `src/app/dictation-hotkey.ts`:
```ts
/** A hotkey combo string like "F4" or "Ctrl+Shift+D". Serialize from a KeyboardEvent. */
export function eventToCombo(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey">): string {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.metaKey) parts.push("Meta");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  const k = e.key.length === 1 ? e.key.toUpperCase() : e.key; // "a"->"A", "F4" stays
  if (!["Control", "Meta", "Alt", "Shift"].includes(k)) parts.push(k);
  return parts.join("+");
}

/** Does the event match the configured combo? */
export function matchesHotkey(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey">, combo: string): boolean {
  if (!combo) return false;
  return eventToCombo(e) === combo;
}
```

- [ ] **Step 3:** Test `src/app/dictation-hotkey.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { eventToCombo, matchesHotkey } from "./dictation-hotkey";
const ev = (o: Partial<KeyboardEvent>) => ({ key: "", ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...o } as KeyboardEvent);
describe("dictation-hotkey", () => {
  it("serializes F4", () => { expect(eventToCombo(ev({ key: "F4" }))).toBe("F4"); });
  it("serializes a chord", () => { expect(eventToCombo(ev({ key: "d", ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+D"); });
  it("ignores a bare modifier key", () => { expect(eventToCombo(ev({ key: "Shift", shiftKey: true }))).toBe("Shift"); });
  it("matches", () => { expect(matchesHotkey(ev({ key: "F4" }), "F4")).toBe(true); expect(matchesHotkey(ev({ key: "F5" }), "F4")).toBe(false); });
});
```

- [ ] **Step 4:** Create `src/app/use-dictation-hotkey.ts`:
```ts
import { useEffect, useRef } from "react";
import { matchesHotkey } from "./dictation-hotkey";
import { getActiveDictationTarget } from "./dictation-target";

/** Global hold-to-talk: while the configured combo is held, drive the focused
 *  field's mic (press on keydown, release on keyup). No active target → the key
 *  passes through untouched. Disabled in popouts. */
export function useDictationHotkey(combo: string | undefined, isPopout: boolean): void {
  const comboRef = useRef(combo);
  comboRef.current = combo;
  const heldRef = useRef(false);
  useEffect(() => {
    if (isPopout) return;
    const onDown = (e: KeyboardEvent) => {
      if (e.repeat || heldRef.current) return;
      const c = comboRef.current;
      if (!c || !matchesHotkey(e, c)) return;
      const target = getActiveDictationTarget();
      if (!target) return;                 // no field focused → let the key through
      e.preventDefault();
      heldRef.current = true;
      target.press();
    };
    const onUp = (e: KeyboardEvent) => {
      if (!heldRef.current) return;
      const c = comboRef.current;
      // release when the main key (or any part) lifts
      if (c && !matchesHotkey(e, c) && !["Control","Shift","Alt","Meta"].includes(e.key)) {
        // a different key — ignore
      }
      heldRef.current = false;
      getActiveDictationTarget()?.release();
    };
    document.addEventListener("keydown", onDown);
    document.addEventListener("keyup", onUp);
    return () => { document.removeEventListener("keydown", onDown); document.removeEventListener("keyup", onUp); };
  }, [isPopout]);
}
```

- [ ] **Step 5:** Test `src/app/use-dictation-hotkey.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useDictationHotkey } from "./use-dictation-hotkey";
import { setActiveDictationTarget } from "./dictation-target";
beforeEach(() => setActiveDictationTarget(null));
function key(type: "keydown"|"keyup", k: string) { document.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true })); }
describe("useDictationHotkey", () => {
  it("presses/releases the active target on the configured key", () => {
    const press = vi.fn(); const release = vi.fn();
    setActiveDictationTarget({ press, release, label: "Notes" });
    renderHook(() => useDictationHotkey("F4", false));
    key("keydown", "F4"); expect(press).toHaveBeenCalled();
    key("keyup", "F4"); expect(release).toHaveBeenCalled();
  });
  it("no-ops with no active target", () => {
    renderHook(() => useDictationHotkey("F4", false));
    key("keydown", "F4"); // must not throw
    expect(true).toBe(true);
  });
  it("is disabled in popouts", () => {
    const press = vi.fn();
    setActiveDictationTarget({ press, release: vi.fn(), label: "X" });
    renderHook(() => useDictationHotkey("F4", true));
    key("keydown", "F4"); expect(press).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6:** Mount in `task-manager.tsx` (near the other global hooks): `useDictationHotkey(settings.dictation?.hotkey, isPopout);`. Import it.
- [ ] **Step 7:** `npm run test:run -- dictation-hotkey use-dictation-hotkey settings` → PASS; `npx tsc --noEmit` → 0; `npm run lint` → 0; `npm run size:check` → ok.
- [ ] **Step 8: Commit** `git add src/app/settings-types.ts src/app/use-settings.ts src/app/dictation-hotkey.ts src/app/use-dictation-hotkey.ts src/app/dictation-hotkey.test.ts src/app/use-dictation-hotkey.test.ts src/app/task-manager.tsx && git commit -m "feat(dictation): configurable global push-to-talk hotkey"`

---

## Task 5: dictation-section hotkey capture UI + i18n

**Files:** Modify `src/app/settings-sections/dictation-section.tsx` + `src/app/i18n.ts` + `i18n.de.ts`

- [ ] **Step 1:** i18n — EN (`i18n.ts`):
```ts
  dictationHotkey: "Push-to-talk hotkey",
  dictationHotkeySet: "Press a key…",
  dictationHotkeyReset: "Reset to F4",
  dictationHotkeyNote: "Use a function key (F4) or a modifier combo — a plain letter would type into fields.",
```
DE (`i18n.de.ts`, node write):
```
  dictationHotkey: "Push-to-Talk-Tastenkürzel",
  dictationHotkeySet: "Taste drücken …",
  dictationHotkeyReset: "Auf F4 zurücksetzen",
  dictationHotkeyNote: "Verwenden Sie eine Funktionstaste (F4) oder eine Modifikatorkombination — ein einfacher Buchstabe würde in Felder geschrieben.",
```

- [ ] **Step 2:** In `dictation-section.tsx`, add a "Push-to-talk hotkey" control: shows the current `settings.dictation?.hotkey ?? "F4"`, a button that arms capture (on next keydown, `eventToCombo(e)` → save into `settings.dictation.hotkey` via the settings setter, then disarm), and a reset button (sets `"F4"`). Use `eventToCombo` from `./dictation-hotkey` (import `../dictation-hotkey`). All labeled (`aria-label` from the i18n keys; Settings is axe-scanned). Persist via `onChange`/the settings setter (writeSettings spread — no allowlist edit). Show the `dictationHotkeyNote`.

- [ ] **Step 3:** `npx tsc --noEmit` → 0 (parity); `npm run test:run -- i18n-encoding dictation-section` → PASS; `npm run lint` → 0; axe: `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Settings"` → pass.
- [ ] **Step 4: Commit** `git add src/app/settings-sections/dictation-section.tsx src/app/i18n.ts src/app/i18n.de.ts && git commit -m "feat(dictation): settings hotkey capture control"`

---

## Task 6: wire the 5 prose fields

**Files:** Modify `task-form-fields.tsx`, `raid-edit-modal.tsx`, `change-edit-modal.tsx`, `milestone-edit-modal.tsx`, `stakeholder-edit-modal.tsx`

- [ ] **Step 1:** For EACH file, at the notes/description textarea: call `const { mic, status, registration } = useDictationMic({ lang, dictation: settings.dictation, label: <field label>, onAppendFinal: (txt) => <setDraft>((prev) => ({ ...prev, <field>: appendDictation(prev.<field> ?? "", txt) })) });`. Render `{mic}` next to the textarea (e.g. in the field's label row) + `{status}` below it; attach `onFocus={registration.onFocus} onBlur={registration.onBlur}` to the textarea. Get `settings.dictation` from `useSettings()` (these modals can call it) and `lang` from the existing prop/context.
  - `task-form-fields.tsx`: field `notes`, setter `setForm`. Label `t(lang,"notes")` (or the existing label key).
  - `raid-edit-modal.tsx`: field `description`, its draft setter.
  - `change-edit-modal.tsx`: field `description`/`notes`, its draft setter.
  - `milestone-edit-modal.tsx`: field `notes`, its draft setter.
  - `stakeholder-edit-modal.tsx`: field `notes`, its draft setter.
  Match each file's actual draft state + field name (grep the textarea's `value=`/`onChange` to find the setter + field).

- [ ] **Step 2: Test** — add one focused test per surface that's easy (e.g. `task-form-fields.test.tsx`): render, assert a mic button appears when dictation is supported. If a surface has no test harness, verify via tsc/lint + note.

- [ ] **Step 3:** `npx tsc --noEmit` → 0; `npm run lint` → 0; `npm run test:run -- task-form raid-edit change-edit milestone-edit stakeholder-edit` → PASS; `npm run size:check` → ok (fold if a modal trips).
- [ ] **Step 4: Commit** `git add <the 5 files + tests> && git commit -m "feat(dictation): mic on task/RAID/change/milestone/stakeholder notes"`

---

## Final verification
- [ ] `npx tsc --noEmit` → 0 · `npm run lint` → 0 · `npm run test:run` → full green · `npm run size:check` → ok · `npm run dup:check` → within 2.4
- [ ] Grep: chat-panel no longer has an inline `usePushToTalk` (uses `useDictationMic`); the hotkey is mounted once; `dictation-target` cleared on blur only if active.
- [ ] Manual smoke: focus task notes → hold the mic → speak → appends; focus RAID description → hold F4 → dictates into it; change the hotkey in Settings → new key drives it; chat dictation still works.

Then follow **superpowers:finishing-a-development-branch**.
