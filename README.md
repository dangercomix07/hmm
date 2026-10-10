<p>
  <img src="assets/hmm!.png" alt="hmm!" width="140" />
</p>

# hmm!

**Deterministic moderation for engineering updates.**

`hmm!` checks updates against explicit rules and helps a human moderator approve
supported Google Groups posts through Gmail.

**v0.2.0 — Supervised MVP**

The default workflow uses deterministic **WORK UPDATES 101** checks. No AI
subscription or API key is required. Passing means the configured checks passed;
it does not establish truth, meaningful progress, or engineering quality.

## Quick start

Use Node.js 22 or later (development and CI use Node.js 24).

~~~powershell
git switch main
git pull --ff-only origin main
npm ci
npm run config:check
npm run cli -- check fixtures/work-updates-101/valid-concise.txt --config config/work-updates-101.yaml
~~~

Both .txt and .md work. Example:

~~~text
Reproduced the reset.
Future work:
Inspect the trace.
~~~

For Gmail, first follow [local setup](docs/supervised-moderation.md), then run:

~~~powershell
npm run cli -- moderate-gmail
~~~

The command displays recent notification candidates and evaluates the original
update. APPROVE requires a fresh read, unchanged source, allow-lists,
authentication checks, durable reservation and exact **APPROVE TEST** confirmation.
REJECT and REVIEW send nothing. No force approval, scheduler or retry loop exists.

The user confirmed LIVE A was published in the disposable group; B/D produced
no send and C required review. A subsequent run skipped recorded approvals.
See the [release record](docs/releases/v0.2.0-supervised-mvp.md).

## Commands

| Command (after npm run cli --) | Purpose |
| --- | --- |
| config-check | Offline validation of tracked and locally present YAML |
| moderate-gmail | Current supervised deterministic Gmail workflow |
| check FILE --config config/work-updates-101.yaml | Offline WORK UPDATES 101 pre-check |
| check FILE | Alternate team profile requiring Progress and Next steps |
| check-email FILE.eml --config config/work-updates-101.yaml | Offline supported Groups notification check |
| gmail-check --inspect | Read-only diagnostic using the fake demo evaluator; headers can be private |
| approve-test GMAIL_ID | Retained single-message fake-evaluator actuator diagnostic |
| --help | Options and usage |

Text checks return 0 APPROVE, 1 REJECT, 2 REVIEW/error. Supervised moderation
returns 0 when the finite session completes, including cancellations/skips,
and 2 on error. Exit 0 does not mean publication. File checks never send.
Selecting the optional Jev profile for text evaluation uses the network even
with dry_run enabled.

## Configuration and safety

Read [the configuration reference](config/README.md) for profiles and local YAML.
Live examples use a 24-hour search; a matching notification is not proof its
post remains pending. **Git pull does not update ignored local configs.**

Sending defaults off. Raw Gmail does not establish TRUSTED origin. The supervised
disposable-group exception must be enabled explicitly and warns that origin
remains INDETERMINATE. It is not an unattended permission.

Keep OAuth JSON and tokens in ignored .secrets/ and .tokens/ directories.
**Keep .hmm/actions intact:** existing, partial and uncertain records block
another send. Independent computers do not share the local ledger.
SENT means Gmail accepted a reply, not that Groups published it. Check manually.

## Reference

AI evaluates. Policy decides. Adapters perform I/O. The core has no Gmail,
OAuth or send access. Source identity and recipients never come from model output.

- [Documentation index](docs/README.md)
- [WORK UPDATES 101](docs/work-updates-101.md)
- [Alternate team profile and rule reference](docs/team-updates.md)
- [Authentication and ledger contract](docs/milestone5a-safety-foundations.md)
- [Security](SECURITY.md) and [threat model](docs/threat-model.md)
- [Optional Jev adapter](docs/jev-evaluator.md): mocked HTTP validated; live semantic integration remains future work

Fake adapters and evaluators remain for tests and diagnostics, not semantic
judgment. There is no hosted service, dashboard, autonomous moderation,
rejection email or progress-summary system.

## Development

~~~powershell
npm test
npm run typecheck
npm run config:check
git diff --check
~~~

Tests need no credentials or external services after dependencies are installed.
Their network guard permits loopback for mocked OAuth callbacks.
See [contributing](CONTRIBUTING.md). Licensing remains undecided.
