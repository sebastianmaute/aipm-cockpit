# LOP Tasks

| ID | Task | Assignee | Email | Start | Due | Last update | Priority | Status | Blockers | Notes | Completed | Inquiries | Group | Labels | Dependencies | Jira | JiraType | LastSynced | LocalModified | Health | ResourceId | OrigEstimateMin | TimeSpentMin | DocumentLinks | OutlookEventId |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Design SSO architecture | Alex Example | Sample.Dummy@example.com | 2026-04-01 | 2026-04-20 | 2026-04-22 | High | Done |  | Reviewed OIDC vs SAML; OIDC selected based on partner roadmap. | 2026-04-22 | 0 | Auth Migration | design\|architecture |  | LOP-101 | Story |  |  |  | 1 |  |  | [{"name":"OIDC Architecture Decision.docx","url":"https://example.sharepoint.com/sites/auth-migration/Shared%20Documents/OIDC-Architecture-Decision.docx","kind":"file"}] |  |
| 2 | POC OIDC integration | Sam Placeholder | Fictional.Jordan@example.com | 2026-04-15 | 2026-04-30 | 2026-05-04 | High | Done |  | Worked through token refresh edge cases. One inquiry from product lead about UX. Merged to main. | 2026-05-04 | 1 | Auth Migration | poc\|backend | FS:1 | LOP-102 | Story |  |  |  | 2 |  |  |  |  |
| 3 | Stakeholder workshop | Taylor Specimen | aria.patel@example.com |  | 2026-05-05 | 2026-05-05 | Medium | Done |  | Workshop with security, legal, product. Action items captured in Confluence: SSO-2026-Q2. | 2026-05-05 | 0 | Auth Migration | planning\|stakeholder | SS:2 |  |  |  |  |  | 3 |  |  |  |  |
| 4 | Backend API skeleton | Sam Placeholder | Fictional.Jordan@example.com | 2026-05-04 | 2026-05-12 | 2026-05-13 | Urgent | To Do | Waiting on database schema review from DBA team. | Stalled while Jane is on holiday. Rate-limit middleware design needs review; current draft uses sliding-window over Redis. |  | 3 | Auth Migration | backend\|api | FS:2 | LOP-103 | Story | 2026-05-13T10:30:00.000Z | 2026-05-13T10:35:12.000Z |  | 2 |  |  |  |  |
| 5 | Frontend login flow | Alex Example | Sample.Dummy@example.com | 2026-05-15 | 2026-05-22 | 2026-05-14 | High | To Do |  | React component scaffolded; need to wire token storage. Considering httpOnly cookie vs sessionStorage tradeoff. |  | 0 | Auth Migration | frontend\|ui | FS:4 |  |  |  | 2026-05-14T16:20:00.000Z |  | 1 |  |  |  |  |
| 6 | Migration script for legacy users | Sam Placeholder | Fictional.Jordan@example.com | 2026-05-12 | 2026-05-25 | 2026-05-15 | High | To Do | Pending DBA approval on dry-run plan. | 50k legacy users with bcrypt-hashed passwords. Plan for incremental migration in 5k batches with rollback markers. |  | 2 | Auth Migration | backend\|migration | FS:3 |  |  |  |  | R | 2 |  |  |  |  |
| 7 | Security review | Morgan Standin | Invented.Riley@example.com | 2026-05-20 | 2026-06-02 | 2026-05-15 | Medium | To Do |  | Schedule with InfoSec. Expect ~1 week turnaround. Scope: token storage, redirect URIs, CSP, session fixation. |  | 0 | Auth Migration | security\|compliance | FS:4 |  |  |  |  |  | 4 |  |  |  |  |
| 8 | Load testing | Sam Placeholder | Fictional.Jordan@example.com | 2026-06-03 | 2026-06-10 | 2026-05-15 | Medium | To Do |  | Target: 10k concurrent logins/sec sustained for 30 minutes. Tools: k6 or Gatling. Hold a slot in the staging env. |  | 0 | Auth Migration | testing\|performance | FS:5\|FS:6 |  |  |  |  |  | 2 |  |  |  |  |
| 9 | Documentation | Taylor Specimen | aria.patel@example.com |  | 2026-06-15 | 2026-05-10 | Low | To Do |  | Update Confluence runbook + internal API docs. Add a runbook for token rotation incidents. |  | 0 | Auth Migration | docs | FF:8 |  |  |  |  |  | 3 |  |  | [{"name":"API Docs (Confluence export)","url":"https://example.sharepoint.com/sites/auth-migration/Shared%20Documents/API-Docs","kind":"folder"}] |  |
| 10 | Production cutover | Alex Example | Sample.Dummy@example.com |  | 2026-06-20 | 2026-05-15 | Urgent | To Do |  | Maintenance window: Sun 02:00-06:00 UTC. Rollback via DNS flip (60s TTL pre-staged). Status page banner from -30min. |  | 0 | Auth Migration | deployment\|critical | FS:7\|FS:8 |  |  |  |  |  | 1 |  |  |  |  |
| 11 | Quarterly OKR review | Morgan Standin | Invented.Riley@example.com |  | 2026-05-30 | 2026-05-08 | Medium | To Do |  | Compile Q2 metrics: KR1 conversion, KR2 incident MTTR, KR3 NPS. Slides due 48h before steering committee. |  | 0 | Operations | okr\|reporting |  |  |  |  |  |  | 4 |  |  |  |  |
| 12 | Vendor renewal: Datadog | Taylor Specimen | aria.patel@example.com |  | 2026-07-01 | 2026-05-15 | Low | To Do |  | Auto-renew expires 2026-07-15. Negotiate seat count downward (we overprovisioned by ~30%). |  | 0 | Operations | vendor\|renewal | SF:11 |  |  |  |  |  | 3 |  |  |  |  |
| 13 | Dev environment setup | Sam Placeholder | Fictional.Jordan@example.com | 2026-03-28 | 2026-04-04 | 2026-04-05 | Medium | Done |  | Docker Compose stack + seed data scripts ready. All four team members confirmed access. | 2026-04-05 | 0 | Auth Migration | infra\|devops |  | LOP-100 | Task | 2026-05-13T10:30:00.000Z |  |  | 2 |  |  |  |  |
| 14 | Risk & compliance kick-off | Morgan Standin | Invented.Riley@example.com | 2026-04-08 | 2026-04-10 | 2026-04-10 | Medium | Done |  | Identified 4 risk items. RAID log bootstrapped. SOC2 evidence tracker set up in Confluence. | 2026-04-10 | 0 | Auth Migration | planning\|compliance | FS:1 |  |  |  |  |  | 4 |  |  |  |  |

