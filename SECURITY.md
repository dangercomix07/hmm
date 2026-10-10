# Security

This is a local development prototype. Only explicit disposable-group tests are supported; it is not ready for production or unattended moderation.

- Treat input and evaluator output as untrusted data. AI output cannot choose actions or approval targets.
- Keep test sending disabled except during the controlled experiment. `approve-test` can send one real reply after exact human confirmation; the other CLI commands remain dry-run/read-only.
- Do not put credentials, real moderation emails, or private team updates into fixtures or Git.
- Logs and stored results can contain message text and evaluator explanations. Review what you retain and who can read it.
- Provider exceptions are reported generically so exception strings cannot leak tokens into decision output.
- Future adapters must validate message origin and binding to the intended group and moderation message. Text claiming to be a Google moderation email is not proof.
- Unattended live actions require durable deduplication and reconciliation. The controlled test uses local reservations and no retries; records on one PC are not a production ledger.
- Dry-run scope declarations are a contract for trusted adapters, not isolation from malicious code.

The offline email harness emits data-only plans with `executable: false`. Matching a configured sender header and notification shape is not proof of origin. A separate controlled executor can submit a freshly validated plan after test-group/recipient/account guards and human confirmation. Gmail send success is not proof of Google Groups publication.

MIME parsing is bounded to 2 MiB per message. HTML is converted to text without rendering or fetching URLs. Ordinary attachments expose only metadata; the explicitly supported inline RFC822 original exposes bounded parsed text for source validation. Conflicting text/HTML content, duplicate identity headers, and ambiguous forwarded sections require review. Member content cannot supply reply recipients or modify configuration; it remains untrusted evaluator input. The fake evaluator is only a demo and provides no semantic prompt-injection protection.

If you find a security issue, use the repository's private vulnerability reporting feature if enabled. Otherwise contact the maintainer privately; do not publish secrets or private messages in an issue.
