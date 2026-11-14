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

What each brief covers:

- **CEO:** what the AI is for, what leaves the organisation and under which approval, the open gaps, and a pilot template.
- **CIO:** architecture and operation: where data is kept, each user's own key, the direct and relay routes, the switches and cost at scale.
- **CISO:** what leaves the network and to which hosts, prompt injection, the kill switch, the installer, and what a modified copy could bypass.
- **Chief AI Officer:** an AI Act reading: what each feature does, where a person approves, labelling, AI literacy and the limits of people protection.
- **COO:** measured cost per call, an estimated team month, and what a pilot must measure; time savings are not measured.
- **Data protection officer:** what personal data each feature sends, protection and its limits, saved chats and their erasure, and the questions only the organisation can answer.
- **Project manager:** which AI results you approve and which apply on their own, what varies between runs, what cross-project allocation sees, and what to label before a steering committee.

Every factual sentence in a brief carries an evidence id (E1, E2, …) and a label: *measured*, *tested (unit)*, *tested (live database)*, *read in code*, *estimated* or *not proven*. The appendix says what each label means and where each id comes from. The prose describes the code at commit f34d66937; the figures were measured at commit e63693393.

Jeder Tatsachensatz einer Kurzinformation trägt eine Beleg-Nummer (E1, E2, …) und eine Belegart: *gemessen*, *getestet (Unit)*, *getestet (Live-Datenbank)*, *im Code gelesen*, *geschätzt* oder *nicht belegt*. Der Anhang sagt, was jede Belegart bedeutet und woher jede Nummer stammt. Der Text beschreibt den Code im Commit f34d66937; die Zahlen wurden im Commit e63693393 gemessen.

The appendix tables are generated from the code (`npm run compliance:generate`); `docs/briefs/figures.json` holds the measured run behind the figures.
The gate is `npm run compliance:check`, the same one that covers `docs/compliance/`.

The gate keeps a list of claims the briefs must never make, in both languages. A page may still name or negate such a claim, but only inside quotation marks or inline code; the same words in plain prose fail the gate.

Das Gate führt eine Liste von Aussagen, die die Kurzinformationen nie treffen dürfen, in beiden Sprachen. Eine Seite darf eine solche Aussage dennoch nennen oder verneinen, aber nur in Anführungszeichen oder als Code; dieselben Worte im Fließtext lassen das Gate scheitern.
