# Offline Gmail / Google Groups integration harness

Milestone 3 describes the offline harness. For the subsequent live **read-only** adapter and Desktop OAuth setup, see [Milestone 4A](gmail-readonly-setup.md). Live message-format validation is still pending.

No real Google account is connected. No message can currently be approved through Google. Approval-by-reply is **UNVERIFIED**.

## Boundaries

```text
Fake Gmail JSON or .eml file
            ↓
RawEmail (bytes + source identity)
            ↓
MIME parser → ParsedEmail (headers + readable text)
            ↓
Google Groups parser → Item
            ↓
existing rules → evaluator → policy.ts
            ↓
Decision → ActionPlan (data only, executable: false)
```

Raw email is the exact message bytes from the mail system. Parsed email contains decoded headers and readable body text. The Google Groups parser finds the original member update inside the moderator notification. `Item` is the core's generic representation. `ActionPlan` describes an intended action; it does not perform it. An adapter connects those representations to a particular external format or service.

`RawEmail`, `ParsedEmail`, and Gmail API types live in the adapter layer. The only core addition is `moderateItem`, an entry point for an already normalized `Item`. The existing text parser delegates to it, and the decision algorithm, confidence policy, evaluator contract, timeout handling, and old pipeline are preserved.

The MIME and source parsers implement separate interfaces. `checkEmail` accepts those parsers and an evaluator. There is no executor, notifier, or store argument in this harness: it only returns results and plans. Existing memory storage and the existing general-purpose pipeline are unchanged. A future executor can consume a validated plan, but none exists for Gmail today.

## Verified from documentation

Sources researched on 2026-10-10:

