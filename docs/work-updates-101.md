# WORK UPDATES 101 deterministic checks

This profile implements only the six requirements supplied in the WORK UPDATES 101 task brief.
It does not infer other writing rules. It requires no service, account, API key or semantic evaluator.

## Use

```powershell
npm run cli -- check .\fixtures\ameya-test.txt --config config/work-updates-101.yaml
```

Both `.txt` and `.md` work. A Progress heading is not required. For example, this passes:

```text
Worked on the project today.

Next steps:
Continue tomorrow.
```

Passing means only that the configured deterministic checks passed. It does not establish
technical correctness, truth, quality, meaningful progress or engineering completeness.
This profile does not judge whether “Continue tomorrow” is a good plan.

The default `check` profile remains `config/team-update.yaml`. Select the WORK UPDATES profile
explicitly. The older profile and its stricter section/placeholder behavior are unchanged.

For a supported Google Groups notification saved as an `.eml` file, use the existing offline path:

```bash
npm run cli -- check-email fixtures/work-updates-101/groups-inline-matched.eml --config config/work-updates-101.yaml
```

`check-email` now accepts `provider: none` as well as fake. It still rejects network evaluators and
never sends. Gmail read/approval command restrictions are unchanged. Raw standalone-email fixtures
are tested through the MIME adapter; `check-email` still expects a supported Groups wrapper.

## Six requirements

| Requirement | Implementation | Clear failure |
| --- | --- | --- |
| Usable body | `usable_body` | No letter/number text remains after headings, empty formatting and recognizable quoted history are excluded from the inspection view |
| Future work present | `required_section` + `nonempty_section` | Next-step section absent or empty |
| Required content not placeholder-only | `usable_body.phrases` + section-scoped `forbidden_placeholder` | Entire body or required next-step content contains only configured placeholders |
| Inline code limit | `inline_code_limit` | A complete, clearly delimited code block exceeds `max_lines` |
| No previous-thread history | `no_quoted_history` | Recognizable reply/forward history remains |
| Inline images also attached | `inline_image_attachments` | A clearly identified inline image has no corresponding attached image file |

Empty text rejects under this profile. It does not change the older parser behavior for profiles
without `usable_body`. Sanity checking is not a judgment about technical usefulness.
The original Item body stays available; checks derive inspection views without rewriting it.
Raw `.eml` input remains the source for diagnostics. No attachment bytes are added to Item metadata.

### Sections and placeholders

`preamble: allow` permits ordinary text before headings. Configure next-step aliases in `sections`.
The example accepts Next steps, Future work, Next actions, Plan and Up next, ignoring case.
Other section parsing rules remain deterministic: malformed/duplicate headings require review.
There is no prescribed verb, number, grammar or exact prose template.

The configured phrases are TBD, TODO, Will update later, Nothing yet, Same as before and No update.
They apply to the required next-step section and to a body that is entirely placeholder content.
`mixed_action: ignore` means a phrase mixed with other content does not fail or trigger semantic
judgment. The older profile retains its default `mixed_action: review` behavior.

None and N/A are not globally forbidden. Blockers is optional and “Blockers: None” is valid.
Teams may add a phrase to a particular section's list if their policy requires that restriction.

### Code counting

Backtick and tilde fences are supported. Each complete block is checked separately; twelve
one-line blocks do not count as one twelve-line block. CRLF is normalized for counting. Fences
and their language labels do not count as code lines. Lines between the fences, including blank
lines, count. HTML `<pre>` blocks are also counted; one boundary newline is excluded at either end.
Single-line backtick spans do not exceed a ten-line limit. Unclosed fences, unmatched/multiline
backtick spans, indented code-like text and ambiguous multiline HTML `<code>` produce REVIEW.
Code relevance and language syntax are never evaluated.

### Quoted history

Clear signals include Gmail `gmail_quote`/Yahoo `yahoo_quoted` HTML classes, HTML
`blockquote type="cite"`, an `On … wrote:` line followed by quoted lines, and a forwarded/original
message separator followed by From, To and Subject/Date/Sent envelope fields.
Generic blockquotes, plain `>` quotations or incomplete reply markers produce REVIEW. A quotation
may be a useful diagnostic excerpt; the rule does not assume it is previous-thread history.
Plain-text quote samples inside fenced code are not classified as reply history.
These are supported structural patterns, not a complete detector for every email client's history.

### Images and attachments

The MIME adapter records image/* parts, disposition, Content-ID, filename and size. It records
HTML img references without fetching them. Only parts explicitly marked `attachment` with
nonzero size satisfy the attached-file side. An inline-disposition part alone is not enough.
A part marked attachment and referenced by CID may satisfy both roles because the attached file
is explicitly available. Other dispositions or unresolved CID relationships require review.

Matching consumes attachments one-to-one:

1. Exact, case-sensitive filename match when exposed.
2. Clear Content-ID relationship.
3. Count fallback only when the unmatched inline and attached parts have no usable filenames/CIDs.

Repeated references to the same HTML source count once. Multiple candidate matches, repeated inline
filenames, duplicate/missing CID relationships, unknown dispositions or insufficient source
provenance produce REVIEW. Unequal known filenames do not become a count-based match. Extra
attachments are allowed. Remote/data images with no attachment fail; with uncertain pairing they
require review. Metadata matching does not prove byte identity or image meaning.

Plain `.txt`/`.md` inputs do not provide MIME attachment facts. Image syntax there produces REVIEW;
no image syntax passes the image rule. Use the MIME path when checking image attachment coverage.
Google Groups' supported inline RFC822 original supplies member-only facts. Wrapper logos and the
wrapper's own forwarded envelope are not treated as member content. The older text-forward format
cannot safely bind outer MIME observations to the member body; relevant observations require review.

No remote image loading, OCR, plot/caption/axis inspection, semantic scoring or file upload occurs.

## Decisions, configuration and limits

A required definite violation uses the existing fail-required policy (REJECT in this example).
Ambiguity produces REVIEW. Existing policy gives uncertainty precedence when an update has both
an ambiguous result and a failure. Neither state allows execution.

Change aliases, phrase lists and `max_lines` in your copied profile. Remove or make the image rule
optional to change that requirement. Invalid names, actions and numeric limits fail configuration
validation. A required `section_structure` check remains part of section-profile validation.
No arbitrary regex configuration is added.

The implementation adds no grammar, vagueness, truth, progress-quality, numeric-result, prescribed-
verb or conciseness checks. No Gmail authentication, action identity, ledger, uncertainty, retry or
send logic is changed. No scheduler, worker, automatic approval or rejection email is added.

## Offline fixtures

`fixtures/work-updates-101` contains synthetic text and MIME examples. The image payloads are dummy
bytes, not real pictures: the tests intentionally exercise metadata only. The fixtures include
10/11-line code boundaries, clear/ambiguous quotes, single/multiple/missing/ambiguous attachments,
no images, and complete Groups-wrapper integration. All tests run behind the existing outbound
network guard. No private message, credential or live service is used.

## Completion record

Base: `milestone5b-deterministic-product` at `a6648d0`. Work branch:
`work-updates-101-deterministic`. The historical branches and main are unchanged.

Validation: 269 tests passed, 0 failed, 0 skipped (242 baseline plus 27 new tests).
`npm run typecheck` and `git diff --check` passed. The offline text CLI smoke check passed.
Eighteen focused text/MIME fixtures cover the requested cases and HTML/Groups integration.
No dependency was added. No live Gmail, Groups, Jev or other product service was called.
No scheduler, background worker, automatic approval/rejection, authentication or send change
was made. Work stops at this deterministic rule layer; Gmail ingress work has not begun.
