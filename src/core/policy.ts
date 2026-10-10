import type { Rule } from "../domain/rule.js";
import type { RuleResult } from "../domain/evaluation.js";
import type { Decision } from "../domain/decision.js";
import type { Policy } from "../config/types.js";

export function decide(rules: Rule[], results: RuleResult[], policy: Policy): Decision {
  const review: Decision["reasons"] = [];
  const failures: Decision["reasons"] = [];
  const ids = new Set(rules.map(rule => rule.id));
  if (ids.size !== rules.length || results.length !== rules.length || new Set(results.map(result => result.ruleId)).size !== results.length || results.some(result => !ids.has(result.ruleId))) {
    return { status: "REVIEW", reasons: [{ ruleId: "evaluation", explanation: "Missing, duplicate, conflicting, or unknown rule results." }] };
  }
  for (const rule of rules) {
    const result = results.find(result => result.ruleId === rule.id);
    if (!result || !["PASS", "FAIL", "UNCERTAIN"].includes(result.result) ||
      (result.confidence !== undefined && (!Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 1))) {
      review.push({ ruleId: rule.id, explanation: "Missing or invalid rule result." });
    } else if (result.result === "UNCERTAIN" || (rule.type === "semantic" && (result.confidence === undefined || result.confidence < policy.min_confidence))) {
      review.push({ ruleId: rule.id, explanation: result.reason ?? "Rule is uncertain or confidence is too low." });
    } else if (rule.required && result.result === "FAIL") {
      failures.push({ ruleId: rule.id, explanation: result.reason ?? "Required rule failed." });
    }
  }
  // Uncertainty takes precedence, including when another rule definitively fails.
  if (review.length) return { status: "REVIEW", reasons: [...review, ...failures] };
  if (failures.length) return { status: policy.fail_required_rule.action === "reject" ? "REJECT" : "REVIEW", reasons: failures };
  if (!rules.some(rule => rule.required)) return { status: policy.default_action === "reject" ? "REJECT" : "REVIEW", reasons: [{ ruleId: "policy", explanation: "No required rules establish approval." }] };
  return { status: "APPROVE", reasons: [] };
}
