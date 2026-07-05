import type { ReactNode } from "react";
import { Section } from "../report-table";
import { type Lang, t } from "../i18n";
import type { RaidItem, Task } from "../types";

const LINK_CLASS =
  "rounded-md border border-transparent px-2 py-0.5 text-left text-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted";

// Row body: a click-through button when a handler is supplied, else a plain span.
function LinkItem({ onOpen, children }: { onOpen?: () => void; children: ReactNode }) {
  return onOpen ? (
    <button type="button" className={LINK_CLASS} onClick={onOpen}>
      {children}
    </button>
  ) : (
    <span>{children}</span>
  );
}

function RaidItemContent({ r }: { r: RaidItem }) {
  return (
    <>
      <span className="font-medium">{r.category}</span> · {r.title}
      {r.severity ? (
        <span className="text-muted-foreground"> ({r.severity})</span>
      ) : null}
    </>
  );
}

function TaskItemContent({ tk }: { tk: Task }) {
  return <>{tk.dueDate} · {tk.taskName}</>;
}

export function RaidRegisterCard({
  lang,
  topRaid,
  onOpenRaid,
  showRaid = true,
}: {
  lang: Lang;
  topRaid: RaidItem[];
  onOpenRaid?: (id: number) => void;
  showRaid?: boolean;
}) {
  if (!showRaid) return null;
  return (
    <Section title={t(lang, "dashboardTopRaid")} boxed>
      {topRaid.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(lang, "dashboardEmpty")}</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {topRaid.map((r) => (
            <li key={r.id}>
              <LinkItem onOpen={onOpenRaid ? () => onOpenRaid(r.id) : undefined}>
                <RaidItemContent r={r} />
              </LinkItem>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export function UpcomingCard({
  lang,
  overdue,
  dueSoon,
  onOpenTask,
}: {
  lang: Lang;
  overdue: Task[];
  dueSoon: Task[];
  onOpenTask?: (id: number) => void;
}) {
  return (
    <Section title={t(lang, "dashboardUpcoming")} boxed>
      <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
        {t(lang, "dashboardOverdue")}
      </p>
      <ul className="mb-3 space-y-1 text-sm">
        {overdue.map((tk) => (
          <li key={tk.id}>
            <LinkItem onOpen={onOpenTask ? () => onOpenTask(tk.id) : undefined}>
              <TaskItemContent tk={tk} />
            </LinkItem>
          </li>
        ))}
        {overdue.length === 0 ? (
          <li className="text-muted-foreground">—</li>
        ) : null}
      </ul>
      <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
        {t(lang, "dashboardDueSoon")}
      </p>
      <ul className="space-y-1 text-sm">
        {dueSoon.map((tk) => (
          <li key={tk.id}>
            <LinkItem onOpen={onOpenTask ? () => onOpenTask(tk.id) : undefined}>
              <TaskItemContent tk={tk} />
            </LinkItem>
          </li>
        ))}
        {dueSoon.length === 0 ? (
          <li className="text-muted-foreground">—</li>
        ) : null}
      </ul>
    </Section>
  );
}
