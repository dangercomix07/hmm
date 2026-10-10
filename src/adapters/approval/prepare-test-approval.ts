import { verifyNotificationAuthentication, defaultAuthenticationPolicy } from "../email/notification-authentication.js";
import type { AuthenticationEvidenceProvider, AuthenticationPolicy, NotificationTrust } from "../../ports/notification-authentication.js";
import { singleMailbox } from "../email/mime-parser.js";
import { sourceKey, actionIdFor, digest } from "./action-identity.js";
import type { Config } from "../../config/types.js";
import type { GmailClient } from "../inbox/gmail-client.js";
import type { GoogleGroupsConfig } from "../email/google-groups-config.js";
import { moderateItem } from "../../core/moderate.js";
import { buildEmailActionPlan } from "./email-action-plan.js";
import type { RawEmail, ModerationEmail } from "../email/types.js";
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
const preparedCapabilities = new WeakMap<PreparedTestApproval, { account: string; createdAt: number }>();
const confirmedCapabilities = new WeakMap<ApprovalReplyPlan, { account: string; expires: number; consumed: boolean }>();
/** Runtime check: cloned/forged/plain plans cannot reach the send boundary. */
export function consumeConfirmedTestPlan(plan: ApprovalReplyPlan, account: string): void {
  const proof = confirmedCapabilities.get(plan);
  if (!proof || proof.consumed || proof.expires < Date.now() || proof.account !== account.toLowerCase() || plan.actionId !== actionIdFor(sourceKey(account, plan.moderationMessageId))) throw new Error("Unconfirmed, expired, mismatched or duplicate reply capability");
  proof.consumed = true;
}
export interface PreparedTestApproval { trust: NotificationTrust; testOnlyAuthenticationException: boolean; plan: ApprovalReplyPlan; group: string; author: string; originalSubject: string }
export async function prepareTestApproval(id: string, client: GmailClient, account: string, config: Config,
  groups: GoogleGroupsConfig, sending: TestSendingConfig, authentication: { policy: AuthenticationPolicy; provider?: AuthenticationEvidenceProvider } = { policy: defaultAuthenticationPolicy }): Promise<PreparedTestApproval> {
  return prepareApproval(id, client, account, config, groups, sending, authentication, "fake");
}

/** Bind fresh bytes, Gmail identity and regenerated plan to the candidate the human inspected. */
export function notificationSnapshot(raw: RawEmail): string {
  return digest([raw.id, raw.threadId, raw.source, Buffer.from(raw.raw).toString("base64")]);
}
export async function prepareSupervisedApproval(id: string, client: GmailClient, account: string, config: Config,
  groups: GoogleGroupsConfig, sending: TestSendingConfig, expectedSnapshot: string): Promise<PreparedTestApproval> {
  return prepareApproval(id, client, account, config, groups, sending, { policy: defaultAuthenticationPolicy }, "none", expectedSnapshot);
}
async function prepareApproval(id: string, client: GmailClient, account: string, config: Config,
  groups: GoogleGroupsConfig, sending: TestSendingConfig,
  authentication: { policy: AuthenticationPolicy; provider?: AuthenticationEvidenceProvider },
  provider: "fake" | "none", expectedSnapshot?: string): Promise<PreparedTestApproval> {
  validateSelectedId(id);
  const guard = validateTestSendingConfig({ sending });
  if (!guard.enabled || guard.test_only !== true) throw new Error("Test sending is disabled; explicitly enable the dedicated test-only config");
  if (!guard.allowed_groups.some(group => group.toLowerCase() === groups.group_address.toLowerCase())) throw new Error("Configured group is not the explicitly allowed test group");
  if (config.evaluator.provider !== provider || (provider === "none" && config.rules.some(rule => rule.type !== "deterministic"))) throw new Error(`Supervised preparation requires provider: ${provider} and the supported rules`);
  if (singleMailbox(account, "account").address !== account) throw new Error("Verified mailbox identity required");
  const fetched = await client.getMessage(id, { format: "raw" });
  if (fetched.id !== id) throw new Error("Fetched Gmail message does not match the explicitly selected ID");
  const raw = normalizeGmailMessage(fetched, account);
  if (expectedSnapshot !== undefined && notificationSnapshot(raw) !== expectedSnapshot) throw new Error("Selected notification changed since inspection. REVIEW; no send.");
  let message: ModerationEmail;
  try { message = await new GoogleGroupsParser(groups).parse(await new MimeEmailParser().parse(raw)); }
  catch { throw new Error("Send refused: fresh decision is REVIEW, plan is moderator-review. Unsupported or ambiguous notification."); }
  const trust = await verifyNotificationAuthentication(raw, message.notification, authentication.policy, authentication.provider);
  const exception = guard.test_only_allow_unverified_authentication === true && trust.status === "INDETERMINATE" && trust.testCompatibilityEligible;
  if (trust.status !== "TRUSTED" && !exception) throw new Error(`Authentication ${trust.status}: ${trust.reason}. REVIEW; no execution.`);
  const moderation = await moderateItem(message.item, config, createEvaluator(config));
  const result = { message, moderation, plan: buildEmailActionPlan(moderation.decision, message) };
  if (result.moderation.decision.status !== "APPROVE" || result.plan.kind !== "approval-reply" || !result.message) {
    throw new Error(`Send refused: fresh decision is ${result.moderation.decision.status}, plan is ${result.plan.kind}. Run gmail-check --inspect to inspect the read-only result.`);
  }
  if (!guard.allowed_groups.some(group => group.toLowerCase() === result.message!.groupAddress.toLowerCase())) throw new Error("Parsed group is not the explicitly allowed test group");
  const plan = result.plan.reply;
  if (!guard.allowed_reply_addresses.some(address => address.toLowerCase() === plan.targetReplyAddress.toLowerCase())) throw new Error("Reply recipient is not the explicitly allowed test reply address");
  if (plan.moderationMessageId !== id || plan.threadId !== fetched.threadId) throw new Error("Reply plan identity does not match the selected Gmail message");
  validateReplyPlan(plan);
  Object.freeze(plan.references); Object.freeze(plan); Object.freeze(trust);
  const prepared = Object.freeze({ plan, trust, testOnlyAuthenticationException: exception, group: result.message.groupAddress, author: result.message.item.author!.email!, originalSubject: result.message.item.subject! });
  preparedCapabilities.set(prepared, { account: account.toLowerCase(), createdAt: Date.now() });
  return prepared;
}

