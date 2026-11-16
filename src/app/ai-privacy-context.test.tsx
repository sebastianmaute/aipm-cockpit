import { afterEach, describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  AiPrivacyProvider, AiPrivacyUnavailableError, useAiPrivacySource, useOpenProjectAiPrivacy, useOpenProjectRatesWithheld, useOpenProjectReviewAllWrites,
} from "./ai-privacy-context";
import { withPeopleAllowed } from "./ai-people-protection";
import { backgroundPauseReason } from "./ai-consent";
import { withAiSwitch } from "./ai-project-switches";
import { emptyWorkspace, type Workspace } from "./workspace";
import type { Stakeholder } from "./types";
import { setDisabledIntegrations } from "./integration-switches";
import * as unprotectedStandIn from "../test/ai-privacy-unprotected";

// AI people protection: the open project's privacy is read at SEND time, from the source as
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
  useAiPrivacySource(projectKey, () => workspace, () => 0, true);
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

describe("the open project's rates switch follows the workspace at send time (§804)", () => {
  const withRates = (on: boolean): Workspace => ({ ...emptyWorkspace(), settingsOverrides: on ? { ai: { ratesWithheld: true } } : undefined });
  function useRatesHarness({ projectKey, workspace }: Props) {
    useAiPrivacySource(projectKey, () => workspace, () => 0, true);
    return useOpenProjectRatesWithheld();
  }
  const mountRates = (initial: Props) => renderHook((p: Props) => useRatesHarness(p), { wrapper, initialProps: initial });

  it("off at mount, switched on later: the next send withholds rates", () => {
    const { result, rerender } = mountRates({ projectKey: "p1", workspace: withRates(false) });
    const getter = result.current;
    expect(getter()).toBe(false);
    rerender({ projectKey: "p1", workspace: withRates(true) });
    expect(getter()).toBe(true);
  });

  // Like people protection and the review switch, it fails CLOSED: with no project source registered rates are withheld.
  it("with no source registered it withholds rates", () => {
    const { result } = renderHook(() => useOpenProjectRatesWithheld(), { wrapper });
    expect(result.current()).toBe(true);
  });
});

// §794 — like people protection, the review switch fails CLOSED: with no source registered (no project is open yet)
// every AI write goes to the review card. With a source, the project's own setting decides.
describe("the open project's review switch", () => {
  const withReview = (on: boolean): Workspace => ({ ...emptyWorkspace(), settingsOverrides: on ? { ai: { reviewAllWrites: true } } : undefined });
  function useReviewHarness({ projectKey, workspace }: Props) {
    useAiPrivacySource(projectKey, () => workspace, () => 0, true);
    return useOpenProjectReviewAllWrites();
  }
  it("reviews every write while no source is registered", () => {
    const { result } = renderHook(() => useOpenProjectReviewAllWrites(), { wrapper });
    expect(result.current()).toBe(true);
  });
  it("CONTROL: with a source, the project's setting decides", () => {
    const { result, rerender } = renderHook((p: Props) => useReviewHarness(p), { wrapper, initialProps: { projectKey: "p1", workspace: withReview(false) } });
    const getter = result.current;
    expect(getter()).toBe(false);
    rerender({ projectKey: "p1", workspace: withReview(true) });
    expect(getter()).toBe(true);
  });
});

// §794/§804 — the stand-in that feature tests mock this module with has no project, so only a deployment lock can
// switch either safeguard on there, exactly as the real getters answer with no source registered.
describe("the unprotected stand-in honours the deployment locks", () => {
  afterEach(() => setDisabledIntegrations([]));

  it("review of every write and withheld rates are off with no lock, and on under ai-direct-writes and ai-rates", () => {
    setDisabledIntegrations([]);
    expect(unprotectedStandIn.useOpenProjectReviewAllWrites()()).toBe(false);
    expect(unprotectedStandIn.useOpenProjectRatesWithheld()()).toBe(false);
    setDisabledIntegrations(["ai-direct-writes", "ai-rates"]);
    expect(unprotectedStandIn.useOpenProjectReviewAllWrites()()).toBe(true);
    expect(unprotectedStandIn.useOpenProjectRatesWithheld()()).toBe(true);
  });
});

describe("the open project publishes its background pause", () => {
  const paused = (): Workspace => ({ ...emptyWorkspace(), settingsOverrides: withAiSwitch(undefined, "backgroundOff", true) });

  it("follows the workspace on every commit and fails closed on unmount", () => {
    const view = mount({ projectKey: "p1", workspace: paused() });
    expect(backgroundPauseReason()).toBe("project");
    view.rerender({ projectKey: "p1", workspace: emptyWorkspace() });
    expect(backgroundPauseReason()).toBeNull();
    view.rerender({ projectKey: "p1", workspace: paused() });
    expect(backgroundPauseReason()).toBe("project");
    view.rerender({ projectKey: "p1", workspace: emptyWorkspace() });
    view.unmount();
    expect(backgroundPauseReason()).toBe("project");
  });
});

// §795 — fail closed while no real project is loaded: the empty workspace of a load or swap carries no setting, so
// what the source publishes there must be "paused".
describe("the background pause while no project is loaded (§795)", () => {
  afterEach(() => setDisabledIntegrations([]));
  function useLoadHarness({ loaded, workspace }: { loaded: boolean; workspace: Workspace }) {
    useAiPrivacySource("p1", () => workspace, () => 0, loaded);
  }
  const mountLoad = (initial: { loaded: boolean; workspace: Workspace }) =>
    renderHook((p: { loaded: boolean; workspace: Workspace }) => useLoadHarness(p), { wrapper, initialProps: initial });
  const on = (): Workspace => ({ ...emptyWorkspace(), settingsOverrides: { ai: { backgroundOff: true } } });

  it("is paused while the load is pending, whatever the empty workspace says", () => {
    mountLoad({ loaded: false, workspace: emptyWorkspace() });
    expect(backgroundPauseReason()).toBe("project");
  });
  it("is not paused once a project is loaded and the setting is absent", () => {
    const view = mountLoad({ loaded: false, workspace: emptyWorkspace() });
    view.rerender({ loaded: true, workspace: emptyWorkspace() });
    expect(backgroundPauseReason()).toBeNull();
  });
  it("is paused once loaded with the setting on", () => {
    mountLoad({ loaded: true, workspace: on() });
    expect(backgroundPauseReason()).toBe("project");
  });
  it("is paused again when a swap starts", () => {
    const view = mountLoad({ loaded: true, workspace: emptyWorkspace() });
    expect(backgroundPauseReason()).toBeNull();
    view.rerender({ loaded: false, workspace: emptyWorkspace() });
    expect(backgroundPauseReason()).toBe("project");
  });
});
