# Installing aipm-cockpit on your laptop

## Installing

1. Run the installer from the share.
2. Windows will show a blue **"Windows protected your PC"** box. This is expected: the app is not code-signed. Click **More info**, then **Run anyway**.
3. The app installs for your user only — you do **not** need admin rights.

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

## If it does not start

If you see **"Another program is already using port 17300"**, some other software on your machine has taken the port this app needs. Close that program and try again. The app deliberately will not move to a different port, because its saved data is tied to this one.

For anything else, there is a log at:

`%LOCALAPPDATA%\aipm-cockpit\logs\launch.log`

Send that file with your report.
