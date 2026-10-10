# Milestone 5A: operational safety foundations

Baseline: `v0.1.0-milestone4b` (`88911e4`). Work branch: `milestone5a-safety-foundations`.
This milestone adds offline safety infrastructure, not unattended moderation. No Gmail account,
OAuth credentials, TypeSafe key, or live Google action is needed to build or test it.

## Architecture and execution boundary

AI evaluates. Policy decides. Adapters perform I/O. Core policy/evaluator interfaces are unchanged.
The controlled path now follows:

```text
fresh raw notification → MIME + Groups structure → authentication assessment
→ fake evaluator + deterministic policy → source-derived frozen reply plan
→ exact human confirmation → one-use runtime capability → atomic ledger reservation
→ durable DISPATCHING → one mocked/test send boundary
```

`GoogleGroupsParser` establishes supported shape and configured group binding, not origin.
`verifyNotificationAuthentication` separately interprets authentication observations and checks
trusted infrastructure provenance. It runs before evaluation in the controlled path.
Read-only `checkEmail` still emits data-only, non-executable previews; an APPROVE preview is
not execution eligibility and does not assert authenticated origin.

Prepared plans and their references are frozen. Private WeakMaps bind prepared and confirmed
objects to the mailbox and a five-minute lifetime. The executor rejects plain plans, cloned
plans, unconfirmed objects, account mismatches, and reused capabilities. This is an application
invariant, not a sandbox against malicious installed JavaScript. Configuration, evidence providers,
ledger adapters, token providers and program code are trusted infrastructure, never evaluator output.
There is no generic unattended executor. A future executor must require TRUSTED and the ledger;
it must not reuse the explicitly test-only authentication exception.

## Authentication model and what counts as TRUSTED

`AuthenticationPolicy` is explicit and configurable through the preparation/verifier API:
accepted exact domains, trusted boundary IDs, authserv ID, required SPF and required DMARC.
DKIM pass is always required. Defaults are `googlegroups.com`, `mx.google.com`, SPF and DMARC
required, and **no trusted boundary IDs**. The Google defaults are a provisional narrow policy,
not a claim that all Google notification formats use these identifiers.

TRUSTED requires all of:

1. Exactly one outer `Authentication-Results` in the supported strict grammar, matching authserv ID.
2. Required SPF/DKIM/DMARC pass results, no conflicting/duplicate methods or properties.
3. Exact accepted domains for DKIM (`header.d` or `header.i`), SPF `smtp.mailfrom`, and DMARC
   `header.from`; DMARC domain must equal the parsed outer From domain. Conflicting DKIM
   identities are rejected. This intentionally accepts fewer cases than RFC relaxed alignment.
4. A trusted `AuthenticationEvidenceProvider` attestation for a configured boundary ID,
   bound to SHA-256 of the **exact fetched raw bytes**. The provider's contract includes
   establishing that the interpreted outer results were inserted by the trusted ingress.

The provider is a separate infrastructure port. It cannot be constructed by an evaluator or
inferred from a string inside an email. **No production Gmail attestation provider exists here.**
Only offline tests provide one. Raw Gmail messages therefore never become TRUSTED by default,
even if `Authentication-Results: mx.google.com; ...=pass` looks plausible.

Explicit fails/wrong domains are UNTRUSTED. Missing, malformed, duplicated, contradictory or
unproven evidence is INDETERMINATE. Exceptions fail closed. Authentication-like body content is
not evidence. Nested original authentication headers require review rather than being promoted
to outer-message trust. ARC instances are checked for basic matching contiguous chain structure;
this is not cryptographic ARC validation. ARC cannot rescue a failed required result or establish
provenance. No DKIM/ARC cryptographic verifier or DNS resolver was implemented.

### Why Gmail retrieval does not authenticate the original sender

Gmail performs receiver-side SPF, DKIM and DMARC checks and may record ARC-related results.
These protocols authenticate domains/transport properties; they do not establish that an update
is substantive or that a particular employee authored its claims. SPF concerns the SMTP envelope
and sending IP; it is not a From-header check. DKIM authenticates signed content under a signing
domain. DMARC ties an authenticated SPF/DKIM identifier to the visible From domain. Forwarding
and mailing lists complicate these results. ARC is a signed chain requiring a trust decision
about sealers, not an independent `arc=pass` escape hatch.

