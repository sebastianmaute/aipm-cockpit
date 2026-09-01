# Colour-only state and the pink text token — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every on/selected control a non-hue state channel and put every state indicator over the contrast floor its own success criterion sets, in all seven built-in scheme combos and in user-imported themes.

**Architecture:** Three independent mechanisms. A hue-independent shape marker closes SC 1.4.1 (hue carries meaning at the RAG and RACI sites, so a token swap would destroy information). Two derived per-accent border tokens close SC 1.4.11. The existing `--ui-pink-strong` variant closes SC 1.4.3. A `prefers-reduced-motion` block lands last, after the marker makes `voice-button`'s motion decorative.

**Tech Stack:** TypeScript, React 19, Next 16, Tailwind v4, vitest + React Testing Library. No new dependencies — the contrast arithmetic already exists in `src/app/scheme-tokens.ts`.

**Spec:** `docs/superpowers/specs/2026-09-01-colour-only-state-design.md`

---

## Read this before Task 1

**Line endings.** Every `src/app/*.ts(x)` file is CRLF. Use `Edit` (preserves) — **never** `Write` on an existing source file (re-lines CRLF→LF invisibly to `git diff`), and never `sed -i`. `docs/**` is LF. Verify any file you touch with `git ls-files --eol <file>`: `i/lf w/crlf` is healthy for source, `i/lf w/lf` means it was re-lined.

**Gate exit codes.** Never read one through a pipe — you get the pipe's status. Redirect, echo unpiped, then read the file:

```bash
npx vitest run src/app/scheme-state-contrast.test.ts > /tmp/x.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/x.log
```

Use the session scratchpad rather than `/tmp` if one is available — `/tmp` is shared across concurrent sessions.

**Never run two vitest processes at once.**

**Commits.** Use a Bash heredoc, never a PowerShell here-string. Never `git commit --amend` (shared worktree). `git checkout -- <file>` is deny-blocked; revert a mutant with an inverse anchored edit and assert uniqueness both directions.

**Mutation proof is required where a task says so.** A guard test that passes against the reverted code is worth nothing. When a step says "mutate", apply the mutation, confirm the test goes RED, revert, confirm GREEN, and record the token span you changed.

---

## File Structure

**Token layer** — one responsibility: turn a scheme's editable colours into the derived values components consume.
- `src/app/scheme-tokens.ts` — `nudgeToContrast` (generalised), `--control-state-border`, `--control-state-border-pink`
- `src/app/color-schemes.ts` — `DERIVED_TOKENS` list, so an imported theme may pin the new tokens
- `src/app/globals.css` — static pre-hydration fallbacks; the reduced-motion block

**Primitives** — one responsibility each: render a state with a marker and a conformant border.
- `src/app/toggle-button.tsx` — consume the derived borders
- `src/app/segmented-control.tsx` — selected-segment marker

**Call sites** — no logic changes, only which primitive/token they use.

**Tests**
- `src/app/scheme-state-contrast.test.ts` (new) — the floors, over every built-in combo

---

### Task 1: Derived state-border tokens

**Files:**
- Modify: `src/app/scheme-tokens.ts` (symbols `nudgeToAa`, `deriveAaVariants`)
- Test: `src/app/scheme-state-contrast.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/app/scheme-state-contrast.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { BUILTIN_SCHEMES } from "./builtin-schemes";
import { hexToRgb, relLuminance, resolveSchemeColors } from "./scheme-tokens";
import type { SchemeColorMap } from "./scheme-apply";

function ratio(a: string, b: string): number {
  const la = relLuminance(hexToRgb(a));
  const lb = relLuminance(hexToRgb(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// Every built-in scheme in every mode it supports. Beacon is light-only, so
// this is 7 combos, not 8 — derived from BUILTIN_SCHEMES rather than listed, so
// a new built-in is covered the day it lands instead of the day someone
// remembers this file.
const COMBOS: { id: string; colors: SchemeColorMap }[] = BUILTIN_SCHEMES.flatMap((s) => [
  { id: `${s.id}-light`, colors: resolveSchemeColors(s.light) },
  ...(s.dark ? [{ id: `${s.id}-dark`, colors: resolveSchemeColors(s.dark) }] : []),
]);

describe("scheme state contrast", () => {
  // ANTI-VACUITY: if BUILTIN_SCHEMES were ever empty or the flatMap broke, every
  // test.each below would silently run zero times and the suite would be green.
  test("enumerates all seven built-in combos", () => {
    expect(COMBOS.map((c) => c.id)).toEqual([
      "harbor-light", "harbor-dark",
      "meridian-light", "meridian-dark",
      "umber-light", "umber-dark",
      "beacon-light",
    ]);
  });

  // SC 1.4.11 — 3:1 for visual information identifying components AND STATES.
  // The pressed border is compared against the UNPRESSED border it replaces.
  test.each(COMBOS)("$id: --control-state-border clears 3:1 against --line", ({ colors }) => {
    expect(ratio(colors["--control-state-border"]!, colors["--line"]!)).toBeGreaterThanOrEqual(3);
  });

  test.each(COMBOS)("$id: --control-state-border-pink clears 3:1 against --line", ({ colors }) => {
    expect(ratio(colors["--control-state-border-pink"]!, colors["--line"]!)).toBeGreaterThanOrEqual(3);
  });

  // The SegmentedControl marker is drawn ON the selected segment, so the colour
  // it must contrast with is that segment's own fill — NOT the track. Measured
  // against the track, --segment-active-fg scores 1.01-1.14 in the light
  // schemes, which is why the track is the wrong reference.
  test.each(COMBOS)("$id: segment marker clears 3:1 against its own fill", ({ colors }) => {
    expect(
      ratio(colors["--segment-active-fg"]!, colors["--segment-active-bg"]!),
    ).toBeGreaterThanOrEqual(3);
  });

  // SC 1.4.3 — 4.5:1 for text, against --surface-muted (the card, and the
  // harder of the two surfaces, which is why deriveAaVariants uses it).
  test.each(COMBOS)("$id: --ui-pink-strong clears 4.5:1 against --surface-muted", ({ colors }) => {
    expect(
      ratio(colors["--ui-pink-strong"]!, colors["--surface-muted"]!),
    ).toBeGreaterThanOrEqual(4.5);
  });
});
```

