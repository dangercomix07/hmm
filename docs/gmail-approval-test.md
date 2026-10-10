# Single-message actuator diagnostic

Use [supervised moderation](supervised-moderation.md) for the current workflow.
approve-test is retained to reproduce the older fake-evaluator actuator test;
it is not the WORK UPDATES 101 product workflow.

~~~powershell
npm run cli -- approve-test SELECTED_GMAIL_MESSAGE_ID --reauthorize
~~~

Supply one actual Gmail notification ID, not an RFC Message-ID. Omit reauthorize
once consent is current. This command uses config/example.yaml (provider fake),
the shared desktop client/token and local group/sending config. It requires an
interactive terminal, enabled test-only sending, exact group/reply allow-lists,
matching mailbox identity and acceptable authentication or the explicit exception.

It freshly fetches/parses/evaluates the selected notification, displays the
exact Approve. reply, and requires APPROVE TEST. The shared durable executor
blocks repeat sends. Unlike moderate-gmail, this older diagnostic can report a
reservation block after confirmation rather than skip beforehand.

ActionIds derive from verified mailbox and source notification, not refresh
tokens or model output. Keep .hmm/actions across reauthorization and updates.
Timeouts after possible submission stay UNCERTAIN and cannot retry automatically.
Gmail success does not confirm Groups publication; check manually.

See [configuration](../config/README.md), [OAuth setup](gmail-readonly-setup.md),
[security contract](milestone5a-safety-foundations.md) and the
[historical 4B record](milestone4b-completion.md).
