# Milestone 4B: one controlled Gmail approval reply

`approve-test` is the first command that can send a real email. It sends one reply to one explicitly selected Gmail notification after fresh parsing/evaluation and an exact interactive confirmation. `check`, `check-email` and `gmail-check` retain their dry-run/read-only behavior. The evaluator and policy do not send mail.

Milestone 4B is complete for the controlled disposable-group experiment. The user ran `approve-test` locally for **HMM TEST 003**, confirmed the send, and then confirmed that Google Groups published the selected post. The supplied CLI output reports `SENT`, a returned Gmail thread matching the selected notification, and `recordSaved: true`. This is user-verified publication after a Gmail API send, not automatic Groups verification. No live send was attempted in Codex cloud. See the [milestone completion record](milestone4b-completion.md).

## Authorization: reuse the existing client and token

Both commands use `.secrets/gmail-desktop.json` and `.tokens/gmail.json`. **No new client or JSON download is required** when adding a scope in Google Cloud Data Access; the existing client ID and secret stay the same.

The initial `gmail-check` login requests `https://www.googleapis.com/auth/gmail.readonly`. To authorize the controlled send, run `approve-test <id> --reauthorize` and consent to exactly:

- `https://www.googleapis.com/auth/gmail.readonly` — existing reads/search/RAW and mailbox identity checks.
- `https://www.googleapis.com/auth/gmail.send` — submit the selected reply.

Adding the scope in Cloud Console alone does not upgrade an existing token. `--reauthorize` explicitly opens browser consent using the same client, and replaces the saved token only after the new grant's scopes and client identity have been checked. Failed/denied consent leaves the existing token file intact. It also works for an expired/revoked token, without manually deleting it.

Afterward, omit `--reauthorize` on normal runs. `gmail-check` accepts the upgraded token but still calls only read endpoints; the token itself now has sending permission. Unrelated scopes such as `gmail.modify` remain rejected. All controlled-send group/recipient/confirmation/duplicate guards still apply. No second client, `gmail-send-desktop.json` or `gmail-send.json` is used.

Reauthorization can change the grant-derived ActionId. The local execution record also identifies the selected notification by verified mailbox and Gmail message ID, so that change does not bypass duplicate protection in this checkout.

## Local setup in PowerShell

Use Node 22 or newer. On a clean checkout of this branch:

```powershell
cd C:\Users\ameya\Documents\DANGERCOMIX\hmm
git fetch origin
git switch --track origin/milestone4b-controlled-reply
npm ci
npm test
npm run typecheck
```

If you already have that branch locally, use `git switch milestone4b-controlled-reply` and `git pull --ff-only origin milestone4b-controlled-reply` instead.

