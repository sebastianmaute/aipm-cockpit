import { Section } from "../report-table";
import { type Lang, t } from "../i18n";
import type { Milestone, RaidItem, Task } from "../types";

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

export function RegistersBand({
  lang,
  topRaid,
  overdue,
  dueSoon,
  onOpenRaid,
  onOpenTask,
  overdueMilestones,
  atRiskMilestones,
  dueSoonMilestones,
  onOpenMilestone,
}: {
  lang: Lang;
  topRaid: RaidItem[];
  overdue: Task[];
  dueSoon: Task[];
  onOpenRaid?: (id: number) => void;
  onOpenTask?: (id: number) => void;
  overdueMilestones: Milestone[];
  atRiskMilestones: Milestone[];
  dueSoonMilestones: Milestone[];
  onOpenMilestone?: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Section title={t(lang, "dashboardTopRaid")}>
          {topRaid.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t(lang, "dashboardEmpty")}</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {topRaid.map((r) => (
                <li key={r.id}>
                  {onOpenRaid ? (
                    <button
                      type="button"
                      className="text-left hover:underline"
                      onClick={() => onOpenRaid(r.id)}
                    >
                      <RaidItemContent r={r} />
                    </button>
                  ) : (
                    <span><RaidItemContent r={r} /></span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title={t(lang, "dashboardUpcoming")}>
          <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
            {t(lang, "dashboardOverdue")}
          </p>
          <ul className="mb-3 space-y-1 text-sm">
            {overdue.map((tk) => (
              <li key={tk.id}>
                {onOpenTask ? (
                  <button
                    type="button"
                    className="text-left hover:underline"
                    onClick={() => onOpenTask(tk.id)}
                  >
                    <TaskItemContent tk={tk} />
                  </button>
                ) : (
                  <span><TaskItemContent tk={tk} /></span>
                )}
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
                {onOpenTask ? (
                  <button
                    type="button"
                    className="text-left hover:underline"
                    onClick={() => onOpenTask(tk.id)}
                  >
                    <TaskItemContent tk={tk} />
                  </button>
                ) : (
                  <span><TaskItemContent tk={tk} /></span>
                )}
              </li>
            ))}
            {dueSoon.length === 0 ? (
              <li className="text-muted-foreground">—</li>
            ) : null}
          </ul>
        </Section>
      </div>
      <Section title={t(lang, "dashboardMilestones")}>
        {overdueMilestones.length + atRiskMilestones.length + dueSoonMilestones.length === 0 ? (
          <p className="text-sm text-muted-foreground">—</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {[...overdueMilestones, ...atRiskMilestones, ...dueSoonMilestones].map((m) => (
              <li key={m.id}>
                {onOpenMilestone ? (
                  <button type="button" className="text-left hover:underline" onClick={() => onOpenMilestone()}>
                    {atRiskMilestones.includes(m) ? "⚠ " : ""}{m.name} · {m.date}
                  </button>
                ) : (
                  <span>{atRiskMilestones.includes(m) ? "⚠ " : ""}{m.name} · {m.date}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
