# Template Suggestion Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At project creation, deterministically suggest the best-matching template from the project's `ProjectMeta` and preselect it in the wizard's Step 2 with a "Suggested" badge + localized reason.

**Architecture:** A pure `template-suggest.ts` scores meta signals (team / regulated / deployment / duration / scale) → target tier → picks the matching template (built-in preferred). The wizard Step 2 preselects it once (unless the user has touched the list) and badges the row.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, vitest 4 + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-06-12-template-suggestion-engine-design.md`

**Conventions:** one test file `npx vitest run src/app/<f>.test.ts`; full suite `npm run test:run`; lint gate `--max-warnings=0`; build `npm run build`. No `console.log`. No version bump (orchestrator releases). i18n.de.ts curly-quote hazard — grep after edits. Known flakes (ignore / re-run isolated): `due-dates.property.test.ts`, `task-manager.portfolio-mode.test.tsx`.

**Verified facts:**
- `ProjectMeta`: `keyStakeholdersInternal: string[]`, `keyStakeholdersExternal: string[]`, `sponsor?: string`, `projectManager: string`, `regulatory: RegulatoryRequirement[]` (union INCLUDES `"Not applicable"` — so "regulated" means it contains a value ≠ "Not applicable"), `deployment: "Cloud"|"On-premise"|"Hybrid"`, `startDate`/`endDate: string` (ISO), `identityCount?: number`, `products: string` (a STRING, not array — NOT usable as a count; scale uses `identityCount` only).
- `deriveMode(features): "simple"|"modular"|"advanced"` (0 → simple, 10 → advanced, else modular). Built-ins: `builtin-minimal`→simple (`features: []`), `builtin-standard`→modular (5 of 10), `builtin-full`→advanced (all 10). `ProjectTemplate` has `id`, `name`, `builtIn?`, `features: readonly FeatureModuleId[]`.
- `t(lang, key, ...args)` positional `{0}`/`{1}`. Existing keys `modeSimple`/`modeModular`/`modeAdvanced`. Fragment-join precedent: `parts.join(" · ")` (notifications.tsx:37).
- Wizard `create-project-wizard.tsx`: state `selectedTemplate` (init `null`), `chooseTemplate(tpl)` is the sole selection mutator; `meta` captured in `handleDetails`; `templates` from `useTemplates()`. **No `useEffect`/`useRef`/`useMemo` imported yet — add them.** Row map (line ~186) has `tpl`, `tplMode`, `selected` in scope; mode pill at ~207. `MODE_LABEL_KEY = { simple:"modeSimple", modular:"modeModular", advanced:"modeAdvanced" }`.

---

## File Structure

| File | Responsibility | New? |
|------|----------------|------|
| `src/app/template-suggest.ts` | pure `suggestTemplate` + scoring + `SUGGEST_WEIGHTS` | new |
| `src/app/template-suggest.test.ts` | scoring + pick + suggest tests | new |
| `src/app/create-project-wizard.tsx` | Step 2 preselect-once + badge + reason | modify |
| `src/app/create-project-wizard.test.tsx` | badge + preselect component tests | modify |
| `src/app/i18n.ts` / `i18n.de.ts` | badge + reason fragment keys | modify |
| `docs/CODEMAPS/frontend.md` | one-line note | modify |

---

## Task 1: Pure suggestion engine

**Files:** Create `src/app/template-suggest.ts`, `src/app/template-suggest.test.ts`.

- [ ] **Step 1: Write the failing test**
```ts
import { describe, expect, it } from "vitest";
import { complexityScore, suggestTemplate } from "./template-suggest";
import { BUILT_IN_TEMPLATES } from "./templates-builtin";
import type { ProjectMeta } from "./types";

function meta(over: Partial<ProjectMeta> = {}): ProjectMeta {
  return {
    name: "P", code: "P", projectManager: "", keyStakeholdersInternal: [], keyStakeholdersExternal: [],
    customer: "", naceSection: "", identityTypes: [], products: "", deployment: "Cloud",
    startDate: "", endDate: "", profitCenter: "", contactPersons: [], regulatory: [], ...over,
  } as ProjectMeta;
}

