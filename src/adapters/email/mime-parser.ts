import { observeContent } from "./content-observations.js";
import PostalMime, { addressParser, decodeWords } from "postal-mime";
import { convert } from "html-to-text";
import type { EmailParser, Mailbox, ParsedEmail, RawEmail } from "./types.js";

export const MAX_EMAIL_BYTES = 2 * 1024 * 1024;
const singletonHeaders = new Set(["from", "sender", "to", "cc", "subject", "reply-to", "message-id", "in-reply-to", "references", "date", "content-type", "content-transfer-encoding", "mime-version"]);

/** Strict envelope checks around a deliberately tolerant RFC/MIME library. */
export function readHeaderBlock(text: string): Record<string, string[]> {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text) || /\r(?!\n)/.test(text)) throw new Error("Invalid email header control character");
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const headers: Record<string, string[]> = Object.create(null);
  let current: string | undefined;
  for (const line of lines) {
    if (/^[ \t]/.test(line)) {
      if (!current) throw new Error("Header continuation without a header");
      const values = headers[current]!;
      values[values.length - 1] += ` ${line.trim()}`;
    } else {
      const match = /^([!-9;-~]+):[ \t]*(.*)$/.exec(line);
      if (!match) throw new Error("Malformed email header");
      current = match[1]!.toLowerCase();
      (headers[current] ??= []).push(match[2]!);
      if (singletonHeaders.has(current) && headers[current]!.length > 1) throw new Error(`Duplicate ${current} header`);
    }
  }
  return headers;
}

export function mailboxes(value: string | undefined, allowEmptyGroups = false): Mailbox[] {
  if (value === undefined) return [];
  if (/[\r\n\u0000-\u001f\u007f]/.test(value)) throw new Error("Invalid address header");
  if (/[<>]/.test(value.replace(/<[^<>]*>/g, ""))) throw new Error("Unbalanced mailbox brackets");
  const addresses = addressParser(value);
  if (!addresses.length) throw new Error("Empty address header");
  return addresses.flatMap(address => {
    // Empty RFC recipient groups are valid only in recipient headers, never sender/reply identity.
    if (allowEmptyGroups && address.group?.length === 0) return [];
    if (address.group !== undefined || !address.address || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(address.address)) {
      throw new Error("Unsupported or malformed mailbox");
    }
    const [local, domain] = address.address.split("@");
    if (local!.startsWith(".") || local!.endsWith(".") || local!.includes("..") ||
      domain!.split(".").some(label => label.length > 63 || !/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label))) throw new Error("Malformed mailbox");
    const name = decodeWords(address.name);
    if (/[\r\n\u0000-\u001f\u007f]/.test(name)) throw new Error("Invalid mailbox name");
    return [{ name, address: address.address }];
  });
}

export function singleMailbox(value: string | undefined, label: string): Mailbox {
  const addresses = mailboxes(value);
  if (addresses.length !== 1) throw new Error(`Expected one ${label} mailbox`);
  return addresses[0]!;
}

export function decodedSubject(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const subject = decodeWords(value).trim();
  if (!subject || /[\r\n\u0000-\u001f\u007f]/.test(subject)) throw new Error("Invalid subject");
  return subject;
}

export function messageIds(value: string): string[] {
  const ids = value.match(/<[^<>\s@]+@[^<>\s@]+>/g) ?? [];
  if (!ids.length || value.replace(/<[^<>\s@]+@[^<>\s@]+>/g, "").trim()) throw new Error("Malformed message threading header");
  return ids;
}

export class MimeEmailParser implements EmailParser {
  async parse(raw: RawEmail): Promise<ParsedEmail> {
    return this.parseMessage(raw, 0);
  }

