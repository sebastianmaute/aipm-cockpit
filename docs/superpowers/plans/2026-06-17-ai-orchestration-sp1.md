# SP1 — Foundational prompts + per-window "Ask Claude" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one-tap foundational prompts to the AI Assistant and a shared, context-aware "Ask Claude" top-bar button that offers view-specific suggested prompts and runs them in the chat.

**Architecture:** A pure i18n-free prompt catalog (`ask-claude-prompts.ts`) maps `AppView → PromptDef[]` (translation keys only). A new chat-seed channel on `WorkspaceTabContext` (`requestChat`/`pendingChatSeed`/`clearChatSeed`) mirrors the existing `requestOpen` deep-link trio. `ChatPanel` consumes the seed (set input, optionally auto-send) and gains auto-send foundational chips. A new `AskClaudeMenu` header component (mirroring `ExportMenu`) lists prompts for the current view and calls `requestChat(body, true)`.

**Tech Stack:** TypeScript, React 19, forked Next.js, vitest, Playwright (axe), i18n EN/DE parity (tsc-enforced).

**Branch:** `feat-ai-orchestration-sp1` (spec already committed there).

**CI landmines to respect throughout:**
- Lint is `--max-warnings=0`: an unused import/var is FATAL. Re-check after every extract.
- `react-hooks/exhaustive-deps` rejects an `obj.member` dep — hoist to a local const.
- `i18n.ts` (EN) + `i18n.de.ts` (DE) key sets must be identical (tsc enforces). DE file is **CRLF**;
  the Edit tool corrupts umlauts and curls quotes — **edit `i18n.de.ts` via a node UTF-8 write only**,
  matching `\r\n`, and re-verify with grep.
- `Lang` is `"en-US" | "en-GB" | "de"` — never `"en"`. The DE dict is lazy: a test asserting DE
  output must call `loadI18n("de")` in `beforeAll`.
- Palette: only sanctioned AIPM tokens; no off-palette colors/gradients/shadows (check new components by eye).
- axe gate is Playwright-only (vitest never runs it): run the Settings/header axe grep locally before push.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src/app/ask-claude-prompts.ts` | Pure catalog: `PromptDef`, `FOUNDATIONAL_PROMPTS`, `ASK_CLAUDE_PROMPTS`, `promptsForView` | Create |
| `src/app/ask-claude-prompts.test.ts` | Catalog tests + EN/DE key-existence guard | Create |
| `src/app/ask-claude-menu.tsx` | Header popover listing prompts for current view | Create |
| `src/app/ask-claude-menu.test.tsx` | Menu open/sections/pick/a11y tests | Create |
| `src/app/i18n.ts` | EN strings + `TranslationKey` union | Modify |
| `src/app/i18n.de.ts` | DE strings (node UTF-8 write) | Modify |
| `src/app/workspace-tab-context.tsx` | Add chat-seed trio | Modify |
| `src/app/workspace-tab-context.test.tsx` | Seed trio tests | Create (or extend if exists) |
| `src/app/chat-panel.tsx` | `submitPrompt` refactor, seed effect, foundational auto-send chips | Modify |
| `src/app/chat-panel.test.tsx` | Seed/auto-send/chip tests | Modify/extend |
| `src/app/workspace-section.tsx` | Thread `chatSeed`/`onChatSeedConsumed` to ChatPanel | Modify |
| `src/app/app-header.tsx` | Render `AskClaudeMenu` when wired | Modify |
| `src/app/app-header.test.tsx` | Menu-present-when-wired test | Modify/extend |
| `src/app/task-manager.tsx` | Pass `currentView`+`onAskClaude` to AppHeader | Modify |
| `src/app/version.ts`, `CHANGELOG.md` | Release 0.98.0 | Modify |

---

## Task 1: i18n keys (EN + DE)

**Files:**
- Modify: `src/app/i18n.ts`
- Modify: `src/app/i18n.de.ts` (node UTF-8 write — NOT the Edit tool)

All later tasks reference these `TranslationKey` literals; they must exist first so tsc passes.

- [ ] **Step 1: Add the EN strings to `i18n.ts`.** Find the existing `chatPromptStatusUpdate` entry (~line 391) and add the following block immediately after it (inside the EN dictionary object):

```ts
  // SP1 — Ask Claude menu + foundational prompts
  aiAskClaude: "Ask Claude",
  aiAskClaudeOnPage: "On this page",
  aiAskClaudeGeneral: "General",
  // Foundational (universal) prompts
  aiPromptWhatsNextLabel: "What's next?",
  aiPromptWhatsNextBody: "What should I focus on next? Give me the most important open items across the project.",
  aiPromptStatusLabel: "Status overview",
  aiPromptStatusBody: "Give me an overview of the current project status - schedule, risks, and budget health.",
  aiPromptPrioritizeLabel: "Prioritize",
  aiPromptPrioritizeBody: "What single next action should I prioritize right now, and why?",
  // View-specific prompts
  aiPromptDashHealthLabel: "Health summary",
  aiPromptDashHealthBody: "Summarize the overall project health: schedule, budget, and top risks.",
  aiPromptDashRisksLabel: "Timeline risks",
  aiPromptDashRisksBody: "What are the biggest risks to hitting the timeline right now?",
  aiPromptOpenOverdueLabel: "Overdue & blockers",
  aiPromptOpenOverdueBody: "What's overdue and who is blocking it? List the items I should chase today.",
  aiPromptOpenFocusLabel: "Today's focus",
  aiPromptOpenFocusBody: "Which open points should I focus on today given their due dates and priority?",
  aiPromptRaidTopLabel: "Top risks",
  aiPromptRaidTopBody: "Summarize the top risks in the RAID register and flag which ones need escalation.",
  aiPromptRaidOwnerlessLabel: "Missing owners",
  aiPromptRaidOwnerlessBody: "Which RAID items have no owner or are overdue for review?",
  aiPromptChangeDecideLabel: "Pending decisions",
  aiPromptChangeDecideBody: "Which change requests are pending a decision, and what's the impact of each?",
  aiPromptChangeImpactLabel: "Open change impact",
  aiPromptChangeImpactBody: "Summarize the impact of the currently open changes on scope, schedule, and budget.",
  aiPromptMsAtRiskLabel: "At-risk milestones",
  aiPromptMsAtRiskBody: "Which milestones are at risk of slipping, and why?",
  aiPromptMsUpcomingLabel: "Next 2 weeks",
  aiPromptMsUpcomingBody: "What milestones are due in the next two weeks and are we on track?",
  aiPromptStkUpdateLabel: "Who needs an update",
  aiPromptStkUpdateBody: "Which stakeholders are due for a communication or update?",
  aiPromptStkGapsLabel: "Engagement gaps",
  aiPromptStkGapsBody: "Where are the engagement gaps across our stakeholders?",
  aiPromptBudCpiLabel: "On track? (CPI)",
  aiPromptBudCpiBody: "Are we on track against budget? Summarize the cost performance and any overspend.",
  aiPromptBudTrendLabel: "Spend trend",
  aiPromptBudTrendBody: "Where is spend trending over or under, and what's driving it?",
  aiPromptGanttCritLabel: "Critical path",
  aiPromptGanttCritBody: "What are the critical-path risks in the current schedule?",
  aiPromptGanttSlackLabel: "No slack",
  aiPromptGanttSlackBody: "Which tasks have little or no slack and could delay the project?",
  aiPromptResOverloadLabel: "Overloaded",
  aiPromptResOverloadBody: "Who is overloaded right now, and how should I rebalance the work?",
  aiPromptResGapsLabel: "Capacity gaps",
  aiPromptResGapsBody: "Where are the upcoming capacity gaps in the team?",
  aiPromptDocMissingLabel: "Missing or stale",
  aiPromptDocMissingBody: "What documents are missing or look stale and should be updated?",
  aiPromptDocSummaryLabel: "Summarize set",
  aiPromptDocSummaryBody: "Summarize the current document set and how it's organized.",
  aiPromptRepDraftLabel: "Draft status report",
  aiPromptRepDraftBody: "Draft a concise status report for stakeholders based on the current project state.",
  aiPromptRepStandoutLabel: "What stands out",
  aiPromptRepStandoutBody: "What stands out this reporting period - wins, risks, and asks?",
  aiPromptActExplainLabel: "Explain top actions",
  aiPromptActExplainBody: "Explain the top suggested actions and why they matter.",
  aiPromptActFirstLabel: "Do first",
  aiPromptActFirstBody: "Of the suggested actions, which should I do first?",
  aiPromptTrendReadLabel: "Read the trend",
  aiPromptTrendReadBody: "What is the schedule and budget trend telling me about where we're heading?",
  aiPromptTrendActLabel: "Act on trend",
  aiPromptTrendActBody: "Given the current trends, what should I do to stay on track?",
  versionHighlightAiAskClaude: "Ask Claude about any view: one-tap foundational prompts and view-specific suggestions in the AI Assistant.",