The Gmail API's Message resource exposes `raw` and MIME `payload.headers`, not a structured,
provenance-qualified sender-authentication verdict. OAuth authenticates mailbox access only.
An arbitrary delivered/imported message may carry invented `Authentication-Results`, `Received`,
`Received-SPF`, `X-Google-*` or ARC fields. Selecting the first/last header or matching
`mx.google.com` is insufficient without a documented ingress rule that removes forged local
results, establishes the trustworthy Received-chain boundary, and excludes bypass/import paths.
Those Gmail insertion/stripping assumptions were **not established** in this milestone. We do
not infer trust from header ordering, a familiar sender address, or the mailbox containing it.

### Controlled 4B compatibility

The 4B tag remains unchanged. On this branch, `approve-test` defaults to refusing untrusted or
indeterminate notifications. The example sending config keeps both sending and the exception off.
To reproduce only the disposable-group experiment, an operator must explicitly configure:

```yaml
sending:
  enabled: true
  test_only: true
  test_only_allow_unverified_authentication: true
  allowed_groups: [hmm-testing@googlegroups.com]
  allowed_reply_addresses: [hmm-testing+msgappr@googlegroups.com]
```

This accepts only missing authentication evidence or otherwise passing observations without an
established ingress provider. It does not bypass explicit failures, wrong domains, malformed
headers, contradictory results, provider errors, or structural/recipient/account guards. It emits
`WARNING: TEST-ONLY UNVERIFIED AUTHENTICATION EXCEPTION` and retains INDETERMINATE, never TRUSTED.
All existing guards remain: explicit ID, fake evaluator, fresh fetch/parse/evaluation, single group
and reply allowlists, matching verified read/send accounts, exact `APPROVE TEST`, one send, no retry.
Do not enable or test this against live Google services during offline development.

## Durable ActionLedger

`ActionLedger` is an infrastructure port with `reserve`, `get`, compare-and-append `transition`, and
`reconcile`. `LocalActionLedger` uses a dependency-free append-only filesystem journal under
`.hmm/actions`. No SQLite/native dependency was added: the supported `node >=22` range includes
versions before `node:sqlite`, Node 22 documents it as active development, and Node 24 documents
it as release candidate. Adopting it requires a separately chosen minimum/pinned runtime.

Reservation exclusively creates the same `<sourceKey>.json` name used by 4B. This sentinel
interlocks old and new processes. Existing ATTEMPTING, SENT, unreadable or corrupt legacy records
block reservation; they are never silently reset or treated as failed-safe. Keep old records.
A version-2 sentinel points to an ActionId directory containing numbered, checksummed snapshots.
Writes flush the temporary file, atomically hard-link it into the next sequence number without
overwriting, then sync the directory on POSIX. Only one process can publish a given revision.
Reads check identities, checksums, sequence, legal transitions and the reservation sentinel.
Missing/partial/corrupt journals fail closed. Temporary files do not grant permission to send.

The implementation supports one local deployment using one shared ledger directory. Tests also
exercise competing local processes. It requires a local filesystem supporting atomic exclusive
creation and hard links. NFS, object mounts and independent machines are not supported. Windows
supports the process-crash behavior but portable directory fsync is unavailable: power-loss
persistence is not claimed there. Storage hardware, OS and filesystem durability still matter.
Protect and back up this directory; deleting/rolling back all state cannot be detected locally.
Checksums detect accidental corruption, not malicious local administrators. No distributed or
exactly-once guarantee is claimed.

Records contain hashes of source/plan, enum state, revision, time, optional Gmail receipt IDs and
an external evidence digest. No full email, subject, recipient, account, token, or exception text
is required. Reply body exists only in the in-memory plan/request, not the ledger.

## State machine and failure model

```text
new → RESERVED → DISPATCHING → SENT → CONFIRMED (external publication evidence)
         │             └────→ UNCERTAIN → CONFIRMED (external evidence)
         ├→ FAILED_SAFE                   └→ FAILED_SAFE (authoritative no-effect evidence)
         └→ UNCERTAIN (crash recovery)
```

No state permits a second reservation or automatic retry, including FAILED_SAFE. Reconciliation
never initiates sending. RESERVED/DISPATCHING left by a stopped process remain blocked; a trusted
operator can classify them UNCERTAIN through a compare-and-append transition. Do not perform
recovery while the original process might still execute. There is no automatic stale-lock expiry.

| Event | Result |
| --- | --- |
| Reservation fails, including disk/permissions/duplicate | No token/send request; stop |
| Authorization definitely fails before send submission | FAILED_SAFE; no send |
| DISPATCHING cannot be durably recorded | No send |
| Timeout, dropped response, HTTP error, malformed success | UNCERTAIN; no retry |
| Valid Gmail message/thread receipt | SENT; not proof of publication |
| SENT update fails after successful response | Return observed SENT with `recordSaved:false`; persist UNCERTAIN if possible, otherwise DISPATCHING blocks |
| Later authoritative publication evidence | CONFIRMED |

