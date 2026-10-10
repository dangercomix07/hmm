import type { FeedbackItem } from "./feedback.js";
import type { ProgressRecord } from "./progress.js";

export interface RuleResult {
  feedback?: FeedbackItem;
  ruleId: string;
  result: "PASS" | "FAIL" | "UNCERTAIN";
  reason?: string;
  confidence?: number;
}

export interface Evaluation {
  ruleResults: RuleResult[];
  confidence?: number;
  progress?: ProgressRecord;
}
