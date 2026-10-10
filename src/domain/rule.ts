interface BaseRule {
  id: string;
  required: boolean;
}

export type DeterministicRule = BaseRule & { type: "deterministic" } & (
  | { check: "usable_body"; phrases: string[] }
  | { check: "inline_code_limit"; max_lines: number }
  | { check: "no_quoted_history" | "inline_image_attachments" }
  | { check: "section_structure" }
  | { check: "required_section" | "nonempty_section" | "unique_section"; section: string }
  | { check: "section_length"; section: string; min: number; max: number }
  | { check: "bullet_count"; section: string; min: number; max: number }
  | { check: "total_length"; min: number; max: number }
  | { check: "forbidden_placeholder"; section: string; phrases: string[]; mixed_action?: "ignore" | "review" }
  | { check: "section_url"; section: string }
  | { check: "minimum_length"; min_chars: number }
  | { check: "required_heading"; heading: string }
  | { check: "required_url" }
  | { check: "required_keyword"; keyword: string }
  | { check: "email_domain"; domain: string }
);

export interface SemanticRule extends BaseRule {
  type: "semantic";
  instruction: string;
}

export type Rule = DeterministicRule | SemanticRule;
