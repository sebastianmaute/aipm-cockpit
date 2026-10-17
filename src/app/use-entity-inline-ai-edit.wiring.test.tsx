// §715 D4 — the hook, not just the key map, gives the popover its entity's title: `title` is a
// required string, so tsc would accept the task's title here too.
import { describe, expect, it, vi } from "vitest";
import { render, renderHook, screen } from "@testing-library/react";
import { t } from "./i18n";
import { defaultSettings } from "./settings-types";
import type { ToolDispatcher } from "./chat-tools";
import { INLINE_EDIT_TITLE_KEY, useEntityInlineAiEdit } from "./use-entity-inline-ai-edit";

vi.mock("./workspace-context", () => ({ useWorkspace: () => ({}) }));
vi.mock("./toast-context", () => ({ useToastContext: () => vi.fn() }));
vi.mock("./ai-usage-context", () => ({ useAiUsageContext: () => ({ record: vi.fn() }) }));
vi.mock("./use-inline-entity-edit", () => ({
  useInlineEntityEdit: () => ({
    activeItem: { id: 1, name: "MVP target", title: "MVP target", taskName: "MVP target" },
    openFor: vi.fn(),
    aiEditEnabled: () => true,
    phase: "input",
    plan: null,
    clarifyText: "",
    errorText: "",
    submit: vi.fn(),
    apply: vi.fn(),
    cancel: vi.fn(),
  }),
}));
vi.mock("./inline-ai-edit-popover", () => ({
  InlineAiEditPopover: ({ title }: { title: string }) => <h2>{title}</h2>,
}));

describe("useEntityInlineAiEdit's popover title (§715 D4)", () => {
  it.each(["milestone", "raid", "change", "stakeholder", "task"] as const)("is the %s's own title", (entity) => {
    const { result } = renderHook(() =>
      useEntityInlineAiEdit(entity, {
        dispatcher: {} as ToolDispatcher,
        settings: defaultSettings,
        isPopout: false,
        lang: "en-US",
        active: true,
      }),
    );
    render(<>{result.current.popover}</>);
    expect(screen.getByRole("heading")).toHaveTextContent(t("en-US", INLINE_EDIT_TITLE_KEY[entity]));
  });
});
