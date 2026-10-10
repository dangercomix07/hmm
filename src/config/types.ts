import type { SectionDefinition } from "../core/sections.js";
import type { Rule } from "../domain/rule.js";

export interface Policy {
  default_action: "review" | "reject";
  fail_required_rule: { action: "reject" | "review" };
  uncertain_rule: { action: "review" };
  min_confidence: number;
}

export interface Config {
  sections?: SectionDefinition[];
  unknown_sections?: "preserve" | "review";
  dry_run: boolean;
  policy: Policy;
  evaluator: { provider: "none" | "fake" | "jev"; timeout_ms: number };
  rules: Rule[];
}
