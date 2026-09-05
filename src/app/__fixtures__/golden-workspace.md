# AIPM Tasks

| ID | Task | Assignee | Email | Start | Due | Last update | Created | Priority | Status | Blockers | Description | Completed | Inquiries | Group | Labels | Dependencies | Jira | JiraType | LastSynced | LocalModified | Health | ResourceId | OrigEstimateMin | TimeSpentMin | RemainingEstimateMin | KnowledgeLinks | OutlookEventId | NoteLog |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Design SSO architecture | Alex Example | Sample.Dummy@example.com | 2026-04-01 | 2026-04-20 | 2026-04-22 | 2026-04-01 | High | Done |  | <p>Replace the hand-rolled session cookie with the shared <strong>token service</strong>. The old cookie is issued in three different places and none of them agree on expiry.</p><p>Definition of done:</p><ul><li>One issuing path, covered by tests</li><li>Expiry read from config, not hard-coded</li><li>Old cookie name still accepted for one release</li></ul><p>See the <a href="https://example.com/adr/017-token-service">ADR</a> for the agreed contract.</p> | 2026-04-22 | 0 | Auth Migration | design\|architecture |  | LOP-101 | Story |  |  |  | 1 |  |  |  | [{"id":"dl-1","name":"OIDC Architecture Decision.docx","url":"https://example.sharepoint.com/sites/auth-migration/Shared%20Documents/OIDC-Architecture-Decision.docx","kind":"file"}] |  | [{"id":1,"timestamp":"2026-04-22T00:00:00.000Z","html":"<p>Reviewed OIDC vs SAML; OIDC selected based on partner roadmap.</p>","text":"Reviewed OIDC vs SAML; OIDC selected based on partner roadmap."},{"id":2,"timestamp":"2026-04-23T09:15:00.000Z","html":"<p>Partner confirmed the OIDC discovery endpoint is stable; no SAML fallback needed.</p>","text":"Partner confirmed the OIDC discovery endpoint is stable; no SAML fallback needed.","authorResourceId":1,"authorName":"Alex Example"}] |
| 2 | POC OIDC integration | Sam Placeholder | Fictional.Jordan@example.com | 2026-04-15 | 2026-04-30 | 2026-05-04 | 2026-04-15 | High | Done |  |  | 2026-05-04 | 1 | Auth Migration | poc\|backend | FS:1 | LOP-102 | Story |  |  |  | 2 |  |  |  |  |  | [{"id":1,"timestamp":"2026-05-04T00:00:00.000Z","html":"<p>Worked through token refresh edge cases. One inquiry from product lead about UX. Merged to main.</p>","text":"Worked through token refresh edge cases. One inquiry from product lead about UX. Merged to main."}] |
| 3 | Stakeholder workshop | Taylor Specimen | aria.patel@example.com |  | 2026-05-05 | 2026-05-05 | 2026-05-05 | Medium | Done |  | <p>Frontend still reads <em>user.roles</em> straight off the legacy payload. Switch it to the claim on the new token — <strong>do not</strong> ship this before the backend task above.</p> | 2026-05-05 | 0 | Auth Migration | planning\|stakeholder | SS:2 |  |  |  |  |  | 3 |  |  |  |  |  | [{"id":1,"timestamp":"2026-05-05T00:00:00.000Z","html":"<p>Workshop with security, legal, product. Action items captured in Confluence: SSO-2026-Q2.</p>","text":"Workshop with security, legal, product. Action items captured in Confluence: SSO-2026-Q2."}] |
| 4 | Backend API skeleton | Sam Placeholder | Fictional.Jordan@example.com | 2026-05-04 | 2026-05-12 | 2026-05-13 | 2026-05-04 | Urgent | To Do | Waiting on database schema review from DBA team. |  |  | 3 | Auth Migration | backend\|api | FS:2 | LOP-103 | Story | 2026-05-13T10:30:00.000Z | 2026-05-13T10:35:12.000Z |  | 2 |  |  |  |  |  | [{"id":1,"timestamp":"2026-05-13T00:00:00.000Z","html":"<p>Stalled while Jane is on holiday. Rate-limit middleware design needs review; current draft uses sliding-window over Redis.</p>","text":"Stalled while Jane is on holiday. Rate-limit middleware design needs review; current draft uses sliding-window over Redis."},{"id":2,"timestamp":"2026-05-14T11:00:00.000Z","html":"<p>Redis sliding-window middleware drafted; awaiting DBA schema review before wiring rate limits.</p>","text":"Redis sliding-window middleware drafted; awaiting DBA schema review before wiring rate limits.","authorResourceId":2,"authorName":"Sam Placeholder"}] |
| 5 | Frontend login flow | Alex Example | Sample.Dummy@example.com | 2026-05-15 | 2026-05-22 | 2026-05-14 | 2026-05-15 | High | To Do |  |  |  | 0 | Auth Migration | frontend\|ui | FS:4 |  |  |  | 2026-05-14T16:20:00.000Z |  | 1 |  |  |  |  |  | [{"id":1,"timestamp":"2026-05-14T00:00:00.000Z","html":"<p>React component scaffolded; need to wire token storage. Considering httpOnly cookie vs sessionStorage tradeoff.</p>","text":"React component scaffolded; need to wire token storage. Considering httpOnly cookie vs sessionStorage tradeoff."}] |
| 6 | Migration script for legacy users | Sam Placeholder | Fictional.Jordan@example.com | 2026-05-12 | 2026-05-25 | 2026-05-15 | 2026-05-12 | High | To Do | Pending DBA approval on dry-run plan. |  |  | 2 | Auth Migration | backend\|migration | FS:3 |  |  |  |  | R | 2 |  |  |  |  |  | [{"id":1,"timestamp":"2026-05-15T00:00:00.000Z","html":"<p>50k legacy users with bcrypt-hashed passwords. Plan for incremental migration in 5k batches with rollback markers.</p>","text":"50k legacy users with bcrypt-hashed passwords. Plan for incremental migration in 5k batches with rollback markers."}] |
| 7 | Security review | Morgan Standin | Invented.Riley@example.com | 2026-05-20 | 2026-06-02 | 2026-05-15 | 2026-05-20 | Medium | To Do |  |  |  | 0 | Auth Migration | security\|compliance | FS:4 |  |  |  |  |  | 4 |  |  |  |  |  | [{"id":1,"timestamp":"2026-05-15T00:00:00.000Z","html":"<p>Schedule with InfoSec. Expect ~1 week turnaround. Scope: token storage, redirect URIs, CSP, session fixation.</p>","text":"Schedule with InfoSec. Expect ~1 week turnaround. Scope: token storage, redirect URIs, CSP, session fixation."}] |
| 8 | Load testing | Sam Placeholder | Fictional.Jordan@example.com | 2026-06-03 | 2026-06-10 | 2026-05-15 | 2026-06-03 | Medium | To Do |  |  |  | 0 | Auth Migration | testing\|performance | FS:5\|FS:6 |  |  |  |  |  | 2 |  |  |  |  |  | [{"id":1,"timestamp":"2026-05-15T00:00:00.000Z","html":"<p>Target: 10k concurrent logins/sec sustained for 30 minutes. Tools: k6 or Gatling. Hold a slot in the staging env.</p>","text":"Target: 10k concurrent logins/sec sustained for 30 minutes. Tools: k6 or Gatling. Hold a slot in the staging env."}] |
| 9 | Documentation | Taylor Specimen | aria.patel@example.com |  | 2026-06-15 | 2026-05-10 | 2026-05-10 | Low | To Do |  |  |  | 0 | Auth Migration | docs | FF:8 |  |  |  |  |  | 3 |  |  |  | [{"id":"dl-2","name":"API Docs (Confluence export)","url":"https://example.sharepoint.com/sites/auth-migration/Shared%20Documents/API-Docs","kind":"folder"}] |  | [{"id":1,"timestamp":"2026-05-10T00:00:00.000Z","html":"<p>Update Confluence runbook + internal API docs. Add a runbook for token rotation incidents.</p>","text":"Update Confluence runbook + internal API docs. Add a runbook for token rotation incidents."}] |
| 10 | Production cutover | Alex Example | Sample.Dummy@example.com |  | 2026-06-20 | 2026-05-15 | 2026-05-15 | Urgent | To Do |  |  |  | 0 | Auth Migration | deployment\|critical | FS:7\|FS:8 |  |  |  |  |  | 1 |  |  |  |  |  | [{"id":1,"timestamp":"2026-05-15T00:00:00.000Z","html":"<p>Maintenance window: Sun 02:00-06:00 UTC. Rollback via DNS flip (60s TTL pre-staged). Status page banner from -30min.</p>","text":"Maintenance window: Sun 02:00-06:00 UTC. Rollback via DNS flip (60s TTL pre-staged). Status page banner from -30min."}] |
| 11 | Quarterly OKR review | Morgan Standin | Invented.Riley@example.com |  | 2026-05-30 | 2026-05-08 | 2026-05-08 | Medium | To Do |  |  |  | 0 | Operations | okr\|reporting |  |  |  |  |  |  | 4 |  |  |  |  |  | [{"id":1,"timestamp":"2026-05-08T00:00:00.000Z","html":"<p>Compile Q2 metrics: KR1 conversion, KR2 incident MTTR, KR3 NPS. Slides due 48h before steering committee.</p>","text":"Compile Q2 metrics: KR1 conversion, KR2 incident MTTR, KR3 NPS. Slides due 48h before steering committee."}] |
| 12 | Vendor renewal: Datadog | Taylor Specimen | aria.patel@example.com |  | 2026-07-01 | 2026-05-15 | 2026-05-15 | Low | To Do |  |  |  | 0 | Operations | vendor\|renewal | SF:11 |  |  |  |  |  | 3 |  |  |  |  |  | [{"id":1,"timestamp":"2026-05-15T00:00:00.000Z","html":"<p>Auto-renew expires 2026-07-15. Negotiate seat count downward (we overprovisioned by ~30%).</p>","text":"Auto-renew expires 2026-07-15. Negotiate seat count downward (we overprovisioned by ~30%)."}] |
| 13 | Dev environment setup | Sam Placeholder | Fictional.Jordan@example.com | 2026-03-28 | 2026-04-04 | 2026-04-05 | 2026-03-28 | Medium | Done |  |  | 2026-04-05 | 0 | Auth Migration | infra\|devops |  | LOP-100 | Task | 2026-05-13T10:30:00.000Z |  |  | 2 |  |  |  |  |  | [{"id":1,"timestamp":"2026-04-05T00:00:00.000Z","html":"<p>Docker Compose stack + seed data scripts ready. All four team members confirmed access.</p>","text":"Docker Compose stack + seed data scripts ready. All four team members confirmed access."}] |
| 14 | Risk & compliance kick-off | Morgan Standin | Invented.Riley@example.com | 2026-04-08 | 2026-04-10 | 2026-04-10 | 2026-04-08 | Medium | Done |  |  | 2026-04-10 | 0 | Auth Migration | planning\|compliance | FS:1 |  |  |  |  |  | 4 |  |  |  |  |  | [{"id":1,"timestamp":"2026-04-10T00:00:00.000Z","html":"<p>Identified 4 risk items. RAID log bootstrapped. SOC2 evidence tracker set up in Confluence.</p>","text":"Identified 4 risk items. RAID log bootstrapped. SOC2 evidence tracker set up in Confluence."}] |