# RAID Log

| ID | Category | Title | Description | Severity | Probability | Impact | Status | Owner | OwnerEmail | Mitigation | LinkedTasks | Raised | Target | Closed | LocalModified | CausedByIds | DocumentLinks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | R | Legacy user data corruption during migration | 50k bcrypt-hashed passwords; corruption could lock users out of all services. | High | 3 | 5 | Mitigated | Sam Placeholder | Fictional.Jordan@example.com | Pre-migration backup + 5k-batch dry-runs with rollback markers. Weekly integrity checks during cutover week. | 6 | 2026-04-25 | 2026-06-15 |  |  |  | [{"name":"Migration Runbook.pdf","url":"https://example.sharepoint.com/sites/auth-migration/Shared%20Documents/Migration-Runbook.pdf","kind":"file"}] |
| 2 | R | SSO provider outage during peak hours | Vendor-side downtime would block all logins for all users. | Medium | 2 | 4 | Open | Morgan Standin | Invented.Riley@example.com | Provider SLA: 99.95%. Fallback: temporary local-account bypass for ops accounts (documented, time-boxed). |  | 2026-05-01 |  |  |  |  |  |
| 3 | R | Performance regression on login under load | Auth path adds 200ms p95 latency vs baseline; could degrade homepage TTFB. | High | 4 | 3 | Realized | Sam Placeholder | Fictional.Jordan@example.com | Token verification cached; index added on session lookup. Still monitoring. | 4 | 2026-05-08 |  |  |  |  |  |
| 4 | R | Third-party dependency with known CVE | passport-oauth2 v1.7.0 has CVE-2024-9999 (moderate); upgrade blocked by peer-dep conflict. | Medium | 3 | 3 | Open | Alex Example | Sample.Dummy@example.com | Pinned to patched fork until upstream releases v1.8.0. Scheduled upgrade 2026-06-01. | 5 | 2026-05-12 | 2026-06-01 |  |  |  |  |
| 5 | A | Users accept 4-hour maintenance window for cutover | Comms team confirmed via survey: 92% acceptance for off-hours maintenance. | Medium |  |  | Validated | Taylor Specimen | aria.patel@example.com |  |  | 2026-05-05 |  |  |  |  |  |
| 6 | A | All team members briefed on new auth flow | Assumed frontend devs know the new cookie/token contract. |  |  |  | Invalidated | Alex Example | Sample.Dummy@example.com | Assumption was wrong — ran a knowledge check; 2 of 4 devs unaware. Remediated with doc session on 2026-05-15. | 5 | 2026-05-01 |  | 2026-05-15 |  |  |  |
| 7 | A | Staging environment mirrors production load | Capacity planning assumes staging handles realistic load. If wrong load tests will be misleading. |  |  |  | Open | Sam Placeholder | Fictional.Jordan@example.com |  | 8 | 2026-05-10 | 2026-06-03 |  |  |  |  |
| 8 | I | SSO redirect loop on Safari | SameSite=Strict cookie + cross-origin redirect chain triggers Safari ITP loop — surfaced in testing. | High |  |  | In Progress | Sam Placeholder | Fictional.Jordan@example.com | Workaround in dev: SameSite=Lax. Need security review before prod. | 4\|5 | 2026-05-13 | 2026-05-22 |  |  | 3 |  |
| 9 | I | Rate-limit counter not resetting correctly | Sliding-window counter in Redis does not reset on TTL expiry under high concurrency; causes spurious 429s. | High |  |  | Open | Sam Placeholder | Fictional.Jordan@example.com | Being investigated. Temporary mitigation: raised threshold to 500 req/min. | 4 | 2026-05-17 | 2026-05-24 |  |  |  |  |
| 10 | I | Accessibility gap in login form | Missing ARIA labels on password toggle button; flagged by axe-core in CI. | Low |  |  | Resolved | Alex Example | Sample.Dummy@example.com | Fixed in PR #87; merged 2026-05-16. | 5 | 2026-05-16 |  | 2026-05-16 |  |  |  |
| 11 | D | Compliance team sign-off for production | InfoSec must approve SOC2 evidence package before cutover. | Medium |  |  | Open | Morgan Standin | Invented.Riley@example.com |  | 7 | 2026-05-10 | 2026-06-02 |  |  |  |  |
| 12 | D | Network team firewall changes | Egress rules to api.sso-provider.com on 443. | Medium |  |  | Delivered | Taylor Specimen | aria.patel@example.com | Confirmed by ticket NET-2342 closed 2026-05-10. | 4 | 2026-04-28 | 2026-05-10 | 2026-05-10 |  |  |  |
| 13 | D | DBA schema approval for migration tables | DBA must approve 3 new tables + 2 indexes before migration script can run in prod. | High |  |  | Open | Morgan Standin | Invented.Riley@example.com |  | 6 | 2026-05-14 | 2026-05-21 |  |  | 11 |  |

