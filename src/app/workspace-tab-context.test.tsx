import { act, renderHook } from "@testing-library/react";
import { useLayoutEffect, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { WorkspaceTabProvider, useWorkspaceTab } from "./workspace-tab-context";

function wrapper({ children }: { children: ReactNode }) {
  return <WorkspaceTabProvider>{children}</WorkspaceTabProvider>;
}

describe("WorkspaceTabContext", () => {
  it("default activeTab is 'chat' and isPopout is false", () => {
    const { result } = renderHook(() => useWorkspaceTab(), { wrapper });
    expect(result.current.activeTab).toBe("chat");
    expect(result.current.isPopout).toBe(false);
  });

  it("setActiveTab updates activeTab", () => {
    const { result } = renderHook(
      () => {
        const ctx = useWorkspaceTab();
        useLayoutEffect(() => {
          ctx.setActiveTab("reports");
        }, []);
        return ctx;
      },
      { wrapper },
    );
    expect(result.current.activeTab).toBe("reports");
  });
});
