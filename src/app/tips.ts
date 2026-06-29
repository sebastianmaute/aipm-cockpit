// Pure, i18n-free "tip of the day" content + rotation helper. Tips are app
// knowledge (how-to), English-only by design — mirrors the operating/feature
// guide convention. The dashboard tip card (dashboard-tip-card.tsx) renders one
// tip per day and lets the user step to the next.

export const TIPS: readonly string[] = [
  "Press Ctrl-K (Cmd-K on macOS) anywhere to open global search, or \"/\" to focus it.",
  "The app opens on the Dashboard — Next actions and Trends live as sub-menu entries under it in the sidebar.",
  "Click a KPI tile, the Trends card, or a register row on the dashboard to jump straight to that view or item.",
  "Set Comfortable or Compact dashboard density in Settings -> Appearance.",
  "Trends and Portfolio health need a Turso backend; in file mode everything stays local.",
  "Override a RAG rating under \"Adjust health ratings\" on the dashboard when the computed value is off.",
  "Save a filter + sort + column layout on Open Points as a Saved view and switch between them in one click.",
  "Drag a Gantt bar to reschedule a task; drag its edge to change the duration.",
  "Switch Open Points between Table and Board (Kanban) with the view toggle.",
  "Select rows in RAID, Milestones, Changes or Stakeholders to bulk-edit them in one go.",
  "Filter the RACI matrix by person to focus on a single stakeholder's responsibilities.",
  "Push milestones and steering-committee meetings to your Outlook calendar (Microsoft 365).",
  "Enable the AI assistant in Settings, then ask it to create or update tasks, RAID, changes and more.",
  "Resizable panes remember their size per device — use the reset-size button to restore the default.",
  "Print any data view with the Print button (wide tables print in landscape).",
  "An empty register shows a click-to-add box — click it to create the first item.",
];

/** Stable index into TIPS for a given day number (days since epoch), so the tip
 *  rotates once per day. Tolerates negative/zero-length defensively. */
export function tipIndexForDay(dayNumber: number, len: number = TIPS.length): number {
  if (len <= 0) return 0;
  return ((Math.trunc(dayNumber) % len) + len) % len;
}
