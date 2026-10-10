# Milestone 5A completion report

Branch: `milestone5a-safety-foundations`, based on `v0.1.0-milestone4b` (`88911e4`).
Main and the 4A/4B branches are unchanged. No next milestone was started.

1. **Architecture:** explicit notification-authentication and ActionLedger ports; frozen source-derived
   plans; one-use human-confirmed execution capabilities; read-only mailbox identity helper.
   Evaluator/core privileges and policy separation remain unchanged.
2. **Authentication model:** strict interpretation of outer Authentication-Results plus a separate,
   exact-raw-byte-bound trusted-ingress attestation. ARC syntax never supplies cryptographic trust.
3. **Official sources:** Google's Gmail discovery schema, IETF DMARC working-group source, and Node
   22/24 SQLite docs were retrieved. Direct RFC/Google Help endpoints were blocked by the environment;
   the [research record](milestone5a-safety-foundations.md#sources-and-research-limitations-2026-10-10)
   distinguishes inspected primary material from references still requiring verification.
4. **TRUSTED:** required SPF/DKIM/DMARC pass observations, configured exact domains and alignment,
   unambiguous supported headers, and a configured provider's raw-byte-bound ingress attestation.
5. **Unverified:** a production Gmail ingress provider, header insertion/stripping and import-path
   assumptions, broader live notification formats, and cryptographic ARC validation. Raw Gmail never
   becomes TRUSTED by default. An explicit, warned test-only exception preserves the controlled test.
6. **Ledger:** dependency-free local append-only journal, exclusive legacy-compatible source reservation,
   flushed atomic no-overwrite event publication, revisions/checksums and fail-closed validation.
   Local filesystem/single-deployment support only; Windows power-loss durability is not claimed.
7. **States:** RESERVED → DISPATCHING → SENT; external evidence can confirm SENT/UNCERTAIN.
   RESERVED can fail safely; ambiguous/crash outcomes become UNCERTAIN. No automatic re-reservation.
8. **Failures:** reservation/dispatch write failure stops sending. Definite pre-submission token failure
   becomes FAILED_SAFE. Timeout/HTTP/malformed response becomes UNCERTAIN. Valid receipt is SENT,
   never publication confirmation. Failed final recording retains a blocking reservation.
9. **ActionId audit:** replaced OAuth-grant-dependent identity with versioned verified mailbox + Gmail
   notification identity + approval action kind. Legacy reservation filenames remain interlocked.
   Evaluator wording, body-injected IDs and model-selected thread/recipient fields cannot change it.
10. **Tests:** adversarial auth, source/recipient manipulation, immutable capability enforcement,
    timeout/error handling, legacy records, state transitions, reconciliation, corruption, persistence,
    concurrent processes and crash simulation. A loopback-only network guard now runs with npm test.
11. **Total:** 195 passing, 0 failing, 0 skipped (154 baseline tests plus 41 additional tests).
12. **Typecheck:** `npm run typecheck` passed. `git diff --check` passed.
13. **Files:** full changed-file inventory below.
14. **Dependencies:** none added; dependency declarations and lockfile unchanged. The test script
    loads the offline guard. Existing installed dependencies are sufficient.
15. **Before unattended operation:** prove production ingress authentication; implement authoritative
    reconciliation; choose deployment/storage durability and coordination; address replay across
    separate notifications; review future executor invariants. Do not use the test-only exception.
16. **Live actions:** no live Gmail/Groups/Jev access, OAuth authorization, email send or group approval
    was performed. No user credentials were requested or used. Network work was limited to public
    documentation research and GitHub repository operations; tests used mocks and loopback.
17. **Automation:** no scheduler, polling loop or autonomous send path exists. The only send executor
    still requires the explicit controlled-test confirmation flow. No merge to main was performed.

See the [detailed safety contract](milestone5a-safety-foundations.md),
[threat model](threat-model.md), and [security invariants](../SECURITY.md).

## Changed files

- `CONTRIBUTING.md`
- `README.md`
- `SECURITY.md`
- `config/gmail-sending.local.example.yaml`
- `docs/gmail-approval-test.md`
- `docs/milestone5a-completion.md`
- `docs/milestone5a-safety-foundations.md`
- `docs/threat-model.md`
- `package.json`
- `src/adapters/approval/action-identity.ts`
- `src/adapters/approval/email-action-plan.ts`
- `src/adapters/approval/gmail-reply-executor.ts`
- `src/adapters/approval/prepare-test-approval.ts`
- `src/adapters/approval/test-sending-config.ts`
- `src/adapters/email/notification-authentication.ts`
- `src/adapters/inbox/gmail-account.ts`
- `src/adapters/ledger/local-action-ledger.ts`
- `src/cli/approve-test.ts`
- `src/cli/gmail-check.ts`
- `src/index.ts`
- `src/ports/action-ledger.ts`
- `src/ports/notification-authentication.ts`
- `tests/action-ledger.test.ts`
- `tests/approve-test.test.ts`
- `tests/notification-authentication.test.ts`
- `tests/offline-guard.ts`
