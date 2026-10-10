#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { loadConfig } from "../config/load-config.js";
import { moderate } from "../core/moderate.js";
import { createEvaluator } from "../adapters/evaluators/create-evaluator.js";
import { formatResult } from "../adapters/notifications/console-notifier.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 1 && ["--help", "-h"].includes(args[0]!)) {
    console.log("Usage: hmm check <file> [--config <yaml-file>]\nDry-run only; Jev evaluation uses the network. Exit codes: 0 APPROVE, 1 REJECT, 2 REVIEW/error.");
    return;
  }
  if (args[0] !== "check" || !args[1] || ![2, 4].includes(args.length) || (args.length === 4 && (args[2] !== "--config" || !args[3]))) {
    throw new Error("Usage: hmm check <file> [--config <yaml-file>]");
  }
  const config = await loadConfig(args[3] ?? "config/example.yaml");
  // This command never attaches action adapters, even if the config disables dry_run.
  const result = await moderate({ id: args[1], format: "text", body: await readFile(args[1], "utf8") }, config, createEvaluator(config));
  console.log(formatResult(result, true));
  process.exitCode = result.decision.status === "APPROVE" ? 0 : result.decision.status === "REJECT" ? 1 : 2;
}

main().catch(error => {
  console.error(`hmm\n\nREVIEW\n${error instanceof Error ? error.message : "Unable to check input"}`);
  process.exitCode = 2;
});
