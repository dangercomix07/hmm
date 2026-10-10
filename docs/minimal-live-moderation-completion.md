# Minimal supervised live moderation MVP completion record

Branch: `minimal-live-moderation`.
Base: `work-updates-101-deterministic` at `f13357c`.
Implementation commit: the commit adding this record (resolve with
`git log -1 --format=%H -- docs/minimal-live-moderation-completion.md`).
Not merged to main.

Implemented `npm run cli -- moderate-gmail`: finite Gmail discovery, original
update display, fixed WORK UPDATES 101 deterministic evaluation, fresh raw/source/
plan comparison, existing authentication exception and allow-lists, exact
interactive per-message confirmation, existing durable ledger and one-shot sender.
The original fake-only approve-test command remains available and unchanged in
its evaluator restriction. No new dependencies.

Validation: 286 offline tests passed; typecheck and git diff --check passed.
17 new tests cover APPROVE, cancellation/wrong phrases, deterministic failures,
REVIEW, source changes, all ledger states, uncertain sends, allow-lists, no piped
confirmation/force/provider override, and competing sessions. Gmail reads/sends
are mocked; existing offline network guard remains enabled.

## Live acceptance: pending user execution

| Case | Offline observed result | New live observation |
| --- | --- | --- |
| Valid concise update | APPROVE; one mocked send after exact confirmation | Not run |
| Missing next steps / placeholder / excessive code | REJECT; zero sends or prompts | Not run |
| Ambiguous quotation | REVIEW; zero sends or prompts | Not run |
| Repeat / uncertain action | No new send or confirmation | Not run |

Publication of the new APPROVE case has **not** been manually confirmed.
Earlier Milestone 4B publication confirmation is not evidence for this workflow.
Cloud implementation used no Gmail credentials and made no live Gmail read/send,
group action or semantic-provider call. Live acceptance requires the user's
local OAuth setup and manual observation; follow
[the test guide](supervised-moderation.md#disposable-group-acceptance-test).

Authentication remains INDETERMINATE on the supported raw Gmail path unless a
trusted boundary can be established. The explicit test-only exception remains
visible and never becomes TRUSTED. Ledger storage is local, not cross-machine.
Cancelled candidates are not reserved; atomic reservation follows confirmation
and precedes submission. Uncertain actions are never automatically retried.

No scheduler, autonomous moderation, background polling, retry loop, rejection/
review email, semantic AI call or deployment was added. Software implementation
and offline validation are complete; live acceptance remains pending.
