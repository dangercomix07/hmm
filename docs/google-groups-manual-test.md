# Manual Google Groups acceptance test

Follow the [current supervised procedure](supervised-moderation.md#disposable-group-acceptance-test)
with fresh disposable-group posts. Never perform live sends in CI.

Inspect the original update, group, recipient and threading before confirming
one APPROVE. REJECT and REVIEW must send nothing. Verify publication manually
and check a second run skips the recorded approval. Do not delete the ledger.

LIVE A publication was user-confirmed; B/D sent nothing and C required review.
A later run skipped LIVE A and the recorded HMM TEST 003. The older unrecorded
TEST 001 was separately confirmed and sent; its publication was not reported.
Search finds notifications, not current pending status.
See [the release record](releases/v0.2.0-supervised-mvp.md).
