import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useActionNotifications } from "./use-action-notifications";
import type { SuggestedAction } from "./next-actions/types";

function action(id: string, tier: SuggestedAction["tier"] = "now"): SuggestedAction {
  return {
    id,
    source: "milestone",
    title: { key: "actionMilestoneTitle", params: ["X"] },
    why: { key: "actionMilestoneWhyAtRisk" },
    score: 10,
    tier,
    cta: { kind: "open", view: "milestones", id: 1 },
  };
}

let notifInstances: Array<{ onclick: (() => void) | null; close: () => void; tag?: string }>;
let ctor: ReturnType<typeof vi.fn>;

function installNotification(permission: NotificationPermission) {
  notifInstances = [];
  ctor = vi.fn(function (this: Record<string, unknown>, _title: string, opts?: NotificationOptions) {
    const inst = { onclick: null as null | (() => void), close: vi.fn(), tag: opts?.tag };
    notifInstances.push(inst);
    return inst;
  });
  (ctor as unknown as { permission: NotificationPermission }).permission = permission;
  (ctor as unknown as { requestPermission: () => Promise<NotificationPermission> }).requestPermission =
    vi.fn(async () => permission);
  (globalThis as unknown as { Notification: unknown }).Notification = ctor;
}

const baseArgs = () => ({
  enabled: true,
  isPopout: false,
  lang: "en-US" as const,
  onOpenAction: vi.fn(),
  openActionCenter: vi.fn(),
});

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(document, "hasFocus").mockReturnValue(false);
});
afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as unknown as { Notification?: unknown }).Notification;
});

describe("useActionNotifications gate matrix", () => {
  it("does not fire when disabled", () => {
    installNotification("granted");
    renderHook(({ actions }) => useActionNotifications({ ...baseArgs(), enabled: false, actions }), {
      initialProps: { actions: [action("a")] },
    });
    expect(ctor).not.toHaveBeenCalled();
  });
  it("does not fire in a popout", () => {
    installNotification("granted");
    renderHook(({ actions }) => useActionNotifications({ ...baseArgs(), isPopout: true, actions }), {
      initialProps: { actions: [action("a")] },
    });
    expect(ctor).not.toHaveBeenCalled();
  });
  it("does not fire when permission is not granted", () => {
    installNotification("denied");
    renderHook(({ actions }) => useActionNotifications({ ...baseArgs(), actions }), {
      initialProps: { actions: [action("a")] },
    });
    expect(ctor).not.toHaveBeenCalled();
  });
  it("does not fire while the document is focused (marks seen instead)", () => {
    installNotification("granted");
    (document.hasFocus as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const { rerender } = renderHook(({ actions }) => useActionNotifications({ ...baseArgs(), actions }), {
      initialProps: { actions: [action("a")] },
    });
    (document.hasFocus as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
    rerender({ actions: [action("a")] });
    expect(ctor).not.toHaveBeenCalled();
  });
  it("does not fire on the first gated cycle (backlog avoidance), only on later new ids", () => {
    installNotification("granted");
    const { rerender } = renderHook(({ actions }) => useActionNotifications({ ...baseArgs(), actions }), {
      initialProps: { actions: [action("a")] },
    });
    expect(ctor).not.toHaveBeenCalled();
    rerender({ actions: [action("a"), action("b")] });
    expect(ctor).toHaveBeenCalledTimes(1);
  });
});

describe("useActionNotifications firing", () => {
  it("fires a single notification for one new urgent signal and deep-links on click", () => {
    installNotification("granted");
    const args = baseArgs();
    const { rerender } = renderHook(({ actions }) => useActionNotifications({ ...args, actions }), {
      initialProps: { actions: [] as SuggestedAction[] },
    });
    rerender({ actions: [action("a")] });
    expect(ctor).toHaveBeenCalledTimes(1);
    expect(notifInstances[0].tag).toBe("a");
    notifInstances[0].onclick?.();
    expect(args.onOpenAction).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
  });
  it("fires one summary notification for a burst and opens the action center on click", () => {
    installNotification("granted");
    const args = baseArgs();
    const { rerender } = renderHook(({ actions }) => useActionNotifications({ ...args, actions }), {
      initialProps: { actions: [] as SuggestedAction[] },
    });
    rerender({ actions: [action("a"), action("b"), action("c")] });
    expect(ctor).toHaveBeenCalledTimes(1);
    expect(notifInstances[0].tag).toBe("urgent-summary");
    notifInstances[0].onclick?.();
    expect(args.openActionCenter).toHaveBeenCalledTimes(1);
  });
  it("re-notifies a signal that cleared and returned", () => {
    installNotification("granted");
    const { rerender } = renderHook(({ actions }) => useActionNotifications({ ...baseArgs(), actions }), {
      initialProps: { actions: [] as SuggestedAction[] },
    });
    rerender({ actions: [action("a")] });
    rerender({ actions: [] });
    rerender({ actions: [action("a")] });
    expect(ctor).toHaveBeenCalledTimes(2);
  });
  it("re-seeds silently on re-enable (no storm) after a disable", () => {
    installNotification("granted");
    const { rerender } = renderHook(
      ({ actions, enabled }) => useActionNotifications({ ...baseArgs(), enabled, actions }),
      { initialProps: { actions: [action("a")], enabled: true } },
    );
    expect(ctor).not.toHaveBeenCalled(); // first gated cycle seeded "a"
    rerender({ actions: [action("a")], enabled: false }); // disable -> resets seed
    // While disabled a new urgent action "b" appears. On re-enable the seen-set
    // must be re-seeded with the full current backlog ("a","b") silently — NOT
    // fired as a storm. Without the reset, "b" is treated as new and pops.
    rerender({ actions: [action("a"), action("b")], enabled: true });
    expect(ctor).not.toHaveBeenCalled(); // NO storm for the backlog present on re-enable
    // A genuinely new action that arrives AFTER the re-seed still notifies.
    rerender({ actions: [action("a"), action("b"), action("c")], enabled: true });
    expect(ctor).toHaveBeenCalledTimes(1);
  });
});