# Absences

| ID | Assignee | Email | Start | End | Type | Note | LocalModified | ResourceId |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Alex Example | Sample.Dummy@example.com | 2026-06-01 | 2026-06-14 | vacation | Family trip |  |  |
| 2 | Sam Placeholder | Fictional.Jordan@example.com | 2026-05-28 | 2026-05-28 | sick |  |  |  |
| 3 | Taylor Specimen | aria.patel@example.com | 2026-06-23 | 2026-06-25 | training | Kubernetes cert |  |  |
| 4 | Morgan Standin | Invented.Riley@example.com | 2026-06-17 | 2026-06-18 | other | Offsite leadership summit |  |  |
| 5 | Sam Placeholder | Fictional.Jordan@example.com | 2026-07-07 | 2026-07-11 | vacation | Summer holiday |  |  |

# Shifts

| ID | Assignee | Email | Sun | Mon | Tue | Wed | Thu | Fri | Sat | Note | LocalModified |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Alex Example | Sample.Dummy@example.com | 0 | 8 | 8 | 8 | 8 | 8 | 0 | Standard 5-day week |  |
| 2 | Sam Placeholder | Fictional.Jordan@example.com | 0 | 10 | 10 | 10 | 10 | 0 | 0 | Compressed 4-day week |  |
| 3 | Taylor Specimen | aria.patel@example.com | 0 | 8 | 8 | 8 | 8 | 4 | 0 | Short Friday |  |
| 4 | Morgan Standin | Invented.Riley@example.com | 0 | 6 | 6 | 6 | 6 | 6 | 0 | 30h part-time |  |

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

