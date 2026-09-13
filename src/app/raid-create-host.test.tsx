import { act, render, renderHook, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { RaidCreateHost, useRaidCreate, type RaidCreateDeps } from "./raid-create-host";
import { t } from "./i18n";
import type { SuggestedAction } from "./next-actions";
import type { RaidItem } from "./types";
import type { Insight } from "./insights/insight";
import { insightTitle } from "./insights/insight-text";
import { applyInsightLoggedAsRaid } from "./insights/log-as-raid";
import { useResourcePlanner } from "./use-resource-planner";
import { __resetMintStateForTests } from "./id-mint-session";

beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore jsdom polyfill
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore jsdom polyfill
  Range.prototype.getBoundingClientRect = () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) });
});

function wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </FiltersProvider>
  );
}

const slip: SuggestedAction = {
  id: "milestone:4:atrisk", source: "milestone",
  title: { key: "actionRaidTitle", params: [4, "Go-live"] },
  why: { key: "actionMilestoneWhyAtRisk" },
  score: 50, tier: "now", cta: { kind: "open", view: "milestones", id: 4 },
} as never;

function deps(over: Partial<RaidCreateDeps> = {}): RaidCreateDeps {
  return {
    isPopout: false,
    lang: "en-US",
    today: "2026-06-20",
    raid: [],
    handleSaveRaidItem: vi.fn(() => 1),
    recordLearning: vi.fn(async () => {}),
    onInsightLogged: vi.fn(),
    ...over,
  };
}

describe("useRaidCreate — action origin (§515)", () => {
  it("opens a Risk draft seeded from the action", () => {
    const { result } = renderHook(() => useRaidCreate(deps()));
    act(() => result.current.openFromAction!(slip));
    const d = result.current.request!.draft;
    expect(d.category).toBe("R");
    expect(d.raisedDate).toBe("2026-06-20");
    expect(d.title).toBe(t("en-US", "actionRaidTitle", 4, "Go-live"));
    expect(d.description).toContain("From:");
  });

  it("saves with isNew=true, records learning, then closes", () => {
    const handleSaveRaidItem = vi.fn(() => 12);
    const recordLearning = vi.fn(async () => {});
    const { result } = renderHook(() => useRaidCreate(deps({ handleSaveRaidItem, recordLearning })));
    act(() => result.current.openFromAction!(slip));
    const item: RaidItem = { ...result.current.request!.draft, title: "Go-live slipping" };
    act(() => result.current.commit(item));
    expect(handleSaveRaidItem).toHaveBeenCalledWith(item, true);
    expect(recordLearning).toHaveBeenCalledWith(slip, "acted");
    expect(result.current.request).toBeNull();
  });

  it("Cancel changes nothing", () => {
    const handleSaveRaidItem = vi.fn(() => 12);
    const recordLearning = vi.fn(async () => {});
    const { result } = renderHook(() => useRaidCreate(deps({ handleSaveRaidItem, recordLearning })));
    act(() => result.current.openFromAction!(slip));
    expect(result.current.request).not.toBeNull(); // positive control
    act(() => result.current.cancel());
    expect(result.current.request).toBeNull();
    expect(handleSaveRaidItem).not.toHaveBeenCalled();
    expect(recordLearning).not.toHaveBeenCalled();
  });

  it("ignores an empty title and keeps the draft open when the save is refused", () => {
    const handleSaveRaidItem = vi.fn(() => undefined);
    const recordLearning = vi.fn(async () => {});
    const { result } = renderHook(() => useRaidCreate(deps({ handleSaveRaidItem, recordLearning })));
    act(() => result.current.openFromAction!(slip));
    act(() => result.current.commit({ ...result.current.request!.draft, title: "   " }));
    expect(handleSaveRaidItem).not.toHaveBeenCalled();
    act(() => result.current.commit({ ...result.current.request!.draft, title: "Real" }));
    expect(handleSaveRaidItem).toHaveBeenCalledTimes(1);
    expect(recordLearning).not.toHaveBeenCalled();
    expect(result.current.request).not.toBeNull();
  });

  it("applies matrix edits to the draft", () => {
    const { result } = renderHook(() => useRaidCreate(deps()));
    act(() => result.current.openFromAction!(slip));
    act(() => result.current.applyDraftMatrix(5, 5));
    expect(result.current.request!.draft).toMatchObject({ probability: 5, impact: 5 });
  });

  it("applies a status edit with today, stamping closedDate for a terminal status and clearing it on reopen", () => {
    const { result } = renderHook(() => useRaidCreate(deps({ today: "2026-06-20" })));
    act(() => result.current.openFromAction!(slip));
    expect(result.current.request!.draft.closedDate).toBeUndefined(); // positive control: open draft
    act(() => result.current.applyDraftStatus("Closed"));
    expect(result.current.request!.draft).toMatchObject({ status: "Closed", closedDate: "2026-06-20" });
    act(() => result.current.applyDraftStatus("Open"));
    expect(result.current.request!.draft.status).toBe("Open");
    expect(result.current.request!.draft.closedDate).toBeUndefined();
  });

  it("exposes no opener in a popout", () => {
    const { result } = renderHook(() => useRaidCreate(deps({ isPopout: true })));
    expect(result.current.openFromAction).toBeUndefined();
  });
});

