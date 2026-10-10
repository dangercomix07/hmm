# Contributing

Use Node.js 22 or later and npm. From the repository root:

```bash
npm ci
npm test
npm run typecheck
npm run cli -- check fixtures/good-update.txt
```

Keep the core small. A rule produces a result; the pure decision function chooses a status; adapters perform actions. Provider-specific objects belong inside adapters, not in core types.

Add tests for new rules and failure cases. A provider failure, ambiguous parse, or invalid response must not cause approval. External integrations must not be required by the regular test suite. Use synthetic people, domains, and messages in fixtures.

Keep dependencies minimal. The only runtime dependency is `yaml`, used to parse configuration rather than maintaining a custom YAML parser. TypeScript and Node type declarations are development dependencies. Commit the lockfile when deliberately updating dependencies.

Default to dry runs. Never test approval against arbitrary moderation queues. Follow the disposable-message test plan when real Google adapters exist.

Licensing is undecided. Do not add a LICENSE, license metadata, or license headers.
