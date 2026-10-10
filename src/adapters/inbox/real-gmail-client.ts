import type { GmailClient, GmailListPage, GmailMessage } from "./gmail-client.js";

export type AccessTokenProvider = () => Promise<string>;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value);

/** Only two Gmail GET endpoints. No generic authenticated request or mutation port. */
export class RealGmailClient implements GmailClient {
  constructor(private readonly token: AccessTokenProvider, private readonly fetcher: typeof fetch = fetch) {
    if (typeof token !== "function" || typeof fetcher !== "function") throw new Error("Invalid Gmail client initialization");
  }
  async #read(path: string, query: URLSearchParams): Promise<unknown> {
    try {
      const token = await this.token();
      if (!token) throw new Error();
      const response = await this.fetcher(`https://gmail.googleapis.com/gmail/v1/users/me/messages${path}?${query}`, {
        method: "GET", headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error();
      return await response.json();
    } catch {
      // Google/HTTP errors may contain request headers, tokens or private response bodies.
      throw new Error("Gmail read failed. Check authorization, Gmail API enablement and connectivity; no automatic retry was attempted.");
    }
  }
  async listMessages(request: { q: string; pageToken?: string; maxResults: number }): Promise<GmailListPage> {
    if (!request.q.trim() || !Number.isInteger(request.maxResults) || request.maxResults < 1 || request.maxResults > 500 || (request.pageToken !== undefined && !request.pageToken.trim())) throw new Error("Invalid Gmail list request");
    const query = new URLSearchParams({ q: request.q, maxResults: String(request.maxResults) });
    if (request.pageToken !== undefined) query.set("pageToken", request.pageToken);
    const data = await this.#read("", query);
    if (!object(data) || (data.messages !== undefined && !Array.isArray(data.messages)) || (data.nextPageToken !== undefined && (typeof data.nextPageToken !== "string" || !data.nextPageToken.trim()))) throw new Error("Malformed Gmail list response");
    const messages = (data.messages ?? []) as unknown[];
    return { messages: messages.map(value => {
      if (!object(value) || !id(value.id) || !id(value.threadId)) throw new Error("Malformed Gmail message reference");
      return { id: value.id, threadId: value.threadId };
    }), ...(data.nextPageToken !== undefined ? { nextPageToken: data.nextPageToken as string } : {}) };
  }
  async getMessage(messageId: string, options: { format: "raw" }): Promise<GmailMessage> {
    if (!id(messageId) || options.format !== "raw") throw new Error("Invalid Gmail RAW request");
    const data = await this.#read(`/${encodeURIComponent(messageId)}`, new URLSearchParams({ format: "raw" }));
    if (!object(data) || data.id !== messageId || !id(data.threadId) || typeof data.raw !== "string" || !data.raw) throw new Error("Malformed Gmail RAW response");
    return { id: messageId, threadId: data.threadId, raw: data.raw };
  }
}
