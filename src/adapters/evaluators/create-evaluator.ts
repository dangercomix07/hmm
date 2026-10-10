import type { Config } from "../../config/types.js";
import type { Evaluator } from "../../ports/evaluator.js";
import { FakeEvaluator } from "./fake-evaluator.js";
import { JevEvaluator } from "./jev-evaluator.js";

export function createEvaluator(config: Config): Evaluator {
  switch (config.evaluator.provider) {
    case "none": return { async evaluate(_item, rules) { return { ruleResults: rules.map(rule => ({ ruleId: rule.id, result: "UNCERTAIN" as const, reason: "Semantic review is required; semantic evaluation is disabled." })) }; } };
    case "fake": return new FakeEvaluator();
    case "jev": return new JevEvaluator();
    default: throw new Error("Unsupported evaluator provider");
  }
}