describe("RaidCreateHost", () => {
  it("renders nothing without a request", () => {
    const { result } = renderHook(() => useRaidCreate(deps()));
    const { container } = render(
      <RaidCreateHost
        create={result.current} lang="en-US" tasks={[]} raid={[]} stakeholdersEnabled stakeholders={[]}
        resources={[]} contacts={[]} onCreateResource={() => 1} onJumpToRaid={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("floats RaidEditModal as a NEW item seeded from the request", () => {
    const { result } = renderHook(() => useRaidCreate(deps()));
    act(() => result.current.openFromAction!(slip));
    render(
      <RaidCreateHost
        create={result.current} lang="en-US" tasks={[]} raid={[]} stakeholdersEnabled stakeholders={[]}
        resources={[]} contacts={[]} onCreateResource={() => 1} onJumpToRaid={vi.fn()}
      />,
      { wrapper },
    );
    expect(screen.getByText(t("en-US", "raidNewItem"))).toBeTruthy();
    expect(screen.getByDisplayValue(t("en-US", "actionRaidTitle", 4, "Go-live"))).toBeTruthy();
  });
});

const insight: Insight = {
  id: 7, key: "milestoneSlip:42", type: "milestoneSlip", severity: "high",
  entityRef: { view: "milestones", id: 42 }, data: { name: "Kickoff", date: "2026-06-01", daysOverdue: 5 },
  status: "active", firstSeenAt: "2026-06-01", lastSeenAt: "2026-06-10", occurrences: 1,
};

describe("useRaidCreate — insight origin (§515)", () => {
  it("opens a Risk draft seeded from the insight", () => {
    const { result } = renderHook(() => useRaidCreate(deps()));
    act(() => result.current.openFromInsight!(insight));
    const d = result.current.request!.draft;
    expect(d.category).toBe("R");
    expect(d.title).toBe(insightTitle(insight, "en-US"));
    expect(d.description).toContain(`From: ${t("en-US", "insightsCardTitle")}`);
  });

  it("links the insight to the id the save returns, never to draft.id, and records no learning", () => {
    // The draft opened with id 1; the (mocked) save reports a re-mint to 12.
    const handleSaveRaidItem = vi.fn(() => 12);
    const onInsightLogged = vi.fn();
    const recordLearning = vi.fn(async () => {});
    const { result } = renderHook(() => useRaidCreate(deps({ handleSaveRaidItem, onInsightLogged, recordLearning })));
    act(() => result.current.openFromInsight!(insight));
    expect(result.current.request!.draft.id).not.toBe(12);
    act(() => result.current.commit({ ...result.current.request!.draft, title: "Kickoff slip" }));
    expect(handleSaveRaidItem).toHaveBeenCalledWith(expect.objectContaining({ title: "Kickoff slip" }), true);
    expect(onInsightLogged).toHaveBeenCalledWith(7, 12);
    expect(recordLearning).not.toHaveBeenCalled();
    expect(result.current.request).toBeNull();
  });

  it("never touches the insight on Cancel", () => {
    const onInsightLogged = vi.fn();
    const { result } = renderHook(() => useRaidCreate(deps({ onInsightLogged })));
    act(() => result.current.openFromInsight!(insight));
    expect(result.current.request).not.toBeNull(); // positive control
    act(() => result.current.cancel());
    expect(result.current.request).toBeNull();
    expect(onInsightLogged).not.toHaveBeenCalled();
  });

  it("never touches the insight when the save is refused", () => {
    const onInsightLogged = vi.fn();
    const handleSaveRaidItem = vi.fn(() => undefined);
    const { result } = renderHook(() => useRaidCreate(deps({ onInsightLogged, handleSaveRaidItem })));
    act(() => result.current.openFromInsight!(insight));
    act(() => result.current.commit({ ...result.current.request!.draft, title: "x" }));
    expect(handleSaveRaidItem).toHaveBeenCalledTimes(1); // positive control: the save really ran
    expect(onInsightLogged).not.toHaveBeenCalled();
    expect(result.current.request).not.toBeNull();
  });

  it("exposes no insight opener in a popout (positive control: not in the main window)", () => {
    expect(renderHook(() => useRaidCreate(deps())).result.current.openFromInsight).toBeTypeOf("function");
    const { result } = renderHook(() => useRaidCreate(deps({ isPopout: true })));
    expect(result.current.openFromInsight).toBeUndefined();
  });
});

// ★★ END-TO-END over the id-mint race: the REAL `handleSaveRaidItem` composed with the
//   REAL insight writer (`applyInsightLoggedAsRaid`, which task-manager's
//   `onInsightLoggedAsRaid` feeds to `setInsights`). No mocked save return — the
//   collision is seeded, so the re-mint happens for real.
describe("Log as RAID — insight link under an id collision (§515)", () => {
  function renderComposed() {
    __resetMintStateForTests();
    return renderHook(
      () => {
        const ws = useWorkspace();
        const planner = useResourcePlanner({
          lang: "en-US", today: "2026-06-20", logActivity: vi.fn(), showToast: vi.fn(),
          workdayHours: 8, holidaySet: new Set<string>(), captureFieldRows: vi.fn(),
        });
        const create = useRaidCreate({
          isPopout: false, lang: "en-US", today: "2026-06-20", raid: ws.raid,
          handleSaveRaidItem: planner.handleSaveRaidItem,
          recordLearning: vi.fn(async () => {}),
          onInsightLogged: (insightId, raidId) =>
            ws.setInsights((prev) => applyInsightLoggedAsRaid(prev, insightId, raidId, "2026-06-20")),
        });
        return { ws, planner, create };
      },
      { wrapper },
    );
  }

  it("links the insight to the RE-MINTED id when a concurrent writer took the draft's id", () => {
    const { result } = renderComposed();
    act(() => result.current.ws.setInsights([insight]));
    act(() => result.current.create.openFromInsight!(insight));
    const draft = result.current.create.request!.draft;
    // A concurrent writer commits a row under the open-time id before Save.
    act(() => { result.current.planner.handleSaveRaidItem({ ...draft, title: "Concurrent" }); });
    act(() => result.current.create.commit({ ...result.current.create.request!.draft, title: "Kickoff slip" }));

    const raid = result.current.ws.raid;
    expect(raid.find((r) => r.id === draft.id)?.title).toBe("Concurrent"); // not clobbered
    const logged = raid.find((r) => r.title === "Kickoff slip");
    expect(logged).toBeDefined();
    expect(logged!.id).not.toBe(draft.id); // positive control: the save really re-minted
    const linked = result.current.ws.insights!.find((i) => i.id === insight.id)!;
    expect(linked.loggedRaidId).toBe(logged!.id);
    expect(linked).toMatchObject({ status: "acted", actedAt: "2026-06-20" });
  });

  it("Cancel leaves the stored insight byte-identical", () => {
    const { result } = renderComposed();
    act(() => result.current.ws.setInsights([insight]));
    act(() => result.current.create.openFromInsight!(insight));
    expect(result.current.create.request).not.toBeNull(); // positive control
    act(() => result.current.create.cancel());
    expect(result.current.ws.insights).toEqual([insight]);
    expect(result.current.ws.raid).toEqual([]);
  });
});