- [ ] **Step 2: Run it and verify it fails for the RIGHT reason**

```bash
npx vitest run src/app/scheme-state-contrast.test.ts > /tmp/t1.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |control-state" /tmp/t1.log
```

Expected: FAIL. The two `--control-state-border*` blocks fail because the tokens are `undefined` (`ratio` on `undefined` throws or yields NaN). The combo-enumeration test, the segment-marker test and the pink-strong test must **PASS** already — they describe tokens that exist today. If any of those three fails, stop: the measurement in the spec is wrong and the plan needs revisiting before any code changes.

- [ ] **Step 3: Generalise `nudgeToAa`**

In `src/app/scheme-tokens.ts`, replace the `nudgeToAa` function body (keep the long comment block above it verbatim — it documents the `lighten` override and is load-bearing) with:

```ts
function nudgeToContrast(
  base: string,
  bg: string,
  target: number,
  lighten = relLuminance(hexToRgb(bg)) < 0.5,
): string {
  const factor = lighten ? 1 / 0.85 : 0.85;
  let [r, g, b] = hexToRgb(base);
  for (let i = 0; i < 20 && ratio(rgbToHex(r, g, b), bg) < target; i++) {
    r = Math.min(255, r * factor);
    g = Math.min(255, g * factor);
    b = Math.min(255, b * factor);
  }
  return rgbToHex(r, g, b);
}

function nudgeToAa(base: string, bg: string, lighten = relLuminance(hexToRgb(bg)) < 0.5): string {
  return nudgeToContrast(base, bg, 4.5, lighten);
}
```

`nudgeToAa` keeps its exact signature, so every existing caller and the whole `--ui-purple-strong` tint argument are untouched.

- [ ] **Step 4: Derive the two tokens**

In `deriveAaVariants`, immediately after the `--ui-pink-strong` line, insert:

```ts
  // SC 1.4.11 state borders. ToggleButton has TWO accents and §56 measured only
  // one: the dark-blue pressed border measures 1.03-1.22:1 against --line in the
  // three dark schemes, while the pink accent clears 3:1 in all seven combos
  // (3.04-5.08). Both are derived anyway — for pink the loop exits on its first
  // condition check and returns the base unchanged, so there is no visual change
  // and no cost, but beacon clears the floor by 0.04 and BOTH --ui-pink and
  // --line are user-editable (ADVANCED_TOKENS), so today's pass is a property of
  // the built-in values rather than a guarantee. Deriving makes it structural.
  const line = colors["--line"] ?? surface;
  if (colors["--ui-dark-blue"]) {
    out["--control-state-border"] = nudgeToContrast(colors["--ui-dark-blue"], line, 3);
  }
  if (colors["--ui-pink"]) {
    out["--control-state-border-pink"] = nudgeToContrast(colors["--ui-pink"], line, 3);
  }
```

- [ ] **Step 5: Run the test — expect PASS**

```bash
npx vitest run src/app/scheme-state-contrast.test.ts > /tmp/t1.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t1.log
```

Expected: `EXIT=0`, 36 tests passing (1 enumeration + 5 assertions × 7 combos).

- [ ] **Step 6: Mutation-prove BOTH new assertions**

The dark-blue assertion is the one that can genuinely fail; the pink one is at risk of being **vacuous**, because it passes against the underived token too. So the pink mutant must be the *derivation*, not the value.

Mutant A — lower the target:

```ts
    out["--control-state-border"] = nudgeToContrast(colors["--ui-dark-blue"], line, 1);
```

Run the test. Expected: RED on the three `*-dark` combos. Revert.

Mutant B — bypass the derivation for pink:

```ts
    out["--control-state-border-pink"] = colors["--ui-pink"];
```

Run the test. Expected: **GREEN** — this proves the pink assertion is currently vacuous against today's built-ins, which is expected and is why it exists (it guards user themes, not the built-ins). Record that result rather than "fixing" it. Then confirm the guard is real by also editing `BEACON_LIGHT`'s `--ui-pink` to `#e2e6e7` in a scratch copy of the value and re-running: with Mutant B still applied the pink assertion must go RED, and with Mutant B reverted it must go GREEN. Revert both edits and prove the tree is clean:

```bash
git diff --stat   # must be empty for builtin-schemes.ts
```

- [ ] **Step 7: Typecheck and commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
```

`tsc` exits **2** on diagnostics, not 1. Expect `EXIT=0`.

```bash
git add src/app/scheme-tokens.ts src/app/scheme-state-contrast.test.ts
git commit -F - <<'MSG'
feat(a11y): derive per-accent state-border tokens at a 3:1 floor

open-followups §56 — SC 1.4.11 requires 3:1 for visual information
identifying components AND STATES. ToggleButton's dark-blue pressed border
measures 1.03-1.22:1 against the unpressed --line in the three dark schemes,
so the pressed state is invisible to every user, not only to users with a
colour-vision deficiency.

nudgeToAa is generalised to nudgeToContrast(base, bg, target, lighten?) and
keeps its own signature, so the --ui-purple-strong tint derivation and every
other caller are untouched.

§56 measured one of the primitive's two accents. The pink accent clears 3:1
in all seven combos (3.04-5.08) and is derived anyway: the loop exits on its
first check and returns the base unchanged, so no pixel moves, but beacon
clears by 0.04 and both --ui-pink and --line are user-editable, so today's
pass is a property of the built-in values rather than a guarantee.
MSG
```

---

### Task 2: Register the tokens for import and pre-hydration

**Files:**
- Modify: `src/app/color-schemes.ts` (symbol `DERIVED_TOKENS`)
- Modify: `src/app/globals.css`

- [ ] **Step 1: Add both tokens to `DERIVED_TOKENS`**

```ts
const DERIVED_TOKENS = [
  "--ui-green-strong", "--ui-pink-strong", "--ui-purple-strong",
  "--rag-red-text", "--rag-amber-text", "--rag-green-text", "--muted-foreground",
  "--control-state-border", "--control-state-border-pink",
] as const;
```

This puts them in `VALID_TOKENS`, so a portable theme may pin them and survive import. `resolveSchemeColors` is base-wins (`{ ...deriveAaVariants(colors), ...colors }`), so an explicit pin is preserved and is never re-derived — the documented trade-off for the faithful-copy intent.

- [ ] **Step 2: Add the static fallbacks**

In `src/app/globals.css`, immediately after the `--ui-purple-strong: #514a8f;` declaration:

```css
  /* SC 1.4.11 state borders — the pre-boot/no-JS FALLBACK only; at runtime
     scheme-apply.ts overrides these inline per active scheme AND mode, so no
     `dark:` variant is needed at the consuming component. These static values
     are the AIPM-light bases unchanged, because both already clear 3:1 against
     the static --line #dbe2ea (dark-blue 8.97:1, pink 3.55:1) — the derivation
     returns the base when the floor is already met. */
  --control-state-border: #153a5c;
  --control-state-border-pink: #c24a76;
```

No `@theme` `--color-*` mapping is needed: the components consume these through Tailwind arbitrary values (`border-[var(--control-state-border)]`), not through a generated utility class.

- [ ] **Step 3: Verify the fallbacks are what the derivation produces**

```bash
npx vite-node -e "const{HARBOR_LIGHT}=require('./src/app/builtin-schemes');" 2>/dev/null || true
```

Instead of the above, add a temporary assertion to the test file and run it:

```ts
  test("globals.css fallbacks match the derivation for the AIPM-light base", () => {
    const derived = resolveSchemeColors({
      "--ui-dark-blue": "#153a5c", "--ui-pink": "#c24a76", "--line": "#dbe2ea",
      "--surface-muted": "#eef2f6",
    } as SchemeColorMap);
    expect(derived["--control-state-border"]).toBe("#153a5c");
    expect(derived["--control-state-border-pink"]).toBe("#c24a76");
  });
```

Keep this test — it is the only thing tying the CSS fallback to the derivation, and they drift silently otherwise.

- [ ] **Step 4: Run and commit**

```bash
npx vitest run src/app/scheme-state-contrast.test.ts > /tmp/t2.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t2.log
npx tsc --noEmit; echo "EXIT=$?"
git add src/app/color-schemes.ts src/app/globals.css src/app/scheme-state-contrast.test.ts
git commit -F - <<'MSG'
feat(a11y): register the state-border tokens for import and pre-boot paint

Adds both to DERIVED_TOKENS so a portable theme may pin them, and to
globals.css as the no-JS/pre-boot fallback. The static values are the
AIPM-light bases unchanged, because both already clear 3:1 against the static
--line, and a test pins that equivalence — the CSS fallback and the
derivation drift silently otherwise.
MSG
```

---

### Task 3: `ToggleButton` consumes the derived borders

**Files:**
- Modify: `src/app/toggle-button.tsx` (symbol `PRESSED`, and the file header comment)
- Test: `src/app/toggle-button.test.tsx` (existing)

- [ ] **Step 1: Write the failing test**

Append to `src/app/toggle-button.test.tsx`:

```tsx
  test("the pressed border rides the derived state token, not a raw accent", () => {
    const { rerender } = render(
      <ToggleButton pressed onToggle={() => {}}>Inline milestones</ToggleButton>,
    );
    const btn = screen.getByRole("button", { name: "Inline milestones" });
    expect(btn.className).toContain("border-[var(--control-state-border)]");
    expect(btn.className).not.toContain("border-ui-dark-blue");

    rerender(
      <ToggleButton pressed onToggle={() => {}} accent="pink">Inline milestones</ToggleButton>,
    );
    expect(btn.className).toContain("border-[var(--control-state-border-pink)]");
    expect(btn.className).not.toContain("border-ui-pink ");
  });
```

- [ ] **Step 2: Run it — expect FAIL**

```bash
npx vitest run src/app/toggle-button.test.tsx > /tmp/t3.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t3.log
```

Expected: FAIL, the className still contains `border-ui-dark-blue`.

- [ ] **Step 3: Swap the borders**

Replace the `PRESSED` map:

```ts
const PRESSED: Record<ToggleAccent, string> = {
  "dark-blue":
    "border-[var(--control-state-border)] bg-ui-dark-blue/10 text-ui-dark-blue hover:bg-ui-dark-blue/20 focus:ring-ui-dark-blue dark:bg-ui-dark-blue/20 dark:text-ui-light-grey",
  pink: "border-[var(--control-state-border-pink)] bg-ui-pink/10 text-ui-dark-blue hover:bg-ui-pink/20 focus:ring-ui-pink dark:bg-ui-pink/15 dark:text-ui-light-grey",
};
```

The `dark:border-*` variants are **deleted, not replaced**: `scheme-apply.ts` sets the custom property per active scheme *and mode*, so one declaration is already mode-correct. Leaving a `dark:` variant would re-pin the raw accent in dark mode and silently undo this whole task.

- [ ] **Step 4: Correct the header comment**

The file header currently reads "gains an accent border + tint when pressed, so the ON state is visible at a glance". That is measurably false in the dark schemes and is what §56 flagged. Replace that sentence with:

```
// bordered chip that gains a derived accent border + tint when pressed. The
// border rides `--control-state-border` / `--control-state-border-pink`, each
// nudged to clear 3:1 against the unpressed `--line` (SC 1.4.11) — the raw
// accents did not: `--ui-dark-blue` measured 1.03-1.22:1 against `--line` in
// the three dark schemes, which is invisible to every user, not only to users
// with a colour-vision deficiency. The non-colour cue is the trailing marker
// below, which is a SEPARATE guarantee (SC 1.4.1) and does not substitute for
// this one — open-followups §56 records that reading the glyph as the fix is
// the trap here.
```

- [ ] **Step 5: Run — expect PASS, and the whole existing file green**

```bash
npx vitest run src/app/toggle-button.test.tsx > /tmp/t3.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t3.log
```

- [ ] **Step 6: Commit**

