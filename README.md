# hmm

`hmm` is a small, configurable rules checker for human- or machine-generated updates.

```text
input → parser → rules → decision → action
                          │
                  APPROVE / REJECT / REVIEW
```

Normal TypeScript code decides what happens. An evaluator answers questions; it never controls actions. The core knows nothing about Gmail or Google Groups.

Milestone 1 is implemented: a local CLI, a pure decision engine, YAML configuration, fake adapters, fixtures, and tests. No external accounts or keys are needed. Installing dependencies needs npm access; running the installed tool and tests does not need internet access.

## Quick start

Use Node.js 22 or later (development and CI use Node.js 24).

```bash
npm ci
npm test
npm run typecheck
npm run cli -- check fixtures/good-update.txt
```

The good fixture prints `APPROVE`. Try these too:

```bash
npm run cli -- check fixtures/vague-update.txt
npm run cli -- check fixtures/missing-next-steps.txt
npm run cli -- check fixtures/technical-update.txt
```

The first two print `REJECT`; the technical update prints `APPROVE`.

The CLI always performs a dry run, even when `dry_run: false` is in the configuration. It never connects approval, email, or external storage adapters.

Exit codes are **0** for `APPROVE`, **1** for `REJECT`, and **2** for `REVIEW`, invalid configuration, or input errors. A rejection exits nonzero on purpose so scripts can use the decision.

## Rules

Deterministic rules use ordinary code. These checks are supported:

| `check` | Additional field | Behavior |
| --- | --- | --- |
| `minimum_length` | `min_chars` | Counts Unicode code points after trimming surrounding whitespace. |
| `required_heading` | `heading` | Matches an entire heading line, ignoring case, Markdown heading markers, and a final colon. |
| `required_url` | None | Requires an HTTP or HTTPS URL with a hostname; does not fetch it. |
| `required_keyword` | `keyword` | Case-insensitive substring match. |
| `email_domain` | `domain` | Matches the exact author email domain; missing author metadata means uncertainty. |

`check` can be omitted for the original example using `min_chars`. Other check types are not implemented yet; an unknown type fails configuration validation.

Semantic rules contain an `instruction` for an evaluator. They describe questions such as whether the update explains concrete progress. An adapter is a small piece of code connecting a common interface to a particular implementation.

## Configuration

Start with [config/example.yaml](config/example.yaml), or select another file:

```bash
npm run cli -- check fixtures/good-update.txt --config config/example.yaml
```

Example rule:

```yaml
- id: evidence_heading
  type: deterministic
  check: required_heading
  heading: Evidence
  required: true
```

Rule IDs must be unique. Unknown fields and invalid values are rejected, including misspelled settings. Dry run defaults to `true` and the evaluator timeout defaults to 10 seconds.

The decision policy is deliberately conservative:

- A required rule fails: `REJECT`, or `REVIEW` if `fail_required_rule.action` is `review`.
- Any rule is uncertain, confidence is too low, a provider fails, or output is invalid: `REVIEW`. This takes precedence over other rule failures.
- All required rules pass: `APPROVE`. Optional failures are informational.
- No required rules exist: use `default_action`, which can be `review` or `reject`.

Semantic results need a confidence value per rule or an overall confidence value. Values must be between 0 and 1. The default minimum is 0.8. Missing, duplicate, extra, or contradictory results never establish approval. `uncertain_rule.action` only accepts `review`.

## AI evaluators

Only `provider: fake` is available. **The fake evaluator is a demo, not an AI assessment.** It ignores free-form instructions and recognizes two rule IDs:

- `real_progress`: a listed concrete-work verb and a number must appear in the text.
- `next_steps`: a `Next steps:` section must start with a listed action verb and contain at least five words.

These patterns are intentionally easy to fool. Their confidence of 1 only indicates a deterministic pattern match, not trust in the message. Other semantic rule IDs return `UNCERTAIN`.

