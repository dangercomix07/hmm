import type { ApprovalAdapter } from "../../ports/approval.js";

export class FakeApprovalAdapter implements ApprovalAdapter {
  readonly approvedIds: string[] = [];
  async approve(id: string): Promise<void> { this.approvedIds.push(id); }
}