```bash
git add src/app/toggle-button.tsx src/app/toggle-button.test.tsx
git commit -F - <<'MSG'
fix(a11y): ToggleButton's pressed border clears 3:1 in every scheme

Consumes the derived per-accent tokens instead of the raw accents. The
dark: border variants are deleted rather than remapped — scheme-apply sets
the custom property per active scheme AND mode, so a dark: variant would
re-pin the raw accent and undo the fix.

Also corrects the file header, which claimed the pressed state "is visible
at a glance". It measured 1.03:1 in umber-dark. Pre-existing text; §56 is
the release that made it disprovable.
MSG
```

---

### Task 4: `SegmentedControl` selected-segment marker

**Files:**
- Modify: `src/app/segmented-control.tsx`
- Test: `src/app/segmented-control.test.tsx` (existing)

Closes §101. The component's only apparent second cue is inert: the selected segment carries `shadow-[var(--shadow-control)]`, `globals.css` sets `--shadow-control: none`, and no scheme overrides it (`grep -c "shadow-control" src/app/builtin-schemes.ts` → 0). The fill alone measures 2.25-2.43:1 in the dark schemes and **1.13:1 in beacon-light**, which is `DEFAULT_SCHEME_ID` and the worst figure in the app.

- [ ] **Step 1: Write the failing test**

Append to `src/app/segmented-control.test.tsx`:

```tsx
  test("marks the selected segment with a non-colour glyph, rendered in BOTH states", () => {
    render(
      <SegmentedControl
        value="b"
        onChange={() => {}}
        options={[
          { value: "a", label: "Alpha" },
          { value: "b", label: "Bravo" },
        ]}
      />,
    );
    const alpha = screen.getByRole("radio", { name: "Alpha" });
    const bravo = screen.getByRole("radio", { name: "Bravo" });

    // Present on BOTH, so the segment keeps one width regardless of selection —
    // conditional rendering would resize every segment on each click.
    expect(alpha.querySelector("[data-selected-marker]")).not.toBeNull();
    expect(bravo.querySelector("[data-selected-marker]")).not.toBeNull();

    expect(bravo.querySelector("[data-selected-marker]")?.getAttribute("data-selected-marker"))
      .toBe("on");
    expect(alpha.querySelector("[data-selected-marker]")?.getAttribute("data-selected-marker"))
      .toBe("off");
    expect(alpha.querySelector("[data-selected-marker]")?.className).toContain("invisible");

    // The glyph is decoration; aria-checked already carries the state.
    expect(bravo.querySelector("[data-selected-marker]")?.getAttribute("aria-hidden")).toBe("true");
  });
```

- [ ] **Step 2: Run it — expect FAIL**

```bash
npx vitest run src/app/segmented-control.test.tsx > /tmp/t4.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t4.log
```

Expected: FAIL — `data-selected-marker` does not exist.

- [ ] **Step 3: Import the glyph**

At the top of `src/app/segmented-control.tsx`, add `CheckIcon` to the existing import from `./icons` (create the import if the file has none — icons come from the `icons.ts` barrel, never from `lucide-react` directly).

```ts
import { CheckIcon } from "./icons";
```

- [ ] **Step 4: Render the marker**

Replace the button's children (currently `{opt.label}`) with:

```tsx
            <CheckIcon
              aria-hidden="true"
              data-selected-marker={selected ? "on" : "off"}
              className={`h-3 w-3 shrink-0${selected ? "" : " invisible"}`}
            />
            {opt.label}
```

and add `inline-flex items-center gap-1.5` to the front of the button's base class string, so the glyph and label sit on one line:

```tsx
              "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium focus:outline-none focus:relative focus:z-10 focus:ring-2 focus:ring-ui-green",
```

The marker inherits `text-[var(--segment-active-fg)]` on the selected segment, which clears 3:1 against that segment's own fill in all seven combos (5.40-11.72, pinned by Task 1). It needs no colour class of its own.

- [ ] **Step 5: Run — expect PASS, whole file green**

```bash
npx vitest run src/app/segmented-control.test.tsx > /tmp/t4.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t4.log
```

- [ ] **Step 6: Mutate to prove the width guard**

Change the render to conditional:

```tsx
            {selected ? <CheckIcon aria-hidden="true" data-selected-marker="on" className="h-3 w-3 shrink-0" /> : null}
```

Run the test. Expected: RED on the `alpha.querySelector(...)` assertion. Revert with an anchored edit and confirm `git diff --stat` shows only the intended change.

- [ ] **Step 7: Check the consumers still render**

`SegmentedControl` has 31+ invocations across 14+ files, so this lands everywhere at once. Derive today's set and run the owning suites:

```bash
grep -rn "SegmentedControl" src/app --include=*.tsx | grep -v "\.test\.tsx:" | sed 's/:.*//' | sort -u
npx vitest run src/app/popover-panel.test.tsx src/app/modal-field-controls.test.tsx > /tmp/t4b.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t4b.log
```

If a suite asserts an exact button `textContent`, the marker does not change it (the glyph is an `<svg>`, contributing no text) — but a suite asserting an exact `className` string will need updating. Fix those, do not weaken the assertion to a substring match.

- [ ] **Step 8: Commit**

```bash
git add src/app/segmented-control.tsx src/app/segmented-control.test.tsx
git commit -F - <<'MSG'
fix(a11y): give the selected segment a non-colour marker

open-followups §101. The selected segment was distinguished by fill alone:
2.25-2.43:1 in the three dark schemes, and 1.13:1 in beacon-light, which the
entry's table omits entirely and which is DEFAULT_SCHEME_ID — the worst
measurement in the app, on what a fresh install runs.

The apparent second cue was inert: shadow-[var(--shadow-control)] resolves to
`none` in globals.css and no scheme overrides it.

The glyph rides --segment-active-fg, which clears 3:1 against the selected
segment's own fill in all seven combos. Against the TRACK it would measure
1.01-1.14 in the light schemes, so the track is the wrong reference — the
marker is drawn on the segment, not beside it.

Rendered in both states and merely invisible when off, so segments keep one
width; a mutation to conditional rendering turns the guard red.
MSG
```

---

### Task 5: Reduced motion

**Files:**
- Modify: `src/app/globals.css`

