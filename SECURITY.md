# Security policy

## Supported versions

Only the latest release on the [Releases page](https://github.com/sebastianmaute/aipm-cockpit/releases) receives fixes.

## Reporting a vulnerability

Please report privately through GitHub: **Security → Report a vulnerability** on this repository.
Do not open a public issue. You can expect a first answer within a week.

## Verifying a download

The Windows installer is **not code-signed**. Each release's files carry a build-provenance
attestation made by this repository's release workflow. Verify a download with:

    gh attestation verify aipm-cockpit-<version>-setup.exe --repo sebastianmaute/aipm-cockpit

Installed copies check this repository's releases for updates and install one only after you agree.
