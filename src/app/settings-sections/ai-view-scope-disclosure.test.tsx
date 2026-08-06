import { describe, it, expect, beforeAll } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AiViewScopeDisclosure } from "./ai-view-scope-disclosure";
import { loadI18n, t } from "../i18n";

/** The "aiViewScopeDigest" line is identical text across all four digest
 *  views (open-points/workload/gantt/budget), and every row's panel is
 *  ALWAYS mounted — so an unscoped text query for it is ambiguous. Scope to
 *  the row's own <li>. */
function rowFor(button: HTMLElement): HTMLElement {
  const li = button.closest("li");
  if (!li) throw new Error("button is not inside a row <li>");
  return li as HTMLElement;
}

describe("AiViewScopeDisclosure", () => {
  beforeAll(async () => {
    await loadI18n("de");
  });

  it("lists every view", () => {
    render(<AiViewScopeDisclosure lang="en-US" />);
    expect(screen.getAllByRole("button", { name: /show/i }).length).toBe(34);
  });

  // N identical "Show" buttons is a WCAG 2.4.6 failure that axe can pass when
  // only one row renders at scan time. Row-unique names are the fix.
  it("gives every toggle a row-unique accessible name", () => {
    render(<AiViewScopeDisclosure lang="en-US" />);
    const names = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(new Set(names).size).toBe(names.length);
  });

  it("reveals the purpose text when a row is expanded", async () => {
    const user = userEvent.setup();
    render(<AiViewScopeDisclosure lang="en-US" />);
    await user.click(screen.getByRole("button", { name: /workload/i }));
    expect(screen.getByText(/capacity versus allocation/i)).toBeInTheDocument();
  });

  // ★★ "Reachable" is not "operable". The previous version stopped at the tab
  // landing on a BUTTON, which this component cannot fail — it renders nothing
  // else focusable. Swapping the row's `onClick` for `onMouseDown` makes the
  // control keyboard-INOPERABLE and left that assertion green. Drive an actual
  // key and assert the state flips. (`user.tab()` rather than `.focus()`:
  // calling .focus() directly proves nothing about tab order.)
  it("is operable by keyboard: Enter on the focused row expands it", async () => {
    const user = userEvent.setup();
    render(<AiViewScopeDisclosure lang="en-US" />);
    await user.tab();
    const focused = document.activeElement as HTMLElement;
    expect(focused.tagName).toBe("BUTTON");
    expect(focused).toHaveAttribute("aria-expanded", "false");
    await user.keyboard("{Enter}");
    expect(focused).toHaveAttribute("aria-expanded", "true");
  });

  // ★ The panel is ALWAYS mounted (aria-controls target must stay in the DOM
  //   even collapsed — see action-reasons.tsx). testing-library's `getByText`
  //   does not filter on the `hidden` attribute, so the content IS findable
  //   before the click; the assertion has to be on visibility, not presence.
  it("keeps the content hidden (not visible) before the first click", () => {
    render(<AiViewScopeDisclosure lang="en-US" />);
    const purpose = screen.getByText(/capacity versus allocation/i);
    expect(purpose).not.toBeVisible();
  });

  it("collapses again on a second click", async () => {
    const user = userEvent.setup();
    render(<AiViewScopeDisclosure lang="en-US" />);
    const button = screen.getByRole("button", { name: /workload/i });
    await user.click(button);
    expect(screen.getByText(/capacity versus allocation/i)).toBeVisible();
    await user.click(button);
    expect(screen.getByText(/capacity versus allocation/i)).not.toBeVisible();
  });

  // Pins the ARIA attribute itself, not just text visibility — a regression
  // to the wrong attribute (e.g. back to aria-pressed) would otherwise pass.
  it("wires aria-expanded and aria-controls to the panel id, never aria-pressed", async () => {
    const user = userEvent.setup();
    render(<AiViewScopeDisclosure lang="en-US" />);
    const button = screen.getByRole("button", { name: /workload/i });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).not.toHaveAttribute("aria-pressed");
    const controlsId = button.getAttribute("aria-controls");
    expect(controlsId).toBeTruthy();
    expect(document.getElementById(controlsId as string)).toBeInTheDocument();

    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).not.toHaveAttribute("aria-pressed");
  });

  it("opens two rows independently", async () => {
    const user = userEvent.setup();
    render(<AiViewScopeDisclosure lang="en-US" />);
    await user.click(screen.getByRole("button", { name: /workload/i }));
    await user.click(screen.getByRole("button", { name: /gantt/i }));
    expect(screen.getByRole("button", { name: /workload/i })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /gantt/i })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/capacity versus allocation/i)).toBeVisible();
    expect(screen.getByText(/finish-to-start/i)).toBeVisible();
  });

  // Optional-field branches: `reading`, the `toolHints` <code> line, and the
  // VIEW_AI_DIGEST line all have no coverage otherwise. "chat" carries none
  // of the three; "workload" carries all three (it is also a digest view).
  it("renders the reading, toolHints and digest lines when present, and omits them when absent", async () => {
    const user = userEvent.setup();
    render(<AiViewScopeDisclosure lang="en-US" />);

    const workloadButton = screen.getByRole("button", { name: /workload/i });
    await user.click(workloadButton);
    const workloadRow = within(rowFor(workloadButton));
    expect(workloadRow.getByText(/overload = allocated exceeds capacity/i)).toBeVisible();
    expect(workloadRow.getByText("list_resources, list_allocations")).toBeVisible();
    expect(workloadRow.getByText(t("en-US", "aiViewScopeDigest"))).toBeVisible();

    // "chat" carries none of the three optional fields; its nav label is
    // "AI Assistant" (tabChat), not "Chat".
    const chatButton = screen.getByRole("button", { name: /ai assistant/i });
    await user.click(chatButton);
    const chatRow = within(rowFor(chatButton));
    expect(chatRow.getByText(/the chat surface itself/i)).toBeVisible();
    expect(chatRow.queryByText(t("en-US", "aiViewScopeDigest"))).not.toBeInTheDocument();
  });
});
