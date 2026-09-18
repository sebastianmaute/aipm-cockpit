# AIPM Tasks

| ID | Task | Assignee | Email | Start | Due | Last update | Created | Priority | Status | Blockers | Description | Completed | Inquiries | Group | Labels | Dependencies | Jira | JiraType | LastSynced | LocalModified | Health | ResourceId | OrigEstimateMin | TimeSpentMin | RemainingEstimateMin | KnowledgeLinks | OutlookEventId | NoteLog |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Design SSO architecture | Alex Example | Sample.Dummy@example.com | 2026-06-01 | 2026-07-07 | 2026-07-10 | 2026-06-01 | High | Done |  | <p>Replace the hand-rolled session cookie with the shared <strong>token service</strong>. The old cookie is issued in three different places and none of them agree on expiry.</p><p>Definition of done:</p><ul><li>One issuing path, covered by tests</li><li>Expiry read from config, not hard-coded</li><li>Old cookie name still accepted for one release</li></ul><p>See the <a href="https://example.com/adr/017-token-service">ADR</a> for the agreed contract.</p> | 2026-07-10 | 0 | Auth Migration | design\|architecture |  | LOP-101 | Story |  |  |  | 1 |  |  |  | [{"id":"dl-1","name":"OIDC Architecture Decision.docx","url":"https://example.sharepoint.com/sites/auth-migration/Shared%20Documents/OIDC-Architecture-Decision.docx","kind":"file"}] |  | [{"id":1,"timestamp":"2026-07-10T00:00:00.000Z","html":"<p>Reviewed OIDC vs SAML; OIDC selected based on partner roadmap.</p>","text":"Reviewed OIDC vs SAML; OIDC selected based on partner roadmap."},{"id":2,"timestamp":"2026-07-12T09:15:00.000Z","html":"<p>Partner confirmed the OIDC discovery endpoint is stable; no SAML fallback needed.</p>","text":"Partner confirmed the OIDC discovery endpoint is stable; no SAML fallback needed.","authorResourceId":1,"authorName":"Alex Example"}] |
| 2 | POC OIDC integration | Sam Placeholder | Fictional.Jordan@example.com | 2026-06-29 | 2026-07-27 | 2026-08-03 | 2026-06-29 | High | Done |  |  | 2026-08-03 | 1 | Auth Migration | poc\|backend | FS:1 | LOP-102 | Story |  |  |  | 2 |  |  |  |  |  | [{"id":1,"timestamp":"2026-08-02T00:00:00.000Z","html":"<p>Worked through token refresh edge cases. One inquiry from product lead about UX. Merged to main.</p>","text":"Worked through token refresh edge cases. One inquiry from product lead about UX. Merged to main."}] |
| 3 | Stakeholder workshop | Taylor Specimen | aria.patel@example.com |  | 2026-08-04 | 2026-08-04 | 2026-08-04 | Medium | Done |  | <p>Frontend still reads <em>user.roles</em> straight off the legacy payload. Switch it to the claim on the new token — <strong>do not</strong> ship this before the backend task above.</p> | 2026-08-04 | 0 | Auth Migration | planning\|stakeholder | SS:2 |  |  |  |  |  | 3 |  |  |  |  |  | [{"id":1,"timestamp":"2026-08-04T00:00:00.000Z","html":"<p>Workshop with security, legal, product. Action items captured in Confluence: SSO-2026-Q2.</p>","text":"Workshop with security, legal, product. Action items captured in Confluence: SSO-2026-Q2."}] |
| 4 | Backend API skeleton | Sam Placeholder | Fictional.Jordan@example.com | 2026-08-03 | 2026-08-17 | 2026-08-19 | 2026-08-03 | Urgent | To Do | Waiting on database schema review from DBA team. |  |  | 3 | Auth Migration | backend\|api | FS:2 | LOP-103 | Story | 2026-08-19T10:30:00.000Z | 2026-08-19T10:35:12.000Z |  | 2 |  |  |  |  |  | [{"id":1,"timestamp":"2026-08-19T00:00:00.000Z","html":"<p>Stalled while Jane is on holiday. Rate-limit middleware design needs review; current draft uses sliding-window over Redis.</p>","text":"Stalled while Jane is on holiday. Rate-limit middleware design needs review; current draft uses sliding-window over Redis."},{"id":2,"timestamp":"2026-08-21T11:00:00.000Z","html":"<p>Redis sliding-window middleware drafted; awaiting DBA schema review before wiring rate limits.</p>","text":"Redis sliding-window middleware drafted; awaiting DBA schema review before wiring rate limits.","authorResourceId":2,"authorName":"Sam Placeholder"}] |
| 5 | Frontend login flow | Alex Example | Sample.Dummy@example.com | 2026-08-24 | 2026-09-07 | 2026-08-21 | 2026-08-21 | High | To Do |  |  |  | 0 | Auth Migration | frontend\|ui | FS:4 |  |  |  | 2026-08-21T16:20:00.000Z |  | 1 |  |  |  |  |  | [{"id":1,"timestamp":"2026-08-21T00:00:00.000Z","html":"<p>React component scaffolded; need to wire token storage. Considering httpOnly cookie vs sessionStorage tradeoff.</p>","text":"React component scaffolded; need to wire token storage. Considering httpOnly cookie vs sessionStorage tradeoff."}] |
| 6 | Migration script for legacy users | Sam Placeholder | Fictional.Jordan@example.com | 2026-08-17 | 2026-09-10 | 2026-08-24 | 2026-08-17 | High | To Do | Pending DBA approval on dry-run plan. |  |  | 2 | Auth Migration | backend\|migration | FS:3 |  |  |  |  | R | 2 |  |  |  |  |  | [{"id":1,"timestamp":"2026-08-23T00:00:00.000Z","html":"<p>50k legacy users with bcrypt-hashed passwords. Plan for incremental migration in 5k batches with rollback markers.</p>","text":"50k legacy users with bcrypt-hashed passwords. Plan for incremental migration in 5k batches with rollback markers."}] |
| 7 | Security review | Morgan Standin | Invented.Riley@example.com | 2026-09-01 | 2026-09-24 | 2026-08-24 | 2026-08-24 | Medium | To Do |  |  |  | 0 | Auth Migration | security\|compliance | FS:4 |  |  |  |  |  | 4 |  |  |  |  |  | [{"id":1,"timestamp":"2026-08-23T00:00:00.000Z","html":"<p>Schedule with InfoSec. Expect ~1 week turnaround. Scope: token storage, redirect URIs, CSP, session fixation.</p>","text":"Schedule with InfoSec. Expect ~1 week turnaround. Scope: token storage, redirect URIs, CSP, session fixation."}] |
| 8 | Load testing | Sam Placeholder | Fictional.Jordan@example.com | 2026-09-25 | 2026-10-05 | 2026-08-24 | 2026-08-24 | Medium | To Do |  |  |  | 0 | Auth Migration | testing\|performance | FS:5\|FS:6 |  |  |  |  |  | 2 |  |  |  |  |  | [{"id":1,"timestamp":"2026-08-23T00:00:00.000Z","html":"<p>Target: 10k concurrent logins/sec sustained for 30 minutes. Tools: k6 or Gatling. Hold a slot in the staging env.</p>","text":"Target: 10k concurrent logins/sec sustained for 30 minutes. Tools: k6 or Gatling. Hold a slot in the staging env."}] |
| 9 | Documentation | Taylor Specimen | aria.patel@example.com |  | 2026-10-13 | 2026-08-13 | 2026-08-13 | Low | To Do |  |  |  | 0 | Auth Migration | docs | FF:8 |  |  |  |  |  | 3 |  |  |  | [{"id":"dl-2","name":"API Docs (Confluence export)","url":"https://example.sharepoint.com/sites/auth-migration/Shared%20Documents/API-Docs","kind":"folder"}] |  | [{"id":1,"timestamp":"2026-08-13T00:00:00.000Z","html":"<p>Update Confluence runbook + internal API docs. Add a runbook for token rotation incidents.</p>","text":"Update Confluence runbook + internal API docs. Add a runbook for token rotation incidents."}] |
| 10 | Production cutover | Alex Example | Sample.Dummy@example.com |  | 2026-10-20 | 2026-08-24 | 2026-08-24 | Urgent | To Do |  |  |  | 0 | Auth Migration | deployment\|critical | FS:7\|FS:8 |  |  |  |  |  | 1 |  |  |  |  |  | [{"id":1,"timestamp":"2026-08-23T00:00:00.000Z","html":"<p>Maintenance window: Sun 02:00-06:00 UTC. Rollback via DNS flip (60s TTL pre-staged). Status page banner from -30min.</p>","text":"Maintenance window: Sun 02:00-06:00 UTC. Rollback via DNS flip (60s TTL pre-staged). Status page banner from -30min."}] |
| 11 | Quarterly OKR review | Morgan Standin | Invented.Riley@example.com |  | 2026-09-21 | 2026-08-10 | 2026-08-10 | Medium | To Do |  |  |  | 0 | Operations | okr\|reporting |  |  |  |  |  |  | 4 |  |  |  |  |  | [{"id":1,"timestamp":"2026-08-10T00:00:00.000Z","html":"<p>Compile Q3 metrics: KR1 conversion, KR2 incident MTTR, KR3 NPS. Slides due 48h before steering committee.</p>","text":"Compile Q3 metrics: KR1 conversion, KR2 incident MTTR, KR3 NPS. Slides due 48h before steering committee."}] |
| 12 | Vendor renewal: monitoring platform | Taylor Specimen | aria.patel@example.com |  | 2026-11-05 | 2026-08-24 | 2026-08-24 | Low | To Do |  |  |  | 0 | Operations | vendor\|renewal | SF:11 |  |  |  |  |  | 3 |  |  |  |  |  | [{"id":1,"timestamp":"2026-08-23T00:00:00.000Z","html":"<p>Auto-renew expires two weeks after the due date. Negotiate seat count downward (we overprovisioned by ~30%).</p>","text":"Auto-renew expires two weeks after the due date. Negotiate seat count downward (we overprovisioned by ~30%)."}] |
| 13 | Dev environment setup | Sam Placeholder | Fictional.Jordan@example.com | 2026-05-28 | 2026-06-08 | 2026-06-09 | 2026-05-28 | Medium | Done |  |  | 2026-06-09 | 0 | Auth Migration | infra\|devops |  | LOP-100 | Task | 2026-08-19T10:30:00.000Z |  |  | 2 |  |  |  |  |  | [{"id":1,"timestamp":"2026-06-09T00:00:00.000Z","html":"<p>Docker Compose stack + seed data scripts ready. All four team members confirmed access.</p>","text":"Docker Compose stack + seed data scripts ready. All four team members confirmed access."}] |
| 14 | Risk & compliance kick-off | Morgan Standin | Invented.Riley@example.com | 2026-06-15 | 2026-06-18 | 2026-06-18 | 2026-06-15 | Medium | Done |  |  | 2026-06-18 | 0 | Auth Migration | planning\|compliance | FS:1 |  |  |  |  |  | 4 |  |  |  |  |  | [{"id":1,"timestamp":"2026-06-18T00:00:00.000Z","html":"<p>Identified 4 risk items. RAID log bootstrapped. SOC2 evidence tracker set up in Confluence.</p>","text":"Identified 4 risk items. RAID log bootstrapped. SOC2 evidence tracker set up in Confluence."}] |

