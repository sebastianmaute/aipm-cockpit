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

- Your AI (Anthropic) API key
- Your Turso database URL and auth token, if you use Turso storage
- Your Jira and Timelog tokens, if you use those integrations
- Your speech-to-text key, if you use dictation

If you work from a **project file**, open it once via the usual file picker; the app will remember it from then on.

If you use **Turso storage**, your projects appear as soon as the token is entered — that data lives on the server, not on your laptop.

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
