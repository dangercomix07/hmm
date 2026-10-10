import { sectionKey, type SectionDefinition } from "../core/sections.js";
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
  keys(root, ["dry_run", "policy", "evaluator", "rules", "sections", "unknown_sections", "preamble"], "config");
  if (root.dry_run !== undefined && typeof root.dry_run !== "boolean") throw new Error("dry_run must be boolean");
  if (root.preamble !== undefined && !["allow", "review"].includes(root.preamble as string)) throw new Error("Invalid preamble policy");
  let sections: SectionDefinition[] | undefined;
  if (root.sections !== undefined) {
    if (!Array.isArray(root.sections) || !root.sections.length || root.sections.length > 50) throw new Error("sections must contain 1 to 50 definitions");
    const names = new Set<string>();
    sections = root.sections.map(entry => {
      const d = object(entry, "section"); keys(d, ["name", "aliases"], "section");
      const name = string(d.name, "section name").trim();
      const aliases = d.aliases ?? [];
      if (!Array.isArray(aliases) || aliases.length > 100) throw new Error("section aliases must be an array with at most 100 entries");
      for (const label of [name, ...aliases]) {
        string(label, "section alias");
        if (label.length > 80 || /[\u0000-\u001f\u007f:#]/.test(label) || names.has(sectionKey(label))) throw new Error("Duplicate or invalid section name/alias");
        names.add(sectionKey(label));
      }
      return { name, aliases: aliases as string[] };
    });
  }
  if (root.unknown_sections !== undefined && !["preserve", "review"].includes(root.unknown_sections as string)) throw new Error("Invalid unknown_sections policy");
  if (root.unknown_sections !== undefined && !sections) throw new Error("unknown_sections requires section definitions");
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
  const provider = evaluator.provider ?? "none";
  if (provider !== "none" && provider !== "fake" && provider !== "jev") throw new Error("Unsupported evaluator provider");
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
    const section = (): string => {
      const name = string(rule.section, "section");
      const definition = sections?.find(s => sectionKey(s.name) === sectionKey(name));
      if (!definition) throw new Error(`${id}: section must name a configured section`);
      return definition.name;
    };
    const bounds = () => {
      const min = number(rule.min ?? 0, 0, 100000, "min");
      const max = number(rule.max ?? 100000, 0, 100000, "max");
      if (!Number.isInteger(min) || !Number.isInteger(max) || min > max) throw new Error(`${id}: invalid minimum/maximum bounds`);
      return { min, max };
    };
    switch (check) {
      case "usable_body": {
        keys(rule, [...common, "phrases"], id);
        if (!Array.isArray(rule.phrases) || rule.phrases.length > 100) throw new Error("phrases must be an array of at most 100 entries");
        const phrases = rule.phrases.map(p => string(p, "placeholder"));
        if (phrases.some(p => p.length > 200 || /[\r\n]/.test(p))) throw new Error("Invalid placeholder phrase");
        return { ...deterministic, check, phrases };
      }
      case "inline_code_limit": {
        keys(rule, [...common, "max_lines"], id);
        const max = number(rule.max_lines, 1, 10000, "max_lines");
        if (!Number.isInteger(max)) throw new Error("max_lines must be an integer");
        return { ...deterministic, check, max_lines: max };
      }
      case "no_quoted_history": case "inline_image_attachments":
        keys(rule, common, id); return { ...deterministic, check };
      case "section_structure":
        keys(rule, common, id);
        if (!sections) throw new Error("section_structure requires section definitions");
        return { ...deterministic, check };
      case "required_section": case "nonempty_section": case "unique_section": case "section_url":
        keys(rule, [...common, "section"], id);
        return { ...deterministic, check, section: section() };
      case "section_length": case "bullet_count":
        keys(rule, [...common, "section", "min", "max"], id);
        return { ...deterministic, check, section: section(), ...bounds() };
      case "total_length":
        keys(rule, [...common, "min", "max"], id);
        return { ...deterministic, check, ...bounds() };
      case "forbidden_placeholder": {
        keys(rule, [...common, "section", "phrases", "mixed_action"], id);
        if (rule.mixed_action !== undefined && !["ignore", "review"].includes(rule.mixed_action as string)) throw new Error("Invalid mixed_action");
        if (!Array.isArray(rule.phrases) || !rule.phrases.length || rule.phrases.length > 100) throw new Error("phrases must contain 1 to 100 placeholders");
        const phrases = rule.phrases.map(p => string(p, "placeholder"));
        if (phrases.some(p => p.length > 200 || /[\r\n]/.test(p))) throw new Error("Invalid placeholder phrase");
        return { ...deterministic, check, section: section(), phrases, ...(rule.mixed_action ? { mixed_action: rule.mixed_action as "ignore" | "review" } : {}) };
      }
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
  const requiredSections = new Set<string>();
  const declaredPresence = new Set<string>();
  const constraints = new Map<string, { min: number; max: number }>();
  for (const rule of rules) {
    if (rule.type !== "deterministic") continue;
    if (rule.check === "required_section") {
      if (declaredPresence.has(rule.section)) throw new Error("Duplicate required section definition");
      declaredPresence.add(rule.section);
      if (rule.required) requiredSections.add(rule.section);
    }
    if ("min" in rule && "max" in rule && rule.required) {
      const key = `${rule.check}:${"section" in rule ? rule.section : ""}`;
      const prior = constraints.get(key) ?? { min: 0, max: 100000 };
      const combined = { min: Math.max(prior.min, rule.min), max: Math.min(prior.max, rule.max) };
      if (combined.min > combined.max) throw new Error("Contradictory required constraints");
      constraints.set(key, combined);
    }
  }
  const total = constraints.get("total_length:");
  if (total && rules.some(r => r.type === "deterministic" && r.required && r.check === "minimum_length" && r.min_chars > total.max)) throw new Error("Contradictory total length constraints");
  let minimumContent = 0;
  for (const section of requiredSections) {
    const length = constraints.get(`section_length:${section}`);
    const nonempty = rules.some(r => r.type === "deterministic" && r.required && r.check === "nonempty_section" && r.section === section);
    if (nonempty && length?.max === 0) throw new Error("Nonempty required section cannot have maximum length zero");
    minimumContent += Math.max(length?.min ?? 0, nonempty ? 1 : 0);
  }
  if (total && minimumContent > total.max) throw new Error("Section minimum lengths exceed maximum total length");
  if (sections && !rules.some(r => r.type === "deterministic" && r.check === "section_structure" && r.required)) throw new Error("Section profiles require a required section_structure rule");
  return { ...(root.preamble ? { preamble: root.preamble as "allow" | "review" } : {}), ...(sections ? { sections, unknown_sections: (root.unknown_sections ?? "preserve") as "preserve" | "review" } : {}), dry_run: root.dry_run ?? true, policy, evaluator: { provider, timeout_ms: timeout }, rules };
}

export function parseConfig(text: string): Config {
  const document = parseDocument(text, { uniqueKeys: true });
  if (document.errors.length) throw new Error(document.errors.map(error => error.message).join("; "));
  return validateConfig(document.toJS({ maxAliasCount: 50 }));
}

export async function loadConfig(path: string): Promise<Config> {
  return parseConfig(await readFile(path, "utf8"));
}