```

- [ ] **Step 2: Add the identical DE keys to `i18n.de.ts` via a node UTF-8 write.** Do NOT use the Edit tool (it corrupts umlauts and curls quotes). The file is CRLF. Write a temporary node script (or run `node -e`) that reads the file, inserts the block after the DE `chatPromptStatusUpdate` line, and writes back as UTF-8. Use real umlauts (ä/ö/ü/ß). The block to insert (DE):

```ts
  aiAskClaude: "Claude fragen",
  aiAskClaudeOnPage: "Auf dieser Seite",
  aiAskClaudeGeneral: "Allgemein",
  aiPromptWhatsNextLabel: "Was kommt als Nächstes?",
  aiPromptWhatsNextBody: "Worauf sollte ich mich als Nächstes konzentrieren? Nenne mir die wichtigsten offenen Punkte im Projekt.",
  aiPromptStatusLabel: "Statusüberblick",
  aiPromptStatusBody: "Gib mir einen Überblick über den aktuellen Projektstatus - Zeitplan, Risiken und Budget.",
  aiPromptPrioritizeLabel: "Priorisieren",
  aiPromptPrioritizeBody: "Welche einzelne nächste Maßnahme sollte ich jetzt priorisieren, und warum?",
  aiPromptDashHealthLabel: "Gesundheitsüberblick",
  aiPromptDashHealthBody: "Fasse die Gesamtsituation des Projekts zusammen: Zeitplan, Budget und größte Risiken.",
  aiPromptDashRisksLabel: "Zeitplan-Risiken",
  aiPromptDashRisksBody: "Was sind aktuell die größten Risiken für die Einhaltung des Zeitplans?",
  aiPromptOpenOverdueLabel: "Überfällig & Blocker",
  aiPromptOpenOverdueBody: "Was ist überfällig und wer blockiert? Liste die Punkte auf, die ich heute nachverfolgen sollte.",
  aiPromptOpenFocusLabel: "Fokus für heute",
  aiPromptOpenFocusBody: "Auf welche offenen Punkte sollte ich mich heute angesichts Fälligkeit und Priorität konzentrieren?",
  aiPromptRaidTopLabel: "Größte Risiken",
  aiPromptRaidTopBody: "Fasse die größten Risiken im RAID-Register zusammen und kennzeichne, welche eskaliert werden müssen.",
  aiPromptRaidOwnerlessLabel: "Fehlende Verantwortliche",
  aiPromptRaidOwnerlessBody: "Welche RAID-Einträge haben keinen Verantwortlichen oder sind überfällig für eine Überprüfung?",
  aiPromptChangeDecideLabel: "Offene Entscheidungen",
  aiPromptChangeDecideBody: "Welche Änderungsanträge warten auf eine Entscheidung, und welche Auswirkungen hat jeder?",
  aiPromptChangeImpactLabel: "Auswirkung offener Änderungen",
  aiPromptChangeImpactBody: "Fasse die Auswirkungen der aktuell offenen Änderungen auf Umfang, Zeitplan und Budget zusammen.",
  aiPromptMsAtRiskLabel: "Gefährdete Meilensteine",
  aiPromptMsAtRiskBody: "Welche Meilensteine drohen sich zu verschieben, und warum?",
  aiPromptMsUpcomingLabel: "Nächste 2 Wochen",
  aiPromptMsUpcomingBody: "Welche Meilensteine sind in den nächsten zwei Wochen fällig und sind wir im Plan?",
  aiPromptStkUpdateLabel: "Wer braucht ein Update",
  aiPromptStkUpdateBody: "Welche Stakeholder sind für eine Kommunikation oder ein Update fällig?",
  aiPromptStkGapsLabel: "Engagement-Lücken",
  aiPromptStkGapsBody: "Wo gibt es Lücken im Engagement unserer Stakeholder?",
  aiPromptBudCpiLabel: "Im Plan? (CPI)",
  aiPromptBudCpiBody: "Liegen wir im Budget? Fasse die Kostenentwicklung und etwaige Überschreitungen zusammen.",
  aiPromptBudTrendLabel: "Ausgabentrend",
  aiPromptBudTrendBody: "Wo tendieren die Ausgaben über oder unter Plan, und was treibt das?",
  aiPromptGanttCritLabel: "Kritischer Pfad",
  aiPromptGanttCritBody: "Was sind die Risiken auf dem kritischen Pfad im aktuellen Zeitplan?",
  aiPromptGanttSlackLabel: "Kein Puffer",
  aiPromptGanttSlackBody: "Welche Aufgaben haben wenig oder keinen Puffer und könnten das Projekt verzögern?",
  aiPromptResOverloadLabel: "Überlastet",
  aiPromptResOverloadBody: "Wer ist aktuell überlastet, und wie sollte ich die Arbeit neu verteilen?",
  aiPromptResGapsLabel: "Kapazitätslücken",
  aiPromptResGapsBody: "Wo gibt es im Team bevorstehende Kapazitätslücken?",
  aiPromptDocMissingLabel: "Fehlend oder veraltet",
  aiPromptDocMissingBody: "Welche Dokumente fehlen oder wirken veraltet und sollten aktualisiert werden?",
  aiPromptDocSummaryLabel: "Dokumente zusammenfassen",
  aiPromptDocSummaryBody: "Fasse den aktuellen Dokumentenbestand und seine Organisation zusammen.",
  aiPromptRepDraftLabel: "Statusbericht entwerfen",
  aiPromptRepDraftBody: "Entwirf einen knappen Statusbericht für Stakeholder auf Basis des aktuellen Projektstands.",
  aiPromptRepStandoutLabel: "Was sticht heraus",
  aiPromptRepStandoutBody: "Was sticht in dieser Berichtsperiode heraus - Erfolge, Risiken und offene Punkte?",
  aiPromptActExplainLabel: "Top-Maßnahmen erklären",
  aiPromptActExplainBody: "Erkläre die wichtigsten vorgeschlagenen Maßnahmen und warum sie wichtig sind.",
  aiPromptActFirstLabel: "Zuerst erledigen",
  aiPromptActFirstBody: "Welche der vorgeschlagenen Maßnahmen sollte ich zuerst erledigen?",
  aiPromptTrendReadLabel: "Trend deuten",
  aiPromptTrendReadBody: "Was sagt mir der Zeitplan- und Budgettrend darüber, wohin wir steuern?",
  aiPromptTrendActLabel: "Auf Trend reagieren",
  aiPromptTrendActBody: "Was sollte ich angesichts der aktuellen Trends tun, um im Plan zu bleiben?",
  versionHighlightAiAskClaude: "Claude zu jeder Ansicht fragen: Grundlegende Prompts mit einem Tipp und ansichtsspezifische Vorschläge im KI-Assistenten.",
