# Gmail OAuth setup and read-only diagnostics

For the current workflow, follow [supervised moderation](supervised-moderation.md).
Both commands reuse the same desktop client and token.

## Google setup on your PC

1. Select a Google Cloud project and enable Gmail API.
2. Configure Google Auth Platform. For personal Gmail use External, keep Testing,
   and add the moderator account under Audience / Test users.
3. Add gmail.readonly under Data Access. For supervised approval also add
   gmail.send. No modify, compose or broader mailbox scope is needed.
4. Create a Desktop app OAuth client. Save its JSON as .secrets/gmail-desktop.json
   in your checkout. Never paste credentials into chat or Git.
5. Prepare local YAML using [the configuration reference](../config/README.md).
   The current example uses observed disposable-group settings and a 1d search.

Adding a send scope does not require a new client or JSON download. Run:

~~~powershell
npm run cli -- moderate-gmail --reauthorize
~~~

Consent opens on your PC with an ephemeral 127.0.0.1 callback, state and PKCE.
If no browser opens, use the displayed URL on the same PC. Refresh tokens are
saved in .tokens/gmail.json; access tokens remain in memory. Scopes and client
identity are checked. Mailbox identity comes from the Gmail profile;
reauthorization does not change source-based ActionIds.

## Read-only diagnostic

~~~powershell
npm run cli -- gmail-check --inspect
~~~

This diagnostic uses the fake demo evaluator, not WORK UPDATES 101.
It only lists/reads Gmail and shows non-executable plans, even when a saved token
also grants gmail.send. It cannot send, draft, mark read, modify or delete.
Inspection output can contain private headers and identifiers; keep it local.

Testing-mode grants can expire. Use reauthorization for supervised use and check
API enablement, test-user account and project. Tokens are plaintext credentials
protected by filesystem permissions/Windows ACLs. Deleting a token file does not
revoke Google's grant; revoke at https://myaccount.google.com/permissions if needed.
Do not delete .hmm/actions when reauthorizing.

Zero results are not proof of integration success. Test the query in Gmail.
A notification does not establish current Groups pending status. Unsupported
formats remain REVIEW, and observed authentication headers alone are not TRUSTED.
Read-only exit codes: 0 no rejection/review (including zero candidates), 1 any
rejection, 2 any review/error.

Official references:
[Desktop OAuth](https://developers.google.com/identity/protocols/oauth2/native-app),
[Gmail list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list),
[Gmail RAW](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get),
[Google Auth Library](https://github.com/googleapis/google-auth-library-nodejs).
