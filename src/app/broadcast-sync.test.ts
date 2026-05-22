import { describe, it, expect, vi, beforeEach } from "vitest";

describe("openPopoutWindow", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("calls window.open and stores ref when reuseWindow=false", async () => {
    const mockFocus = vi.fn();
    const mockWin = { focus: mockFocus, closed: false } as unknown as Window;
    const mockOpen = vi.spyOn(window, "open").mockReturnValue(mockWin);

    const { openPopoutWindow } = await import("./broadcast-sync");
    openPopoutWindow("gantt", false);

    expect(mockOpen).toHaveBeenCalledOnce();
    expect(mockOpen).toHaveBeenCalledWith(
      expect.stringContaining("?popout=gantt"),
      "lop-popout-gantt",
      "popup=yes,width=1200,height=800",
    );
    mockOpen.mockRestore();
  });

  it("focuses existing open window without calling window.open when reuseWindow=true", async () => {
    const mockFocus = vi.fn();
    const mockWin = { focus: mockFocus, closed: false } as unknown as Window;
    const mockOpen = vi.spyOn(window, "open").mockReturnValue(mockWin);

    const { openPopoutWindow } = await import("./broadcast-sync");
    openPopoutWindow("gantt", false); // establishes the ref

    openPopoutWindow("reports", true); // reuse: should focus, not open
    expect(mockOpen).toHaveBeenCalledOnce(); // still exactly 1 call
    expect(mockFocus).toHaveBeenCalledOnce();
    mockOpen.mockRestore();
  });

  it("opens a new window when reuseWindow=true but stored ref is closed", async () => {
    const closedWin = { focus: vi.fn(), closed: true } as unknown as Window;
    const freshWin = { focus: vi.fn(), closed: false } as unknown as Window;
    const mockOpen = vi
      .spyOn(window, "open")
      .mockReturnValueOnce(closedWin)
      .mockReturnValueOnce(freshWin);

    const { openPopoutWindow } = await import("./broadcast-sync");
    openPopoutWindow("gantt", false); // ref = closedWin

    openPopoutWindow("reports", true); // ref closed → opens new
    expect(mockOpen).toHaveBeenCalledTimes(2);
    mockOpen.mockRestore();
  });

  it("always calls window.open with reuseWindow=false (multi-window mode unchanged)", async () => {
    const mockWin = { focus: vi.fn(), closed: false } as unknown as Window;
    const mockOpen = vi.spyOn(window, "open").mockReturnValue(mockWin);

    const { openPopoutWindow } = await import("./broadcast-sync");
    openPopoutWindow("gantt", false);
    openPopoutWindow("reports", false);
    expect(mockOpen).toHaveBeenCalledTimes(2);
    mockOpen.mockRestore();
  });
});
