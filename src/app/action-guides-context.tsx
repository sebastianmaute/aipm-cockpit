// src/app/action-guides-context.tsx — hands the operating-guide library to the
// single-request AI actions (§701). The guides load once in task-manager
// (`useOperatingGuides`); every action reads its own slice through
// `useActionGuideText(target)` and passes it to `runForcedToolCall` as
// `guideText`, so no action builds guide text its own way.
"use client";
import { createContext, useContext, useMemo, type ComponentProps, type ReactNode } from "react";
import { AiUsageProvider } from "./ai-usage-context";
import { actionGuideText, type AiTarget, type OperatingGuide } from "./operating-guide";

export interface ActionGuidesValue {
  guides: readonly OperatingGuide[];
  groundInGuides: boolean;
}

const NO_GUIDES: ActionGuidesValue = { guides: [], groundInGuides: false };
const ActionGuidesContext = createContext<ActionGuidesValue>(NO_GUIDES);

export function ActionGuidesProvider({ value, children }: { value: ActionGuidesValue; children: ReactNode }) {
  return <ActionGuidesContext.Provider value={value}>{children}</ActionGuidesContext.Provider>;
}

/** The guide text for one AI action, or "" when grounding is off, no guide
 *  targets it, or the component sits outside a provider (tests, a popout that
 *  never mounted one). Guides still loading count as none: an action started
 *  before they arrive runs ungrounded rather than waiting. */
export function useActionGuideText(target: Exclude<AiTarget, "chat">): string {
  const { guides, groundInGuides } = useContext(ActionGuidesContext);
  return useMemo(() => actionGuideText(guides, groundInGuides, target), [guides, groundInGuides, target]);
}

/** The same text from an explicit library, for a hook called in
 *  TASK-MANAGER'S OWN BODY. ★★ Such a hook sits ABOVE `AiProviders` — that
 *  provider is in task-manager's returned JSX, so it wraps task-manager's
 *  children only — and `useActionGuideText` would read the empty default and
 *  send no guides, silently. Those hooks take a REQUIRED `guides` dep instead
 *  (task-manager passes `operatingGuides.guides`). */
export function useGuideTextFrom(
  guides: readonly OperatingGuide[],
  groundInGuides: boolean,
  target: Exclude<AiTarget, "chat">,
): string {
  return useMemo(() => actionGuideText(guides, groundInGuides, target), [guides, groundInGuides, target]);
}

/** The raw library, for a caller that resolves its target late (a background
 *  runner reading the latest value through a ref). */
export function useActionGuides(): ActionGuidesValue {
  return useContext(ActionGuidesContext);
}

/** `AiUsageProvider` and `ActionGuidesProvider` in one element, so the root can
 *  mount both without growing (task-manager.tsx sits on a zero-headroom size
 *  baseline, §491). */
export function AiProviders({
  lang, ai, showToast, guides, children,
}: ComponentProps<typeof AiUsageProvider> & { guides: readonly OperatingGuide[] }) {
  const value = useMemo(() => ({ guides, groundInGuides: ai.groundInGuides }), [guides, ai.groundInGuides]);
  return (
    <AiUsageProvider lang={lang} ai={ai} showToast={showToast}>
      <ActionGuidesProvider value={value}>{children}</ActionGuidesProvider>
    </AiUsageProvider>
  );
}
