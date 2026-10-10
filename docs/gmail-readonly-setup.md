# Local Gmail read-only test (Milestone 4A)

For the separate opt-in sending experiment, see [Milestone 4B](gmail-approval-test.md). `gmail-check` retains the read-only behavior documented here.

This command reads candidate emails and prints decisions and non-executable plans. It cannot send, draft, approve, mark read, archive or modify mail. It uses the fake evaluator: private email is not sent to Jev. No credentials are needed for development or `npm test`.

## Google setup on your PC

Use the Google account that received the two moderation notifications. Leave those messages pending in Google Groups.

1. Open https://console.cloud.google.com/ and create/select a project, such as `hmm-local-test`. A project is a container for this app's Google API settings.
2. In **APIs & Services → Library**, find **Gmail API** and enable it for that project.
3. Open **Google Auth Platform** (older console layouts call this **OAuth consent screen**). Complete the app setup: name `hmm local test`, your support email and your contact email. For a personal Gmail account choose **External**, keep the app in **Testing**, and add the moderator's exact Google account under **Audience → Test users**. Workspace-only Internal apps are an alternative only if your organization permits them. Organization policy can still block authorization.
4. Under **Data Access**, add only `https://www.googleapis.com/auth/gmail.readonly`. It permits reading the whole mailbox; the app's search query limits what this command fetches but does not narrow the OAuth grant to one group. Do not add send, modify or compose scopes.
5. Under **Clients → Create client**, select **Desktop app**. Name it `hmm laptop`. Download its JSON. Do not choose Web application or service account. Do not add hosted redirect URLs. A dedicated client avoids reusing a grant with broader scopes.
6. In the repository, make the ignored credentials folder and save the downloaded JSON as `.secrets/gmail-desktop.json`. Keep this file and tokens on your PC; do not paste them into chat or commit them.

Console labels can change. Direct Google documentation pages were inaccessible from the development environment; official Google source examples and discovery definitions were inspected (sources below). If Google shows an unverified-app warning for your own test project, check the project/client and requested read-only permission before continuing. Do not try to bypass a Workspace administrator's block. Publishing a public app using this restricted scope has separate verification requirements; this milestone is a private local test.

## Run in PowerShell

From your updated checkout, using Node 22 or newer:

```powershell
cd C:\Users\ameya\Documents\DANGERCOMIX\hmm
npm ci
npm test
npm run typecheck
New-Item -ItemType Directory -Force .secrets
Copy-Item config/google-groups.local.example.yaml config/google-groups.local.yaml
```

Save the downloaded Desktop JSON at `.secrets/gmail-desktop.json` before continuing. Do not overwrite an existing local config; if one exists, edit it instead of copying again.

Open `config/google-groups.local.yaml`. It contains no credentials. The initial query is a narrow starting point based on the requested test group, not an observed real sender. Try that query in Gmail's search box first and refine it to find just the two notifications (for example with a date range or their exact subjects). The command does not require unread messages, so reading a notification in Gmail does not exclude it.

```powershell
npm run cli -- gmail-check --inspect
```

On the first run a browser opens. Choose the moderator account, grant Gmail read-only access, and return to PowerShell. The callback uses an ephemeral port on `127.0.0.1` on this same PC and closes after completion or five minutes. This is a temporary desktop OAuth callback, not a deployed web service. If automatic browser opening fails, open the printed authorization URL on the same PC. Do not forward it to someone else.

The refresh token is saved to `.tokens/gmail.json`. Later runs reuse it and obtain a short-lived access token when necessary. Only the refresh token and client ID are persisted; access tokens remain in memory. Newly issued access tokens are checked for the exact read-only scope and expected client before Gmail reads. OAuth uses state and PKCE. No API failure retries are added; the SDK's OAuth retries are disabled too. Routine refresh of an expired access token is still performed.

**The first run is expected to print REVIEW:** the example's sender and subject are deliberately placeholders. `--inspect` prints actual notification From, Reply-To, Subject, Message-ID, References, In-Reply-To, recipients, Gmail thread ID, authentication-related headers, and structural observations, even if the Groups parser rejects the notification. It does not print the raw email or its full body. Output can still contain private addresses and identifiers; keep it local.

