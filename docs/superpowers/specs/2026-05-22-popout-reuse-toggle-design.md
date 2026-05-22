# Popout Window Reuse Toggle Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a settings toggle that, when enabled, causes all popout panel buttons to reuse a single already-open popout window (focusing it) rather than opening a new browser window per panel.

---

## Motivation

Currently each panel pops out into its own named window (`lop-popout-chat`, `lop-popout-gantt`, etc.), so a user can accumulate many separate popout windows. The toggle lets users opt into a single-popout mode where clicking any panel's popout button focuses the existing window rather than spawning a new one.

---

## Behaviour

| Mode | Setting | What happens on popout click |
|------|---------|------------------------------|
| Multi-window (default) | `popout.reuseWindow = false` | Opens / focuses the per-tab named window (current behaviour, unchanged) |
| Single-window | `popout.reuseWindow = true` | If an existing popout window is open and not closed, focus it. Otherwise open a new window and track the reference. |

"Reuse" means **focus only** — the existing window's content is not changed.

---

## Architecture

### Settings schema (`settings-menu.tsx`)

Add a `popout` sub-object to the `Settings` type and `DEFAULT_SETTINGS`:

```typescript
popout: {
  reuseWindow: boolean;  // default: false
}
```

### `broadcast-sync.ts`

Add a module-level window reference tracker:

```typescript
let _popoutWindowRef: Window | null = null;
```

Modify `openPopoutWindow` signature to accept the setting:

```typescript
export function openPopoutWindow(tab: PopoutTab, reuseWindow: boolean): void {
  if (reuseWindow && _popoutWindowRef && !_popoutWindowRef.closed) {
    _popoutWindowRef.focus();
    return;
  }
  const url = `${window.location.pathname}?popout=${encodeURIComponent(tab)}`;
  const win = window.open(url, `lop-popout-${tab}`, "popup=yes,width=1200,height=800");
  if (win) _popoutWindowRef = win;
}
```

Window names stay `lop-popout-${tab}` — multi-window mode is byte-for-byte identical to today.

### `workspace-section.tsx`

Add `useSettings()` call internally to read `settings.popout.reuseWindow`. Pass it to every `openPopoutWindow(tab, reuseWindow)` call site. No new props added to `WorkspaceSectionProps`.

### `settings-menu.tsx` (UI)

Add a "Reuse popout window" toggle in the existing settings panel, grouped with display-level settings. Label: `t(lang, "popoutReuseWindow")`. Persisted via the existing `setSettings` mechanism.

### `i18n.ts` (translation keys)

Add key `"popoutReuseWindow"` with values:
- `en-US`: `"Reuse popout window"`
- `en-GB`: `"Reuse pop-out window"`
- `de`: `"Bereits geöffnetes Fenster wiederverwenden"`

---

## Files Modified

| File | Change |
|------|--------|
| `src/app/settings-menu.tsx` | Add `popout: { reuseWindow }` to `Settings` type + `DEFAULT_SETTINGS`; add toggle UI |
| `src/app/broadcast-sync.ts` | Add `_popoutWindowRef`; update `openPopoutWindow` signature + logic |
| `src/app/workspace-section.tsx` | Add `useSettings()` call; pass `reuseWindow` to `openPopoutWindow` |
| `src/app/i18n.ts` | Add `popoutReuseWindow` translation key |

---

## Testing

### `broadcast-sync.test.ts` (modify existing)

1. `openPopoutWindow` calls `window.open` and stores the ref when no ref exists
2. `openPopoutWindow` with `reuseWindow=true` focuses existing open window without calling `window.open`
3. `openPopoutWindow` with `reuseWindow=true` opens a new window when stored ref is closed
4. `openPopoutWindow` with `reuseWindow=false` always calls `window.open` (multi-window mode unchanged)

### Settings UI

5. Toggle renders in settings panel
6. Toggling updates `settings.popout.reuseWindow`

---

## Tasks (for implementation plan)

1. Extend `Settings` type + `DEFAULT_SETTINGS` + add `popoutReuseWindow` i18n key
2. Update `broadcast-sync.ts` — add ref tracker + update `openPopoutWindow`
3. Update `workspace-section.tsx` — read setting, pass to `openPopoutWindow`
4. Add settings toggle UI in `settings-menu.tsx`