```

- [ ] **Step 3: Verify EN/DE parity + umlauts.** Run:

```bash
npx tsc --noEmit
```
Expected: PASS (no "missing key" parity errors). Then verify the DE umlauts survived:
```bash
grep -c "Nächstes\|größten\|überfällig\|Kapazitätslücken" src/app/i18n.de.ts
```
Expected: a non-zero count (umlauts intact, not `fuer`/`groessten`). Also confirm the `i18n-encoding` test passes:
```bash
npx vitest run i18n-encoding
```
Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "i18n: SP1 Ask-Claude menu + foundational/view prompt strings (EN+DE)"
```

---

## Task 2: Pure prompt catalog

**Files:**
- Create: `src/app/ask-claude-prompts.ts`
- Test: `src/app/ask-claude-prompts.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/app/ask-claude-prompts.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import {
  promptsForView,
  FOUNDATIONAL_PROMPTS,
  ASK_CLAUDE_PROMPTS,
  type PromptDef,
} from "./ask-claude-prompts";
import { t, loadI18n } from "./i18n";

describe("ask-claude-prompts", () => {
  beforeAll(async () => {
    await loadI18n("de");
  });

  it("returns view-specific on-page prompts plus the foundational general set", () => {
    const { onPage, general } = promptsForView("raid");
    expect(general).toEqual(FOUNDATIONAL_PROMPTS);
    expect(onPage.length).toBeGreaterThan(0);
    expect(onPage).toEqual(ASK_CLAUDE_PROMPTS.raid);
  });

  it("falls back to foundational-only for a view with no curated set", () => {
    const { onPage, general } = promptsForView("edit");
    expect(onPage).toEqual([]);
    expect(general).toEqual(FOUNDATIONAL_PROMPTS);
  });

  it("every label/body key resolves in EN and DE (no missing keys)", () => {
    const all: PromptDef[] = [
      ...FOUNDATIONAL_PROMPTS,
      ...Object.values(ASK_CLAUDE_PROMPTS).flat().filter(Boolean) as PromptDef[],
    ];
    for (const def of all) {
      // t() returns the resolved string (a truly missing key throws on the
      // internal .replace of undefined). Assert real, non-key text in both langs.
      for (const lang of ["en-US", "de"] as const) {
        const label = t(lang, def.labelKey);
        const body = t(lang, def.bodyKey);
        expect(label).toBeTruthy();
        expect(label).not.toBe(def.labelKey);
        expect(body).toBeTruthy();
        expect(body).not.toBe(def.bodyKey);
      }
    }
  });
});
```

