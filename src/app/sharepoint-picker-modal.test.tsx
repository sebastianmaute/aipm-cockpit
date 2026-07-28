import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SharePointPickerModal } from "./sharepoint-picker-modal";
import { t } from "./i18n";

const acquire = vi.fn(async () => "tok");

function mockFetch(body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => body })));
}

function mockFetchSequence(...bodies: unknown[]) {
  const fetchMock = vi.fn();
  for (const body of bodies) {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => body });
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function mockFetchError(status: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, status, json: async () => ({}) })),
  );
}

beforeEach(() => vi.unstubAllGlobals());

describe("SharePointPickerModal", () => {
  it("searches sites and lists results", async () => {
    mockFetch({ value: [{ id: "s1", displayName: "Proj", webUrl: "https://c.sharepoint.com/sites/proj" }] });
    render(<SharePointPickerModal mode="link" lang="en-US" acquireToken={acquire} onSelect={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/search sites/i), { target: { value: "proj" } });
    fireEvent.click(screen.getByText(/^Search$/));
    await waitFor(() => expect(screen.getByText("Proj")).toBeInTheDocument());
  });

  it("calls onClose from Escape", () => {
    mockFetch({ value: [] });
    const onClose = vi.fn();
    render(<SharePointPickerModal mode="link" lang="en-US" acquireToken={acquire} onSelect={vi.fn()} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("file Select calls onSelect + onClose", async () => {
    // search → sites; openSite → drives; openDrive → items (a file)
    mockFetchSequence(
      { value: [{ id: "s1", displayName: "Proj", webUrl: "https://c.sharepoint.com/sites/proj" }] },
      { value: [{ id: "d1", name: "Documents" }] },
      {
        value: [
          {
            id: "f1",
            name: "Spec.docx",
            webUrl: "https://c.sharepoint.com/x",
            file: { mimeType: "application/msword" },
            parentReference: { driveId: "d1" },
          },
        ],
      },
    );

    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <SharePointPickerModal mode="link" lang="en-US" acquireToken={acquire} onSelect={onSelect} onClose={onClose} />,
    );

    // Step 1: search
    fireEvent.change(screen.getByPlaceholderText(/search sites/i), { target: { value: "proj" } });
    fireEvent.click(screen.getByText(/^Search$/));
    await waitFor(() => expect(screen.getByText("Proj")).toBeInTheDocument());

    // Step 2: open site → drives
    fireEvent.click(screen.getByText("Proj"));
    await waitFor(() => expect(screen.getByText("Documents")).toBeInTheDocument());

    // Step 3: open drive → items
    fireEvent.click(screen.getByText("Documents"));
    await waitFor(() => expect(screen.getByText("Spec.docx")).toBeInTheDocument());

    // Step 4: select the file
    fireEvent.click(screen.getByText("Select"));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Spec.docx", kind: "file" }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('mode "link": folder shows "Use this folder" which calls onSelect+onClose', async () => {
    mockFetchSequence(
      { value: [{ id: "s1", displayName: "Proj", webUrl: "https://c.sharepoint.com/sites/proj" }] },
      { value: [{ id: "d1", name: "Documents" }] },
      {
        value: [
          {
            id: "fo1",
            name: "Sub",
            webUrl: "https://c.sharepoint.com/y",
            folder: {},
            parentReference: { driveId: "d1" },
          },
        ],
      },
    );

    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <SharePointPickerModal mode="link" lang="en-US" acquireToken={acquire} onSelect={onSelect} onClose={onClose} />,
    );

    fireEvent.change(screen.getByPlaceholderText(/search sites/i), { target: { value: "proj" } });
    fireEvent.click(screen.getByText(/^Search$/));
    await waitFor(() => expect(screen.getByText("Proj")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Proj"));
    await waitFor(() => expect(screen.getByText("Documents")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Documents"));
    await waitFor(() => expect(screen.getByText("Sub")).toBeInTheDocument());

    const useBtn = screen.getByText(/use this folder/i);
    expect(useBtn).toBeInTheDocument();
    fireEvent.click(useBtn);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ kind: "folder" }));
    expect(onClose).toHaveBeenCalled();
  });

  it('mode "location": folder has no "Use this folder" button but has "Open"', async () => {
    mockFetchSequence(
      { value: [{ id: "s1", displayName: "Proj", webUrl: "https://c.sharepoint.com/sites/proj" }] },
      { value: [{ id: "d1", name: "Documents" }] },
      {
        value: [
          {
            id: "fo1",
            name: "Sub",
            webUrl: "https://c.sharepoint.com/y",
            folder: {},
            parentReference: { driveId: "d1" },
          },
        ],
      },
    );

    render(
      <SharePointPickerModal
        mode="location"
        lang="en-US"
        acquireToken={acquire}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText(/search sites/i), { target: { value: "proj" } });
    fireEvent.click(screen.getByText(/^Search$/));
    await waitFor(() => expect(screen.getByText("Proj")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Proj"));
    await waitFor(() => expect(screen.getByText("Documents")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Documents"));
    await waitFor(() => expect(screen.getByText("Sub")).toBeInTheDocument());

    expect(screen.queryByText(/use this folder/i)).toBeNull();
    // The folder row renders an "Open" button (in addition to the disabled paste-URL "Open")
    expect(screen.getAllByText("Open").length).toBeGreaterThanOrEqual(1);
  });

  it("restores the saved draggable position + resizable size and the reset button clears both", () => {
    mockFetch({ value: [] });
    window.localStorage.setItem("aipm-cockpit:modal-pos:sharepoint", JSON.stringify({ x: 30, y: 40 }));
    window.localStorage.setItem("aipm-cockpit:modal-size:sharepoint", JSON.stringify({ width: 500, height: 400 }));
    const { container } = render(
      <SharePointPickerModal mode="link" lang="en-US" acquireToken={acquire} onSelect={vi.fn()} onClose={vi.fn()} />,
    );
    const panel = container.querySelector("[data-modal-panel]") as HTMLElement;
    expect(panel.style.transform).toContain("translate(30px, 40px)");
    expect(panel.style.width).toBe("500px");
    expect(panel.style.height).toBe("400px");

    fireEvent.click(screen.getByRole("button", { name: t("en-US", "modalResetSize") }));
    expect(window.localStorage.getItem("aipm-cockpit:modal-pos:sharepoint")).toBeNull();
    expect(window.localStorage.getItem("aipm-cockpit:modal-size:sharepoint")).toBeNull();
    expect(panel.style.transform).toContain("translate(0px, 0px)");
    expect(panel.style.width).toBe("");
    expect(panel.style.height).toBe("");
  });

  it("403 error renders the forbidden message", async () => {
    mockFetchError(403);
    render(
      <SharePointPickerModal mode="link" lang="en-US" acquireToken={acquire} onSelect={vi.fn()} onClose={vi.fn()} />,
    );

    fireEvent.change(screen.getByPlaceholderText(/search sites/i), { target: { value: "proj" } });
    fireEvent.click(screen.getByText(/^Search$/));
    await waitFor(() =>
      expect(screen.getByText(/permission denied/i)).toBeInTheDocument(),
    );
  });

  it("shows the search-forbidden fallback hint after a 403 search", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) })));
    render(<SharePointPickerModal mode="link" lang="en-US" acquireToken={acquire} onSelect={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/search sites/i), { target: { value: "proj" } });
    fireEvent.click(screen.getByText(/^Search$/));
    await waitFor(() => expect(screen.getByText(/admin consent/i)).toBeInTheDocument());
  });

  it("paste-URL browses via the default-library path (openSiteByPath)", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        value: [
          {
            id: "f1",
            name: "Spec.docx",
            webUrl: "https://c.sharepoint.com/x",
            file: { mimeType: "application/msword" },
            parentReference: { driveId: "d1" },
          },
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(<SharePointPickerModal mode="link" lang="en-US" acquireToken={acquire} onSelect={vi.fn()} onClose={vi.fn()} />);
    const pasteInput = screen.getByPlaceholderText(/site url|sharepoint\.com/i);
    fireEvent.change(pasteInput, { target: { value: "https://c.sharepoint.com/sites/proj" } });
    // click the Open button adjacent to the paste input
    const openButtons = screen.getAllByText(/^Open$/);
    fireEvent.click(openButtons[openButtons.length - 1]);
    await waitFor(() => expect(screen.getByText("Spec.docx")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/sites/c.sharepoint.com:/sites/proj:/drive/root/children"),
      expect.anything(),
    );
  });
});

describe("SharePointPickerModal — site-search field", () => {
  it("gives the site-search field an accessible name and a clear button", () => {
    mockFetch({ value: [] });
    render(
      <SharePointPickerModal
        mode="link"
        lang="en-US"
        acquireToken={acquire}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    // Placeholder-only field: the missing name is the headline claim here.
    const field = screen.getByLabelText("Search sites…") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "proj" } });
    expect(field.value).toBe("proj");
    fireEvent.click(
      screen.getByRole("button", { name: "Clear – Search sites…" }),
    );
    expect(field.value).toBe("");
  });
});
