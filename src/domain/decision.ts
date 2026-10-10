import type { FeedbackItem } from "./feedback.js";
import type { Item } from "./item.js";
import type { Evaluation, RuleResult } from "./evaluation.js";

export interface Decision {
  status: "APPROVE" | "REJECT" | "REVIEW";
  reasons: { ruleId: string; explanation: string }[];
}

export interface ModerationResult {
  feedback?: FeedbackItem[];
  inputId: string;
  item?: Item;
  deterministic: RuleResult[];
  semantic: Evaluation;
  decision: Decision;
}