Note: the EN dictionary in `i18n.ts` is a module-local `const enUS` (NOT exported), so the test
relies only on `t()` — do not import the dict object. `t(lang, key)` resolves to the string; a
missing key would throw, which the test would surface as a failure.

- [ ] **Step 2: Run the test to verify it fails.**

```bash
npx vitest run ask-claude-prompts
```
Expected: FAIL ("Cannot find module './ask-claude-prompts'").

- [ ] **Step 3: Write the implementation.** Create `src/app/ask-claude-prompts.ts`:

```ts
// Pure, i18n-free catalog of suggested AI-assistant prompts. Holds translation
// KEYS only (the surface resolves them via t(lang, ...)), keeping this engine
// free of React and i18n. Consumed by the Ask-Claude header menu and the chat
// empty-state foundational chips.
import type { TranslationKey } from "./i18n";
import type { AppView } from "./nav-config";

export interface PromptDef {
  /** Short label shown on the chip / menu item. */
  labelKey: TranslationKey;
  /** Full prompt text sent to Claude as the user message. */
  bodyKey: TranslationKey;
}

/** The universal foundational prompts. Always offered (chat chips + menu "General"). */
export const FOUNDATIONAL_PROMPTS: PromptDef[] = [
  { labelKey: "aiPromptWhatsNextLabel", bodyKey: "aiPromptWhatsNextBody" },
  { labelKey: "aiPromptStatusLabel", bodyKey: "aiPromptStatusBody" },
  { labelKey: "aiPromptPrioritizeLabel", bodyKey: "aiPromptPrioritizeBody" },
];

/** View-specific suggestions. A view absent here has no "on this page" set;
 *  the menu still shows the foundational prompts. Keys only — surface translates. */
export const ASK_CLAUDE_PROMPTS: Partial<Record<AppView, PromptDef[]>> = {
  dashboard: [
    { labelKey: "aiPromptDashHealthLabel", bodyKey: "aiPromptDashHealthBody" },
    { labelKey: "aiPromptDashRisksLabel", bodyKey: "aiPromptDashRisksBody" },
  ],
  "open-points": [
    { labelKey: "aiPromptOpenOverdueLabel", bodyKey: "aiPromptOpenOverdueBody" },
    { labelKey: "aiPromptOpenFocusLabel", bodyKey: "aiPromptOpenFocusBody" },
  ],
  raid: [
    { labelKey: "aiPromptRaidTopLabel", bodyKey: "aiPromptRaidTopBody" },
    { labelKey: "aiPromptRaidOwnerlessLabel", bodyKey: "aiPromptRaidOwnerlessBody" },
  ],
  changes: [
    { labelKey: "aiPromptChangeDecideLabel", bodyKey: "aiPromptChangeDecideBody" },
    { labelKey: "aiPromptChangeImpactLabel", bodyKey: "aiPromptChangeImpactBody" },
  ],
  milestones: [
    { labelKey: "aiPromptMsAtRiskLabel", bodyKey: "aiPromptMsAtRiskBody" },
    { labelKey: "aiPromptMsUpcomingLabel", bodyKey: "aiPromptMsUpcomingBody" },
  ],
  stakeholders: [
    { labelKey: "aiPromptStkUpdateLabel", bodyKey: "aiPromptStkUpdateBody" },
    { labelKey: "aiPromptStkGapsLabel", bodyKey: "aiPromptStkGapsBody" },
  ],
  budget: [
    { labelKey: "aiPromptBudCpiLabel", bodyKey: "aiPromptBudCpiBody" },
    { labelKey: "aiPromptBudTrendLabel", bodyKey: "aiPromptBudTrendBody" },
  ],
  gantt: [
    { labelKey: "aiPromptGanttCritLabel", bodyKey: "aiPromptGanttCritBody" },
    { labelKey: "aiPromptGanttSlackLabel", bodyKey: "aiPromptGanttSlackBody" },
  ],
  resources: [
    { labelKey: "aiPromptResOverloadLabel", bodyKey: "aiPromptResOverloadBody" },
    { labelKey: "aiPromptResGapsLabel", bodyKey: "aiPromptResGapsBody" },
  ],
  documents: [
    { labelKey: "aiPromptDocMissingLabel", bodyKey: "aiPromptDocMissingBody" },
    { labelKey: "aiPromptDocSummaryLabel", bodyKey: "aiPromptDocSummaryBody" },
  ],
  reports: [
    { labelKey: "aiPromptRepDraftLabel", bodyKey: "aiPromptRepDraftBody" },
    { labelKey: "aiPromptRepStandoutLabel", bodyKey: "aiPromptRepStandoutBody" },
  ],
  actions: [
    { labelKey: "aiPromptActExplainLabel", bodyKey: "aiPromptActExplainBody" },
    { labelKey: "aiPromptActFirstLabel", bodyKey: "aiPromptActFirstBody" },
  ],
  trends: [
    { labelKey: "aiPromptTrendReadLabel", bodyKey: "aiPromptTrendReadBody" },
    { labelKey: "aiPromptTrendActLabel", bodyKey: "aiPromptTrendActBody" },
  ],
};

/** What the menu/UI shows for a view: on-page suggestions + the always-on general set. */
export function promptsForView(view: AppView): { onPage: PromptDef[]; general: PromptDef[] } {
  return { onPage: ASK_CLAUDE_PROMPTS[view] ?? [], general: FOUNDATIONAL_PROMPTS };
}
```

- [ ] **Step 4: Run the test to verify it passes.**

```bash
npx vitest run ask-claude-prompts
```
Expected: PASS (all 3 tests).

- [ ] **Step 5: Lint + commit.**