| ID | DisciplineId | GradeId | InternalRate | ExternalRate | LocalModified |
| --- | --- | --- | --- | --- | --- |
| 1 | 1 | 4 | 95 | 145 |  |
| 2 | 1 | 5 | 110 | 165 |  |
| 3 | 2 | 3 | 80 | 120 |  |
| 4 | 4 | 4 | 100 | 150 |  |
| 5 | 1 | 3 | 75 | 110 |  |
| 6 | 3 | 5 | 115 | 170 |  |

# Resources

| ID | First | Last | Title | Phone | Location | Department | Email | Company | Birthday | Notes | RoleId | Mode | Utilization | AbsenceOverride | Active | LocalModified |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Sample | Dummy | Lead Architect | +49 30 5550101 | Berlin | IAM | Sample.Dummy@example.com | Acme | 06-14 | Primary SSO architect; OIDC lead. | 1 | percent | 2026-04=80\|2026-05=100\|2026-06=60\|2026-07=50 | 2026-06=88 |  |  |
| 2 | Fictional | Jordan | Senior Developer | +49 89 5550102 | Munich | Engineering | Fictional.Jordan@example.com | Acme | 11-02 | Backend and migration tooling. | 2 | percent | 2026-04=100\|2026-05=100\|2026-06=80\|2026-07=30 |  |  |  |
| 3 | Aria | Patel | Business Analyst | +44 20 5550103 | London | Consulting | aria.patel@example.com | Acme | 03-27 | Stakeholder workshops; part-time (hours mode). | 3 | hours | 2026-04=40\|2026-05=60\|2026-06=56\|2026-07=32 |  |  |  |
| 4 | Invented | Riley | Project Manager | +49 30 5550104 | Berlin | PMO | Invented.Riley@example.com | Acme | 09-08 | Compliance and RAID owner. | 4 | percent | 2026-04=50\|2026-05=60\|2026-06=50\|2026-07=30 |  |  |  |
| 5 | David | Avery | Consultant | +48 22 5550105 | Warsaw | Consulting | david.Avery@example.com | Acme | 12-30 | Rolled off after April (0% utilization). | 5 | percent | 2026-04=100\|2026-05=0\|2026-06=0\|2026-07=0 |  |  |  |

# Budgets

