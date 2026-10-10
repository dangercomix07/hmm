import type { Item, PendingItem } from "../domain/item.js";

/** A synthetic fixture envelope, not a verified Gmail/Google Groups format. */
export function parseItem(raw: PendingItem): Item {
  if (!raw.id.trim() || !raw.body.trim()) throw new Error("Missing input id or message body");
  if (raw.format === "text") return { id: raw.id, body: raw.body, source: { type: "text" } };
  if (raw.format !== "google-groups-fixture") throw new Error("Unsupported input format");
  const text = raw.body.replace(/\r\n/g, "\n");
  const match = /^Moderation-ID: ([^\n]+)\nFrom: ([^\n<>]+) <([^\s<>@]+@[^\s<>@]+)>\nSubject: ([^\n]+)\n\n--- BEGIN ORIGINAL UPDATE ---\n([\s\S]+)\n--- END ORIGINAL UPDATE ---\n?$/.exec(text);
  if (!match || match[1]?.trim() !== raw.id) throw new Error("Invalid fixture envelope or moderation id mismatch");
  const messageId = match[1]!;
  const name = match[2]!;
  const email = match[3]!;
  const subject = match[4]!;
  const body = match[5]!;
  if (!body.trim()) throw new Error("Empty original update");
  return { id: raw.id, author: { name: name.trim(), email }, subject, body, source: { type: "google-groups-fixture", messageId } };
}
