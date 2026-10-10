export interface FeedbackItem {
  ruleId: string;
  category: "missing" | "incomplete" | "malformed" | "placeholder" | "ambiguous" | "semantic-review";
  severity: "error" | "review" | "warning";
  message: string;
  section?: string;
}
