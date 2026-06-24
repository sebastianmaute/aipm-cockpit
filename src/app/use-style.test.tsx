import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ThemeProvider } from "./use-theme";
import { CiStyleProvider, useCiStyle } from "./use-style";
import { THEME_STORAGE_KEY } from "./theme";
import { STYLE_STORAGE_KEY } from "./style-ci";

// jsdom has no matchMedia — install a controllable mock (mirrors use-theme.test.tsx).
beforeAll(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  })) as unknown as typeof window.matchMedia;
});

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-style");
});

function Toggle() {
  const { setStyle } = useCiStyle();
  return (
    <>
      <button onClick={() => setStyle("mockup")}>to-mockup</button>
      <button onClick={() => setStyle("AIPM")}>to-AIPM</button>
    </>
  );
}

describe("CI style ↔ theme interaction", () => {
  it("pins light on mockup and restores dark on return to AIPM", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    render(
      <ThemeProvider>
        <CiStyleProvider>
          <Toggle />
        </CiStyleProvider>
      </ThemeProvider>,
    );
    // Dark theme is active initially.
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    // Switching to mockup must suppress .dark.
    act(() => {
      fireEvent.click(screen.getByText("to-mockup"));
    });
    expect(document.documentElement.getAttribute("data-style")).toBe("mockup");
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    // Switching back to AIPM must restore .dark (theme is still "dark").
    act(() => {
      fireEvent.click(screen.getByText("to-AIPM"));
    });
    expect(document.documentElement.getAttribute("data-style")).toBe("AIPM");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("does not add .dark when returning to AIPM while theme is light", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    render(
      <ThemeProvider>
        <CiStyleProvider>
          <Toggle />
        </CiStyleProvider>
      </ThemeProvider>,
    );
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    act(() => {
      fireEvent.click(screen.getByText("to-mockup"));
    });
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    act(() => {
      fireEvent.click(screen.getByText("to-AIPM"));
    });
    // Light theme — must stay without .dark.
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("sets data-style attribute correctly on style switch", () => {
    render(
      <ThemeProvider>
        <CiStyleProvider>
          <Toggle />
        </CiStyleProvider>
      </ThemeProvider>,
    );
    act(() => {
      fireEvent.click(screen.getByText("to-mockup"));
    });
    expect(document.documentElement.getAttribute("data-style")).toBe("mockup");

    act(() => {
      fireEvent.click(screen.getByText("to-AIPM"));
    });
    expect(document.documentElement.getAttribute("data-style")).toBe("AIPM");
  });

  it("persists style choice to localStorage", () => {
    render(
      <ThemeProvider>
        <CiStyleProvider>
          <Toggle />
        </CiStyleProvider>
      </ThemeProvider>,
    );
    act(() => {
      fireEvent.click(screen.getByText("to-mockup"));
    });
    expect(localStorage.getItem(STYLE_STORAGE_KEY)).toBe("mockup");

    act(() => {
      fireEvent.click(screen.getByText("to-AIPM"));
    });
    expect(localStorage.getItem(STYLE_STORAGE_KEY)).toBe("AIPM");
  });
});
