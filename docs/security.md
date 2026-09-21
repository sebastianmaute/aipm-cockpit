# Security

What the app stores, where it stores it, what leaves the browser, and the
build-time environment variables that change any of that.

This file owns the subject. `README.md` links here rather than summarising it.

## Environment variables

No environment variables are **required** — all integrations work via in-app Settings. These optional build-time variables pre-configure integrations:

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_MSAL_CLIENT_ID` | Microsoft Entra app client ID (overrides Settings → Integrations input) |
| `NEXT_PUBLIC_MSAL_TENANT_ID` | Microsoft Entra tenant ID (overrides Settings → Integrations input) |
| `NEXT_PUBLIC_TURSO_DATABASE_URL` | Turso database URL (overrides Settings → Integrations input) |
| `NEXT_PUBLIC_TURSO_AUTH_TOKEN` | Turso auth token (overrides Settings → Integrations input); **recommend a scoped token** |
| `NEXT_PUBLIC_AI_POLICY_ORG` | Organisation named as the AI-usage policy owner on the AI Assistant consent screen (overrides Settings → AI Assistant input) |
| `NEXT_PUBLIC_AI_POLICY_URL` | Link to that AI-usage policy (overrides Settings → AI Assistant input). Must be `https://`; any other value is ignored |

> ⚠️ **Security:** When entered in Settings, the Anthropic API key and Turso auth token are **encrypted at rest** (AES-256-GCM; see [Security Model](#security-model)). A Turso token supplied via `NEXT_PUBLIC_TURSO_AUTH_TOKEN` is different — `NEXT_PUBLIC_*` env vars are **inlined into the build at compile time and are not secret**, so prefer a database/operation-scoped token there and rotate it if it may have been exposed. The Jira and Timelog API tokens and the dictation (STT) API key are likewise **encrypted at rest**; their identifying fields (Jira site URL & email; Timelog host, tenant & email) are stored in `localStorage` unencrypted (identifying, not secret).

## Security model

This is a **local-first, bring-your-own-key** application. There is no application server holding accounts or secrets: you supply your own credentials in Settings, and they stay in your browser. That makes the browser profile the security boundary — the trade-off is deliberate.

### What is stored where

| Data | Location |
|------|----------|
| **Anthropic API key, Turso auth token, Jira & Timelog API tokens, dictation (STT) API key** | **Encrypted at rest** — AES-256-GCM ciphertext in `localStorage["aipm-cockpit:secrets"]`; these fields are blanked from the settings blob before it is written. The wrapping key is a non-extractable WebCrypto **device key** in IndexedDB by default. The Anthropic key and Turso token additionally support a **per-secret passphrase** (PBKDF2, 600k iterations) that keeps the value sealed until you unlock it; the Jira and Timelog tokens are device-wrapped only |
| Jira site URL + email, Turso database URL, all other settings | `localStorage["aipm-cockpit:settings"]`, **unencrypted** (the Jira site URL and email are identifying, not secret) |
| Device key (wraps the secrets above) | IndexedDB DB `aipm-cockpit-secrets`, non-extractable |
| Workspace data (tasks, RAID, changes, milestones, stakeholders, …) | `IndexedDB` on the default Browser backend, or whichever storage backend you configure |

If WebCrypto / IndexedDB is unavailable the app degrades to holding the secrets in memory rather than crashing. Credentials are deliberately excluded from workspace exports (JSON/CSV/Markdown), the activity log, and console output; the secrets ciphertext is likewise excluded from exports and never written to Turso.

### What leaves the browser

- **AI chat** — chat messages, the workspace data the assistant reads, and your API key are sent directly from the browser to `api.anthropic.com`; there is no proxy in between.
- **Jira** — credentials and issue data go to the same-origin `/api/jira/*` proxy, which forwards them only to `*.atlassian.net` (SSRF allowlist) and persists nothing server-side.
- **Turso** — workspace data and the auth token go to your own Turso/libSQL database over HTTPS.
- **Microsoft 365** — Graph calls authenticate with MSAL-issued tokens; the app never handles your Microsoft password.
- **Confluence** — page imports go through the same-origin `/api/confluence/page` proxy, which reuses the Jira proxy helpers (the same `*.atlassian.net` allowlist and your Atlassian credentials).
- **Timelog** — credentials and booking queries go to the same-origin `/api/timelog` proxy, which forwards them only to your `*.timelog.com` host. See [integrations.md](integrations.md#timelog).
- **Dictation (STT)** — recorded audio and the STT API key go to the same-origin `/api/stt` proxy, which forwards them to the OpenAI-compatible endpoint you configure. There is no fixed vendor host to allowlist, so the proxy requires `https`, blocks private and loopback addresses, and refuses redirects.
- **ECB exchange rates** — the same-origin `/api/ecb` route fetches the European Central Bank's daily reference-rate file; no credential or user input is sent.

### Recommendations

- Use dedicated, minimally scoped credentials: an Anthropic API key with a spend limit, a Jira API token with an expiry date, and a Turso token scoped to a single database.
- Do not use this app with production credentials on shared or untrusted machines — anyone with access to the browser profile can read every stored credential.
- Rotate or revoke credentials when a machine changes hands or a key may have been exposed.
