import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OutlookImportModal } from "./outlook-import-modal";
import type { OutlookContact } from "./outlook-contacts";

const contacts: OutlookContact[] = [
  { sourceId: "1", firstName: "Ann", lastName: "New", displayName: "Ann New", email: "ann@x.com" },
  { sourceId: "2", firstName: "Bob", lastName: "Old", displayName: "Bob Old", email: "bob@x.com" },
];

function base(overrides = {}) {
  return {
    lang: "en-US" as const,
    open: true,
    loading: false,
    error: null as string | null,
    contacts,
    existingEmails: new Set(["bob@x.com"]),
    onConfirm: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

describe("OutlookImportModal", () => {
  it("pre-checks every contact; badges existing matches", () => {
    render(<OutlookImportModal {...base()} />);
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(3); // 2 rows + select-all
    boxes.forEach((b) => expect(b).toBeChecked());
    expect(screen.getByText(/already in directory/i)).toBeInTheDocument();
  });

  it("confirm passes only the checked subset", () => {
    const onConfirm = vi.fn();
    render(<OutlookImportModal {...base({ onConfirm })} />);
    fireEvent.click(screen.getByLabelText(/Ann New/i)); // uncheck Ann
    fireEvent.click(screen.getByRole("button", { name: /Import \(1\)/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0]).toEqual([contacts[1]]);
  });

  it("select-all toggles every row", () => {
    render(<OutlookImportModal {...base()} />);
    fireEvent.click(screen.getByLabelText(/Select all/i)); // deselect all
    screen.getAllByRole("checkbox").forEach((b) => expect(b).not.toBeChecked());
  });

  it("resets selection when the contacts prop is replaced", () => {
    const newContacts: OutlookContact[] = [
      { sourceId: "3", firstName: "Carol", lastName: "", displayName: "Carol", email: "carol@x.com" },
    ];
    const { rerender } = render(<OutlookImportModal {...base()} />);
    fireEvent.click(screen.getByLabelText(/Ann New/i)); // uncheck one on the old list
    rerender(<OutlookImportModal {...base({ contacts: newContacts })} />);
    screen.getAllByRole("checkbox").forEach((b) => expect(b).toBeChecked());
  });

  it("renders loading, empty, and error states", () => {
    const { rerender } = render(<OutlookImportModal {...base({ loading: true })} />);
    expect(screen.getByText(/Loading contacts/i)).toBeInTheDocument();
    rerender(<OutlookImportModal {...base({ contacts: [] })} />);
    expect(screen.getByText(/No Outlook contacts found/i)).toBeInTheDocument();
    rerender(<OutlookImportModal {...base({ error: "Permission denied" })} />);
    expect(screen.getByText(/Permission denied/i)).toBeInTheDocument();
  });
});