# RAID Log

| ID | Category | Title | Description | Severity | Probability | Impact | Status | Owner | OwnerEmail | OwnerResourceId | Mitigation | LinkedTasks | Raised | Target | Closed | LocalModified | CausedByIds | StakeholderIds | KnowledgeLinks | OutlookEventId | Inquiries | NoteLog | Escalations |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | R | Legacy user data corruption during migration | <p>50k bcrypt-hashed passwords move in this migration. A corrupted batch would lock users out of <strong>every</strong> connected service at once, not just login.</p><p>Worst realistic case is a partial write we do not notice until the next business day.</p> | High | 3 | 5 | Mitigated | Sam Placeholder | Fictional.Jordan@example.com | 2 | <p>Pre-migration backup + 5k-batch dry-runs with rollback markers. Weekly integrity checks during cutover week.</p> | 6 | 2026-07-16 | 2026-10-13 |  |  |  |  | [{"id":"dl-3","name":"Migration Runbook.pdf","url":"https://example.sharepoint.com/sites/auth-migration/Shared%20Documents/Migration-Runbook.pdf","kind":"file"}] |  |  | [{"id":1,"timestamp":"2026-09-09T15:20:00.000Z","html":"<p>Dry-runs of batches 1–3 came back clean and the integrity checks are green; marking this <strong>mitigated</strong>.</p>","text":"Dry-runs of batches 1–3 came back clean and the integrity checks are green; marking this mitigated.","authorResourceId":2,"authorName":"Sam Placeholder"}] |  |
| 2 | R | SSO provider outage during peak hours | <p>Vendor-side downtime would block all logins for all users.</p> | Medium | 2 | 4 | Open | Morgan Standin | Invented.Riley@example.com | 4 | <p>Provider SLA: 99.95%. Fallback: temporary local-account bypass for ops accounts (documented, time-boxed).</p> |  | 2026-07-27 |  |  |  |  | 1\|6 |  |  |  | [{"id":1,"timestamp":"2026-09-05T08:30:00.000Z","html":"<p>Vendor SLA call scheduled; requesting a 99.95% uptime commitment for peak windows.</p>","text":"Vendor SLA call scheduled; requesting a 99.95% uptime commitment for peak windows.","authorResourceId":4,"authorName":"Morgan Standin"}] |  |
| 3 | R | Performance regression on login under load | <p>Auth path adds 200ms p95 latency vs baseline; could degrade homepage TTFB.</p> | High | 4 | 3 | Realized | Sam Placeholder | Fictional.Jordan@example.com | 2 | <p>Token verification cached; index added on session lookup. Still monitoring.</p> | 4 | 2026-08-10 |  |  |  |  |  |  |  |  | [{"id":1,"timestamp":"2026-09-11T10:40:00.000Z","html":"<p>p95 is back under 120 ms after the session-index fix. Keeping it open until the load test confirms.</p>","text":"p95 is back under 120 ms after the session-index fix. Keeping it open until the load test confirms.","authorResourceId":2,"authorName":"Sam Placeholder"}] |  |
| 4 | R | Third-party dependency with known CVE | <p>passport-oauth2 v1.7.0 has CVE-2024-9999 (moderate); upgrade blocked by peer-dep conflict.</p> | Medium | 3 | 3 | Open | Alex Example | Sample.Dummy@example.com | 1 | <p>Pinned to patched fork until upstream releases v1.8.0. Upgrade scheduled for the next maintenance release.</p> | 5 | 2026-08-17 | 2026-09-22 |  |  |  |  |  |  |  |  |  |
| 5 | A | Users accept 4-hour maintenance window for cutover | <p>Comms team confirmed via survey: 92% acceptance for off-hours maintenance.</p> | Medium |  |  | Validated | Taylor Specimen | aria.patel@example.com | 3 |  |  | 2026-08-04 |  |  |  |  |  |  |  |  |  |  |
| 6 | A | All team members briefed on new auth flow | <p>Assumed frontend devs know the new cookie/token contract.</p> |  |  |  | Invalidated | Alex Example | Sample.Dummy@example.com | 1 | <p>Assumption was wrong — ran a knowledge check; 2 of 4 devs unaware. Remediated with a doc session the same week.</p> | 5 | 2026-07-27 |  | 2026-08-24 |  |  |  |  |  |  |  |  |
| 7 | A | Staging environment mirrors production load | <p>Capacity planning assumes staging handles realistic load. If wrong load tests will be misleading.</p> |  |  |  | Open | Sam Placeholder | Fictional.Jordan@example.com | 2 |  | 8 | 2026-08-13 | 2026-09-25 |  |  |  |  |  |  |  |  |  |
| 8 | I | SSO redirect loop on Safari | <p>SameSite=Strict cookie + cross-origin redirect chain triggers Safari ITP loop — surfaced in testing.</p> | High |  |  | In Progress | Sam Placeholder | Fictional.Jordan@example.com | 2 | <p>Workaround in dev: SameSite=Lax. Need security review before prod.</p> | 4\|5 | 2026-08-19 | 2026-09-07 |  |  | 3 |  |  |  |  | [{"id":1,"timestamp":"2026-09-14T13:10:00.000Z","html":"<p>Security review accepts <em>SameSite=Lax</em> for the redirect cookie; the prod change is queued behind the pen test.</p>","text":"Security review accepts SameSite=Lax for the redirect cookie; the prod change is queued behind the pen test.","authorResourceId":4,"authorName":"Morgan Standin"}] |  |
| 9 | I | Rate-limit counter not resetting correctly | <p>Sliding-window counter in Redis does not reset on TTL expiry under high concurrency; causes spurious 429s.</p> | High |  |  | Open | Sam Placeholder | Fictional.Jordan@example.com | 2 | <p>Being investigated. Temporary mitigation: raised threshold to 500 req/min.</p> | 4 | 2026-08-26 | 2026-09-09 |  |  |  |  |  |  |  | [{"id":1,"timestamp":"2026-09-01T09:30:00.000Z","html":"<p>Escalated to <strong>High</strong> after a second burst of spurious 429s in staging.</p>","text":"Escalated to High after a second burst of spurious 429s in staging.","authorResourceId":4,"authorName":"Morgan Standin"}] | [{"at":"2026-09-01T09:30:00.000Z","toName":"Sam Placeholder","toEmail":"Fictional.Jordan@example.com","toResourceId":2,"fromSeverity":"Medium","toSeverity":"High"}] |
| 10 | I | Accessibility gap in login form | <p>Missing ARIA labels on password toggle button; flagged by axe-core in CI.</p> | Low |  |  | Resolved | Alex Example | Sample.Dummy@example.com | 1 | <p>Fixed in PR #87; merged the same day.</p> | 5 | 2026-08-25 |  | 2026-08-25 |  |  |  |  |  |  |  |  |
| 11 | D | Compliance team sign-off for production | <p>InfoSec must approve SOC2 evidence package before cutover.</p> | Medium |  |  | Open | Morgan Standin | Invented.Riley@example.com | 4 |  | 7 | 2026-08-13 | 2026-09-24 |  |  |  | 1\|5 |  |  |  | [{"id":1,"timestamp":"2026-09-10T16:45:00.000Z","html":"<p>Compliance pre-review complete; formal sign-off pending the final pen-test report.</p>","text":"Compliance pre-review complete; formal sign-off pending the final pen-test report.","authorResourceId":4,"authorName":"Morgan Standin"}] |  |
| 12 | D | Network team firewall changes | <p>Egress rules to api.sso-provider.com on 443.</p> | Medium |  |  | Delivered | Taylor Specimen | aria.patel@example.com | 3 | <p>Confirmed by ticket NET-2342, closed on the target date.</p> | 4 | 2026-07-22 | 2026-08-13 | 2026-08-13 |  |  |  |  |  |  |  |  |
| 13 | D | DBA schema approval for migration tables | <p>DBA must approve 3 new tables + 2 indexes before migration script can run in prod.</p> | High |  |  | Open | Morgan Standin | Invented.Riley@example.com | 4 |  | 6 | 2026-08-21 | 2026-09-03 |  |  | 11 | 5 |  |  |  | [{"id":1,"timestamp":"2026-09-16T08:50:00.000Z","html":"<p>DBA review slipped a second time; chasing the DBA lead for a slot this week.</p>","text":"DBA review slipped a second time; chasing the DBA lead for a slot this week.","authorResourceId":4,"authorName":"Morgan Standin"}] |  |

