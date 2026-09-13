import { act, render, renderHook, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider } from "./workspace-context";
import { RaidCreateHost, useRaidCreate, type RaidCreateDeps } from "./raid-create-host";
import { t } from "./i18n";
import type { SuggestedAction } from "./next-actions";
import type { RaidItem } from "./types";

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

  it("applies status and matrix edits to the draft", () => {
    const { result } = renderHook(() => useRaidCreate(deps()));
    act(() => result.current.openFromAction!(slip));
    act(() => result.current.applyDraftMatrix(5, 5));
    expect(result.current.request!.draft).toMatchObject({ probability: 5, impact: 5 });
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
