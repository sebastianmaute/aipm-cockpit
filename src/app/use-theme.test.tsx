import { describe, test, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ThemeProvider, useTheme } from "./use-theme";
import { THEME_STORAGE_KEY } from "./theme";

// jsdom has no matchMedia — install a controllable mock.
let systemDark = false;
const listeners = new Set<(e: { matches: boolean }) => void>();
beforeEach(() => {
  systemDark = false;
  listeners.clear();
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  document.documentElement.removeAttribute("data-style");
  document.documentElement.removeAttribute("data-scheme-dark");
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: systemDark,
    media: query,
    addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: (e: { matches: boolean }) => void) => listeners.delete(cb),
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  })) as unknown as typeof window.matchMedia;
});

function Probe() {
  const { theme, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <button onClick={() => setTheme("light")}>light</button>
      <button onClick={() => setTheme("dark")}>dark</button>
      <button onClick={() => setTheme("system")}>system</button>
    </div>
  );
}

describe("ThemeProvider", () => {
  test("applies .dark when the stored theme is dark", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    // Phase 2: a dark-capable scheme is always active (Harbor default).
    document.documentElement.setAttribute("data-scheme-dark", "1");
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(screen.getByTestId("theme").textContent).toBe("dark");
  });

  test("setTheme('light') removes .dark and persists", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    render(<ThemeProvider><Probe /></ThemeProvider>);
    fireEvent.click(screen.getByText("light"));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  test("recomputes .dark on lop-style-change against the current data-scheme-dark", () => {
    // custom style, dark theme, but a light-only active scheme (data-scheme-dark=0) → pinned light.
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    document.documentElement.setAttribute("data-style", "custom");
    document.documentElement.setAttribute("data-scheme-dark", "0");
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    // A scheme switch stamps data-scheme-dark=1 then re-dispatches lop-style-change
    // (done by use-style); ThemeProvider recomputes .dark against the fresh attr.
    act(() => {
      document.documentElement.setAttribute("data-scheme-dark", "1");
      window.dispatchEvent(new Event("lop-style-change"));
    });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  test("pin-light rides scheme-capability, not the data-style value", () => {
    // Phase 2: data-style is always "custom" — pin-light comes from the active
    // scheme's capability (data-scheme-dark), never a "mockup" style branch.
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    document.documentElement.setAttribute("data-style", "custom");
    // Light-only scheme (data-scheme-dark=0) pins light despite a dark stored theme.
    document.documentElement.setAttribute("data-scheme-dark", "0");
    const { unmount } = render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    unmount();

    // Dark-capable scheme (data-scheme-dark=1) honours the dark theme.
    document.documentElement.setAttribute("data-scheme-dark", "1");
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  test("system mode follows matchMedia and reacts to OS changes", () => {
    systemDark = true;
    localStorage.setItem(THEME_STORAGE_KEY, "system");
    // Phase 2: a dark-capable scheme is always active (Harbor default).
    document.documentElement.setAttribute("data-scheme-dark", "1");
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    // Simulate the OS switching to light.
    act(() => {
      systemDark = false;
      listeners.forEach((cb) => cb({ matches: false }));
    });
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
