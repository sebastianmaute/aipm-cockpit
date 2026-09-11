# Integrations

Jira, Microsoft 365 and Timelog: what each one connects to, how to configure
it, and where its credentials are kept.

This file owns the subject. `README.md` links here rather than summarising it.

The first time you enable any integration or AI feature (AI, Jira, Microsoft 365, Turso, or Timelog), a one-time security & responsibility disclaimer is shown; once acknowledged on a device it is never shown again.

## Jira

All browser-to-Jira traffic is proxied through Next.js API routes rather than calling Atlassian directly from the browser. This sidesteps CORS restrictions and keeps credential handling on the server boundary: the site URL, email, and API token are sent in the POST body **per request** and are never persisted server-side.

| Route | Purpose |
|-------|---------|
| `POST /api/jira/test` | Verify credentials (`/rest/api/3/myself`) |
| `POST /api/jira/projects` | List accessible projects |
| `POST /api/jira/issue-types` | List issue types for a project |
| `POST /api/jira/users` | Search assignable users |
| `POST /api/jira/search` | Run a JQL query (paginated) |
| `POST /api/jira/create-issue` | Create a new Jira issue from a local task |
| `POST /api/jira/update-issue` | Push local task edits back to Jira |
| `POST /api/jira/transition-issue` | Change an issue's workflow status category |

Jira configuration lives inside Settings → Integrations; its fields appear only after **Enable Jira sync** is ticked. Bidirectional sync with conflict resolution is available from the Jira settings section. The API token is **encrypted at rest** (AES-256-GCM device-wrapped, like the Anthropic key and Turso token — see [Security Model](security.md#security-model)); the site URL and email are stored in `localStorage` unencrypted (identifying, not secret). Credentials are sent only to your own Atlassian domain.

## Microsoft 365

Microsoft 365 features use MSAL (browser PKCE — no backend token exchange) and the Microsoft Graph API. The integration is off by default; enable it in Settings → Integrations.

| Feature | Graph scope | What it does |
|---------|-------------|--------------|
| Outlook contacts import | `Contacts.Read` | Imports personal contacts from `/me/contacts` into the Resource Directory and assignee address book via a preview-and-pick dialog; updates existing entries by email |
| Outlook calendar import | `Calendars.Read` | Imports all-day Out-of-Office events from `/me/calendarView` as Absences via a preview-and-pick dialog with a per-row absence-type selector |
| SharePoint storage | `Files.ReadWrite.All` | Stores the workspace as a single JSON or CSV blob in a SharePoint document library; URL configured in Settings → Integrations / Storage Configuration |
| SharePoint document links | `Files.ReadWrite.All` + `Sites.Read.All` (picker only) | Attaches SharePoint files/folders to workspace entities via a built-in Graph browser; links open in a new tab |
| Outlook calendar write-back | `Calendars.ReadWrite` | Pushes the current project's milestones into your Outlook calendar as all-day events (one-way, opt-in, manual "Push to Outlook" button on the Milestones view) |

### Setup

1. Register an app in [Microsoft Entra admin center](https://entra.microsoft.com/) → **App registrations → New registration**.
2. Under **Authentication → Add a platform**, choose **Single-page application (SPA)** and add the redirect URI **`<origin>/msal-redirect`** — e.g. `http://localhost:3000/msal-redirect` for dev, `https://<your-host>/msal-redirect` for production. This exact path matters (see [How sign-in works](#how-sign-in-works)); a bare origin will fail with `AADSTS50011`. Add one URI per origin you serve from. It must be the **SPA** platform, not **Web** (Web expects a client secret and a query-code flow the browser can't complete).
3. Grant **delegated** Microsoft Graph permissions: `User.Read` (sign-in), plus `Contacts.Read`, `Calendars.Read`, `Calendars.ReadWrite` (calendar write-back/two-way sync), `Files.ReadWrite.All`, `Sites.Read.All` (or narrower equivalents — grant only the scopes for the features you use). Consent to each scope is requested incrementally on first use.
4. From the app registration **Overview**, copy the **Application (client) ID** and **Directory (tenant) ID** into Settings → Integrations → Microsoft 365, or provide them via the env vars below. No client secret is used or stored — MSAL runs a public-client PKCE flow entirely in the browser.

### How sign-in works

Sign-in opens a Microsoft pop-up. On success Microsoft redirects the pop-up to the app's dedicated **`/msal-redirect`** route (not the main app), which uses the MSAL v5 [redirect-bridge](https://github.com/AzureAD/microsoft-authentication-library-for-js) (`broadcastResponseToMainFrame`) to hand the response back to the opener over a `BroadcastChannel` and close itself. This route is intentionally minimal so the full app never boots inside the pop-up. Runtime config (Client ID / Tenant ID) is read from Settings first and env vars second, so the integration works without a rebuild.

Troubleshooting (from `window.__aipmDiag()` diagnostics under `msauth.*`):

| Symptom / error | Cause | Fix |
|-----------------|-------|-----|
| `MSAL config not available` | No Client ID from Settings **or** env | Enter Client ID / Tenant ID in Settings → Integrations |
| `AADSTS50011: redirect URI … does not match` | The exact `<origin>/msal-redirect` URI isn't registered | Add it under Authentication → **SPA** (step 2) |
| Pop-up opens but shows the app and never closes | Redirect target isn't the `/msal-redirect` bridge route | Register `<origin>/msal-redirect` and ensure it's reachable |
| `interaction_in_progress`, pop-up won't open | A prior aborted sign-in left MSAL's lock set | Reload the page (the app auto-clears the stale lock on load), or clear `msal.*` keys in Local Storage |

## Timelog

Pull actual time bookings from a Timelog timekeeping account and compare them against the budget. All reads are proxied through a same-origin Next.js route (`/api/timelog`, SSRF-guarded and rate-limited); the host, tenant, and personal token are sent per request and never persisted server-side. The token is **encrypted at rest** (device-wrapped — see [Security Model](security.md#security-model)).

Fetching is two-step so a large organisation stays under the rate limit: **Load people** pulls the Timelog directory only, a filter box narrows it and you tick who you need, then **Fetch bookings** pulls timesheets for the ticked people only. Lists page through all results and retry automatically on rate-limit responses; a loading window shows progress with a **Cancel** button, and **Clear all** resets the fetched data. **Load my projects** loads the projects you are Project Manager for (with an **Include closed projects** option, or a customer picker to load one client's projects) so you can match Timelog people and projects to your resources and budgets before any bookings are fetched. A resource's hours count as booked only when its Timelog user is linked to a resource **and** the booking's project is linked to a budget bucket; **Apply to budget** writes each person's hours into the allocation line they belong to — matched by the line's named resources, else by their role in the directory — so people on different roles are costed at their own rates; hours that match no line are withheld and reported rather than charged to another role, and the confirm step itemises every row it will write. Self-scoped to the token owner by default; org-wide reads require the relevant Timelog privilege.