**Deviation from the spec, stated deliberately.** The spec proposed both a `@media` block *and* a `motion-safe:` prefix on `voice-button`. That is two mechanisms for one guarantee, and the second is redundant once the first exists. This task implements the `@media` block only, which also covers `skeleton.tsx` in the same place. If a future component needs per-element control, `motion-safe:` remains available.

Ordering matters: this lands **after** Task 11 gives `voice-button` a marker. Suppressing the pulse first would leave that control with no state cue at all for reduced-motion users. **If you are executing tasks out of order, do Task 11 before this one.**

- [ ] **Step 1: Confirm the gap is real and enumerate what animates**

```bash
grep -n "prefers-reduced-motion" src/app/globals.css; echo "EXIT=$?"
grep -rn "animate-" src/app --include=*.tsx | grep -v "\.test\." 
```

Expected: no media query today; two animating call sites (`skeleton.tsx`, `voice-button.tsx`). If the second command returns more, widen the block below to cover them and say so in the commit message.

- [ ] **Step 2: Add the block**

At the end of `src/app/globals.css`, outside the `@media print` block:

```css
/* SC 2.2.2 / SC 2.3.3 — honour an OS-level reduced-motion preference. The app
   had no such handling at all until this slice; two components animate
   (`skeleton.tsx`'s loading placeholder and `voice-button.tsx`'s listening
   pulse). This is safe for voice-button ONLY because it now carries a shape
   marker for its listening state — before that, the pulse WAS the state cue and
   stilling it would have left reduced-motion users with a 1.21-1.42:1 tint and
   nothing else. Order matters if this is ever reverted. */
@media (prefers-reduced-motion: reduce) {
  .animate-pulse {
    animation: none !important;
  }
}
```

- [ ] **Step 3: Verify the CSS compiles**

A malformed rule here takes `globals.css` down and the app 500s.

```bash
npm run build > /tmp/t5.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t5.log
```

- [ ] **Step 4: Commit**

```bash
git add src/app/globals.css
git commit -F - <<'MSG'
feat(a11y): honour prefers-reduced-motion

The app had no reduced-motion handling anywhere; two components animate.
Safe for voice-button only because it now carries a shape marker for its
listening state — before that the pulse WAS the cue, and stilling it would
have left a 1.21-1.42:1 tint and nothing else.

No test asserts the browser actually stills the animation: jsdom does not
evaluate media queries, so this is verified by the build compiling and by
eye, not by the unit suite.
MSG
```

---

## Call-site migrations (Tasks 6-12)

**The shared pattern.** Each task replaces a hand-rolled `aria-pressed` button with `ToggleButton`, which supplies the always-rendered `data-pressed-marker` glyph. Preserve the existing `onClick`, accessible name, and any row-unique label token exactly — several of these carry row-unique naming from earlier slices, and losing it re-opens a different defect.

**The shared test shape.** For every migrated site, add a test asserting the marker is in the DOM in **both** states. A test asserting only the ON state passes against a conditional-render regression, which is the failure this whole mechanism exists to prevent:

```tsx
    expect(offButton.querySelector("[data-pressed-marker]")).not.toBeNull();
    expect(offButton.querySelector("[data-pressed-marker]")?.getAttribute("data-pressed-marker"))
      .toBe("off");
```

**Three sites are NOT touched** — `step0-import-panel.tsx` (its selected state also changes font weight and text colour, and weight is not a colour channel), `task-form-fields`' "none" chip (`--ui-dark-blue` / `dark:--ui-blue` vs `--line` measures 8.97-10.22 light and 4.22-4.58 dark), and `influence-interest-matrix.tsx` (`ring-2 ring-ui-green` plus a `●` glyph). Editing them would be a change with no defect behind it. If a reviewer asks why they were skipped, the answer is the measurement, not preference.

---

### Task 6: `create-project-wizard` — two template buttons

**Files:**
- Modify: `src/app/create-project-wizard.tsx` (the `chooseTemplate` buttons)
- Test: `src/app/create-project-wizard.test.tsx`

Measured: `border-ui-green` vs `border-line` is **1.53-1.88:1 in all four LIGHT schemes** (4.96-6.90 dark), and the `bg-ui-green/10` tint is 1.08-1.22 everywhere. This is the site that inverts the roadmap's dark-schemes-are-the-problem assumption.

- [ ] **Step 1: Write the failing test**

```tsx
  test("every template option carries the non-colour selected marker", async () => {
    render(<CreateProjectWizard {...baseProps} />);
    const blank = screen.getByRole("button", { name: /blank/i });
    expect(blank.querySelector("[data-pressed-marker]")).not.toBeNull();
  });
```

- [ ] **Step 2: Run — expect FAIL** (`npx vitest run src/app/create-project-wizard.test.tsx`)

- [ ] **Step 3: Migrate both buttons**

Replace each hand-rolled button with `ToggleButton`, keeping the existing label content as `children` and the existing `onClick` as `onToggle`:

```tsx
                <ToggleButton
                  pressed={selectedTemplate === null}
                  onToggle={() => chooseTemplate(null)}
                  className="w-full justify-start text-left"
                  lang={lang}
                >
                  <span className="font-medium text-foreground">{/* existing label */}</span>
                </ToggleButton>
```

Add `import { ToggleButton } from "./toggle-button";`. The second button is the same shape with `pressed={selected}` and `onToggle={() => chooseTemplate(tpl)}`.

★ These buttons render a two-line body (a title plus a `<p>` of secondary text). `ToggleButton`'s `BASE` is `inline-flex items-center`, so pass `className="w-full justify-start text-left"` and keep the multi-line body inside a single child element, or the two lines will centre against the marker.

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add src/app/create-project-wizard.tsx src/app/create-project-wizard.test.tsx
git commit -F - <<'MSG'
fix(a11y): template picker signals selection by shape, not fill

