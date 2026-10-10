import type { RawEmail } from "../email/types.js";
import { MAX_EMAIL_BYTES } from "../email/mime-parser.js";
import type { GmailClient, GmailMessage } from "./gmail-client.js";

export function normalizeGmailMessage(message: GmailMessage, account: string): RawEmail {
  if (!account.trim() || typeof message.id !== "string" || !message.id.trim() || typeof message.raw !== "string" || !message.raw ||
    (message.threadId !== undefined && (typeof message.threadId !== "string" || !message.threadId.trim()))) throw new Error("Invalid Gmail message identity or raw data");
  const encoded = message.raw;
  if (encoded.length > Math.ceil(MAX_EMAIL_BYTES / 3) * 4 || !/^[A-Za-z0-9_-]+={0,2}$/.test(encoded)) throw new Error("Invalid or oversized Gmail base64url data");
  const raw = Buffer.from(encoded, "base64url");
  const canonical = raw.toString("base64url");
  if (canonical !== encoded.replace(/=+$/, "") || (encoded.includes("=") && encoded.length % 4 !== 0) || raw.length > MAX_EMAIL_BYTES) throw new Error("Malformed Gmail base64url data");
  return { id: message.id, source: { type: "gmail", account }, raw,
    ...(message.threadId !== undefined ? { threadId: message.threadId } : {}) };
}

export class GmailTransport {
  constructor(private readonly client: GmailClient, private readonly account: string) {}
  async discover(query: string, pageSize = 100): Promise<RawEmail[]> {
    if (!query.trim() || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500) throw new Error("Invalid Gmail discovery request");
    const results: RawEmail[] = [];
    const ids = new Set<string>();
    const tokens = new Set<string>();
    let pageToken: string | undefined;
    do {
      const page = await this.client.listMessages({ q: query, maxResults: pageSize, ...(pageToken !== undefined ? { pageToken } : {}) });
      for (const reference of page.messages ?? []) {
        if (!reference.id || ids.has(reference.id)) throw new Error("Missing or duplicate Gmail message ID");
        if (results.length >= 1000) throw new Error("Gmail discovery batch exceeds 1000 messages");
        ids.add(reference.id);
        const message = await this.client.getMessage(reference.id, { format: "raw" });
        if (message.id !== reference.id || (reference.threadId !== undefined && message.threadId !== reference.threadId)) throw new Error("Gmail get response does not match list identity");
        results.push(normalizeGmailMessage(message, this.account));
      }
      pageToken = page.nextPageToken;
      if (pageToken !== undefined) {
        if (!pageToken || tokens.has(pageToken) || tokens.size >= 1000) throw new Error("Invalid or repeated Gmail page token");
        tokens.add(pageToken);
      }
    } while (pageToken !== undefined);
    return results;
  }
}
