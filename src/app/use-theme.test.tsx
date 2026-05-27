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

  test("system mode follows matchMedia and reacts to OS changes", () => {
    systemDark = true;
    localStorage.setItem(THEME_STORAGE_KEY, "system");
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
