import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NO_FLASH_THEME_SCRIPT } from "./boot-theme-script";
import { resolveSchemeColors } from "./scheme-tokens";
import { BEACON_LIGHT } from "./builtin-schemes";

const src = readFileSync(join(process.cwd(), "src/app/boot-theme-script.ts"), "utf8");

describe("no-flash boot script — source shape (pinned)", () => {
  it("ALWAYS sets data-style to custom (no legacy style branch)", () => {
    expect(src).toContain('setAttribute("data-style","custom")');
    // AIPM/Mockup are importable built-in schemes now — no embedded maps or
    // legacy style-value special-casing remain in the boot string.
    expect(src).not.toContain("legacyIcc");
    expect(src).not.toContain("legacyMockup");
  });
  it("reads + stamps the dark-capable signal", () => {
    expect(src).toContain('localStorage.getItem("aipm-cockpit-scheme-supports-dark")');
    expect(src).toContain('setAttribute("data-scheme-dark"');
  });
  it("still applies the dark class from aipm-cockpit-theme", () => {
    expect(src).toContain('classList.toggle("dark"');
    expect(src).toContain('localStorage.getItem("aipm-cockpit-theme")');
  });
  it("applies the active scheme's colors + structural tokens pre-paint", () => {
    expect(src).toContain('localStorage.getItem("aipm-cockpit-active-scheme-colors")');
    expect(src).toContain('localStorage.getItem("aipm-cockpit-active-scheme-structural")');
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

  it("fresh install (empty storage, system light) → Beacon light, no .dark", () => {
    runBoot();
    expect(root().getAttribute("data-style")).toBe("custom");
    expect(root().getAttribute("data-scheme-dark")).toBe("0");
    expect(root().classList.contains("dark")).toBe(false);
    expect(root().style.getPropertyValue("--surface")).toBe(resolveSchemeColors(BEACON_LIGHT)["--surface"]);
    expect(root().style.getPropertyValue("--ui-dark-blue")).toBe("#003459"); // Beacon light base
  });

  it("fresh install with system dark → STILL Beacon light, no .dark (light-only default forces light)", () => {
    systemDark = true;
    runBoot();
    expect(root().getAttribute("data-style")).toBe("custom");
    expect(root().getAttribute("data-scheme-dark")).toBe("0");
    expect(root().classList.contains("dark")).toBe(false);
    expect(root().style.getPropertyValue("--surface")).toBe(resolveSchemeColors(BEACON_LIGHT)["--surface"]);
  });

  it("light-only scheme (supports-dark unset) pins light and applies the mirrored map", () => {
    localStorage.setItem("aipm-cockpit-theme", "dark");
    localStorage.setItem("aipm-cockpit-active-scheme-colors", JSON.stringify({ "--surface": "#abcdef" }));
    runBoot();
    expect(root().getAttribute("data-style")).toBe("custom");
    expect(root().getAttribute("data-scheme-dark")).toBe("0");
    expect(root().classList.contains("dark")).toBe(false);
    expect(root().style.getPropertyValue("--surface")).toBe("#abcdef");
  });

  it("ignores a non-hex value in the mirrored color map (CSS-injection guard)", () => {
    localStorage.setItem("aipm-cockpit-scheme-supports-dark", "1");
    localStorage.setItem(
      "aipm-cockpit-active-scheme-colors",
      JSON.stringify({ "--background": "url(https://evil/x)", "--surface": "#123456" }),
    );
    runBoot();
    expect(root().style.getPropertyValue("--background")).toBe("");
    expect(root().style.getPropertyValue("--surface")).toBe("#123456");
  });

  it("skips a tampered structural value (injection guard)", () => {
    localStorage.setItem("aipm-cockpit-scheme-supports-dark", "1");
    localStorage.setItem("aipm-cockpit-active-scheme-colors", JSON.stringify({ "--surface": "#123456" }));
    localStorage.setItem(
      "aipm-cockpit-active-scheme-structural",
      JSON.stringify({ "--gradient-kpi": "url(evil)", "--shadow-card": "0 1px 2px rgba(0,0,0,0.1)" }),
    );
    runBoot();
    expect(root().style.getPropertyValue("--gradient-kpi")).toBe("");
    // A safe structural value still applies.
    expect(root().style.getPropertyValue("--shadow-card")).toContain("rgba");
    expect(root().style.getPropertyValue("--surface")).toBe("#123456");
  });

  it("a mirrored non-Harbor color map paints THAT map, not Harbor", () => {
    // The boot script reads aipm-cockpit-active-scheme-colors, never hardcoding
    // Harbor when a mirrored map is present. A dark-capable scheme mirrors
    // supports-dark="1".
    localStorage.setItem("aipm-cockpit-scheme-supports-dark", "1");
    localStorage.setItem("aipm-cockpit-active-scheme-colors", JSON.stringify({ "--ui-dark-blue": "#3730a3" }));
    runBoot();
    expect(root().getAttribute("data-style")).toBe("custom");
    expect(root().getAttribute("data-scheme-dark")).toBe("1"); // mirrored dark-capable flag honoured
    expect(root().style.getPropertyValue("--ui-dark-blue")).toBe("#3730a3");
    // NOT Harbor's dark-blue.
    expect(root().style.getPropertyValue("--ui-dark-blue")).not.toBe("#153a5c");
  });

  it("skips an over-length structural value in the boot key (length guard)", () => {
    localStorage.setItem("aipm-cockpit-scheme-supports-dark", "1");
    localStorage.setItem("aipm-cockpit-active-scheme-colors", JSON.stringify({ "--surface": "#123456" }));
    localStorage.setItem(
      "aipm-cockpit-active-scheme-structural",
      JSON.stringify({ "--long-token": "a".repeat(300), "--shadow-card": "0 1px 2px rgba(0,0,0,0.1)" }),
    );
    runBoot();
    expect(root().style.getPropertyValue("--long-token")).toBe("");
    // A safe (short) structural value still applies.
    expect(root().style.getPropertyValue("--shadow-card")).toContain("rgba");
  });

  it("dark-capable scheme honours dark theme and applies the mirrored (dark) map", () => {
    localStorage.setItem("aipm-cockpit-theme", "dark");
    localStorage.setItem("aipm-cockpit-scheme-supports-dark", "1");
    localStorage.setItem("aipm-cockpit-active-scheme-colors", JSON.stringify({ "--surface": "#16212e" }));
    runBoot();
    expect(root().getAttribute("data-style")).toBe("custom");
    expect(root().getAttribute("data-scheme-dark")).toBe("1");
    expect(root().classList.contains("dark")).toBe(true);
    expect(root().style.getPropertyValue("--surface")).toBe("#16212e");
  });
});
