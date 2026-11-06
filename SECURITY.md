# Security policy

## Supported versions

Only the latest release on the [Releases page](https://github.com/sebastianmaute/aipm-cockpit/releases) receives fixes.

## Reporting a vulnerability

Please report privately through GitHub: **Security → Report a vulnerability** on this repository.
Do not open a public issue. You can expect a first answer within a week.

## Verifying a download

Windows installers are being moved to code signing through SignPath Foundation; each release's notes
say whether its installer is signed. A signed installer's publisher is **SignPath Foundation**, and
`Get-AuthenticodeSignature .aipm-cockpit-<version>-setup.exe` reports `Valid` with
`CN=SignPath Foundation` in the signer. The uninstaller is not signed yet (#951).

Every release's files, signed or not, carry a build-provenance attestation, and the installer an SBOM
attestation for `aipm-cockpit-<version>-sbom.cdx.json`, both made by this repository's release
workflow. Verify a download with:

    gh attestation verify aipm-cockpit-<version>-setup.exe --repo sebastianmaute/aipm-cockpit
    gh attestation verify aipm-cockpit-<version>-setup.exe --repo sebastianmaute/aipm-cockpit --predicate-type https://cyclonedx.org/bom

Installed copies check this repository's releases for updates and install one only after you agree.
A copy installed from a signed release also refuses an update whose installer is not signed by
SignPath Foundation. The README's [Code signing policy](README.md#code-signing-policy) lists the
limits while releases move to signing.
