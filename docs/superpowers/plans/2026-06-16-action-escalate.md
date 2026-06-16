# Action Escalate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Escalate" CTA to at-risk RAID rows (has-owner severity actions) that, in one confirm popover, raises the item's severity one level (Issue/Assumption/Dependency only; Risks and already-Critical items are notify-only) and opens a prefilled escalation `mailto:` to a ResourcePicker-chosen recipient.

**Architecture:** Surface-only — the `next-actions/` engine is untouched (the existing `actionRaidWhySeverity` action carries everything needed). Severity is an existing `RaidItem` field, so there is no new persisted field and no new storage write path. Pure logic lives in `action-escalate.ts`; the UI is an extracted `escalate-popover.tsx`; wiring mirrors the assign-owner slice exactly.

**Tech Stack:** TypeScript, React 19, Next.js (forked), vitest + Testing Library, Tailwind (AIPM palette tokens only).

**Spec:** `docs/superpowers/specs/2026-06-16-action-escalate-design.md`

---

## Reference facts (verified against current code)

- `RaidSeverity = "Low" | "Medium" | "High" | "Critical"` and `RAID_SEVERITIES = ["Low","Medium","High","Critical"]` — `src/app/types.ts`.
- `RaidItem` fields used: `id: number`, `title: string`, `category: "R"|"A"|"I"|"D"`, `severity?: RaidSeverity`, `owner`/`ownerEmail`/`ownerResourceId`.
- RAID provider emits `why.key === "actionRaidWhySeverity"` for **has-owner** at-risk items and `"actionRaidWhyNoOwner"` for ownerless ones (`src/app/next-actions/providers/raid.ts`). Escalate targets `actionRaidWhySeverity` only.
- `applyOwnerAssignment(raid, id, value): readonly RaidItem[]` (`src/app/action-assign-owner.ts`) — returns the **same ref** when no item matches. `applyEscalation` mirrors this contract.
- `buildMailtoUrl(email, subject, body): string` — `src/app/mailto.ts`.
- `isValidEmail` — `src/app/sanitize.ts` (imported in task-manager as `import { isValidEmail } from "./sanitize";`).
- `t(lang, key, ...params)` interpolates **0-based** `{0}`/`{1}` (`src/app/i18n.ts`).
- assign-owner wiring to copy: `assignOwnerBundle` useMemo at `task-manager.tsx:942` (gated `isPopout ? undefined`), `setRaid`, `showToast`, `project?.name ?? ""`, threaded via `workspaceProps` (`task-manager.tsx:~1418-1422`) → `workspace-section.tsx` (prop at :196, render at :877) → `actions-panel.tsx` (prop at :22, two `ActionRow` renders at :58 and :71) → `action-row.tsx`.

## File structure

| File | Responsibility | New? |
|------|----------------|------|
| `src/app/action-escalate.ts` | Pure: `nextSeverity`, `planEscalation`, `applyEscalation`, `buildEscalationMail` | Create |
| `src/app/action-escalate.test.ts` | Unit tests for the above | Create |
| `src/app/escalate-popover.tsx` | `EscalateBundle` type + `EscalatePopover` (trigger button + confirm dialog) | Create |
| `src/app/escalate-popover.test.tsx` | Component tests | Create |
| `src/app/i18n.ts` | EN strings (12 new keys) | Modify |
| `src/app/i18n.de.ts` | DE strings (12 new keys, node CRLF write) | Modify |
| `src/app/action-row.tsx` | `escalate?` prop + `canEscalate` gate + render `EscalatePopover` | Modify |
| `src/app/actions-panel.tsx` | thread `escalate` to both `ActionRow` renders | Modify |
| `src/app/workspace-section.tsx` | thread `escalate` prop | Modify |
| `src/app/task-manager.tsx` | `handleEscalate` + `escalateBundle` + workspaceProps | Modify |
| `src/app/version.ts`, `CHANGELOG.md` | release | Modify |

---

## Task 1: Pure escalate logic — plan & apply

**Files:**
- Create: `src/app/action-escalate.ts`
- Test: `src/app/action-escalate.test.ts`

