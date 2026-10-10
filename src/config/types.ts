import type { Rule } from "../domain/rule.js";

export interface Policy {
  default_action: "review" | "reject";
  fail_required_rule: { action: "reject" | "review" };
  uncertain_rule: { action: "review" };
  min_confidence: number;
}

export interface Config {
  dry_run: boolean;
  policy: Policy;
  evaluator: { provider: "fake" | "jev"; timeout_ms: number };
  rules: Rule[];
}
