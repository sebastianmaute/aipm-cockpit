// src/app/absence-clash-notes.test.tsx — §773: the warning line every AI preview renders for a clash.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { AbsenceClashLine, AbsenceClashNotes } from "./absence-clash-notes";
import { formatAbsenceClash } from "./absence-clash-notice";
import { ExclamationTriangleIcon } from "./icons";
import type { ClashNote } from "./inline-ai-edit/plan";

const CLASH_NOTE: ClashNote = {
  entity: "task", id: 42, title: "Ship the release",
  clash: {
    person: "Maya Patel", resourceId: 1, reason: "date-on-absence", which: "due", date: "2026-11-05",
    ranges: [{ start: "2026-11-03", end: "2026-11-07" }],
  },
};

it("renders each note's title and sentence beside an aria-hidden warning icon", () => {
  render(<ul><AbsenceClashNotes lang="en-US" clashes={[CLASH_NOTE]} /></ul>);
  const item = screen.getByRole("listitem");
  expect(item).toHaveTextContent("Ship the release");
  expect(item).toHaveTextContent(/Maya Patel is absent on the due date/);
  const icon = item.querySelector("svg");
  expect(icon).not.toBeNull();
  expect(icon).toHaveAttribute("aria-hidden", "true");
});

it("renders nothing for no notes", () => {
  render(<ul><AbsenceClashNotes lang="en-US" clashes={[]} /></ul>);
  expect(screen.queryByRole("listitem")).toBeNull();
});

// §773 P-4 — the one warning line the three surfaces share renders exactly the markup each wrote by hand
// before it was extracted (copied below as the reference): the list item, the move row's paragraph and the
// WBS row's span.
describe("AbsenceClashLine (§773 P-4)", () => {
  const clash = CLASH_NOTE.clash;
  const sentence = formatAbsenceClash(clash, "en-US");
  const html = (node: ReactElement) => {
    const { container, unmount } = render(node);
    const out = container.innerHTML;
    unmount();
    return out;
  };

  it("as a list item with a title: the AbsenceClashNotes markup", () => {
    const legacy = (
      <li className="flex items-start gap-1.5 text-foreground">
        <ExclamationTriangleIcon aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          <span className="font-medium">Ship the release: </span>
          <span>{sentence}</span>
        </span>
      </li>
    );
    expect(html(<AbsenceClashLine as="li" className="flex items-start gap-1.5 text-foreground" lang="en-US" clash={clash} title="Ship the release" />)).toBe(html(legacy));
  });

  it("as a list item with an empty title: no title span", () => {
    const legacy = (
      <li className="flex items-start gap-1.5 text-foreground">
        <ExclamationTriangleIcon aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          {null}
          <span>{sentence}</span>
        </span>
      </li>
    );
    expect(html(<AbsenceClashLine as="li" className="flex items-start gap-1.5 text-foreground" lang="en-US" clash={clash} title="" />)).toBe(html(legacy));
  });

  it("as a paragraph: the Plan with AI move row markup", () => {
    const legacy = (
      <p className="mt-1 flex items-start gap-1.5 text-xs text-foreground">
        <ExclamationTriangleIcon aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{sentence}</span>
      </p>
    );
    expect(html(<AbsenceClashLine as="p" className="mt-1 flex items-start gap-1.5 text-xs text-foreground" lang="en-US" clash={clash} />)).toBe(html(legacy));
  });

  it("as a span with an id: the WBS plan row markup", () => {
    const legacy = (
      <span id="row-c0" className="mt-1 flex items-start gap-1.5 text-xs text-foreground">
        <ExclamationTriangleIcon aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{sentence}</span>
      </span>
    );
    expect(html(<AbsenceClashLine as="span" id="row-c0" className="mt-1 flex items-start gap-1.5 text-xs text-foreground" lang="en-US" clash={clash} />)).toBe(html(legacy));
  });
});