Implement the `Evaluator` interface to replace this behavior. The core validates results and supplies an abort signal for timeouts. Providers should honor the signal. A timeout prevents approval even if a provider ignores cancellation; the underlying request might still finish.

Jev is the next milestone. Its actual API contract, authentication, and response format must be established before implementation. Gemini is also a future adapter. There are no pretend API integrations or keys to configure today.

## Using the pipeline

```ts
import {
  createHmm, loadConfig, FakeInbox, FakeEvaluator,
  FakeApprovalAdapter, MemoryStore, ConsoleNotifier,
} from "./src/index.js";

const hmm = createHmm({
  config: await loadConfig("config/example.yaml"),
  inbox: new FakeInbox([{
    id: "demo-001",
    format: "text",
    body: "Your update here",
  }]),
  evaluator: new FakeEvaluator(),
  approval: new FakeApprovalAdapter(),
  store: new MemoryStore(),
  notifier: new ConsoleNotifier(),
});

const results = await hmm.run();
```

The inbox, evaluator, approval adapter, store, and notifier are replaceable. Storage and notification are optional. The pipeline passes the inbox item's ID to the approval adapter, never an ID invented by the evaluator.

## Dry-run mode

The pipeline honors `dry_run: true`: it skips approval and adapters marked `scope: external`. Local stores and console notifications still work. The only supplied approval adapter records IDs in memory; it never sends anything.

Adapters are trusted code. Their `scope` declaration must accurately describe their effects. Dry run is an application guard, not a sandbox for arbitrary adapter code. Evaluator calls can still send input to a configured provider in future integrations.

An approval adapter is only called when dry run is explicitly disabled and the decision is `APPROVE`. `REJECT` and `REVIEW` never call it. Rejection means withholding approval, not deleting or rejecting a message through an external API.

## Google Groups example

The repository includes a **synthetic** moderation envelope in [fixtures/moderation-email.txt](fixtures/moderation-email.txt). The parser extracts its author, subject, original body, and moderation ID. Tests exercise this envelope through fake adapters. It is not a verified representation of real Google Groups email or a MIME/Gmail parser.

Gmail inbox discovery and Google Groups approval-by-reply are not implemented. Whether programmatic reply actually approves a message is unverified. See [the manual integration plan](docs/google-groups-manual-test.md) before implementing or enabling real approval.

## Progress and storage

The evaluator output may include `completed`, `inProgress`, `blockers`, `nextActions`, and `concerns` arrays. The core validates these fields when present. Moderation works without them. `MemoryStore` retains results for the lifetime of the process; it is not a database. Automatic progress extraction, Sheets storage, and summaries are later work.

## Testing

```bash
npm test
npm run typecheck
```

Tests cover policy outcomes, deterministic rules, config validation, parsing, provider failures and timeouts, malformed results, dry-run isolation, fake approval, storage, and CLI exit codes. They use no Google accounts, API keys, or external requests. GitHub Actions runs the same checks on pushes and pull requests.

## Project structure

```text
src/domain/      common data types
src/core/        parsing, rules, policy, orchestration
src/ports/       interfaces for replaceable services
src/adapters/    fake services, memory storage, console output
src/config/      YAML loading and validation
src/cli/         local file checker
config/         example policy
fixtures/       synthetic updates and moderation envelope
tests/          unit, pipeline, and CLI checks
```

## Current limitations and next milestones

1. Local core and fake-adapter workflow: implemented.
2. Jev evaluator: pending a verified provider API contract; use fixtures first.
3. Gmail inbox: future dry-run-only integration, with real MIME parsing and sender validation.
4. Google Groups approval: verify one disposable message before enabling any real approval.
5. Optional progress extraction, persistent storage, and summary primitives.

There is no durable action ledger or cross-run deduplication. Duplicate IDs are rejected within a batch, but rerunning a batch can repeat enabled actions. Adapter failures propagate; actions are not retried. An action can succeed before a later store or notification fails. Real integrations need idempotency and recovery before production use.

No dashboard, database server, agent framework, or licensing terms have been added.
