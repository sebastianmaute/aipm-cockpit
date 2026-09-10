# Automation and notifications

The scheduled reminders the app raises on its own: task due dates, RAID
review, stakeholder communication, birthdays, and Jira token expiry.

This file owns the subject. `README.md` links here rather than summarising it.

The app fires reminders on page load once per session for approaching deadlines, stale RAID items, stakeholder communications, and team birthdays. All reminder types share a unified model: toasts fire by default; banners and pop-ups are opt-in via Settings → Notifications. Each channel (banner, toast, popup) has its own lead-time setting, or you can set a single global lead-time that overrides all channels.

## Task due-date reminders

Tasks approaching or past their due date trigger a reminder. The lead time is shifted to a working day — weekends, public holidays, and recorded absences are skipped forward so you are never reminded on a non-working day. Reminders can be snoozed for 1 hour or 1 day.

## RAID-review reminders

Active RAID items (Risks, Assumptions, Issues, Dependencies) that are past their target date or have not been updated within a configurable review interval trigger a RAID-review reminder. The modal links directly to the overdue item (`#raid/<id>`). Controlled by Settings → Notifications → RAID review; the review interval is configurable in days.

## Stakeholder-communication reminders

A quadrant-based policy maps each stakeholder's Influence/Interest position to a lead time and the categories of items that should prompt a communication nudge:

| Quadrant | Lead time | Sources |
|----------|-----------|---------|
| Manage Closely | 14 days | Milestones, RAID (Medium+), pending Changes |
| Keep Satisfied | 7 days | Milestones, RAID (High+), pending Changes |
| Keep Informed | 7 days | Milestones, pending Changes |
| Monitor | 3 days | Overdue milestones only |

Reminders are generated when: a milestone the stakeholder is RACI-linked to is overdue or within the lead window; an open RAID item linked to the stakeholder meets the severity threshold or is overdue; or a pending Change item is linked to the stakeholder. Requires the Stakeholders feature module to be enabled (Settings → Mode).

## Birthday reminders

Resources with a birthday stored in the address book trigger a toast when the birthday falls within the configured lead window, shifted to the nearest working day.

## Jira-token expiry reminders

When Jira integration is enabled and a token-expiry date is recorded, the app surfaces a sticky banner warning when the token is expiring soon, expired, or has been marked invalid. A separate settings toggle controls the Jira-token banner independently from the main notification channels.
