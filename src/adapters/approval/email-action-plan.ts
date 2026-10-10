import { actionIdFor, sourceKey } from "./action-identity.js";
import type { Decision } from "../../domain/decision.js";
import { messageIds, singleMailbox } from "../email/mime-parser.js";
import type { ModerationEmail } from "../email/types.js";

export interface ApprovalReplyPlan {
  actionId: string;
  moderationMessageId: string;
  targetReplyAddress: string;
  threadId?: string;
  inReplyTo: string;
  references: string[];
  subject: string;
  body: string;
  verification: "UNVERIFIED";
}

export type EmailActionPlan = {
  executable: false;
  approvalByReply: "UNVERIFIED";
} & (
  | { kind: "approval-reply"; reply: ApprovalReplyPlan }
  | { kind: "withhold-approval"; feedback: "may be generated later" }
  | { kind: "moderator-review"; reason: string }
);

export function buildApprovalReplyPlan(message: ModerationEmail): ApprovalReplyPlan {
  const notification = message.notification;
  if (!message.replyApprovalMentioned) throw new Error("Notification does not explicitly offer approval by reply");
  if (!notification.messageId || !notification.subject || /[\r\n\u0000-\u001f\u007f]/.test(notification.subject)) throw new Error("Missing or invalid reply metadata");
  if (messageIds(notification.messageId).length !== 1) throw new Error("Ambiguous notification Message-ID");
  if (notification.source.type === "gmail" && !notification.threadId) throw new Error("Gmail threadId is missing");
  if (notification.replyTo.length > 1) throw new Error("Ambiguous reply destination");
  const target = notification.replyTo[0] ?? notification.from;
  if (!target) throw new Error("Reply destination is missing");
  singleMailbox(target.address, "reply destination");
  const parents = notification.references ? messageIds(notification.references) : notification.inReplyTo ? messageIds(notification.inReplyTo) : [];
  if (!notification.references && parents.length > 1) throw new Error("Ambiguous parent threading metadata");
  const references = [...new Set([...parents, notification.messageId])];
  return {
    actionId: actionIdFor(sourceKey(notification.source.type === "gmail" ? notification.source.account : `file:${notification.source.account}`, message.moderationMessageId)),
    moderationMessageId: message.moderationMessageId,
    targetReplyAddress: target.address,
    ...(notification.threadId ? { threadId: notification.threadId } : {}),
    inReplyTo: notification.messageId, references,
    // Gmail documents matching Subjects. Preserve the notification subject exactly.
    subject: notification.subject, body: "Approve.", verification: "UNVERIFIED",
  };
}

export function buildEmailActionPlan(decision: Decision, message?: ModerationEmail): EmailActionPlan {
  const base = { executable: false as const, approvalByReply: "UNVERIFIED" as const };
  if (decision.status === "REJECT") return { ...base, kind: "withhold-approval", feedback: "may be generated later" };
  if (decision.status === "REVIEW" || !message) return { ...base, kind: "moderator-review", reason: "Moderator review required; no approval reply." };
  try { return { ...base, kind: "approval-reply", reply: buildApprovalReplyPlan(message) }; }
  catch (error) { return { ...base, kind: "moderator-review", reason: error instanceof Error ? error.message : "Cannot construct a reply safely" }; }
}
