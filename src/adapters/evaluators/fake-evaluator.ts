import type { Item } from "../../domain/item.js";
import type { SemanticRule } from "../../domain/rule.js";
import type { Evaluation } from "../../domain/evaluation.js";
import type { Evaluator } from "../../ports/evaluator.js";

/** Demo only: recognizes two rule IDs using text patterns, not semantic reasoning. */
export class FakeEvaluator implements Evaluator {
  async evaluate(item: Item, rules: SemanticRule[]): Promise<Evaluation> {
    return { ruleResults: rules.map(rule => {
      let pass: boolean;
      let reason: string;
      switch (rule.id) {
        case "real_progress":
          pass = /\b(implemented|measured|fixed|completed|tested|reduced|calibrated)\b/i.test(item.body) && /\b\d+(?:\.\d+)?\b/.test(item.body);
          reason = "Demo check requires a concrete-work verb and a numeric result.";
          break;
        case "next_steps": {
          const next = /^(?:#{1,6}\s*)?Next steps:\s*([\s\S]*)/im.exec(item.body)?.[1]?.trim() ?? "";
          pass = /^(?:[-*]\s*)?(benchmark|test|implement|measure|compare|deploy|calibrate|fix|document)\b/i.test(next) && next.split(/\s+/).length >= 5;
          reason = "Demo check requires 'Next steps:' followed by a specific action of at least five words.";
          break;
        }
        default: return { ruleId: rule.id, result: "UNCERTAIN", reason: "Fake evaluator does not understand this rule; use a real evaluator adapter.", confidence: 0 };
      }
      return { ruleId: rule.id, result: pass ? "PASS" : "FAIL", reason: pass ? "Demo pattern matched; this is not an AI assessment." : reason, confidence: 1 };
    }) };
  }
}
