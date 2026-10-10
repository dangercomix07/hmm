# Synthetic moderation fixtures

All messages, identities, and content here are invented. These are RFC/MIME messages built around the English inline-forward structure supplied in the project brief. They are not captured Gmail messages and do not establish Google's current production template or approval semantics.

| Fixture | Purpose | Expected offline result |
| --- | --- | --- |
| plain.eml | Plain text notification and original update | APPROVE + non-executable reply plan |
| multipart.eml | Matching plain/HTML alternatives | APPROVE + plan |
| html-only.eml | HTML-only text extraction | APPROVE + plan |
| html-rich.eml | HTML paragraphs, bold headers, and line breaks | APPROVE + plan |
| unicode.eml | Encoded subject/author and UTF-8 | APPROVE + plan |
| quoted-printable.eml | Quoted-printable text | APPROVE + plan |
| base64.eml | Base64 MIME body | APPROVE + plan |
| urls.eml | URLs preserved as text, never fetched | APPROVE + plan |
| folded.eml | Folded notification header | APPROVE + plan |
| attachments.eml | Mixed MIME with plain-text and RFC822 attachments | APPROVE; only attachment metadata retained |
| body-spoof.eml | Body From/Reply-To lines and instructions remain data | APPROVE with fake evaluator; header-derived target unchanged |
| vague.eml | Required semantic demo checks fail | REJECT, no approval reply |
| malformed.eml | Invalid notification header syntax | REVIEW |
| missing-sender.eml | Original From missing | REVIEW |
| ambiguous.eml | Multiple forwarded-message sections | REVIEW |
| delimiter-in-content.eml | Member quotes a literal forwarded delimiter | REVIEW; intentionally conservative |
| ordinary.eml | An ordinary email returned by candidate discovery | REVIEW |

`gmail-messages.json` contains canned Gmail RAW-style responses for plain, vague, and ordinary messages. `id` and `threadId` are fake opaque identifiers. `raw` is base64url of the corresponding `.eml` bytes. The fake client returns these candidates regardless of the query; it records queries and exercises pagination, but does not emulate Gmail's search language.

Expected decisions use the fake evaluator only. It is a pattern-based demo and is not a prompt-injection defense or a real assessment of these messages.

`inline-original.eml` reproduces the structure of a user-observed Google multipart/mixed notification with an empty outer recipient group and one inline RFC822 original. All identities, message IDs and update text are synthetic; no private transport/authentication headers are retained. It is the explicit exception to ordinary attachment-content exclusion. The plain/HTML notification wrappers differ in fixed link/footer wording; the original alternatives agree.


`supervised-nested-auth.eml` is entirely synthetic. It models a Groups outer
multipart/mixed notification, multipart/alternative notice, and inline
message/rfc822 original carrying separate authentication/ARC headers. Domains,
addresses, identifiers and signature values are synthetic; no private headers
were copied. The outer and nested ARC blocks are syntax fixtures, not valid
cryptographic signatures. This tests explicit supervised compatibility, never
TRUSTED authentication.