# Absences

| ID | Assignee | Email | Start | End | Type | Note | LocalModified | ResourceId | OutlookEventId |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Alex Example | Sample.Dummy@example.com | 2026-08-10 | 2026-08-21 | vacation | Family trip |  | 1 |  |
| 2 | Sam Placeholder | Fictional.Jordan@example.com | 2026-09-15 | 2026-09-15 | sick |  |  | 2 |  |
| 3 | Taylor Specimen | aria.patel@example.com | 2026-09-28 | 2026-09-30 | training | Kubernetes cert |  | 3 |  |
| 4 | Morgan Standin | Invented.Riley@example.com | 2026-09-21 | 2026-09-22 | other | Offsite leadership summit |  | 4 |  |
| 5 | Sam Placeholder | Fictional.Jordan@example.com | 2026-11-09 | 2026-11-13 | vacation | Summer holiday |  | 2 |  |

## Calendar Events

| ID | Title | Start | StartTime | DurationMin | Location | Notes | Recurrence | Exceptions | Attendees | SendInvitations | LocalModified | OutlookEventId |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Project standup | 2026-06-01 | 09:00 | 15 |  |  | {"freq":"weekly","interval":1,"byDay":["MO","WE","FR"]} |  |  |  |  |  |
| 2 | Steering board | 2026-06-09 | 14:00 | 60 |  |  | {"freq":"monthly","interval":1,"byDay":{"ordinal":2,"day":"TU"}} | [{"date":"2026-08-11","kind":"skip"}] |  |  |  |  |

