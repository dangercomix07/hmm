import type { DeterministicRule } from "../domain/rule.js";
import type { RuleResult } from "../domain/evaluation.js";
import type { SectionParse } from "./sections.js";
import type { FeedbackItem } from "../domain/feedback.js";
export const hasUrl = (text: string): boolean => (text.match(/https?:\/\/[^\s<>]+/gi) ?? []).some(s => { try { return Boolean(new URL(s).hostname); } catch { return false; } });
const contentLines = (text: string): string[] => text.split(/\r?\n/).filter(s => !/^\s*(`{3,}|~{3,})/.test(s)).map(s => s.trim().replace(/^(?:[-*+]|\d+[.)])(?:\s+|$)/, "").replace(/^\[[ xX]\](?:\s+|$)/, "").trim()).filter(Boolean);
export function sectionRule(rule: DeterministicRule, parsed: SectionParse, unknown: "preserve" | "review"): RuleResult | undefined {
  const make = (result: RuleResult["result"], message: string, category: FeedbackItem["category"] = "incomplete"): RuleResult => ({ ruleId: rule.id, result, reason: message,
    feedback: { ruleId: rule.id, category, severity: result === "UNCERTAIN" ? "review" : rule.required ? "error" : "warning", message, ...("section" in rule ? { section: rule.section } : {}) } });
  if (rule.check === "section_structure") {
    const issues = [...parsed.issues];
    const seen = new Set<string>();
    for (const section of parsed.sections.filter(s => s.known)) {
      if (seen.has(section.name)) issues.push(`Duplicate section: ${section.name}.`);
      seen.add(section.name);
    }
    if (unknown === "review" && parsed.sections.some(s => !s.known)) issues.push("Unrecognized section heading; check the configured headings.");
    return make(issues.length ? "UNCERTAIN" : "PASS", issues.join(" ") || "Section structure is supported.", "malformed");
  }
  if (rule.check === "total_length") {
    const length = Array.from(parsed.original.trim()).length;
    return make(length >= rule.min && length <= rule.max ? "PASS" : "FAIL", `Update must contain between ${rule.min} and ${rule.max} characters.`);
  }
  if (!("section" in rule)) return undefined;
  const sections = parsed.sections.filter(s => s.name === rule.section);
  if (rule.check === "required_section") return make(sections.length ? "PASS" : "FAIL", `Missing required section: ${rule.section}.`, "missing");
  if (rule.check === "unique_section") return make(sections.length > 1 ? "UNCERTAIN" : "PASS", `Duplicate section: ${rule.section}. Keep one section with this heading.`, "ambiguous");
  if (sections.length > 1) return make("UNCERTAIN", `Duplicate section: ${rule.section}.`, "ambiguous");
  // Presence and content are separate. Optional sections are checked only when supplied.
  if (!sections.length) return make("PASS", "Section is absent; presence is checked separately.");
  const text = sections[0]!.content;
  const lines = contentLines(text);
  switch (rule.check) {
    case "nonempty_section": return make(lines.length && lines.some(s => /[\p{L}\p{N}]/u.test(s)) ? "PASS" : "FAIL", `${rule.section} section is empty.`);
    case "section_length": {
      const length = Array.from(text.trim()).length;
      return make(length >= rule.min && length <= rule.max ? "PASS" : "FAIL", `${rule.section} must contain between ${rule.min} and ${rule.max} characters.`);
    }
    case "bullet_count": {
      let fence: string | undefined;
      const count = text.split(/\r?\n/).filter(line => {
        const trimmed = line.trim(); const marker = /^(`{3,}|~{3,})/.exec(trimmed)?.[1];
        if (marker) {
          if (!fence) fence = marker;
          else if (marker[0] === fence[0] && marker.length >= fence.length && trimmed === marker) fence = undefined;
          return false;
        }
        return !fence && /^\s*(?:[-*+] |\d+[.)] )\S/.test(line);
      }).length;
      return make(count >= rule.min && count <= rule.max ? "PASS" : "FAIL", `${rule.section} must contain between ${rule.min} and ${rule.max} bullets.`);
    }
    case "section_url": return make(hasUrl(text) ? "PASS" : "FAIL", `${rule.section} requires an HTTP or HTTPS link.`);
    case "forbidden_placeholder": {
      const normalize = (s: string) => s.toLowerCase().replace(/^[*_`]+|[*_`]+$/g, "").replace(/[.!]+$/, "").trim();
      const phrases = new Set(rule.phrases.map(normalize));
      const hits = lines.filter(s => phrases.has(normalize(s))).length;
      const contains = lines.some(line => rule.phrases.some(phrase => {
        const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "iu").test(line);
      }));
      return make(hits && hits === lines.length ? "FAIL" : contains ? "UNCERTAIN" : "PASS", hits && hits === lines.length ? `${rule.section} section contains only placeholder text.` : `${rule.section} mixes placeholder text with other content; review the unfinished entries.`, "placeholder");
    }
  }
}
