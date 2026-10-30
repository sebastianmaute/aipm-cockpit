// AI people protection, Task 5 review round 1 (I2): with protection on, the dictation mic's
// replacement appears only where a mic would have rendered, stays compact, and never joins a
// control's accessible name — the milestone name's mic sits INSIDE its <label>.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider } from "./workspace-context";
import { MilestoneEditModal } from "./milestone-edit-modal";
import { AiPrivacyProvider, useAiPrivacySource } from "./ai-privacy-context";
import { withPeopleAllowed } from "./ai-people-protection";
import { emptyWorkspace, type Workspace } from "./workspace";
import { t } from "./i18n";

vi.mock("./use-settings", () => ({
  useSettings: () => ({ settings: { ai: {}, integrations: { m365: { enabled: false, sharepoint: false } } }, setSettings: vi.fn(), hydrated: true, i18nReady: true, lang: "en-US" }),
}));
vi.mock("./use-ms-auth", () => ({
  useMsAuth: () => ({ account: null, ready: true, signIn: vi.fn(), signOut: vi.fn(), acquireToken: vi.fn(async () => "tok") }),
}));

beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore jsdom polyfill
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore jsdom polyfill
  Range.prototype.getBoundingClientRect = () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) });
});

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
});

const NAME = `${t("en-US", "milestoneName")} *`;
const REASON = t("en-US", "dictationUnavailablePeopleProtected");

function renderModal(ws: Workspace) {
  function Source({ children }: { children: ReactNode }) {
    useAiPrivacySource("p1", () => ws);
    return <>{children}</>;
  }
  return render(
    <FiltersProvider>
      <WorkspaceProvider>
        <AiPrivacyProvider>
          <Source>
            <MilestoneEditModal
              lang="en-US"
              milestone={{ id: 1, name: "M1", date: "2026-08-01", linkedTaskIds: [] }}
              isNew={false}
              tasks={[]}
              onSave={vi.fn()}
              onDelete={vi.fn()}
              onClose={vi.fn()}
            />
          </Source>
        </AiPrivacyProvider>
      </WorkspaceProvider>
    </FiltersProvider>,
  );
}

describe("dictation replacement under people protection (I2)", () => {
  it("keeps the milestone name's accessible name unchanged, and gives the reason as a tooltip", () => {
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition = class {};
    const { container } = renderModal(emptyWorkspace()); // no override: protected
    expect(screen.getByRole("textbox", { name: NAME })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /hold to dictate/i })).toBeNull();
    const off = container.querySelectorAll("[data-dictation-off]");
    expect(off.length).toBeGreaterThan(0);
    expect(off[0]!.getAttribute("title")).toBe(REASON);
    // Compact: the sentence is never body text.
    expect(container.textContent).not.toContain(REASON);
  });

  // The control: allowed, the mic is a real button.
  // (Allowed, the mic button inside the label already joins the name, "Name * Hold to dictate – Name" — pre-existing,
  // not this task's; the protected marker must add nothing, which the test above pins as exactly "Name *".)
  it("allowed, the mic renders", () => {
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition = class {};
    const { container } = renderModal({ ...emptyWorkspace(), settingsOverrides: withPeopleAllowed(undefined, true) });
    expect(screen.getAllByRole("button", { name: /hold to dictate/i }).length).toBeGreaterThan(0);
    expect(container.querySelector("[data-dictation-off]")).toBeNull();
  });

  it("renders nothing where no mic is supported", () => {
    const { container } = renderModal(emptyWorkspace());
    expect(container.querySelector("[data-dictation-off]")).toBeNull();
    expect(screen.getByRole("textbox", { name: NAME })).toBeTruthy();
  });
});
