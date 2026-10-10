# Security

This is a local development prototype. Only explicit disposable-group tests are supported; it is not ready for production or unattended moderation.

- Treat input and evaluator output as untrusted data. AI output cannot choose actions or approval targets.
- Keep test sending disabled except during the controlled experiment. `approve-test` can send one real reply after exact human confirmation; the other CLI commands remain dry-run/read-only.
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
