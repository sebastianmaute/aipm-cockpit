# Installing AI PM Cockpit on your laptop

## Installing

1. Download the installer from the project's [**Releases**](https://github.com/sebastianmaute/aipm-cockpit/releases)
   page — pick the newest release and click its asset link,
   `aipm-cockpit-<version>-setup.exe (Windows installer)`. No sign-in is needed once the repository
   is public.
2. Run it.
3. Windows will show a blue **"Windows protected your PC"** box. This is expected: the app is not code-signed. Click **More info**, then **Run anyway**.
4. The app installs for your user only — you do **not** need admin rights.
5. Optional: verify the download carries this repository's build provenance —
   `gh attestation verify aipm-cockpit-<version>-setup.exe --repo sebastianmaute/aipm-cockpit`.

If you installed a 1.13.x release, it has no updater: install the first release that has one (the
release notes say so) by hand, once, the same way as above. From then on the app checks for updates
itself — a short delay after it starts, or any time from **Help → Check for updates…** — and asks
before downloading or installing anything; it never updates silently.

## The first time you open it

The desktop app keeps its data separately from your web browser, so **it starts empty even if you used the app in your browser before.** Nothing has been lost; the browser version still has its own copy.

You will need to enter these once:

- Your AI (Anthropic) API key, if you use the AI assistant — see [Claude API key](#claude-api-key)
- Your Turso database URL and auth token, if you use Turso storage — see [Turso database](#turso-database)
- Your Jira and Timelog tokens, if you use those integrations — see [Jira API token](#jira-api-token)
  and [Timelog personal access token](#timelog-personal-access-token)
- Your speech-to-text key, if you use cloud dictation — see [Speech-to-text key](#speech-to-text-key)

None of them is required to start: the app works on its own, with your projects stored on this
laptop, and each integration can be added later.

If you work from a **project file**, open it once via the usual file picker; the app will remember it from then on.

If you use **Turso storage**, your projects appear as soon as the token is entered — that data lives on the server, not on your laptop.

## Getting your keys and tokens

Every key below is a password. The app keeps each one encrypted on this laptop, and sends it only
to the service it belongs to. Never paste one into a chat, an email or a ticket. If a laptop is
lost, or a key may have leaked, delete it at the service (the same page you created it on) and
create a new one.

All of them are entered in **Settings** (in the sidebar). The Turso, Jira and Timelog settings each
have a **Test connection** button: use it after pasting, before you rely on the integration. The AI
key is checked when you leave its field, and the model list loads once it is accepted.

### Claude API key

Used by the AI assistant (chat, AI suggestions, scheduled jobs, AI project creation). The AI
features are off until you turn them on.

1. Go to <https://console.anthropic.com> and sign in, or create an account. If your organisation
   already has an Anthropic account, ask its administrator to invite you instead, so usage is
   billed to the organisation.
2. Make sure the account has credit: **Settings → Billing** in the console. Without credit every
   request is refused.
3. Open **Settings → API keys** (<https://console.anthropic.com/settings/keys>) and click
   **Create key**. Give it a name you will recognise later, such as "AI PM Cockpit – laptop".
4. Copy the key straight away. It starts with `sk-ant-`, and the console shows it **only once**.
5. Recommended: set a monthly spend limit for the account in the console, so a runaway job cannot
   run up a large bill. Anyone who can use this laptop's profile can use the key.
6. In the app, open **Settings → AI Assistant**, tick **Enable AI assistant**, and paste the key into
   **Anthropic API key**. The **Model** list fills in once the key is accepted.
7. The first time you open the AI Assistant, it asks you to accept how your data is sent to
   Anthropic. Read it, then click **I understand — enable chat**.

If the key is ever rejected, the app shows a banner saying so; create a new key and paste it in.

### Turso database

Optional. Turso is a hosted database. Use it if you want your projects on a server (shared between
devices, with version history and snapshot trends) rather than only on this laptop. Skip this
section if you work from a project file.

1. Go to <https://turso.tech> and sign up (a GitHub or Google account works). The free plan is
   enough to start.
2. In the Turso dashboard, create a **database**. Pick a location close to you. The name is up to
   you, for example `aipm-cockpit`.
3. Open the database and copy its **URL**. It looks like
   `libsql://aipm-cockpit-yourname.aws-eu-west-1.turso.io`. Copy it exactly as Turso shows it,
   including the region part; do not shorten it.
4. On the same database, create a **token** with **read and write** access. Choose an expiry that
   suits you, and note the date: when it expires the app can no longer reach the database until
   you create a new one. Copy the token; Turso shows it only once.
   - If you prefer the command line, the same three steps are
     `turso db create aipm-cockpit`, `turso db show aipm-cockpit --url` and
     `turso db tokens create aipm-cockpit`.
5. In the app, open **Settings → Integrations**, turn on **Turso storage backend**, paste the URL
   into **Database URL** and the token into **Auth token**, then click **Test connection**. It
   should answer "Connected." Click **Apply**.
6. Open **Settings → Storage** and choose **Turso database**.

Use a token for this one database, not an account-wide or organisation token. If the test says
the token was rejected, it has expired, been revoked, or belongs to a different database.

### Jira API token

Optional. Lets the app sync tasks with a Jira project. You need a Jira Cloud site (an address
ending in `atlassian.net`) and an account that can browse and edit issues in the project.

1. Go to <https://id.atlassian.com/manage-profile/security/api-tokens>, signed in with the
   Atlassian account you use for Jira.
2. Click **Create API token** (the plain one, not "Create API token with scopes"). Give it a name,
   such as "AI PM Cockpit", and an expiry date. Note the date.
3. Copy the token; Atlassian shows it only once.
4. In the app, open **Settings → Integrations**, and in the **Jira** block:
   - tick **Enable Jira sync**;
   - **Site URL**: your Jira address, for example `https://your-company.atlassian.net`;
   - **Atlassian account email**: the email you sign in to Jira with;
   - **API token**: the token you just copied;
   - **Token expires on**: the date you chose. The app then reminds you before the token runs out.
5. Click **Test connection**, then pick the Jira **Project** to sync with.

Your normal Jira password is never needed and never asked for. If Jira later rejects the token (it
expired or was revoked), the app shows a banner; create a new token and paste it in.

### Timelog personal access token

Optional. Lets the app read time bookings from Timelog for the Budget view.

1. Go to <https://login.timelog.com/personaltoken> and sign in with your Timelog account.
2. Generate a **personal access token** and copy it.
3. Note two parts of the address you use for Timelog in your browser. For
   `https://app2.timelog.com/yourcompany/...`, the **host** is `app2.timelog.com` and the
   **tenant** is `yourcompany`. Ask your Timelog administrator if you are not sure.
4. In the app, open **Settings → Integrations**, tick **Enable Timelog integration**, and fill in
   **Host**, **Tenant**, **Account email** and **Personal access token**.
5. Click **Test connection**. It reports how many people it can see and whether you get your own
   bookings or the whole organisation's; that depends on your Timelog permissions, not on the app.

If the token is rejected later, generate a new one on the same page and paste it in.

### Speech-to-text key

Optional, and only for **cloud** dictation. The default dictation engine is the built-in browser
one, which needs no key. To use a cloud engine instead, open **Settings → Dictation engine**, choose
**Cloud (OpenAI-compatible)**, and enter the **Transcription endpoint base URL**, **Model** and
**API key** your provider gives you. Recorded audio is sent to that endpoint.

## Everyday use

- Closing the window closes the app completely.
- Opening it again while it is already running just brings the existing window to the front.
- From version 1.0.1, to print, press **Ctrl+P** or use **File → Print…** (the
  1.0.0 installer has neither). It prints the view you are
  looking at, so open the pane you want on paper first.
- Exporting a PDF opens the document in a new window, and in the desktop app that
  window does **not** start printing on its own — press **Ctrl+P** in it. (In a web
  browser it does start by itself; this is a desktop-only difference we have not
  finished fixing.)

## If it does not start

If you see **"Another program is already using port 17300"**, some other software on your machine has taken the port this app needs. Close that program and try again. The app deliberately will not move to a different port, because its saved data is tied to this one.

For anything else, there is a log at:

`%LOCALAPPDATA%\aipm-cockpit\logs\launch.log`

Send that file with your report.