export function formatTestApproval(prepared: PreparedTestApproval, sender: string): string {
  const p = prepared.plan;
  // JSON quoting prevents terminal controls or newlines in email-provided text from faking the confirmation UI.
  const value = (label: string, text: string): string => `${label}: ${JSON.stringify(text).replace(/[\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`)}`;
  return ["", "-".repeat(64), "TEST APPROVAL SEND", "-".repeat(64), "", `Authentication: ${prepared.trust.status}`, ...(prepared.testOnlyAuthenticationException ? ["WARNING: TEST-ONLY UNVERIFIED AUTHENTICATION EXCEPTION. This notification is NOT TRUSTED."] : []), value("Group", prepared.group), value("Original author", prepared.author),
    value("Original subject", prepared.originalSubject), "Decision: APPROVE", value("From", sender), value("To", p.targetReplyAddress),
    "", value("Reply subject", p.subject), value("In-Reply-To", p.inReplyTo), `References: ${JSON.stringify(p.references)}`,
    value("Gmail message", p.moderationMessageId), value("Thread", p.threadId!), value("Action ID", p.actionId),
    "", value("Reply body", p.body), "", "THIS WILL SEND ONE REAL EMAIL.", "Google Groups publication must be checked manually after sending."].join("\n");
}

/** Only this boundary promotes a data-only plan after human confirmation. */
export async function confirmTestApproval(prepared: PreparedTestApproval, sender: string, executor: EmailReplyExecutor,
  display: (text: string) => void, confirm: () => Promise<string | undefined>): Promise<ReplyExecutionResult | undefined> {
  const proof = preparedCapabilities.get(prepared);
  if (!proof || proof.account !== sender.toLowerCase() || Date.now() - proof.createdAt > 300_000) throw new Error("Invalid or expired prepared approval capability");
  const snapshot = prepared;
  validateReplyPlan(snapshot.plan);
  display(formatTestApproval(snapshot, sender));
  const started = Date.now();
  let answer: string | undefined;
  try { answer = await confirm(); } catch { return undefined; }
  if (answer !== "APPROVE TEST") return undefined;
  if (Date.now() - started > 300_000 || Date.now() - proof.createdAt > 300_000) throw new Error("Confirmation expired. No email sent; rerun to fetch and evaluate again.");
  if (preparedCapabilities.get(prepared) !== proof) throw new Error("Approval capability already confirmed");
  preparedCapabilities.delete(prepared);
  confirmedCapabilities.set(snapshot.plan, { account: proof.account, expires: proof.createdAt + 300_000, consumed: false });
  return executor.execute(snapshot.plan);
}
