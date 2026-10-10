import { parseSections, type SectionDefinition } from "./sections.js";
import { sectionRule } from "./section-rules.js";
import type { Item } from "../domain/item.js";
import type { DeterministicRule } from "../domain/rule.js";
import type { RuleResult } from "../domain/evaluation.js";

export function evaluateDeterministicRules(item: Item, rules: DeterministicRule[], sections: SectionDefinition[] = [], unknownSections: "preserve" | "review" = "preserve"): RuleResult[] {
  const parsed = parseSections(item.body, sections);
  return rules.map(rule => {
    const structured = sectionRule(rule, parsed, unknownSections);
    if (structured) return structured;
    const ruleId = rule.id;
    let pass: boolean;
    let reason: string;
    switch (rule.check) {
      case "minimum_length":
        pass = Array.from(item.body.trim()).length >= rule.min_chars;
        reason = `Requires at least ${rule.min_chars} characters of content.`;
        break;
      case "required_heading":
        pass = item.body.split(/\r?\n/).some(line => line.trim().replace(/^#{1,6}\s+/, "").replace(/:$/, "").toLowerCase() === rule.heading.trim().replace(/:$/, "").toLowerCase());
        reason = `Requires the heading '${rule.heading}'.`;
        break;
      case "required_url":
        pass = (item.body.match(/https?:\/\/[^\s<>]+/gi) ?? []).some(candidate => {
          try { return Boolean(new URL(candidate).hostname); } catch { return false; }
        });
        reason = "Requires an HTTP or HTTPS URL.";
        break;
      case "required_keyword":
        pass = item.body.toLowerCase().includes(rule.keyword.toLowerCase());
        reason = `Requires the text '${rule.keyword}'.`;
        break;
      case "email_domain": {
        if (!item.author?.email) return { ruleId: rule.id, result: "UNCERTAIN", reason: "Author email is missing." };
        const parts = item.author.email.split("@");
        pass = parts.length === 2 && Boolean(parts[0]) && parts[1]?.toLowerCase() === rule.domain.toLowerCase();
        reason = `Requires author email domain '${rule.domain}'.`;
        break;
      }
      default:
        return { ruleId, result: "UNCERTAIN", reason: "Unknown deterministic rule." };
    }
    return { ruleId: rule.id, result: pass ? "PASS" : "FAIL", reason: pass ? "Requirement met." : reason };
  });
}