```bash
npm run lint
git add src/app/ask-claude-prompts.ts src/app/ask-claude-prompts.test.ts
git commit -m "feat: pure Ask-Claude prompt catalog (foundational + per-view)"
```

---

## Task 3: Chat-seed channel on WorkspaceTabContext

**Files:**
- Modify: `src/app/workspace-tab-context.tsx`
- Test: `src/app/workspace-tab-context.test.tsx` (create; if one exists, extend it)

- [ ] **Step 1: Write the failing test.** Create `src/app/workspace-tab-context.test.tsx`:

```tsx
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { WorkspaceTabProvider, useWorkspaceTab } from "./workspace-tab-context";

afterEach(cleanup);

function Probe() {
  const { activeTab, pendingChatSeed, requestChat, clearChatSeed } = useWorkspaceTab();
  return (
    <div>
      <span data-testid="tab">{activeTab}</span>
      <span data-testid="seed">{pendingChatSeed ? `${pendingChatSeed.prompt}|${pendingChatSeed.autoSend}` : "none"}</span>
      <button onClick={() => requestChat("Summarize risks", true)}>req</button>
      <button onClick={() => clearChatSeed()}>clear</button>
    </div>
  );
}

describe("workspace-tab-context chat seed", () => {
  it("requestChat switches to the chat tab and stores the seed", () => {
    render(<WorkspaceTabProvider><Probe /></WorkspaceTabProvider>);
    act(() => { screen.getByText("req").click(); });
    expect(screen.getByTestId("tab").textContent).toBe("chat");
    expect(screen.getByTestId("seed").textContent).toBe("Summarize risks|true");
  });

  it("clearChatSeed nulls the seed", () => {
    render(<WorkspaceTabProvider><Probe /></WorkspaceTabProvider>);
    act(() => { screen.getByText("req").click(); });
    act(() => { screen.getByText("clear").click(); });
    expect(screen.getByTestId("seed").textContent).toBe("none");
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

```bash
npx vitest run workspace-tab-context
```
Expected: FAIL (`requestChat`/`pendingChatSeed` undefined → TypeError).

- [ ] **Step 3: Implement the seed trio in `src/app/workspace-tab-context.tsx`.** Update the interface and provider:

In the `WorkspaceTabContextValue` interface, add after `clearPendingOpen`:
```ts
  pendingChatSeed: { prompt: string; autoSend: boolean } | null;
  requestChat: (prompt: string, autoSend: boolean) => void;
  clearChatSeed: () => void;
```

In `WorkspaceTabProvider`, after the `clearPendingOpen` declaration, add:
```ts
  const [pendingChatSeed, setPendingChatSeed] = useState<{ prompt: string; autoSend: boolean } | null>(null);
  const requestChat = useCallback((prompt: string, autoSend: boolean) => {
    setActiveTab("chat");
    setPendingChatSeed({ prompt, autoSend });
    // No hash write: chat carries no item id (unlike requestOpen).
  }, []);
  const clearChatSeed = useCallback(() => setPendingChatSeed(null), []);
```

And extend the provider `value` object to include `pendingChatSeed, requestChat, clearChatSeed`:
```ts
    <WorkspaceTabContext.Provider value={{ activeTab, setActiveTab, isPopout, pendingOpen, requestOpen, clearPendingOpen, pendingChatSeed, requestChat, clearChatSeed }}>
```

- [ ] **Step 4: Run to verify it passes.**

```bash
npx vitest run workspace-tab-context
```
Expected: PASS (both tests).

- [ ] **Step 5: Lint + commit.**

```bash
npm run lint
git add src/app/workspace-tab-context.tsx src/app/workspace-tab-context.test.tsx
git commit -m "feat: chat-seed channel on WorkspaceTabContext (requestChat/pendingChatSeed)"
```

---

## Task 4: Chat panel — submitPrompt refactor, seed effect, foundational auto-send chips

**Files:**
- Modify: `src/app/chat-panel.tsx`
- Modify: `src/app/workspace-section.tsx` (thread the seed)
- Test: `src/app/chat-panel.test.tsx` (extend)

- [ ] **Step 1: Write the failing tests.** Add to `src/app/chat-panel.test.tsx` (mirror the existing
test setup there — it already mocks `fetch` and renders `ChatPanel`; reuse its helpers/props). Add a
`describe("SP1 seed + foundational chips")`:

```tsx
// Assumes the existing test file's render helper provides a dispatcher with a
// getSnapshot() stub and an ai config with apiKey set + consentAccepted.
// fetchMock returns a minimal non-tool assistant message.

it("seeds the input from chatSeed without sending when autoSend is false", () => {
  const onConsumed = vi.fn();
  renderChat({ chatSeed: { prompt: "Summarize risks", autoSend: false }, onChatSeedConsumed: onConsumed });
  expect(screen.getByPlaceholderText(/.*/)).toHaveValue("Summarize risks"); // input textarea
  expect(fetchMock).not.toHaveBeenCalled();
  expect(onConsumed).toHaveBeenCalledTimes(1);
});

it("auto-sends when chatSeed.autoSend is true and not blocked", async () => {
  const onConsumed = vi.fn();
  renderChat({ chatSeed: { prompt: "What's next?", autoSend: true }, onChatSeedConsumed: onConsumed });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(onConsumed).toHaveBeenCalledTimes(1);
});

it("does NOT send an autoSend seed when the api key is missing (seeds input only)", () => {
  const onConsumed = vi.fn();
  renderChat({ ai: aiNoKey, chatSeed: { prompt: "What's next?", autoSend: true }, onChatSeedConsumed: onConsumed });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(onConsumed).toHaveBeenCalledTimes(1);
});

it("a foundational chip auto-sends on click", async () => {
  renderChat({});
  // Foundational chips carry the foundational labels; click the first one.
  screen.getByRole("button", { name: enLabel("aiPromptWhatsNextLabel") }).click();
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
});

