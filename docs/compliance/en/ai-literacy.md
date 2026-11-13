# AI literacy

## About this document

This is a short guide for everyone who uses the AI features of AI PM Cockpit: what the AI gets to see, what
it may do, how to check its work, where it tends to go wrong, and how to switch it off. Your organisation
can hand it out as it is or add its own rules. The text was last reviewed as the README's
[review line](README.md#text-last-reviewed) states.

This guide is input for your organisation's own training. It is not legal advice, and your organisation's
rules on using AI come first. [question for you]

The AI in the app is Claude, a language model made by Anthropic. [verified: `src/app/ai-disclosure.ts`;
the "Ask Claude" labels in `src/app/i18n.ts`] The labels in square brackets say where each statement comes
from; the [README](README.md#how-to-read-the-labels) explains them.

## What the AI sees and does not see

The AI sees only what a feature sends it, and only when you use that feature. Before you could switch AI
on, the app showed you a list of every feature and what it sends; you can read the same list in the
[record of processing input](record-of-processing-input.md#ai-processing). [verified:
`src/app/ai-disclosure.ts`, `aiConsentDataIntro` in `src/app/i18n.ts`]

- **The chat** sees your messages, the files you attach, and the project data it looks up to answer:
  tasks, milestones, risks, changes, stakeholders, people, budget figures, documents and more. It gets the
  whole conversation again with every new message. [verified: the chat row of the table in
  `src/app/ai-disclosure.ts`]
- **The other features** see much less. "Ask Claude" on a row sees that one row and a short project
  summary; the digest summary sees counts and milestone names. [verified: the inline edit and digest rows
  of the same table]
- **It does not see** other projects, except that the allocation proposal counts hours a person has in
  other projects on the same Turso database, and only from projects that do not protect their people.
  [verified: the allocation row of the same table] It does not see your screen, other programs or your
  e-mail, only e-mails you attach yourself. [vendor statement]
- **In the background**, three features send project data on a schedule while the app is open: scheduled
  analyses, automatic recommendations for insights, and the scheduled digest summary. They run only if you
  allowed AI to run in the background in Settings → AI. [verified: `aiBackgroundConsentHelp` in
  `src/app/i18n.ts`, `src/app/ai-consent.ts`]
- **Dictation** sends your voice to the speech service you chose in the settings, not to Claude.
  [verified: the dictation row of the same table]

Write into the app as if a colleague outside the project could read it: anything you type into a task,
note or attachment can reach the AI when someone uses a feature that sends it. [vendor statement]

## The AI drafts, people decide

The AI proposes; you decide. Most features show you what they want to change and change nothing until you
choose Apply, Accept or confirm. [verified: the list in the
[works council annex](works-council-annex.md#what-the-ai-may-do-without-a-person-approving-it)]

Know the exceptions:

- **One change in the chat.** If you ask the chat for a single change, such as moving one due date, it can
  make it straight away, without a review card. It always asks first when it wants to delete something,
  invite meeting attendees, edit the project's own details, change more than one thing, or put work on a
  day someone is absent, and whenever a file is attached to the conversation. [verified: `shouldStage` in
  `src/app/chat-proposal.ts`; open gap §794]
- **Text read from outside.** When the chat has read text from outside the app, for example content synced
  from Jira, it does not ask first for that reason alone. [verified: open gap §797]
- **Background runs.** The background features above send data on every run without asking each time.
  Their results only advise: a recommendation changes nothing until a person confirms it. [verified:
  `src/app/use-insight-recommendations.ts`, `src/app/scheduled-job-run.ts`; open gap §795]

What the chat changes is recorded in the activity log as the AI's change, and most changes can be undone
with Undo. Tasks created by a work breakdown you applied cannot be undone; delete them by hand.
[verified: `src/app/activity-log.ts`; open gap §796]

You remain responsible for what you apply and for what you send on, such as a report or an e-mail the AI
drafted. [vendor statement; your organisation's rules: question for you]

## Reading review cards and diffs

**The chat's review card** ("Proposed changes") lists each change the chat wants to make. [verified:
`chatProposalTitle` in `src/app/i18n.ts`]

- Read every row, not just the count. Use "Show all" when the list is shortened.
- Untick a row to leave it out. A row that depends on a row you left out is marked "Needs a change you
  rejected" and is left out too.
- A warning on a row means a date lands on someone's absence. Check it before you apply.
- "Apply" makes the ticked changes; "Discard" drops them all.

[verified: `chatProposalShowMore`, `chatProposalRowToggle`, `chatProposalCascaded`, `chatProposalApply`,
`chatProposalDiscard` in `src/app/i18n.ts`; `src/app/absence-clash-notes.tsx`]

**"Ask Claude" on a row** shows "Claude will make these changes:" with each field's new value, and values
it refused, before you choose Apply. [verified: `inlineAiEditPreview`, `inlineAiEditRejected` and
`inlineAiEditApply` in `src/app/i18n.ts`]

**Plan with AI, RACI suggestions, the work breakdown and the duplicate check** list each proposed change on
its own. Where a value changes, you see the current value and the proposed one. Each item can be unticked.
[verified: `src/app/alloc-plan-modal.tsx`, `src/app/raci-suggest-modal.tsx`, `src/app/wbs-plan-modal.tsx`,
`src/app/task-dedup-modal.tsx`]

When you read a proposal, ask: is every name, date and number one I recognise from the project? Does it
change something I did not ask for? Would I make this change if a colleague proposed it? [vendor statement]

## Typical failure modes

- **Made-up facts.** The AI can state names, dates, figures or reasons that are not in the project, and
  sound sure about them. Check anything that matters against the project itself. [vendor statement]
- **Missing context.** The AI knows only what was sent. The allocation proposal sees at most 150 open tasks
  and 40 milestones; a spreadsheet too large for one request is not sent at all; "Ask Claude" on a row sees
  that row and little else. An answer can be wrong because something was left out. [verified:
  `ALLOC_CONTEXT_MAX_TASKS` and `ALLOC_CONTEXT_MAX_MILESTONES` in `src/app/alloc-plan/alloc-project-digest.ts`;
  the forecast import and inline edit rows of the table in `src/app/ai-disclosure.ts`]
- **Different answers each time.** Asking the same thing twice can give two different plans. The app does
  not make the AI repeatable. Treat a plan as one option, not as the answer. [verified: no `temperature`
  setting in `src/app`; the rest: vendor statement]
- **Instructions hidden in text.** A file, an e-mail or synced text can contain instructions aimed at the
  AI. That is why the chat asks before every change while a file is attached; it does not do so for text
  it reads from outside through its tools. [verified: `stagesWhenUntrusted` in
  `src/app/chat-send-record.ts`; open gap §797]
- **Long waits and failures.** Most AI requests have no time limit in the app, and a request refused because
  the service is busy is not retried. Stop and try again later. [verified: open gap §798]
- **Unknown names.** People protection hides names the project knows, not names you type that it does not
  know. [verified: `aiPeopleProtectionHelp` in `src/app/i18n.ts`]

## What people protection changes

People protection is a setting per project, and it is on unless someone turned it off for that project.
It is stored with the project, so it is the same for everyone who works in it. Your organisation may have switched it on for every project; then it cannot be turned off. [verified:
`src/app/ai-people-protection.ts`, `aiPeopleProtectionLocked` in `src/app/i18n.ts`]

While it is on:

- the names, e-mail addresses and phone numbers of people the project knows are replaced by placeholders
  before anything is sent;
- the AI cannot assign, move or rate anyone, and cannot set or change a person on any record;
- Plan with AI, RACI suggestions, dictation and voice commands are unavailable;
- the chat does not accept images or PDF documents, because text in them cannot be checked for names.

[verified: `aiPeopleProtectionHelp`, `chatPeopleProtectedAttachment` in `src/app/i18n.ts`;
`src/app/ai-person-fields.ts`]

Names it does not know, typed into free text or contained in attachments, can still be sent. So do not
paste personal details into the chat that the task does not need. [verified: `aiPeopleProtectionHelp` in
`src/app/i18n.ts`; the advice: vendor statement]

## Switching AI off

- **For yourself:** in Settings → AI, switch off "Enable AI assistant", or choose "Revoke consent". AI
  features stop until you switch AI on and accept again. [verified: `aiEnable` and `aiConsentRevoke` in
  `src/app/i18n.ts`, `src/app/settings-sections/ai-section.tsx`, `src/app/ai-consent.ts`]
- **Background runs only:** switch off "Allow AI to run in the background" in the same place. [verified:
  `aiBackgroundConsentToggle` in `src/app/i18n.ts`]
- **People only, for one project:** leave people protection on, or turn it back on in Settings. [verified:
  `src/app/settings-sections/ai-people-protection-control.tsx`]
- **For everyone:** your operator can switch all AI off for the whole installation. [verified:
  `AIPM_DISABLED_INTEGRATIONS` in `src/app/deployment-variables.ts`]

Switching off stops new requests. What was already sent stays where it went. [verified: the TOM sheet row
"Switches for integrations and AI"] The settings reach different people:

- Switching AI on or off, your consent and the background setting apply to the device and browser where
  you set them; on another computer or browser, set them there too. [verified: `src/app/ai-consent.ts`
  (consent recorded on this device)]
- People protection is stored with the project, so turning it on or off changes it for everyone who works
  in that project. [verified: `settingsOverrides` in `src/app/workspace.ts`,
  `src/app/ai-people-protection.ts`]
- The operator's switch applies to the whole installation. [verified: `src/app/integration-switches.ts`]
