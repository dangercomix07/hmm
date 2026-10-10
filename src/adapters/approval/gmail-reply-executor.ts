import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { messageIds, singleMailbox } from "../email/mime-parser.js";
import type { ApprovalReplyPlan } from "./email-action-plan.js";
import type { EmailReplyExecutor, ReplyExecutionResult } from "../../ports/email-reply-executor.js";
import type { AccessTokenProvider } from "../inbox/real-gmail-client.js";

const gmailId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value);
function bareAddress(value: string): string {
  if (singleMailbox(value, "reply").address !== value) throw new Error("Reply requires a bare mailbox address");
  return value;
}
function safeHeader(value: string): void {
  if (!value || /[\u0000-\u001f\u007f-\u009f]/.test(value)) throw new Error("Invalid reply header");
}
function checkedIds(value: string): void {
  safeHeader(value);
  if (!/^[\x20-\x7e]+$/.test(value) || messageIds(value).length !== 1 || messageIds(value)[0] !== value) throw new Error("Invalid reply threading ID");
  bareAddress(value.slice(1, -1));
}
/** Validate before confirmation as well as at the executor boundary. */
export function validateReplyPlan(plan: ApprovalReplyPlan): void {
  if (!/^[a-f0-9]{64}$/.test(plan.actionId) || !gmailId(plan.moderationMessageId) || !gmailId(plan.threadId)) throw new Error("Missing or invalid reply action/Gmail identity");
  bareAddress(plan.targetReplyAddress); safeHeader(plan.subject); checkedIds(plan.inReplyTo);
  if (!Array.isArray(plan.references) || !plan.references.length || plan.references.length > 100 || !plan.references.includes(plan.inReplyTo)) throw new Error("Missing or invalid reply References");
  plan.references.forEach(checkedIds);
  if (plan.body !== "Approve.") throw new Error("Controlled test reply body must be Approve.");
}
function encodeSubject(subject: string): string {
  // RFC 2047 encoded words, each <= 72 characters, split only between Unicode codepoints.
  const chunks: string[] = []; let chunk = "";
  for (const character of subject) {
    if (Buffer.byteLength(chunk + character, "utf8") > 42) { chunks.push(chunk); chunk = ""; }
    chunk += character;
  }
  if (chunk) chunks.push(chunk);
  return chunks.map(part => `=?UTF-8?B?${Buffer.from(part).toString("base64")}?=`).join("\r\n ");
}
export function buildReplyRfc(plan: ApprovalReplyPlan, sender: string): string {
  validateReplyPlan(plan); bareAddress(sender);
  const subject = /^[\x20-\x7e]+$/.test(plan.subject) && plan.subject.length < 900 ? plan.subject : encodeSubject(plan.subject);
  const lines = [
    `From: ${sender}`, `To: ${plan.targetReplyAddress}`, `Subject: ${subject}`,
    `Date: ${new Date().toUTCString()}`, `Message-ID: <${randomUUID()}@${sender.split("@")[1]}>`,
    `In-Reply-To: ${plan.inReplyTo}`, `References: ${plan.references.join("\r\n ")}`,
    "MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: 7bit", "", plan.body, "",
  ];
  const message = lines.join("\r\n");
  if (message.split("\r\n").some(line => Buffer.byteLength(line) > 998) || Buffer.byteLength(message) > 64 * 1024) throw new Error("Reply headers exceed supported RFC limits");
  return message;
}