it("an existing chip fills the input without sending", () => {
  renderChat({});
  screen.getByRole("button", { name: enLabel("chatPromptUpdate") }).click();
  expect(fetchMock).not.toHaveBeenCalled();
});
```

Adapt `renderChat`, `fetchMock`, `aiNoKey`, and `enLabel` to the existing test file's actual
helpers (read the top of `chat-panel.test.tsx` first and reuse what's there; do not invent a parallel
harness). The behavioral assertions above are what matter.

- [ ] **Step 2: Run to verify they fail.**

```bash
npx vitest run chat-panel
```
Expected: FAIL (ChatPanel doesn't accept `chatSeed`/`onChatSeedConsumed`; foundational chips absent).

- [ ] **Step 3: Implement in `src/app/chat-panel.tsx`.**

(a) Import the catalog at the top (next to the existing `operating-guide` import):
```ts
import { FOUNDATIONAL_PROMPTS } from "./ask-claude-prompts";
```

(b) Replace the `PromptChip`/`PROMPT_CHIPS` block (lines 8-15) with a model that carries an
`autoSend` flag and folds in the foundational prompts:
```ts
type PromptChip = { labelKey: TranslationKey; bodyKey: TranslationKey; autoSend: boolean };

const PROMPT_CHIPS: PromptChip[] = [
  { labelKey: "chatPromptUpdate", bodyKey: "chatPromptUpdateBody", autoSend: false },
  { labelKey: "chatPromptOverdue", bodyKey: "chatPromptOverdue", autoSend: false },
  { labelKey: "chatPromptAtRisk", bodyKey: "chatPromptAtRisk", autoSend: false },
  { labelKey: "chatPromptStatusUpdate", bodyKey: "chatPromptStatusUpdate", autoSend: false },
  ...FOUNDATIONAL_PROMPTS.map((p) => ({ ...p, autoSend: true })),
];
```

(c) Thread the new props through `ChatPanelImpl` and `ChatPanelInner`. Add to both prop type
objects (alongside `guides`/`guidesReady`):
```ts
  chatSeed?: { prompt: string; autoSend: boolean } | null;
  onChatSeedConsumed?: () => void;
