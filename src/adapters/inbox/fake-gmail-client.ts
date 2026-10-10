import { readFile } from "node:fs/promises";
import type { GmailClient, GmailListPage, GmailMessage } from "./gmail-client.js";

/** Canned search candidates, not an emulator of Gmail's query language. */
export class FakeGmailClient implements GmailClient {
  readonly searches: Parameters<GmailClient["listMessages"]>[0][] = [];
  readonly gets: string[] = [];
  constructor(private readonly messages: GmailMessage[]) {}
  static async fromFixture(path: string): Promise<FakeGmailClient> {
    const messages: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!Array.isArray(messages) || !messages.every(message => message && typeof message.id === "string" && typeof message.raw === "string" && (message.threadId === undefined || typeof message.threadId === "string"))) throw new Error("Invalid fake Gmail fixture");
    return new FakeGmailClient(messages);
  }
  async listMessages(request: Parameters<GmailClient["listMessages"]>[0]): Promise<GmailListPage> {
    this.searches.push(structuredClone(request));
    const offset = request.pageToken === undefined ? 0 : Number(request.pageToken);
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(request.maxResults) || request.maxResults < 1) throw new Error("Invalid fake Gmail page request");
    const messages = this.messages.slice(offset, offset + request.maxResults).map(({ id, threadId }) => ({ id, ...(threadId !== undefined ? { threadId } : {}) }));
    const next = offset + messages.length;
    return { messages, ...(next < this.messages.length ? { nextPageToken: String(next) } : {}) };
  }
  async getMessage(id: string, options: { format: "raw" }): Promise<GmailMessage> {
    if (options.format !== "raw") throw new Error("Only RAW fixtures are supported");
    this.gets.push(id);
    const message = this.messages.find(candidate => candidate.id === id);
    if (!message) throw new Error("Fake Gmail message not found");
    return structuredClone(message);
  }
}
