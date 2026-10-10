# hmm

`hmm` is a small, configurable rules checker for human- or machine-generated updates.

```text
input → parser → rules → decision → action
                          │
                  APPROVE / REJECT / REVIEW
```

Normal TypeScript code decides what happens. An evaluator answers questions; it never controls actions. The core knows nothing about Gmail or Google Groups.

hmm can run entirely with deterministic rules. The default team-update profile checks structure and completeness. Semantic evaluators are optional extensions; use them only when deterministic checks are insufficient for the workflow. The CLI and tests need no account, API key, or network after dependencies are installed. A fresh dependency install needs npm access; a fully populated npm cache can also support `npm ci --offline`.

## Quick start

Use Node.js 22 or later (development and CI use Node.js 24).

```bash
npm ci
npm test
npm run typecheck
npm run cli -- check fixtures/team-updates/useful-concise.md
```

The example prints `APPROVE`. Check your own update before sending it:

```bash
npm run cli -- check update.md --config config/team-update.yaml
npm run cli -- check fixtures/team-updates/missing-next-steps.md
npm run cli -- check fixtures/team-updates/failed-experiment.md
```

The missing-section example prints `REJECT`. The failed experiment prints `APPROVE` because it
contains the configured information. Neither outcome proves technical correctness or truth.
See the [team-update guide](docs/team-updates.md) for headings, aliases, feedback and review policy.
Use `--verbose` to include rule IDs. The older fake-evaluator examples still work with
`--config config/example.yaml`; they are demonstrations, not the product profile.

The `check` and `check-email` commands always perform a dry run, even when `dry_run: false` is in the configuration. `gmail-check` remains read-only. The separate `approve-test` command can send one reply only with test sending enabled and exact interactive confirmation (see Milestone 4B below).

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

