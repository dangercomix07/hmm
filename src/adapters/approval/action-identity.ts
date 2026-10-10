import { createHash } from "node:crypto";
export const digest = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
/** Matches the Milestone 4B reservation key, preserving duplicate protection. */
export const sourceKey = (mailbox: string, messageId: string): string => digest([mailbox.toLowerCase(), messageId]);
export const actionIdFor = (key: string): string => digest(["hmm-action-v2", key, "approval-reply"]);
