import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ThemeProvider, useTheme } from "./use-theme";
import { CiStyleProvider, useCiStyle } from "./use-style";
import { THEME_STORAGE_KEY } from "./theme";
import { STYLE_STORAGE_KEY } from "./style-ci";
import { HARBOR_DARK, HARBOR_LIGHT } from "./builtin-schemes";
import { addScheme, setActive } from "./color-schemes";

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
  document.documentElement.removeAttribute("data-scheme-dark");
  document.documentElement.removeAttribute("style");
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

  it("swaps to the DARK sub-map when toggling theme on a dark-capable custom scheme", () => {
    // Fresh store → Harbor (dark-capable) is the default active scheme.
    localStorage.setItem(STYLE_STORAGE_KEY, "custom");
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    function ThemeToggle() {
      const { setTheme } = useTheme();
      return (
        <>
          <button onClick={() => setTheme("dark")}>to-dark</button>
          <button onClick={() => setTheme("light")}>to-light</button>
        </>
      );
    }
    render(
      <ThemeProvider>
        <CiStyleProvider>
          <ThemeToggle />
        </CiStyleProvider>
      </ThemeProvider>,
    );
    // Light: Harbor light surface applied, .dark off despite custom being dark-capable.
    expect(document.documentElement.getAttribute("data-scheme-dark")).toBe("1");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.style.getPropertyValue("--surface")).toBe(HARBOR_LIGHT["--surface"]);

    // Toggle to dark → .dark on + the DARK sub-map applied.
    act(() => {
      fireEvent.click(screen.getByText("to-dark"));
    });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.getPropertyValue("--surface")).toBe(HARBOR_DARK["--surface"]);

    // Back to light → light sub-map restored.
    act(() => {
      fireEvent.click(screen.getByText("to-light"));
    });
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.style.getPropertyValue("--surface")).toBe(HARBOR_LIGHT["--surface"]);
  });

  it("switching from mockup(dark) into custom applies the DARK sub-map (no .dark↔colors desync)", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    localStorage.setItem(STYLE_STORAGE_KEY, "mockup");
    function ToCustom() {
      const { setStyle } = useCiStyle();
      return <button onClick={() => setStyle("custom")}>to-custom</button>;
    }
    render(
      <ThemeProvider>
        <CiStyleProvider>
          <ToCustom />
        </CiStyleProvider>
      </ThemeProvider>,
    );
    // Mockup pins light even under a dark theme.
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    // Switch to custom (Harbor default, dark-capable) → .dark on AND the dark map applied.
    act(() => {
      fireEvent.click(screen.getByText("to-custom"));
    });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.getPropertyValue("--surface")).toBe(HARBOR_DARK["--surface"]);
  });

  it("recomputes .dark on a raw scheme change AFTER a prior style switch (no listener-order desync)", () => {
    // Reviewer repro: switching style once re-registers CiStyleProvider's event
    // listeners (moving them after ThemeProvider's), so a later raw lop-scheme-change
    // must still recompute .dark against the FRESH data-scheme-dark, not a stale one.
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    localStorage.setItem(STYLE_STORAGE_KEY, "AIPM");
    addScheme("LightOnly", { "--surface": "#eeeeee" }, {}); // → u-1 (light-only), becomes active
    setActive("harbor"); // switch into custom on the dark-capable default first
    function ToCustom() {
      const { setStyle } = useCiStyle();
      return <button onClick={() => setStyle("custom")}>to-custom</button>;
    }
    render(
      <ThemeProvider>
        <CiStyleProvider>
          <ToCustom />
        </CiStyleProvider>
      </ThemeProvider>,
    );
    // Switch AIPM→custom (Harbor, dark-capable) — .dark on; re-registers CiStyle listeners.
    act(() => {
      fireEvent.click(screen.getByText("to-custom"));
    });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    // Activate a light-only scheme + fire a RAW lop-scheme-change (mirrors selectScheme when already custom).
    act(() => {
      setActive("u-1");
      window.dispatchEvent(new Event("lop-scheme-change"));
    });
    expect(document.documentElement.getAttribute("data-scheme-dark")).toBe("0");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
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
