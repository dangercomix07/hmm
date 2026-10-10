import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../config/load-config.js";
import { loadGoogleGroupsConfig } from "../adapters/email/google-groups-config.js";
import { loadTestSendingConfig } from "../adapters/approval/test-sending-config.js";

/** Offline YAML audit only. Never reads credentials, tokens or ledger files. */
export async function checkConfigurations(directory = "config"): Promise<{ lines: string[]; valid: boolean }> {
  const names = (await readdir(directory)).filter(name => name.endsWith(".yaml")).sort();
  const lines = ["hmm — Configuration check", ""];
  let valid = true;
  for (const name of names) {
    try {
      const path = join(directory, name);
      if (name.startsWith("google-groups.")) await loadGoogleGroupsConfig(path);
      else if (name.startsWith("gmail-sending.")) {
        const sending = await loadTestSendingConfig(path);
        lines.push(`PASS ${name} (sending ${sending.enabled ? "enabled" : "disabled"}; test-only authentication exception ${sending.test_only_allow_unverified_authentication === true ? "enabled" : "disabled"})`);
        continue;
      } else await loadConfig(path);
      lines.push(`PASS ${name}`);
    } catch {
      valid = false;
      // Do not echo YAML values: a misplaced credential could be present.
      lines.push(`FAIL ${name}: invalid YAML or configuration schema. Compare with its current example.`);
    }
  }
  for (const suffix of ["local.example.yaml", "local.yaml"]) {
    const groupsName = "google-groups." + suffix;
    const sendingName = "gmail-sending." + suffix;
    if (!names.includes(groupsName) || !names.includes(sendingName)) {
      if (suffix === "local.yaml") lines.push("", "Local Gmail config pair is incomplete or absent. No local settings were changed.");
      continue;
    }
    try {
      const groups = await loadGoogleGroupsConfig(join(directory, groupsName));
      const sending = await loadTestSendingConfig(join(directory, sendingName));
      const group = groups.group_address.toLowerCase();
      const at = group.lastIndexOf("@");
      const expectedReply = group.slice(0, at) + "+msgappr" + group.slice(at);
      if (!sending.allowed_groups.includes(group) &&
          !sending.allowed_groups.some(value => value.toLowerCase() === group)) throw new Error();
      if (!sending.allowed_reply_addresses.some(value => value.toLowerCase() === expectedReply)) throw new Error();
      lines.push(`PASS ${suffix}: group and approval-reply allow-lists agree`);
      if (!/\bnewer_than:1d\b/.test(groups.gmail_query)) lines.push(`NOTE ${groupsName}: query is not explicitly limited with newer_than:1d; inspect its date filter.`);
      if (sending.test_only_allow_unverified_authentication === undefined) lines.push(`NOTE ${sendingName}: authentication exception is omitted and therefore disabled. Current example shows the field explicitly.`);
    } catch {
      valid = false;
      lines.push(`FAIL ${suffix}: check config schemas and matching group/reply allow-lists.`);
    }
  }
  lines.push("", "Offline check only. No files changed; no OAuth or Gmail access.", "Git pull does not update ignored local YAML files.");
  return { lines, valid };
}
