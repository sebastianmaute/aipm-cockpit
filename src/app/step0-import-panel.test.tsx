import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Step0ImportPanel } from "./step0-import-panel";
import { defaultSettings } from "./settings-types";
import { t } from "./i18n";
import { ATTACHMENT_ACCEPT, type DocumentBlock } from "./chat-attachments";

// SharePoint path stubs — the picker itself and the Graph fetch are mocked so
// the regression test below can drive Step0ImportPanel's onSharePointPick
// handler without a real M365 session. Kept minimal: onSelect fires with a
// fixed link the moment the stub picker renders.
vi.mock("./m365-sharepoint", () => ({
  isSharePointEnabled: () => true,
  fetchSharePointFileContent: vi.fn(),
}));
vi.mock("./use-ms-auth", () => ({
  useMsAuth: () => ({ acquireToken: vi.fn() }),
}));
vi.mock("./sharepoint-picker-modal", () => ({
  SharePointPickerModal: ({ onSelect }: { onSelect: (link: unknown) => void }) => (
    <button
      type="button"
      onClick={() =>
        onSelect({ id: "1", name: "note.html", url: "https://x/note.html", kind: "file" as const })
      }
    >
      stub-sp-pick
    </button>
  ),
}));

const baseProps = {
  lang: "en-US" as const,
  settings: defaultSettings,
  aiBusy: false,
  aiError: null as string | null,
  onResetAi: vi.fn(),
  onSkip: vi.fn(),
};

function selectFileMethod() {
  fireEvent.click(
    screen.getByRole("button", { name: t("en-US", "wizardImportMethodFile") }),
  );
}

function fileInput() {
  return screen.getByLabelText(
    t("en-US", "wizardImportFileLabel"),
  ) as HTMLInputElement;
}

describe("Step0ImportPanel multi-file", () => {
  it("reads multiple valid files into one ingest call", async () => {
    const onIngest = vi.fn().mockResolvedValue(undefined);
    render(<Step0ImportPanel {...baseProps} onIngest={onIngest} />);
    selectFileMethod();
    const f1 = new File(["hello"], "a.txt", { type: "text/plain" });
    const f2 = new File(["world"], "b.txt", { type: "text/plain" });
    fireEvent.change(fileInput(), { target: { files: [f1, f2] } });
    await waitFor(() => expect(onIngest).toHaveBeenCalledTimes(1));
    const content = onIngest.mock.calls[0][0];
    expect(Array.isArray(content)).toBe(true);
    expect(content.length).toBe(3); // prompt + 2 blocks
  });

  it("skips invalid files with a notice and imports the valid ones", async () => {
    const onIngest = vi.fn().mockResolvedValue(undefined);
    render(<Step0ImportPanel {...baseProps} onIngest={onIngest} />);
    selectFileMethod();
    const good = new File(["hi"], "good.txt", { type: "text/plain" });
    const bad = new File(["x"], "bad.exe", { type: "application/x-msdownload" });
    fireEvent.change(fileInput(), { target: { files: [good, bad] } });
    await waitFor(() => expect(onIngest).toHaveBeenCalledTimes(1));
    expect(onIngest.mock.calls[0][0].length).toBe(2); // prompt + 1 block
    expect(screen.getByText(/skipped|übersprungen/i)).toBeTruthy();
  });

  it("errors and does not ingest when all files are invalid", async () => {
    const onIngest = vi.fn();
    render(<Step0ImportPanel {...baseProps} onIngest={onIngest} />);
    selectFileMethod();
    fireEvent.change(fileInput(), {
      target: {
        files: [new File(["x"], "bad.exe", { type: "application/x-msdownload" })],
      },
    });
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(onIngest).not.toHaveBeenCalled();
  });

  // ★★ The wizard's hand-written accept string was a strict subset of the
  //  assistant's — missing .markdown and every MIME token. Assert against the
  //  shared constant, not a literal, or this test drifts the same way.
  it("offers the shared accept list, not a hand-written subset", () => {
    render(<Step0ImportPanel {...baseProps} onIngest={vi.fn()} />);
    selectFileMethod();
    expect(fileInput().getAttribute("accept")).toBe(ATTACHMENT_ACCEPT);
  });

  // ★★★ REGRESSION GUARD, now for the attachment-ingest orchestrator: an html
  // pick must reach the model as EXTRACTED MARKDOWN (not raw markup, and not
  // base64) — assert the script is stripped and the text survives, so neither
  // a pass-through nor a base64 blob can pass by accident.
  it("reads an html file as extracted markdown, not raw markup or base64", async () => {
    const onIngest = vi.fn().mockResolvedValue(undefined);
    render(<Step0ImportPanel {...baseProps} onIngest={onIngest} />);
    selectFileMethod();
    const html = new File(["<p>Hi</p><script>x()</script>"], "note.html", { type: "text/html" });
    fireEvent.change(fileInput(), { target: { files: [html] } });
    await waitFor(() => expect(onIngest).toHaveBeenCalledTimes(1));
    const content = onIngest.mock.calls[0][0];
    const block = content[1] as DocumentBlock;
    expect(block.source.type).toBe("text");
    const data = (block.source as { data: string }).data;
    expect(data).toContain("Hi");
    expect(data).not.toContain("x()");
  });
});

describe("Step0ImportPanel SharePoint import", () => {
  // ★★★ REGRESSION GUARD for the SAME orchestrator behaviour at the
  // SharePoint site (step0-import-panel.tsx's onSharePointPick, reached
  // through ingestBytes rather than the file-picker's ingestFile).
  it("reads an html SharePoint file as extracted markdown, not raw markup or base64", async () => {
    const { fetchSharePointFileContent } = await import("./m365-sharepoint");
    const bytes = new TextEncoder().encode("<p>Hi</p><script>x()</script>").buffer;
    vi.mocked(fetchSharePointFileContent).mockResolvedValue({
      name: "note.html",
      mime: "text/html",
      bytes,
    });
    const onIngest = vi.fn().mockResolvedValue(undefined);
    render(<Step0ImportPanel {...baseProps} onIngest={onIngest} />);
    fireEvent.click(
      screen.getByRole("button", { name: t("en-US", "wizardImportMethodSharePoint") }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: t("en-US", "wizardImportSharePointBrowse") }),
    );
    fireEvent.click(screen.getByText("stub-sp-pick"));
    await waitFor(() => expect(onIngest).toHaveBeenCalledTimes(1));
    const content = onIngest.mock.calls[0][0];
    const block = content[1] as DocumentBlock;
    expect(block.source.type).toBe("text");
    const data = (block.source as { data: string }).data;
    expect(data).toContain("Hi");
    expect(data).not.toContain("x()");
  });
});
