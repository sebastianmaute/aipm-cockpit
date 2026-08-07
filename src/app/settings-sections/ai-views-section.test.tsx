import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AiViewsSection } from "./ai-views-section";
import { defaultSettings } from "../settings-types";
import { VIEW_AI_SCOPE } from "../view-ai-scope";
import { t } from "../i18n";
import { navLabelKey, type AppView } from "../nav-config";

const enabled = { ...defaultSettings, ai: { ...defaultSettings.ai, enabled: true } };

/** The "aiViewScopeDigest" line is identical text across every digest view, so
 *  an unscoped query for it is ambiguous. Scope to the row's own <li>. */
function rowFor(text: HTMLElement): HTMLElement {
  const li = text.closest("li");
  if (!li) throw new Error("element is not inside a row <li>");
  return li as HTMLElement;
}

describe("AiViewsSection", () => {
  // ★ Derived from VIEW_AI_SCOPE, not hardcoded. A literal count is a claim
  //   that rots the moment a view is added, and fails naming no view.
  it("shows every view's purpose without any interaction", () => {
    render(<AiViewsSection lang="en-US" settings={enabled} />);
    const views = Object.keys(VIEW_AI_SCOPE) as AppView[];
    expect(views.length).toBeGreaterThan(0);
    for (const view of views) {
      expect(screen.getByText(t("en-US", navLabelKey(view)))).toBeInTheDocument();
      expect(screen.getByText(VIEW_AI_SCOPE[view].purpose)).toBeVisible();
    }
  });

  it("renders one row per view", () => {
    render(<AiViewsSection lang="en-US" settings={enabled} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(Object.keys(VIEW_AI_SCOPE).length);
  });

  it("renders no disclosure toggles at all", () => {
    // The whole point of the change: the content is always visible, so there
    // is nothing to expand. A leftover ToggleButton would still pass a
    // "purpose is visible" assertion, so assert the ABSENCE of the control.
    render(<AiViewsSection lang="en-US" settings={enabled} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("renders only the enable hint while the AI master switch is off", () => {
    render(<AiViewsSection lang="en-US" settings={defaultSettings} />);
    expect(screen.getByText(t("en-US", "aiEnableHelp"))).toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  // Optional-field branches carried over from ai-view-scope-disclosure.test.tsx:
  // `reading`, the `toolHints` <code> line, and the VIEW_AI_DIGEST line have no
  // coverage otherwise. "chat" carries none of the three; "workload" carries
  // all three (it is also a digest view).
  it("renders the reading, toolHints and digest lines when present, and omits them when absent", () => {
    render(<AiViewsSection lang="en-US" settings={enabled} />);

    const workloadRow = within(rowFor(screen.getByText(/capacity versus allocation/i)));
    expect(workloadRow.getByText(/overload = allocated exceeds capacity/i)).toBeVisible();
    expect(workloadRow.getByText("list_resources, list_allocations")).toBeVisible();
    expect(workloadRow.getByText(t("en-US", "aiViewScopeDigest"))).toBeVisible();

    // "chat" carries none of the three optional fields; its nav label is
    // "AI Assistant" (tabChat), not "Chat".
    const chatRow = within(rowFor(screen.getByText(/the chat surface itself/i)));
    expect(chatRow.queryByText(t("en-US", "aiViewScopeDigest"))).not.toBeInTheDocument();
    expect(chatRow.queryByRole("code")).toBeNull();
  });

  it("shows the intro paragraph", () => {
    render(<AiViewsSection lang="en-US" settings={enabled} />);
    expect(screen.getByText(t("en-US", "aiViewScopeIntro"))).toBeInTheDocument();
  });
});