# Shifts

| ID | Assignee | Email | ResourceId | Sun | Mon | Tue | Wed | Thu | Fri | Sat | Note | LocalModified |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Alex Example | Sample.Dummy@example.com | 1 | 0 | 8 | 8 | 8 | 8 | 8 | 0 | Standard 5-day week |  |
| 2 | Sam Placeholder | Fictional.Jordan@example.com | 2 | 0 | 10 | 10 | 10 | 10 | 0 | 0 | Compressed 4-day week |  |
| 3 | Taylor Specimen | aria.patel@example.com | 3 | 0 | 8 | 8 | 8 | 8 | 4 | 0 | Short Friday |  |
| 4 | Morgan Standin | Invented.Riley@example.com | 4 | 0 | 6 | 6 | 6 | 6 | 6 | 0 | 30h part-time |  |

# Disciplines

| ID | Name | LocalModified |
| --- | --- | --- |
| 1 | Developer |  |
| 2 | Business Analyst |  |
| 3 | Consultant |  |
| 4 | Project Manager |  |

# Grades

| ID | Name | LocalModified |
| --- | --- | --- |
| 1 | Junior |  |
| 2 | Associate |  |
| 3 | Consultant |  |
| 4 | Senior |  |
| 5 | Lead |  |
| 6 | Principal |  |

# Roles

| ID | DisciplineId | GradeId | InternalRate | ExternalRate | InternalRateDay | ExternalRateDay | RateBasis | LocalModified | Order |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | 4 | 95 | 145 | 760 | 1160 | day |  | 1 |
| 2 | 1 | 5 | 110 | 165 | 880 | 1320 | day |  | 0 |
| 3 | 2 | 3 | 80 | 120 | 640 | 960 | day |  | 4 |
| 4 | 4 | 4 | 100 | 150 | 800 | 1200 | day |  | 5 |
| 5 | 1 | 3 | 75 | 110 | 600 | 880 | day |  | 2 |
| 6 | 3 | 5 | 115 | 170 |  |  |  |  | 3 |

# Resources

