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

Since 1.14.3, two tabs or windows that save the same project no longer overwrite each other. Each one remembers the version of the project it last loaded or saved. When it saves and the stored project has changed since then, the save is refused, nothing is written, and the tab shows "Saving paused" with three choices:

- **Reload** loads the stored version and drops your unsaved changes.
- **Overwrite** saves your version over the stored one. It is refused if the stored version changed again in the meantime.
- **Download my version** saves your version to a file and keeps saving paused.

This works on every backend: browser storage, local files, SharePoint and Turso. It is tested in the browser with browser storage; SharePoint and Turso are not yet verified against a live tenant or database.

- **Browser storage** is one store for the whole browser profile, so all its tabs keep in step: an edit in one tab appears in the others.
- **Local files:** a window keeps saving to the file it opened, even if another tab switches project. Windows on the same file keep in step; windows on different files do not.
- **Pop-out windows** follow the window that opened them and never save on their own.
- If the window closes while saving is paused, your unsaved version is kept in the browser and listed as "not saved (conflict)" with Download and Discard. It cannot yet be restored inside the app.
- Switching project is refused while there are unsaved changes that cannot be kept, so you stay on the project behind the banner.

A few cases pause when nothing actually conflicts. Nothing is lost, but you have to choose Reload or Overwrite:

- after a load that failed or was refused, until you use Reload project;
- when you open a file that a registered project already uses;
- when two windows each pick the same file;
- when two tabs start at the same moment.

Turso saves are also all or nothing: a save that fails partway writes nothing. A Turso save that cannot get its lock within 20 seconds fails with an error toast instead of waiting indefinitely.

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