# RAID Log

| ID | Category | Title | Description | Severity | Probability | Impact | Status | Owner | OwnerEmail | OwnerResourceId | Mitigation | LinkedTasks | Raised | Target | Closed | LocalModified | CausedByIds | StakeholderIds | KnowledgeLinks | OutlookEventId | Inquiries | NoteLog |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | R | Legacy user data corruption during migration | <p>50k bcrypt-hashed passwords move in this migration. A corrupted batch would lock users out of <strong>every</strong> connected service at once, not just login.</p><p>Worst realistic case is a partial write we do not notice until the next business day.</p> | High | 3 | 5 | Mitigated | Sam Placeholder | Fictional.Jordan@example.com | 2 | <p>Pre-migration backup + 5k-batch dry-runs with rollback markers. Weekly integrity checks during cutover week.</p> | 6 | 2026-04-25 | 2026-06-15 |  |  |  |  | [{"id":"dl-3","name":"Migration Runbook.pdf","url":"https://example.sharepoint.com/sites/auth-migration/Shared%20Documents/Migration-Runbook.pdf","kind":"file"}] |  |  |  |
| 2 | R | SSO provider outage during peak hours | <p>Vendor-side downtime would block all logins for all users.</p> | Medium | 2 | 4 | Open | Morgan Standin | Invented.Riley@example.com | 4 | <p>Provider SLA: 99.95%. Fallback: temporary local-account bypass for ops accounts (documented, time-boxed).</p> |  | 2026-05-01 |  |  |  |  | 1\|6 |  |  |  | [{"id":1,"timestamp":"2026-05-22T08:30:00.000Z","html":"<p>Vendor SLA call scheduled; requesting a 99.95% uptime commitment for peak windows.</p>","text":"Vendor SLA call scheduled; requesting a 99.95% uptime commitment for peak windows.","authorResourceId":4,"authorName":"Morgan Standin"}] |
| 3 | R | Performance regression on login under load | <p>Auth path adds 200ms p95 latency vs baseline; could degrade homepage TTFB.</p> | High | 4 | 3 | Realized | Sam Placeholder | Fictional.Jordan@example.com | 2 | <p>Token verification cached; index added on session lookup. Still monitoring.</p> | 4 | 2026-05-08 |  |  |  |  |  |  |  |  |  |
| 4 | R | Third-party dependency with known CVE | <p>passport-oauth2 v1.7.0 has CVE-2024-9999 (moderate); upgrade blocked by peer-dep conflict.</p> | Medium | 3 | 3 | Open | Alex Example | Sample.Dummy@example.com | 1 | <p>Pinned to patched fork until upstream releases v1.8.0. Scheduled upgrade 2026-06-01.</p> | 5 | 2026-05-12 | 2026-06-01 |  |  |  |  |  |  |  |  |
| 5 | A | Users accept 4-hour maintenance window for cutover | <p>Comms team confirmed via survey: 92% acceptance for off-hours maintenance.</p> | Medium |  |  | Validated | Taylor Specimen | aria.patel@example.com | 3 |  |  | 2026-05-05 |  |  |  |  |  |  |  |  |  |
| 6 | A | All team members briefed on new auth flow | <p>Assumed frontend devs know the new cookie/token contract.</p> |  |  |  | Invalidated | Alex Example | Sample.Dummy@example.com | 1 | <p>Assumption was wrong — ran a knowledge check; 2 of 4 devs unaware. Remediated with doc session on 2026-05-15.</p> | 5 | 2026-05-01 |  | 2026-05-15 |  |  |  |  |  |  |  |
| 7 | A | Staging environment mirrors production load | <p>Capacity planning assumes staging handles realistic load. If wrong load tests will be misleading.</p> |  |  |  | Open | Sam Placeholder | Fictional.Jordan@example.com | 2 |  | 8 | 2026-05-10 | 2026-06-03 |  |  |  |  |  |  |  |  |
| 8 | I | SSO redirect loop on Safari | <p>SameSite=Strict cookie + cross-origin redirect chain triggers Safari ITP loop — surfaced in testing.</p> | High |  |  | In Progress | Sam Placeholder | Fictional.Jordan@example.com | 2 | <p>Workaround in dev: SameSite=Lax. Need security review before prod.</p> | 4\|5 | 2026-05-13 | 2026-05-22 |  |  | 3 |  |  |  |  |  |
| 9 | I | Rate-limit counter not resetting correctly | <p>Sliding-window counter in Redis does not reset on TTL expiry under high concurrency; causes spurious 429s.</p> | High |  |  | Open | Sam Placeholder | Fictional.Jordan@example.com | 2 | <p>Being investigated. Temporary mitigation: raised threshold to 500 req/min.</p> | 4 | 2026-05-17 | 2026-05-24 |  |  |  |  |  |  |  |  |
| 10 | I | Accessibility gap in login form | <p>Missing ARIA labels on password toggle button; flagged by axe-core in CI.</p> | Low |  |  | Resolved | Alex Example | Sample.Dummy@example.com | 1 | <p>Fixed in PR #87; merged 2026-05-16.</p> | 5 | 2026-05-16 |  | 2026-05-16 |  |  |  |  |  |  |  |
| 11 | D | Compliance team sign-off for production | <p>InfoSec must approve SOC2 evidence package before cutover.</p> | Medium |  |  | Open | Morgan Standin | Invented.Riley@example.com | 4 |  | 7 | 2026-05-10 | 2026-06-02 |  |  |  | 1\|5 |  |  |  | [{"id":1,"timestamp":"2026-05-25T16:45:00.000Z","html":"<p>Compliance pre-review complete; formal sign-off pending the final pen-test report.</p>","text":"Compliance pre-review complete; formal sign-off pending the final pen-test report.","authorResourceId":4,"authorName":"Morgan Standin"}] |
| 12 | D | Network team firewall changes | <p>Egress rules to api.sso-provider.com on 443.</p> | Medium |  |  | Delivered | Taylor Specimen | aria.patel@example.com | 3 | <p>Confirmed by ticket NET-2342 closed 2026-05-10.</p> | 4 | 2026-04-28 | 2026-05-10 | 2026-05-10 |  |  |  |  |  |  |  |
| 13 | D | DBA schema approval for migration tables | <p>DBA must approve 3 new tables + 2 indexes before migration script can run in prod.</p> | High |  |  | Open | Morgan Standin | Invented.Riley@example.com | 4 |  | 6 | 2026-05-14 | 2026-05-21 |  |  | 11 | 5 |  |  |  |  |

