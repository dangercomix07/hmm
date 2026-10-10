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

/** Human pre-check view. Raw model prose and machine IDs stay out of the main output. */
export function formatFeedback(result: ModerationResult, verbose = false): string {
  const lines = ["hmm", "", "Decision", result.decision.status];
  const feedback = result.feedback ?? [];
  for (const [label, items] of [
    ["Missing", feedback.filter(f => f.category === "missing")],
    ["Needs attention", feedback.filter(f => f.category !== "missing" && f.category !== "semantic-review")],
    ["Needs review", feedback.filter(f => f.category === "semantic-review")],
  ] as const) {
    if (items.length) lines.push("", `${label}:`, ...[...new Set(items.map(f => f.message))].map(message => `- ${message}`));
  }
  if (result.decision.status === "APPROVE") lines.push("", "Required checks passed. This does not verify the claims or engineering quality.");
  else if (!feedback.length) lines.push("", "Human review is required; the configured checks did not establish approval.");
  if (verbose) lines.push("", "Checks:", ...[...result.deterministic, ...result.semantic.ruleResults].map(r => `${r.result} ${r.ruleId}`));
  lines.push("", "[DRY RUN] Nothing was sent or approved externally.");
  return lines.join("\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "");
}