| ID | First | Last | Title | Phone | Location | Department | Email | Company | Birthday | Notes | RoleId | Mode | Utilization | AbsenceOverride | Active | LocalModified | Emails | External |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Sample | Dummy | Lead Architect | +49 30 5550101 | Berlin | IAM | Sample.Dummy@example.com | Acme | 06-14 | Primary SSO architect; OIDC lead. | 1 | percent | 2026-06=90\|2026-07=90\|2026-08=50\|2026-09=80\|2026-10=80\|2026-11=60\|2026-12=50 | 2026-08=88 |  |  |  |  |
| 2 | Fictional | Jordan | Senior Developer | +49 89 5550102 | Munich | Engineering | Fictional.Jordan@example.com | Acme | 11-02 | Backend and migration tooling. | 2 | percent | 2026-06=80\|2026-07=100\|2026-08=90\|2026-09=100\|2026-10=80\|2026-11=90\|2026-12=40 |  |  |  |  |  |
| 3 | Aria | Patel | Business Analyst | +44 20 5550103 | London | Consulting | aria.patel@example.com | Acme | 03-27 | Stakeholder workshops; part-time (hours mode). | 3 | hours | 2026-06=120\|2026-07=110\|2026-08=100\|2026-09=100\|2026-10=60\|2026-11=40\|2026-12=24 |  |  |  |  |  |
| 4 | Invented | Riley | Project Manager | +49 30 5550104 | Berlin | PMO | Invented.Riley@example.com | Acme | 09-08 | Compliance and RAID owner. | 4 | percent | 2026-06=50\|2026-07=50\|2026-08=50\|2026-09=60\|2026-10=60\|2026-11=40\|2026-12=30 |  |  |  |  |  |
| 5 | David | Avery | Consultant | +48 22 5550105 | Warsaw | Consulting | david.Avery@example.com | Acme | 12-30 | Rolled off after June (0% utilization); back part-time for the Q4 advisory retainer. | 5 | percent | 2026-06=100\|2026-07=0\|2026-08=0\|2026-09=0\|2026-10=50\|2026-11=50\|2026-12=50 |  |  |  |  |  |

# Budgets

| ID | Name | PO | Type | Currency | FixedPrice | Start | End | SuccessorId | Status | Closed | Created | FxOverride | Allocations | LocalModified | Order | PlanningMode | DisciplineAllocations | RateOverrideInternal | RateOverrideExternal | TaskIds | PercentComplete |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Identity Platform – T&M | 4400125303 | tm | EUR |  | 2026-06-01 | 2026-09-30 | 4 | open |  | 2026-05-28 |  | 1;1;2026-06=150\|2026-07=140\|2026-08=70\|2026-09=120;2026-06=138\|2026-07=131\|2026-08=64\|2026-09-01=6\|2026-09-02=6\|2026-09-03=6\|2026-09-04=6\|2026-09-07=6\|2026-09-08=6\|2026-09-09=6\|2026-09-10=6\|2026-09-11=6\|2026-09-14=6\|2026-09-15=6\|2026-09-16=6\|2026-09-17=6\|2026-09-18=6~3;3;2026-07=100\|2026-08=90\|2026-09=80;2026-07=92\|2026-08=85\|2026-09-01=5\|2026-09-02=5\|2026-09-03=5\|2026-09-04=3\|2026-09-07=5\|2026-09-08=5\|2026-09-09=5\|2026-09-10=5\|2026-09-11=3\|2026-09-14=5\|2026-09-15=5\|2026-09-16=5\|2026-09-17=5\|2026-09-18=3~4;4;2026-06=60\|2026-07=60\|2026-08=60\|2026-09=60;2026-06=55\|2026-07=58\|2026-08=52\|2026-09-01=4\|2026-09-02=4\|2026-09-03=4\|2026-09-04=4\|2026-09-07=4\|2026-09-08=4\|2026-09-09=4\|2026-09-10=4\|2026-09-11=4\|2026-09-14=4\|2026-09-15=4\|2026-09-16=4\|2026-09-17=4\|2026-09-18=4 |  | 2 | detailed |  |  |  | 1;2;4 |  |
| 2 | Advisory Retainer (blended) | 4400141354 | tm | EUR |  | 2026-10-01 | 2026-12-18 |  | open |  | 2026-09-07 |  |  |  | 5 | blended | 3;5;2026-10=60\|2026-11=80\|2026-12=50;~1;2;2026-11=20\|2026-12=40; |  |  |  |  |
| 3 | Capped SOW (rate override) | 4400087177 | tm | EUR |  | 2026-09-01 | 2026-11-30 | 2 | open |  | 2026-08-17 |  | 2;2;2026-09=40\|2026-10=50\|2026-11=100;2026-09-01=3\|2026-09-02=3\|2026-09-03=3\|2026-09-07=3\|2026-09-08=3\|2026-09-09=3\|2026-09-10=3\|2026-09-14=3\|2026-09-16=3\|2026-09-17=3 |  | 4 | detailed |  | 90 | 200 |  | 15 |
| 4 | Data Migration (fixed price) | 4400098499 | fixed | USD | 80000 | 2026-08-01 | 2026-10-31 | 3 | open |  | 2026-07-20 | 1.1 | 2;2;2026-08=60\|2026-09=90\|2026-10=80;2026-08-17=7\|2026-08-18=6\|2026-08-19=6\|2026-08-20=7\|2026-08-24=6\|2026-08-25=6\|2026-08-26=7\|2026-08-27=6\|2026-08-31=6\|2026-09-01=6\|2026-09-02=6\|2026-09-03=6\|2026-09-07=6\|2026-09-08=6\|2026-09-09=6\|2026-09-10=6\|2026-09-14=6\|2026-09-16=6\|2026-09-17=6~1;1;2026-10=100; |  | 3 | detailed |  |  |  |  |  |
| 5 | Discovery Phase (closed) | 4400053230 | tm | EUR |  | 2026-06-01 | 2026-06-30 | 1 | closed | 2026-06-30 | 2026-05-26 |  | 3;3;2026-06=50;2026-06=46 |  | 0 | detailed |  |  |  |  |  |
| 6 | Hypercare Support (fixed price) | 4400172608 | fixed | GBP | 36000 | 2026-11-01 | 2026-12-18 |  | open |  | 2026-09-14 |  |  |  | 6 | blended | 1;1;2026-11=80\|2026-12=60;~4;4;2026-11=40\|2026-12=30; |  |  |  |  |
| 7 | Security Review (closed, rate override) | 4400163921 | tm | EUR |  | 2026-07-01 | 2026-07-31 | 3 | closed | 2026-07-31 | 2026-06-24 |  | 6;;2026-07=60;2026-07=68 |  | 1 | detailed |  | 105 | 185 |  |  |

