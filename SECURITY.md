# Security

This is a local development prototype. It is not ready to moderate a real group.

- Treat input and evaluator output as untrusted data. AI output cannot choose actions or approval targets.
- Keep real approval disabled. The CLI performs no external actions.
- Do not put credentials, real moderation emails, or private team updates into fixtures or Git.
- Logs and stored results can contain message text and evaluator explanations. Review what you retain and who can read it.
- Provider exceptions are reported generically so exception strings cannot leak tokens into decision output.
- Future adapters must validate message origin and binding to the intended group and moderation message. Text claiming to be a Google moderation email is not proof.
- Future live actions need persistent deduplication and recovery. Current fake adapters do not provide those guarantees.
- Dry-run scope declarations are a contract for trusted adapters, not isolation from malicious code.

If you find a security issue, use the repository's private vulnerability reporting feature if enabled. Otherwise contact the maintainer privately; do not publish secrets or private messages in an issue.
