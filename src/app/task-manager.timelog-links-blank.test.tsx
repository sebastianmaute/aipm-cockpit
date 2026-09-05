// ★★★ THE OUTER HALF OF THE GUARDRAIL BYTE-STABILITY RULE, PINNED AT ITS ONLY
// CALL SITE. `workspaceToJson` emits a `timelogLinks` key for ANY truthy blob
// (`workspace.ts`, the `...(ws.timelogLinks ? { timelogLinks: … } : {})`
// spread), so a settings writer that hands back `{userLinks: [], projectLinks:
// []}` where the workspace previously held `undefined` puts a NEW key into
// every exported artifact — which is exactly what a user who switches a
// guardrail on and straight back off would otherwise leave behind. The task
// manager therefore routes the write through `isBlankTimelogLinks` and stores
// `undefined` rather than the empty blob.
//
// ★★★ THE HELPER WAS TESTED AND THE WIRING WAS NOT, which is the same shape as
// the gap `task-manager.guardrail-reconcile.test.tsx` records for the
// `evaluated` set: a hardcoded substitution at that file's sole call site left
// 321 tests green. A one-line ternary is not self-evidently safe just because
// it is short — nothing else in the suite renders this handler at all.
//
// ★★★ THE PROP CANNOT SETTLE IT, AND THAT IS THE WHOLE DIFFICULTY. The task
// manager passes `timelogLinks ?? EMPTY_TIMELOG_LINKS`, so from inside
// `SettingsView` the stored `undefined` and a stored `{userLinks: [],
// projectLinks: []}` are BYTE-IDENTICAL — a probe asserting on the prop is
// green against the very mutant this file exists to kill. So the probe reads
// the RAW context slice through `useWorkspace()` instead, and prints the word
// "undefined" for the absent case so the two are distinguishable in the DOM.
//
// ★★ BOTH DIRECTIONS LIVE IN THE ONE TEST AND EACH IS THE OTHER'S ANTI-VACUITY
// CONTROL. The first write seeds a real policy and asserts it lands: without
// it, a handler that silently did NOTHING would satisfy the "no blob" assertion
// for entirely the wrong reason, since the slice starts out `undefined` anyway.
// The second write is the mutant-killer.
//
// ★ It is a SIBLING of the reconcile file rather than a third describe block
// inside it, deliberately: that file's header makes narrow three-star claims
// about what it pins, and this concern needs a module-scope
// `vi.mock("./settings-view")` that would silently change the module graph
// under two tests whose comments say nothing about it. The cost is one more
// slow TaskManager mount.
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelogLinks } from "./timelog-types";

let setActiveTabRef: ((v: "settings") => void) | null = null;
let onTimelogLinksChangeRef: ((next: TimelogLinks) => void) | null = null;

// The default view's pane, replaced by a probe that only has to hand back the
// navigation setter — `ModernShell` renders the settings view INSTEAD of the
// workspace, so nothing inside `WorkspaceSection` is mounted once we navigate.
vi.mock("./workspace-section", async (importOriginal) => {
  const { useWorkspaceTab } = await import("./workspace-tab-context");
  return {
    ...(await importOriginal<typeof import("./workspace-section")>()),
    WorkspaceSection: () => {
      setActiveTabRef = useWorkspaceTab().setActiveTab as (v: "settings") => void;
      return <div data-testid="ws-probe" />;
    },
  };
});

// ★★ The probe reads the workspace slice ITSELF rather than trusting its own
// props, for the reason in the header: the `?? EMPTY_TIMELOG_LINKS` fallback
// makes stored-undefined and stored-empty indistinguishable from out here.
vi.mock("./settings-view", async (importOriginal) => {
  const { useWorkspace } = await import("./workspace-context");
  return {
    ...(await importOriginal<typeof import("./settings-view")>()),
    SettingsView: (props: { onTimelogLinksChange?: (next: TimelogLinks) => void }) => {
      const ws = useWorkspace();
      onTimelogLinksChangeRef = props.onTimelogLinksChange ?? null;
      return (
        <div data-testid="settings-probe">
          {ws.timelogLinks === undefined ? "undefined" : JSON.stringify(ws.timelogLinks)}
        </div>
      );
    },
  };
});

import TaskManager from "./task-manager";

const PROJECT = "p1";
/** The first render pulls the whole task-manager tree through the vitest
 *  transform, which is genuinely slow — same budget the reconcile file uses. */
const MOUNT_MS = 40000;
const TEST_MS = 60000;

/** One rule on and nothing else: the smallest blob that is NOT blank. */
const CONFIGURED: TimelogLinks = {
  userLinks: [],
  projectLinks: [],
  policy: { timelogNonWorkingDay: { enabled: true } },
};

/** What the settings section hands back after that rule is switched off again —
 *  `setRule` has already pruned the defaulted rule and dropped the `policy`
 *  key, so what arrives here is the empty blob, not an empty policy. */
const BLANK: TimelogLinks = { userLinks: [], projectLinks: [] };

function slice(): string {
  return screen.getByTestId("settings-probe").textContent ?? "";
}

beforeEach(() => {
  setActiveTabRef = null;
  onTimelogLinksChangeRef = null;
  window.localStorage.clear();
  window.localStorage.setItem(
    "aipm-cockpit:projects",
    JSON.stringify({
      projects: [{ id: PROJECT, name: "Seed", code: "SEED", storageConfig: { kind: "browser" } }],
      currentProjectId: PROJECT,
    }),
  );
});

describe("task-manager → the timelogLinks write handed to SettingsView", () => {
  it("stores undefined, not an empty blob, once the guardrail policy is emptied", async () => {
    render(<TaskManager />);
    await screen.findByTestId("ws-probe", undefined, { timeout: MOUNT_MS });
    await waitFor(() => expect(typeof setActiveTabRef).toBe("function"), { timeout: MOUNT_MS });

    act(() => setActiveTabRef!("settings"));
    await screen.findByTestId("settings-probe", undefined, { timeout: MOUNT_MS });
    await waitFor(() => expect(typeof onTimelogLinksChangeRef).toBe("function"), {
      timeout: MOUNT_MS,
    });

    // Nothing configured yet — and note this is the SAME text the mutant
    // produces at the end, which is why the write below is not optional.
    expect(slice()).toBe("undefined");

    // ANTI-VACUITY CONTROL: the handler really does write. Without this, a
    // handler that dropped every call would pass the final assertion, because
    // the slice was already `undefined` before anything happened.
    act(() => onTimelogLinksChangeRef!(CONFIGURED));
    await waitFor(() => expect(slice()).toContain("timelogNonWorkingDay"));

    // ★★★ THE MUTANT-KILLER. `setTimelogLinks(next)` — i.e. dropping the
    // `isBlankTimelogLinks` ternary — stores the empty blob and this reads
    // `{"userLinks":[],"projectLinks":[]}`, which is truthy in `workspaceToJson`
    // and puts a `timelogLinks` key into the export.
    act(() => onTimelogLinksChangeRef!(BLANK));
    await waitFor(() => expect(slice()).toBe("undefined"));
  }, TEST_MS);
});
