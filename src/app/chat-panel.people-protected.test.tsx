import "fake-indexeddb/auto";
import "../test/ai-consent-live";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import type { ReactNode } from "react";
import { ChatPanel } from "./chat-panel";
import { AiPrivacyProvider, useAiPrivacySource } from "./ai-privacy-context";
import { withPeopleAllowed } from "./ai-people-protection";
import { newConsent } from "./ai-consent";
import { defaultAiConfig } from "./settings-types";
import { emptyWorkspace, type Workspace } from "./workspace";
import { t } from "./i18n";
import type { ToolDispatcher } from "./chat-tools";
import type { ChatConversation } from "./workspace-tab-context";

// AI people protection, Task 4: an image (or a document whose text cannot be extracted) cannot be
// redacted, so with protection on the transport refuses the request before sending it. The chat says
// why, and that the image in the conversation is what blocks it: an earlier one blocks every later send.

vi.mock("./chat-threads-store", () => ({
  loadThreads: vi.fn(async () => []),
  saveThread: vi.fn(async () => undefined),
  deleteThread: vi.fn(async () => undefined),
}));

const SCOPE_PROPS = { getScopeEpoch: () => 0, isSwapInFlight: () => false };
const AI = { ...defaultAiConfig, enabled: true, consent: newConsent(new Date(0)), apiKey: "sk-test" };

function makeDispatcher(): ToolDispatcher {
  return {
    getSnapshot: vi.fn(() => ({
      today: "2026-06-04", language: "en-US", holidayCountries: [], storageKind: "memory", taskCount: 0,
      knownGroups: [], knownLabels: [], mode: "advanced" as const, enabledModules: [] as string[],
      currentView: "open-points" as const,
    })),
  } as unknown as ToolDispatcher;
}

// An image sent earlier in this conversation.
const withImage: ChatConversation = {
  history: [
    { role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } }] },
    { role: "assistant", content: [{ type: "text", text: "I see a chart." }] },
  ],
  display: [
    { kind: "user", text: "chart.png" },
    { kind: "assistant", text: "I see a chart." },
  ],
};

// `ws` is read at every ask, like task-manager's live workspace reader, so a test can flip the setting.
function renderOpen(ws: Workspace | (() => Workspace), conversation: ChatConversation = withImage) {
  const read = typeof ws === "function" ? ws : () => ws;
  function Source({ children }: { children: ReactNode }) {
    useAiPrivacySource("p1", read, () => 0);
    return <>{children}</>;
  }
  return render(
    <AiPrivacyProvider>
      <Source>
        <ChatPanel {...SCOPE_PROPS} lang="en-US" ai={AI} dispatcher={makeDispatcher()} projectId="p1" getChatConversation={() => conversation} />
      </Source>
    </AiPrivacyProvider>,
  );
}

const EMPTY_CONVERSATION: ChatConversation = { history: [], display: [] };
const ALLOWED: Workspace = { ...emptyWorkspace(), settingsOverrides: withPeopleAllowed(undefined, true) };

function stubMessages(): string[] {
  const bodies: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation((_url, init?: RequestInit) => {
    bodies.push(String(init?.body ?? ""));
    return Promise.resolve(new Response(JSON.stringify({
      content: [{ type: "text", text: "Done." }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 },
    }), { status: 200 }));
  });
  return bodies;
}

function send(text: string) {
  fireEvent.change(screen.getByPlaceholderText("Ask Claude about your tasks…"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
}

afterEach(() => vi.restoreAllMocks());

describe("chat with people protection and an image in the conversation", () => {
  it("sends nothing and says the image blocks it", async () => {
    const bodies = stubMessages();
    renderOpen(emptyWorkspace()); // no override: protected by default
    send("What does the chart say?");
    expect(await screen.findByText(t("en-US", "chatPeopleProtectedContent"))).toBeTruthy();
    expect(bodies).toEqual([]);
  });

  // The positive control: the same conversation goes out when the project allows people, so the message
  // above is the protection's refusal and not a failure of the fixture.
  it("sends as before when the project allows people", async () => {
    const bodies = stubMessages();
    renderOpen({ ...emptyWorkspace(), settingsOverrides: withPeopleAllowed(undefined, true) });
    send("What does the chart say?");
    expect(await screen.findByText("Done.")).toBeTruthy();
    expect(bodies).toHaveLength(1);
    expect(screen.queryByText(t("en-US", "chatPeopleProtectedContent"))).toBeNull();
  });
});

// Review 2, finding A: under protection an image or a PDF is refused when it is ATTACHED, with the reason,
// and never reaches the composer or the conversation. A send whose composer still holds one (protection
// turned on after attaching) is refused BEFORE the turn is committed, so the user can remove it.
const PNG = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "chart.png", { type: "image/png" });
const PDF = () => new File(["%PDF-1.4 scanned"], "scan.pdf", { type: "application/pdf" });
const TXT = () => new File(["Alice owns the budget."], "notes.txt", { type: "text/plain" });
const EML = () => new File([[
  "From: alice@example.com",
  "Subject: Status",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="XYZ"',
  "",
  "--XYZ",
  "Content-Type: text/plain",
  "",
  "The chart is attached.",
  "--XYZ",
  'Content-Type: image/png; name="pic.png"',
  'Content-Disposition: attachment; filename="pic.png"',
  "Content-Transfer-Encoding: base64",
  "",
  "iVBORw0KGgo=",
  "--XYZ--",
  "",
].join("\r\n")], "status.eml", { type: "message/rfc822" });

function attach(container: HTMLElement, files: File[]) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files } });
}