## FX Rates

EUR,2026-09-17,2026-09-17T16:00:00.000Z,EUR=1|USD=1.1|GBP=0.85

## Project Status

- ragOverride: A
- scheduleOverride: A
- budgetOverride: G
- scopeOverride: G
- narrative: Migration on track for the October go-live; design sign-off is complete and the OIDC PoC validated. Schedule is amber — the legacy-user migration script is the critical-path item and load testing slips if it lands late. Budget is tracking to plan and scope is stable.
- narrativeUpdatedAt: 2026-09-16T09:00:00.000Z

## Milestones

| ID | Name | Date | Description | Achieved | LinkedTasks | LocalModified | KnowledgeLinks | OutlookEventId |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Design Sign-off | 2026-07-07 |  |  |  |  | [{"id":"dl-4","name":"Design Sign-off Minutes.docx","url":"https://example.sharepoint.com/sites/auth-migration/Shared%20Documents/Design-Signoff-Minutes.docx","kind":"file"}] |  |
| 2 | Go-Live | 2026-10-20 | <p>Production cutover. Entry criteria are a green regression cycle and a completed hypercare rehearsal; the four-hour maintenance window is already agreed with comms.</p><p><em>Not</em> a go/no-go gate for MFA — that rides the change request.</p> |  |  |  |  |  |
| 3 | Hypercare Exit | 2026-12-16 |  |  |  |  |  |  |

## Changes

| ID | Title | Description | Type | Status | Impact | ImpactDescription | ScheduleImpactDays | CostImpact | RequestedBy | RaisedDate | DecisionBy | DecisionDate | ResolutionNotes | LinkedTasks | LinkedRaid | StakeholderIds | LocalModified | KnowledgeLinks | OutlookEventId | NoteLog |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Add MFA to SSO scope | <p>Extend the current SSO implementation to require multi-factor authentication (TOTP / push) for all privileged accounts before production go-live. Driven by updated InfoSec policy issued this quarter.</p> | Scope | Under Review | High | <p>Adds roughly <strong>three weeks</strong> of backend and frontend work, and pulls in a second security review cycle.</p><ol><li>Backend: TOTP enrolment + verification endpoints</li><li>Frontend: enrolment flow and recovery-code screen</li><li>Re-scope the load-test scenarios to include the MFA step</li></ol> | 21 | 18000 | Morgan Standin | 2026-09-03 | Elena Fischer |  |  | 2 | 4 | 1\|5 | 2026-09-03T09:00:00.000Z |  |  | [{"id":1,"timestamp":"2026-09-05T11:15:00.000Z","html":"<p>CAB slot booked for the next change board; InfoSec will present the revised policy alongside this request.</p>","text":"CAB slot booked for the next change board; InfoSec will present the revised policy alongside this request.","authorResourceId":4,"authorName":"Morgan Standin"},{"id":2,"timestamp":"2026-09-12T09:40:00.000Z","html":"<p>Backend estimate confirmed at <strong>13 days</strong>; the recovery-code screen is the open question.</p>","text":"Backend estimate confirmed at 13 days; the recovery-code screen is the open question.","authorResourceId":2,"authorName":"Sam Placeholder"}] |
| 2 | Extend go-live by two weeks | <p>Proposed two-week slip of the production cutover (two weeks past the planned go-live) to accommodate the MFA scope addition and unresolved SSO provider SLA concerns. Allows a full regression cycle and a second hypercare rehearsal.</p> | Schedule | Proposed | Medium | <p>Pushes hypercare exit past the year-end change freeze. Minor cost impact (two additional sprint weeks). Customer comms required; maintenance-window notice must be re-issued.</p> | 14 | 6000 | Alex Example | 2026-09-16 | Elena Fischer |  |  |  | 2 | 1\|4 | 2026-09-16T14:30:00.000Z |  |  | [{"id":1,"timestamp":"2026-09-18T13:05:00.000Z","html":"<p>Customer comms draft circulated; the maintenance-window notice needs re-issuing once the date is agreed.</p>","text":"Customer comms draft circulated; the maintenance-window notice needs re-issuing once the date is agreed.","authorResourceId":1,"authorName":"Alex Example"}] |

## Stakeholders

| ID | Name | Organization | Title | Email | Category | Influence | Interest | Notes | ResourceId | RACI | LocalModified | KnowledgeLinks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Elena Fischer | Acme |  |  | Sponsor | High | High |  |  | 1=A\|2=A\|3=C |  | [{"id":"dl-5","name":"Steering Committee Deck Q2.pptx","url":"https://example.sharepoint.com/sites/auth-migration/Shared%20Documents/Steering-Deck-Q2.pptx","kind":"file"}] |
| 2 | Sam Placeholder | Acme |  |  | Internal | High | Medium |  | 2 | 1=R\|2=A\|3=R |  |  |
| 3 | Taylor Specimen | Acme |  |  | Internal | Medium | High |  | 3 | 1=C\|2=R\|3=I |  |  |
| 4 | David Okoro | Northwind Retail Group |  |  | Customer | Medium | Medium |  |  | 1=I\|2=C\|3=C |  |  |
| 5 | Morgan Standin | InfoSec Authority |  |  | Regulator | High | Low |  | 4 | 1=I\|2=I\|3=C |  |  |
| 6 | Lena Vogt | CloudVendor GmbH |  |  | Vendor | Low | Low |  |  |  |  |  |
| 7 | Sam Rivera | Community Forum |  |  | Other | Low | High |  |  | 1=I\|2=I\|3=R |  |  |

