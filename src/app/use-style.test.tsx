import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ThemeProvider, useTheme } from "./use-theme";
import { CiStyleProvider } from "./use-style";
import { THEME_STORAGE_KEY } from "./theme";
import { STYLE_STORAGE_KEY } from "./style-ci";
import { HARBOR_DARK, HARBOR_LIGHT } from "./builtin-schemes";
import { loadSchemes, addScheme, setActive } from "./color-schemes";
import { ACTIVE_SCHEME_STRUCTURAL_KEY } from "./scheme-apply";
import { MOCKUP_STRUCTURAL } from "./scheme-tokens";

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

// A minimal tree; individual tests seed the scheme store / theme before render.
function tree(child: React.ReactNode = <div />) {
  return (
    <ThemeProvider>
      <CiStyleProvider>{child}</CiStyleProvider>
    </ThemeProvider>
  );
}

describe("CI style ↔ scheme interaction (Phase 2 — scheme-driven)", () => {
  it("always writes data-style=custom, never AIPM/mockup", () => {
    render(tree());
    expect(document.documentElement.getAttribute("data-style")).toBe("custom");

    // A raw scheme switch (light-only mockup) must not change data-style.
    act(() => {
      setActive("mockup");
      window.dispatchEvent(new Event("aipm-cockpit-scheme-change"));
    });
    expect(document.documentElement.getAttribute("data-style")).toBe("custom");
  });

  it("pins light on a light-only active scheme and honours dark on a dark-capable one", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    localStorage.setItem(STYLE_STORAGE_KEY, "custom");
    setActive("mockup"); // light-only built-in scheme
    render(tree());
    // Light-only scheme pins light even under a dark theme.
    expect(document.documentElement.getAttribute("data-scheme-dark")).toBe("0");
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    // Switch to a dark-capable scheme (Harbor) → .dark restored.
    act(() => {
      setActive("harbor");
      window.dispatchEvent(new Event("aipm-cockpit-scheme-change"));
    });
    expect(document.documentElement.getAttribute("data-scheme-dark")).toBe("1");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("swaps to the DARK sub-map when toggling theme on a dark-capable scheme", () => {
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
    render(tree(<ThemeToggle />));
    // Light: Harbor light surface applied, .dark off despite scheme being dark-capable.
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

  it("recomputes .dark on a raw scheme change (dark-capable → light-only)", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    localStorage.setItem(STYLE_STORAGE_KEY, "custom");
    addScheme("LightOnly", { "--surface": "#eeeeee" }, {}); // → u-1 (light-only), becomes active
    setActive("harbor"); // start on the dark-capable default
    render(tree());
    // Harbor + dark theme → .dark on.
    expect(document.documentElement.getAttribute("data-scheme-dark")).toBe("1");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    // Activate a light-only scheme + fire a RAW aipm-cockpit-scheme-change (mirrors selectScheme).
    act(() => {
      setActive("u-1");
      window.dispatchEvent(new Event("aipm-cockpit-scheme-change"));
    });
    expect(document.documentElement.getAttribute("data-scheme-dark")).toBe("0");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("keeps .dark coherent with data-scheme-dark across successive scheme changes (no listener-order desync)", () => {
    // Regression (restores the dropped Task-7 guard, adapted to Phase 2): under a
    // DARK theme, hop light-only → dark-capable AFTER a prior switch. This ends
    // coherent ONLY because syncScheme stamps data-scheme-dark BEFORE re-dispatching
    // aipm-cockpit-style-change, so ThemeProvider (which reacts to aipm-cockpit-style-change only)
    // reads the FRESH capability. Inverting that order would leave .dark reading the
    // STALE data-scheme-dark → the final .dark would be wrong.
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    localStorage.setItem(STYLE_STORAGE_KEY, "custom");
    setActive("harbor"); // dark-capable start
    render(tree());
    expect(document.documentElement.getAttribute("data-scheme-dark")).toBe("1");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    // Prior switch → a light-only scheme (mockup) pins light under the dark theme.
    act(() => {
      setActive("mockup");
      window.dispatchEvent(new Event("aipm-cockpit-scheme-change"));
    });
    expect(document.documentElement.getAttribute("data-scheme-dark")).toBe("0");
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    // Second switch → back to a dark-capable scheme. .dark must be RESTORED, coherent
    // with the freshly-stamped data-scheme-dark="1" (fails if the dispatch order were
    // inverted — apply() would read the stale "0" and keep .dark off).
    act(() => {
      setActive("meridian");
      window.dispatchEvent(new Event("aipm-cockpit-scheme-change"));
    });
    expect(document.documentElement.getAttribute("data-scheme-dark")).toBe("1");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("migrates a legacy aipm-cockpit-style='mockup' to the mockup scheme + custom", () => {
    localStorage.setItem(STYLE_STORAGE_KEY, "mockup");
    render(tree());
    expect(document.documentElement.getAttribute("data-style")).toBe("custom");
    expect(localStorage.getItem(STYLE_STORAGE_KEY)).toBe("custom");
    expect(loadSchemes().activeId).toBe("mockup");
  });

  it("migrates a legacy aipm-cockpit-style='AIPM' to the AIPM scheme + custom", () => {
    localStorage.setItem(STYLE_STORAGE_KEY, "AIPM");
    render(tree());
    expect(document.documentElement.getAttribute("data-style")).toBe("custom");
    expect(localStorage.getItem(STYLE_STORAGE_KEY)).toBe("custom");
    expect(loadSchemes().activeId).toBe("AIPM");
  });

  it("leaves an existing aipm-cockpit-style='custom' + activeId untouched (idempotent)", () => {
    localStorage.setItem(STYLE_STORAGE_KEY, "custom");
    setActive("meridian");
    render(tree());
    expect(localStorage.getItem(STYLE_STORAGE_KEY)).toBe("custom");
    expect(loadSchemes().activeId).toBe("meridian");
  });

  it("syncScheme applies + mirrors the active scheme's structural map", () => {
    localStorage.setItem(STYLE_STORAGE_KEY, "custom");
    setActive("mockup"); // mockup carries MOCKUP_STRUCTURAL (shadows + gradient)
    render(tree());
    // Inline structural override applied on <html>.
    expect(document.documentElement.style.getPropertyValue("--shadow-card")).toBe(
      MOCKUP_STRUCTURAL["--shadow-card"],
    );
    // Mirrored to the pre-paint boot key.
    const mirrored = JSON.parse(localStorage.getItem(ACTIVE_SCHEME_STRUCTURAL_KEY) ?? "{}");
    expect(mirrored["--shadow-card"]).toBe(MOCKUP_STRUCTURAL["--shadow-card"]);
  });
});
