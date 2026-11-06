# Security policy

## Supported versions

Only the latest release on the [Releases page](https://github.com/sebastianmaute/aipm-cockpit/releases) receives fixes.

## Reporting a vulnerability

Please report privately through GitHub: **Security → Report a vulnerability** on this repository.
Do not open a public issue. You can expect a first answer within a week.

## Verifying a download

Windows installers are being moved to code signing through SignPath Foundation; each release's notes
say whether its installer is signed. A signed installer's publisher is **SignPath Foundation**, and
`Get-AuthenticodeSignature .\aipm-cockpit-<version>-setup.exe` reports `Valid` with
`CN=SignPath Foundation` in the signer. The uninstaller is not signed yet (#951).

A release that lists `aipm-cockpit-<version>-sbom.cdx.json` among its files, signed or not, carries
attestations made by this repository's release workflow: build provenance for each of its files, the
SBOM included, and an SBOM attestation for the installer. Verify a download with:

    gh attestation verify aipm-cockpit-<version>-setup.exe --repo sebastianmaute/aipm-cockpit
    gh attestation verify aipm-cockpit-<version>-setup.exe --repo sebastianmaute/aipm-cockpit --predicate-type https://cyclonedx.org/bom
    gh attestation verify aipm-cockpit-<version>-sbom.cdx.json --repo sebastianmaute/aipm-cockpit

Installed copies check this repository's releases for updates and install one only after you agree.
A copy installed from a signed release also refuses an update whose installer is not signed by
SignPath Foundation. The README's [Code signing policy](README.md#code-signing-policy) lists the
limits while releases move to signing.