# Absences

| ID | Assignee | Email | Start | End | Type | Note | LocalModified | ResourceId | OutlookEventId |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Alex Example | Sample.Dummy@example.com | 2026-06-01 | 2026-06-14 | vacation | Family trip |  | 1 |  |
| 2 | Sam Placeholder | Fictional.Jordan@example.com | 2026-05-28 | 2026-05-28 | sick |  |  | 2 |  |
| 3 | Taylor Specimen | aria.patel@example.com | 2026-06-23 | 2026-06-25 | training | Kubernetes cert |  | 3 |  |
| 4 | Morgan Standin | Invented.Riley@example.com | 2026-06-17 | 2026-06-18 | other | Offsite leadership summit |  | 4 |  |
| 5 | Sam Placeholder | Fictional.Jordan@example.com | 2026-07-07 | 2026-07-11 | vacation | Summer holiday |  | 2 |  |

## Calendar Events

| ID | Title | Start | StartTime | DurationMin | Location | Notes | Recurrence | Exceptions | Attendees | SendInvitations | LocalModified | OutlookEventId |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Project standup | 2026-01-05 | 09:00 | 15 |  |  | {"freq":"weekly","interval":1,"byDay":["MO","WE","FR"]} |  |  |  |  |  |
| 2 | Steering board | 2026-01-13 | 14:00 | 60 |  |  | {"freq":"monthly","interval":1,"byDay":{"ordinal":2,"day":"TU"}} | [{"date":"2026-04-14","kind":"skip"}] |  |  |  |  |

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
| 1 | 1 | 4 | 95 | 145 | 760 | 1160 | day |  |  |
| 2 | 1 | 5 | 110 | 165 | 880 | 1320 | day |  |  |
| 3 | 2 | 3 | 80 | 120 | 640 | 960 | day |  |  |
| 4 | 4 | 4 | 100 | 150 | 800 | 1200 | day |  |  |
| 5 | 1 | 3 | 75 | 110 | 600 | 880 | day |  |  |
| 6 | 3 | 5 | 115 | 170 | 920 | 1360 | day |  |  |

