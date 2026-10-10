import { readFile } from "node:fs/promises";
import { parseDocument } from "yaml";
import type { Config, Policy } from "./types.js";
import type { Rule } from "../domain/rule.js";

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, allowed: string[], label: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`Unknown ${label} field: ${key}`);
  }
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a nonempty string`);
  return value;
}

function number(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be between ${min} and ${max}`);
  }
  return value;
}

export function validateConfig(input: unknown): Config {
  const root = object(input, "config");
  keys(root, ["dry_run", "policy", "evaluator", "rules"], "config");
  if (root.dry_run !== undefined && typeof root.dry_run !== "boolean") throw new Error("dry_run must be boolean");
  const p = object(root.policy ?? {}, "policy");
  keys(p, ["default_action", "fail_required_rule", "uncertain_rule", "min_confidence"], "policy");
  const defaultAction = p.default_action ?? "review";
  if (defaultAction !== "review" && defaultAction !== "reject") throw new Error("Invalid default_action");
  const fail = object(p.fail_required_rule ?? { action: "reject" }, "fail_required_rule");
  keys(fail, ["action"], "fail_required_rule");
  if (fail.action !== "reject" && fail.action !== "review") throw new Error("Invalid fail_required_rule action");
  const uncertain = object(p.uncertain_rule ?? { action: "review" }, "uncertain_rule");
  keys(uncertain, ["action"], "uncertain_rule");
  if (uncertain.action !== "review") throw new Error("uncertain_rule must use review");
  const policy: Policy = {
    default_action: defaultAction,
    fail_required_rule: { action: fail.action },
    uncertain_rule: { action: "review" },
    min_confidence: number(p.min_confidence ?? 0.8, 0, 1, "min_confidence"),
  };
  const evaluator = object(root.evaluator ?? {}, "evaluator");
  keys(evaluator, ["provider", "timeout_ms"], "evaluator");
  const provider = evaluator.provider ?? "fake";
  if (provider !== "fake" && provider !== "jev") throw new Error("Unsupported evaluator provider");
  const timeout = number(evaluator.timeout_ms ?? 10000, 1, 2147483647, "timeout_ms");
  if (!Number.isInteger(timeout)) throw new Error("timeout_ms must be an integer");
  if (!Array.isArray(root.rules)) throw new Error("rules must be an array");
  const seen = new Set<string>();
  const rules: Rule[] = root.rules.map((entry: unknown) => {
    const rule = object(entry, "rule");
    const id = string(rule.id, "rule id");
    if (seen.has(id)) throw new Error(`Duplicate rule: ${id}`);
    seen.add(id);
    if (typeof rule.required !== "boolean") throw new Error(`${id}: required must be boolean`);
    const base = { id, required: rule.required };
    if (rule.type === "semantic") {
      keys(rule, ["id", "type", "required", "instruction"], id);
      return { ...base, type: "semantic", instruction: string(rule.instruction, "instruction") };
    }
    if (rule.type !== "deterministic") throw new Error(`${id}: unknown rule type`);
    // The original minimum_length example may omit check when min_chars is supplied.
    const check = string(rule.check ?? (rule.min_chars !== undefined ? "minimum_length" : undefined), "check");
    const common = ["id", "type", "required", "check"];
    const deterministic = { ...base, type: "deterministic" as const };
    switch (check) {
      case "minimum_length": {
        keys(rule, [...common, "min_chars"], id);
        const min = number(rule.min_chars, 0, Number.MAX_SAFE_INTEGER, "min_chars");
        if (!Number.isInteger(min)) throw new Error("min_chars must be an integer");
        return { ...deterministic, check, min_chars: min };
      }
      case "required_heading":
        keys(rule, [...common, "heading"], id);
        return { ...deterministic, check, heading: string(rule.heading, "heading") };
      case "required_url":
        keys(rule, common, id);
        return { ...deterministic, check };
      case "required_keyword":
        keys(rule, [...common, "keyword"], id);
        return { ...deterministic, check, keyword: string(rule.keyword, "keyword") };
      case "email_domain":
        keys(rule, [...common, "domain"], id);
        return { ...deterministic, check, domain: string(rule.domain, "domain").toLowerCase() };
      default: throw new Error(`${id}: unknown deterministic check`);
    }
  });
  return { dry_run: root.dry_run ?? true, policy, evaluator: { provider, timeout_ms: timeout }, rules };
}

export function parseConfig(text: string): Config {
  const document = parseDocument(text, { uniqueKeys: true });
  if (document.errors.length) throw new Error(document.errors.map(error => error.message).join("; "));
  return validateConfig(document.toJS({ maxAliasCount: 50 }));
}

export async function loadConfig(path: string): Promise<Config> {
  return parseConfig(await readFile(path, "utf8"));
}
