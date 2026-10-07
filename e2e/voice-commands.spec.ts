import type { Page } from "@playwright/test";
import { test, expect, gotoApp, openView } from "./seed";
import { SEED_WORKSPACE } from "./seed-workspace";

/**
 * §234 — voice commands, end to end, through a FAKE `SpeechRecognition`. A
 * headless browser has no microphone, so `addInitScript` installs a recogniser
 * whose `start()` delivers one final result carrying the transcript the test
 * set, then ends — the shape `startRecognition` (`voice.ts`) reads. Everything
 * after the transcript is real: the header's Voice command button, `parseCommand`
 * and the command dispatch in `use-bulk-operations.ts`.
 *
 * ★ The result is delivered on a MICROTASK, not a timer: `gotoApp` installs a
 *  fake clock, so a `setTimeout` inside the page would never fire.
 *
 * Run on a free port. The run boots its own server from THIS checkout and stops it
 * afterwards; on a taken port it refuses rather than attaching (since §58 (b)):
 *   PORT=3250 npx playwright test e2e/voice-commands.spec.ts --project=chromium --workers=1
 */

/** Skip the welcome tour, whose modal would sit over every control. Only when no
 *  settings exist yet, so a later navigation never resets what the app stored. */
async function skipTour(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const key = "aipm-cockpit:settings";
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ tourSeen: true }));
  });
}

async function installFakeRecognition(page: Page): Promise<void> {
  await skipTour(page);
  await page.addInitScript(() => {
    class FakeRecognition {
      lang = "";
      continuous = false;
      interimResults = false;
      maxAlternatives = 1;
      onresult: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      start(): void {
        const transcript = (window as unknown as { __voiceTranscript?: string }).__voiceTranscript ?? "";
        void Promise.resolve().then(() => {
          const result = Object.assign([{ transcript, confidence: 1 }], { isFinal: true });
          this.onresult?.({ resultIndex: 0, results: [result] });
          this.onend?.();
        });
      }
      stop(): void {}
      abort(): void {}
    }
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;
  });
}

async function speak(page: Page, transcript: string): Promise<void> {
  await page.evaluate((text) => {
    (window as unknown as { __voiceTranscript?: string }).__voiceTranscript = text;
  }, transcript);
  await page.getByRole("button", { name: "Voice command", exact: true }).first().click();
}

test("“add task …” opens the task editor with the spoken name", async ({ page }) => {
  await installFakeRecognition(page);
  await gotoApp(page);
  await openView(page, "Open Points");

  await speak(page, "add task Order the steering pack");

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("textbox", { name: "Task name", exact: true })).toHaveValue("Order the steering pack");
});

test("“search for …” filters Open Points to the spoken text", async ({ page }) => {
  // Two seeded tasks whose names do not contain each other, so the filter has
  // something to hide and something to keep.
  const names = (SEED_WORKSPACE.tasks as { taskName: string }[]).map((t) => t.taskName);
  const kept = names[0];
  const hidden = names.find((n) => !n.toLowerCase().includes(kept.toLowerCase()) && !kept.toLowerCase().includes(n.toLowerCase()));
  if (!hidden) throw new Error("the seed has no second task to filter out — the check below would prove nothing");

  await installFakeRecognition(page);
  await gotoApp(page);
  await openView(page, "Open Points");
  await expect(page.getByText(hidden, { exact: true }).first()).toBeVisible();

  await speak(page, `search for ${kept}`);

  await expect(page.getByRole("searchbox").or(page.getByPlaceholder("Search task name, assignee, blockers, notes…")).first()).toHaveValue(kept);
  await expect(page.getByText(kept, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(hidden, { exact: true })).toHaveCount(0);
});
