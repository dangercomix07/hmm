import type { ActionLedger } from "../../ports/action-ledger.js";
import { LocalActionLedger } from "../ledger/local-action-ledger.js";
import { sourceKey, digest } from "./action-identity.js";
import { consumeConfirmedTestPlan } from "./prepare-test-approval.js";
import { randomUUID } from "node:crypto";
import { messageIds, singleMailbox } from "../email/mime-parser.js";
import type { ApprovalReplyPlan } from "./email-action-plan.js";
import type { EmailReplyExecutor, ReplyExecutionResult } from "../../ports/email-reply-executor.js";
export { gmailAccountEmail, requireSameGmailAccount } from "../inbox/gmail-account.js";
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

/** Controlled, human-confirmed execution only. No generic/unattended send entry point. */
export class GmailReplyExecutor implements EmailReplyExecutor {
  constructor(private readonly token: AccessTokenProvider, private readonly sender: string,
    private readonly ledger: ActionLedger = new LocalActionLedger(), private readonly fetcher: typeof fetch = fetch) {}
  async execute(input: ApprovalReplyPlan): Promise<ReplyExecutionResult> {
    consumeConfirmedTestPlan(input, this.sender);
    const plan = structuredClone(input);
    const raw = Buffer.from(buildReplyRfc(plan, this.sender)).toString("base64url");
    let record = await this.ledger.reserve({ actionId: plan.actionId, sourceKey: sourceKey(this.sender, plan.moderationMessageId), planDigest: digest(plan) });
    let token: string;
    try { token = await this.token(); if (!token) throw new Error(); }
    catch {
      await this.ledger.transition(record, "FAILED_SAFE");
      throw new Error("Send authorization failed before submission. No email submitted; FAILED_SAFE. No automatic retry.");
    }
    // Persist the possibility of an external effect BEFORE submitting the request.
    record = await this.ledger.transition(record, "DISPATCHING");
    const uncertain = async (detail: string): Promise<never> => {
      let saved = false;
      try { await this.ledger.transition(record, "UNCERTAIN"); saved = true; } catch { /* DISPATCHING still blocks all retries */ }
      throw new Error(`Gmail send outcome UNKNOWN (${detail}). No retry. ${saved ? "UNCERTAIN recorded." : "Ledger update failed; reservation remains blocked."} Reconcile manually.`);
    };
    let response: Response;
    try {
      response = await this.fetcher("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ raw, threadId: plan.threadId }), redirect: "error", signal: AbortSignal.timeout(30_000),
      });
    } catch { return uncertain("network/timeout"); }
    if (!response.ok) return uncertain(`HTTP ${response.status}`);
    let data: { id?: unknown; threadId?: unknown };
    try { data = await response.json() as typeof data; }
    catch { return uncertain("unreadable response"); }
    if (!data || !gmailId(data.id) || !gmailId(data.threadId)) return uncertain("missing message/thread identity");
    let recordSaved = false;
    try { await this.ledger.transition(record, "SENT", { messageId: data.id, threadId: data.threadId }); recordSaved = true; }
    catch { try { await this.ledger.transition(record, "UNCERTAIN"); } catch { /* blocked DISPATCHING survives */ } }
    return { actionId: plan.actionId, status: "SENT", gmailMessageId: data.id, gmailThreadId: data.threadId, recordSaved };
  }
}
