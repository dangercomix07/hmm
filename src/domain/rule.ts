interface BaseRule {
  id: string;
  required: boolean;
}

export type DeterministicRule = BaseRule & { type: "deterministic" } & (
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