  private async parseMessage(raw: RawEmail, depth: number): Promise<ParsedEmail> {
    if (!raw.id || !raw.source.account || raw.raw.length > MAX_EMAIL_BYTES) throw new Error("Invalid email identity or message exceeds 2 MiB");
    const bytes = Buffer.from(raw.raw);
    // Latin-1 preserves bytes for header structure checks; PostalMime decodes content.
    const separator = /\r?\n\r?\n/.exec(bytes.toString("latin1"));
    if (!separator || separator.index > 64 * 1024) throw new Error("Missing or oversized email headers");
    const headers = readHeaderBlock(bytes.subarray(0, separator.index).toString("utf8"));
    for (const name of ["message-id", "in-reply-to", "references"]) {
      const value = headers[name]?.[0];
      if (value !== undefined && (messageIds(value).length !== 1 && name === "message-id")) throw new Error("Expected one Message-ID");
    }
    const parsed = await PostalMime.parse(bytes, {
      forceRfc822Attachments: true, maxRfc822NestingDepth: 0,
      maxHeadersSize: 64 * 1024, maxNestingDepth: 20, maxPartCount: 100,
    });
    const text = (parsed.text ?? "").replace(/\r\n/g, "\n").trim();
    let htmlText: string | undefined;
    if (parsed.html) {
      htmlText = convert(parsed.html, {
        wordwrap: false,
        limits: { maxInputLength: MAX_EMAIL_BYTES, maxDepth: 100, ellipsis: "[hmm: HTML truncated]" },
        selectors: [
          ...["script", "style", "img", "iframe", "object", "embed"].map(selector => ({ selector, format: "skip" })),
          { selector: "a", options: { ignoreHref: true } },
          { selector: "blockquote", format: "block" },
        ],
      }).trim();
      if (htmlText.includes("[hmm: HTML truncated]")) throw new Error("HTML nesting exceeds supported limit");
    }
    const subject = decodedSubject(headers.subject?.[0]);
    const from = headers.from ? singleMailbox(headers.from[0], "notification sender") : undefined;
    const replyTo = mailboxes(headers["reply-to"]?.[0]);
    if (replyTo.length > 1) throw new Error("Ambiguous Reply-To");
    const result: ParsedEmail = {
      contentObservations: observeContent(parsed.html, parsed.attachments.filter(a => a.mimeType.toLowerCase().startsWith("image/")).map(a => ({
        filename: a.filename, mimeType: a.mimeType.toLowerCase(), disposition: a.disposition?.toLowerCase() ?? null,
        ...(a.contentId ? { contentId: a.contentId } : {}), size: typeof a.content === "string" ? Buffer.byteLength(a.content) : a.content.byteLength,
      }))),
      id: raw.id, source: { ...raw.source }, headers, text: text || htmlText || "",
      to: mailboxes(headers.to?.[0], true), replyTo,
      attachments: parsed.attachments.map(attachment => ({
        filename: attachment.filename, mimeType: attachment.mimeType,
        size: typeof attachment.content === "string" ? Buffer.byteLength(attachment.content) : attachment.content.byteLength,
      })),
      ...(from ? { from } : {}), ...(subject ? { subject } : {}),
      ...(htmlText !== undefined ? { htmlText } : {}),
      ...(raw.threadId !== undefined ? { threadId: raw.threadId } : {}),
    };
    if (headers["message-id"]?.[0]) result.messageId = headers["message-id"][0];
    if (headers["in-reply-to"]?.[0]) result.inReplyTo = headers["in-reply-to"][0];
    if (headers.references?.[0]) result.references = headers.references[0];
    const inline = parsed.attachments.filter(attachment => attachment.mimeType === "message/rfc822" && attachment.disposition === "inline");
    if (inline.length) {
      if (depth !== 0 || inline.length !== 1 || parsed.attachments.length !== 1 || !/^multipart\/mixed(?:;|$)/i.test(headers["content-type"]?.[0] ?? "")) throw new Error("Unsupported or ambiguous inline original message");
      const content = inline[0]!.content;
      if (typeof content === "string") throw new Error("Unsupported inline message encoding");
      result.inlineMessage = await this.parseMessage({ ...raw, raw: new Uint8Array(content) }, depth + 1);
    }
    return result;
  }
}
