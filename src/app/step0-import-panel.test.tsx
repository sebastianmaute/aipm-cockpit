import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Step0ImportPanel } from "./step0-import-panel";
import { defaultSettings } from "./settings-types";
import { t } from "./i18n";

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
});
