export interface ApprovalAdapter {
  approve(moderationMessageId: string): Promise<void>;
}
