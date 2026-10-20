import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Each banner is replaced by a probe that records the props it was handed, so
// these tests pin what buildAppBanners passes and gates — not the banners.
// vi.hoisted: the vi.mock factory below is hoisted above every import.
const { seen, probe } = vi.hoisted(() => {
  const seen: Record<string, Record<string, unknown>[]> = {};
  const probe = (name: string) => (props: Record<string, unknown>) => {
    (seen[name] ??= []).push(props);
    return null;
  };
  return { seen, probe };
});
vi.mock("./notifications", () => ({
  StorageBanner: probe("StorageBanner"),
  AiKeyBanner: probe("AiKeyBanner"),
  UnloadJournalConflictBanner: probe("UnloadJournalConflictBanner"),
  ExpiredJournalsBanner: probe("ExpiredJournalsBanner"),
  OtherJournalsBanner: probe("OtherJournalsBanner"),
  SavingPausedBanner: probe("SavingPausedBanner"),
}));

import { buildAppBanners, type AppBannersBlockDeps } from "./app-banners-block";

const journal = { key: "j1" };
const otherJournals = {
  expired: [] as unknown[], others: [] as unknown[],
  download: vi.fn(), discard: vi.fn(), dismiss: vi.fn(), dismissExpired: vi.fn(), isRestorable: vi.fn(),
};

function makeDeps(overrides: Record<string, unknown> = {}): AppBannersBlockDeps {
  const deps = {
    lang: "en-US", isPopout: false, settings: { ai: { enabled: true }, layout: "modern" },
    reminderBannersEl: <p data-testid="reminders" />,
    shownStorageError: null, shownStorageSource: null, storageDismissed: { backend: false, list: false },
    setStorageDismissed: vi.fn(), onOpenSettings: vi.fn(), onOpenSettingsSection: vi.fn(),
    aiKeyStatus: "ok", aiKeyBannerDismissed: false, setAiKeyBannerDismissed: vi.fn(),
    unloadJournalConflict: false, restoreUnloadJournalAnyway: vi.fn(), discardUnloadJournal: vi.fn(),
    otherJournals, restoreKeptJournal: vi.fn(),
    loadWasIncomplete: false, truncation: { tag: "trunc" }, decodeFailureCount: 2, malformedQuoteCount: 3,
    allowIncompleteSave: vi.fn(), truncationBannerDismissed: false, setTruncationBannerDismissed: vi.fn(),
    loadPause: null, resolveConflictReload: vi.fn(), reloadCurrentProject: vi.fn(), canOverwriteConflict: false,
    resolveConflictOverwrite: vi.fn(), downloadConflictVersion: vi.fn(),
    loadPauseBannerDismissed: false, setLoadPauseBannerDismissed: vi.fn(),
    destructiveRefusal: null, allowDestructiveSaveAnyway: vi.fn(),
    destructiveBannerDismissed: false, setDestructiveBannerDismissed: vi.fn(),
    tursoPortfolioWithoutProject: false,
    ...overrides,
  };
  return deps as unknown as AppBannersBlockDeps;
}

function renderBanners(overrides: Record<string, unknown> = {}) {
  const deps = makeDeps(overrides);
  const view = render(<>{buildAppBanners(deps)}</>);
  return { deps, view };
}

const only = (name: string) => {
  expect(seen[name] ?? []).toHaveLength(1);
  return seen[name]![0];
};
const none = (name: string) => expect(seen[name] ?? []).toHaveLength(0);
const call = (fn: unknown, ...args: unknown[]) => (fn as (...a: unknown[]) => unknown)(...args);

beforeEach(() => {
  for (const k of Object.keys(seen)) delete seen[k];
  vi.clearAllMocks();
});