# Resources

| ID | First | Last | Title | Phone | Location | Department | Email | Company | Birthday | Notes | RoleId | Mode | Utilization | AbsenceOverride | Active | LocalModified | Emails | External |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Sample | Dummy | Lead Architect | +49 30 5550101 | Berlin | IAM | Sample.Dummy@example.com | Acme | 06-14 | Primary SSO architect; OIDC lead. | 1 | percent | 2026-04=80\|2026-05=100\|2026-06=60\|2026-07=50 | 2026-06=88 |  |  |  |  |
| 2 | Fictional | Jordan | Senior Developer | +49 89 5550102 | Munich | Engineering | Fictional.Jordan@example.com | Acme | 11-02 | Backend and migration tooling. | 2 | percent | 2026-04=100\|2026-05=100\|2026-06=80\|2026-07=30 |  |  |  |  |  |
| 3 | Aria | Patel | Business Analyst | +44 20 5550103 | London | Consulting | aria.patel@example.com | Acme | 03-27 | Stakeholder workshops; part-time (hours mode). | 3 | hours | 2026-04=40\|2026-05=60\|2026-06=56\|2026-07=32 |  |  |  |  |  |
| 4 | Invented | Riley | Project Manager | +49 30 5550104 | Berlin | PMO | Invented.Riley@example.com | Acme | 09-08 | Compliance and RAID owner. | 4 | percent | 2026-04=50\|2026-05=60\|2026-06=50\|2026-07=30 |  |  |  |  |  |
| 5 | David | Avery | Consultant | +48 22 5550105 | Warsaw | Consulting | david.Avery@example.com | Acme | 12-30 | Rolled off after April (0% utilization). | 5 | percent | 2026-04=100\|2026-05=0\|2026-06=0\|2026-07=0 |  |  |  |  |  |

