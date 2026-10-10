# WORK UPDATES 101 fixtures

Synthetic text and MIME fixtures only. Dummy image bytes test classification and matching,
not image contents. No image URL is fetched. No private messages or credentials are present.

- valid-concise, blockers-none, code-ten: APPROVE.
- missing-next, placeholder-next, code-eleven, quoted-gmail: REJECT.
- ambiguous-quote: REVIEW.
- inline-matched, inline-multiple, no-images: APPROVE.
- inline-missing, html-quoted, html-code-eleven: REJECT.
- inline-ambiguous, html-ambiguous-quote: REVIEW.
- groups-inline-matched and groups-inline-missing wrap member MIME messages in the supported
  Google Groups notification format. They produce APPROVE and REJECT respectively, with no send.

Use `config/work-updates-101.yaml`. Standalone MIME fixtures run through the MIME adapter in tests;
`check-email` expects the Groups wrapper. See `docs/work-updates-101.md` for limits.
