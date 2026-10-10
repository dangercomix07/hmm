# Configuration files

Run from the repository root:

```powershell
npm run config:check
```

This validates every YAML file in this directory using its current loader,
including ignored local files when present, and checks the live group/reply
allow-lists agree. It is offline, does not inspect credentials, and changes no
files. A missing local pair is reported explicitly; it does not invalidate the
shipped offline examples. The audit proves schema compatibility, not Gmail access,
notification authenticity or publication status.

| File | Purpose |
| --- | --- |
| work-updates-101.yaml | Fixed deterministic profile for moderate-gmail; provider none |
| team-update.yaml | Default offline text check profile; requires Progress and Next steps |
| example.yaml | Legacy fake demo, default for approve-test and gmail-check |
| jev.example.yaml | Explicit opt-in Jev example; not used by moderate-gmail |
| google-groups.example.yaml | Synthetic offline fixture group |
| google-groups.local.example.yaml | Observed disposable live test-group settings; 24-hour query |
| gmail-sending.local.example.yaml | Sending schema; sending and auth exception disabled by default |
| google-groups.local.yaml | Ignored user-owned live group/query settings |
| gmail-sending.local.yaml | Ignored user-owned supervised sending settings |

The different rule profiles have different purposes; they should not be made
identical. Rule-config dry_run does not replace the separate interactive
supervised sending guards. The supervised command always requires its explicit
sending configuration, authentication check/exception, confirmation and ledger.

## Updating existing local files on your PC

Git pull updates examples, **not** ignored local YAML. Do not copy the example
over an existing local file blindly: doing so would reset intentional settings.

For the currently tested disposable group, compare your local group file with:

```yaml
group_address: hmm-testing@googlegroups.com
notification_senders:
  - hmm-testing+msgappr@googlegroups.com
subject_contains: Message Pending
gmail_query: 'from:hmm-testing+msgappr@googlegroups.com subject:"Message Pending" newer_than:1d'
```

Your intentionally enabled supervised test sending file should contain:

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

These two true flags are intentional local opt-ins; the tracked sending example
keeps them false. Omission of the authentication exception means false.
Changing the query to 1d limits discovery to the last 24 hours, which can still
include old test notifications from that period. Search does not establish that
a post remains pending. Keep .hmm/actions intact for duplicate protection.

No email address belonging to the moderator, OAuth token, client secret or
password belongs in these YAML files. Existing OAuth paths and scopes are unchanged.
