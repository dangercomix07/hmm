# Manual Google Groups integration test (future)

Approval-by-reply is unverified. This is a plan for after real Gmail and reply adapters are implemented, not a runnable test today. It must never run in CI.

The current offline harness can construct a non-executable reply plan from synthetic MIME fixtures. Its proposed body is not a verified approval command. See [the offline integration notes](gmail-google-groups-integration.md) for what has been established without Google access.

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