open-followups §55. Its selected border measured 1.53-1.88:1 against the
unselected border in all four LIGHT schemes — the inverse of the pattern the
roadmap predicted — and the tint contributed 1.08-1.22:1 everywhere.
MSG
```

---

### Task 7: `task-form-fields` — the three health chips

**Files:**
- Modify: `src/app/task-form-fields.tsx` (the `chipActive[h]` buttons only)
- Modify: `src/app/task-health-chip-style.ts` if the class map needs trimming
- Test: `src/app/task-form-fields.test.tsx`

Measured, active border `--rag-*` vs inactive `--line`: red 3.08-4.44 (passes), **amber 1.34-2.34 and green 2.47-2.96 in the light schemes** (both fail). All three migrate so the row stays visually uniform — a row where one chip has a marker and two do not is worse than either consistent state.

**Do NOT touch the "none" chip in the same row** — it already conforms (8.97-10.22 light, 4.22-4.58 dark via its `dark:border-ui-blue` override).

- [ ] **Step 1: Write the failing test**

```tsx
  test("each health chip carries the marker in both states", () => {
    render(<TaskFormFields {...baseProps} />);
    const amber = screen.getByRole("button", { name: /amber|at risk/i });
    expect(amber.querySelector("[data-pressed-marker]")).not.toBeNull();
  });
```

- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Migrate the three chips to `ToggleButton`**, keeping `HEALTH_CHIP_ACTIVE_CLASS`'s hue as a `className` (the RAG hue carries the health value and must survive):

```tsx
                    <ToggleButton
                      key={h}
                      pressed={form.healthOverride === h}
                      onToggle={() => setForm({ ...form, healthOverride: h })}
                      className={form.healthOverride === h ? chipActive[h] : undefined}
                      lang={lang}
                    >
                      {/* existing label */}
                    </ToggleButton>
```

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add src/app/task-form-fields.tsx src/app/task-health-chip-style.ts src/app/task-form-fields.test.tsx
git commit -F - <<'MSG'
fix(a11y): health chips signal selection by shape

open-followups §55. The amber and green active borders measured 1.34-2.34
and 2.47-2.96 against --line in the light schemes. The RAG hue is kept — it
carries the health value — and the marker is added beside it. The "none"
chip in the same row already conformed and is untouched.
MSG
```

---

### Task 8: `knowledge-panel` — source filter chips

**Files:** Modify `src/app/knowledge-panel.tsx`; test `src/app/knowledge-panel.test.tsx`

Measured: active fill `--ui-dark-blue` vs `--surface-muted` is 8.73-10.54 light, **1.01-1.17 in the three dark schemes**.

- [ ] **Step 1:** Write the marker test (both states) — same shape as Task 6 Step 1, targeting the `documentsFilterAll` chip.
- [ ] **Step 2:** Run — expect FAIL.
- [ ] **Step 3:** Migrate to `ToggleButton`, preserving the trailing count span:

```tsx
          <ToggleButton
            key={k}
            pressed={active}
            onToggle={() => setSourceFilter(k)}
            className="rounded-full"
            lang={lang}
          >
            {label} <span className="opacity-60">{counts[k]}</span>
          </ToggleButton>
```

- [ ] **Step 4:** Run — expect PASS.
- [ ] **Step 5:** Commit (`fix(a11y): knowledge source filters signal selection by shape` — body cites the 1.01-1.17:1 dark measurement).

---

### Task 9: `raci-chip-picker` — the four role chips

**Files:** Modify `src/app/raci-chip-picker.tsx`; test `src/app/raci-chip-picker.test.tsx`

Measured, active fill vs `--surface`: **R 1.10-1.31 and I 2.70-2.84 in the dark schemes** (both fail); A 5.30-8.80 and C 3.33-6.15 pass everywhere. All four migrate for within-picker uniformity; the `CHIP` hue map is preserved, since the colour identifies the RACI role.

- [ ] **Step 1:** Write the marker test covering an R chip in both states.
- [ ] **Step 2:** Run — expect FAIL.
- [ ] **Step 3:** Migrate, keeping `CHIP[role].on` / `.off` as `className`.
- [ ] **Step 4:** Run — expect PASS. Check the popover still lays out: this picker is `fixed z-[100] flex w-max` and the marker widens each chip.
- [ ] **Step 5:** Commit.

---

### Task 10: `comm-templates-section` — the two compare buttons

**Files:** Modify `src/app/settings-sections/comm-templates-section.tsx`; test its existing suite

Measured: active fill `--ui-dark-blue` vs `--surface`, **1.10-1.31 in the dark schemes**.

★ Both buttons carry a row-unique `aria-label` built from `versionRowTokens` — thread it through `ToggleButton`'s `ariaLabel` prop unchanged. Dropping it re-opens the row-unique-names defect class that §111/§126/§247/§248 record, and no gate can see it (axe has no rule flagging two controls that share an accessible name, in any view at any seed size).

- [ ] **Step 1:** Write the marker test AND an assertion that both compare buttons still have distinct accessible names.
- [ ] **Step 2:** Run — expect FAIL.
- [ ] **Step 3:** Migrate both, passing `ariaLabel={...}` verbatim.
- [ ] **Step 4:** Run — expect PASS.
- [ ] **Step 5:** Commit.

---

### Task 11: `voice-button` — icon-only listening toggle

**Files:** Modify `src/app/voice-button.tsx`; test `src/app/voice-button.test.tsx`

Measured: the tint is **1.21-1.42:1 in all seven combos** — it is not a cue at all, and `animate-pulse` is doing 100% of the work today.

★★ **This one changes the control's visual footprint, and that is a real UI change, not a refactor.** `voice-button` today is `rounded-md p-2` with no border; `ToggleButton`'s `BASE` is a bordered chip (`border px-2.5 py-1.5`). Adopting the primitive turns a bare top-bar icon into a bordered chip. That is the cost of the marker here and it needs an eye-verify (Task 16). If the reviewer rejects the footprint change, the fallback is an icon swap (mic → stop glyph) — but do NOT hand-roll a marker inline, which duplicates the primitive.

- [ ] **Step 1: Write the failing test**

```tsx
  test("listening state carries a non-colour marker, present when idle too", () => {
    render(<VoiceButton {...baseProps} listening={false} />);
    const btn = screen.getByRole("button", { name: "Voice command" });
    expect(btn.querySelector("[data-pressed-marker]")?.getAttribute("data-pressed-marker"))
      .toBe("off");
  });
```