```
…and pass `chatSeed`/`onChatSeedConsumed` from `ChatPanelImpl` into `<ChatPanelInner .../>`.
Default them: `chatSeed = null`, `onChatSeedConsumed` optional.

(d) Refactor `sendMessage` to `submitPrompt(textArg?: string)` — change the first lines from:
```ts
  async function sendMessage() {
    const text = input.trim().slice(0, CHAT_MESSAGE_MAX);
    if (!text || busy || guidesPending) return;
```
to:
```ts
  async function submitPrompt(textArg?: string) {
    const text = (textArg ?? input).trim().slice(0, CHAT_MESSAGE_MAX);
    if (!text || busy || guidesPending) return;
```
The rest of the function body is unchanged. Update the two call sites:
- `onKeyDown`: `sendMessage();` → `submitPrompt();`
- the Send button `onClick={sendMessage}` → `onClick={() => submitPrompt()}`.

(e) Add the seed effect. Capture the blocking flags in a ref so the effect can depend only on
`chatSeed` (satisfies `react-hooks/exhaustive-deps` without re-firing on every keystroke). Near the
other refs:
```ts
  const sendGateRef = useRef({ blocked: true, submit: (_t?: string) => {} });
  sendGateRef.current = {
    blocked: guidesPending || apiKeyMissing || busy,
    submit: submitPrompt,
  };
```
Note: `apiKeyMissing` is computed later in the component (`const apiKeyMissing = !ai.apiKey.trim();`).
Hoist that `const apiKeyMissing` line ABOVE this ref assignment so it's in scope. Then add the effect:
```ts
  useEffect(() => {
    if (!chatSeed) return;
    setInput(chatSeed.prompt);
    if (chatSeed.autoSend && !sendGateRef.current.blocked) {
      sendGateRef.current.submit(chatSeed.prompt);
    }
    onChatSeedConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatSeed]);
```

(f) The chip `onClick` now branches on `autoSend`:
```tsx
                      onClick={() =>
                        chip.autoSend
                          ? submitPrompt(t(lang, chip.bodyKey))
                          : setInput(t(lang, chip.bodyKey))
                      }
```
Leave the rest of the chip markup (classes, key, label) unchanged. Each chip's accessible name is its
label text (already row-unique across the 7 distinct labels).

- [ ] **Step 4: Thread the seed in `src/app/workspace-section.tsx`.** In the component that renders
`<ChatPanel .../>` (the `panel-chat` block, ~line 528): pull the seed from the tab context — extend
the existing `useWorkspaceTab()` destructure (line 310) to include `pendingChatSeed, clearChatSeed`:
```ts
  const { activeTab, setActiveTab, isPopout, pendingChatSeed, clearChatSeed } = useWorkspaceTab();
```
Then pass to `<ChatPanel>`:
```tsx
            chatSeed={pendingChatSeed}
            onChatSeedConsumed={clearChatSeed}
```
(`clearChatSeed` is a stable `useCallback`, so the memoized ChatPanel won't thrash.)

- [ ] **Step 5: Run the tests to verify they pass.**

```bash
npx vitest run chat-panel
```
Expected: PASS (new SP1 tests + existing chat-panel tests still green).

- [ ] **Step 6: Lint + commit.**

```bash
npm run lint
git add src/app/chat-panel.tsx src/app/workspace-section.tsx src/app/chat-panel.test.tsx
git commit -m "feat: chat seed consumption + auto-send foundational chips"
```

---

## Task 5: Ask-Claude header menu component

**Files:**
- Create: `src/app/ask-claude-menu.tsx`
- Test: `src/app/ask-claude-menu.test.tsx`

Mirror `src/app/export-menu.tsx` exactly for the open/close/outside-click/Escape pattern
(`role="dialog"` popover, `mousedown`+`keydown` document listeners while open). That is the
established, axe-clean header-menu convention in this codebase.

- [ ] **Step 1: Write the failing test.** Create `src/app/ask-claude-menu.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { AskClaudeMenu } from "./ask-claude-menu";
import { t } from "./i18n";

afterEach(cleanup);

describe("AskClaudeMenu", () => {
  it("trigger is labelled and advertises a popup", () => {
    render(<AskClaudeMenu lang="en-US" currentView="raid" onAsk={() => {}} />);
    const trigger = screen.getByRole("button", { name: t("en-US", "aiAskClaude") });
    expect(trigger).toHaveAttribute("aria-haspopup");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("opens to show on-page (RAID) and general sections", () => {
    render(<AskClaudeMenu lang="en-US" currentView="raid" onAsk={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "aiAskClaude") }));
    expect(screen.getByText(t("en-US", "aiAskClaudeOnPage"))).toBeTruthy();
    expect(screen.getByText(t("en-US", "aiAskClaudeGeneral"))).toBeTruthy();
    expect(screen.getByRole("button", { name: t("en-US", "aiPromptRaidTopLabel") })).toBeTruthy();
    expect(screen.getByRole("button", { name: t("en-US", "aiPromptWhatsNextLabel") })).toBeTruthy();
  });

  it("picking a prompt calls onAsk with the translated body and closes", () => {
    const onAsk = vi.fn();
    render(<AskClaudeMenu lang="en-US" currentView="raid" onAsk={onAsk} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "aiAskClaude") }));
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "aiPromptRaidTopLabel") }));
    expect(onAsk).toHaveBeenCalledWith(t("en-US", "aiPromptRaidTopBody"));
    expect(screen.queryByText(t("en-US", "aiAskClaudeGeneral"))).toBeNull();
  });

  it("omits the on-page section when the view has no curated prompts", () => {
    render(<AskClaudeMenu lang="en-US" currentView="edit" onAsk={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "aiAskClaude") }));
    expect(screen.queryByText(t("en-US", "aiAskClaudeOnPage"))).toBeNull();
    expect(screen.getByText(t("en-US", "aiAskClaudeGeneral"))).toBeTruthy();
  });

  it("Escape closes the menu", () => {
    render(<AskClaudeMenu lang="en-US" currentView="raid" onAsk={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "aiAskClaude") }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText(t("en-US", "aiAskClaudeGeneral"))).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

```bash
npx vitest run ask-claude-menu
```
Expected: FAIL ("Cannot find module './ask-claude-menu'").

- [ ] **Step 3: Implement `src/app/ask-claude-menu.tsx`:**

```tsx
"use client";

// Header dropdown that offers AI-assistant prompts for the current view. Same
// open/close/outside-click/Escape pattern as ExportMenu. Picking a prompt calls
// onAsk(promptBody) — wired upstream to requestChat(body, true), which switches
// to the chat tab and auto-sends.
import { useEffect, useRef, useState } from "react";
import { type Lang, t } from "./i18n";
import type { AppView } from "./nav-config";
import { promptsForView, type PromptDef } from "./ask-claude-prompts";

export function AskClaudeMenu({
  lang,
  currentView,
  onAsk,
}: {
  lang: Lang;
  currentView: AppView;
  onAsk: (promptBody: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const { onPage, general } = promptsForView(currentView);

  function pick(def: PromptDef) {
    setOpen(false);
    onAsk(t(lang, def.bodyKey));
  }

  function Section({ titleKey, items }: { titleKey: Parameters<typeof t>[1]; items: PromptDef[] }) {
    return (
      <div className="mb-1 last:mb-0">
        <h3 className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t(lang, titleKey)}
        </h3>
        <ul className="space-y-0.5">
          {items.map((def) => (
            <li key={def.labelKey}>
              <button
                type="button"
                onClick={() => pick(def)}
                className="w-full rounded-md px-2.5 py-1.5 text-left text-sm text-AIPM-dark-blue hover:bg-surface-muted dark:text-AIPM-light-grey"
              >
                {t(lang, def.labelKey)}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t(lang, "aiAskClaude")}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={t(lang, "aiAskClaude")}
        className="rounded-md p-2 text-muted-foreground hover:bg-surface-muted hover:text-AIPM-dark-blue focus:outline-none focus:ring-2 focus:ring-AIPM-green dark:hover:text-AIPM-light-grey"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-5 w-5">
          {/* Sparkle / assistant glyph. */}
          <path d="M10 1.5l1.6 4.3 4.3 1.6-4.3 1.6L10 13.3 8.4 9 4.1 7.4l4.3-1.6L10 1.5zM15.5 12l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z" />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t(lang, "aiAskClaude")}
          className="absolute right-0 top-full z-40 mt-2 w-72 overflow-y-auto rounded-lg border border-line bg-surface p-3"
        >
          {onPage.length > 0 && <Section titleKey="aiAskClaudeOnPage" items={onPage} />}
          <Section titleKey="aiAskClaudeGeneral" items={general} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes.**

```bash
npx vitest run ask-claude-menu
```
Expected: PASS (all 5 tests).

- [ ] **Step 5: Lint + commit.**

```bash
npm run lint
git add src/app/ask-claude-menu.tsx src/app/ask-claude-menu.test.tsx
git commit -m "feat: Ask-Claude header menu (per-view + general prompts)"
```

---

## Task 6: Wire the menu into the header + task-manager

**Files:**
- Modify: `src/app/app-header.tsx`
- Modify: `src/app/task-manager.tsx`
- Test: `src/app/app-header.test.tsx` (extend)

- [ ] **Step 1: Write the failing test.** Add to `src/app/app-header.test.tsx` (reuse its existing
render helper / default props — read the top of the file first):

```tsx
it("renders the Ask-Claude menu when currentView and onAskClaude are provided", () => {
  renderHeader({ currentView: "raid", onAskClaude: vi.fn() });
  expect(screen.getByRole("button", { name: t("en-US", "aiAskClaude") })).toBeTruthy();
});

it("omits the Ask-Claude menu when not wired", () => {
  renderHeader({});
  expect(screen.queryByRole("button", { name: t("en-US", "aiAskClaude") })).toBeNull();
});
```

Adapt `renderHeader` to the file's existing helper (it already supplies the many required AppHeader
props). If there is no helper, build minimal valid props from `AppHeaderProps`.

- [ ] **Step 2: Run to verify it fails.**

```bash
npx vitest run app-header
```
Expected: FAIL (AppHeader rejects `currentView`/`onAskClaude`; menu absent).

- [ ] **Step 3: Implement in `src/app/app-header.tsx`.**

(a) Import at the top:
```ts
import { AskClaudeMenu } from "./ask-claude-menu";
import type { AppView } from "./nav-config";
```

(b) Add to `AppHeaderProps`:
```ts
  /** Current view — drives the Ask-Claude menu's per-view suggestions. */
  currentView?: AppView;
  /** Picking an Ask-Claude prompt — wired to requestChat(body, true). */
  onAskClaude?: (promptBody: string) => void;
```

(c) Destructure `currentView, onAskClaude` in the component signature (next to `onOpenAiAssistant`).

(d) Render the menu inside the icon-button row, immediately before the `onOpenAiAssistant` button
(so the AI cluster reads Ask-Claude → open-assistant). Guard on both props:
```tsx
          {currentView && onAskClaude && (
            <AskClaudeMenu lang={lang} currentView={currentView} onAsk={onAskClaude} />
          )}
```

- [ ] **Step 4: Wire `src/app/task-manager.tsx`.**
- Add `requestChat` to the `useWorkspaceTab()` destructure (line 161):
```ts
  const { isPopout, activeTab, setActiveTab, requestOpen, pendingOpen, clearPendingOpen, requestChat } = useWorkspaceTab();
```
- At the `<AppHeader ...>` render site (~line 1900), add the two props:
```tsx
      currentView={activeTab}
      onAskClaude={(body) => requestChat(body, true)}
```

- [ ] **Step 5: Run the tests to verify they pass.**

```bash
npx vitest run app-header
```
Expected: PASS.

- [ ] **Step 6: Lint + commit.**

```bash
npm run lint
git add src/app/app-header.tsx src/app/task-manager.tsx src/app/app-header.test.tsx
git commit -m "feat: wire Ask-Claude menu into header (current view + requestChat)"
```

---

## Task 7: Release + full verification

**Files:**
- Modify: `src/app/version.ts`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Confirm the highlight key is registered.** Open `src/app/version.ts`, find
`APP_HIGHLIGHT_KEYS`, and append `"versionHighlightAiAskClaude"` to the end of the array. Then in
`version.ts`: set `APP_VERSION = "0.98.0"`, `APP_BUILD_DATE = "2026-06-17"` (with the trailing
`// 0.98.0 …` comment), and `APP_MILESTONE` to the next unused sci-fi/fantasy author codename.
Suggested: `"Kress"` (Nancy Kress) — first verify it's unused with
`grep -ric "kress" CHANGELOG.md src/app/i18n.ts src/app/version.ts` (expect 0); if taken, pick
another unused author (e.g. Pohl, Brin, Haldeman). Update the `APP_MILESTONE` doc-comment's
`"Gaiman"` reference to match. Do NOT reuse "Atwood" (already referenced in the CHANGELOG).

- [ ] **Step 2: Add a CHANGELOG entry.** Prepend a `## 0.98.0 — <codename>` section to
`CHANGELOG.md` summarizing: foundational one-tap prompts in the AI Assistant; shared context-aware
"Ask Claude" top-bar menu with per-view suggestions; new `requestChat` seed channel. Match the
existing CHANGELOG format.

- [ ] **Step 3: Typecheck (verifies the new highlight key has EN+DE strings).**

```bash
npx tsc --noEmit
```
Expected: PASS.

- [ ] **Step 4: Run the full unit suite.**

```bash
npm run test:run
```
Expected: PASS (all green, including the new SP1 tests).

- [ ] **Step 5: Lint (zero warnings) + build.**

```bash
npm run lint && npm run build
```
Expected: both PASS (lint `--max-warnings=0`).

- [ ] **Step 6: axe a11y gate for the header-bearing chrome (Playwright — vitest never runs it).**

```bash
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Settings"
```
Expected: PASS (no axe-critical). The new menu trigger lives in the always-present header; if any
other view grep is quick, spot-check one more. webServer auto-starts (~16s).

- [ ] **Step 7: Commit the release.**

```bash
git add src/app/version.ts CHANGELOG.md
git commit -m "chore: release 0.98.0 — AI orchestration SP1 (Ask Claude + foundational prompts)"
```

---

## Final review (after all tasks)

Dispatch a final code reviewer over the whole branch diff (`git diff main...HEAD`), then use
`superpowers:finishing-a-development-branch`. Do not push or open the MR until the user authorizes
(standing rule: push only when explicitly asked).

## Self-review notes (plan author)

- **Spec coverage:** §1 catalog → Task 2; §2 seed channel → Task 3; §3 chat consume+chips → Task 4;
  §4 menu+header+task-manager → Tasks 5–6; §5 i18n → Task 1; §6 tests interleaved + Task 7
  verification. All spec sections covered.
- **Type consistency:** `PromptDef{labelKey,bodyKey}` (Task 2) used unchanged in Tasks 4–5;
  `pendingChatSeed:{prompt,autoSend}` / `requestChat(prompt,autoSend)` (Task 3) consumed verbatim in
  Tasks 4 (`chatSeed`) and 6 (`onAskClaude → requestChat(body,true)`). `promptsForView` returns
  `{onPage,general}` used identically in Tasks 2 and 5.
- **Deviation from spec wording:** spec §4 said `role="menu"/menuitem`; the plan uses the codebase's
  established `role="dialog"` header-menu pattern (ExportMenu) for axe-consistency. Both are valid;
  follow the codebase.
- **Known soft spots for the implementer:** the exact export name of the EN dict in `i18n.ts`
  (`en` vs other) — verify in Task 2 Step 1; the exact `chat-panel.test.tsx` / `app-header.test.tsx`
  render helpers — reuse, don't reinvent (Tasks 4, 6).
```