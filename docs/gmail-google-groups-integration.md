# Gmail / Google Groups integration boundaries

## Current flow

Gmail RAW bytes → bounded MIME parser → supported Groups structure → original Item
→ deterministic rules → policy → non-executable ActionPlan.

The supervised adapter adds fresh-source validation, authentication, allow-lists,
exact interactive confirmation and an atomic durable ledger before one Gmail send.
The core never receives Gmail/OAuth access, reply selection authority or tokens.
check-email stops at the data-only plan and never sends.

## Supported input

The parser supports bounded plain/HTML MIME, transfer encodings and one supported
Google multipart/mixed wrapper with an inline message/rfc822 original.
The original's author, subject, body and image attachment observations become the
Item; wrapper logos are not member images. Conflicting body alternatives,
duplicate identity headers, ambiguous forwards and incomplete reply metadata
require review. URLs and image contents are not fetched.

Sender/group/subject matching establishes supported structure, not origin.
Authentication examines outer observations; nested AR/ARC cannot confer trust.
The supported nested-header case remains INDETERMINATE and only qualifies for
the explicit supervised exception after required outer observations pass.
No cryptographic DKIM implementation or production Gmail ingress attestor exists.
See [the safety contract](milestone5a-safety-foundations.md).

## Identity, execution and failure

Plans remain executable:false and approvalByReply:UNVERIFIED. The executor requires
a separate immutable single-use confirmation capability. Reply recipient, subject,
thread and references derive from the validated notification, never model output.
The fixed body is Approve.; user-confirmed tests demonstrate it worked for the
disposable group, not that it is universally required.

For Gmail, sourceKey is SHA-256 of JSON [lowercase verified mailbox, notification
Gmail ID]. ActionId is SHA-256 of JSON ["hmm-action-v2", sourceKey, "approval-reply"].
The identity is stable through token reauthorization. File plans use a separate
file-prefixed account namespace; cross-transport deduplication is not promised.
See src/adapters/approval/action-identity.ts and email-action-plan.ts.

The local ledger survives restart and coordinates competing reservations in the
same directory. Legacy and partial source-key sentinels also block. It does not
coordinate independent machines or deduplicate separately issued notifications.
RESERVED precedes DISPATCHING; successful Gmail receipts become SENT.
Possible submission without a reliable response becomes UNCERTAIN and never
automatically retries. SENT is not publication confirmation. Reconciliation is
an evidence interface, not a scraping or resend mechanism.

## Offline use

~~~powershell
npm run cli -- check-email fixtures/work-updates-101/groups-inline-matched.eml --config config/work-updates-101.yaml
npm test
npm run typecheck
~~~

check-email accepts provider none or fake and rejects network evaluators.
The default config/example.yaml is the older fake demo; select WORK UPDATES 101
explicitly for current deterministic rules. A data-only result never performs
an external action. Exit codes are 0 APPROVE, 1 REJECT, 2 REVIEW/error.

See [fixtures](../fixtures/google-groups/README.md),
[supervised setup](supervised-moderation.md), [OAuth setup](gmail-readonly-setup.md),
[manual acceptance](google-groups-manual-test.md), and
[release evidence](releases/v0.2.0-supervised-mvp.md).

Official references:
[Gmail list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list),
[Gmail RAW](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get),
[Gmail send](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send),
[Groups moderation](https://support.google.com/groups/answer/2466386?hl=en).
