# Storage backends

Where a workspace lives, which browsers can hold one, what happens when two
tabs edit at once, and how to recover a workspace that will not load.

This file owns the subject. `README.md` links here rather than summarising it.

The active backend is chosen in Settings → Integrations / Storage Configuration. Switching backends migrates the current workspace into the new one.

| Backend | Description | When to use |
|---------|-------------|-------------|
| Browser (default) | `IndexedDB` (schema v6) for workspace entities; `localStorage` for settings. | The zero-setup default. Use it for a single person on one machine — data survives page refresh but lives only in that browser profile. |
| Local JSON / CSV / Markdown | File System Access API — reads and writes a local file you pick. | When you want a portable file you control (commit to git, drop in a shared drive, diff by hand). Markdown/CSV are human-readable; JSON is the complete round-trip. |
| SharePoint JSON / CSV | Workspace as a single JSON or CSV blob in a SharePoint document library via Microsoft Graph; requires M365 sign-in. | When the team already lives in Microsoft 365 and you want the workspace stored alongside other project documents. |
| Turso (libSQL) | Relational schema (one table per entity) via the Turso HTTP `/v2/pipeline` API; works with Turso Cloud and a local/self-hosted `tursodb`. | For multi-device or multi-project use — relational queries, baseline/variance trends, and the shared multi-tenant database that backs the portfolio in Turso mode. |

## Browser support

The **Local JSON / CSV / Markdown** backend is built on the [File System Access
API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API),
which is Chromium-only — it is unavailable in Firefox and Safari, so the
pick-a-file backend cannot be used there. Every other backend is unaffected:
Browser (IndexedDB), SharePoint and Turso use no part of that API, and the
export/import paths work in any browser. On Firefox or Safari, stay on the
default Browser backend or configure Turso.

## Multi-tab editing

When two full browser tabs (not read-only pop-outs) point at the same Turso database, their saves are serialized through the [Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API) — one exclusive lock per database URL and project — so one tab's write never interleaves with another's. The model remains last-write-wins per table: the slower tab still overwrites the faster one, so simultaneously editing the same project in two tabs is not a supported workflow. A tab that cannot acquire the lock within 20 seconds fails that save with an error toast instead of waiting indefinitely.

## Emergency recovery

If a configuration change ever leaves the app stuck (for example a bad Turso
URL or a portfolio mode that won't load), you can recover without losing data:

- **Safe-mode boot:** open the app with `?safe=1` appended to the URL
  (e.g. `https://…/?safe=1`). The app boots on the local browser/file backend
  at the empty state and ignores your stored configuration in memory — nothing
  is changed on disk.
- **Recovery page:** open `/recovery`. From there you can **download** your
  current configuration, **reset** to a clean configuration, or **restore** the
  previous one. Reset only moves the configuration aside (it is recoverable) and
  never touches your projects, tasks, or any Turso cloud database.
- If the app shows an error screen, use its **Recover** button (it links to the
  same recovery page).
- **Data-loss guards:** a corrupt or partial workspace file is refused on load
  (rather than silently opening empty), and a save that would wipe or mass-delete
  a populated project is blocked unless you explicitly armed a clear-all.
  Previously-silent action failures now surface as a toast plus a diagnostics-log
  entry.