## Plan

2026-06-01,2026-12-18,month,EUR,true

## Project Meta

- name: Customer Identity Platform
- code: CIP-2026
- description: Demo project: customer SSO / identity platform rollout with MFA and compliance gates.
- sponsor: Elena Fischer
- projectManager: Alex Example
- keyStakeholdersInternal: Elena Fischer|Sam Placeholder|Taylor Specimen
- keyStakeholdersExternal: David Okoro|Morgan Standin
- customer: Northwind Retail Group
- naceSection: G
- identityTypes: B2C|B2B
- identityCount: 500000
- stakeholderCount: 5
- products: SSO, MFA, Customer Directory
- platform: Azure AD B2C
- deployment: Cloud
- startDate: 2026-06-01
- endDate: 2026-12-18
- profitCenter: PC-4711
- quotes: Q-2026-0042
- salesforceUrl: https://example.salesforce.com/opportunity/cip-2026
- sharepointUrl: https://example.sharepoint.com/sites/cip-2026
- confluenceUrl: https://example.atlassian.net/wiki/spaces/CIP
- jiraUrl: https://example.atlassian.net/browse/CIP
- operatingTimezone: Europe/Berlin
- contactPersons: David Okoro;david.okoro@northwind.example;0|Alex Example;Sample.Dummy@example.com;1
- docRepoLocation: https://example.sharepoint.com/sites/cip-2026/Shared Documents
- regulatory: GDPR / data protection regulation|NIS2
- notes: Generated sample project for the multi-tenant Turso demo database.

## Steering Committee

```json
{
  "name": "CIP Steering Committee",
  "memberResourceIds": [
    1,
    2,
    3
  ],
  "meetings": [
    {
      "id": 1,
      "date": "2026-10-13",
      "title": "Q4 steering review",
      "agenda": "Migration readiness, load-test results, go-live gate decision.",
      "location": "Teams"
    }
  ],
  "infoSchedules": [
    {
      "id": 1,
      "label": "Board info pack",
      "leadDays": 3
    }
  ]
}
```

## Timelog Links

```json
{
  "userLinks": [
    {
      "timelogUserId": 501,
      "resourceId": 1,
      "manual": true
    },
    {
      "timelogUserId": 502,
      "resourceId": 2,
      "manual": true
    },
    {
      "timelogUserId": 503,
      "resourceId": 3,
      "manual": true
    },
    {
      "timelogUserId": 504,
      "resourceId": 4,
      "manual": true
    }
  ],
  "projectLinks": [
    {
      "timelogProjectId": 701,
      "bucketId": 1,
      "manual": true
    },
    {
      "timelogProjectId": 702,
      "bucketId": 4,
      "manual": true
    },
    {
      "timelogProjectId": 703,
      "bucketId": 3,
      "manual": true
    }
  ],
  "customerId": 42,
  "projectIds": [
    701,
    702,
    703
  ]
}
```

## Knowledge Items

```json
[
  {
    "id": "dl-6",
    "name": "Cutover runbook (draft)",
    "url": "https://example.com/cip/cutover-runbook",
    "kind": "file",
    "linkKind": "url",
    "addedAt": "2026-09-10T14:05:00.000Z",
    "taskIds": [
      10
    ]
  },
  {
    "id": "dl-7",
    "name": "Load-test report – staging",
    "url": "https://example.com/cip/load-test-report",
    "kind": "file",
    "linkKind": "url",
    "addedAt": "2026-09-15T11:30:00.000Z",
    "taskIds": [
      8
    ]
  },
  {
    "id": "dl-8",
    "name": "MFA vendor comparison",
    "url": "https://example.com/cip/mfa-vendor-comparison",
    "kind": "file",
    "linkKind": "url",
    "addedAt": "2026-09-03T09:20:00.000Z"
  },
  {
    "id": "dl-9",
    "name": "Hypercare on-call rota",
    "url": "https://example.com/cip/hypercare-rota",
    "kind": "file",
    "linkKind": "url",
    "addedAt": "2026-09-17T16:05:00.000Z"
  }
]
```

## Insights

```json
[
  {
    "id": 1,
    "key": "budgetVariance",
    "type": "budgetVariance",
    "severity": "medium",
    "status": "active",
    "data": {
      "name": "Security Review (closed, rate override)",
      "variancePct": 13,
      "buckets": 1
    },
    "firstSeenAt": "2026-08-03T07:00:00.000Z",
    "lastSeenAt": "2026-09-18T07:00:00.000Z",
    "occurrences": 12
  },
  {
    "id": 2,
    "key": "raidAging:13",
    "type": "raidAging",
    "severity": "medium",
    "status": "acknowledged",
    "data": {
      "name": "DBA schema approval for migration tables",
      "targetDate": "2026-09-03",
      "daysSinceUpdate": 28
    },
    "firstSeenAt": "2026-09-09T07:00:00.000Z",
    "lastSeenAt": "2026-09-18T07:00:00.000Z",
    "occurrences": 6,
    "entityRef": {
      "view": "raid",
      "id": 13
    },
    "acknowledgedAt": "2026-09-11T10:15:00.000Z"
  },
  {
    "id": 3,
    "key": "stalledWork",
    "type": "stalledWork",
    "severity": "medium",
    "status": "acted",
    "data": {
      "count": 4
    },
    "firstSeenAt": "2026-09-01T07:00:00.000Z",
    "lastSeenAt": "2026-09-18T07:00:00.000Z",
    "occurrences": 9,
    "actedAt": "2026-09-08T09:00:00.000Z",
    "metricAtAction": {
      "count": 5
    }
  },
  {
    "id": 4,
    "key": "milestoneSlip:1",
    "type": "milestoneSlip",
    "severity": "high",
    "status": "dismissed",
    "data": {
      "name": "Design Sign-off",
      "date": "2026-07-07",
      "daysOverdue": 2
    },
    "firstSeenAt": "2026-07-08T07:00:00.000Z",
    "lastSeenAt": "2026-07-09T07:00:00.000Z",
    "occurrences": 2,
    "entityRef": {
      "view": "milestones",
      "id": 1
    },
    "dismissedAt": "2026-07-09T11:30:00.000Z",
    "dismissReason": "Signed off in the steering call; the minutes were filed late."
  },
  {
    "id": 5,
    "key": "overdueTrend",
    "type": "overdueTrend",
    "severity": "low",
    "status": "active",
    "data": {
      "current": 3,
      "prior": 1,
      "delta": 2
    },
    "firstSeenAt": "2026-09-14T07:00:00.000Z",
    "lastSeenAt": "2026-09-18T07:00:00.000Z",
    "occurrences": 4
  }
]
```

