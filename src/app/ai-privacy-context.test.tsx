import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  AiPrivacyProvider, AiPrivacyUnavailableError, useAiPrivacySource, useOpenProjectAiPrivacy,
} from "./ai-privacy-context";
import { withPeopleAllowed } from "./ai-people-protection";
import { emptyWorkspace, type Workspace } from "./workspace";
import type { Stakeholder } from "./types";

// AI people protection, Task 4: the open project's privacy is read at SEND time, from the source as
// task-manager registered it on the latest commit. A source captured once at mount would send every
// later request with the first render's workspace (empty, protected by default) and project.

const person = (name: string): Stakeholder => ({
  id: 1, name, category: "Internal", influence: "Low", interest: "Low", raci: {},
});
const ws = (allowed: boolean, name = "Rosalind Quenby"): Workspace => ({
  ...emptyWorkspace(),
  stakeholders: [person(name)],
  settingsOverrides: withPeopleAllowed(undefined, allowed),
});

interface Props { projectKey: string; workspace: Workspace }

/** Registers the source as task-manager does, and hands back the getter a feature would hold. */
function useHarness({ projectKey, workspace }: Props) {
  useAiPrivacySource(projectKey, () => workspace, () => 0);
  return useOpenProjectAiPrivacy();
}
const wrapper = ({ children }: { children: ReactNode }) => <AiPrivacyProvider>{children}</AiPrivacyProvider>;

function mount(initial: Props) {
  return renderHook((p: Props) => useHarness(p), { wrapper, initialProps: initial });
}

describe("the open project's AI privacy follows the workspace at send time", () => {
  it("allowed at mount, protection turned on later: the next send is protected", () => {
    const { result, rerender } = mount({ projectKey: "p1", workspace: ws(true) });
    const getter = result.current;
    expect(getter().protected).toBe(false);
    rerender({ projectKey: "p1", workspace: ws(false) });
    // The getter a feature captured earlier still answers for the LATEST source.
    expect(getter().protected).toBe(true);
  });

  it("protected at mount, people allowed later: the next send is unprotected", () => {
    const { result, rerender } = mount({ projectKey: "p1", workspace: ws(false) });
    const getter = result.current;
    expect(getter().protected).toBe(true);
    rerender({ projectKey: "p1", workspace: ws(true) });
    expect(getter().protected).toBe(false);
  });

  it("a project swap: the next send redacts the NEW project's people", () => {
    const { result, rerender } = mount({ projectKey: "p1", workspace: ws(false, "Rosalind Quenby") });
    const getter = result.current;
    rerender({ projectKey: "p2", workspace: ws(false, "Stellan Hargreave") });
    const privacy = getter();
    if (!privacy.protected) throw new Error("expected protected");
    expect(privacy.session.redact("Ask Stellan Hargreave")).not.toContain("Hargreave");
  });

  it("the getter keeps its identity across renders", () => {
    const { result, rerender } = mount({ projectKey: "p1", workspace: ws(true) });
    const first = result.current;
    rerender({ projectKey: "p1", workspace: ws(false) });
    expect(result.current).toBe(first);
  });
});

describe("fail closed", () => {
  it("throws outside the provider instead of sending unprotected", () => {
    const { result } = renderHook(() => useOpenProjectAiPrivacy());
    expect(() => result.current()).toThrow(AiPrivacyUnavailableError);
  });

  it("throws inside the provider before any source is registered", () => {
    const { result } = renderHook(() => useOpenProjectAiPrivacy(), { wrapper });
    expect(() => result.current()).toThrow(AiPrivacyUnavailableError);
  });
});
