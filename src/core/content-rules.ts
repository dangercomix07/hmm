import type { Item } from "../domain/item.js";
import type { DeterministicRule } from "../domain/rule.js";
import type { RuleResult } from "../domain/evaluation.js";
import type { SectionParse } from "./sections.js";
import { imageAttachmentStatus } from "./image-attachments.js";
export function inspectText(body: string): { codeLines: number[]; ambiguousCode: boolean; history: "none" | "clear" | "ambiguous"; usable: string[] } {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  let fence: string | undefined, count = 0, ambiguousCode = false;
  let history: "none" | "clear" | "ambiguous" = "none";
  const codeLines: number[] = [], usable: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!, value = line.trim();
    const marker = /^(`{3,}|~{3,})/.exec(value)?.[1];
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length && marker === value) { codeLines.push(count); fence = undefined; }
      else { count++; usable.push(line); }
      continue;
    }
    if (marker) { fence = marker; count = 0; continue; }
    if (/^On .+ wrote:\s*$/i.test(value)) {
      if (lines.slice(i + 1).some(s => /^\s*>/.test(s))) { history = "clear"; break; }
      history = "ambiguous";
    }
    if (/^-{2,}\s*(?:Original Message|Forwarded message)\s*-{2,}$/i.test(value) || /^Begin forwarded message:$/i.test(value)) {
      const envelope = lines.slice(i + 1, i + 12).join("\n");
      if (/^From:\s*\S/im.test(envelope) && /^To:\s*\S/im.test(envelope) && /^(?:Subject|Date|Sent):\s*\S/im.test(envelope)) { history = "clear"; break; }
      history = "ambiguous";
    }
    if (/^>/.test(value)) { history = "ambiguous"; continue; }
    const ticks = value.match(/(?<!\\)`+/g) ?? [];
    if (ticks.some(mark => ticks.filter(other => other === mark).length % 2 !== 0)) ambiguousCode = true;
    if (/^\s{4}\S/.test(line)) ambiguousCode = true; // Might be indented code or ordinary indentation.
    usable.push(line);
  }
  if (fence) ambiguousCode = true;
  return { codeLines, ambiguousCode, history, usable };
}
export function contentRule(item: Item, rule: DeterministicRule, parsed: SectionParse): RuleResult | undefined {
  if (!["usable_body", "inline_code_limit", "no_quoted_history", "inline_image_attachments"].includes(rule.check)) return undefined;
  const observed = inspectText(item.body);
  const make = (result: RuleResult["result"], message: string, category: "incomplete" | "placeholder" | "ambiguous" = "incomplete"): RuleResult => ({ ruleId: rule.id, result, reason: message,
    feedback: { ruleId: rule.id, category, severity: result === "UNCERTAIN" ? "review" : rule.required ? "error" : "warning", message } });
  switch (rule.check) {
    case "usable_body": {
      const headings = new Set(parsed.sections.map(s => s.heading.trim()));
      const lines = observed.usable.filter(s => !headings.has(s.trim())).map(s => s.trim().replace(/^(?:[-*+]|\d+[.)])(?:\s+|$)/, "").replace(/^\[[ xX]\](?:\s+|$)/, "").replace(/^[*_`]+|[*_`]+$/g, "").replace(/[.!]+$/, "").trim()).filter(s => /[\p{L}\p{N}]/u.test(s));
      if (!lines.length) return make("FAIL", "The update body has no usable text after empty formatting and clear reply history are excluded.");
      if (lines.every(s => rule.phrases.some(p => p.toLowerCase() === s.toLowerCase()))) return make("FAIL", "The update body contains only configured placeholders.", "placeholder");
      return make("PASS", "The update body contains text.");
    }
    case "inline_code_limit": {
      if ([...observed.codeLines, ...(item.contentObservations?.htmlCodeLines ?? [])].some(n => n > rule.max_lines)) return make("FAIL", `An inline code block exceeds ${rule.max_lines} lines. Attach longer code as a file.`);
      if (observed.ambiguousCode || item.contentObservations?.htmlCodeAmbiguous) return make("UNCERTAIN", "Code formatting is ambiguous; review the snippet boundaries.", "ambiguous");
      return make("PASS", "Inline code blocks meet the configured line limit.");
    }
    case "no_quoted_history": {
      const html = item.contentObservations?.htmlQuote;
      if (observed.history === "clear" || html === "clear") return make("FAIL", "Quoted previous-thread history is present. Remove it before submitting.");
      if (observed.history === "ambiguous" || html === "ambiguous") return make("UNCERTAIN", "Quoted content is present, but its role as reply history is unclear.", "ambiguous");
      return make("PASS", "No recognizable previous-thread history was found.");
    }
    case "inline_image_attachments": {
      const status = imageAttachmentStatus(item.contentObservations, item.body);
      return make(status, status === "FAIL" ? "An inline image has no corresponding attached image file." : status === "UNCERTAIN" ? "Image and attachment relationships cannot be determined safely." : "Inline image attachment requirement met.", status === "UNCERTAIN" ? "ambiguous" : "incomplete");
    }
  }
}
