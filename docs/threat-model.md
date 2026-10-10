# Practical threat model

Scope: local development and one explicitly confirmed disposable-group reply. Trusted computing
base: operator configuration, installed code/dependencies, Gmail/OAuth transport adapters,
authentication evidence provider, ledger adapter and local OS. Evaluator outputs and every email
field/body are untrusted. No unattended execution is provided.

| Threat | Current mitigation | Residual risk | Future work |
| --- | --- | --- | --- |
| Malicious team-member body | Bounded MIME/HTML parser, configured Groups wrapper, body never chooses envelope/thread/ActionId | Plausible but false progress can pass demo rules | Assess semantic judgments and human-review policy |
| Prompt injection | Evaluator receives cloned content/rules and returns rule judgments; deterministic policy controls decision, no I/O ports | Model may misclassify content; not a sandbox for malicious provider code | Injection evaluation corpus, quality thresholds and review routing |
| Forged moderation notification | Structure and authentication are separate; default requires trusted ingress attestation and required domain passes | Gmail ingress provenance unproven; explicit controlled exception intentionally lacks it | Establish documented trusted ingress boundary; no exception in unattended mode |
| Compromised evaluator | Source-derived frozen plan, private confirmation capability, recipient/group allowlists, deterministic supervised command and fake-only actuator diagnostic | Arbitrary malicious installed JavaScript can access process privileges | Dependency isolation/review and least privilege deployment |
| Duplicate processing | Atomic source-key reservation, immutable journal, compare-and-append revisions, no retries | Separate Gmail notifications for the same post have distinct identities | Source-level deduplication semantics |
| Process crash | Persist reservation and DISPATCHING before send; leftover states block | Disk rollback/deletion or unsupported filesystem durability | Deployment-specific storage guarantee, backup/recovery procedures |
| Timeout after send | UNCERTAIN, no automatic resend; lost receipt never interpreted as failed-safe | Operator cannot infer publication from send or absence alone | Authoritative reconciliation provider and evidence retention |
| Replayed old notification | Same mailbox/Gmail ID blocked forever by retained records | Imported/resubmitted notification has a new Gmail ID; pending state/age not verified | Freshness policy and authoritative pending-state verification |
| Second machine processing same email | Port permits future shared ledger; same local directory handles competing processes | Independent ledgers do not coordinate; multi-machine deployment unsupported | Hosted ledger with atomic cross-instance reservation before deployment |
| Corrupted local state | Checksums, identity/sequence/state validation, fail-closed reads and writes, no silent reset | Checksums cannot resist privileged edits; full directory deletion/rollback is undetectable | Protected storage, backup integrity and recovery tooling |
| Stolen OAuth refresh token | Ignored local token files, restrictive creation modes, minimum read/send scopes, no token in ledger/logged provider errors | A stolen send token can act outside hmm's guards; local malware is outside this boundary | Revoke stolen grant, secure OS account/token storage, incident procedures |
| Forged reconciliation evidence | Reconciliation is a trusted infrastructure port; requires evidence digest, no automatic send or retry | Digest identifies evidence; it does not validate truth of operator/provider claims | Independently verify publication/no-effect evidence before implementing a provider |

Do not delete an uncertain record to retry. Stop all processors, preserve the ledger, and inspect
external evidence manually. A Gmail send receipt proves submission, not Google Groups publication.
See [the state machine and storage contract](milestone5a-safety-foundations.md).
