import { createHash } from "node:crypto";
import type { Config } from "../../config/types.js";
import type { ModerationResult } from "../../domain/decision.js";
import type { Evaluator } from "../../ports/evaluator.js";
import { moderateItem } from "../../core/moderate.js";
import { buildEmailActionPlan } from "../approval/email-action-plan.js";
import type { EmailActionPlan } from "../approval/email-action-plan.js";
import { formatResult } from "../notifications/console-notifier.js";
import type { EmailParser, ModerationEmail, ModerationParser, RawEmail } from "./types.js";

export interface EmailCheckResult {
  moderation: ModerationResult;
  message?: ModerationEmail;
  plan: EmailActionPlan;
}

export function fileEmail(bytes: Uint8Array): RawEmail {
  return { id: createHash("sha256").update(bytes).digest("hex"), source: { type: "file", account: "local-fixtures" }, raw: bytes };
}

/** Evaluation and data-only planning. There is deliberately no action executor port. */
export async function checkEmail(raw: RawEmail, config: Config, evaluator: Evaluator, mime: EmailParser, source: ModerationParser): Promise<EmailCheckResult> {
  let message: ModerationEmail;
  try { message = await source.parse(await mime.parse(raw)); }
  catch (error) {
    const moderation: ModerationResult = { inputId: raw.id, deterministic: [], semantic: { ruleResults: [] },
      decision: { status: "REVIEW", reasons: [{ ruleId: "email-parser", explanation: error instanceof Error ? error.message : "Email parsing failed" }] } };
    return { moderation, plan: buildEmailActionPlan(moderation.decision) };
  }
  const moderation = await moderateItem(message.item, config, evaluator);
  const plan = buildEmailActionPlan(moderation.decision, message);
  return { moderation, message, plan };
}

export function formatEmailCheck(result: EmailCheckResult): string {
  const lines = ["Input: Google Groups moderation candidate"];
  if (result.message) {
    lines.push(`Original author: ${result.message.item.author?.email}`, `Subject: ${result.message.item.subject}`, `Group: ${result.message.groupAddress}`);
  }
  lines.push(formatResult(result.moderation, true), "", "ActionPlan (non-executable)", `Type: ${result.plan.kind}`, "Approval-by-reply: UNVERIFIED");
  if (result.plan.kind === "approval-reply") {
    const reply = result.plan.reply;
    lines.push(`Action ID: ${reply.actionId}`, `Reply-To target: ${reply.targetReplyAddress}`, `Subject: ${reply.subject}`,
      `In-Reply-To: ${reply.inReplyTo}`, `References: ${reply.references.join(" ")}`, `Thread: ${reply.threadId ?? "unavailable in file fixture"}`, `Proposed body: ${reply.body}`);
  } else if (result.plan.kind === "moderator-review") lines.push(result.plan.reason);
  else lines.push("No approval reply. Feedback may be generated later.");
  lines.push("No email sent; no Google Groups changes; no external storage writes.");
  // Prevent email-provided terminal control sequences from affecting CLI output.
  return lines.join("\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");
}