Even HTTP errors are conservatively classified UNCERTAIN rather than assuming a transport could
not have caused an effect. A lost response cannot distinguish “not accepted” from “accepted but
acknowledgment lost”; resending could duplicate the real moderation action.

`ReconciliationResult` distinguishes CONFIRMED, NO_EXTERNAL_EFFECT, NOT_CONFIRMED and STILL_UNKNOWN.
The latter two leave the action blocked. An absence from a search is not authoritative no-effect
proof. Evidence digests identify external evidence retained by the trusted operator/provider;
the ledger does not verify evidence itself. SENT cannot become FAILED_SAFE. No scraper,
reconciliation CLI, or evidence-fetching service was added.

## ActionId audit and compatibility

4B hashed the OAuth grant-derived account identifier, so reauthorization changed ActionId even
though a separate mailbox/message reservation key prevented repeating the controlled send.
Version 2 fixes execution identity:

```text
sourceKey = SHA256(JSON.stringify([verifiedMailbox.toLowerCase(), GmailNotificationId]))
actionId  = SHA256(JSON.stringify(["hmm-action-v2", sourceKey, "approval-reply"]))
```

The CLI obtains the actual mailbox from Gmail's read-only profile endpoint before preparation.
File previews use `file:<fixture account>` as their separate account namespace. Thread, target,
body wording, evaluator explanations and OAuth grant/token are not action identity inputs.
The full frozen source-derived plan is separately hashed into the ledger reservation. Changing
reply metadata cannot acquire another reservation for the same source notification. Different
notifications remain different actions, even for the same underlying post: cross-notification
semantic deduplication remains future work. Existing ActionIds change; the unchanged legacy
source reservation key prevents this format upgrade from reopening previously attempted actions.

## Sources and research limitations (2026-10-10)

Primary material actually retrieved and inspected:

- [Google's current Gmail discovery schema](https://github.com/googleapis/google-api-nodejs-client/blob/main/discovery/gmail-v1.json): Message/MessagePart/raw/header fields; no structured authentication verdict.
- [IETF DMARC working-group DMARCbis source](https://github.com/ietf-wg-dmarc/draft-ietf-dmarc-dmarcbis/blob/master/draft-ietf-dmarc-dmarcbis.md): SPF identity, DKIM signing domain, alignment and limits of domain authentication. This is a working-group draft, not a substitute for a published RFC.
- [Node 22 SQLite documentation](https://github.com/nodejs/node/blob/v22.x/doc/api/sqlite.md) and [Node 24 SQLite documentation](https://github.com/nodejs/node/blob/v24.x/doc/api/sqlite.md): availability and stability assessment.

Normative/reference documents for the boundary, to revalidate before enabling a production provider:

- [RFC 8601](https://www.rfc-editor.org/rfc/rfc8601), Authentication-Results, especially trust boundaries and forged results.
- [RFC 7208](https://www.rfc-editor.org/rfc/rfc7208), SPF; [RFC 6376](https://www.rfc-editor.org/rfc/rfc6376), DKIM.
- [RFC 7489](https://www.rfc-editor.org/rfc/rfc7489), DMARC; [RFC 8617](https://www.rfc-editor.org/rfc/rfc8617), ARC.
- [Google: authenticated mail](https://support.google.com/mail/answer/180707) and [Gmail Message resource](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages).

Direct Google Help/developer and RFC Editor/IETF document endpoints returned environment proxy
403s during this session. Those pages were not freshly verified; the accessible Google schema
and DMARC working-group source were used without treating an unverified Gmail header-ordering
assumption as fact. A production trust provider remains blocked on this investigation and
sanitized observed-format validation. No private live headers were copied into the repository.

## Validation and remaining work

Tests cover adversarial authentication, plain/cloned plan rejection, source identity invariants,
reservation races (including separate processes), process exit, persistence, illegal transitions,
corruption, legacy records, uncertain responses and external reconciliation. `npm test` installs
a loopback-only socket guard; OAuth callback tests use loopback and all external transports are
mocked. Dependencies already installed are sufficient without internet or credentials.

Before unattended work: prove a production authentication boundary, remove any reliance on the
test exception, choose deployment/storage durability and shared coordination, implement and
validate external reconciliation, address replay across different notifications, and independently
review the executor/security interfaces. There is no scheduler, polling loop, autonomous send
path, real Jev integration, or next milestone implementation here.