1. In [Google Cloud Console](https://console.cloud.google.com/), select the test project already used for Milestone 4A. Gmail API must be enabled.
2. In **Google Auth Platform → Data Access**, add `gmail.send` alongside `gmail.readonly`. Keep the app in Testing and your moderator account in the test-user list. Console labels may vary.
3. Keep your existing `.secrets/gmail-desktop.json`; do not download it again. You will grant the added permission in the browser using `--reauthorize`. If your organization blocks these scopes, resolve it with its administrator.
4. Create the local sending config (do not overwrite one that already exists):

```powershell
Copy-Item config/gmail-sending.local.example.yaml config/gmail-sending.local.yaml
```

5. Edit `config/gmail-sending.local.yaml` to explicitly opt in:

```yaml
sending:
  enabled: true
  test_only: true
  allowed_groups:
    - hmm-testing@googlegroups.com
  allowed_reply_addresses:
    - hmm-testing+msgappr@googlegroups.com
```

Only one exact group and one exact reply address are supported; no wildcard, batch or fallback exists. Your ignored `config/google-groups.local.yaml` must describe the same group and observed notification sender/subject from Milestone 4A. `dry_run` remains a policy/pipeline setting; this separate explicit actuator command uses `sending.enabled`, the allowlists and human confirmation. Merely changing `dry_run` cannot enable it, and leaving it true does not override the explicit `approve-test` opt-in.

## One live experiment

1. Create **a fresh disposable pending post** in `hmm-testing`, with content that passes the current fake evaluator. Do not reuse the old message used for manual approval. Verify that this new post is currently pending in Google Groups.
2. Run the existing read-only check:

```powershell
npm run cli -- gmail-check
```

3. Identify the fresh post by its original subject and copy **its Gmail message ID**, not its RFC Message-ID or its thread ID. Old notifications can still appear after a post has already been approved; a Gmail search hit does not prove a post remains pending.
4. Run the controlled command, replacing the placeholder with that exact ID:

```powershell
npm run cli -- approve-test YOUR_NEW_GMAIL_MESSAGE_ID --reauthorize
```

The command fetches only that message and runs the existing MIME parser, Groups parser, fake evaluator and policy again. Only APPROVE plus a valid reply plan can proceed. REJECT, REVIEW, wrong group, unlisted recipient, missing metadata or a fetched ID mismatch stops the command.

For this first permission upgrade, authorize your existing client in the browser with the **same moderator account**. Omit `--reauthorize` after successful authorization. OAuth consent does not send mail. The command checks the account identity and exact granted scopes, then displays the group, original author/subject, From, To, reply subject, In-Reply-To, References, selected Gmail message ID, thread, ActionId and body.

5. Inspect every field. The reply body is `Approve.` for this experiment; no claim is made that this word is necessary for Google Groups. The parser's existing outer Reply-To/From choice remains unchanged, but the chosen address must match the extra send-recipient allowlist.
6. Only when the displayed plan matches the fresh disposable test, type exactly:

```text
APPROVE TEST
```

Anything else, EOF, Ctrl+C or a timeout cancels. A real interactive terminal is required; piping `APPROVE TEST`, `--yes`, approve-all/latest and batches are unsupported.

7. The command sends one reply and stops. A successful result contains `status: SENT`, the stable action ID, Gmail's returned message ID and thread ID. It explicitly says **Google Groups approval is NOT programmatically verified**. If Gmail returns a different thread ID, it warns without resending.
8. Check Google Groups manually: confirm that **this selected post** left the pending queue and is published. Check that no other post was approved by this experiment. Record the outcome locally (sent message/thread IDs and published/not published/unknown). No Groups scraping or automatic verification is performed.
9. Optionally set `sending.enabled: false` when finished as an extra local off switch. Leaving it enabled does not start a scheduler or bypass explicit message selection and confirmation.

## Reply construction and official sources

The only mailbox mutation endpoint added is:

`POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send`

It receives JSON `{ raw, threadId }`. `raw` is base64url-encoded RFC email with CRLF line endings, a verified account From, the plan's exact To and Subject, In-Reply-To and References, a standard Date and generated Message-ID, MIME-Version, UTF-8 text/plain and the fixed ASCII test body. Unicode/long subjects use folded RFC 2047 encoded words; no undocumented Google Groups headers are created. Header injection, malformed parents, missing thread/action identity and oversized lines are rejected before confirmation and again at the executor boundary. `References` includes the outer notification Message-ID; the original post's Message-ID is not substituted as the reply parent.

The plan supplies the existing subject without inventing a `Re:` prefix. Gmail's documented thread requirements are: pass `threadId`, use valid References/In-Reply-To, and matching Subject. The executor does not run rules, choose a recipient or infer missing threading metadata.

Official Google sources inspected on 2026-10-10:

- [Google's maintained Gmail discovery schema](https://github.com/googleapis/google-api-nodejs-client/blob/main/discovery/gmail-v1.json): `users.messages.send`, minimal send scope, RAW RFC/base64url representation, Message.threadId threading requirements, and read-only `users.getProfile` account identity endpoint.
- [Google Auth Library Node documentation](https://github.com/googleapis/google-auth-library-nodejs#readme), already used for Milestone 4A: offline grants, refresh tokens and token scope inspection. Existing state/PKCE callback and token persistence are reused; no new dependency was added.

Canonical guides: [sending mail](https://developers.google.com/workspace/gmail/api/guides/sending), [working with threads](https://developers.google.com/workspace/gmail/api/guides/threads), [send reference](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send). Google's documentation hostname was blocked from this environment; the authoritative discovery schema was fetched successfully. Actual programmatic Groups approval remains an empirical local test.

## Failure and duplicate protection

There are no automatic API retries, including OAuth SDK retries. Access-token refresh before submission remains supported.

- Before submitting, the executor records an exclusive reservation in ignored `.hmm/actions/`. An in-process set also rejects a repeated ActionId.
- The local record filename hashes the verified sender account and selected Gmail message ID. It stores the ActionId. Thus reauthorization changing a grant-derived ActionId does not bypass the same-message reservation in this checkout.
- Exclusive file creation prevents two local commands from claiming the same message simultaneously. On success the SENT result is written through a temporary file and rename. Neither token values nor message bodies are stored in these records.
- HTTP 4xx/5xx, timeout/network failure or an unreadable success response never triggers another send. The reservation remains. A network failure can mean Gmail received the request even if the client saw no response: the outcome is **UNKNOWN**, not safely unsent.
- If Gmail reports success but updating the record fails, the command still reports SENT and warns that the reservation remains. Do not resend.
- An existing or unwritable reservation blocks the send. There is no override flag. Inspect Gmail Sent and the test group manually; use a new disposable post for another experiment. Do not delete records to retry an uncertain send.

This is not exactly-once delivery or a production ledger. Records can be lost/copied/deleted, separate PCs/checkouts do not share them, and separate notifications for the same pending post may have different IDs. A durable action ledger with reconciliation/recovery is **required before unattended automation**. Sender-authentication enforcement is still incomplete; observed authentication headers are not a verified authorization boundary. The configured test-group label relies on the operator selecting a genuinely disposable group. Production-group operation is outside this milestone.

## Implementation and validation report

Added: `gmail-reply-executor.ts`, `prepare-test-approval.ts`, `test-sending-config.ts`, `ports/email-reply-executor.ts`, `cli/approve-test.ts`, the disabled local sending-config example, and offline actuator tests. Updated: OAuth scope mode/validation, CLI routing/help, ignored paths and documentation. No evaluator, policy, GmailClient interface, GmailTransport, parsing rules or ActionId algorithm changed. No new dependencies.

Validation: **154 tests passed** (133 existing plus 21 added), `npm run typecheck` passed, and credential/token/record/config ignore rules were checked.

Offline tests cover fresh approval/refusal paths, explicit group/recipient guards, message-ID and metadata failures, exact confirmation/cancellation, noninteractive CLI rejection, RFC/Unicode/threading, scope expansion, shared-token reuse, explicit reauthorization and insufficient grants, account mismatch, one POST only, 4xx/5xx, unknown outcomes, record failures, cross-run and concurrent duplicates. All HTTP/OAuth send boundaries are mocked; CI needs no Google credentials or live API access.

No scheduler, automatic polling, approve-all, background service, rejection email, production approval workflow, database, Groups scraping or unattended mode was added. The cloud performed **zero live sends**. The user subsequently confirmed that the locally sent reply published HMM TEST 003 in the test group. This validates the controlled experiment, not unattended or production readiness.