# Budgets

| ID | Name | PO | Type | Currency | FixedPrice | Start | End | SuccessorId | Status | Closed | FxOverride | Allocations | LocalModified | Order | PlanningMode | DisciplineAllocations | RateOverrideInternal | RateOverrideExternal | TaskIds | PercentComplete |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Identity Platform – T&M | 4400125303 | tm | EUR |  | 2026-04-01 | 2026-06-30 | 4 | open |  |  | 1;1;2026-04=150\|2026-05=165\|2026-06=65;2026-04=116\|2026-05=128\|2026-06=48~3;3;2026-05=130\|2026-06=120;2026-05=78\|2026-06=55~4;4;2026-05=80\|2026-06=70;2026-05=42\|2026-06=38 |  | 0 | detailed |  |  |  | 1;2;4 |  |
| 2 | Advisory Retainer (blended) | 4400141354 | tm | EUR |  | 2026-06-01 | 2026-07-31 |  | open |  |  |  |  | 1 | blended | 3;5;2026-06=100\|2026-07=120;2026-06=72\|2026-07=85~1;2;2026-06=40\|2026-07=40;2026-06=37\|2026-07=37 |  |  |  |  |
| 3 | Capped SOW (rate override) | 4400087177 | tm | EUR |  | 2026-06-01 | 2026-07-31 | 2 | open |  |  | 2;2;2026-06=80\|2026-07=70;2026-06=55\|2026-07=45 |  | 2 | detailed |  | 90 | 200 |  | 45 |
| 4 | Data Migration (fixed price) | 4400098499 | fixed | EUR | 80000 | 2026-06-01 | 2026-07-31 | 3 | open |  |  | 1;1;2026-06=30\|2026-07=90;2026-06=32\|2026-07=88~5;5;2026-06=40;2026-06=40 |  | 3 | detailed |  |  |  |  |  |
| 5 | Discovery Phase (closed) | 4400053230 | tm | EUR |  | 2026-04-01 | 2026-04-30 | 1 | closed | 2026-04-30 |  | 3;3;2026-04=50;2026-04=30 |  | 4 | detailed |  |  |  |  |  |