/** Profile is read-only and binds the read/send grants to the same actual mailbox. */
export async function gmailAccountEmail(token: AccessTokenProvider, fetcher: typeof fetch = fetch): Promise<string> {
  try {
    const value = await token();
    if (!value) throw new Error();
    const response = await fetcher("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
      method: "GET", headers: { Authorization: `Bearer ${value}` }, redirect: "error", signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error();
    const data = await response.json() as { emailAddress?: unknown };
    if (typeof data.emailAddress !== "string") throw new Error();
    return bareAddress(data.emailAddress);
  } catch { throw new Error("Cannot verify the Gmail account identity. Check authorization and connectivity. No send attempted."); }
}

export function requireSameGmailAccount(reader: string, sender: string): void {
  bareAddress(reader); bareAddress(sender);
  if (reader.toLowerCase() !== sender.toLowerCase()) throw new Error("Read and send OAuth accounts differ. No send attempted. Reauthorize the existing client as the same moderator.");
}

/** Development lock/record, not a durable production ledger. Never automatically cleared. */
export class LocalTestExecutionRecords {
  constructor(private readonly directory = ".hmm/actions") {}
  async reserve(plan: ApprovalReplyPlan, sender: string): Promise<string> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    // Stable even if the refresh grant (and therefore ActionId) changes after reauthorization.
    const key = createHash("sha256").update(JSON.stringify([sender.toLowerCase(), plan.moderationMessageId])).digest("hex");
    const path = join(this.directory, `${key}.json`);
    try {
      await writeFile(path, JSON.stringify({ actionId: plan.actionId, status: "ATTEMPTING", createdAt: new Date().toISOString() }), { flag: "wx", mode: 0o600 });
    } catch { throw new Error("Test execution record exists or cannot be reserved. No send attempted. Inspect local records and Gmail Sent; do not repeat an uncertain send."); }
    return path;
  }
  async finish(path: string, result: Omit<ReplyExecutionResult, "recordSaved">): Promise<boolean> {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify({ ...result, completedAt: new Date().toISOString() }), { flag: "wx", mode: 0o600 });
      await rename(temporary, path); return true;
    } catch { return false; }
    finally { await rm(temporary, { force: true }).catch(() => {}); }
  }
}

/** Sends only an already-approved, confirmed plan. Never evaluates, chooses recipients or retries. */
export class GmailReplyExecutor implements EmailReplyExecutor {
  readonly #attempted = new Set<string>();
  constructor(private readonly token: AccessTokenProvider, private readonly sender: string,
    private readonly records = new LocalTestExecutionRecords(), private readonly fetcher: typeof fetch = fetch) {}
  async execute(input: ApprovalReplyPlan): Promise<ReplyExecutionResult> {
    const plan = structuredClone(input);
    const raw = Buffer.from(buildReplyRfc(plan, this.sender)).toString("base64url");
    if (this.#attempted.has(plan.actionId)) throw new Error("Duplicate reply action refused in this process");
    this.#attempted.add(plan.actionId);
    let token: string;
    try { token = await this.token(); if (!token) throw new Error(); }
    catch { throw new Error("Send authorization failed before submission. Reauthorize the send token; no email was submitted."); }
    const record = await this.records.reserve(plan, this.sender);
    let response: Response;
    try {
      response = await this.fetcher("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ raw, threadId: plan.threadId }), redirect: "error", signal: AbortSignal.timeout(30_000),
      });
    } catch { throw new Error("Gmail send outcome UNKNOWN (network/timeout). No retry. Local reservation retained; check Gmail Sent and the test group manually."); }
    if (!response.ok) throw new Error(`Gmail send returned HTTP ${response.status}. No retry; approval is not verified. Local reservation retained. Check Gmail Sent before any further test.${[401, 403].includes(response.status) ? " Check gmail.send authorization." : ""}`);
    let data: { id?: unknown; threadId?: unknown };
    try { data = await response.json() as typeof data; }
    catch { throw new Error("Gmail send outcome UNKNOWN: unreadable response. No retry; reservation retained. Check Gmail Sent manually."); }
    if (!data || !gmailId(data.id) || !gmailId(data.threadId)) throw new Error("Gmail send outcome UNKNOWN: missing message/thread identity. No retry; reservation retained. Check Gmail Sent manually.");
    const result = { actionId: plan.actionId, status: "SENT" as const, gmailMessageId: data.id, gmailThreadId: data.threadId };
    return { ...result, recordSaved: await this.records.finish(record, result) };
  }
}