describe("attaching under people protection (review 2, A)", () => {
  it("refuses an image and a PDF with a reason and stages no chip", async () => {
    stubMessages();
    const { container } = renderOpen(emptyWorkspace(), EMPTY_CONVERSATION);
    attach(container, [PNG(), PDF()]);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(t("en-US", "chatAttachmentPeopleProtected", "chart.png"));
    expect(alert).toHaveTextContent(t("en-US", "chatAttachmentPeopleProtected", "scan.pdf"));
    expect(screen.queryByRole("button", { name: t("en-US", "chatAttachmentRemove", "chart.png") })).toBeNull();
    expect(screen.queryByRole("button", { name: t("en-US", "chatAttachmentRemove", "scan.pdf") })).toBeNull();
  });

  it("still stages a text file (its text is redacted on send)", async () => {
    stubMessages();
    const { container } = renderOpen(emptyWorkspace(), EMPTY_CONVERSATION);
    attach(container, [TXT()]);
    expect(await screen.findByRole("button", { name: t("en-US", "chatAttachmentRemove", "notes.txt") })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps a mail's text but leaves its image out, naming the mail", async () => {
    const bodies = stubMessages();
    const { container } = renderOpen(emptyWorkspace(), EMPTY_CONVERSATION);
    attach(container, [EML()]);
    expect(await screen.findByRole("button", { name: t("en-US", "chatAttachmentRemove", "status.eml") })).toBeTruthy();
    expect(screen.getByRole("alert")).toHaveTextContent(t("en-US", "chatAttachmentPeopleProtected", "status.eml"));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Done.")).toBeTruthy();
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain("The chart is attached.");
    expect(bodies[0]).not.toContain("\"type\":\"image\"");
  });

  it("stages an image as before when the project allows people", async () => {
    stubMessages();
    const { container } = renderOpen(ALLOWED, EMPTY_CONVERSATION);
    attach(container, [PNG()]);
    expect(await screen.findByRole("button", { name: t("en-US", "chatAttachmentRemove", "chart.png") })).toBeTruthy();
    expect(screen.queryByText(t("en-US", "chatAttachmentPeopleProtected", "chart.png"))).toBeNull();
  });
});

describe("sending under people protection (review 2, A)", () => {
  it("refuses a staged image when protection came on after attaching, and keeps the composer and history", async () => {
    const bodies = stubMessages();
    let ws: Workspace = ALLOWED;
    const { container } = renderOpen(() => ws, EMPTY_CONVERSATION);
    attach(container, [PNG()]);
    await screen.findByRole("button", { name: t("en-US", "chatAttachmentRemove", "chart.png") });
    ws = emptyWorkspace(); // protection on (the default) from now on
    send("What does the chart say?");
    expect(await screen.findByText(t("en-US", "chatPeopleProtectedAttachment"))).toBeTruthy();
    expect(bodies).toEqual([]);
    // The composer is intact: the chip and the typed text are still there to fix and resend.
    expect(screen.getByRole("button", { name: t("en-US", "chatAttachmentRemove", "chart.png") })).toBeTruthy();
    expect(screen.getByPlaceholderText("Ask Claude about your tasks…")).toHaveValue("What does the chart say?");
    // Nothing was committed to the conversation: no user turn in the transcript.
    expect(screen.queryByText(/📎 chart.png/)).toBeNull();
    // Removing the image lets the same text go out.
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "chatAttachmentRemove", "chart.png") }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Done.")).toBeTruthy();
    expect(bodies).toHaveLength(1);
  });

  it("says the CONVERSATION holds an image and leaves it unchanged", async () => {
    const bodies = stubMessages();
    renderOpen(emptyWorkspace());
    send("What does the chart say?");
    expect(await screen.findByText(t("en-US", "chatPeopleProtectedContent"))).toBeTruthy();
    expect(t("en-US", "chatPeopleProtectedContent")).toMatch(/conversation/i);
    expect(t("en-US", "chatPeopleProtectedContent")).toMatch(/new chat/i);
    expect(bodies).toEqual([]);
    expect(screen.getByPlaceholderText("Ask Claude about your tasks…")).toHaveValue("What does the chart say?");
    // Only the two stored turns are shown: the refused text never became a third.
    expect(screen.queryAllByText("What does the chart say?", { ignore: "textarea, script, style" })).toHaveLength(0);
    expect(screen.getByText("I see a chart.")).toBeTruthy(); // the transcript itself is there to look in
  });
});
