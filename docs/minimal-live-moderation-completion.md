# Minimal supervised live moderation MVP completion record

> Historical development record. See the [current release](releases/v0.2.0-supervised-mvp.md)
> and [current setup](supervised-moderation.md) instead of historical branch commands.


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

## Initial acceptance status (superseded by observed live run below)

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
and offline validation are complete; live acceptance was pending at implementation time; see the observed live run below.

## First local live run and notification compatibility correction

The user supplied CLI output for four new live test posts. Observed deterministic
decisions were A APPROVE, B REJECT (missing next steps), C REVIEW (ambiguous quote),
and D REJECT (over ten code lines). B/C/D reached no send path. A stopped before
confirmation because the verifier vetoed authentication headers inside the
attached original post. No approval was sent by that run; publication remains
unconfirmed.

Offline inspection of the supplied notification established a supported outer
Groups notification containing an inline message/rfc822 original with its own
AR/ARC headers. The verifier now uses only outer authentication headers; nested
headers neither authenticate nor invalidate the wrapper. Outer failures,
duplicates, malformed ARC and lack of ingress provenance retain their existing
behavior. The supplied notification evaluates INDETERMINATE with no trusted
ingress provenance and is eligible only for the already explicit supervised
exception. No private headers or original message were added to the repository.

PASS lines now omit failure-oriented rule descriptions. Synthetic regression
tests cover nested header isolation, outer failures and supervised cancellation.
Validation after correction: 288 offline tests passed, typecheck and diff check
passed. No live Google action was performed during the correction.


## Observed supervised live acceptance

After updating to 7d154da and explicitly enabling the test-only authentication
exception locally, the user supplied a second CLI transcript and confirmed
that LIVE A appeared in Google Groups.

| Case | Observed local result | External action |
| --- | --- | --- |
| LIVE A | APPROVE; exact confirmation entered; SENT with recordSaved true | One approval reply; user manually confirmed publication |
| LIVE B | REJECT; missing next steps | No send |
| LIVE C | REVIEW; ambiguous quotation | No send |
| LIVE D | REJECT; eleven-line code block | No send |

The same run also discovered the older HMM TEST 003 notification. It offered
confirmation, but the executor refused reservation with “Execution record exists
or cannot be reserved; reconcile manually. No send.” No second reply was sent.
This is consistent with the legacy record interlock: the initial lookup uses
the current ActionId journal, while reservation also checks legacy source-key
records. Existing notifications in Gmail do not establish current pending status.
The late blocking check preserved duplicate protection but the redundant prompt
is a remaining UX limitation. The error stopped the session before the remaining
older candidates were processed. Do not delete the ledger to bypass this block.

The new LIVE A record is SENT locally; user-reported publication is documented
here, not programmatically reconciled to CONFIRMED. A rerun showing LIVE A skipped
has not yet been supplied. No private headers, message identifiers or credentials
are included in this record. No code changed for this documentation update;
latest code validation remains 288 passing offline tests and successful typecheck.
The live actions were performed by the user on their PC, not from the cloud session.


## Live-acceptance follow-up fixes

The legacy prompt limitation above is now fixed: a read-only ledger preflight
checks the current journal and legacy source-key sentinel before asking for
confirmation. Legacy or partial/corrupt sentinels display LEGACY_OR_INCOMPLETE
and are skipped without changing the record; corrupted current journals fail
closed. The atomic reservation remains authoritative against concurrent attempts.

Section rules now return truthful positive PASS feedback (including Future work
as the canonical Next steps alias), with unchanged predicates and policy.
Placeholder-only FAIL and configured mixed-placeholder REVIEW/ignore behavior
are unchanged. Positive feedback is displayed in the supervised CLI again.

The earlier outer-header correction is narrowed: nested authentication keeps
the supported inline-RFC822 case INDETERMINATE, even if an ingress provider
exists. It is eligible only for explicit supervised compatibility after required
outer observations pass. Normal mode, missing explicit flag, wrong group/reply,
malformed/contradictory outer evidence and failed authentication remain blocked.
The existing fresh snapshot, deterministic decision, exact confirmation,
single-use capability and durable reservation are unchanged.

A fully synthetic regression email reproduces the supported MIME nesting and
separate authentication headers. No private email or credentials were committed.
Validation: 293 offline tests passed, typecheck passed, git diff --check passed.
No live Gmail access or send, no new dependencies, no scheduler, no autonomous
path, no merge, and no next-milestone work.

## Configuration and terminal readability follow-up

All seven tracked YAML configs were validated against current loaders. Legacy
fake/Jev profiles now explicitly name the minimum_length check; profile behavior
is unchanged. The live Groups example uses the observed disposable-group sender,
subject and newer_than:1d query. The sending example includes all current fields
and retains disabled-by-default sending/authentication exception.

Added an offline config audit for tracked and locally present YAML, with paired
group/reply checks and no credential reads or file mutation. No local Gmail YAML
exists in the cloud workspace; the user's PC files cannot be audited remotely.
The config reference provides the matching intentionally enabled local settings.

Terminal output now separates numbered candidates, updates, checks and exact
approval details. Passing checks are concise; duplicate failure explanations
and the one-line JSON receipt were removed. Safety warnings and confirmation
remain. Latest verification: 295 offline tests passed; typecheck, configuration
audit and diff check passed. No live service calls or sends occurred.
