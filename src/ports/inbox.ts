import type { PendingItem } from "../domain/item.js";

export interface Inbox {
  getPendingItems(): Promise<PendingItem[]>;
}
