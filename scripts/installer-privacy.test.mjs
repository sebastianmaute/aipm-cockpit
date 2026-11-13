// The privacy statement: one text, shown on the installer's privacy page and in the README, and
// naming every service the app can reach. The installer itself is built only in the release
// workflow, so what this can pin is the input makensis is given, not the rendered page.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CSP_CONNECT_HOSTS, CSP_FRAME_HOSTS } from "../src/proxy";

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

  // makensis passes the file to the license page's RichEdit control as it is; .gitattributes pins
  // it to CRLF so every line break shows.
  it("has Windows line endings, pinned by .gitattributes", () => {
    const raw = readFileSync("desktop/installer-privacy.txt", "utf8");
    expect(raw).toContain("\r\n");
    expect(raw).not.toMatch(/(?<!\r)\n/);
    expect(read(".gitattributes")).toMatch(/^desktop\/\*\* text eol=lf\n(?:#.*\n)*desktop\/installer-privacy\.txt text eol=crlf$/m);
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
    // electron-builder turns any license*/eula* file in its resources directory (desktop/build,
    // when there is one) into a page of its own; desktop/ itself is checked too.
    for (const dir of ["desktop", "desktop/build"]) {
      const files = existsSync(dir) ? readdirSync(dir) : [];
      expect(files.filter((f) => /^(license|eula)/i.test(f)), dir).toEqual([]);
    }
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
    // The lists the policy is built from (src/proxy.ts builds both directives from them; proxy.test.ts pins that).
    const hosts = [...new Set([...CSP_CONNECT_HOSTS, ...CSP_FRAME_HOSTS].map((h) => h.source))];
    // Positive controls: one host sent always, and the one sent only when the browser calls Anthropic itself.
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

// Naming Microsoft is not enough: each Graph permission the app asks for is a purpose the statement
// must describe. A permission added without a line here fails.
describe("the statement says what each Microsoft Graph permission is used for", () => {
  const PURPOSE_FOR_SCOPE = {
    "User.Read": "after you sign in with your Microsoft account",
    "Files.ReadWrite.All": "SharePoint as project storage, if you choose it: your projects are read from and saved to",
    "Sites.Read.All": "SharePoint documents you browse to",
    "Calendars.Read": "Your Outlook calendar and contacts, read when you import",
    "Contacts.Read": "Your Outlook calendar and contacts, read when you import",
    "Calendars.ReadWrite": "Calendar events the app creates, updates and removes in your Outlook calendar",
    "Mail.ReadWrite": "a draft saved in your mailbox",
    "Mail.Send": "a message sent from it",
  };
  const sources = (dir) => readdirSync(dir, { recursive: true })
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.(test|spec)\.|[\\/]__/.test(f))
    .map((f) => readFileSync(`${dir}/${f}`, "utf8"))
    .join("\n");
  const SRC = sources("src/app");
  const scopes = [...new Set(SRC.match(/"(?:User|Mail|Calendars|Contacts|Files|Sites|People|Chat|Team|Tasks|Notes)\.[A-Za-z.]+"/g) ?? [])]
    .map((s) => s.slice(1, -1));

  it("every permission requested in src/app", () => {
    // Positive controls: storage and sending mail.
    expect(scopes).toContain("Files.ReadWrite.All");
    expect(scopes).toContain("Mail.Send");
    for (const s of scopes) {
      expect(PURPOSE_FOR_SCOPE[s], `${s} has no purpose in this test's list`).toBeDefined();
      expect(TEXT, s).toContain(PURPOSE_FOR_SCOPE[s]);
    }
  });

  it("SharePoint is online storage, with how to stop it, and mail is sent in the user's name", () => {
    expect(TEXT).toMatch(/unless you choose online storage \(Turso or SharePoint\)/);
    expect(TEXT).toMatch(/SharePoint as project storage[^\n]*Choose local storage in Settings > Storage to stop\./);
    expect(TEXT).toMatch(/E-mail in your name/);
    expect(TEXT).toMatch(/Microsoft account\. Sign out in Settings > Integrations to stop all of these:\n {2}- SharePoint as project storage/);
  });

  it("documents fetched by a sharing link", () => {
    expect(SRC).toMatch(/\/shares\/\$\{/);
    expect(TEXT).toContain("attach by link");
  });
});