`check` can be omitted for the original example using `min_chars`. Section profiles also support required/nonempty/unique sections, section and total length ranges, bullet counts, placeholders, links and structural validation. See the [rule reference](docs/team-updates.md#rule-reference). Unknown checks fail configuration validation; custom regex checks are not supported.

Semantic rules contain an `instruction` for an evaluator. They describe questions such as whether the update explains concrete progress. An adapter is a small piece of code connecting a common interface to a particular implementation.

## Configuration

Start with [config/team-update.yaml](config/team-update.yaml), which is the default for `check`:

```bash
npm run cli -- check update.md --config config/team-update.yaml
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

## Optional semantic evaluation

`provider: none` is the default when evaluator configuration is omitted. Semantic rules then remain unresolved and produce REVIEW. The team profile has no semantic rules. Explicit `provider: fake` preserves the old demo. **The fake evaluator is an offline demo, not an AI assessment.** It ignores free-form instructions and recognizes two rule IDs:

- `real_progress`: a listed concrete-work verb and a number must appear in the text.
- `next_steps`: a `Next steps:` section must start with a listed action verb and contain at least five words.

These patterns are intentionally easy to fool. Their confidence of 1 only indicates a deterministic pattern match, not trust in the message. Other semantic rule IDs return `UNCERTAIN`.

Implement the `Evaluator` interface to replace this behavior. The core validates results and supplies an abort signal for timeouts. Providers should honor the signal. A timeout prevents approval even if a provider ignores cancellation; the underlying request might still finish.

`provider: jev` uses TypeSafe's real API. Each semantic rule becomes a named yes/no question using its instruction; arbitrary rule IDs work without code changes. Get a key from [TypeSafe Console](https://console.typesafe.ai) and set **`TYPESAFE_API_KEY`**, the variable used by the official SDK (not `JEV_API_KEY`). Never put a key in YAML or Git.

In Bash, enter it without saving the value in shell history:

```bash
read -rsp 'TypeSafe API key: ' TYPESAFE_API_KEY; echo
export TYPESAFE_API_KEY
```

In PowerShell 7:

```powershell
$env:TYPESAFE_API_KEY = Read-Host 'TypeSafe API key' -MaskInput
```

Then select the Jev example configuration:

```bash
npm run cli -- check fixtures/good-update.txt --config config/jev.example.yaml
```

Jev returns `p`, the probability that the requirement holds. The adapter maps `p > 0.5` to `PASS` with confidence `p`, `p < 0.5` to `FAIL` with confidence `1 - p`, and an exact tie to `UNCERTAIN`. The existing policy then applies `min_confidence` (default 0.8): a tentative pass or fail below that confidence becomes `REVIEW`. This conversion uses the probability of the selected answer, not a separate Jev confidence score. It is not a guarantee that the answer is correct.

Jev does not generate explanations. Its structured result records the yes probability; the human pre-check view uses provider-independent feedback. Missing keys, network errors, timeouts, HTTP errors, and invalid or incomplete answers lead to `REVIEW`; there is no fallback to fake judgments or automatic retry. See [the API mapping and manual test notes](docs/jev-evaluator.md) for official sources and current live-test status.

## Using the pipeline

```ts
import {
  createHmm, loadConfig, FakeInbox, createEvaluator,
  FakeApprovalAdapter, MemoryStore, ConsoleNotifier,
} from "./src/index.js";

const config = await loadConfig("config/example.yaml");
const hmm = createHmm({
  config,
  inbox: new FakeInbox([{
    id: "demo-001",
    format: "text",
    body: "Your update here",
  }]),
  evaluator: createEvaluator(config),
  approval: new FakeApprovalAdapter(),
  store: new MemoryStore(),
  notifier: new ConsoleNotifier(),
});

const results = await hmm.run();
```

The inbox, evaluator, approval adapter, store, and notifier are replaceable. Storage and notification are optional. The pipeline passes the inbox item's ID to the approval adapter, never an ID invented by the evaluator.

## Dry-run mode

The pipeline honors `dry_run: true`: it skips approval and adapters marked `scope: external`. Local stores and console notifications still work. The only supplied approval adapter records IDs in memory; it never sends anything.

**Dry run does not mean offline.** With `provider: jev`, the full normalized item and semantic rule instructions are sent to TypeSafe for evaluation, which may incur API charges. Approval, external notifications, and external storage writes remain disabled. With `provider: fake`, evaluation stays offline.

Adapters are trusted code. Their `scope` declaration must accurately describe their effects. Dry run is an application guard, not a sandbox for arbitrary adapter code.

An approval adapter is only called when dry run is explicitly disabled and the decision is `APPROVE`. `REJECT` and `REVIEW` never call it. Rejection means withholding approval, not deleting or rejecting a message through an external API.

## Google Groups example

The offline email harness parses realistic synthetic RFC/MIME notifications and shows an action plan:

```bash
npm run cli -- check-email fixtures/google-groups/plain.eml
```

```text
Gmail-shaped fixture or .eml file
  ↓
RawEmail → MIME parser → Google Groups parser
  ↓
Item → rules → evaluator → existing decision policy
  ↓
Decision → ActionPlan (data only)
```

Raw email means the message bytes received from the transport. Parsed email means decoded headers and readable text. The Google Groups parser extracts the member's original update; `Item` is the same generic object used by the core. An ActionPlan describes an intended action without executing it.

The good fixture returns `APPROVE` and a **non-executable** reply plan with the recipient, subject, threading metadata, and stable action ID. `vague.eml` returns `REJECT` with no approval reply. `ambiguous.eml` returns `REVIEW`. Missing critical reply metadata requires review even if the content passed.

`check-email` is always offline and accepts only `provider: fake` or `provider: none`. It cannot send email or write external storage, even if a supplied config sets `dry_run: false`. `check <text-file>` defaults to the deterministic team profile; optional Jev evaluation still requires an explicit configuration.

Use `--config` for rules and `--email-config config/google-groups.example.yaml` for the group address, allowed notification senders, subject filter, and candidate search query. These are fixture settings, not universal Google addresses. Search matches and matching headers are not authentication.

Plain text, HTML text extraction, multipart messages, encoded headers, UTF-8, quoted-printable, and base64 are covered. Ordinary attachments contribute metadata only; their contents do not go to the evaluator. The explicitly supported Google multipart notification can contain one inline `message/rfc822` original, whose validated author/subject/body become the item. Ambiguous forwards and conflicting text/HTML alternatives require review. The original simplified [moderation-email.txt](fixtures/moderation-email.txt) remains supported for Milestone 1 compatibility.

This offline harness does not connect to Google. Its reply plan remains non-executable and marked `UNVERIFIED`. Separate live read-only and controlled-send commands are described below.

See [integration boundaries, official sources, and limitations](docs/gmail-google-groups-integration.md), [the fixture index](fixtures/google-groups/README.md), and [the future manual test plan](docs/google-groups-manual-test.md).

## Live Gmail read-only checks (Milestone 4A)

`npm run cli -- gmail-check --inspect` reads a locally authorized Gmail account and prints decisions and non-executable plans. It requires a Desktop OAuth client and only `gmail.readonly`; the fake evaluator remains mandatory. No mail is sent, approved or modified. Existing `check-email` stays entirely offline.

Follow the [Google OAuth and PowerShell setup guide](docs/gmail-readonly-setup.md). No credentials are needed for development or automated tests. A user-supplied real notification has been replayed successfully with explicit inline RFC822 support. Rerunning both live candidates locally remains necessary; see the setup guide for observed configuration values.

## Controlled approval reply (Milestone 4B)

`npm run cli -- approve-test <gmail-message-id>` re-fetches one explicitly selected notification, parses and evaluates it again, and offers a send only for APPROVE and the configured disposable test group. It displays the exact reply and requires typing `APPROVE TEST` in an interactive terminal. Reuse the existing client JSON and run with `--reauthorize` once to grant read+send permission. The sending config remains disabled by default. Local reservations prevent repeated test sends from this checkout; there are no automatic retries.

Follow the [controlled reply setup and manual verification guide](docs/gmail-approval-test.md). Gmail send success alone does not prove Google Groups published the post. The user completed the local HMM TEST 003 experiment and manually confirmed publication; see the [completion record](docs/milestone4b-completion.md). No live API send was performed in the cloud.

## Progress and storage

The evaluator output may include `completed`, `inProgress`, `blockers`, `nextActions`, and `concerns` arrays. The core validates these fields when present. Moderation works without them. `MemoryStore` retains results for the lifetime of the process; it is not a database. Automatic progress extraction, Sheets storage, and summaries are later work.

## Testing

```bash
npm test
npm run typecheck
```

Tests cover policy outcomes, deterministic rules, config validation, parsing, provider failures and timeouts, malformed results, dry-run isolation, fake approval, storage, and CLI exit codes. The email tests cover MIME fixtures, fake Gmail discovery, conservative source extraction, reply plans, stable IDs, and untrusted content. Jev HTTP calls are mocked, including duplicate answers, invalid probabilities, HTTP errors, and cancellation. Tests use no Google accounts, API keys, or external requests. GitHub Actions runs the same checks on pushes and pull requests. Live Jev fixture checks are manual only.

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
2. Jev evaluator: implemented against the official SDK contract and tested with mocked HTTP; live fixture validation is pending API access and a key.
3. Offline Gmail/Google Groups harness: implemented with bounded MIME parsing and synthetic regression fixtures.
4. Live Gmail read-only integration: verified locally with real test-group notifications.
5. Controlled Gmail approval reply: verified locally for one explicitly selected disposable post, with user-confirmed publication in Google Groups.
6. Deterministic checks cannot establish truth, technical correctness, engineering quality, genuine progress, scientific validity or intent. Use configured human/semantic review when needed.
7. Milestone 5A adds fail-closed authentication interfaces, a durable local action ledger and explicit reconciliation states. A proven production Gmail authentication provider and operational reconciliation remain blockers before unattended operation. Progress reporting remains later work.

Versioned, mailbox-based ActionIds and an atomic durable local ledger protect the controlled test across restarts, concurrent attempts and token reauthorization. They do not provide exactly-once execution across machines or separate notifications. Legacy reservations remain blocking. The email check commands emit non-executable plans; only the explicitly confirmed `approve-test` command invokes the send executor. There is no scheduler or automatic approval loop.

No dashboard, database server, agent framework, or licensing terms have been added.

## Milestone 5A safety foundations

See the [architecture, authentication contract, state machine, sources and compatibility notes](docs/milestone5a-safety-foundations.md)
and [threat model](docs/threat-model.md). Raw Gmail headers are not proven authentication evidence:
`approve-test` now fails closed by default. Reproducing the 4B disposable-group experiment requires
the explicitly named, visibly warned test-only authentication exception; it never grants TRUSTED.
There is no scheduler or autonomous sender. `npm test` is offline with a loopback-only network guard.

## Milestone 5B product hardening

The [team-update profile](config/team-update.yaml) requires nonempty Progress and Next steps.
Evidence and Blockers are optional; supplied sections must be nonempty. No numeric result,
positive outcome, prescribed verb, or paid evaluator is required. A failed experiment can pass.

The [20 synthetic examples](fixtures/team-updates/README.md) include useful, vague, malformed and
injection-containing updates. A vague but complete update can pass this structural profile.
Require semantic review explicitly when your workflow needs a judgment about meaning.
All Milestone 5A authentication, ledger and supervised-send safeguards remain in place.

## WORK UPDATES 101 profile

For the narrower six-rule policy, use:

```powershell
npm run cli -- check .\fixtures\ameya-test.txt --config config/work-updates-101.yaml
```

This profile allows an unheaded opening paragraph and requires a nonempty next-step section.
It checks usable text, placeholder-only required content, code blocks of at most ten lines,
quoted previous-thread history, and MIME inline-image attachment coverage. It does not judge
writing quality or meaningful progress. The default team profile remains unchanged.
See the [WORK UPDATES 101 guide](docs/work-updates-101.md) for matching rules and REVIEW cases.
