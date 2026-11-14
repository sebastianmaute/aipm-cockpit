# AI briefs for executives

Short briefs on how the app uses AI, one per reader: CEO, CIO, CISO, Chief AI Officer, COO, data protection officer and project manager.
Each exists in English (`en/`) and German (`de/`) and follows the same six parts.

- [English briefs](en/ceo.md) and [appendix](en/appendix.md)
- [Deutsche Kurzinformationen](de/ceo.md) und [Anhang](de/appendix.md)

The appendix tables are generated from the code (`npm run compliance:generate`); `docs/briefs/figures.json` holds the measured run behind the figures.
The gate is `npm run compliance:check`, the same one that covers `docs/compliance/`.
