# Contributing

Use Node.js 22 or later and npm. From the repository root:

```bash
npm ci
npm test
npm run typecheck
npm run cli -- check fixtures/good-update.txt
npm run cli -- check-email fixtures/google-groups/plain.eml
```

Keep the core small. A rule produces a result; the pure decision function chooses a status; adapters perform actions. Provider-specific objects belong inside adapters, not in core types.

Add tests for new rules and failure cases. A provider failure, ambiguous parse, or invalid response must not cause approval. External integrations must not be required by the regular test suite. Use synthetic people, domains, and messages in fixtures.

Keep dependencies minimal. `yaml` parses configuration. `postal-mime` handles RFC/MIME parsing and `html-to-text` extracts readable text; both stay in the email adapter layer. TypeScript and type declarations are development dependencies. Commit the lockfile when deliberately updating dependencies.

Email tests must stay offline. Use `.eml` and fake Gmail RAW fixtures, preserve header-derived identity, and emit non-executable plans. Do not add OAuth, sending, or a live Jev call to `check-email`. See docs/gmail-google-groups-integration.md for the source format and boundary contracts.

Default to dry runs. Never test approval against arbitrary moderation queues. Follow the disposable-message test plan when real Google adapters exist.

Licensing is undecided. Do not add a LICENSE, license metadata, or license headers.
