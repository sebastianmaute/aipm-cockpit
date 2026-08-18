// src/app/timelog-not-configured.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TimelogNotConfigured } from "./timelog-not-configured";
import { t } from "./i18n";

describe("TimelogNotConfigured", () => {
  it("renders the hint and a Configure button that calls the handler", () => {
    const onConfigure = vi.fn();
    render(
      <TimelogNotConfigured
        lang="en-US"
        onConfigure={onConfigure}
        hasFetched={false}
        canClearAll={false}
        onClearAll={vi.fn()}
      />,
    );

    expect(screen.getByText(t("en-US", "timelogNotConfigured"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "timelogConfigure") }));
    expect(onConfigure).toHaveBeenCalledTimes(1);
  });

  // ★★★ THE ESCAPE HATCH. `canClearAllFetched` (timelog-guards.ts) deliberately
  // omits `isMisconfigured` because the cache is local data the user already
  // has. Rendering this empty state WITHOUT carrying Clear-all forward would
  // strand them with bookings they can neither refresh nor remove — the exact
  // trap that omission exists to prevent.
  it("offers Clear-all, and says why, only when a cached fetch exists", () => {
    const onClearAll = vi.fn();
    const { rerender } = render(
      <TimelogNotConfigured lang="en-US" hasFetched={false} canClearAll={false} onClearAll={onClearAll} />,
    );
    expect(screen.queryByRole("button", { name: t("en-US", "clearAll") })).toBeNull();
    expect(screen.queryByText(t("en-US", "timelogCachedWhileOff"))).toBeNull();

    rerender(
      <TimelogNotConfigured lang="en-US" hasFetched canClearAll onClearAll={onClearAll} />,
    );
    expect(screen.getByText(t("en-US", "timelogCachedWhileOff"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "clearAll") }));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  // ★★★ THE DEAD-CONTROL PIN. `hasFetched` is seeded from the CACHE, so a
  // popout over a project with cached bookings DOES render this block — while
  // `canClearAllFetched` returns false for `isPopout`, so the handler swallows
  // the click. An enabled-looking button whose click does nothing is worse than
  // no button; disabled (not hidden) mirrors the full page toolbar.
  it("disables Clear-all when the shared guard refuses it, and still explains the cache", () => {
    const onClearAll = vi.fn();
    render(
      <TimelogNotConfigured lang="en-US" hasFetched canClearAll={false} onClearAll={onClearAll} />,
    );

    const btn = screen.getByRole("button", { name: t("en-US", "clearAll") });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onClearAll).not.toHaveBeenCalled();
    // POSITIVE CONTROL: the explanation is still rendered, so the assertions
    // above are the hasFetched branch and not an unrendered empty state.
    expect(screen.getByText(t("en-US", "timelogCachedWhileOff"))).toBeInTheDocument();
  });

  // Mirrors `chat-panel.tsx`'s `apiKeyMissing && onConfigureAi &&` gate: a
  // popout has no Settings to navigate to, so the button would be a dead end.
  it("renders no Configure button when there is nowhere to navigate", () => {
    render(<TimelogNotConfigured lang="en-US" hasFetched={false} canClearAll={false} onClearAll={vi.fn()} />);

    expect(screen.getByText(t("en-US", "timelogNotConfigured"))).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: t("en-US", "timelogConfigure") }),
    ).toBeNull();
  });

  it("renders the German strings", async () => {
    const { loadI18n } = await import("./i18n");
    await loadI18n("de");
    render(<TimelogNotConfigured lang="de" hasFetched canClearAll onClearAll={vi.fn()} />);

    expect(screen.getByText(t("de", "timelogNotConfigured"))).toBeInTheDocument();
    expect(screen.getByText(t("de", "timelogCachedWhileOff"))).toBeInTheDocument();
  });
});
