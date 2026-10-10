import type { ContentObservations } from "../../domain/content-observations.js";
import type { Item } from "../../domain/item.js";

/** Bytes and identity from a transport, without any Gmail API response objects. */
export interface RawEmail {
  id: string;
  threadId?: string;
  source: { type: "file" | "gmail"; account: string };
  raw: Uint8Array;
}

export interface Mailbox { name: string; address: string }
export interface AttachmentMetadata { filename: string | null; mimeType: string; size: number }

/** Decoded text only: raw HTML and attachment contents never leave the MIME adapter. */
export interface ParsedEmail {
  contentObservations?: ContentObservations;
  id: string;
  threadId?: string;
  source: RawEmail["source"];
  headers: Record<string, string[]>;
  from?: Mailbox;
  to: Mailbox[];
  replyTo: Mailbox[];
  subject?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  text: string;
  htmlText?: string;
  attachments: AttachmentMetadata[];
  /** One bounded inline RFC822 candidate; accepted only by an explicit source format. */
  inlineMessage?: ParsedEmail;
}

export interface ModerationEmail {
  notification: ParsedEmail;
  moderationMessageId: string;
  groupAddress: string;
  item: Item;
  replyApprovalMentioned: boolean;
}

export interface EmailParser { parse(raw: RawEmail): Promise<ParsedEmail> }
export interface ModerationParser { parse(email: ParsedEmail): Promise<ModerationEmail> }
