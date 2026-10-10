import type { ApprovalReplyPlan } from "../adapters/approval/email-action-plan.js";
export interface ReplyExecutionResult {
  actionId: string;
  status: "SENT";
  gmailMessageId: string;
  gmailThreadId: string;
  recordSaved: boolean;
}
export interface EmailReplyExecutor {
  execute(plan: ApprovalReplyPlan): Promise<ReplyExecutionResult>;
}
