// src/test/ask-claude-harness.ts — shared helpers for the full-mount tests of
// the view an "Ask Claude" send reports (§702, §703):
// `task-manager.ask-claude-view.test.tsx` and
// `task-manager.ask-claude-open-points.test.tsx`.
//
// ★★ THE TWO CASES LIVE IN SEPARATE FILES ON PURPOSE. ChatPanel is a
//    module-level `dynamic(...)` import, so once one test has loaded its chunk,
//    every later test in the same file starts with it loaded. The first-press
//    case needs the chunk NOT loaded, and the Open Points case loads it first,
//    so in one file the pair depended on test order: measured red at
//    `--sequence.shuffle --sequence.seed=3`, the seed that runs Open Points
//    first. Vitest gives each file its own module registry. Do not merge them
//    back, and do not add a test that loads the chunk to the first file.
// ★ The guide-load mock stays in each test file: `vi.mock` is hoisted per
//   file, so each file declares its own counter and passes it here.

import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { newConsent } from "../app/ai-consent";
import { expect, vi } from "vitest";
import { SETTINGS_KEY } from "../app/use-settings";
import { defaultAiConfig } from "../app/settings-types";

export type WireBody = { system: { text: string }[]; messages: unknown[] };

/** Counts the operating-guide store's loads, so a test can wait until every one has settled. */
export interface GuideLoadCounter {
  started: number;
  settled: number;
}

export function seedRegistry() {
  window.localStorage.setItem(
    "aipm-cockpit:projects",
    JSON.stringify({
      projects: [{ id: "p1", name: "Seed", code: "SEED", storageConfig: { kind: "browser" } }],
      currentProjectId: "p1",
    }),
  );
}

export function seedAiSettings() {
  window.localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({ ai: { ...defaultAiConfig, enabled: true, consent: newConsent(new Date(0)), apiKey: "sk-test" } }),
  );
}

/** Answers every Claude request with "done" and records its body. */
export function mockClaude(bodies: WireBody[]) {
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/v1/messages")) {
      bodies.push(JSON.parse(String(init?.body)) as WireBody);
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(""),
        json: () =>
          Promise.resolve({
            content: [{ type: "text", text: "done" }],
            stop_reason: "end_turn",
            usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          }),
      } as unknown as Response);
    }
    if (url.includes("/v1/models")) {
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(""),
        json: () => Promise.resolve({ data: [] }),
      } as unknown as Response);
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`));
  });
}

/** Presses Ask Claude in the header, picks the first prompt, waits for request n. */
export async function askFromHere(bodies: WireBody[], n: number) {
  fireEvent.click(within(screen.getByRole("banner")).getByRole("button", { name: "Ask Claude" }));
  const menu = await screen.findByRole("dialog", { name: "Ask Claude" });
  fireEvent.click(within(menu).getAllByRole("button")[0]);
  await waitFor(() => expect(bodies).toHaveLength(n), { timeout: 15_000 });
}

/**
 * Waits until every guide load has settled, so a press sends instead of prefilling.
 * The guide library loads asynchronously, and a press made before it is ready
 * only PREFILLS the box: ChatPanel's send gate blocks while guides are pending.
 * ★ The count stands in for readiness ONLY on the localStorage backend these
 *   tests use (no Turso config): `refresh` marks the library loaded a
 *   microtask after the last load settles, and its save-then-reload gap is
 *   microtask-only too. Against Turso that gap is a network wait, and a
 *   settled count could read true before the reload starts — don't copy it.
 */
export async function waitForGuides(loads: GuideLoadCounter) {
  await waitFor(
    () => {
      expect(loads.settled).toBeGreaterThan(0);
      expect(loads.settled).toBe(loads.started);
    },
    { timeout: 15_000 },
  );
}

/** The `Current view:` line the request's turn context carried. */
export function reportedView(body: WireBody): string | undefined {
  return JSON.stringify(body.messages).match(/Current view: ([\w-]+)\./)?.[1];
}