Use those observed values to replace `notification_senders` and `subject_contains` in the local YAML. Verify the intended `group_address` against the original forwarded recipient (Gmail **Show original** may be necessary). Then rerun:

```powershell
npm run cli -- gmail-check --inspect
```

Every candidate passes through the existing GmailTransport, MIME parser, Groups parser, rules, fake evaluator, policy and ActionPlan builder. A query hit is not trusted as a moderation email. The command prints Gmail ID/thread, extracted author/subject when parsing succeeds, decision, and reply plan if safe to construct. Plans always remain unverified and non-executable. No Gmail mutation occurs, including marking messages as read.

Exit codes: 0 means no review/rejection (also used for zero candidates), 1 means at least one rejection, 2 means any review/error. A nonzero exit after a REVIEW or REJECT is expected. Zero candidates is not proof of successful live integration; refine the Gmail query/account selection.

If the actual notification differs from the synthetic template, keep the REVIEW result. Inspect the exact difference before changing configuration or adding explicit support; never loosen the parser merely to pass. For diagnosis, provide only a redacted sample of the notification structure and needed headers, preserving delimiters. Do not share tokens, OAuth client JSON, private message text or approval links. Authentication headers are observations, not verified sender authentication.

## Token handling and troubleshooting

- `.secrets/`, `.tokens/`, `credentials.json`, `token.json`, `*.oauth.json` and `config/google-groups.local.yaml` are ignored. Custom credential/token paths are supported using `--credentials` and `--token`; use ignored directories for those too.
- Token writes use a temporary file followed by rename, with owner-only POSIX file permissions. Windows uses your account/folder ACLs; keep these folders private and outside shared/cloud-synced directories where possible. Tokens are plaintext local credentials, not encrypted storage.
- Google External apps in Testing can issue short-lived refresh grants for Gmail scopes (commonly seven days). Token expiration, revocation, password/security changes and grant limits can require reauthorization. Check Google's current policy in the source link below; it was not accessible here for current verification.
- For an expired/revoked grant or to select a different account: remove `.tokens/gmail.json` and run again. For a custom token path remove that file instead. Deleting the file does not revoke Google's grant; use https://myaccount.google.com/permissions to revoke it there.
- `access_denied`: confirm the exact moderator account is a test user, the client is in the intended project, and organizational policy permits it.
- Gmail read failure: confirm Gmail API is enabled, the account has Gmail, authorization is valid and network access to Google works. Errors intentionally omit Google's raw response and authorization details to avoid leaking credentials.
- The account identifier used internally is a hash of the local refresh grant, not an assertion of the signed-in email address. Reauthorization can change action IDs. No persistent ledger or executor exists; do not use these IDs for production actions.

## Sources and implementation choices

Inspected official Google sources on 2026-10-10:

