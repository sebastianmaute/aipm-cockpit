// useTemplateActions — the field visibility a template writes into the workspace (A11).
// `useTemplates` is replaced by a fixed list so a template can carry a visibility the
// load/save sanitisers would never have produced (what `updateTemplate`'s raw patch allows).
import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { useTemplateActions } from "./use-template-actions";
import type { ProjectTemplate } from "./templates";

const RAW_TEMPLATE = vi.hoisted(() => ({
  id: "raw",
  name: "Raw",
  features: [],
  // `name` (required on a milestone) and `targetDate` are missing; "ghost" is unknown.
  fieldVisibility: { milestone: { fields: ["description", "ghost"] }, nonsense: { fields: ["x"] } },
}));

vi.mock("./use-templates", () => ({
  useTemplates: () => ({ templates: [RAW_TEMPLATE as unknown as ProjectTemplate], addTemplate: vi.fn() }),
}));

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </FiltersProvider>
  );
}

describe("useTemplateActions — applied field visibility", () => {
  it("re-adds the required ids and drops unknown ones before the template reaches the workspace", () => {
    const hook = renderHook(
      () => ({
        actions: useTemplateActions({ lang: "en-US", showToast: vi.fn() }),
        ws: useWorkspace(),
      }),
      { wrapper: Wrapper },
    );
    act(() => { hook.result.current.actions.handleApplyTemplate("raw", { includeSeed: false }); });
    const applied = hook.result.current.ws.fieldVisibility;
    expect(applied?.milestone?.fields).toEqual(["name", "targetDate", "description"]);
    expect(applied).not.toHaveProperty("nonsense");
  });
});
