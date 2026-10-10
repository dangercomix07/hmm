import type { Config } from "../../config/types.js";
import type { GmailClient } from "../inbox/gmail-client.js";
import type { GoogleGroupsConfig } from "../email/google-groups-config.js";
import type { EmailCheckResult } from "../email/check-email.js";
import { checkEmail } from "../email/check-email.js";
import { normalizeGmailMessage } from "../inbox/gmail-transport.js";
import { MimeEmailParser } from "../email/mime-parser.js";
import { GoogleGroupsParser } from "../email/google-groups-parser.js";
import { createEvaluator } from "../evaluators/create-evaluator.js";
import { validateTestSendingConfig, type TestSendingConfig } from "./test-sending-config.js";
import { validateReplyPlan } from "./gmail-reply-executor.js";
import type { ApprovalReplyPlan } from "./email-action-plan.js";
import type { EmailReplyExecutor, ReplyExecutionResult } from "../../ports/email-reply-executor.js";

export function validateSelectedId(id: string): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || ["latest", "all"].includes(id.toLowerCase())) throw new Error("Supply exactly one explicit Gmail message ID; no latest/all/batch selection");
}
export interface PreparedTestApproval { plan: ApprovalReplyPlan; group: string; author: string; originalSubject: string }
export async function prepareTestApproval(id: string, client: GmailClient, account: string, config: Config,
  groups: GoogleGroupsConfig, sending: TestSendingConfig): Promise<PreparedTestApproval> {
  validateSelectedId(id);
  const guard = validateTestSendingConfig({ sending });
  if (!guard.enabled || guard.test_only !== true) throw new Error("Test sending is disabled; explicitly enable the dedicated test-only config");
  if (!guard.allowed_groups.some(group => group.toLowerCase() === groups.group_address.toLowerCase())) throw new Error("Configured group is not the explicitly allowed test group");
  if (config.evaluator.provider !== "fake") throw new Error("approve-test requires provider: fake for this controlled actuator test");
  const fetched = await client.getMessage(id, { format: "raw" });
  if (fetched.id !== id) throw new Error("Fetched Gmail message does not match the explicitly selected ID");
  const result: EmailCheckResult = await checkEmail(normalizeGmailMessage(fetched, account), config, createEvaluator(config), new MimeEmailParser(), new GoogleGroupsParser(groups));
  if (result.moderation.decision.status !== "APPROVE" || result.plan.kind !== "approval-reply" || !result.message) {
    throw new Error(`Send refused: fresh decision is ${result.moderation.decision.status}, plan is ${result.plan.kind}. Run gmail-check --inspect to inspect the read-only result.`);
  }
  if (!guard.allowed_groups.some(group => group.toLowerCase() === result.message!.groupAddress.toLowerCase())) throw new Error("Parsed group is not the explicitly allowed test group");
  const plan = result.plan.reply;
  if (!guard.allowed_reply_addresses.some(address => address.toLowerCase() === plan.targetReplyAddress.toLowerCase())) throw new Error("Reply recipient is not the explicitly allowed test reply address");
  if (plan.moderationMessageId !== id || plan.threadId !== fetched.threadId) throw new Error("Reply plan identity does not match the selected Gmail message");
  validateReplyPlan(plan);
  return { plan, group: result.message.groupAddress, author: result.message.item.author!.email!, originalSubject: result.message.item.subject! };
}

export function formatTestApproval(prepared: PreparedTestApproval, sender: string): string {
  const p = prepared.plan;
  // JSON quoting prevents terminal controls or newlines in email-provided text from faking the confirmation UI.
  const value = (label: string, text: string): string => `${label}: ${JSON.stringify(text).replace(/[\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`)}`;
  return ["hmm", "TEST APPROVAL SEND", value("Group", prepared.group), value("Original author", prepared.author),
    value("Original subject", prepared.originalSubject), "Decision: APPROVE", value("From", sender), value("To", p.targetReplyAddress),
    value("Reply subject", p.subject), value("In-Reply-To", p.inReplyTo), `References: ${JSON.stringify(p.references)}`,
    value("Gmail message", p.moderationMessageId), value("Thread", p.threadId!), value("Action ID", p.actionId),
    value("Reply body", p.body), "THIS WILL SEND ONE REAL EMAIL.", "Google Groups publication must be checked manually after sending."].join("\n");
}

/** Only this boundary promotes a data-only plan after human confirmation. */
export async function confirmTestApproval(prepared: PreparedTestApproval, sender: string, executor: EmailReplyExecutor,
  display: (text: string) => void, confirm: () => Promise<string | undefined>): Promise<ReplyExecutionResult | undefined> {
  const snapshot = structuredClone(prepared);
  validateReplyPlan(snapshot.plan);
  display(formatTestApproval(snapshot, sender));
  const started = Date.now();
  let answer: string | undefined;
  try { answer = await confirm(); } catch { return undefined; }
  if (answer !== "APPROVE TEST") return undefined;
  if (Date.now() - started > 300_000) throw new Error("Confirmation expired. No email sent; rerun to fetch and evaluate again.");
  return executor.execute(snapshot.plan);
}
