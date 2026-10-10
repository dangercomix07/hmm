import type { ModerationResult } from "../../domain/decision.js";
import type { Notifier } from "../../ports/notifier.js";

export function formatResult(result: ModerationResult, dryRun: boolean): string {
  const lines = ["hmm", "", "Rules"];
  for (const rule of [...result.deterministic, ...result.semantic.ruleResults]) {
    lines.push(`${rule.result} ${rule.ruleId}`);
    if (rule.result !== "PASS" && rule.reason) lines.push(`Reason: ${rule.reason}`);
  }
  lines.push("", "Decision", result.decision.status);
  for (const reason of result.decision.reasons) lines.push(`- ${reason.ruleId}: ${reason.explanation}`);
  if (dryRun) lines.push("", result.decision.status === "APPROVE" ? "[DRY RUN] Approval eligible; no external action performed." : "[DRY RUN] No approval would be performed.");
  return lines.join("\n");
}

export class ConsoleNotifier implements Notifier {
  readonly scope = "local";
  async notify(result: ModerationResult, dryRun: boolean): Promise<void> { console.log(formatResult(result, dryRun)); }
}