- [ ] **Step 2:** Run — expect FAIL.
- [ ] **Step 3: Migrate**

The accessible name is pinned to the enabled action (`voiceCommand`) and must NOT flip with state — the existing comment explains why (SC 4.1.2). It is icon-only, so the label goes in an `sr-only` child, which still contributes the accessible name:

```tsx
    <ToggleButton
      pressed={listening}
      onToggle={handleClick}
      disabled={!supported}
      accent="pink"
      icon={<MicIcon />}
      title={supported ? (listening ? t(lang, "voiceListening") : t(lang, "voiceCommandTip")) : t(lang, "voiceUnsupported")}
      className={listening ? "animate-pulse" : undefined}
      lang={lang}
    >
      <span className="sr-only">{t(lang, "voiceCommand")}</span>
    </ToggleButton>
```

`accent="pink"` preserves today's pink listening tint and is the accent that already clears 3:1 everywhere.

- [ ] **Step 4:** Run — expect PASS. Confirm the accessible name is still exactly `"Voice command"` and did not gain the tooltip text.
- [ ] **Step 5:** Commit.

---

### Task 12: `dictation-mic`

**Files:** Modify `src/app/dictation-mic.tsx`; test `src/app/dictation-mic.test.tsx`

Measured: the icon colour change (`--ui-green-strong` vs `--muted-foreground`) clears 3:1 in **one** combo only (harbor-light, 3.08); elsewhere 1.20-2.72.

★ It returns `{ mic, status, registration, supported }` as separate nodes, so the "Listening" text that would otherwise be a sufficient cue is placed at the consumer's discretion and is not guaranteed to sit beside the button. The marker makes the control self-sufficient however a consumer arranges the pieces.

- [ ] **Step 1:** Write the marker test (both states).
- [ ] **Step 2:** Run — expect FAIL.
- [ ] **Step 3:** Migrate the `mic` node to `ToggleButton`, `sr-only` label as in Task 11, preserving the `padding` and `className` props this component accepts from its callers.
- [ ] **Step 4:** Run — expect PASS.
- [ ] **Step 5:** Commit.

---

### Task 13: §325 — the six real-text pink sites

**Files:** Modify `document-block-notices.tsx`, `documents-asset-section.tsx` (2 occurrences), `documents-deleted-section.tsx`, `documents-panel.tsx`, `document-block-gutter.tsx`

Measured, raw `--ui-pink` as text against `--surface-muted`: **4.12 / 4.16 / 4.41 / 3.04 in the four light schemes** — all under the 4.5 AA floor. The register recorded only beacon, and only against `--surface`. The dark schemes pass at 5.74-6.24, and there `nudgeToAa` returns the base unchanged, so `--ui-pink-strong` and `--ui-pink` are the same colour and this is a visual no-op in dark mode.

- [ ] **Step 1: Enumerate today's sites** (do not trust the list above — main may have moved)

```bash
grep -rn "text-ui-pink[^-]" src/app --include=*.tsx | grep -v "\.test\.tsx:"
```

Expect **13 lines**. The thirteenth is a comment in `type-to-confirm-dialog.tsx` quoting the token to explain why the strong variant is used there — the detector matches the note documenting the fix. Leave it.

- [ ] **Step 2:** In each of the six real-text sites, change `text-ui-pink` to `text-ui-pink-strong`. Leave every `hover:text-ui-pink` alone — those are Task 14.
- [ ] **Step 3: Re-run the grep** — expect 7 lines remaining (6 hover + 1 comment).
- [ ] **Step 4: Run the owning suites**

```bash
npx vitest run src/app/documents-panel.test.tsx src/app/document-block-gutter.test.tsx > /tmp/t13.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t13.log
```

- [ ] **Step 5:** Commit.

```bash
git commit -F - <<'MSG'
fix(a11y): pink status text uses the AA-derived variant

open-followups §325. Raw --ui-pink as text measures 4.12/4.16/4.41/3.04
against --surface-muted in the four light schemes, all under the 4.5 AA
floor. The register recorded one beacon measurement against --surface; this
widens it by three schemes and one background.

--surface-muted is the right reference because it is the card background and
the harder of the two, which is why deriveAaVariants already derives the
-strong variants against it.

No-op in the dark schemes, where nudgeToAa returns the base unchanged.
MSG
```

---

### Task 14: §325 — the six hover-glyph sites adopt `IconButton`

**Files:** Modify `history-panel.tsx` (2), `labels-input.tsx`, `project-form-fields.tsx`, `settings-sections/removable-chip-row.tsx`, `stakeholder-recipient-input.tsx`

★★ **These are NOT a contrast defect and the commit message must say so.** Against the 3:1 non-text floor they pass in every combo (worst case beacon 3.04). What they are is primitive non-adoption: `icon-button.tsx`'s `danger` variant is already exactly `"text-muted-foreground hover:bg-ui-pink/10 hover:text-ui-pink-strong"`. Recording this as a contrast fix would put a measurement in the history that nobody took.

- [ ] **Step 1:** For each site, replace the hand-rolled button with `IconButton`, mapping the existing `aria-label` to `label` and the glyph to `children`:

```tsx
  <IconButton label={t(lang, "clear")} variant="danger" className="-mr-1">
    <XMarkIcon aria-hidden="true" className="h-4 w-4" />
  </IconButton>
```

★ `labels-input.tsx` and `stakeholder-recipient-input.tsx` sit inside commit-on-blur editors. If either currently carries an `onMouseDown` `preventDefault`, **keep it** — `IconButton` spreads `...props` onto the button, so it threads through. Without it the clear lands on an already-closed editor and is swallowed.

- [ ] **Step 2:** Run each owning suite; fix any test asserting the old class string.
- [ ] **Step 3: Confirm the inventory is now clean**

```bash
grep -rn "text-ui-pink[^-]" src/app --include=*.tsx | grep -v "\.test\.tsx:"
```

Expect **1 line** — the `type-to-confirm-dialog.tsx` comment.

- [ ] **Step 4:** Commit.

