# Security

This is a local development prototype. Only explicit disposable-group tests are supported; it is not ready for production or unattended moderation.

- Treat input and evaluator output as untrusted data. AI output cannot choose actions or approval targets.
- Keep test sending disabled except during the controlled experiment. `approve-test` can send one real reply after exact human confirmation; moderate-gmail also sends only after exact per-message confirmation. Other commands cannot send.
- Do not put credentials, real moderation emails, or private team updates into fixtures or Git.
- Logs and stored results can contain message text and evaluator explanations. Review what you retain and who can read it.
- Provider exceptions are reported generically so exception strings cannot leak tokens into decision output.
- Supported source shape and authenticated origin are separate. Raw Gmail headers alone never establish TRUSTED in this milestone; a production ingress evidence provider remains unimplemented.
- The controlled test uses an atomic durable local action ledger and no retries. UNCERTAIN and crash-left reservations stay blocked. Independent machines do not share deduplication; unattended operation is unsupported.
- Dry-run scope declarations are a contract for trusted adapters, not isolation from malicious code.

The offline email harness emits data-only plans with `executable: false`. Matching a configured sender header and notification shape is not proof of origin. The controlled executor requires a frozen, runtime-validated confirmation capability and a durable reservation, in addition to test-group/recipient/account guards. Missing or unproven authentication blocks by default; only an explicit warned test-only exception can reproduce the 4B experiment. Gmail send success is not proof of Google Groups publication.

MIME parsing is bounded to 2 MiB per message. HTML is converted to text without rendering or fetching URLs. Ordinary attachments expose only metadata; the explicitly supported inline RFC822 original exposes bounded parsed text for source validation. Conflicting text/HTML content, duplicate identity headers, and ambiguous forwarded sections require review. Member content cannot supply reply recipients or modify configuration; it remains untrusted evaluator input. The fake evaluator is only a demo and provides no semantic prompt-injection protection.

If you find a security issue, use the repository's private vulnerability reporting feature if enabled. Otherwise contact the maintainer privately; do not publish secrets or private messages in an issue.

## External approval invariants

Future external approval eligibility must require all of:

1. Supported source format parsed without ambiguity.
2. Configured group binding established.
3. Notification authentication TRUSTED through a configured trusted ingress evidence provider.
4. Deterministic policy returns APPROVE.
5. Reply metadata derives from validated source, never evaluator output.
6. ActionId derives from verified mailbox and source notification identity.
7. Atomic durable ledger reservation and dispatch transition succeed.
8. Executor receives the immutable validated plan and required authorization capability.

An AI model cannot waive any invariant. INDETERMINATE never becomes TRUSTED by default.
The explicitly named `test_only_allow_unverified_authentication` option is a controlled-experiment
exception to invariant 3, never an unattended permission. It defaults false and displays a warning;
no future unattended path may accept it. All current send paths still require human confirmation.

Ledger reserve/dispatch failure means no send. An ambiguous send remains UNCERTAIN (or blocked
DISPATCHING if its record cannot be updated), never automatically retried. Gmail SENT is not Groups
CONFIRMED. Reconciliation consumes trusted external evidence; it never sends. Retain legacy and
new ledger records. Deleting state can remove duplicate protection.

See [Milestone 5A's authentication/storage contract and sources](docs/milestone5a-safety-foundations.md)
and the [practical threat model](docs/threat-model.md), including the unproven Gmail header provenance,
local filesystem limitations, replay and stolen-token risks.

## Deterministic pre-check limits

The team-update profile checks structure and completeness only. APPROVE does not establish
truth, technical correctness, meaningful progress or origin authentication. Missing semantic
requirements remain REVIEW when evaluation is disabled. Update content cannot change rules,
feedback templates or source-derived execution identity. Human feedback never generates work
or measurements on the engineer's behalf. The offline pre-check has no send adapter; it does
not waive any authentication, ledger, confirmation or uncertain-action invariant above.

## Supervised deterministic Gmail command

`moderate-gmail` uses WORK UPDATES 101 with provider none and no semantic rules.
Each approval re-fetches and compares the full raw notification and Gmail
identity against the inspected candidate, repeats validation and evaluation,
and compares the regenerated immutable reply plan before exact confirmation.
It reuses the existing single-use capability, authentication exception, allow-list
and durable executor. All ledger states block re-sending. Cancellation reserves
nothing; reservation and DISPATCHING persist before a send request. No
unattended mode or force-approval option exists. A rule APPROVE alone is never
execution permission. Raw Gmail auth provenance remains unverified.

Authentication evidence is scoped to the outer Groups notification. Nested
AR/ARC headers never establish wrapper trust. Their presence keeps the supported
inline-RFC822 case INDETERMINATE, even with an ingress provider. Only after all
required outer authentication observations pass can this case be eligible for
the explicitly configured supervised test-only exception. Missing required,
malformed, contradictory or failed outer evidence cannot use this exception
for the nested-auth case. Normal execution remains blocked; there is no
unattended compatibility path.

The supervised ledger preflight checks both the current ActionId journal and
the source-key sentinel used by legacy/partial reservations. Any such sentinel
suppresses confirmation without interpreting or rewriting it. This read-only
check is advisory: the executor still atomically reserves before submission.
