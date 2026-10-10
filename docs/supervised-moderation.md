# Supervised Gmail moderation

Run from the repository root on your own computer:

```powershell
git fetch origin
git switch minimal-live-moderation
git pull --ff-only origin minimal-live-moderation
npm ci
npm run cli -- moderate-gmail
```

Use the existing desktop OAuth JSON at `.secrets/gmail-desktop.json` and token
at `.tokens/gmail.json`. The same OAuth client works; a new download is not
needed merely to grant another scope. This command requests only
`gmail.readonly` and `gmail.send`. Use `--reauthorize` if you need a fresh
consent screen. No Jev key or semantic service is used.

Keep your existing `config/google-groups.local.yaml` with the observed
notification sender, subject filter, query, and explicit group binding.
Use a narrow query for the disposable hmm-testing group first. Search results
are candidates, not proof that a post is still pending.

Keep `config/gmail-sending.local.yaml` with these explicit settings for that
test group (do not overwrite other local configuration without inspecting it):

```yaml
sending:
  enabled: true
  test_only: true
  test_only_allow_unverified_authentication: true
  allowed_groups:
    - hmm-testing@googlegroups.com
  allowed_reply_addresses:
    - hmm-testing+msgappr@googlegroups.com
```

The authentication exception is intentional and defaults false in the example.
hmm cannot yet prove provenance of Gmail's authentication headers. The exception
keeps trust INDETERMINATE, warns visibly, and only admits the existing
compatibility cases; failed, contradictory or malformed authentication still
blocks. It is not suitable for unattended operation.

The command displays each original update, its source identity, all deterministic
checks and APPROVE/REJECT/REVIEW. Source lines are quoted to prevent message content
from impersonating terminal prompts. It always loads
`config/work-updates-101.yaml` with provider none; there is no evaluator override.
Passing checks does not establish meaningful progress or truth.

For an APPROVE it reads the selected message again, requires identical raw
content, mailbox/message/thread identity and regenerated action plan, and repeats
parsing, rules, authentication and allow-list checks. The exact recipient,
reply subject, thread, references and body appear before the prompt.
Type **APPROVE TEST** exactly to send that one reply. Anything else cancels.
Each candidate needs a separate confirmation. REJECT and REVIEW never prompt or
send and remain pending. There is no force approval.

The existing executor atomically reserves the action **after confirmation,
before sending**. This preserves cancellation without burning a permanent
reservation. A concurrent session cannot acquire the same reservation. Every
existing ledger state, including FAILED_SAFE, suppresses another offer; legacy
or partial reservations also suppress confirmation. Reservation is still checked
atomically at the executor. Keep `.hmm/actions` intact on this
computer. It does not coordinate a second computer with a separate ledger.

A send timeout stops the session with UNCERTAIN; there is no retry. A failed
receipt save or unexpected returned thread also stops for manual reconciliation.
Gmail SENT does not prove Groups publication. Check the group manually.
Normal completion makes one finite discovery pass; there is no polling or daemon.
Authentication, changed-message, ledger and send errors stop the session safely;
inspect the reported problem before starting again.

## Disposable-group acceptance test

Create three new posts from an account whose posts require moderation. Do not
reuse a notification already approved in an earlier milestone.

A — expected APPROVE:

```text
Reproduced the reset.
Future work:
Inspect the trace.
```

B — expected REJECT (missing next steps):

```text
Reproduced the reset.
```

C — expected REVIEW (ambiguous quotation):

```text
Reproduced the reset.
Next steps:
Inspect the trace.
> A generic quotation
```

Run the command, inspect all three decisions, and confirm only A. Verify A appears
in Google Groups and B/C remain pending; inspect Sent for exactly one approval
reply. Re-run: A must show SENT and must not offer a second send. Do not delete its
ledger to repeat the test. Record observations in the completion record without
private email headers, tokens or bodies. Disable sending again when finished
if you do not want the command available for further supervised tests.

## Configuration audit and terminal layout

Run `npm run config:check` after updating. It checks tracked examples and any
local YAML present using the current schemas. See
[the configuration reference](../config/README.md) for the current local settings.
Examples now use the observed disposable-group sender and a one-day search;
existing ignored local files must be edited on your own PC.

The CLI separates numbered candidates, quoted source text, checks and action
results with blank lines. PASS rows show short labels; failures retain their
explanations without a duplicate reasons list. Exact reply details, authentication
warnings and per-message confirmation remain visible. Send receipts are displayed
as readable fields rather than a single JSON line.
