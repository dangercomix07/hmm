/** Minimal subset of the official Gmail users.messages list/get RAW contract. */
export interface GmailMessage { id: string; threadId?: string; raw: string }
export interface GmailListPage { messages?: { id: string; threadId?: string }[]; nextPageToken?: string }
export interface GmailClient {
  listMessages(request: { q: string; pageToken?: string; maxResults: number }): Promise<GmailListPage>;
  getMessage(id: string, options: { format: "raw" }): Promise<GmailMessage>;
}
// A live client and OAuth are intentionally not implemented.
