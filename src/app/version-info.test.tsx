import { beforeAll, describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { loadI18n, t } from "./i18n";
import { VersionInfo } from "./version-info";
import { APP_AUTHOR_URL, APP_HIGHLIGHT_KEYS, APP_LICENSE_URL, APP_REPO_URL } from "./version";

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

  it("links the licence, the source repository and the author's profile in new tabs", () => {
    render(<VersionInfo lang="en-US" />);
    const cases: [string, string][] = [
      [t("en-US", "versionLicenseName"), APP_LICENSE_URL],
      [t("en-US", "versionGithubLink"), APP_REPO_URL],
      [t("en-US", "versionLinkedInLink"), APP_AUTHOR_URL],
    ];
    for (const [name, href] of cases) {
      const link = screen.getByRole("link", { name });
      expect(link).toHaveAttribute("href", href);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
    expect(APP_REPO_URL).toBe("https://github.com/sebastianmaute/aipm-cockpit");
    expect(APP_AUTHOR_URL).toBe("https://www.linkedin.com/in/sebastian-maute/");
  });

  it("carries the author and Claude Code note, and no consultancy footer", () => {
    const { container } = render(<VersionInfo lang="en-US" />);
    expect(container).toHaveTextContent(t("en-US", "versionAuthor"));
    expect(container).toHaveTextContent("Built with Claude Code");
    expect(container).not.toHaveTextContent(/Acme|Identity Excellence/);
  });

  it("renders the German pitch when the language is German", () => {
    render(<VersionInfo lang="de" />);
    expect(screen.getByText(t("de", "versionPitch"))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: t("de", "versionGithubLink") })).toHaveAttribute("href", APP_REPO_URL);
  });
});