describe("complexityScore", () => {
  it("sparse meta scores 0 with no reasons", () => {
    expect(complexityScore(meta()).score).toBe(0);
    expect(complexityScore(meta()).reasons).toEqual([]);
  });
  it("team 8+ adds 2 and a reason; 3-7 adds 1", () => {
    const big = meta({ keyStakeholdersInternal: ["a","b","c","d","e","f","g","h"] });
    expect(complexityScore(big).score).toBe(2);
    expect(complexityScore(big).reasons[0].key).toBe("suggestSignalTeam");
    const mid = meta({ keyStakeholdersInternal: ["a","b","c"] });
    expect(complexityScore(mid).score).toBe(1);
  });
  it("regulated only when a value other than 'Not applicable' present", () => {
    expect(complexityScore(meta({ regulatory: ["Not applicable"] })).score).toBe(0);
    expect(complexityScore(meta({ regulatory: ["DORA"] })).score).toBe(1);
  });
  it("deployment Hybrid +2, On-premise +1, Cloud +0", () => {
    expect(complexityScore(meta({ deployment: "Hybrid" })).score).toBe(2);
    expect(complexityScore(meta({ deployment: "On-premise" })).score).toBe(1);
    expect(complexityScore(meta({ deployment: "Cloud" })).score).toBe(0);
  });
  it("duration >12mo +2, 3-12mo +1, <3mo +0", () => {
    expect(complexityScore(meta({ startDate: "2026-01-01", endDate: "2027-06-01" })).score).toBe(2);
    expect(complexityScore(meta({ startDate: "2026-01-01", endDate: "2026-07-01" })).score).toBe(1);
    expect(complexityScore(meta({ startDate: "2026-01-01", endDate: "2026-02-01" })).score).toBe(0);
  });
  it("scale: identityCount above threshold +1", () => {
    expect(complexityScore(meta({ identityCount: 5000 })).score).toBe(1);
    expect(complexityScore(meta({ identityCount: 10 })).score).toBe(0);
  });
});

