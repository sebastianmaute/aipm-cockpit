import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NO_FLASH_THEME_SCRIPT } from "./boot-theme-script";
import { resolveSchemeColors } from "./scheme-tokens";
import { HARBOR_DARK, HARBOR_LIGHT } from "./builtin-schemes";

const src = readFileSync(join(process.cwd(), "src/app/boot-theme-script.ts"), "utf8");

describe("no-flash boot script — source shape (pinned)", () => {
  it("reads lop-style and ALWAYS sets data-style to custom", () => {
    expect(src).toContain('localStorage.getItem("lop-style")');
    expect(src).toContain('setAttribute("data-style","custom")');
  });
  it("reads + stamps the dark-capable signal", () => {
    expect(src).toContain('localStorage.getItem("lop-scheme-supports-dark")');
    expect(src).toContain('setAttribute("data-scheme-dark"');
  });
  it("still applies the dark class from lop-theme", () => {
    expect(src).toContain('classList.toggle("dark"');
    expect(src).toContain('localStorage.getItem("lop-theme")');
  });
  it("applies the active scheme's colors + structural tokens pre-paint", () => {
    expect(src).toContain('localStorage.getItem("lop-active-scheme-colors")');
    expect(src).toContain('localStorage.getItem("lop-active-scheme-structural")');
    expect(src).toContain("setProperty");
  });
});

describe("no-flash boot script — runtime behaviour", () => {
  let systemDark = false;
  beforeEach(() => {
    systemDark = false;
    localStorage.clear();
    document.documentElement.className = "";
    document.documentElement.removeAttribute("data-style");
    document.documentElement.removeAttribute("data-scheme-dark");
    document.documentElement.removeAttribute("style");
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: systemDark,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    })) as unknown as typeof window.matchMedia;
  });

  const runBoot = () => {
    // Indirect eval of the exact injected IIFE string (global scope).
    (0, eval)(NO_FLASH_THEME_SCRIPT);
  };
  const root = () => document.documentElement;

  it("fresh install (empty storage, system light) → Harbor light, no .dark", () => {
    runBoot();
    expect(root().getAttribute("data-style")).toBe("custom");
    expect(root().getAttribute("data-scheme-dark")).toBe("1");
    expect(root().classList.contains("dark")).toBe(false);
    expect(root().style.getPropertyValue("--surface")).toBe(resolveSchemeColors(HARBOR_LIGHT)["--surface"]);
  });

  it("fresh install with system dark → Harbor dark + .dark", () => {
    systemDark = true;
    runBoot();
    expect(root().getAttribute("data-style")).toBe("custom");
    expect(root().classList.contains("dark")).toBe(true);
    expect(root().style.getPropertyValue("--surface")).toBe(resolveSchemeColors(HARBOR_DARK)["--surface"]);
  });

  it("legacy mockup (no boot keys) → custom, pins light under dark theme, paints Mockup color + structural", () => {
    localStorage.setItem("lop-style", "mockup");
    localStorage.setItem("lop-theme", "dark");
    runBoot();
    expect(root().getAttribute("data-style")).toBe("custom");
    expect(root().getAttribute("data-scheme-dark")).toBe("0");
    expect(root().classList.contains("dark")).toBe(false);
    // Mockup light color (from MOCKUP_SEED)
    expect(root().style.getPropertyValue("--table-head-bg")).toBe("#f1f3f4");
    // Mockup structural token (a shadow → contains rgba)
    expect(root().style.getPropertyValue("--shadow-card")).toContain("rgba");
  });

  it("legacy AIPM (no boot keys) under dark theme → custom, dark-capable, paints AIPM dark color", () => {
    localStorage.setItem("lop-style", "AIPM");
    localStorage.setItem("lop-theme", "dark");
    runBoot();
    expect(root().getAttribute("data-style")).toBe("custom");
    expect(root().getAttribute("data-scheme-dark")).toBe("1");
    expect(root().classList.contains("dark")).toBe(true);
    expect(root().style.getPropertyValue("--surface")).toBe("#121619");
  });

  it("light-only custom (supports-dark unset) pins light and applies the mirrored map", () => {
    localStorage.setItem("lop-style", "custom");
    localStorage.setItem("lop-theme", "dark");
    localStorage.setItem("lop-active-scheme-colors", JSON.stringify({ "--surface": "#abcdef" }));
    runBoot();
    expect(root().getAttribute("data-style")).toBe("custom");
    expect(root().getAttribute("data-scheme-dark")).toBe("0");
    expect(root().classList.contains("dark")).toBe(false);
    expect(root().style.getPropertyValue("--surface")).toBe("#abcdef");
  });

  it("ignores a non-hex value in the mirrored color map (CSS-injection guard)", () => {
    localStorage.setItem("lop-style", "custom");
    localStorage.setItem("lop-scheme-supports-dark", "1");
    localStorage.setItem(
      "lop-active-scheme-colors",
      JSON.stringify({ "--background": "url(https://evil/x)", "--surface": "#123456" }),
    );
    runBoot();
    expect(root().style.getPropertyValue("--background")).toBe("");
    expect(root().style.getPropertyValue("--surface")).toBe("#123456");
  });

  it("skips a tampered structural value (injection guard)", () => {
    localStorage.setItem("lop-style", "custom");
    localStorage.setItem("lop-scheme-supports-dark", "1");
    localStorage.setItem("lop-active-scheme-colors", JSON.stringify({ "--surface": "#123456" }));
    localStorage.setItem(
      "lop-active-scheme-structural",
      JSON.stringify({ "--gradient-kpi": "url(evil)", "--shadow-card": "0 1px 2px rgba(0,0,0,0.1)" }),
    );
    runBoot();
    expect(root().style.getPropertyValue("--gradient-kpi")).toBe("");
    // A safe structural value still applies.
    expect(root().style.getPropertyValue("--shadow-card")).toContain("rgba");
    expect(root().style.getPropertyValue("--surface")).toBe("#123456");
  });

  it("dark-capable custom honours dark theme and applies the mirrored (dark) map", () => {
    localStorage.setItem("lop-style", "custom");
    localStorage.setItem("lop-theme", "dark");
    localStorage.setItem("lop-scheme-supports-dark", "1");
    localStorage.setItem("lop-active-scheme-colors", JSON.stringify({ "--surface": "#16212e" }));
    runBoot();
    expect(root().getAttribute("data-style")).toBe("custom");
    expect(root().getAttribute("data-scheme-dark")).toBe("1");
    expect(root().classList.contains("dark")).toBe(true);
    expect(root().style.getPropertyValue("--surface")).toBe("#16212e");
  });
});