- Google's [official Gmail discovery document](https://github.com/googleapis/google-api-nodejs-client/blob/main/discovery/gmail-v1.json), retrieved through Google's own client repository. This provided the `Message`, `MessagePart`, `ListMessagesResponse`, `users.messages.list`, and `users.messages.get` contracts and explicit threading requirements.
- Postal Systems' [postal-mime documentation](https://github.com/postalsys/postal-mime#readme), and installed 4.0.5 TypeScript declarations: MIME parsing, encoded headers, charset handling, header unfolding, attachment behavior, and resource limits.
- The [html-to-text documentation](https://github.com/html-to-text/node-html-to-text/tree/master/packages/html-to-text): text extraction, entity decoding, element selectors, and conversion limits.

The corresponding Google web pages are [messages](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages), [list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list), [get](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get), and [threads](https://developers.google.com/workspace/gmail/api/guides/threads). Their hosts were blocked by this environment's egress proxy, so the verified Google claims below come from the official discovery document, not a successful read of those web pages.

### Gmail transport

- `users.messages.list` takes `q`, `pageToken`, and `maxResults` (maximum 500). Queries use Gmail search-box syntax. `q` is unavailable with the `gmail.metadata` scope.
- List responses contain message references and an optional `nextPageToken`; listing does not provide the complete message body.
- `users.messages.get` with `format=raw` returns the entire RFC 2822 message in the base64url `raw` field. `format=full` instead uses a parsed MIME `payload`; `metadata` returns headers without body content.
- `Message.id` is the immutable Gmail message ID. `Message.threadId` is a different identifier. The RFC `Message-ID` is a header inside the email and is different again.
- `MessagePart.headers` represents email headers when requesting parsed/metadata formats. This harness deliberately requests RAW and obtains its headers through the MIME boundary; it does not substitute snippets for message bodies.

`GmailClient` exposes only list and get-RAW methods. `FakeGmailClient` reads canned fixture JSON. `GmailTransport` follows pages, checks list/get identity consistency, strictly decodes base64url, and produces transport-neutral bytes. A live client, OAuth, polling, and sending are absent.

### Threading and reply metadata

Google explicitly lists three conditions for adding a message to a thread: supply the requested `threadId`; set `References` and `In-Reply-To` according to RFC 2822; and match `Subject` headers.

The plan therefore preserves the **notification's** subject exactly, uses its RFC Message-ID as `In-Reply-To`, extends its References with that Message-ID, and keeps the Gmail thread ID when available. If References is absent, one existing In-Reply-To parent can be inherited. Multiple ambiguous parents require review. Gmail-origin plans require a thread ID. A file-only fixture has no Gmail thread ID and cannot establish Gmail thread placement.

`Reply-To` supplies the reply recipient when present and unambiguous; otherwise the plan uses the notification's `From`. It never takes a reply address from the member's body or original-author fields. No recipient is synthesized from a group name. This is reply construction, not evidence that the selected address will approve anything.

### Email standards relevant to the boundary

Reference standards are [RFC 5322](https://www.rfc-editor.org/rfc/rfc5322) (headers, mailboxes, folding, reply identification), [RFC 2045](https://www.rfc-editor.org/rfc/rfc2045) (MIME transfer encodings), [RFC 2046](https://www.rfc-editor.org/rfc/rfc2046) (multipart structure), and [RFC 2047](https://www.rfc-editor.org/rfc/rfc2047) (encoded words). RFC 5322 updates RFC 2822, which Gmail's discovery document cites. Direct IETF/RFC-hosted pages were also blocked; MIME behavior was researched through the maintained parser's primary documentation and exercised with the fixtures. This is not a claim of complete RFC conformance validation by hmm.

PostalMime handles MIME boundaries, text/HTML parts, charsets, base64, quoted-printable, and encoded headers. A small validation layer rejects malformed envelope header syntax, duplicates of singleton identity/threading headers, ambiguous mailboxes, and invalid threading IDs. It is not another full MIME parser. Address groups, internationalized mailbox addresses, and complex obsolete header syntax are intentionally outside the initial accepted subset and require review.

## MIME library choice and data handling

`postal-mime` 4.0.5 was selected for its single parse API, bundled TypeScript types, zero dependencies, RFC/MIME features, resource limits, and recent maintenance (release listed on npm as 2026-10-07). It is isolated under `src/adapters/email`.

`html-to-text` 10.0.1 converts HTML into text without a browser. It is a second utility dependency, not a second MIME parser. Its TypeScript declarations come from `@types/html-to-text` (development-only). Scripts, styles, images, embedded objects, and frames are excluded. Link text remains; href-only destinations are not appended. No resource is fetched and no HTML is rendered. This is text extraction, not CSS layout or a guarantee that every client would display identical content.

Plain text is preferred when present. If both alternatives exist and their extracted text differs beyond whitespace, the message requires review. This may reject legitimate formatting differences, but prevents silently accepting conflicting alternatives. HTML-only messages use extracted text.

The raw message limit is 2 MiB; MIME limits are 64 KiB total headers, 20 nesting levels, and 100 parts. The raw input is bounded before MIME parsing. HTML depth truncation fails safely. PostalMime holds messages in memory and decodes attachment transfer bytes internally; hmm retains **only** filename, MIME type, and byte size. It never interprets attachment contents, follows nested attached messages, writes attachments to disk, uploads them, or sends them to an evaluator. Text/plain attachments and message/rfc822 attachments are covered by tests.

## Source parsing and candidate discovery

Use [config/google-groups.example.yaml](../config/google-groups.example.yaml) for the independent email-adapter settings:

```yaml
group_address: team@example.com
notification_senders:
  - team+msgappr@example.com
subject_contains: Message Pending
gmail_query: 'from:team+msgappr@example.com subject:"Message Pending"'
```

These are synthetic addresses, not universal Google sender rules. Discovery queries only select candidates. Every candidate must still pass the header checks, observed moderation preamble, one unambiguous forwarded boundary, original From, original Subject, nonempty original body, and configured group-recipient check. The source parser supports the English inline-forward format supplied in the project brief. It does not search arbitrary message text for a convenient From/Subject pair.

More than one forwarded delimiter requires review, even when a member includes one as a literal example. Quoted or nested forwards, unsupported templates/localizations, missing original metadata, and conflicting alternatives are not guessed. A body-level From line after the original headers remains member content and cannot change the notification sender or reply target.

Header matching is **not sender authentication**. A forged message can imitate headers. No DKIM, SPF, DMARC, or trusted Gmail authentication-result validation has been established here. That remains a prerequisite to any future live approval feature. The fixture parser's success means “matches this supported structure,” not “Google authenticated it.”

## Action plans and stable identities

- `APPROVE`: construct `approval-reply` data if critical reply metadata exists.
- `REJECT`: `withhold-approval`; feedback may be generated in a later feature.
- `REVIEW`: `moderator-review`; no approval reply.
- Content may pass while reply metadata is insufficient. The content decision remains visible, but the action plan requires moderator review and the CLI exits 2.

All plans are `executable: false` and `approvalByReply: UNVERIFIED`. The proposed reply body `Approve.` is a draft convention for human inspection, **not a verified Google command or required token**. No RFC message is transmitted and no send-capable client exists.

An approval ActionId is SHA-256 over the tuple `[transport type, account namespace, moderation notification identity, "approval-reply"]`. Gmail uses its immutable message ID; a file fixture uses the notification's RFC Message-ID. Moving an identical `.eml` to another filename does not change its logical action ID. Different account namespaces avoid cross-mailbox collisions. IDs come from source metadata, never evaluator output. There is no persistent ledger or exactly-once execution guarantee. Cross-transport deduplication (file versus Gmail) is not claimed.

## Running the offline harness

```bash
npm ci
npm test
npm run typecheck
npm run cli -- check-email fixtures/google-groups/plain.eml
npm run cli -- check-email fixtures/google-groups/html-rich.eml
npm run cli -- check-email fixtures/google-groups/vague.eml
npm run cli -- check-email fixtures/google-groups/ambiguous.eml
```

Use `--config` for rules and `--email-config` for discovery/source settings. `check-email` requires `provider: fake`; selecting Jev is rejected before evaluation. Existing `check <text-file>` behavior, including opt-in Jev, remains unchanged. No Google or TypeSafe secret is needed or read for these email checks.

Exit codes: 0 for approval-eligible content with a proposed plan, 1 for rejection, and 2 for parsing/evaluation review or unsafe-to-construct reply metadata. None means an external action occurred.

The `.eml` fixtures and Gmail-shaped JSON are documented in [the fixture index](../fixtures/google-groups/README.md). Automated tests additionally cover header spoof attempts, no URL fetching, no attachment leakage, pagination, malformed transport data, provider failure, stable IDs, and CLI output. All HTTP boundaries in the pre-existing Jev tests remain mocked.

## Requires live test — deliberately not done

- Google's current moderation notification format for the actual group and account, including sender/authentication evidence, localization, and whether Reply-To changes per notification.
- Whether programmatic Gmail reply approves the original pending Groups message, what body (if any) is needed, and which recipient is correct in that template.
- Whether the planned headers and subject place the reply in the intended Gmail thread.
- Gmail authorization and least-privilege access in the real account. A future read-only client needs authorized read access supporting RAW/search; the `gmail.metadata` scope alone cannot provide this workflow. Any future send feature needs separate authorized sending capability. No OAuth flow or account setup is included here.
- Durable action tracking and recovery before any production external effect.

Google's [moderation help page](https://support.google.com/groups/answer/2466386?hl=en) was attempted but blocked by the proxy. The approval-by-reply wording is an observation supplied by the user, not a publicly verified programmatic guarantee. Follow [the disposable-message manual test plan](google-groups-manual-test.md) only in a later, explicitly authorized live-integration milestone.
