export interface Item {
  id: string;
  author?: { name?: string; email?: string };
  subject?: string;
  body: string;
  submittedAt?: Date;
  source: { type: string; messageId?: string };
}

export interface PendingItem {
  id: string;
  format: "text" | "google-groups-fixture";
  body: string;
}
