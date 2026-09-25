import { beforeAll, describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { loadI18n, t } from "./i18n";
import { VersionInfo } from "./version-info";
import {
  APP_AUTHOR_URL,
  APP_HIGHLIGHT_KEYS,
  APP_LICENSE_URL,
  APP_RELEASES_URL,
  APP_REPO_URL,
  APP_SPONSOR_URL,
} from "./version";

const ELECTRON_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "aipm-cockpit/1.0.0 Chrome/152.0.7977.78 Electron/44.3.0 Safari/537.36";

// Stub the UA by shadowing the prototype accessor, then restore exactly what
// was there -- mirrors task-manager-ui.test.tsx's withUserAgent (replacing the
// whole `navigator` with vi.stubGlobal would take RTL's own navigator APIs
// down with it).
function withUserAgent(userAgent: string, run: () => void): void {
  const original = Object.getOwnPropertyDescriptor(navigator, "userAgent");
  Object.defineProperty(navigator, "userAgent", { value: userAgent, configurable: true });
  try {
    run();
  } finally {
    if (original) Object.defineProperty(navigator, "userAgent", original);
    else delete (navigator as unknown as Record<string, unknown>).userAgent;
  }
}

describe("VersionInfo", () => {
  beforeAll(async () => {
    await loadI18n("de");
  });

  it("shows the pitch line and exactly the pitch highlights", () => {
    render(<VersionInfo lang="en-US" />);
    expect(screen.getByText(t("en-US", "versionPitch"))).toBeInTheDocument();
    const list = screen.getByRole("list");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(APP_HIGHLIGHT_KEYS.length);
    APP_HIGHLIGHT_KEYS.forEach((k, i) => {
      expect(items[i]).toHaveTextContent(t("en-US", k));
    });
  });

  it("links the licence, the source repository, the author's profile and the sponsor page in new tabs", () => {
    render(<VersionInfo lang="en-US" />);
    const cases: [string, string][] = [
      [t("en-US", "versionLicenseName"), APP_LICENSE_URL],
      [t("en-US", "versionGithubLink"), APP_REPO_URL],
      [t("en-US", "versionLinkedInLink"), APP_AUTHOR_URL],
      [t("en-US", "versionSponsorLink"), APP_SPONSOR_URL],
    ];
    for (const [name, href] of cases) {
      const link = screen.getByRole("link", { name });
      expect(link).toHaveAttribute("href", href);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
    expect(APP_REPO_URL).toBe("https://github.com/sebastianmaute/aipm-cockpit");
    expect(APP_AUTHOR_URL).toBe("https://www.linkedin.com/in/sebastian-maute/");
    expect(APP_SPONSOR_URL).toBe("https://github.com/sponsors/sebastianmaute");
  });

  it("carries the author and Claude Code note, and no consultancy footer", () => {
    const { container } = render(<VersionInfo lang="en-US" />);
    expect(container).toHaveTextContent(t("en-US", "versionAuthor"));
    expect(container).toHaveTextContent("Built with Claude Code");
    expect(container).not.toHaveTextContent(/Identity Excellence/);
  });

  it("renders the German pitch when the language is German", () => {
    render(<VersionInfo lang="de" />);
    expect(screen.getByText(t("de", "versionPitch"))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: t("de", "versionGithubLink") })).toHaveAttribute("href", APP_REPO_URL);
  });
});

describe("VersionInfo desktop-only section", () => {
  beforeAll(async () => {
    await loadI18n("de");
  });

  it("is ABSENT under a browser user agent, even with a log path supplied", () => {
    // ★★★ THE MUTANT THIS GUARDS: deleting the `isDesktop &&` guard entirely.
    // Supplying a logPath here proves the section is gated on the UA check,
    // not merely on whether a log path was passed.
    withUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0 Safari/537.36", () => {
      // ★ `logPath={"..."}` (an EXPRESSION), not `logPath="..."`: a plain JSX
      // string attribute is raw text, not a JS string literal, so `\\` inside
      // one is NOT an escape and would pass a literal double backslash.
      render(<VersionInfo lang="en-US" logPath={"C:\\logs\\launch.log"} />);
      expect(screen.queryByText(t("en-US", "versionUpdatesManual"))).not.toBeInTheDocument();
      expect(
        screen.queryByRole("link", { name: t("en-US", "versionReleasesLink") }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText("C:\\logs\\launch.log")).not.toBeInTheDocument();
    });
  });

  it("is PRESENT under the Electron user agent: updates-manual line and Releases link", () => {
    withUserAgent(ELECTRON_UA, () => {
      render(<VersionInfo lang="en-US" />);
      expect(screen.getByText(t("en-US", "versionUpdatesManual"))).toBeInTheDocument();
      const link = screen.getByRole("link", { name: t("en-US", "versionReleasesLink") });
      expect(link).toHaveAttribute("href", APP_RELEASES_URL);
      expect(link).toHaveAttribute("target", "_blank");
    });
  });

  it("shows the log-file row ONLY when a logPath prop was supplied", () => {
    withUserAgent(ELECTRON_UA, () => {
      const { rerender } = render(<VersionInfo lang="en-US" />);
      expect(screen.queryByText(t("en-US", "versionLogPathLabel"))).not.toBeInTheDocument();

      rerender(
        <VersionInfo
          lang="en-US"
          logPath={"C:\\Users\\x\\AppData\\Local\\aipm-cockpit\\logs\\launch.log"}
        />,
      );
      expect(screen.getByText(t("en-US", "versionLogPathLabel"))).toBeInTheDocument();
      expect(
        screen.getByText("C:\\Users\\x\\AppData\\Local\\aipm-cockpit\\logs\\launch.log"),
      ).toBeInTheDocument();
    });
  });

  it("renders the desktop-only section in German too", () => {
    withUserAgent(ELECTRON_UA, () => {
      render(<VersionInfo lang="de" logPath={"C:\\logs\\launch.log"} />);
      expect(screen.getByText(t("de", "versionUpdatesManual"))).toBeInTheDocument();
      expect(screen.getByText(t("de", "versionLogPathLabel"))).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: t("de", "versionReleasesLink") }),
      ).toHaveAttribute("href", APP_RELEASES_URL);
    });
  });
});