- [ ] **Step 1: Write the failing test** (`src/app/action-escalate.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { nextSeverity, planEscalation, applyEscalation } from "./action-escalate";
import type { RaidItem } from "./types";

function raid(partial: Partial<RaidItem>): RaidItem {
  return { id: 1, category: "I", title: "X", status: "Open", severity: "High", ...partial } as RaidItem;
}

describe("nextSeverity", () => {
  it("steps one level up", () => {
    expect(nextSeverity("Low")).toBe("Medium");
    expect(nextSeverity("Medium")).toBe("High");
    expect(nextSeverity("High")).toBe("Critical");
  });
  it("returns null at the top", () => {
    expect(nextSeverity("Critical")).toBeNull();
  });
});

describe("planEscalation", () => {
  it("raises severity for a High Issue", () => {
    expect(planEscalation(raid({ category: "I", severity: "High" }))).toEqual({
      raisesSeverity: true, from: "High", to: "Critical",
    });
  });
  it("raises a Medium Dependency to High", () => {
    expect(planEscalation(raid({ category: "D", severity: "Medium" }))).toEqual({
      raisesSeverity: true, from: "Medium", to: "High",
    });
  });
  it("is notify-only for Risks (matrix-derived)", () => {
    expect(planEscalation(raid({ category: "R", severity: "High" }))).toEqual({
      raisesSeverity: false, reason: "risk",
    });
  });
  it("is notify-only for an already-Critical Issue", () => {
    expect(planEscalation(raid({ category: "I", severity: "Critical" }))).toEqual({
      raisesSeverity: false, reason: "max",
    });
  });
  it("is notify-only when severity is missing", () => {
    expect(planEscalation(raid({ category: "A", severity: undefined }))).toEqual({
      raisesSeverity: false, reason: "max",
    });
  });
});

describe("applyEscalation", () => {
  it("raises the matched item immutably", () => {
    const before = [raid({ id: 1, severity: "High" }), raid({ id: 2, severity: "High" })];
    const after = applyEscalation(before, 1, "Critical");
    expect(after[0].severity).toBe("Critical");
    expect(after[1].severity).toBe("High");
    expect(after).not.toBe(before);
    expect(before[0].severity).toBe("High"); // original untouched
  });
  it("returns the same ref when no item matches", () => {
    const before = [raid({ id: 1 })];
    expect(applyEscalation(before, 99, "Critical")).toBe(before);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- action-escalate`
Expected: FAIL — `action-escalate.ts` does not exist / functions undefined.

- [ ] **Step 3: Write minimal implementation** (`src/app/action-escalate.ts`)

```ts
// src/app/action-escalate.ts
// Pure escalation logic for the Action Center "Escalate" CTA. No React, no DOM.
// Severity raise applies only to Issue/Assumption/Dependency; Risk severity is
// matrix-derived (prob×impact) so Risks are notify-only, as are already-Critical
// items. `buildEscalationMail` (below) is the only i18n-aware export.
import { RAID_SEVERITIES, type RaidItem, type RaidSeverity } from "./types";

export type EscalationPlan = {
  raisesSeverity: boolean;
  from?: RaidSeverity;
  to?: RaidSeverity;
  reason?: "risk" | "max"; // why severity is NOT raised
};

/** Next severity level up, or null when already at the top (Critical). */
export function nextSeverity(s: RaidSeverity): RaidSeverity | null {
  const i = RAID_SEVERITIES.indexOf(s);
  return i >= 0 && i < RAID_SEVERITIES.length - 1 ? RAID_SEVERITIES[i + 1] : null;
}

/** Decide what escalating an item does: raise severity (I/A/D, not yet Critical)
 *  or notify-only (Risk = matrix-owned; or already Critical / no severity). */
export function planEscalation(item: RaidItem): EscalationPlan {
  if (item.category === "R") return { raisesSeverity: false, reason: "risk" };
  const from = item.severity;
  const to = from ? nextSeverity(from) : null;
  if (!from || !to) return { raisesSeverity: false, reason: "max" };
  return { raisesSeverity: true, from, to };
}

/** Immutable: set `severity` on the RAID item with `id`. Returns the SAME array
 *  reference (no write) when no item matches `id` — mirrors applyOwnerAssignment. */
export function applyEscalation(
  raid: readonly RaidItem[],
  id: number,
  to: RaidSeverity,
): readonly RaidItem[] {
  if (!raid.some((r) => r.id === id)) return raid;
  return raid.map((r) => (r.id === id ? { ...r, severity: to } : r));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- action-escalate`
Expected: PASS (all `nextSeverity` / `planEscalation` / `applyEscalation` cases). `buildEscalationMail` tests come in Task 2.

- [ ] **Step 5: Lint + commit**

Run: `npm run lint` (expect 0 warnings — CI is `--max-warnings=0`).

```bash
git add src/app/action-escalate.ts src/app/action-escalate.test.ts
git commit -m "feat: pure escalate plan/apply logic for RAID severity raise"
```

---

## Task 2: i18n keys + `buildEscalationMail`

**Files:**
- Modify: `src/app/i18n.ts` (EN — Edit tool OK)
- Modify: `src/app/i18n.de.ts` (DE — **node UTF-8 CRLF write only**; the Edit tool corrupts umlauts and curls quotes)
- Modify: `src/app/action-escalate.ts` (add `buildEscalationMail`)
- Test: `src/app/action-escalate.test.ts` (add mail tests)

The 12 new keys (EN → DE):

| Key | Params | EN | DE |
|-----|--------|----|----|
| `actionEscalate` | — | `Escalate` | `Eskalieren` |
| `actionEscalateTitle` | — | `Escalate RAID item` | `RAID-Eintrag eskalieren` |
| `actionEscalateRaiseSeverity` | `{0}`,`{1}` | `Raise severity: {0} → {1}` | `Schweregrad erhöhen: {0} → {1}` |
| `actionEscalateNotifyOnlyRisk` | — | `Risk severity follows the matrix — notify only` | `Risiko-Schweregrad folgt der Matrix — nur benachrichtigen` |
| `actionEscalateNotifyOnlyMax` | — | `Already Critical — notify only` | `Bereits kritisch — nur benachrichtigen` |
| `actionEscalateConfirm` | — | `Escalate now` | `Jetzt eskalieren` |
| `actionEscalateRecipient` | — | `Notify` | `Benachrichtigen` |
| `escalateMailSubject` | `{0}`,`{1}` | `Escalation: RAID #{0} — {1}` | `Eskalation: RAID #{0} — {1}` |
| `escalateMailIntro` | `{0}`,`{1}` | `RAID item #{0} ({1}) needs escalation.` | `RAID-Eintrag #{0} ({1}) muss eskaliert werden.` |
| `escalateMailSeverityRaised` | `{0}`,`{1}` | `Severity raised from {0} to {1}.` | `Schweregrad von {0} auf {1} erhöht.` |
| `escalateMailProject` | `{0}` | `Project: {0}` | `Projekt: {0}` |
| `escalateMailClosing` | — | `Please advise on next steps.` | `Bitte um Rückmeldung zu den nächsten Schritten.` |

- [ ] **Step 1: Write the failing mail test** (append to `src/app/action-escalate.test.ts`)

```ts
import { buildEscalationMail } from "./action-escalate";

describe("buildEscalationMail", () => {
  const item = raid({ id: 7, title: "Vendor slip", category: "I", severity: "High" });

  it("builds an EN subject and includes the severity-raised line when raising", () => {
    const plan = planEscalation(item); // { raisesSeverity:true, from:"High", to:"Critical" }
    const { subject, body } = buildEscalationMail("en", item, plan, "Apollo");
    expect(subject).toBe("Escalation: RAID #7 — Vendor slip");
    expect(body).toContain("RAID item #7 (Vendor slip) needs escalation.");
    expect(body).toContain("Severity raised from High to Critical.");
    expect(body).toContain("Project: Apollo");
    expect(body).toContain("Please advise on next steps.");
  });

  it("omits the severity-raised line for a notify-only (Risk) plan", () => {
    const riskItem = raid({ id: 8, title: "FX risk", category: "R", severity: "High" });
    const plan = planEscalation(riskItem); // notify-only
    const { body } = buildEscalationMail("en", riskItem, plan, "Apollo");
    expect(body).not.toContain("Severity raised");
    expect(body).toContain("RAID item #8 (FX risk) needs escalation.");
  });

  it("renders in German", () => {
    const plan = planEscalation(item);
    const { subject, body } = buildEscalationMail("de", item, plan, "Apollo");
    expect(subject).toBe("Eskalation: RAID #7 — Vendor slip");
    expect(body).toContain("Schweregrad von High auf Critical erhöht.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- action-escalate`
Expected: FAIL — `buildEscalationMail` undefined.

- [ ] **Step 3a: Add EN keys** (`src/app/i18n.ts`) — insert after the `actionCreateTask: "Create task",` line:

```ts
  actionEscalate: "Escalate",
  actionEscalateTitle: "Escalate RAID item",
  actionEscalateRaiseSeverity: "Raise severity: {0} → {1}",
  actionEscalateNotifyOnlyRisk: "Risk severity follows the matrix — notify only",
  actionEscalateNotifyOnlyMax: "Already Critical — notify only",
  actionEscalateConfirm: "Escalate now",
  actionEscalateRecipient: "Notify",
  escalateMailSubject: "Escalation: RAID #{0} — {1}",
  escalateMailIntro: "RAID item #{0} ({1}) needs escalation.",
  escalateMailSeverityRaised: "Severity raised from {0} to {1}.",
  escalateMailProject: "Project: {0}",
  escalateMailClosing: "Please advise on next steps.",
```

- [ ] **Step 3b: Add DE keys** (`src/app/i18n.de.ts`) — **node script only** (file is CRLF; anchor must match `\r\n`; never the Edit tool). Find the DE line for `actionCreateTask` and insert the block after it:

```bash
node -e '
const fs = require("fs");
const p = "src/app/i18n.de.ts";
let s = fs.readFileSync(p, "utf8");
const anchor = "  actionCreateTask: \"Aufgabe erstellen\",\r\n"; // verify exact DE value + CRLF first
const block =
  "  actionEscalate: \"Eskalieren\",\r\n" +
  "  actionEscalateTitle: \"RAID-Eintrag eskalieren\",\r\n" +
  "  actionEscalateRaiseSeverity: \"Schweregrad erhöhen: {0} → {1}\",\r\n" +
  "  actionEscalateNotifyOnlyRisk: \"Risiko-Schweregrad folgt der Matrix — nur benachrichtigen\",\r\n" +
  "  actionEscalateNotifyOnlyMax: \"Bereits kritisch — nur benachrichtigen\",\r\n" +
  "  actionEscalateConfirm: \"Jetzt eskalieren\",\r\n" +
  "  actionEscalateRecipient: \"Benachrichtigen\",\r\n" +
  "  escalateMailSubject: \"Eskalation: RAID #{0} — {1}\",\r\n" +
  "  escalateMailIntro: \"RAID-Eintrag #{0} ({1}) muss eskaliert werden.\",\r\n" +
  "  escalateMailSeverityRaised: \"Schweregrad von {0} auf {1} erhöht.\",\r\n" +
  "  escalateMailProject: \"Projekt: {0}\",\r\n" +
  "  escalateMailClosing: \"Bitte um Rückmeldung zu den nächsten Schritten.\",\r\n";
if (!s.includes(anchor)) { console.error("ANCHOR NOT FOUND — check exact DE text + CRLF"); process.exit(1); }
s = s.replace(anchor, anchor + block);
fs.writeFileSync(p, s, "utf8");
console.log("DE keys inserted");
'
```

> If the anchor text differs (the DE value of `actionCreateTask` may not be exactly `"Aufgabe erstellen"`), grep `src/app/i18n.de.ts` for `actionCreateTask` first and use the real line. The `\r\n` is mandatory — a `\n`-only anchor silently no-ops.

- [ ] **Step 3c: Add `buildEscalationMail`** (`src/app/action-escalate.ts`) — add imports + export:

```ts
import { t, type Lang } from "./i18n";
// ...existing imports/exports above...

/** Pure (uses `t`): the escalation email subject + plain-text body. The
 *  severity-raised sentence is included only when the plan raises severity. */
export function buildEscalationMail(
  lang: Lang,
  item: RaidItem,
  plan: EscalationPlan,
  projectName: string,
): { subject: string; body: string } {
  const subject = t(lang, "escalateMailSubject", item.id, item.title);
  const lines = [t(lang, "escalateMailIntro", item.id, item.title)];
  if (plan.raisesSeverity && plan.from && plan.to) {
    lines.push(t(lang, "escalateMailSeverityRaised", plan.from, plan.to));
  }
  lines.push(t(lang, "escalateMailProject", projectName));
  lines.push(t(lang, "escalateMailClosing"));
  return { subject, body: lines.join("\n\n") };
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npm run test:run -- action-escalate` → PASS.
Run: `npx tsc --noEmit` → no errors (this also enforces EN/DE key parity — a missing DE key fails here).

- [ ] **Step 5: Verify DE encoding + lint + commit**

Run: `npm run test:run -- i18n-encoding` → PASS (confirms real umlauts, no ASCII subs).
Run: `npm run lint` → 0 warnings.

```bash
git add src/app/action-escalate.ts src/app/action-escalate.test.ts src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat: escalation mail builder + EN/DE i18n keys"
```

---

## Task 3: EscalatePopover component

**Files:**
- Create: `src/app/escalate-popover.tsx`
- Test: `src/app/escalate-popover.test.tsx`

- [ ] **Step 1: Write the failing test** (`src/app/escalate-popover.test.tsx`)

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { EscalatePopover, type EscalateBundle } from "./escalate-popover";
import type { SuggestedAction } from "./next-actions/types";
import type { RaidItem } from "./types";

function action(id: number): SuggestedAction {
  return {
    id: `raid:${id}:severity`, source: "raid", moduleId: "raid",
    title: { key: "actionRaidTitle", params: [id, "X"] },
    why: { key: "actionRaidWhySeverity", params: ["High"] },
    score: 5, tier: "now", cta: { kind: "open", view: "raid", id },
  };
}
function bundle(raid: RaidItem[], onEscalate = vi.fn()): EscalateBundle {
  return { resources: [], onCreateResource: vi.fn(() => 1), raid, onEscalate };
}
const issue = (over: Partial<RaidItem> = {}): RaidItem =>
  ({ id: 1, category: "I", title: "X", status: "Open", severity: "High", ...over } as RaidItem);

describe("EscalatePopover", () => {
  it("shows the raise-severity preview for a High Issue and a disabled confirm until a valid email", () => {
    render(<EscalatePopover lang="en" action={action(1)} bundle={bundle([issue()])} />);
    fireEvent.click(screen.getByRole("button", { name: "Escalate" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Raise severity: High → Critical")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Escalate now" })).toHaveProperty("disabled", true);
  });

  it("shows the notify-only note for a Risk", () => {
    render(<EscalatePopover lang="en" action={action(1)} bundle={bundle([issue({ category: "R" })])} />);
    fireEvent.click(screen.getByRole("button", { name: "Escalate" }));
    expect(within(screen.getByRole("dialog")).getByText(/notify only/)).toBeTruthy();
  });

  it("fires onEscalate with the chosen recipient and closes", () => {
    const onEscalate = vi.fn();
    render(<EscalatePopover lang="en" action={action(1)} bundle={bundle([issue()], onEscalate)} />);
    fireEvent.click(screen.getByRole("button", { name: "Escalate" }));
    // ResourcePicker free-entry: a name + email field. Fill the email so confirm enables.
    const dialog = screen.getByRole("dialog");
    const email = within(dialog).getByPlaceholderText(/email/i);
    fireEvent.change(email, { target: { value: "boss@example.com" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Escalate now" }));
    expect(onEscalate).toHaveBeenCalledWith(
      action(1),
      expect.objectContaining({ email: "boss@example.com" }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
```

> Note: the exact ResourcePicker email-field selector (`getByPlaceholderText(/email/i)`) must match the real component. If it differs, read `src/app/resource-picker.tsx` and adjust the query — do **not** change ResourcePicker to satisfy the test (the assign-owner slice learned this: fix the test query, not the shared component).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- escalate-popover`
Expected: FAIL — `escalate-popover.tsx` does not exist.

- [ ] **Step 3: Implement** (`src/app/escalate-popover.tsx`)

```tsx
// src/app/escalate-popover.tsx
"use client";
import { useState, useRef, useEffect } from "react";
import { type Lang, t } from "./i18n";
import type { SuggestedAction } from "./next-actions/types";
import type { RaidItem, Resource } from "./types";
import { ResourcePicker } from "./resource-picker";
import { isValidEmail } from "./sanitize";
import { planEscalation } from "./action-escalate";

export interface EscalateBundle {
  resources: readonly Resource[];
  onCreateResource: (name: string, email: string) => number;
  raid: readonly RaidItem[];
  onEscalate: (
    action: SuggestedAction,
    recipient: { name: string; email: string; resourceId: number | null },
  ) => void;
}

interface EscalatePopoverProps {
  lang: Lang;
  action: SuggestedAction;
  bundle: EscalateBundle;
}

export function EscalatePopover({ lang, action, bundle }: EscalatePopoverProps) {
  const [open, setOpen] = useState(false);
  const [recipient, setRecipient] = useState({ name: "", email: "", resourceId: null as number | null });
  const popRef = useRef<HTMLSpanElement>(null);

  // a11y: focus into the dialog on open; close on Escape via a document listener
  // (robust even when ResourcePicker swallows Escape without bubbling).
  useEffect(() => {
    if (open) popRef.current?.querySelector<HTMLElement>("input,button,[tabindex]")?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const id = action.cta.kind === "open" ? Number(action.cta.id) : -1;
  const item = bundle.raid.find((r) => r.id === id);
  const plan = item ? planEscalation(item) : null;
  const canConfirm = isValidEmail(recipient.email);

  const confirm = () => { bundle.onEscalate(action, recipient); setOpen(false); };

  return (
    <span className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className="rounded-md border border-line px-2 py-1 text-xs font-medium text-AIPM-dark-blue hover:bg-surface-muted dark:text-AIPM-light-grey"
      >
        {t(lang, "actionEscalate")}
      </button>
      {open && plan && (
        <span
          ref={popRef}
          role="dialog"
          aria-label={t(lang, "actionEscalateTitle")}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
          className="absolute right-0 top-full z-20 mt-1 w-72 rounded-md border border-line bg-surface p-2"
        >
          <p className="mb-2 text-xs text-foreground">
            {plan.raisesSeverity && plan.from && plan.to
              ? t(lang, "actionEscalateRaiseSeverity", plan.from, plan.to)
              : plan.reason === "risk"
                ? t(lang, "actionEscalateNotifyOnlyRisk")
                : t(lang, "actionEscalateNotifyOnlyMax")}
          </p>
          <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {t(lang, "actionEscalateRecipient")}
          </span>
          <ResourcePicker
            lang={lang}
            value={recipient}
            resources={bundle.resources}
            contacts={[]}
            onCreateResource={bundle.onCreateResource}
            onChange={(next) => setRecipient(next)}
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              disabled={!canConfirm}
              onClick={(e) => { e.stopPropagation(); confirm(); }}
              className="rounded-md border border-line px-3 py-1 text-xs font-medium text-AIPM-dark-blue hover:bg-surface-muted disabled:opacity-50 dark:text-AIPM-light-grey"
            >
              {t(lang, "actionEscalateConfirm")}
            </button>
          </div>
        </span>
      )}
    </span>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- escalate-popover`
Expected: PASS. If the email-field query fails, read `resource-picker.tsx` and fix the test query to match the real input (placeholder/label), not the component.

- [ ] **Step 5: Lint + commit**

Run: `npm run lint` → 0 warnings (watch for unused imports).

```bash
git add src/app/escalate-popover.tsx src/app/escalate-popover.test.tsx
git commit -m "feat: EscalatePopover — severity preview + recipient + confirm dialog"
```

---

## Task 4: Wire the CTA through the surface chain

**Files:**
- Modify: `src/app/action-row.tsx` (prop + gate + render)
- Modify: `src/app/actions-panel.tsx` (prop + both renders)
- Modify: `src/app/workspace-section.tsx` (prop + render)

No new tests here (covered by the popover test + the task-manager integration); this is prop plumbing. Verify with `tsc`.

- [ ] **Step 1: `action-row.tsx`** — add the import, prop, gate, and render.

Add import near the other action imports (top of file):
```ts
import { EscalatePopover, type EscalateBundle } from "./escalate-popover";
```
Add to `ActionRowProps` (after `onDraftMessage?`):
```ts
  escalate?: EscalateBundle;
```
Add to the destructure in `export function ActionRow({ ... })`:
```ts
  escalate,
```
Add the gate near `canDraft`:
```ts
  const canEscalate =
    escalate != null &&
    action.source === "raid" &&
    action.why.key === "actionRaidWhySeverity" &&
    action.cta.kind === "open";
```
Render it inside the right-hand `<div className="flex shrink-0 items-center gap-1">`, after the `canAssign` block and before the `onSnooze` block:
```tsx
        {canEscalate && escalate && (
          <EscalatePopover lang={lang} action={action} bundle={escalate} />
        )}
```

- [ ] **Step 2: `actions-panel.tsx`** — thread `escalate` to both rows.

Add to the props interface (after `onDraftMessage?`):
```ts
  escalate?: EscalateBundle;
```
(`EscalateBundle` is already importable — change the existing `import type { AssignOwnerBundle } from "./action-row";` line is NOT needed; instead add:)
```ts
import type { EscalateBundle } from "./escalate-popover";
```
Add `escalate` to the destructured params of `export function ActionsPanel({ ... })`. Then add `escalate={escalate}` to **both** `<ActionRow ... />` renders (the two at ~:58 and ~:71).

- [ ] **Step 3: `workspace-section.tsx`** — thread the prop.

Add import:
```ts
import type { EscalateBundle } from "./escalate-popover";
```
Add to the props type (after `assignOwner?: AssignOwnerBundle;` at ~:196):
```ts
  escalate?: EscalateBundle;
```
Add `escalate` to the destructured params (near `assignOwner` at ~:271). Add `escalate={escalate}` to the `<ActionsPanel ... />` render at ~:877.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (the new prop is optional everywhere, so untouched callers still compile).

- [ ] **Step 5: Lint + commit**

Run: `npm run lint` → 0 warnings.

```bash
git add src/app/action-row.tsx src/app/actions-panel.tsx src/app/workspace-section.tsx
git commit -m "feat: thread escalate CTA bundle through action surface"
```

---

## Task 5: task-manager handler + bundle

**Files:**
- Modify: `src/app/task-manager.tsx`

- [ ] **Step 1: Add imports** (near `import { applyOwnerAssignment } from "./action-assign-owner";`):

```ts
import { planEscalation, applyEscalation, buildEscalationMail } from "./action-escalate";
import { buildMailtoUrl } from "./mailto";
```
> `buildMailtoUrl` may already be imported from `./mailto` (used by other flows) — if so, just add the named import rather than a duplicate line. `isValidEmail` is already imported from `./sanitize`. `RaidItem` type is already in scope.

- [ ] **Step 2: Add the handler** (place it near `handleDraftMessageFromAction`, ~:1022):

```ts
const handleEscalate = useCallback(
  (
    action: SuggestedAction,
    recipient: { name: string; email: string; resourceId: number | null },
  ) => {
    if (action.cta.kind !== "open") return;
    const id = Number(action.cta.id);
    const item = raid.find((r) => r.id === id);
    if (!item) return; // deleted-source safe
    const plan = planEscalation(item);
    if (plan.to) {
      const next = applyEscalation(raid, id, plan.to);
      if (next !== raid) setRaid(next as RaidItem[]);
    }
    if (!isValidEmail(recipient.email)) { window.alert(t(lang, "errorInvalidEmail")); return; }
    const { subject, body } = buildEscalationMail(lang, item, plan, project?.name ?? "");
    window.location.href = buildMailtoUrl(recipient.email, subject, body);
  },
  [raid, setRaid, lang, project],
);
```

- [ ] **Step 3: Add the bundle** (next to `assignOwnerBundle`, ~:942):

```ts
const escalateBundle = useMemo(
  () =>
    isPopout
      ? undefined
      : {
          resources,
          onCreateResource: handleCreateResource,
          raid,
          onEscalate: handleEscalate,
        },
  [isPopout, resources, handleCreateResource, raid, handleEscalate],
);
```

- [ ] **Step 4: Pass it via workspaceProps** (in the `workspaceProps` object near `assignOwner: assignOwnerBundle,` ~:1421):

```ts
    escalate: escalateBundle,
```

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit` → no errors.
Run: `npm run lint` → 0 warnings (check no unused import slipped in — CI is `--max-warnings=0`).

- [ ] **Step 6: Full unit suite**

Run: `npm run test:run`
Expected: all green (the new tests plus the existing ~3500).

- [ ] **Step 7: Commit**

```bash
git add src/app/task-manager.tsx
git commit -m "feat: wire escalate handler + bundle in task-manager"
```

---

## Task 6: Release + final review

**Files:**
- Modify: `src/app/version.ts`, `CHANGELOG.md`, `src/app/i18n.ts`, `src/app/i18n.de.ts`

- [ ] **Step 1: Pick the next version + codename.** Bump `APP_VERSION` to `0.92.0` in `src/app/version.ts`, set `APP_MILESTONE` to a new sci-fi/fantasy author codename (next after "Stross"; pick an unused one, e.g. `"Asaro"`), and update `APP_BUILD_DATE` to `2026-06-16`. Append a new highlight key `"versionHighlightEscalate"` to `APP_HIGHLIGHT_KEYS`.

- [ ] **Step 2: Add the highlight i18n strings.** EN (`i18n.ts`):
```ts
  versionHighlightEscalate: "Escalate at-risk RAID items: raise severity and notify in one step",
```
DE (`i18n.de.ts`, node CRLF write, anchor on the previous `versionHighlight*` DE line):
```ts
  versionHighlightEscalate: "Risikobehaftete RAID-Einträge eskalieren: Schweregrad erhöhen und benachrichtigen in einem Schritt",
```

- [ ] **Step 3: CHANGELOG entry.** Add a `## 0.92.0 "Asaro" — 2026-06-16` section to `CHANGELOG.md` describing the Escalate CTA (raise severity for I/A/D; Risks + already-Critical notify-only; ResourcePicker recipient; mailto).

- [ ] **Step 4: Full verification.**

Run: `npx tsc --noEmit` → clean (EN/DE parity incl. the highlight + 12 keys).
Run: `npm run test:run` → all green.
Run: `npm run lint` → 0 warnings.
Run: `npm run build` → succeeds (prebuild script-docs check passes).

- [ ] **Step 5: Commit.**

```bash
git add src/app/version.ts CHANGELOG.md src/app/i18n.ts src/app/i18n.de.ts
git commit -m "chore: release 0.92.0 Asaro — escalate CTA"
```

- [ ] **Step 6: Final whole-branch review (MANDATORY).** Dispatch an `ecc:code-reviewer` (or `ecc:typescript-reviewer`) over the full branch diff `git diff main...HEAD`. The prior three execution-depth slices each had the final whole-branch review catch cross-cutting issues (recipient validation, untested dispatcher paths) that per-task reviews missed. Specifically verify:
  - The `canEscalate` gate excludes no-owner rows (`actionRaidWhyNoOwner`) and review-due rows — no CTA overlap with assign-owner.
  - `handleEscalate` validates the recipient email before opening mailto, and is a no-op for a deleted source item.
  - Severity raise persists through the existing `setRaid` path (no new write path needed; confirm severity is in all serializers already — it is, it predates this slice).
  - No off-palette colors/shadows in `escalate-popover.tsx`; the trigger + confirm buttons have accessible names; the dialog has `aria-label`.
  - No unused imports anywhere (CI `--max-warnings=0`).
  Address any CRITICAL/HIGH findings, then re-run `tsc` + `test:run` + `lint`.

---

## Self-review (against the spec)

**Spec coverage:** gate (§1)→Task 4; pure logic (§2)→Tasks 1–2; popover (§3)→Task 3; data flow/`EscalateBundle` (§4)→Tasks 3–5; error/edge (§5)→Task 5 handler + Task 3 confirm gate; testing (§6)→Tasks 1–3; i18n keys (§7)→Task 2; release→Task 6. No gaps.

**Type consistency:** `EscalationPlan`, `planEscalation`, `applyEscalation`, `nextSeverity`, `buildEscalationMail`, `EscalateBundle` signatures are identical across Tasks 1–5. `applyEscalation` returns `readonly RaidItem[]` (cast on `setRaid`, matching `applyOwnerAssignment`). Recipient shape `{ name; email; resourceId: number | null }` matches ResourcePicker's `onChange`.

**Placeholders:** none — every code step is complete. The one runtime caveat (ResourcePicker email-field test selector) is called out explicitly with the fallback instruction.
