import { readFile } from "node:fs/promises";
import { parseDocument } from "yaml";
import { singleMailbox } from "./mime-parser.js";

export interface GoogleGroupsConfig {
  group_address: string;
  notification_senders: string[];
  subject_contains: string;
  gmail_query: string;
}

export async function loadGoogleGroupsConfig(path: string): Promise<GoogleGroupsConfig> {
  const document = parseDocument(await readFile(path, "utf8"), { uniqueKeys: true });
  if (document.errors.length) throw new Error("Invalid Google Groups config YAML");
  const config: unknown = document.toJS({ maxAliasCount: 10 });
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("Invalid Google Groups config");
  const fields = config as Record<string, unknown>;
  if (Object.keys(fields).some(key => !["group_address", "notification_senders", "subject_contains", "gmail_query"].includes(key))) throw new Error("Unknown Google Groups config field");
  for (const key of ["group_address", "subject_contains", "gmail_query"]) {
    if (typeof fields[key] !== "string" || !(fields[key] as string).trim() || /[\r\n\u0000]/.test(fields[key] as string)) throw new Error(`Invalid ${key}`);
  }
  if (!Array.isArray(fields.notification_senders) || !fields.notification_senders.length || !fields.notification_senders.every(value => typeof value === "string")) throw new Error("notification_senders must be a nonempty address list");
  const address = (value: string): string => {
    const parsed = singleMailbox(value, "configured");
    if (parsed.address !== value) throw new Error("Config requires bare email addresses");
    return parsed.address;
  };
  return {
    group_address: address(fields.group_address as string),
    notification_senders: (fields.notification_senders as string[]).map(address),
    subject_contains: fields.subject_contains as string, gmail_query: fields.gmail_query as string,
  };
}