```bash
git commit -F - <<'MSG'
refactor: per-row clear glyphs adopt IconButton's danger variant

NOT a contrast fix. These six pass the 3:1 non-text floor in every combo
(worst case 3.04 on beacon). They are hand-rolled duplicates of a variant
IconButton already ships. Recorded as consistency so a later reader does not
infer a measurement nobody took.
MSG
```

---

### Task 15: Register

**Files:** Modify `docs/open-followups.md` (LF)

★★ Both this slice and a concurrent export-fidelity slice edit this file. On a merge conflict, **adjudicate the summary table PER ROW** and diff against this branch's own tip afterwards, not only against the merge base — taking one side wholesale loses the other's entries with every gate green, and `--cc` is blind to it.

★★ The register is INSIDE `doc-claims-check` (`SKIP_DIRS` is `["docs/superpowers"]`). Cite **symbols and reproduce commands, never `path:LINE`** — the gate is a ratchet and a new citation fails it.

- [ ] **Step 1: Re-check the number ceiling** — a number is reserved only once it is on `origin/main`

```bash
grep -oE "^## [0-9]+\." docs/open-followups.md | grep -oE "[0-9]+" | sort -n | tail -1
```

Expected 328 (or higher if the sibling slice merged first — renumber rather than assume).

- [ ] **Step 2: Close §55, §56, §101, §325.** A closure is a **four-place edit at minimum**: the heading, the summary-table status, the summary-table anchor, and the `**Status:**` line. Recent closures took five and six places — cross-reference anchors inside *other* entries' bodies, plus body claims the fix falsified. Grep the number across the file and fix every hit:

```bash
grep -n "§55\b\|#55-\|^## 55\." docs/open-followups.md
```

- [ ] **Step 3: Amend §101 and §325 rather than only closing them.** §101's table gains its missing `beacon-light | 1.13:1 | fail` row and loses the claim that the light schemes pass on lightness alone. §325 records that all four light schemes fail against `--surface-muted`, not beacon alone. Both amendments go in the CLOSED entry, because the entry is the record of what was actually wrong.

- [ ] **Step 4: File §331** — `aria-pressed` used for mutually-exclusive choices at six sites (SC 4.1.2). Name the six: `create-project-wizard`, `step0-import-panel`, `task-form-fields`, `raci-chip-picker`, `knowledge-panel`, `influence-interest-matrix`. State that converting them changes keyboard interaction (roving tabindex, one tab stop, arrow navigation) on six surfaces and each needs its own eye-verify. Include a `**Status:**` line with today's date; `never machine-verified` is a conforming and honest answer.

- [ ] **Step 5: File §332** — reduced-motion policy beyond the two components this slice covers.

- [ ] **Step 6: Run the register gates**

```bash
npm run docs:claims:check > /tmp/t15a.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/t15a.log
npm run followups:status:check > /tmp/t15b.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/t15b.log
```

Exit **1 is drift** (fix the content); exit **2 means the gate could not scan** — a gate that scans nothing passes everything, so never treat a 2 as a pass.

- [ ] **Step 7:** Commit.

---

### Task 16: Full gates and the owed eye-verify

- [ ] **Step 1: Run the gates this slice can actually fail**

```bash
npx eslint --max-warnings=0 src; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
npm run test:run > /tmp/suite.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/suite.log
npm run size:check > /tmp/size.log 2>&1; echo "EXIT=$?"; tail -3 /tmp/size.log
npm run docs:symbols:check > /tmp/sym.log 2>&1; echo "EXIT=$?"; tail -3 /tmp/sym.log
```

`npm run lint` exits 1 from gitignored leftovers — use `npx eslint` directly. `tsc` exits 2 on diagnostics.

- [ ] **Step 2: Run the a11y gate on the views this touches**

Serially — `playwright.config.ts` sets `workers: CI ? 1 : undefined`, so a local multi-view run is CPU-count and over-subscribes. A `Test timeout of 60000ms exceeded` is contention, not a violation.

```bash
npx playwright test e2e/a11y.spec.ts --project=chromium --workers=1 -g "Settings|Documents|Next actions" > /tmp/axe.log 2>&1; echo "EXIT=$?"; tail -10 /tmp/axe.log
```

Warm the route first (`curl -o /dev/null http://localhost:3000/`) so the first navigation's Turbopack compile does not eat the 60s budget.

- [ ] **Step 3: Eye-verify — this is a GATE, not a nicety.** axe has no rule that evaluates whether a control's state is colour-only, at any scheme count or seed size, so nothing automated covers the actual claim of this slice. Check in **beacon-light** (the fresh-install default, and the worst measurement) and in **one dark scheme**:

  - every migrated toggle shows its marker when on and reserves the slot when off, with no width jump on click
  - the segmented control's selected segment is identifiable without relying on hue
  - `voice-button`'s new bordered-chip footprint in the top bar is acceptable — **this is the one deliberate visual change in the slice**
  - the RACI popover and the knowledge filter row still lay out at their new widths

- [ ] **Step 4:** Report results, including anything the eye-verify rejected, before any release conversation.

---

## Self-review

**Spec coverage.** §1 measurements → Task 1's test pins all four floors. §2 marker → Tasks 4, 6-12. §3 derived tokens → Tasks 1-3. §4 pink text → Tasks 13-14. §5 reduced motion → Task 5. §6 file list → every file appears in a task. §7 testing → Tasks 1, 4 (mutation), 6-12 (both-states), 16 (eye-verify). §8 out-of-scope → Task 15 files §331/§332 and touches §302 nowhere.

**Deviation from the spec, flagged rather than buried:** Task 5 implements the `@media` block only and drops the `motion-safe:` prefix the spec also proposed, as two mechanisms for one guarantee. Task 11 records that adopting `ToggleButton` changes `voice-button`'s visual footprint, which the spec did not call out.

**Ordering constraint:** Task 5 must follow Task 11.

**Type consistency:** `nudgeToContrast(base, bg, target, lighten?)` is used with that signature in Tasks 1 and 2; `--control-state-border` / `--control-state-border-pink` are spelled identically in Tasks 1, 2, 3 and the test; `data-pressed-marker` (ToggleButton, existing) and `data-selected-marker` (SegmentedControl, new) are deliberately different attributes and are not interchanged.
