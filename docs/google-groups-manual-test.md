# Manual Google Groups integration test

The user completed the controlled local API reply experiment for HMM TEST 003 and confirmed publication. See the [completion record](milestone4b-completion.md) and [current command/setup guide](gmail-approval-test.md). This procedure remains manual and must never run in CI.

The result applies to the disposable test group and selected post. It does not establish production readiness or automatic sender authentication. For further experiments, use a fresh pending post and the explicit `approve-test` confirmation flow.

1. Use a disposable test group and a moderator account authorized for that group.
2. Submit one synthetic message with a unique subject and fake content.
3. Confirm that this exact message enters the moderation queue.
4. Run the Gmail adapter in dry-run mode, scoped to that group and exact moderation message ID.
5. Inspect the sender, group identity, reply target, thread headers, author, subject, and extracted original body. Stop on any ambiguity.
6. Confirm that the deterministic decision applies to that original message. Do not use the fake evaluator to moderate real submissions.
7. Explicitly enable one reply for that exact disposable message only. Leave all other pending messages excluded.
8. Reply programmatically using the verified Google message instructions and required thread headers.
9. Independently check whether Google Groups published the original message. A successful Gmail send alone does not prove approval.
10. Record the observed format and behavior, restore dry-run mode, and delete disposable test data as appropriate.

If it does not work, keep live approval disabled. Do not guess at alternative approval actions against real pending messages.
