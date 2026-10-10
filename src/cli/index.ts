#!/usr/bin/env node
import { checkConfigurations } from "./check-config.js";
import { moderateGmail } from "./moderate-gmail.js";
import { approveTest } from "./approve-test.js";
import { gmailCheck } from "./gmail-check.js";
import { readFile } from "node:fs/promises";
import { loadConfig } from "../config/load-config.js";
import { moderate } from "../core/moderate.js";
import { createEvaluator } from "../adapters/evaluators/create-evaluator.js";
import { formatFeedback } from "../adapters/notifications/console-notifier.js";
import { checkEmail, fileEmail, formatEmailCheck } from "../adapters/email/check-email.js";
import { MimeEmailParser } from "../adapters/email/mime-parser.js";
import { GoogleGroupsParser } from "../adapters/email/google-groups-parser.js";
import { loadGoogleGroupsConfig } from "../adapters/email/google-groups-config.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let verbose = false;
  if (args[0] === "check" && args.includes("--verbose")) {
    if (args.filter(a => a === "--verbose").length !== 1) throw new Error("Duplicate --verbose option");
    args.splice(args.indexOf("--verbose"), 1); verbose = true;
  }
  if (args[0] === "config-check") {
    if (args.length !== 1) throw new Error("Usage: hmm config-check");
    const checked = await checkConfigurations();
    console.log(checked.lines.join("\n"));
    process.exitCode = checked.valid ? 0 : 2;
    return;
  }
  if (args[0] === "moderate-gmail") { await moderateGmail(args.slice(1)); return; }
  if (args[0] === "approve-test") { await approveTest(args.slice(1)); return; }
  if (args[0] === "gmail-check") { process.exitCode = await gmailCheck(args.slice(1)); return; }
  if (args.length === 1 && ["--help", "-h"].includes(args[0]!)) {
    console.log("Usage: hmm config-check\n       hmm moderate-gmail [--reauthorize] [--email-config <yaml-file>] [--sending-config <yaml-file>]\n       hmm check <file> [--config <yaml-file>] [--verbose]\n       hmm check-email <eml-file> [--config <yaml-file>] [--email-config <yaml-file>]\n       hmm gmail-check [--inspect] [--email-config <yaml-file>] [--config <yaml-file>] [--credentials <json-file>] [--token <json-file>]\n       hmm approve-test <gmail-message-id> [--reauthorize] [--sending-config <yaml-file>] [--email-config <yaml-file>] [--config <yaml-file>]\napprove-test can send ONE email after exact interactive confirmation. moderate-gmail discovers candidates and requires a separate interactive confirmation for each send. Other commands are dry-run only; check-email is offline and requires provider: fake or none. Text checks with Jev use the network. Exit codes: 0 APPROVE, 1 REJECT, 2 REVIEW/error.");
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
  const config = await loadConfig(options.get("--config") ?? (args[0] === "check" ? "config/team-update.yaml" : "config/example.yaml"));
  if (args[0] === "check-email") {
    if (!["fake", "none"].includes(config.evaluator.provider)) throw new Error("check-email is an offline harness; select provider: fake or none");
    const emailConfig = await loadGoogleGroupsConfig(options.get("--email-config") ?? "config/google-groups.example.yaml");
    const result = await checkEmail(fileEmail(await readFile(args[1])), config, createEvaluator(config), new MimeEmailParser(), new GoogleGroupsParser(emailConfig));
    console.log(formatEmailCheck(result));
    process.exitCode = result.plan.kind === "moderator-review" ? 2 : result.moderation.decision.status === "REJECT" ? 1 : 0;
    return;
  }
  // This command never attaches action adapters, even if the config disables dry_run.
  const result = await moderate({ id: args[1], format: "text", body: await readFile(args[1], "utf8") }, config, createEvaluator(config));
  console.log(formatFeedback(result, verbose));
  process.exitCode = result.decision.status === "APPROVE" ? 0 : result.decision.status === "REJECT" ? 1 : 2;
}

main().catch(error => {
  const status = process.argv[2] === "approve-test" ? "TEST SEND STOPPED" : "REVIEW";
  console.error(`hmm\n\n${status}\n${error instanceof Error ? error.message : "Unable to check input"}`);
  process.exitCode = 2;
});