describe("buildAppBanners", () => {
  it("renders the reminder banners, and nothing else on a quiet state", () => {
    const { view } = renderBanners();
    expect(view.queryByTestId("reminders")).not.toBeNull();
    for (const name of ["StorageBanner", "AiKeyBanner", "UnloadJournalConflictBanner", "ExpiredJournalsBanner", "OtherJournalsBanner", "SavingPausedBanner"]) none(name);
    expect(view.queryByRole("alert")).toBeNull();
  });

  // §753 — the real banner, not a probe: its text is the whole fix.
  describe("no-project notice", () => {
    it("says nothing is saved while a Turso portfolio has no project chosen, with no Dismiss", () => {
      const { view } = renderBanners({ tursoPortfolioWithoutProject: true });
      expect(view.getByRole("alert").textContent).toBe(
        "No project is chosen, so nothing you change is saved. Choose or create a project in Projects first.",
      );
      expect(view.queryByRole("button")).toBeNull();
    });

    it("stays hidden in a popout", () => {
      const { view } = renderBanners({ tursoPortfolioWithoutProject: true, isPopout: true });
      expect(view.queryByRole("alert")).toBeNull();
    });
  });

  describe("storage banner", () => {
    const failing = { shownStorageError: { kind: "network" }, shownStorageSource: "list" };

    it("shows the error kind, opens Settings, and dismisses both sources", () => {
      const { deps } = renderBanners(failing);
      const p = only("StorageBanner");
      expect(p.kind).toBe("network");
      expect(p.lang).toBe("en-US");
      expect(p.onOpenSettings).toBe(deps.onOpenSettings);
      call(p.onDismiss);
      expect(deps.setStorageDismissed).toHaveBeenCalledWith({ backend: true, list: true });
    });

    it("stays hidden in a popout", () => {
      renderBanners({ ...failing, isPopout: true });
      none("StorageBanner");
    });

    it("stays hidden once its own source is dismissed, and not for the other source's flag", () => {
      renderBanners({ ...failing, storageDismissed: { backend: false, list: true } });
      none("StorageBanner");
      renderBanners({ ...failing, storageDismissed: { backend: true, list: false } });
      only("StorageBanner");
    });

    it("needs a source as well as an error", () => {
      renderBanners({ ...failing, shownStorageSource: null });
      none("StorageBanner");
    });
  });

  describe("AI key banner", () => {
    const bad = { aiKeyStatus: "rejected" };

    it("shows a bad verdict, opens the AI settings section, and dismisses", () => {
      const { deps } = renderBanners(bad);
      const p = only("AiKeyBanner");
      expect(p.status).toBe("rejected");
      call(p.onOpenSettings);
      expect(deps.onOpenSettingsSection).toHaveBeenCalledWith("ai");
      call(p.onDismiss);
      expect(deps.setAiKeyBannerDismissed).toHaveBeenCalledWith(true);
    });

    it.each([
      ["the AI switch is off", { settings: { ai: { enabled: false }, layout: "modern" } }],
      ["the verdict is not bad", { aiKeyStatus: "unknown" }],
      ["it was dismissed", { aiKeyBannerDismissed: true }],
      ["it is a popout", { isPopout: true }],
    ])("stays hidden when %s", (_label, extra) => {
      renderBanners({ ...bad, ...extra });
      none("AiKeyBanner");
    });
  });

  it("offers the unload-journal conflict with its two handlers", () => {
    const { deps } = renderBanners({ unloadJournalConflict: true });
    const p = only("UnloadJournalConflictBanner");
    expect(p.onRestoreAnyway).toBe(deps.restoreUnloadJournalAnyway);
    expect(p.onDiscard).toBe(deps.discardUnloadJournal);
  });

  it("lists expired and other journals only when there are some, popout included", () => {
    const journals = { ...otherJournals, expired: [journal], others: [journal] };
    const { deps } = renderBanners({ otherJournals: journals, isPopout: true });
    const e = only("ExpiredJournalsBanner");
    expect(e.expired).toBe(journals.expired);
    expect(e.onDownload).toBe(journals.download);
    expect(e.onDismiss).toBe(journals.dismissExpired);
    const o = only("OtherJournalsBanner");
    expect(o.others).toBe(journals.others);
    expect(o.onDiscard).toBe(journals.discard);
    expect(o.onDismiss).toBe(journals.dismiss);
    expect(o.canRestore).toBe(journals.isRestorable);
    expect(o.onRestore).toBe(deps.restoreKeptJournal);
  });

  describe("saving-paused banners", () => {
    it("shows an incomplete load with its counts, outside a popout only", () => {
      const { deps } = renderBanners({ loadWasIncomplete: true, truncationBannerDismissed: true, settings: { layout: "classic" } });
      const p = only("SavingPausedBanner");
      expect(p.lang).toBe("en-US");
      expect(p.dismissed).toBe(true);
      expect(p.cause).toEqual({ kind: "truncation", truncation: { tag: "trunc" }, decodeFailureCount: 2, malformedQuoteCount: 3 });
      expect(p.hasFooterIndicator).toBe(false);
      expect(p.onSaveAnyway).toBe(deps.allowIncompleteSave);
      call(p.onDismiss);
      expect(deps.setTruncationBannerDismissed).toHaveBeenLastCalledWith(true);
      call(p.onReopen);
      expect(deps.setTruncationBannerDismissed).toHaveBeenLastCalledWith(false);
      for (const k of Object.keys(seen)) delete seen[k];
      renderBanners({ loadWasIncomplete: true, isPopout: true });
      none("SavingPausedBanner");
    });

    // `canOverwriteConflict` is false unless the pause is a conflict (use-storage-backend.ts), so a load
    // pause never carries Overwrite; the builder passes whatever that flag says.
    it("shows a load pause that reloads, with no overwrite or download", () => {
      const { deps } = renderBanners({ loadPause: "failed", loadPauseBannerDismissed: true });
      const p = only("SavingPausedBanner");
      expect(p.cause).toEqual({ kind: "load", reason: "failed" });
      expect(p.dismissed).toBe(true);
      expect(p.hasFooterIndicator).toBe(true);
      call(p.onSaveAnyway);
      expect(deps.reloadCurrentProject).toHaveBeenCalledTimes(1);
      expect(deps.resolveConflictReload).not.toHaveBeenCalled();
      expect(p.onDownload).toBeUndefined();
      expect(p.onOverwrite).toBeUndefined();
      call(p.onDismiss);
      expect(deps.setLoadPauseBannerDismissed).toHaveBeenLastCalledWith(true);
      call(p.onReopen);
      expect(deps.setLoadPauseBannerDismissed).toHaveBeenLastCalledWith(false);
    });

    it("shows a conflict pause with its own reload, its download, and overwrite only when allowed", () => {
      const { deps } = renderBanners({ loadPause: "conflict" });
      const p = only("SavingPausedBanner");
      expect(p.cause).toEqual({ kind: "conflict" });
      call(p.onSaveAnyway);
      expect(deps.resolveConflictReload).toHaveBeenCalledTimes(1);
      expect(deps.reloadCurrentProject).not.toHaveBeenCalled();
      expect(p.onDownload).toBe(deps.downloadConflictVersion);
      expect(p.onOverwrite).toBeUndefined();
      for (const k of Object.keys(seen)) delete seen[k];
      const allowed = renderBanners({ loadPause: "conflict", canOverwriteConflict: true });
      expect(only("SavingPausedBanner").onOverwrite).toBe(allowed.deps.resolveConflictOverwrite);
    });

    it("hides a load pause in a popout", () => {
      renderBanners({ loadPause: "conflict", isPopout: true });
      none("SavingPausedBanner");
    });

    it("shows a refused destructive save whose discard reloads", () => {
      const refusal = { prevRecords: 10, curRecords: 1, fullWipe: false };
      const { deps } = renderBanners({ destructiveRefusal: refusal, destructiveBannerDismissed: true });
      const p = only("SavingPausedBanner");
      expect(p.cause).toEqual({ kind: "destructive", prevRecords: 10, curRecords: 1, fullWipe: false });
      expect(p.dismissed).toBe(true);
      expect(p.onSaveAnyway).toBe(deps.allowDestructiveSaveAnyway);
      call(p.onDiscard);
      expect(deps.reloadCurrentProject).toHaveBeenCalledTimes(1);
      call(p.onDismiss);
      expect(deps.setDestructiveBannerDismissed).toHaveBeenLastCalledWith(true);
      call(p.onReopen);
      expect(deps.setDestructiveBannerDismissed).toHaveBeenLastCalledWith(false);
      for (const k of Object.keys(seen)) delete seen[k];
      renderBanners({ destructiveRefusal: refusal, isPopout: true });
      none("SavingPausedBanner");
    });

    it("renders the three causes as siblings, never one in place of another", () => {
      renderBanners({ loadWasIncomplete: true, loadPause: "failed", destructiveRefusal: { prevRecords: 1, curRecords: 0, fullWipe: true } });
      expect((seen.SavingPausedBanner ?? []).map((p) => (p.cause as { kind: string }).kind)).toEqual(["truncation", "load", "destructive"]);
    });
  });
});
