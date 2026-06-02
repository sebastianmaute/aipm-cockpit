import { Section } from "../report-table";
import { type Lang, t } from "../i18n";
import type { RaidItem, Task } from "../types";

export function RegistersBand({
  lang,
  topRaid,
  overdue,
  dueSoon,
  onOpenRaid,
  onOpenTask,
}: {
  lang: Lang;
  topRaid: RaidItem[];
  overdue: Task[];
  dueSoon: Task[];
  onOpenRaid?: (id: number) => void;
  onOpenTask?: (id: number) => void;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Section title={t(lang, "dashboardTopRaid")}>
        {topRaid.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t(lang, "dashboardEmpty")}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {topRaid.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="text-left hover:underline"
                  onClick={() => onOpenRaid?.(r.id)}
                >
                  <span className="font-medium">{r.category}</span> · {r.title}
                  {r.severity ? (
                    <span className="text-muted-foreground"> ({r.severity})</span>
                  ) : null}
                </button>
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
              <button
                type="button"
                className="text-left hover:underline"
                onClick={() => onOpenTask?.(tk.id)}
              >
                {tk.dueDate} · {tk.taskName}
              </button>
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
              <button
                type="button"
                className="text-left hover:underline"
                onClick={() => onOpenTask?.(tk.id)}
              >
                {tk.dueDate} · {tk.taskName}
              </button>
            </li>
          ))}
          {dueSoon.length === 0 ? (
            <li className="text-muted-foreground">—</li>
          ) : null}
        </ul>
      </Section>
    </div>
  );
}
