# Security policy

## Supported versions

Only the latest release on the [Releases page](https://github.com/sebastianmaute/aipm-cockpit/releases) receives fixes.

## Reporting a vulnerability

Please report privately through GitHub: **Security → Report a vulnerability** on this repository.
Do not open a public issue. You can expect a first answer within a week.

## Verifying a download

Windows installers are not code-signed: no signing provider has been chosen. Windows SmartScreen therefore warns on first run, and the
attestations below are how to check a download.

A release that lists `aipm-cockpit-<version>-sbom.cdx.json` among its files carries
attestations made by this repository's release workflow: build provenance for each of its files, the
SBOM included, and an SBOM attestation for the installer. Verify a download with:

    gh attestation verify aipm-cockpit-<version>-setup.exe --repo sebastianmaute/aipm-cockpit
    gh attestation verify aipm-cockpit-<version>-setup.exe --repo sebastianmaute/aipm-cockpit --predicate-type https://cyclonedx.org/bom
    gh attestation verify aipm-cockpit-<version>-sbom.cdx.json --repo sebastianmaute/aipm-cockpit

Installed copies check this repository's releases for updates and install one only after you agree.
The README's [Code signing](README.md#code-signing) section says what stands in for a signature.