- [Gmail REST discovery schema](https://github.com/googleapis/google-api-nodejs-client/blob/main/discovery/gmail-v1.json): `GET /gmail/v1/users/me/messages` with `q`, `maxResults`, `pageToken`; `GET /gmail/v1/users/me/messages/{id}?format=raw`; Gmail IDs, thread IDs and base64url RAW data. It explicitly states `gmail.metadata` cannot use `q` or RAW. Therefore `gmail.readonly` is the least scope supporting both operations.
- [Google Workspace Node Gmail quickstart](https://github.com/googleworkspace/node-samples/blob/main/gmail/quickstart/index.js): local browser authentication with read-only Gmail scope.
- [Google Auth Library Node documentation](https://github.com/googleapis/google-auth-library-nodejs#readme): OAuth2Client, offline consent, refresh-token persistence and access-token scope inspection.
- [Google local-auth implementation](https://github.com/googleapis/nodejs-local-auth/blob/main/src/index.ts): temporary local callback and Desktop OAuth flow. This app uses the official `google-auth-library` directly with state, PKCE and a bounded callback lifetime, rather than introducing a full Gmail SDK or hosted service.

Canonical Google documentation links (blocked by this environment's network policy, provided for local reference):

- https://developers.google.com/workspace/gmail/api/quickstart/nodejs
- https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list
- https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get
- https://developers.google.com/identity/protocols/oauth2/native-app
- https://developers.google.com/identity/protocols/oauth2#expiration

## Validation and manual live record

Validation: all **133 tests passed** (110 original plus 23 new), `npm run typecheck` passed, and locked dependency installation succeeded from the local cache. The only new direct dependency is `google-auth-library` (locked via `package-lock.json`).

Implementation files: `src/adapters/auth/gmail-oauth.ts`, `src/adapters/inbox/real-gmail-client.ts`, `src/cli/gmail-check.ts`, CLI routing/exports, the local config example, ignore rules, and `tests/real-gmail.test.ts`. The existing Gmail interface and transport are reused, with only stale comments/error wording updated. The follow-up parser correction supports empty outer recipient groups and one explicitly validated inline RFC822 original; evaluator and policy behavior are unchanged.

Automated tests mock the Gmail HTTP boundary and OAuth library boundary; callback tests use local loopback only. CI needs no Google credentials, browser login or external API access. Existing offline tests are preserved.

The user completed local read-only OAuth and reported **two candidates fetched**. Both initially returned REVIEW because `To: Undisclosed recipients:;` was rejected. One supplied original email was replayed offline after the correction and returned **APPROVE with a non-executable approval-reply plan**. The user subsequently supplied successful local output for both real candidates: TEST 001 returned APPROVE with a non-executable plan; TEST 002 returned REJECT/withhold-approval. Both MIME and Groups parsing succeeded. No email was sent in those runs.

The observed format is multipart/mixed: a multipart/alternative notification wrapper plus one inline message/rfc822 original. Gmail's displayed forwarded divider is not present in the raw wrapper. The wrapper's plain/HTML texts differ in predictable link/footer wording; only this explicit template is supported. The original's own plain/HTML content must still agree. Ordinary attachment contents remain excluded, and multiple/nested inline originals fail closed. The regression fixture uses synthetic identities, message IDs and update content; private delivery headers were not committed.

Observed non-private configuration for this test group:

```yaml
group_address: hmm-testing@googlegroups.com
notification_senders:
  - hmm-testing+msgappr@googlegroups.com
subject_contains: 'Google Groups: Message Pending'
gmail_query: 'from:hmm-testing+msgappr@googlegroups.com subject:"Message Pending" newer_than:30d'
```

Keep these settings in the ignored `config/google-groups.local.yaml`; no credentials belong there. The supplied notification has no Reply-To, References or In-Reply-To. The plan therefore targets the outer From and uses the outer pending Message-ID as its reply parent. Its subject includes a pending-message marker and is preserved exactly. The forwarded original identifies the configured group in To. Its original subject literally contains `Subject:`; the parser preserves this text instead of guessing a correction.

The supplied raw headers contain Authentication-Results and Received-SPF reporting passes, a googlegroups.com DKIM signature, and ARC headers. These are observations from pasted input, not independent authentication verification. Private identifiers, signature values and delivery headers are omitted here. Live approval-by-reply behavior remains unverified.

After the local run, record privately for each of the two messages:

| Check | Actual result |
| --- | --- |
| Candidate count | User reported two fetched |
| MIME parsing and Groups parsing | User-supplied live output shows both candidates parsed successfully |
| Original author/subject correct | Both original subjects/authors extracted in user-supplied live output |
| Decision and non-executable plan | TEST 001: APPROVE/approval-reply; TEST 002: REJECT/withhold-approval; neither executed |
| From / Reply-To / Message-ID / References / In-Reply-To / threadId | Pending local inspection |
| Group recipient, delimiter and original-body structure | Pending local inspection |
| Plain/HTML agreement and approval wording | Pending local inspection |
| Authentication-Results, SPF, DKIM and ARC headers | Pending local inspection; not verified |

Milestone 4A read-only audit: this command's Gmail API calls are only GET list and GET RAW. OAuth token exchange/refresh uses Google's authentication endpoints, not mailbox mutation. This command has no send, drafts, modify, delete or Groups mutation capability, no executor, no background loop, and no live Jev dependency. The separate Milestone 4B command adds only a controlled reply send. The installed auth library handles credentials and contains general authenticated HTTP utilities, but those are not exposed as Gmail mutation capabilities by this app. Before any future sending milestone, actual format/approval semantics, sender authentication, threading, authorization and durable deduplication/recovery still need separate validation. This milestone stops at printed plans.
