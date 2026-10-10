import type { Item } from "../domain/item.js";
import type { SemanticRule } from "../domain/rule.js";
import type { Evaluation } from "../domain/evaluation.js";

export interface Evaluator {
  evaluate(item: Item, rules: SemanticRule[], signal?: AbortSignal): Promise<Evaluation>;
}