## Project Status

- ragOverride: A
- scheduleOverride: A
- budgetOverride: G
- scopeOverride: G
- narrative: Migration on track for the September go-live; design sign-off is complete and the OIDC PoC validated. Schedule is amber — the legacy-user migration script is the critical-path item and load testing slips if it lands late. Budget is tracking to plan and scope is stable.
- narrativeUpdatedAt: 2026-05-28T09:00:00.000Z

## Milestones

| ID | Name | Date | Description | Achieved | LinkedTasks | LocalModified | KnowledgeLinks | OutlookEventId |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Design Sign-off | 2026-04-20 |  |  |  |  | [{"id":"dl-4","name":"Design Sign-off Minutes.docx","url":"https://example.sharepoint.com/sites/auth-migration/Shared%20Documents/Design-Signoff-Minutes.docx","kind":"file"}] |  |
| 2 | Go-Live | 2026-09-01 | <p>Production cutover. Entry criteria are a green regression cycle and a completed hypercare rehearsal; the four-hour maintenance window is already agreed with comms.</p><p><em>Not</em> a go/no-go gate for MFA — that rides the change request.</p> |  |  |  |  |  |
| 3 | Hypercare Exit | 2026-12-15 |  |  |  |  |  |  |

## Changes

| ID | Title | Description | Type | Status | Impact | ImpactDescription | ScheduleImpactDays | CostImpact | RequestedBy | RaisedDate | DecisionBy | DecisionDate | ResolutionNotes | LinkedTasks | LinkedRaid | StakeholderIds | LocalModified | KnowledgeLinks | OutlookEventId | NoteLog |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Add MFA to SSO scope | <p>Extend the current SSO implementation to require multi-factor authentication (TOTP / push) for all privileged accounts before production go-live. Driven by updated InfoSec policy issued 2026-05-20.</p> | Scope | Under Review | High | <p>Adds roughly <strong>three weeks</strong> of backend and frontend work, and pulls in a second security review cycle.</p><ol><li>Backend: TOTP enrolment + verification endpoints</li><li>Frontend: enrolment flow and recovery-code screen</li><li>Re-scope the load-test scenarios to include the MFA step</li></ol> | 21 | 18000 | Morgan Standin | 2026-05-21 | Elena Fischer |  |  | 2 | 4 | 1\|5 | 2026-05-21T09:00:00.000Z |  |  | [{"id":1,"timestamp":"2026-05-22T11:15:00.000Z","html":"<p>CAB slot booked for 2026-06-03; InfoSec will present the revised policy alongside this request.</p>","text":"CAB slot booked for 2026-06-03; InfoSec will present the revised policy alongside this request.","authorResourceId":4,"authorName":"Morgan Standin"},{"id":2,"timestamp":"2026-05-26T09:40:00.000Z","html":"<p>Backend estimate confirmed at <strong>13 days</strong>; the recovery-code screen is the open question.</p>","text":"Backend estimate confirmed at 13 days; the recovery-code screen is the open question.","authorResourceId":2,"authorName":"Sam Placeholder"}] |
| 2 | Extend go-live by two weeks | <p>Proposed two-week slip of the production cutover (from 2026-09-01 to 2026-09-15) to accommodate the MFA scope addition and unresolved SSO provider SLA concerns. Allows a full regression cycle and a second hypercare rehearsal.</p> | Schedule | Proposed | Medium | <p>Delays hypercare exit to 2026-12-29. Minor cost impact (two additional sprint weeks). Customer comms required; maintenance-window notice must be re-issued.</p> | 14 | 6000 | Alex Example | 2026-05-28 | Elena Fischer |  |  |  | 2 | 1\|4 | 2026-05-28T14:30:00.000Z |  |  | [{"id":1,"timestamp":"2026-05-29T13:05:00.000Z","html":"<p>Customer comms draft circulated; the maintenance-window notice needs re-issuing once the date is agreed.</p>","text":"Customer comms draft circulated; the maintenance-window notice needs re-issuing once the date is agreed.","authorResourceId":1,"authorName":"Alex Example"}] |

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

2026-04-01,2026-07-31,month,EUR

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
- startDate: 2026-01-15
- endDate: 2026-09-15
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
      "date": "2026-07-10",
      "title": "Q3 steering review",
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
        "html": "<p>Delivery is on track for the March gate.</p>"
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
    "createdAt": "2026-08-01T09:00:00.000Z",
    "updatedAt": "2026-08-01T09:00:00.000Z",
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
        "html": "<p>First draft, before the March gate date was confirmed.</p>"
      }
    ],
    "savedAt": "2026-08-01T08:30:00.000Z",
    "source": "ai",
    "op": "update"
  }
]
```
