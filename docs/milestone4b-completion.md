# Milestone 4B completion record

Status: **controlled local experiment completed**, as confirmed by the user on 2026-10-10 (Asia/Kolkata). Baseline tag: `v0.1.0-milestone4b`.

## Observed result

The user created the disposable **HMM TEST 003** post in `hmm-testing` and ran the real Gmail read-only flow. MIME/source parsing succeeded and the fake evaluator returned APPROVE. The user then ran `approve-test` for that exact Gmail notification and typed `APPROVE TEST` after inspecting the plan.

The supplied command output reports:

- One successful Gmail API reply (`status: SENT`).
- Returned Gmail thread ID matching the selected notification's thread.
- Local execution record saved (`recordSaved: true`).

The user subsequently confirmed that the selected post appeared in Google Groups. This completes the intended chain: pending post → real notification → Gmail RAW read → parsing → evaluation → plan → explicit confirmation → one API reply → manually verified publication.

An earlier prompt was answered with `APPROVE` instead of `APPROVE TEST`; it cancelled and reported no email sent. No cloud agent performed a live send. Publication was verified by the user, not by scraping or an automated Groups verifier. Private account addresses, OAuth URLs, tokens, action IDs, Gmail IDs and message contents are intentionally omitted from this public record.

## Verified baseline and limits

- Milestones 1–3: local rules/policy, optional Jev adapter with mocked HTTP tests, and offline Gmail/Groups harness.
- Milestone 4A: user-supplied live output shows TEST 001 approved by the fake evaluator and TEST 002 rejected; both check runs were read-only.
- Milestone 4B: the selected TEST 003 was sent after confirmation and its publication was user-confirmed.
- Shared Desktop OAuth client and token support read-only access plus explicit read+send reauthorization. Gmail check commands remain read-only even with an upgraded token.
- Test-group and reply-recipient allowlists, account checks, fresh evaluation, exact interactive confirmation, no send retries, and local reservation records are implemented.
- 154 offline tests and TypeScript checking pass on the implementation baseline. CI does not need Google credentials or make real Gmail sends. No new dependency was needed for Milestone 4B.

This validates one controlled experiment, not all notification formats, rejection delivery, Jev's live judgments, or unattended production moderation. Sender-authentication enforcement remains incomplete. Local records are not a durable cross-machine ledger, and Gmail send success alone does not establish publication on future runs. The proposed body `Approve.` worked in this experiment; this does not establish that the word itself is required.

## Suggested next work

1. Test real Gmail input with Jev in read-only mode, using explicit provider authorization and assessing decision quality before any AI-driven sends.
2. Establish a trusted sender-authentication boundary and durable action tracking/reconciliation for uncertain sends.
3. Consider unattended operation only after those safeguards are implemented and validated. No scheduler is included in this baseline.

The milestone merge/tag does not alter any user's ignored OAuth credentials, tokens, local sending configuration or execution records. Disabling `sending.enabled` is an optional off switch between experiments; leaving it true does not enable background execution or remove the human confirmation requirement.