| ID | Name | PO | Type | Currency | FixedPrice | Start | End | SuccessorId | Status | Closed | FxOverride | Allocations | LocalModified | Order | PlanningMode | DisciplineAllocations | RateOverrideInternal | RateOverrideExternal |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Identity Platform – T&M | 4400125303 | tm | EUR |  | 2026-04-01 | 2026-07-31 |  | open |  |  | 1;1;2026-04=120\|2026-05=120\|2026-06=80\|2026-07=60;2026-04=118\|2026-05=130\|2026-06=44~3;3;2026-04=60\|2026-05=80\|2026-06=70\|2026-07=40;2026-04=55\|2026-05=78~4;4;2026-04=40\|2026-05=40\|2026-06=40\|2026-07=30;2026-04=42\|2026-05=38 |  | 0 | detailed |  |  |  |
| 2 | Advisory Retainer (blended) | 4400141354 | tm | EUR |  | 2026-04-01 | 2026-07-31 |  | open |  |  |  |  | 1 | blended | 3;5;2026-04=80\|2026-05=80\|2026-06=60;2026-04=75\|2026-05=82~1;2;2026-04=40\|2026-05=40;2026-04=38\|2026-05=36 |  |  |
| 3 | Capped SOW (rate override) | 4400087177 | tm | EUR |  | 2026-04-01 | 2026-07-31 |  | open |  |  | 2;2;2026-04=50\|2026-05=50\|2026-06=50;2026-04=48\|2026-05=52 |  | 2 | detailed |  | 90 | 200 |
| 4 | Data Migration (fixed price) | 4400098499 | fixed | EUR | 80000 | 2026-04-01 | 2026-07-31 |  | open |  |  | 1;1;2026-04=60\|2026-05=60;2026-04=62\|2026-05=58~5;5;2026-04=40;2026-04=40 |  | 3 | detailed |  |  |  |
| 5 | Discovery Phase (closed) | 4400053230 | tm | EUR |  | 2026-04-01 | 2026-04-30 | 1 | closed | 2026-04-30 |  | 3;3;2026-04=50;2026-04=30 |  | 4 | detailed |  |  |  |

## Plan

2026-04-01,2026-07-31,month,EUR

## Milestones

| ID | Name | Date | Description | Achieved | LinkedTasks | LocalModified | DocumentLinks | OutlookEventId |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Design Sign-off | 2026-04-20 |  |  |  |  | [{"name":"Design Sign-off Minutes.docx","url":"https://example.sharepoint.com/sites/auth-migration/Shared%20Documents/Design-Signoff-Minutes.docx","kind":"file"}] |  |
| 2 | Go-Live | 2026-09-01 |  |  |  |  |  |  |
| 3 | Hypercare Exit | 2026-12-15 |  |  |  |  |  |  |

## Stakeholders

| ID | Name | Organization | Title | Email | Category | Influence | Interest | Notes | ResourceId | RACI | LocalModified | DocumentLinks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Elena Fischer | Acme |  |  | Sponsor | High | High |  |  | 1=A\|2=A\|3=C |  | [{"name":"Steering Committee Deck Q2.pptx","url":"https://example.sharepoint.com/sites/auth-migration/Shared%20Documents/Steering-Deck-Q2.pptx","kind":"file"}] |
| 2 | Sam Placeholder | Acme |  |  | Internal | High | Medium |  | 2 | 1=R\|2=A\|3=R |  |  |
| 3 | Taylor Specimen | Acme |  |  | Internal | Medium | High |  | 3 | 1=C\|2=R\|3=I |  |  |
| 4 | David Okoro | Northwind Retail Group |  |  | Customer | Medium | Medium |  |  | 1=I\|2=C\|3=C |  |  |
| 5 | Morgan Standin | InfoSec Authority |  |  | Regulator | High | Low |  | 4 | 1=I\|2=I\|3=C |  |  |
| 6 | Lena Vogt | CloudVendor GmbH |  |  | Vendor | Low | Low |  |  |  |  |  |
| 7 | Sam Rivera | Community Forum |  |  | Other | Low | High |  |  | 1=I\|2=I\|3=R |  |  |
