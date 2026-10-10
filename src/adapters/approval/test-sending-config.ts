import { readFile } from "node:fs/promises";
import { parseDocument } from "yaml";
import { singleMailbox } from "../email/mime-parser.js";

export interface TestSendingConfig {
  test_only_allow_unverified_authentication?: boolean;
  enabled: boolean;
  test_only: true;
  allowed_groups: string[];
  allowed_reply_addresses: string[];
}
export function validateTestSendingConfig(value: unknown): TestSendingConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid test sending config");
  const root = value as Record<string, unknown>;
  if (Object.keys(root).length !== 1 || !root.sending || typeof root.sending !== "object" || Array.isArray(root.sending)) throw new Error("Expected only a sending section");
  const config = root.sending as Record<string, unknown>;
  if (Object.keys(config).some(key => !["enabled", "test_only", "allowed_groups", "allowed_reply_addresses", "test_only_allow_unverified_authentication"].includes(key)) || typeof config.enabled !== "boolean" || config.test_only !== true) throw new Error("Explicit test_only: true and boolean enabled are required");
  const addresses = (field: string): string[] => {
    const list = config[field];
    if (!Array.isArray(list) || list.length !== 1 || typeof list[0] !== "string" || /[*?]/.test(list[0])) throw new Error(`Exactly one explicit ${field} address is required; no wildcards`);
    if (singleMailbox(list[0], field).address !== list[0]) throw new Error("Sending config requires bare addresses");
    return list as string[];
  };
  if (config.test_only_allow_unverified_authentication !== undefined && typeof config.test_only_allow_unverified_authentication !== "boolean") throw new Error("Authentication exception must be boolean");
  return { ...(config.test_only_allow_unverified_authentication !== undefined ? { test_only_allow_unverified_authentication: config.test_only_allow_unverified_authentication as boolean } : {}), enabled: config.enabled, test_only: true, allowed_groups: addresses("allowed_groups"), allowed_reply_addresses: addresses("allowed_reply_addresses") };
}
export async function loadTestSendingConfig(path: string): Promise<TestSendingConfig> {
  const document = parseDocument(await readFile(path, "utf8"), { uniqueKeys: true });
  if (document.errors.length) throw new Error("Invalid test sending YAML");
  return validateTestSendingConfig(document.toJS({ maxAliasCount: 10 }));
}
