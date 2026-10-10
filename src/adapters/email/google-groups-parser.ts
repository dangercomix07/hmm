import type { Item } from "../../domain/item.js";
import type { GoogleGroupsConfig } from "./google-groups-config.js";
import { decodedSubject, mailboxes, readHeaderBlock, singleMailbox } from "./mime-parser.js";
import type { ModerationEmail, ModerationParser, ParsedEmail } from "./types.js";

const delimiter = /^\s*(?:>\s*)*-{5,}\s*Forwarded message\s*-{5,}\s*$/gim;
const normalize = (text: string): string => text.replace(/\s+/g, " ").trim();

/** Supports the observed English inline-forward structure, not every Groups template. */
export class GoogleGroupsParser implements ModerationParser {
  constructor(private readonly config: GoogleGroupsConfig) {}

  async parse(email: ParsedEmail): Promise<ModerationEmail> {
    if (!email.from || !this.config.notification_senders.some(sender => sender.toLowerCase() === email.from!.address.toLowerCase())) throw new Error("Notification sender does not match configuration");
    if (!email.subject?.toLowerCase().includes(this.config.subject_contains.toLowerCase())) throw new Error("Not a configured moderation notification subject");
    if (!email.messageId) throw new Error("Notification Message-ID is missing");
    if (email.inlineMessage) return this.parseInlineMessage(email);
    if (email.htmlText !== undefined && normalize(email.text) !== normalize(email.htmlText)) throw new Error("Plain text and HTML alternatives disagree");
    const sections = [...email.text.matchAll(delimiter)];
    if (sections.length !== 1 || sections[0]![0].trim().startsWith(">")) throw new Error("Missing or ambiguous forwarded-message boundary");
    const boundary = sections[0]!;
    const prelude = email.text.slice(0, boundary.index);
    if (!/A message has been sent to the .+? group and is awaiting approval\./i.test(prelude) || !/The message requires moderation because\b/i.test(prelude)) throw new Error("Unrecognized moderation notification text");
    const forwarded = email.text.slice(boundary.index! + boundary[0].length).trimStart();
    const separator = /\n\n/.exec(forwarded);
    if (!separator) throw new Error("Original message headers/body boundary missing");
    const headers = readHeaderBlock(forwarded.slice(0, separator.index));
    if (Object.keys(headers).some(key => !["from", "to", "cc", "date", "subject", "reply-to", "message-id"].includes(key))) throw new Error("Unsupported original message header");
    const author = singleMailbox(headers.from?.[0], "original sender");
    const recipients = mailboxes(headers.to?.[0]);
    const group = recipients.filter(recipient => recipient.address.toLowerCase() === this.config.group_address.toLowerCase());
    if (group.length !== 1) throw new Error("Original recipient does not identify the configured group");
    if (headers.cc) mailboxes(headers.cc[0]);
    const subject = decodedSubject(headers.subject?.[0]);
    if (subject === undefined) throw new Error("Original subject is missing");
    const body = forwarded.slice(separator.index + separator[0].length).trim();
    if (!body) throw new Error("Original body is missing");
    const moderationMessageId = email.source.type === "gmail" ? email.id : email.messageId;
    const item: Item = {
      id: moderationMessageId, author: { name: author.name, email: author.address }, subject, body,
      source: { type: "google-groups", messageId: moderationMessageId },
    };
    // Invalid dates are not guessed; submission time remains optional.
    if (headers.date?.[0]) {
      const date = new Date(headers.date[0]);
      if (!Number.isNaN(date.getTime())) item.submittedAt = date;
    }
    return { notification: email, moderationMessageId, groupAddress: group[0]!.address, item,
      replyApprovalMentioned: /you can approve this message by replying to this email\./i.test(prelude) };
  }

  /** Observed Google multipart/mixed notification with a single inline RFC822 original. */
  private parseInlineMessage(email: ParsedEmail): ModerationEmail {
    const original = email.inlineMessage!;
    const groupName = this.config.group_address.split("@")[0]!;
    const intro = `A message has been sent to the ${groupName} group and is awaiting approval. We've included this message for your review.`;
    const plain = normalize(email.text);
    const ending = `You can approve or reject this message online at: https://groups.google.com/group/${groupName}/pendmsg or You can approve this message by replying to this email.`;
    if (!plain.startsWith(intro + " ") || !plain.endsWith(" " + ending)) throw new Error("Unrecognized inline moderation notification text");
    const reason = plain.slice(intro.length + 1, -ending.length - 1);
    if (!/^The message requires moderation because [^.]+\.$/.test(reason)) throw new Error("Unrecognized inline moderation reason");
    const expectedHtml = `${intro} ${reason} You can approve or reject this message or you can approve this message by replying to this email. Start your own group, visit the help center, or report abuse.`;
    if (email.htmlText === undefined || normalize(email.htmlText) !== expectedHtml) throw new Error("Unrecognized or conflicting inline notification HTML alternative");
    if (original.inlineMessage) throw new Error("Nested original messages are not supported");
    if (original.htmlText !== undefined && normalize(original.text) !== normalize(original.htmlText)) throw new Error("Original plain text and HTML alternatives disagree");
    if (!original.from || !original.subject || !original.text.trim()) throw new Error("Original sender, subject or body is missing");
    const group = original.to.filter(recipient => recipient.address.toLowerCase() === this.config.group_address.toLowerCase());
    if (group.length !== 1) throw new Error("Original recipient does not identify the configured group");
    const moderationMessageId = email.source.type === "gmail" ? email.id : email.messageId!;
    const item: Item = { id: moderationMessageId, author: { name: original.from.name, email: original.from.address },
      subject: original.subject, body: original.text, source: { type: "google-groups", messageId: moderationMessageId } };
    if (original.headers.date?.[0]) {
      const date = new Date(original.headers.date[0]);
      if (!Number.isNaN(date.getTime())) item.submittedAt = date;
    }
    return { notification: email, moderationMessageId, groupAddress: group[0]!.address, item, replyApprovalMentioned: true };
  }

}