describe("suggestTemplate", () => {
  it("sparse → simple → builtin-minimal, limited reason", () => {
    const s = suggestTemplate(meta(), BUILT_IN_TEMPLATES);
    expect(s.tier).toBe("simple");
    expect(s.templateId).toBe("builtin-minimal");
    expect(s.reasons[0].key).toBe("suggestSignalLimited");
  });
  it("high complexity → advanced → builtin-full", () => {
    const s = suggestTemplate(meta({
      keyStakeholdersInternal: ["a","b","c","d","e","f","g","h"], regulatory: ["DORA"],
      deployment: "Hybrid", startDate: "2026-01-01", endDate: "2027-06-01", identityCount: 9000,
    }), BUILT_IN_TEMPLATES);
    expect(s.tier).toBe("advanced");
    expect(s.templateId).toBe("builtin-full");
    expect(s.reasons.length).toBeGreaterThan(1);
  });
  it("mid complexity → modular → builtin-standard", () => {
    const s = suggestTemplate(meta({ keyStakeholdersInternal: ["a","b","c"], deployment: "On-premise" }), BUILT_IN_TEMPLATES);
    expect(s.tier).toBe("modular");
    expect(s.templateId).toBe("builtin-standard");
  });
  it("prefers a built-in of the target tier over a user template of that tier", () => {
    const user = { id: "u1", name: "U", features: [] as const, fieldVisibility: {} } as const;
    const s = suggestTemplate(meta(), [user as never, ...BUILT_IN_TEMPLATES]);
    expect(s.templateId).toBe("builtin-minimal"); // built-in simple preferred over user simple
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/app/template-suggest.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** `src/app/template-suggest.ts`:
```ts
import type { ProjectMeta } from "./types";
import type { ProjectTemplate } from "./templates";
import type { TranslationKey } from "./i18n";
import { deriveMode, type AppMode } from "./feature-modules";

export type SuggestTier = AppMode; // "simple" | "modular" | "advanced"
export interface SuggestReason { key: TranslationKey; args?: (string | number)[]; }
export interface TemplateSuggestion { templateId: string; tier: SuggestTier; reasons: SuggestReason[]; }

const DEPLOYMENT_POINTS: Record<ProjectMeta["deployment"], number> = { Cloud: 0, "On-premise": 1, Hybrid: 2 };
const TEAM_MID = 3, TEAM_LARGE = 8;
const DURATION_MID_MONTHS = 3, DURATION_LARGE_MONTHS = 12;
const SCALE_THRESHOLD = 1000;
const TIER_MODULAR_MIN = 2, TIER_ADVANCED_MIN = 5;
const TIER_RANK: Record<SuggestTier, number> = { simple: 0, modular: 1, advanced: 2 };

function monthsBetween(start: string, end: string): number {
  const s = Date.parse(start), e = Date.parse(end);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return 0;
  return (e - s) / (1000 * 60 * 60 * 24 * 30.44);
}
function isRegulated(reg: readonly string[]): boolean {
  return reg.some((r) => !!r && r !== "Not applicable");
}

export function complexityScore(meta: ProjectMeta): { score: number; reasons: SuggestReason[] } {
  const reasons: SuggestReason[] = [];
  let score = 0;

  const team =
    (meta.keyStakeholdersInternal?.length ?? 0) +
    (meta.keyStakeholdersExternal?.length ?? 0) +
    (meta.sponsor?.trim() ? 1 : 0) +
    (meta.projectManager?.trim() ? 1 : 0);
  if (team >= TEAM_LARGE) { score += 2; reasons.push({ key: "suggestSignalTeam", args: [team] }); }
  else if (team >= TEAM_MID) { score += 1; reasons.push({ key: "suggestSignalTeam", args: [team] }); }

  if (isRegulated(meta.regulatory ?? [])) { score += 1; reasons.push({ key: "suggestSignalRegulated" }); }

  const dep = DEPLOYMENT_POINTS[meta.deployment] ?? 0;
  if (dep > 0) { score += dep; reasons.push({ key: "suggestSignalDeployment", args: [meta.deployment] }); }

  const months = Math.round(monthsBetween(meta.startDate, meta.endDate));
  if (months > DURATION_LARGE_MONTHS) { score += 2; reasons.push({ key: "suggestSignalDuration", args: [months] }); }
  else if (months >= DURATION_MID_MONTHS) { score += 1; reasons.push({ key: "suggestSignalDuration", args: [months] }); }

  if ((meta.identityCount ?? 0) >= SCALE_THRESHOLD) { score += 1; reasons.push({ key: "suggestSignalScale" }); }

  return { score, reasons };
}

function tierForScore(score: number): SuggestTier {
  if (score >= TIER_ADVANCED_MIN) return "advanced";
  if (score >= TIER_MODULAR_MIN) return "modular";
  return "simple";
}

function pickTemplateForTier(tier: SuggestTier, templates: readonly ProjectTemplate[]): string {
  if (templates.length === 0) return "";
  const withMode = templates.map((tpl) => ({ tpl, mode: deriveMode(tpl.features) }));
  const builtinExact = withMode.find((x) => x.tpl.builtIn && x.mode === tier);
  if (builtinExact) return builtinExact.tpl.id;
  const anyExact = withMode.find((x) => x.mode === tier);
  if (anyExact) return anyExact.tpl.id;
  let best = withMode[0];
  let bestDist = Math.abs(TIER_RANK[best.mode] - TIER_RANK[tier]);
  for (const x of withMode.slice(1)) {
    const d = Math.abs(TIER_RANK[x.mode] - TIER_RANK[tier]);
    if (d < bestDist || (d === bestDist && x.tpl.builtIn && !best.tpl.builtIn)) { best = x; bestDist = d; }
  }
  return best.tpl.id;
}

export function suggestTemplate(meta: ProjectMeta, templates: readonly ProjectTemplate[]): TemplateSuggestion {
  const { score, reasons } = complexityScore(meta);
  const tier = tierForScore(score);
  return {
    templateId: pickTemplateForTier(tier, templates),
    tier,
    reasons: reasons.length ? reasons : [{ key: "suggestSignalLimited" }],
  };
}
```
> The test references i18n keys (`suggestSignalTeam`, etc.) only as `.key` STRING values — they don't need to exist as TranslationKeys for Task 1's test to pass at runtime. BUT `SuggestReason.key: TranslationKey` is typed, so `tsc` will fail unless the keys exist. Add the i18n keys in THIS task's Step 3.5 (below) so tsc passes; or accept that Task 2 adds them and run only the vitest in Step 4 here, deferring `tsc` to Task 2. CLEANER: add the keys now.

- [ ] **Step 3.5: Add the i18n keys** (EN `i18n.ts` + DE `i18n.de.ts`, identical sets; grep curly quotes in de.ts after):
```
templateSuggested: "Suggested",            // DE "Empfohlen"
suggestSignalTeam: "{0} people",           // DE "{0} Personen"
suggestSignalRegulated: "regulated",       // DE "reguliert"
suggestSignalDeployment: "{0} deployment", // DE "Betrieb: {0}"
suggestSignalDuration: "{0}-month timeline", // DE "{0}-Monats-Laufzeit"
suggestSignalScale: "large user base",     // DE "große Nutzerbasis"
suggestSignalLimited: "limited info — start simple", // DE "wenig Infos — einfach starten"
```

- [ ] **Step 4: Run** `npx vitest run src/app/template-suggest.test.ts` → PASS. `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**
```bash
git add src/app/template-suggest.ts src/app/template-suggest.test.ts src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat: add deterministic template suggestion engine"
```

---

## Task 2: Wire into wizard Step 2 (preselect + badge + reason)

**Files:** Modify `src/app/create-project-wizard.tsx`. Test: `src/app/create-project-wizard.test.tsx`.

- [ ] **Step 1: Write the failing test** (append to `create-project-wizard.test.tsx`; reuse its provider wrapper + the `completeStep1` helper that fills Step 1 and clicks "Next"):
```tsx
it("Step 2 badges and preselects the suggested template (high complexity → Full delivery)", async () => {
  // Fill Step 1 with high-complexity meta, advance to Step 2. Use the existing completeStep1 helper
  // but ensure the meta drives an 'advanced' suggestion (8+ stakeholders, Hybrid, regulated, long duration).
  // Then assert:
  //   - a "Suggested" badge (t("en-US","templateSuggested")) appears
  //   - the Full delivery row is preselected (aria-pressed="true")
  // Adjust selectors to the wizard's markup (rows are <button> with the template name).
});
it("sparse meta suggests Minimal (preselected)", async () => {
  // Complete Step 1 with minimal meta → Step 2 → assert the Minimal row is aria-pressed.
});
it("manual pick overrides the suggestion and sticks", async () => {
  // Reach Step 2 (suggestion preselects something), click Blank, assert Blank is aria-pressed and stays
  // after a re-render (e.g. toggle Back/Next).
});
```
> Write these CONCRETELY against the real markup: the template rows are `<button>`s whose accessible name includes `tpl.name` ("Minimal"/"Standard PM"/"Full delivery") and "Blank …". The badge is text `t("en-US","templateSuggested")`. Use `getByRole("button", { name: /Full delivery/ })` and assert `toHaveAttribute("aria-pressed","true")`. The `completeStep1` helper already exists from sub-project #3's tests — reuse it; if it doesn't drive specific meta, extend it to accept overrides or fill the fields directly.

- [ ] **Step 2: Run** the new tests → FAIL.

- [ ] **Step 3: Implement** in `create-project-wizard.tsx`:
  1. Imports: add `useEffect, useMemo, useRef` to the react import (line 21); add `import { suggestTemplate } from "./template-suggest";`.
  2. After the state block (after `const [includeSeed, setIncludeSeed] = useState(false);`):
  ```ts
  const userTouchedTemplateRef = useRef(false);
  const suggestion = useMemo(() => (meta ? suggestTemplate(meta, templates) : null), [meta, templates]);
  ```
  3. Refactor selection so preselect doesn't mark "touched". Split the existing `chooseTemplate`:
  ```ts
  const applyTemplateChoice = (tpl: ProjectTemplate | null) => {
    setSelectedTemplate(tpl);
    setFeatures(tpl ? ALL_MODULE_IDS.filter((id) => tpl.features.includes(id)) : [...ALL_MODULE_IDS]);
    setIncludeSeed(hasSeedContent(tpl));
  };
  const chooseTemplate = (tpl: ProjectTemplate | null) => {
    userTouchedTemplateRef.current = true;
    applyTemplateChoice(tpl);
  };
  ```
  (Keep all existing `chooseTemplate(...)` call sites — they now also set the touched flag, which is correct for user clicks incl. Blank.)
  4. Preselect-once effect (after the handlers):
  ```ts
  useEffect(() => {
    if (step !== 2 || userTouchedTemplateRef.current || selectedTemplate !== null || !suggestion) return;
    const tpl = templates.find((t) => t.id === suggestion.templateId) ?? null;
    if (tpl) applyTemplateChoice(tpl);
  }, [step, suggestion, selectedTemplate, templates]);
  ```
  5. Reason line — render once at the top of Step 2 (above the `<fieldset>`), only when `suggestion` exists:
  ```tsx
  {suggestion && (
    <p className="mb-2 text-xs text-muted-foreground">
      {suggestion.reasons.map((r) => t(lang, r.key, ...(r.args ?? []))).join(" · ")}
      {" → "}
      {t(lang, MODE_LABEL_KEY[suggestion.tier])}
    </p>
  )}
  ```
  6. Badge — inside the row's header `<div className="flex items-center justify-between gap-2">` (next to the mode pill, ~line 207), add before/after it:
  ```tsx
  {suggestion?.templateId === tpl.id && (
    <span className="rounded-full bg-AIPM-dark-blue px-2 py-0.5 text-xs font-semibold text-white">
      {t(lang, "templateSuggested")}
    </span>
  )}
  ```
  (Match the existing pill styling tokens; use a distinct on-palette color so it reads as a badge.)

- [ ] **Step 4: Run** `npx vitest run src/app/create-project-wizard.test.tsx` → PASS. `npm run test:run` → green (update any existing Step-2 test that now sees a preselected template instead of Blank — e.g. project-empty-state/projects-panel tests that asserted Blank was the default selection; they may now find a template preselected. If a test asserted "Blank selected by default", update it to click Blank explicitly or assert the suggestion, since default is now the suggested template). `npx tsc --noEmit` clean. `npm run lint` 0 warnings.

- [ ] **Step 5: Commit**
```bash
git add src/app/create-project-wizard.tsx src/app/create-project-wizard.test.tsx
git commit -m "feat: suggest and preselect a template in the creation wizard"
```

---

## Task 3: Docs + final gates

**Files:** Modify `docs/CODEMAPS/frontend.md`.

- [ ] **Step 1: Docs** — add one row/line under the templates/wizard area: `template-suggest.ts` (pure heuristic — scores ProjectMeta → suggested template, preselected + badged in wizard Step 2). Match the existing doc style.

- [ ] **Step 2: Full gates** — `npm run test:run` + `npx tsc --noEmit` + `npm run lint` + `npm run build` all green (known flakes excepted; re-run isolated to confirm).

- [ ] **Step 3: Commit**
```bash
git add docs/CODEMAPS/frontend.md
git commit -m "docs: document the template suggestion engine"
```

---

## Self-Review notes (for the executor)

- **No version bump** — orchestrator releases after the final review (this is the final sub-project; the release also closes out the 4-part feature).
- **`regulatory` includes `"Not applicable"`** — the regulated signal must exclude it (`isRegulated`). Tested.
- **`products` is a string, not an array** — scale uses `identityCount` only. Don't try to `.length` products.
- **Preselect must not mark "touched"** — `applyTemplateChoice` (preselect) vs `chooseTemplate` (user, sets the ref). A user clicking Blank sets touched → suggestion won't re-preselect. Tested by "manual pick sticks".
- **Existing wizard tests** may have assumed Blank is the default Step-2 selection; the default is now the suggested template. Update those assertions (don't weaken — assert the new preselect, or click Blank explicitly).
- Reuse the `" · "` join precedent for the reason fragments.
