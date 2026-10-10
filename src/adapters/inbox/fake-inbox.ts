import type { PendingItem } from "../../domain/item.js";
import type { Inbox } from "../../ports/inbox.js";

export class FakeInbox implements Inbox {
  constructor(private readonly items: PendingItem[]) {}
  async getPendingItems(): Promise<PendingItem[]> { return structuredClone(this.items); }
}
