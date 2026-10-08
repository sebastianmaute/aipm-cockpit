// useTemplateActions (§491): Save-as-template and Apply-template, extracted from
// task-manager.tsx. The workspace is the real WorkspaceProvider, so an apply is
// observed in the slices it writes, not in mocked setters.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { useTemplateActions } from "./use-template-actions";
import { BUILT_IN_TEMPLATES } from "./templates-builtin";
import { ALL_MODULE_IDS, type FeatureModuleId } from "./feature-modules";
import { t } from "./i18n";
import type { Task } from "./types";

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </FiltersProvider>
  );
}

const STANDARD = BUILT_IN_TEMPLATES.find((x) => x.id === "builtin-standard")!;
const OWN_TASK = { id: 900, taskName: "Mine", status: "Open" } as unknown as Task;

const ONE_MODULE: FeatureModuleId[] = [ALL_MODULE_IDS[0]];

function setup(features: FeatureModuleId[] = ONE_MODULE) {
  const showToast = vi.fn();
  const hook = renderHook(
    () => ({
      actions: useTemplateActions({ lang: "en-US", showToast, features }),
      ws: useWorkspace(),
    }),
    { wrapper: Wrapper },
  );
  act(() => { hook.result.current.ws.setTasks([OWN_TASK]); });
  return { hook, showToast };
}

describe("useTemplateActions", () => {
  beforeEach(() => { localStorage.clear(); });

  it("lists the built-in templates", () => {
    const { hook } = setup();
    expect(hook.result.current.actions.projectTemplates.map((x) => x.id)).toEqual(
      expect.arrayContaining(BUILT_IN_TEMPLATES.map((x) => x.id)),
    );
  });

  it("apply WITHOUT the seed sets the template's features but keeps the project's tasks", () => {
    const { hook, showToast } = setup();
    act(() => { hook.result.current.actions.handleApplyTemplate(STANDARD.id, { includeSeed: false }); });
    const ws = hook.result.current.ws;
    expect(ws.tasks.map((x) => x.id)).toEqual([900]);
    expect(ws.features).toEqual(ALL_MODULE_IDS.filter((id) => STANDARD.features.includes(id)));
    expect(showToast).toHaveBeenCalledWith("info", t("en-US", "templateApplied"));
  });

  it("apply WITH the seed appends the template's tasks and keeps the project's own", () => {
    const { hook } = setup();
    act(() => { hook.result.current.actions.handleApplyTemplate(STANDARD.id, { includeSeed: true }); });
    const ids = hook.result.current.ws.tasks.map((x) => x.id);
    expect(ids[0]).toBe(900);
    expect(ids.length).toBe(1 + (STANDARD.seed?.tasks?.length ?? 0));
    expect(ids.length).toBeGreaterThan(1);
  });

  it("an unknown template id changes nothing and says nothing", () => {
    const { hook, showToast } = setup();
    act(() => { hook.result.current.actions.handleApplyTemplate("no-such-template", { includeSeed: true }); });
    expect(hook.result.current.ws.tasks.map((x) => x.id)).toEqual([900]);
    expect(showToast).not.toHaveBeenCalled();
  });

  it("save captures the live project with the features it was given, and toasts", () => {
    const { hook, showToast } = setup(ONE_MODULE);
    act(() => { hook.result.current.actions.handleSaveTemplate({ name: "Captured", includeContent: true }); });
    const saved = hook.result.current.actions.projectTemplates.find((x) => x.name === "Captured");
    expect(saved).toBeDefined();
    expect(saved!.features).toEqual(ONE_MODULE);
    expect(showToast).toHaveBeenCalledWith("info", t("en-US", "templateSaved"));
  });
});
