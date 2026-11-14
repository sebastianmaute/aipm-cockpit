# AI briefs for executives

Short briefs on how the app uses AI, one per reader: CEO, CIO, CISO, Chief AI Officer, COO, data protection officer and project manager.
Each exists in English (`en/`) and German (`de/`) and follows the same six parts.

| Reader | English | Deutsch |
|---|---|---|
| CEO | [ceo](en/ceo.md) | [ceo](de/ceo.md) |
| CIO | [cio](en/cio.md) | [cio](de/cio.md) |
| CISO | [ciso](en/ciso.md) | [ciso](de/ciso.md) |
| Chief AI Officer | [caio](en/caio.md) | [caio](de/caio.md) |
| COO | [coo](en/coo.md) | [coo](de/coo.md) |
| Data protection officer | [dpo](en/dpo.md) | [dpo](de/dpo.md) |
| Project manager | [pm](en/pm.md) | [pm](de/pm.md) |
| Appendix (generated facts) | [appendix](en/appendix.md) | [Anhang](de/appendix.md) |

The appendix tables are generated from the code (`npm run compliance:generate`); `docs/briefs/figures.json` holds the measured run behind the figures.
The gate is `npm run compliance:check`, the same one that covers `docs/compliance/`.

The gate keeps a list of claims the briefs must never make, in both languages. A page may still name or negate such a claim, but only inside quotation marks or inline code; the same words in plain prose fail the gate.

Das Gate führt eine Liste von Aussagen, die die Kurzinformationen nie treffen dürfen, in beiden Sprachen. Eine Seite darf eine solche Aussage dennoch nennen oder verneinen, aber nur in Anführungszeichen oder als Code; dieselben Worte im Fließtext lassen das Gate scheitern.
