#!/usr/bin/env node
import { approveTest } from "./approve-test.js";
import { gmailCheck } from "./gmail-check.js";
import { readFile } from "node:fs/promises";
import { loadConfig } from "../config/load-config.js";
import { moderate } from "../core/moderate.js";
import { createEvaluator } from "../adapters/evaluators/create-evaluator.js";
import { formatResult } from "../adapters/notifications/console-notifier.js";
import { checkEmail, fileEmail, formatEmailCheck } from "../adapters/email/check-email.js";
import { MimeEmailParser } from "../adapters/email/mime-parser.js";
import { GoogleGroupsParser } from "../adapters/email/google-groups-parser.js";
import { loadGoogleGroupsConfig } from "../adapters/email/google-groups-config.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === "approve-test") { await approveTest(args.slice(1)); return; }
  if (args[0] === "gmail-check") { process.exitCode = await gmailCheck(args.slice(1)); return; }
  if (args.length === 1 && ["--help", "-h"].includes(args[0]!)) {
    console.log("Usage: hmm check <file> [--config <yaml-file>]\n       hmm check-email <eml-file> [--config <yaml-file>] [--email-config <yaml-file>]\n       hmm gmail-check [--inspect] [--email-config <yaml-file>] [--config <yaml-file>] [--credentials <json-file>] [--token <json-file>]\n       hmm approve-test <gmail-message-id> [--sending-config <yaml-file>] [--email-config <yaml-file>] [--config <yaml-file>]\napprove-test can send ONE email after exact interactive confirmation. Other commands are dry-run only; check-email is offline and requires provider: fake. Text checks with Jev use the network. Exit codes: 0 APPROVE, 1 REJECT, 2 REVIEW/error.");
    return;
  }
  if (!["check", "check-email"].includes(args[0] ?? "") || !args[1] || args.length % 2 !== 0) {
    throw new Error("Usage: hmm check|check-email <file> [--config <yaml-file>] [--email-config <yaml-file>]");
  }
  const options = new Map<string, string>();
  for (let index = 2; index < args.length; index += 2) {
    const key = args[index]!;
    if (!args[index + 1] || options.has(key) || (key !== "--config" && !(args[0] === "check-email" && key === "--email-config"))) throw new Error("Invalid or duplicate CLI option");
    options.set(key, args[index + 1]!);
  }
  const config = await loadConfig(options.get("--config") ?? "config/example.yaml");
  if (args[0] === "check-email") {
    if (config.evaluator.provider !== "fake") throw new Error("check-email is an offline harness; select provider: fake");
    const emailConfig = await loadGoogleGroupsConfig(options.get("--email-config") ?? "config/google-groups.example.yaml");
    const result = await checkEmail(fileEmail(await readFile(args[1])), config, createEvaluator(config), new MimeEmailParser(), new GoogleGroupsParser(emailConfig));
    console.log(formatEmailCheck(result));
    process.exitCode = result.plan.kind === "moderator-review" ? 2 : result.moderation.decision.status === "REJECT" ? 1 : 0;
    return;
  }
  // This command never attaches action adapters, even if the config disables dry_run.
  const result = await moderate({ id: args[1], format: "text", body: await readFile(args[1], "utf8") }, config, createEvaluator(config));
  console.log(formatResult(result, true));
  process.exitCode = result.decision.status === "APPROVE" ? 0 : result.decision.status === "REJECT" ? 1 : 2;
}

main().catch(error => {
  const status = process.argv[2] === "approve-test" ? "TEST SEND STOPPED" : "REVIEW";
  console.error(`hmm\n\n${status}\n${error instanceof Error ? error.message : "Unable to check input"}`);
  process.exitCode = 2;
});
