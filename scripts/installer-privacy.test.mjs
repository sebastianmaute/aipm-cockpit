// The privacy statement: one text, shown on the installer's privacy page and in the README, and
// naming every service the app can reach. The installer itself is built only in the release
// workflow, so what this can pin is the input makensis is given, not the rendered page.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const TEXT = read("desktop/installer-privacy.txt");
const NSH = read("desktop/installer.nsh");
const README = read("README.md");

describe("the installer's privacy page", () => {
  it("is plain ASCII text, titled, with no tab or control character", () => {
    expect(TEXT.startsWith("Privacy statement\n\n")).toBe(true);
    // Printable ASCII and newlines only: no encoding makensis might assume can misread it.
    expect(TEXT).toMatch(/^[\x20-\x7e\n]+$/);
    expect(TEXT.endsWith("\n")).toBe(true);
  });

  it("is a license page fed from that file, after the welcome page, with a Next button", () => {
    expect(NSH).toMatch(/^!define AIPM_PRIVACY_FILE "\$\{PROJECT_DIR\}\\installer-privacy\.txt"$/m);
    const macro = /^!macro customWelcomePage\n([\s\S]*?)^!macroend$/m.exec(NSH)?.[1];
    expect(macro, "the customWelcomePage macro").toBeDefined();
    const welcome = macro.indexOf("!insertmacro MUI_PAGE_WELCOME");
    const licence = macro.indexOf('!insertmacro MUI_PAGE_LICENSE "${AIPM_PRIVACY_FILE}"');
    expect(welcome).toBeGreaterThanOrEqual(0);
    expect(licence).toBeGreaterThan(welcome);
    const settings = macro.slice(welcome, licence);
    expect(settings).toMatch(/!define MUI_PAGE_HEADER_TEXT "Privacy"/);
    expect(settings).toMatch(/!define MUI_LICENSEPAGE_BUTTON "\$\(\^NextBtn\)"/);
    // Nothing to accept: no checkbox or radio buttons that would force a choice.
    expect(NSH).not.toMatch(/MUI_LICENSEPAGE_(CHECKBOX|RADIOBUTTONS)/);
  });

  it("is the only license page: electron-builder adds none of its own", () => {
    const eb = read("desktop/electron-builder.yml");
    expect(eb).toMatch(/^ {2}include: installer\.nsh$/m);
    expect(eb).not.toMatch(/^ {2}license:/m);
    expect(readdirSync("desktop").filter((f) => /^(license|eula)_/i.test(f))).toEqual([]);
  });
});

describe("the README's privacy statement", () => {
  it("is the installer's text, word for word", () => {
    const m = /<!-- privacy-statement:start -->\n([\s\S]*?)\n<!-- privacy-statement:end -->/.exec(README);
    expect(m, "the README's privacy-statement markers").not.toBeNull();
    expect(m[1]).toBe(TEXT.replace(/^Privacy statement\n\n/, "").trimEnd());
  });
});

// A host or a server route added without a line here fails, so the statement cannot fall behind
// what the app can reach.
describe("the statement names every service the app can reach", () => {
  const SERVICE_FOR_HOST = {
    "https://api.anthropic.com": "Anthropic",
    "https://*.turso.io": "Turso",
    "http://localhost:*": "Turso", // a local, self-hosted Turso database
    "http://127.0.0.1:*": "Turso",
    "https://graph.microsoft.com": "Microsoft Graph",
    "https://login.microsoftonline.com": "Microsoft sign-in",
    "https://*.sharepoint.com": "SharePoint", // SharePoint file downloads
    "https://*.files.1drv.com": "SharePoint",
  };
  const SERVICE_FOR_ROUTE = {
    ai: "AI gateway",
    confluence: "Confluence",
    ecb: "European Central Bank",
    jira: "Jira",
    stt: "speech-to-text",
    timelog: "Timelog",
  };

  it("every host the browser may call (src/proxy.ts connect-src and frame-src)", () => {
    const proxy = read("src/proxy.ts");
    // The policy's own lines (comment lines start with //, so they do not match).
    const directives = proxy.match(/^\s*["`](?:connect|frame)-src .*$/gm) ?? [];
    expect(directives).toHaveLength(2);
    const hosts = [...new Set(directives.flatMap((d) => d.match(/https?:\/\/[^\s"`]+/g) ?? []))];
    // Positive controls: one plain host, and the one inside the template's AI conditional.
    expect(hosts).toContain("https://graph.microsoft.com");
    expect(hosts).toContain("https://api.anthropic.com");
    for (const h of hosts) {
      expect(SERVICE_FOR_HOST[h], `${h} has no service in this test's list`).toBeDefined();
      expect(TEXT, h).toContain(SERVICE_FOR_HOST[h]);
    }
  });

  it("every server route that calls out (src/app/api)", () => {
    const routes = readdirSync("src/app/api", { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
      .map((d) => d.name);
    expect(routes).toContain("jira");
    for (const r of routes) {
      expect(SERVICE_FOR_ROUTE[r], `src/app/api/${r} has no service in this test's list`).toBeDefined();
      expect(TEXT, r).toContain(SERVICE_FOR_ROUTE[r]);
    }
  });

  it("the update feed, and no telemetry", () => {
    expect(read("desktop/electron-builder.yml")).toMatch(/^publish:\n {2}provider: github$/m);
    expect(TEXT).toMatch(/^- GitHub, to check for updates/m);
    expect(TEXT).toContain("AIPM_DISABLE_UPDATE_CHECK");
    expect(TEXT).toContain("no telemetry");
  });
});
