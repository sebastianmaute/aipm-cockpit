"use client";
// Generic glue for the inline "Ask Claude" editor on a thin entity pane. Wraps
// useInlineEntityEdit with the section's adapters (toast, AI-usage naming,
// effective key) and owns the popover element. Pure render glue — no logic worth
// unit-testing (the hook + popover have their own tests); coverage-excluded via
// the src/app/**/*.tsx glob in vitest.config.ts (mirrors use-tasks-inline-ai-edit).
import { type ReactNode } from "react";
import { type Lang, type TranslationKey, t } from "./i18n";
import { type Settings, aiKeyIfEnabled } from "./settings-types";
import { type ToolDispatcher } from "./chat-tools";
import { useWorkspace } from "./workspace-context";
import { useToastContext } from "./toast-context";
import { useAiUsageContext } from "./ai-usage-context";
import { useInlineEntityEdit } from "./use-inline-entity-edit";
import { InlineAiEditPopover } from "./inline-ai-edit-popover";
import { INLINE_DESCRIPTORS, type InlineEntity } from "./inline-ai-edit/entity-descriptor";

type Item = { id: number; [k: string]: unknown };

export interface EntityInlineAiEditDeps {
  dispatcher: ToolDispatcher;
  settings: Settings;
  isPopout: boolean;
  lang: Lang;
  /** True when this entity's pane is the active view; a left-open edit is
   *  auto-closed when it goes false (stale-popover-on-tab-return guard). */
  active: boolean;
}

export interface EntityInlineAiEdit {
  onAiEdit: (item: Item) => void;
  aiEditEnabled: (item: Item) => boolean;
  popover: ReactNode;
}

const ENTITY_LABEL_KEY: Record<InlineEntity, TranslationKey> = {
  task: "inlineAiEditEntityTask",
  raid: "inlineAiEditEntityRaid",
  change: "inlineAiEditEntityChange",
  milestone: "inlineAiEditEntityMilestone",
  stakeholder: "inlineAiEditEntityStakeholder",
  // ★ Reuses the existing `resource` key rather than minting a sixth
  // `inlineAiEditEntity*` string. The descriptor engine knows `resource` so a
  // chat plan can be described, but no surface calls
  // `useEntityInlineAiEdit("resource")` — this entry exists because
  // `Record<InlineEntity, …>` is exhaustive, not because it renders anywhere
  // today. Mint the dedicated key if the resources table ever gains the
  // inline editor.
  resource: "resource",
};

export function useEntityInlineAiEdit(entity: InlineEntity, deps: EntityInlineAiEditDeps): EntityInlineAiEdit {
  const showToast = useToastContext();
  const { record } = useAiUsageContext();
  const ws = useWorkspace();
  const edit = useInlineEntityEdit({
    entity,
    dispatcher: deps.dispatcher,
    ai: deps.settings.ai,
    apiKey: aiKeyIfEnabled(deps.settings.ai),
    isPopout: deps.isPopout,
    lang: deps.lang,
    showToast,
    ws,
    guides: [],
    recordUsage: (u) => record({ input: u.input_tokens, output: u.output_tokens }),
    active: deps.active,
  });
  // Hoisted locals (not `edit.member`) so the caller's useMemo dep arrays stay
  // exhaustive-deps clean.
  const { openFor: onAiEdit, aiEditEnabled } = edit;
  const popover = edit.activeItem ? (
    <InlineAiEditPopover
      lang={deps.lang}
      itemTitle={INLINE_DESCRIPTORS[entity].titleOf(edit.activeItem)}
      entityLabel={t(deps.lang, ENTITY_LABEL_KEY[entity])}
      entity={entity}
      phase={edit.phase}
      plan={edit.plan}
      clarifyText={edit.clarifyText}
      errorText={edit.errorText}
      onSubmit={edit.submit}
      onApply={edit.apply}
      onCancel={edit.cancel}
    />
  ) : null;
  return { onAiEdit, aiEditEnabled, popover };
}