## Documents

```json
[
  {
    "id": 1,
    "title": "Steering update",
    "blocks": [
      {
        "type": "heading",
        "level": 1,
        "text": "Steering update"
      },
      {
        "type": "paragraph",
        "html": "<p>Delivery is on track for the October go-live gate.</p>"
      },
      {
        "type": "bullets",
        "items": [
          "API integration complete",
          "UAT window confirmed"
        ]
      },
      {
        "type": "table",
        "columns": [
          "Workstream",
          "Status"
        ],
        "rows": [
          [
            "Integration",
            "Green"
          ],
          [
            "Migration",
            "Amber"
          ]
        ]
      },
      {
        "type": "pageBreak"
      },
      {
        "type": "heading",
        "level": 1,
        "text": "Open risks"
      },
      {
        "type": "dataSection",
        "key": "raid"
      }
    ],
    "createdAt": "2026-09-14T09:00:00.000Z",
    "updatedAt": "2026-09-14T09:00:00.000Z",
    "linkedEntities": [
      {
        "kind": "task",
        "id": 1,
        "label": "Design SSO architecture"
      }
    ]
  }
]
```

## Document versions

```json
[
  {
    "id": 1,
    "documentId": 1,
    "title": "Steering update",
    "blocks": [
      {
        "type": "heading",
        "level": 1,
        "text": "Steering update"
      },
      {
        "type": "paragraph",
        "html": "<p>First draft, before the go-live gate date was confirmed.</p>"
      }
    ],
    "savedAt": "2026-09-14T08:30:00.000Z",
    "source": "ai",
    "op": "update"
  }
]
```

## Activity Log

```json
[
  {
    "id": "demo-seed-001",
    "timestamp": "2026-05-26T08:30:00.000Z",
    "kind": "budget.created",
    "args": [
      "Discovery Phase"
    ],
    "actor": "user"
  },
  {
    "id": "demo-seed-002",
    "timestamp": "2026-05-28T09:10:00.000Z",
    "kind": "budget.created",
    "args": [
      "Identity Platform – T&M"
    ],
    "actor": "user"
  },
  {
    "id": "demo-seed-003",
    "timestamp": "2026-06-30T16:40:00.000Z",
    "kind": "budget.updated",
    "args": [
      "Discovery Phase (closed)"
    ],
    "actor": "user"
  },
  {
    "id": "demo-seed-005",
    "timestamp": "2026-07-07T17:00:00.000Z",
    "kind": "milestone.updated",
    "args": [
      1
    ],
    "actor": "user",
    "changes": [
      {
        "field": "description",
        "from": "",
        "to": "Signed off by the steering committee."
      }
    ]
  },
  {
    "id": "demo-seed-004",
    "timestamp": "2026-07-10T16:20:00.000Z",
    "kind": "task.completed",
    "args": [
      1,
      "Design SSO architecture"
    ],
    "actor": "user"
  },
  {
    "id": "demo-seed-006",
    "timestamp": "2026-07-31T15:00:00.000Z",
    "kind": "budget.updated",
    "args": [
      "Security Review (closed, rate override)"
    ],
    "actor": "user"
  },
  {
    "id": "demo-seed-007",
    "timestamp": "2026-08-03T11:45:00.000Z",
    "kind": "task.completed",
    "args": [
      2,
      "POC OIDC integration"
    ],
    "actor": "user"
  },
  {
    "id": "demo-seed-008",
    "timestamp": "2026-08-21T10:05:00.000Z",
    "kind": "raid.created",
    "args": [
      13,
      "D",
      "DBA schema approval for migration tables"
    ],
    "actor": "user"
  },
  {
    "id": "demo-seed-009",
    "timestamp": "2026-09-01T09:30:00.000Z",
    "kind": "raid.escalated",
    "args": [
      9,
      "Medium",
      "High"
    ],
    "actor": "ai"
  },
  {
    "id": "demo-seed-010",
    "timestamp": "2026-09-07T14:00:00.000Z",
    "kind": "budget.created",
    "args": [
      "Advisory Retainer (blended)"
    ],
    "actor": "user"
  },
  {
    "id": "demo-seed-011",
    "timestamp": "2026-09-10T08:45:00.000Z",
    "kind": "raid.statusChanged",
    "args": [
      3,
      "Open",
      "Realized"
    ],
    "actor": "user"
  },
  {
    "id": "demo-seed-012",
    "timestamp": "2026-09-14T09:05:00.000Z",
    "kind": "task.updated",
    "args": [
      6,
      "Migration script for legacy users"
    ],
    "actor": "user",
    "changes": [
      {
        "field": "healthOverride",
        "from": "",
        "to": "R"
      }
    ]
  },
  {
    "id": "demo-seed-013",
    "timestamp": "2026-09-14T09:30:00.000Z",
    "kind": "budget.created",
    "args": [
      "Hypercare Support (fixed price)"
    ],
    "actor": "user"
  },
  {
    "id": "demo-seed-014",
    "timestamp": "2026-09-17T16:05:00.000Z",
    "kind": "doc.linkAdded",
    "args": [
      "Hypercare on-call rota"
    ],
    "actor": "user"
  }
]
```
